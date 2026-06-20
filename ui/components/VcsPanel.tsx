// The Mercurial app body — the source-control surface housed inside the app's
// own content rect (host.container). It is the same source-control shape as the
// git app, for Mercurial.
//
// VCS inspection happens THROUGH A SLOT (docs/core/server/workspaces.md §6): the selector
// rail (the app's ExtensionSidebar) lists every live reservation grouped by its
// workspace; selecting one shows that slot's repository — its worktree, on its
// owner's branch — with changed files (status), a diff pane for the selected
// file, and a recent commit log, in the main pane beside the rail (a resizable
// Split).
//
// Mercurial has no staging area (index), so `hasStaging` is always false here
// (git's app passes true) — `hg commit` records every tracked change directly;
// everything else (status/diff/log/commit) is the shared RepoView.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExtensionSidebar, Split, EmptyState } from '@frontierengineer/ui';
import type { ExtensionHost, Reservation, Workspace } from '../../../types';
import { RepoView } from './RepoView';
import { createVcsClient, type VcsClient } from '../vcs';

export interface SlotTarget {
  reservationId: string;
  machine: string;
  slotDir: string;
  label: string;   // the owning thing's display name (chat/space title)
}

interface WorkspaceGroup {
  workspaceId: string;
  title: string;
  slots: SlotTarget[];
}

export function VcsPanel({ host }: { host: ExtensionHost }) {
  const machines = host.machines;
  const workspacesService = host.services.workspaces;
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [rs, wss] = await Promise.all([
        workspacesService.reservations(),
        workspacesService.list(),
      ]);
      setReservations(rs);
      setWorkspaces(wss);
    } catch { /* keep the last good list */ }
  }, [workspacesService]);

  // Slots come and go as things reserve and free — refresh on mount and on
  // every fleet/slot event the host pushes. The watch keeps a hidden app's
  // list current too (its bus stays alive); onActivate re-pulls once for
  // freshness when the app is shown again.
  useEffect(() => {
    void refresh();
    const stopWatch = machines.watch(() => void refresh());
    const stopActivate = host.lifecycle.onActivate(() => void refresh());
    return () => { stopWatch(); stopActivate(); };
  }, [refresh, machines, host]);

  const groups = useMemo(() => {
    const relevant = new Set(['mercurial']);
    const byId = new Map(workspaces.map((w) => [w.id, w]));
    const byWorkspace = new Map<string, WorkspaceGroup>();
    for (const r of reservations) {
      const w = byId.get(r.workspaceId);
      // Only Mercurial workspaces — this app has nothing to say about a git
      // checkout (the git app handles those).
      if (!w || !relevant.has(w.provider)) continue;
      const dir = r.descriptor.slotDir || r.descriptor.canonicalDir;
      if (!dir) continue;
      let g = byWorkspace.get(r.workspaceId);
      if (!g) {
        g = { workspaceId: r.workspaceId, title: w.title, slots: [] };
        byWorkspace.set(r.workspaceId, g);
      }
      g.slots.push({ reservationId: r.id, machine: r.machine, slotDir: dir, label: r.name });
    }
    return Array.from(byWorkspace.values()).sort((a, b) => a.title.localeCompare(b.title));
  }, [reservations, workspaces]);

  const slotByKey = useMemo(() => {
    const map = new Map<string, SlotTarget>();
    for (const g of groups) for (const slot of g.slots) map.set(slot.reservationId, slot);
    return map;
  }, [groups]);

  // Auto-select the first slot once data lands.
  useEffect(() => {
    if (selected) return;
    const first = groups[0]?.slots[0];
    if (first) setSelected(first.reservationId);
  }, [groups, selected]);

  const selectedSlot = selected ? (slotByKey.get(selected) ?? null) : null;
  const client = useMemo<VcsClient | null>(
    () => (selectedSlot ? createVcsClient(machines, selectedSlot.machine, selectedSlot.slotDir) : null),
    [machines, selectedSlot],
  );

  // The slot selector — the app's own nav rail (ExtensionSidebar), grouped by
  // workspace. Lives in the Split's first (left) pane.
  const selector = (
    <ExtensionSidebar className="ext-vcs-selector">
      {groups.length === 0 ? (
        <div className="ext-vcs-selector-empty">
          No active Mercurial workspaces.
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.workspaceId} className="ext-vcs-selector-group">
            <div className="ext-vcs-selector-group-title" title={g.workspaceId}>
              {g.title}
            </div>
            {g.slots.map((slot) => (
              <button
                key={slot.reservationId}
                className={`ext-vcs-selector-item ${selected === slot.reservationId ? 'active' : ''}`}
                onClick={() => setSelected(slot.reservationId)}
                title={slot.slotDir}
              >
                <span className="ext-vcs-selector-label">{slot.label}</span>
              </button>
            ))}
          </div>
        ))
      )}
    </ExtensionSidebar>
  );

  // The selected slot's repository — the main pane beside the rail. hg has no
  // staging area, so hasStaging is always false.
  const stage = (
    <div className="ext-vcs-stage">
      {selectedSlot && client ? (
        <RepoView key={selectedSlot.reservationId} vcs="hg" client={client} slot={selectedSlot} hasStaging={false} />
      ) : (
        <div className="ext-vcs-empty">Select a repository to view its changes.</div>
      )}
    </div>
  );

  // No live reservations: show the same actionable empty state the git app does,
  // rather than two terse "nothing here" strings in the split — every VCS app
  // should teach the same next step (iter-008 friction rank 4).
  if (groups.length === 0) {
    return (
      <div className="ext-vcs-app ext-vcs-app-empty">
        <EmptyState
          icon={<svg width="44" height="44" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true"><circle cx="4" cy="4" r="1.6" /><circle cx="4" cy="12" r="1.6" /><circle cx="12" cy="5.5" r="1.6" /><path d="M4 5.6v4.8M4 12h4a4 4 0 0 0 4-4V7" /></svg>}
          title="No Mercurial workspaces yet"
          description="Add a workspace backed by an hg repo (☰ menu → Machines → Add workspace), then run an agent on it — its branches and changes show up here."
        />
      </div>
    );
  }

  return (
    <div className="ext-vcs-panel">
      <Split
        first={selector}
        second={stage}
        initialFirstSize={184}
        minFirstSize={140}
        minSecondSize={280}
        storageKey="frontier.hg.selectorWidth"
      />
    </div>
  );
}
