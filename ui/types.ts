// One working-tree entry. `index` is the staged status letter (git XY: X),
// `worktree` the unstaged letter (git XY: Y). For Mercurial every change
// maps onto `worktree` and `index` stays ' ' (no staging model).
export interface StatusFile {
  path: string;
  index: string;
  worktree: string;
  rename_from?: string;
}

export interface LogCommit {
  hash: string;
  short_hash: string;
  author_name: string;
  author_ts: number;
  subject: string;
}

// The error fields live on a shared base carried by every result shape (not
// a separate union arm) so `.ok` still discriminates at runtime while
// `.code` / `.error` stay type-accessible without relying on control-flow
// narrowing — the UI tsconfig runs with strict off, where boolean-literal
// discriminated-union narrowing doesn't apply. `code` is a stable tag
// (`no_dir`, `not_a_repo`) so one canonical message renders per situation.
export interface VcsResultBase {
  ok: boolean;
  code?: string;
  error?: string;
}
export interface ResultErr extends VcsResultBase { ok: false }

export interface StatusOk extends VcsResultBase {
  ok: true;
  directory: string;
  branch: string | null;
  detached: boolean;
  files: StatusFile[];
  clean: boolean;
}
export type StatusResult = StatusOk | ResultErr;

export interface LogOk extends VcsResultBase { ok: true; commits: LogCommit[] }
export type LogResult = LogOk | ResultErr;

// Whole-commit view: raw unified text.
export interface DiffOk extends VcsResultBase { ok: true; file: string | null; unified: string }
export type DiffResult = DiffOk | ResultErr;

// Per-file working change: the two sides for the Monaco diff.
export interface FileDiffOk extends VcsResultBase {
  ok: true;
  file: string;
  original: string;
  modified: string;
  language?: string;
}
export type FileDiffResult = FileDiffOk | ResultErr;

// A plain write-op acknowledgement ({ ok } + optional error / message).
export interface ActionResult extends VcsResultBase { message?: string }
