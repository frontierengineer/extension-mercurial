import type {
  WorkerProvider,
  WorkerV1,
  WorkspaceProvider,
  Workspace,
} from '../../types';

// The mercurial workspace provider. Lives in the mercurial extension (remove it
// and the 'mercurial' option disappears). v1 runs in place on the canonical dir
// and relies on the agent committing — hg worktrees/shares are fragile past ~3,
// so git and hg deliberately differ; `hg share`-based lanes are a follow-up. A
// closure commit on release best-effort saves anything left uncommitted.

function dir(workspace: Workspace): string {
  const d = workspace.config?.directory;
  return typeof d === 'string' ? d : '';
}

// An hg remote failure that looks like a CREDENTIAL problem (vs a network/other
// error) — drives the "needs authentication" flag checkAuth reports. Report-only:
// we never inject credentials, only recognise the shape of an auth failure.
const AUTH_FAIL = /authentication|could not read username|permission denied|access denied|terminal prompts disabled|authorization failed|403|fatal: could not read/i;

function createMercurialProvider(services: WorkerV1['services']): WorkspaceProvider {
  return {
    id: 'mercurial',
    // begin() runs in place on the canonical directory with no checkout, so there
    // is no slow provisioning phase to narrate — the reserve toast goes straight
    // to "Ready".
    provisioning: null,
    slots: { default: 2, fixed: null, unbounded: true, unlimited: null, note: 'Mercurial v1 runs in place — concurrent slots share the working directory, so keep this low.' },
    async begin(context) {
      const d = dir(context.workspace);
      return { slotDir: d, canonicalDir: d, branch: null, commit: null, isolated: false };
    },
    async end(context) {
      if (context.keepDirty) return;
      // The provider runs on the workspace's own worker daemon, so it reaches hg
      // through the daemon-local exec — no machine to thread.
      const hg = (args: string[]) => services.execute({ command: 'hg', args, cwd: dir(context.workspace), environment: null, timeoutMs: null });
      const st = await hg(['status']);
      if (st.ok && st.stdout.trim()) {
        await hg(['commit', '-A', '-m', 'Frontier: reservation closed (uncommitted work auto-saved)']);
      }
    },

    // Create-form probe: is `directory` a Mercurial repo? The core already
    // confirmed it exists; we only answer "is it hg?". The hg knowledge lives
    // here, not in core.
    async checkDirectory(context) {
      const r = await services.execute({ command: 'hg', args: ['-R', context.directory, 'root'], cwd: null, environment: null, timeoutMs: null });
      return { repo: r.ok, kind: r.ok ? 'hg' : undefined };
    },

    // Credential checkoff: can this workspace reach its default remote? `hg
    // identify default` against the checkout. REPORT-ONLY — we never supply
    // credentials. A repo with no directory (nothing to probe) trivially passes.
    async checkAuth(context) {
      const directory = dir(context.workspace);
      if (!directory) return { ok: true };
      const r = await services.execute({ command: 'hg', args: ['-R', directory, 'identify', 'default'], cwd: null, environment: null, timeoutMs: 30_000 });
      if (r.ok) return { ok: true };
      const msg = `${r.stderr || r.error || ''}`.trim();
      return { ok: false, needsAuth: AUTH_FAIL.test(msg), detail: msg.split('\n')[0]?.slice(0, 200) };
    },
  };
}

export function register(provider: WorkerProvider): void {
  const w = provider.version(1);
  w.workspace.register(createMercurialProvider(w.services));
}
