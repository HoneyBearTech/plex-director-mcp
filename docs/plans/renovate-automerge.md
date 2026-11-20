# Plan: renovate-automerge

## What Sean asked for

"Ensure that all my repos that have renovate allow the renovate PRs to auto
merge", on the homelab-atlas model: every update, majors included, merges once
all checks pass, after a 3-day wait.

## What we found

- Renovate's config sets `automerge: false`.
- Renovate hasn't run here yet (no dashboard issue, no pull requests); its
  access to this repo needs checking in the owner's settings. This change takes
  effect once it runs.
- Does a merge deploy? A merge publishes the `latest` image; no server follows
  it.

## What we'll change

1. `renovate.json`: turn on auto-merge for every update, majors included, the
   way homelab-atlas does it: `automerge: true`, squash merges,
   `platformAutomerge: true` (GitHub merges as soon as the required checks
   pass); new versions wait 3 days before they are proposed
   (`minimumReleaseAge`, with `timestamp-optional` so a registry without release
   dates doesn't hold an update forever); security fixes and image rebuilds
   (digest updates) skip the wait. Check: Renovate's config validator passes,
   and a local Renovate dry run shows auto-merge on for ordinary updates and off
   for the exceptions below.
2. Docs that say updates are merged by hand, or by Dependabot: CONTRIBUTING.md,
   GOVERNANCE.md, docs/dependencies.md, the repo's guidelines. Say instead that
   Renovate merges updates once every check passes, and name the exceptions.
3. Record the job in `docs/` (pass map, decisions log, roadmap; created if
   missing).

## Kept manual

- Node.js majors stay switched off, as today.

Each exception is an earlier decision by the owner; to drop one, say so on this
pull request.

## Who's on it

Engineer, Security Officer, Auditor.

## Risks

- The `latest` image changes with each merged update; tagged releases are
  unaffected.
- Renovate's schedule is unchanged, so updates still arrive once a week.

## Out of scope

Repository settings and branch rules (only the owner changes those), and the
workflows under `.github/workflows` (a leftover Dependabot auto-merge workflow
stays as it is).

