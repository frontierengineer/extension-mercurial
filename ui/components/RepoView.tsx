// One repository's view, for the git/mercurial source-control panels.
// Regions:
//   • Changed files (working-tree status) — click a file to diff it; each
//     row carries inline write controls (git: Stage/Unstage/Discard; hg:
//     Revert).
//   • Diff pane — a Monaco side-by-side READ-ONLY diff of the selected
//     working-tree file (committed version vs the live worktree file), or
//     the unified text of a selected commit.
//   • Commit bar — a message input + Commit button (git also: Stage all;
//     hg also: an Add/remove-untracked checkbox).
//   • Recent log — the last N commits; click one to diff that commit.
//
// Driven entirely by the VcsClient the panel wires in (which runs the VCS
// binary in the slot's directory). The git-vs-hg difference is carried by
// `hasStaging` (git true, hg false): git has a staging area (index) so files
// move Stage⇄Unstage and a commit records the staged index; hg has no
// staging — `hg commit` records every tracked change directly, optionally
// adding/removing untracked/missing files (`-A`) when the checkbox is set.
//
// Per-file working changes render in a Monaco DiffEditor (the shared
// @frontierengineer/ui/MonacoDiff primitive). A whole-commit view stays
// colorized unified text, which reads fine across files.
//
// The left column (commit bar + changes + log) is a resizable/collapsible
// @frontierengineer/ui ResizerColumn; the diff pane is the flexible
// ResizerContent beside it.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MonacoDiff } from '@frontierengineer/ui/MonacoDiff';
import { ResizerColumn, ResizerContent } from '@frontierengineer/ui';
import type {
  StatusFile, StatusResult, LogResult, DiffResult, FileDiffResult, ActionResult,
} from '../types';
import type { VcsClient } from '../vcs';
import type { SlotTarget } from './VcsPanel';
import { confirmModal } from './ConfirmModal';

// Selection drives the diff pane: a working-tree file (→ Monaco diff), or
// a commit (+ an optional file scoping the commit diff to one path).
type Selection =
  | { kind: 'worktree'; file: string }
  | { kind: 'commit'; rev: string; file: string | null };

// ── Status helpers ────────────────────────────────────────────────────
// git porcelain XY: X is the index (staged) letter, Y the worktree
// (unstaged) letter. ' ' means "no change in that column"; '?' on both is
// untracked. hg maps everything to the worktree column (index stays ' ').
function isUntracked(f: StatusFile): boolean {
  return f.index === '?' || f.worktree === '?';
}
function isStaged(f: StatusFile): boolean {
  return f.index !== ' ' && f.index !== '?';
}
function hasWorktreeChange(f: StatusFile): boolean {
  return f.worktree !== ' ' && f.worktree !== '?';
}

export function RepoView({
  vcs, client, slot, hasStaging,
}: { vcs: 'git' | 'hg'; client: VcsClient; slot: SlotTarget; hasStaging: boolean }) {
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [log, setLog] = useState<LogResult | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [commitDiff, setCommitDiff] = useState<DiffResult | null>(null); // whole-commit unified text
  const [fileDiff, setFileDiff] = useState<FileDiffResult | null>(null); // per-file Monaco sides
  const [diffLoading, setDiffLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Commit bar state.
  const [message, setMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [addRemove, setAddRemove] = useState(false); // hg `-A`
  const [actionBusy, setActionBusy] = useState(false); // any stage/discard in flight
  const [actionError, setActionError] = useState<string | null>(null);
  // Push state (header button).
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [s, l] = await Promise.all([
        client.status(),
        client.log(30),
      ]);
      setStatus(s);
      setLog(l);
    } catch (err) {
      setStatus({ ok: false, error: String(err) });
    } finally {
      setRefreshing(false);
    }
  }, [client]);

  // Re-read status only (after a stage/unstage/discard — log is unchanged).
  const reloadStatus = useCallback(async () => {
    try {
      setStatus(await client.status());
    } catch (err) {
      setStatus({ ok: false, error: String(err) });
    }
  }, [client]);

  useEffect(() => {
    setSelection(null); setCommitDiff(null); setFileDiff(null);
    setMessage(''); setActionError(null); setPushResult(null);
    load();
  }, [load]);

  // Fetch the diff whenever the selection changes. A working-tree file goes
  // to fileDiff (two sides → Monaco); a commit goes to diff (unified text).
  // Each clears the other's result so the pane never shows a stale view of
  // the wrong kind.
  useEffect(() => {
    if (!selection) { setCommitDiff(null); setFileDiff(null); return; }
    let cancelled = false;
    setDiffLoading(true);
    if (selection.kind === 'worktree') {
      setCommitDiff(null);
      client.fileDiff(selection.file)
        .then((d) => { if (!cancelled) setFileDiff(d); })
        .catch((err) => { if (!cancelled) setFileDiff({ ok: false, error: String(err) }); })
        .finally(() => { if (!cancelled) setDiffLoading(false); });
    } else {
      setFileDiff(null);
      client.diff({ rev: selection.rev, file: selection.file ?? undefined })
        .then((d) => { if (!cancelled) setCommitDiff(d); })
        .catch((err) => { if (!cancelled) setCommitDiff({ ok: false, error: String(err) }); })
        .finally(() => { if (!cancelled) setDiffLoading(false); });
    }
    return () => { cancelled = true; };
  }, [selection, client]);

  // Run a write op, surface its error if any, then refresh status.
  const runAction = useCallback(async (op: () => Promise<ActionResult>) => {
    setActionBusy(true);
    setActionError(null);
    try {
      const res = await op();
      if (!res || !res.ok) {
        setActionError(res?.error || 'action failed');
        return false;
      }
      await reloadStatus();
      return true;
    } catch (err) {
      setActionError(String(err));
      return false;
    } finally {
      setActionBusy(false);
    }
  }, [reloadStatus]);

  const onStage = useCallback((file: string) => runAction(() => client.stage(file)), [runAction, client]);
  const onUnstage = useCallback((file: string) => runAction(() => client.unstage(file)), [runAction, client]);
  const onStageAll = useCallback(() => runAction(() => client.stageAll()), [runAction, client]);

  // Discard (git) / revert (hg) — destructive, so confirm first.
  const onDiscard = useCallback(async (file: string) => {
    const ok = await confirmModal({
      title: vcs === 'git' ? 'Discard changes' : 'Revert changes',
      message: `Throw away all working-tree changes to "${file}"? This cannot be undone.`,
      confirmLabel: vcs === 'git' ? 'Discard' : 'Revert',
      danger: true,
    });
    if (!ok) return;
    // If the discarded file is the one being diffed, clear the now-stale diff.
    if (selection?.kind === 'worktree' && selection.file === file) setSelection(null);
    await runAction(() => client.discard(file));
  }, [vcs, runAction, client, selection]);

  const onCommit = useCallback(async () => {
    const msg = message.trim();
    if (!msg) return;
    setCommitting(true);
    setActionError(null);
    try {
      const res = await client.commit(hasStaging ? { message: msg } : { message: msg, addRemove });
      if (!res || !res.ok) {
        setActionError(res?.error || 'commit failed');
        return;
      }
      setMessage('');
      setSelection(null);
      await load(); // commit moves HEAD → refresh status AND log
    } catch (err) {
      setActionError(String(err));
    } finally {
      setCommitting(false);
    }
  }, [message, hasStaging, addRemove, client, load]);

  // Push the current branch (git) / default path (hg). Best-effort: the
  // result (success summary or error) shows inline in the header.
  const onPush = useCallback(async () => {
    setPushing(true);
    setPushResult(null);
    try {
      const res = await client.push();
      if (!res || !res.ok) {
        setPushResult({ ok: false, text: res?.error || 'push failed' });
      } else {
        setPushResult({ ok: true, text: res.message || 'Pushed.' });
      }
    } catch (err) {
      setPushResult({ ok: false, text: String(err) });
    } finally {
      setPushing(false);
    }
  }, [client]);

  // ── Uniform empty states (git ⇄ hg) ─────────────────────────────────
  // Both VCSs tag the failure with a stable `code` so the SAME message
  // renders for the SAME situation: a slot with no directory (`no_dir`)
  // and a directory that isn't this VCS's repo (`not_a_repo`). The slot's
  // directory is shown as a sub-line.
  const failCode = status && !status.ok ? status.code : null;
  if (failCode === 'no_dir' || failCode === 'not_a_repo') {
    const headline = failCode === 'no_dir'
      ? 'This slot has no directory'
      : (vcs === 'git' ? 'Not a git repository' : 'Not a Mercurial repository');
    return (
      <div className="ext-vcs-repo">
        <div className="ext-vcs-empty">
          <p>{headline}</p>
          <p className="ext-vcs-empty-sub">{slot.slotDir}</p>
          <button className="btn-ghost btn-sm" onClick={load}>Retry</button>
        </div>
      </div>
    );
  }

  const branchLabel = status && status.ok
    ? (status.detached ? '(detached)' : status.branch ?? '(no branch)')
    : '';

  const files = status && status.ok ? status.files : [];
  const stagedCount = hasStaging ? files.filter(isStaged).length : 0;
  const hasChanges = files.length > 0;
  // git commits the staged index → need something staged. hg has no
  // staging → any change is committable.
  const canCommit = !committing && message.trim().length > 0 &&
    (hasStaging ? stagedCount > 0 : hasChanges);

  return (
    <div className="ext-vcs-repo">
      <div className="ext-vcs-repo-header">
        <span className="ext-vcs-repo-tag">{vcs}</span>
        <span className="ext-vcs-repo-branch" title="current branch">{branchLabel}</span>
        <span className="ext-vcs-repo-dir" title={status && status.ok ? status.directory : slot.slotDir}>
          {(status && status.ok ? status.directory : slot.slotDir)}
        </span>
        {pushResult && (
          <span
            className={`ext-vcs-push-status ${pushResult.ok ? 'ok' : 'err'}`}
            title={pushResult.text}
          >
            {pushResult.text}
          </span>
        )}
        <button className="btn-ghost btn-sm ext-vcs-repo-push" disabled={pushing} onClick={onPush}>
          {pushing ? 'Pushing…' : 'Push'}
        </button>
        <button className="btn-ghost btn-sm ext-vcs-repo-refresh" disabled={refreshing} onClick={load}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="ext-vcs-repo-body">
        <ResizerColumn
          storageKey={vcs === 'git' ? 'frontier.git.colWidth' : 'frontier.hg.colWidth'}
          defaultWidth={280}
          minWidth={200}
          maxWidth={520}
          label="changes and log"
          className="ext-vcs-repo-left"
        >
          <CommitBar
            vcs={vcs}
            hasStaging={hasStaging}
            message={message}
            onMessageChange={setMessage}
            canCommit={canCommit}
            committing={committing}
            onCommit={onCommit}
            onStageAll={onStageAll}
            stageAllDisabled={actionBusy || !hasChanges}
            stagedCount={stagedCount}
            addRemove={addRemove}
            onAddRemoveChange={setAddRemove}
            error={actionError}
          />
          {/* Commit bar stays pinned; the changes + log scroll. The
              ResizerColumn wrapper is overflow-hidden (for a clean
              collapse), so the scroll lives in this inner region. */}
          <div className="ext-vcs-repo-left-scroll">
            <ChangesSection
              status={status}
              hasStaging={hasStaging}
              selectedFile={selection?.kind === 'worktree' ? selection.file : null}
              onSelectFile={(f) => setSelection({ kind: 'worktree', file: f })}
              actionBusy={actionBusy}
              onStage={onStage}
              onUnstage={onUnstage}
              onDiscard={onDiscard}
            />
            <LogSection
              log={log}
              selectedRev={selection?.kind === 'commit' ? selection.rev : null}
              onSelectCommit={(rev) => setSelection({ kind: 'commit', rev, file: null })}
            />
          </div>
        </ResizerColumn>
        <ResizerContent className="ext-vcs-repo-diff">
          <DiffPane
            selection={selection}
            commitDiff={commitDiff}
            fileDiff={fileDiff}
            loading={diffLoading}
          />
        </ResizerContent>
      </div>
    </div>
  );
}

function CommitBar({
  vcs, hasStaging, message, onMessageChange, canCommit, committing, onCommit,
  onStageAll, stageAllDisabled, stagedCount, addRemove, onAddRemoveChange, error,
}: {
  vcs: 'git' | 'hg';
  hasStaging: boolean;
  message: string;
  onMessageChange: (v: string) => void;
  canCommit: boolean;
  committing: boolean;
  onCommit: () => void;
  onStageAll: () => void;
  stageAllDisabled: boolean;
  stagedCount: number;
  addRemove: boolean;
  onAddRemoveChange: (v: boolean) => void;
  error: string | null;
}) {
  // Ctrl/Cmd+Enter commits from the textarea (a plain Enter inserts a
  // newline, matching a normal commit-message editor).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canCommit) {
      e.preventDefault();
      onCommit();
    }
  };
  return (
    <div className="ext-vcs-commitbar">
      <div className="ext-vcs-commit-actions">
        <button className="btn-primary btn-sm" disabled={!canCommit} onClick={onCommit}>
          {committing ? 'Committing…' : 'Commit'}
        </button>
        {hasStaging && (
          <button className="btn-ghost btn-sm" disabled={stageAllDisabled} onClick={onStageAll}>
            Stage all
          </button>
        )}
      </div>
      <textarea
        className="ext-vcs-commit-input"
        placeholder={hasStaging ? 'Commit message (staged changes)' : 'Commit message'}
        value={message}
        onChange={(e) => onMessageChange(e.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
      />
      {!hasStaging && (
        <label className="ext-vcs-commit-opt" title="Add untracked files and remove missing files as part of the commit (hg -A)">
          <input
            type="checkbox"
            checked={addRemove}
            onChange={(e) => onAddRemoveChange(e.target.checked)}
          />
          <span>Add/remove untracked</span>
        </label>
      )}
      {hasStaging && stagedCount === 0 && message.trim().length > 0 && (
        <div className="ext-vcs-commit-hint">Stage a file to commit.</div>
      )}
      {error && <div className="ext-vcs-error">{error}</div>}
    </div>
  );
}

// A single file row: clickable main area (badge + name → diff) plus a
// trailing action cluster. `region` says which list the row is in — staged
// rows offer only Unstage; worktree (unstaged) rows offer Stage + Discard.
// In the un-split hg case (`region: 'all'`) the row offers whatever applies
// to the file, exactly as the single list always did.
function FileRow({
  file, region, hasStaging, selectedFile, onSelectFile, actionBusy, onStage, onUnstage, onDiscard,
}: {
  file: StatusFile;
  region: 'staged' | 'worktree' | 'all';
  hasStaging: boolean;
  selectedFile: string | null;
  onSelectFile: (f: string) => void;
  actionBusy: boolean;
  onStage: (f: string) => void;
  onUnstage: (f: string) => void;
  onDiscard: (f: string) => void;
}) {
  const f = file;
  // The badge letter reflects the side this row represents: the index
  // letter in the staged section, otherwise the worktree letter (falling
  // back to the index letter when there's no separate worktree change).
  const letter = region === 'staged'
    ? f.index
    : (f.worktree !== ' ' ? f.worktree : f.index);
  const showUnstage = hasStaging && (region === 'staged' || region === 'all') && isStaged(f);
  const showStage = hasStaging && region !== 'staged' && (hasWorktreeChange(f) || isUntracked(f));
  // Discard/revert only makes sense for a tracked worktree change (git
  // checkout / hg revert don't apply to untracked files), and never from
  // the staged section.
  const showDiscard = region !== 'staged' && hasWorktreeChange(f) && !isUntracked(f);
  return (
    <div className={`ext-vcs-file-row ${selectedFile === f.path ? 'active' : ''}`}>
      <button
        className="ext-vcs-file-main"
        onClick={() => onSelectFile(f.path)}
        title={f.path}
      >
        <FileBadge letter={letter} />
        <span className="ext-vcs-file-name">{f.path}</span>
        {f.rename_from && <span className="ext-vcs-rename">← {f.rename_from}</span>}
      </button>
      <span className="ext-vcs-file-actions">
        {showUnstage && (
          <button
            className="ext-vcs-file-act"
            disabled={actionBusy}
            title="Unstage"
            onClick={() => onUnstage(f.path)}
          >−</button>
        )}
        {showStage && (
          <button
            className="ext-vcs-file-act"
            disabled={actionBusy}
            title="Stage"
            onClick={() => onStage(f.path)}
          >+</button>
        )}
        {showDiscard && (
          <button
            className="ext-vcs-file-act danger"
            disabled={actionBusy}
            title={hasStaging ? 'Discard changes' : 'Revert changes'}
            onClick={() => onDiscard(f.path)}
          >↺</button>
        )}
      </span>
    </div>
  );
}

function ChangesSection({
  status, hasStaging, selectedFile, onSelectFile, actionBusy, onStage, onUnstage, onDiscard,
}: {
  status: StatusResult | null;
  hasStaging: boolean;
  selectedFile: string | null;
  onSelectFile: (f: string) => void;
  actionBusy: boolean;
  onStage: (f: string) => void;
  onUnstage: (f: string) => void;
  onDiscard: (f: string) => void;
}) {
  if (!status) {
    return (
      <div className="ext-vcs-section">
        <div className="ext-vcs-section-title">Changes</div>
        <div className="ext-vcs-muted">Loading…</div>
      </div>
    );
  }
  if (!status.ok) {
    return (
      <div className="ext-vcs-section">
        <div className="ext-vcs-section-title">Changes</div>
        <div className="ext-vcs-error">{status.error || 'error'}</div>
      </div>
    );
  }

  const rowProps = { hasStaging, selectedFile, onSelectFile, actionBusy, onStage, onUnstage, onDiscard };

  // git: VS-Code-style split into "Staged Changes" (index letter set) and
  // "Changes" (unstaged worktree change / untracked). A partially-staged
  // file shows in both. hg has no staging → one combined "Changes" list.
  if (hasStaging) {
    const staged = status.files.filter(isStaged);
    const unstaged = status.files.filter((f) => hasWorktreeChange(f) || isUntracked(f));
    if (status.clean) {
      return (
        <div className="ext-vcs-section">
          <div className="ext-vcs-section-title">Changes</div>
          <div className="ext-vcs-muted">No local changes.</div>
        </div>
      );
    }
    return (
      <>
        {staged.length > 0 && (
          <div className="ext-vcs-section">
            <div className="ext-vcs-section-title">
              Staged Changes
              <span className="ext-vcs-count">{staged.length}</span>
            </div>
            <div className="ext-vcs-file-list">
              {staged.map((f) => (
                <FileRow key={f.path} file={f} region="staged" {...rowProps} />
              ))}
            </div>
          </div>
        )}
        <div className="ext-vcs-section">
          <div className="ext-vcs-section-title">
            Changes
            <span className="ext-vcs-count">{unstaged.length}</span>
          </div>
          {unstaged.length === 0
            ? <div className="ext-vcs-muted">No unstaged changes.</div>
            : (
              <div className="ext-vcs-file-list">
                {unstaged.map((f) => (
                  <FileRow key={f.path} file={f} region="worktree" {...rowProps} />
                ))}
              </div>
            )}
        </div>
      </>
    );
  }

  return (
    <div className="ext-vcs-section">
      <div className="ext-vcs-section-title">
        Changes
        <span className="ext-vcs-count">{status.files.length}</span>
      </div>
      {status.clean
        ? <div className="ext-vcs-muted">No local changes.</div>
        : (
          <div className="ext-vcs-file-list">
            {status.files.map((f) => (
              <FileRow key={f.path} file={f} region="all" {...rowProps} />
            ))}
          </div>
        )}
    </div>
  );
}

function LogSection({
  log, selectedRev, onSelectCommit,
}: { log: LogResult | null; selectedRev: string | null; onSelectCommit: (rev: string) => void }) {
  return (
    <div className="ext-vcs-section">
      <div className="ext-vcs-section-title">
        Recent
        {log && log.ok && <span className="ext-vcs-count">{log.commits.length}</span>}
      </div>
      {!log && <div className="ext-vcs-muted">Loading…</div>}
      {log && !log.ok && <div className="ext-vcs-error">{log.error || 'error'}</div>}
      {log && log.ok && log.commits.length === 0 && <div className="ext-vcs-muted">No commits.</div>}
      {log && log.ok && log.commits.length > 0 && (
        <div className="ext-vcs-commit-list">
          {log.commits.map((c) => (
            <button
              key={c.hash}
              className={`ext-vcs-commit-row ${selectedRev === c.hash ? 'active' : ''}`}
              onClick={() => onSelectCommit(c.hash)}
              title={`${c.short_hash} · ${c.subject}\n${c.author_name}`}
            >
              <span className="ext-vcs-commit-meta">{relativeTime(c.author_ts)}</span>
              <span className="ext-vcs-commit-subject">{c.subject || '(no message)'}</span>
              <span className="ext-vcs-commit-hash">{c.short_hash}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The diff pane shows one of two things, by selection kind:
//   • a working-tree file → the shared Monaco side-by-side diff (committed
//     version vs the live worktree file), read-only.
//   • a commit → that commit's whole unified-text diff.
function DiffPane({
  selection, commitDiff, fileDiff, loading,
}: {
  selection: Selection | null;
  commitDiff: DiffResult | null;
  fileDiff: FileDiffResult | null;
  loading: boolean;
}) {
  if (!selection) {
    return <div className="ext-vcs-empty">Select a changed file or a commit to see its diff.</div>;
  }

  if (selection.kind === 'worktree') {
    if (loading && !fileDiff) return <div className="ext-vcs-empty">Loading diff…</div>;
    if (!fileDiff) return <div className="ext-vcs-empty">No diff.</div>;
    if (!fileDiff.ok) return <div className="ext-vcs-error ext-vcs-error-block">{fileDiff.error || 'error'}</div>;
    if (fileDiff.original === fileDiff.modified) {
      return <div className="ext-vcs-empty">No textual changes (binary, or identical).</div>;
    }
    return (
      <div className="ext-vcs-monaco-diff">
        <MonacoDiff
          original={fileDiff.original}
          modified={fileDiff.modified}
          language={fileDiff.language}
        />
      </div>
    );
  }

  // Commit selection → unified text.
  if (loading && !commitDiff) return <div className="ext-vcs-empty">Loading diff…</div>;
  if (!commitDiff) return <div className="ext-vcs-empty">No diff.</div>;
  if (!commitDiff.ok) return <div className="ext-vcs-error ext-vcs-error-block">{commitDiff.error || 'error'}</div>;
  if (!commitDiff.unified.trim()) {
    return <div className="ext-vcs-empty">No textual changes (binary, or no diff).</div>;
  }
  return <UnifiedDiff text={commitDiff.unified} />;
}

// Colorized unified-diff renderer (whole-commit view). Each line is classed
// by its first char: +/added, -/removed, @ hunk header, diff/index/file
// headers muted.
function UnifiedDiff({ text }: { text: string }) {
  const lines = useMemo(() => text.split('\n'), [text]);
  return (
    <pre className="ext-vcs-diff">
      {lines.map((line, i) => (
        <div key={i} className={`ext-vcs-diff-line ${diffLineClass(line)}`}>
          {line || ' '}
        </div>
      ))}
    </pre>
  );
}

function diffLineClass(line: string): string {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+++') || line.startsWith('---')) return 'fileh';
  if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('rename ')) return 'meta';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return '';
}

function FileBadge({ letter }: { letter: string }) {
  return (
    <span className={`ext-vcs-badge tone-${badgeTone(letter)}`} title={describeLetter(letter)}>
      {letter}
    </span>
  );
}

function badgeTone(letter: string): string {
  switch (letter) {
    case 'M': return 'modified';
    case 'A': return 'added';
    case 'D': case 'R': return 'deleted';
    case 'C': return 'copied';
    case 'U': return 'conflict';
    case '?': return 'untracked';
    default: return 'other';
  }
}
function describeLetter(letter: string): string {
  switch (letter) {
    case 'M': return 'modified';
    case 'A': return 'added';
    case 'D': return 'deleted';
    case 'R': return 'removed/renamed';
    case 'C': return 'copied';
    case 'U': return 'conflict';
    case '?': return 'untracked';
    default: return letter;
  }
}

function relativeTime(unixSeconds: number): string {
  if (!unixSeconds) return '';
  const dt = Date.now() / 1000 - unixSeconds;
  if (dt < 60) return 'now';
  if (dt < 3600) return `${Math.round(dt / 60)}m`;
  if (dt < 48 * 3600) return `${Math.round(dt / 3600)}h`;
  if (dt < 86400 * 7) return `${Math.round(dt / 86400)}d`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}
