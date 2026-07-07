import type { MachineRegistry, ExecResult } from '../../types';
import type {
  StatusFile, LogCommit,
  StatusResult, LogResult, DiffResult, FileDiffResult, ActionResult,
} from './types';
import { LOG_TEMPLATE, inferLanguage } from './constants';

// The repository client the source-control view drives. Each call runs the
// hg binary in the slot's directory via MachineRegistry.exec and parses
// the output. Every method is robust to non-repos / errors: it resolves to
// { ok:false, ... } (the failures carry a stable `code` — `no_dir`,
// `not_a_repo`) rather than throwing, so a bad call can't wedge the view.
//
// Mercurial has NO staging model — `hg commit` records every tracked change
// directly — so stage/unstage/stageAll are not part of this VCS (the view
// only invokes them when `hasStaging` is true, which it never is for hg).
export interface VcsClient {
  status(): Promise<StatusResult>;
  log(limit: number): Promise<LogResult>;
  // With `rev`: that commit. Without: the working tree vs the parent.
  diff(opts: { rev?: string; file?: string }): Promise<DiffResult>;
  // The two sides of one file's working change, for the Monaco side-by-side.
  fileDiff(file: string): Promise<FileDiffResult>;
  stage(file: string): Promise<ActionResult>;
  unstage(file: string): Promise<ActionResult>;
  stageAll(): Promise<ActionResult>;
  // `addRemove` passes `-A` so new files are added and missing files removed.
  commit(opts: { message: string; addRemove?: boolean }): Promise<ActionResult>;
  discard(file: string): Promise<ActionResult>;
  push(): Promise<ActionResult>;
}

// `hg status` lines are `<code> <path>` where code is M/A/R/!/?/C/I. Map to
// the same single letter the badge expects (R = removed in hg, which the
// badge treats as a delete tone; ! = missing → D).
function parseStatus(stdout: string): StatusFile[] {
  const files: StatusFile[] = [];
  for (const raw of stdout.split('\n')) {
    if (!raw || raw.length < 3) continue;
    const code = raw[0];
    const path = raw.slice(2);
    if (!path) continue;
    const letter = code === '?' ? '?' : code === '!' ? 'D' : code;
    files.push({ path, index: ' ', worktree: letter });
  }
  return files;
}

function parseLog(stdout: string): LogCommit[] {
  const commits: LogCommit[] = [];
  for (const raw of stdout.split('\n')) {
    if (!raw) continue;
    const [hash, short, an, hgdate, ...subjectParts] = raw.split('\t');
    if (!hash) continue;
    // {date|hgdate} is "<unixts> <tzoffset>"; take the seconds field.
    const ts = Number((hgdate || '').split(' ')[0]) || 0;
    commits.push({
      hash,
      short_hash: short || hash.slice(0, 12),
      author_name: an || '',
      author_ts: ts,
      subject: subjectParts.join('\t'),
    });
  }
  return commits;
}

const NO_DIR: ActionResult = { ok: false, code: 'no_dir', error: 'This slot has no directory' };
const NOT_A_REPO: ActionResult = { ok: false, code: 'not_a_repo', error: 'Not a Mercurial repository' };
const NO_HG: ActionResult = { ok: false, code: 'no_hg', error: 'Mercurial (hg) is not installed on this machine' };

// `hg root` couldn't even LAUNCH the binary (vs. ran and reported a non-zero
// exit). The host's MachineRegistry.exec sets `error` (and leaves `exitCode`
// undefined) only on a transport/launch failure — a "command not found"
// (ENOENT) is the common case when hg isn't installed on the slot's machine,
// which the panel must NOT mislabel as "not a repository". A normal non-zero
// exit (a real non-repo: "abort: no repository found") carries an exitCode and
// stderr instead, so it falls through to not_a_repo.
function isLaunchFailure(res: ExecResult): boolean {
  return res.exitCode == null && /\bENOENT\b|not found|no such file|spawn|cannot run|executable/i.test(res.error || '');
}

// hg's real diagnostic from a failed exec, or '' when the failure carries no
// message of its own. hg writes diagnostics to stderr; the host surfaces a
// failed process's stderr as `error` (its normalised stderr field comes back
// empty), and when stderr was empty too it fills `error` with the generic
// "Command failed: <cmd>" wrapper. That wrapper means "exited non-zero, said
// nothing" — NOT a real error to show — so it's filtered out. (A process's
// stdout is dropped entirely on a non-zero exit, so it can't be relied on.)
function hgDiagnostic(res: ExecResult): string {
  const stderr = (res.stderr || '').trim();
  if (stderr) return stderr;
  const err = (res.error || '').trim();
  if (!err || /^command failed:/i.test(err)) return '';
  return err;
}

export function createVcsClient(machines: MachineRegistry, machine: string, slotDir: string): VcsClient {
  const run = (args: string[], cwd: string) => machines.exec(machine, { command: 'hg', args, cwd });

  // Confirm the slot's directory is a repo (`hg root`), then hand back a
  // bound runner. Returns a discriminated result so callers stay flat.
  const withRepo = async (): Promise<
    { ok: true; hg: (args: string[]) => Promise<ExecResult>; directory: string }
    | { ok: false; error: string; code?: string }
  > => {
    const directory = slotDir;
    if (!directory) return NO_DIR as { ok: false; error: string; code?: string };
    const hg = (args: string[]) => run(args, directory);
    const root = await hg(['root']);
    if (!root.ok) {
      return (isLaunchFailure(root) ? NO_HG : NOT_A_REPO) as { ok: false; error: string; code?: string };
    }
    return { ok: true, hg, directory };
  };

  return {
    async status() {
      const repo = await withRepo();
      if (!repo.ok) return repo as StatusResult;
      const branch = await repo.hg(['branch']);
      const status = await repo.hg(['status']);
      if (!status.ok) return { ok: false, error: hgDiagnostic(status) || 'could not read status' };
      const files = parseStatus(status.stdout);
      return {
        ok: true,
        directory: repo.directory,
        branch: branch.ok ? branch.stdout.trim() : null,
        detached: false,
        files,
        clean: files.length === 0,
      };
    },

    async log(limit) {
      const repo = await withRepo();
      if (!repo.ok) return repo as LogResult;
      const n = Math.max(1, Math.min(200, limit ?? 30));
      const res = await repo.hg(['log', '-l', String(n), '--template', LOG_TEMPLATE]);
      if (!res.ok) return { ok: false, error: hgDiagnostic(res) || 'could not read log' };
      return { ok: true, commits: parseLog(res.stdout) };
    },

    async diff({ rev, file }) {
      const repo = await withRepo();
      if (!repo.ok) return repo as DiffResult;
      const args = ['diff'];
      if (rev) { args.push('-c', rev); }
      if (file) { args.push(file); }
      const res = await repo.hg(args);
      if (!res.ok && !res.stdout) {
        return { ok: false, error: (res.stderr || res.error || '').trim() };
      }
      return { ok: true, file: file ?? null, unified: res.stdout };
    },

    // `original` is the parent revision's version (`hg cat -r . <file>`);
    // `modified` is the live working-tree file (plain `cat` — `hg cat` reads
    // revisions, never the worktree, so routing it through run() returned the
    // parent again and every diff read as unchanged). An added file isn't in
    // the parent → original ''. A deleted file has no worktree file →
    // modified ''. Both reads exit non-zero in those cases, treated as the
    // empty side, not an error.
    async fileDiff(file) {
      if (!file) return { ok: false, error: 'no file' };
      const repo = await withRepo();
      if (!repo.ok) return repo as FileDiffResult;
      const parent = await repo.hg(['cat', '-r', '.', file]);
      const original = parent.ok ? parent.stdout : '';
      const work = await machines.exec(machine, { command: 'cat', args: ['--', file], cwd: repo.directory });
      const modified = work.ok ? work.stdout : '';
      return { ok: true, file, original, modified, language: inferLanguage(file) };
    },

    // hg has no staging model; the view never calls these (hasStaging=false).
    async stage() { return { ok: false, error: 'Mercurial has no staging area' }; },
    async unstage() { return { ok: false, error: 'Mercurial has no staging area' }; },
    async stageAll() { return { ok: false, error: 'Mercurial has no staging area' }; },

    // Commit tracked changes (`hg commit -m <message>`). With addRemove, pass
    // `-A` so new (untracked) files are added and missing files removed as
    // part of the commit. Rejects an empty message before touching hg; a
    // failed commit (nothing changed, hook rejection) returns { ok:false }
    // with hg's own message.
    async commit({ message, addRemove }) {
      const msg = (message || '').trim();
      if (!msg) return { ok: false, error: 'commit message is required' };
      const repo = await withRepo();
      if (!repo.ok) return repo;
      const args = ['commit'];
      if (addRemove) args.push('-A');
      args.push('-m', msg);
      const res = await repo.hg(args);
      if (!res.ok) {
        // "nothing changed" exits non-zero with that line on the host-dropped
        // stdout (empty stderr) → hgDiagnostic() is '' → report it plainly
        // rather than leaking the generic "Command failed: hg commit -m …".
        const diag = hgDiagnostic(res);
        return { ok: false, error: diag || 'Nothing to commit.' };
      }
      return { ok: true };
    },

    // DESTRUCTIVE: discard a file's working-tree change (`hg revert <file>`).
    // `--no-backup` skips the `.orig` file hg would otherwise leave behind.
    // The parent revision is not moved.
    async discard(file) {
      if (!file) return { ok: false, error: 'no file' };
      const repo = await withRepo();
      if (!repo.ok) return repo;
      const res = await repo.hg(['revert', '--no-backup', file]);
      if (!res.ok) return { ok: false, error: hgDiagnostic(res) || 'revert failed' };
      return { ok: true };
    },

    // Push to the default path (`hg push`). hg exits 1 with "no changes found"
    // when there's nothing to push — that's success for us, not an error. The
    // host drops a failed process's STDOUT (where that message goes), so it
    // can't be matched directly; instead a non-zero exit with no real
    // diagnostic (hgDiagnostic() === '') IS the nothing-to-push case. A genuine
    // failure (no default path, auth, offline, new remote head) writes to
    // stderr → hgDiagnostic() surfaces hg's own message.
    async push() {
      const repo = await withRepo();
      if (!repo.ok) return repo;
      const res = await repo.hg(['push']);
      if (!res.ok) {
        const diag = hgDiagnostic(res);
        if (!diag || /no changes found/i.test(diag)) return { ok: true, message: 'No changes to push.' };
        return { ok: false, error: diag };
      }
      const summary = (res.stdout || '').trim().split('\n').pop() || 'Pushed.';
      return { ok: true, message: summary };
    },
  };
}
