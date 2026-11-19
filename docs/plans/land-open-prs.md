# Plan: land the open pull requests in one combined pull request

**What Sean asked for:** "work all open PRs in plex-director-mcp", choosing "option 1, include #123": one
combined pull request that he merges once, with #123 (adding TV series) included.

## What we found

- **#118 to #123** (the dependency audit fix, Renovate, the roadmap line and the three TV features) are each
  approved by the owner and green. They are stacked: #119, #120 and #121 are cut from #118, #122 from #121,
  #123 from #122.
- **#124, #125 and #126** hold the review fixes for #121, #122 and #123. Each targets its feature's branch, not
  `main`, so the full CI workflow (typecheck, audit, build and smoke test, CodeQL) has never run on the fixed
  code. None of them is approved on GitHub yet.
- **Merging them in order clashes twice**: #125 and #126 each add entries to `CHANGELOG.md`,
  `docs/pass-map.md` and `docs/decisions-log.md` that #124 (or #125) also adds to. Nothing else clashes.
- **#127 to #130** (Dependabot) fail only at `npm audit --audit-level=high`, because `main` itself still has
  the two high advisories that #118 fixes. #119 replaces Dependabot with Renovate, which will propose the same
  updates.

## What we'll change

1. **Build one branch, `team/land-open-prs`, from `main`**, merging the open pull requests in this order:
   #118, #119, #120, #121, #124, #122, #125, #123, #126. Each is a real merge (a merge commit, no squash, no
   rebase), so every original commit stays exactly as it was reviewed.
   *Checked by:* each pull request's head commit is an ancestor of the branch; the branch's changes equal the
   nine pull requests' changes plus the clash resolutions and the notes.
2. **Resolve the two clashes by keeping every entry from both sides** in `CHANGELOG.md`,
   `docs/pass-map.md` and `docs/decisions-log.md`, in each file's existing order (newest first where the file
   says so). No code is changed to resolve them.
   *Checked by:* no conflict markers anywhere; every entry from each side is present once.
3. **Run every check CI runs, on the combined branch**: `npm ci`, `npm run check`, `npx tsc --noEmit` (root
   and `web/`), `npm run test:coverage`, `npm audit --audit-level=high` (root and `web/`),
   `npm run build:skill` with no change, and the `web/` build. If something fails only because two pull
   requests meet (for example a pinned tool count), the smallest fix goes in as its own signed-off commit.
   *Checked by:* all commands exit 0; then the full CI workflow and CodeQL pass on the pull request.
4. **Fresh reviews of the combined branch**: QA, two independent security reviews and a code audit, focused
   on the parts that never had the full checks (the fixes of #124 to #126) and on where the pull requests meet.
   *Checked by:* their reports, triaged by the team lead; must-fix items are fixed and re-checked.
5. **Record the job** in `docs/pass-map.md`, `docs/decisions-log.md` and `docs/roadmap.md`.
6. **After the owner merges** the combined pull request with **"Create a merge commit"** (not squash: squash
   would not let GitHub mark the originals as merged):
   - check that GitHub shows #118 to #123 as merged;
   - close #124, #125 and #126 with a comment that their changes reached `main` through the combined pull
     request;
   - close the Dependabot pull requests #127 to #130 with a comment that Renovate now proposes updates; its
     scheduled run (Monday mornings) proposes the same updates again.
   *Checked by:* no open pull request is left from this list.

## Who's on it

Team lead, Engineer, QA, Security Officer, a second security reviewer, a code auditor, a plan check and a
plain-English check of what the owner reads.

## Risks

- **One large pull request** (about 6,500 changed lines in 50 files). Every part except the merge resolutions was already
  reviewed on its own pull request; the new reviews focus on the fixes and the joins.
- **Merge method matters.** Squash or rebase would still put the right code on `main`, but GitHub would not
  mark #118 to #123 as merged; they would then be closed by hand with a comment.
- **Dependency updates stop merging on their own** once Renovate replaces Dependabot (as approved on #119).
  Updates from Dependabot's four open pull requests wait for Renovate's next scheduled run.
- **Nothing is tried against a live Plex, Sonarr or Tautulli.** #123 adds the first tools that add series to
  Sonarr (MCP clients only, preview then confirm), as approved on #123.

## Out of scope

- The workflow `dependabot-auto-merge.yml` and the setting "Dependabot security updates" (both the owner's).
- Out-of-date tool counts in `docs/user-guide/README.md` and `CONTRIBUTING.md`, the guidelines' "lint not set
  up yet" line, and the shared Sonarr client still following redirects on read requests: noted on the roadmap
  for later jobs.
- Any new feature or behaviour change beyond the nine pull requests.
