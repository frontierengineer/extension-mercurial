# Mercurial (deprecated)

This extension has been retired and its source removed.

The Frontier platform's workspace model is built on isolated, disposable
working copies (one git worktree per reservation). Mercurial ran in place on
the repository's own working directory — every reservation shared one
checkout, with no isolation between concurrent agents and no way to treat a
slot as disposable. In-place workspaces are no longer supported, so this
extension has no correct way to exist.

Git worktree workspaces are the supported model. For Mercurial repositories,
work from a git mirror (for example `git-cinnabar` or `hg-git`) and point a
git workspace at it.
