import type {
  WorkspaceProviderProvider,
  WorkspaceProvider,
  MachineRegistry,
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

function createMercurialProvider(machines: MachineRegistry): WorkspaceProvider {
  return {
    id: 'mercurial',
    slots: { default: 2, unbounded: true, note: 'Mercurial v1 runs in place — concurrent slots share the working directory, so keep this low.' },
    async begin(ctx) {
      const d = dir(ctx.workspace);
      return { slotDir: d, canonicalDir: d, branch: null, commit: null, isolated: false };
    },
    async end(ctx) {
      if (ctx.keepDirty) return;
      const hg = (args: string[]) => machines.exec(ctx.workspace.machine, { command: 'hg', args, cwd: dir(ctx.workspace) });
      const st = await hg(['status']);
      if (st.ok && st.stdout.trim()) {
        await hg(['commit', '-A', '-m', 'Frontier: reservation closed (uncommitted work auto-saved)']);
      }
    },
  };
}

export function register(workspaceProvider: WorkspaceProviderProvider): void {
  const wp = workspaceProvider.version(1);
  wp.register(createMercurialProvider(wp.services.machines));
}
