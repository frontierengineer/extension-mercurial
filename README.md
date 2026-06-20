# Mercurial

Mercurial source control for Frontier — for teams who work on `hg`.

Mercurial adds Mercurial as a first-class workspace kind: point a workspace at an
`hg` repository on one of your machines and agents run against it, with a
source-control panel that shows each slot's changes, diffs, and log the same way
the built-in Git panel does. Installing the extension makes **Mercurial** appear
in the workspace provider picker; removing it takes the provider away again — the
core itself carries no VCS knowledge.

<!-- screenshot: the Mercurial source-control panel showing a slot's changes, a diff, and the log -->

## Features

- A **Mercurial workspace provider** — create workspaces backed by an `hg` repo
- A source-control panel: per-slot working-copy changes, file diffs, and the log
- Runs in place and auto-commits on reservation release, so nothing is lost
- Reuses the same diff viewer and panel UX as the built-in Git extension

## How it differs from Git

Mercurial **runs in place** rather than from a worktree pool. The provider's
`begin`/`end` operate on the workspace's single directory, committing on release.
Because slots **share the directory**, concurrency is limited: the slot cap
defaults to **2** (user-settable, but keep it low — there is no per-slot
isolation, unlike Git's worktrees). Everything else mirrors Git: it owns the
working directory and VCS at reservation boundaries, and the source-control panel
shows a slot's changes, diffs, and log keyed by reservation.

`hg` must be installed on the machine the workspace lives on.

## Install

Install Mercurial from the **Extensions → Marketplace** tab in Frontier: find
Mercurial, click Install, and the Mercurial workspace provider and source-control
panel become available (Frontier verifies the download before installing). No
configuration needed.
