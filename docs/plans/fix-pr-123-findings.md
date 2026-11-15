# Plan: fix the review findings on #123

Job `fix-pr-123-findings`. This branch sits on top of #123 (adding series to Sonarr) and its pull request
goes into the branch of #123, not into `main`.

## What the owner asked for

"Team fixes it now": fix what the [review of #123](https://github.com/HoneyBearTech/plex-director-mcp/pull/123#issuecomment-6888914027)
found, as a pull request against #123's branch.

## What we found

- The confirm-before-adding design holds: a preview is required, its id is random and single-use, and the
  dashboard chat cannot reach either tool.
- More is sent to Sonarr than the preview shows: the whole lookup record is posted back, and the seasons
  the preview counted are not compared again at confirm time.
- The assurance case counts the preview's id as a defence against injected text, although the id goes back
  to the same model. A stored preview never expires.
- Smaller items: an add whose outcome is not known is reported as failed; a show listed twice can be chosen
  twice; a failed search wipes the current preview; two settings are not checked when saved; lookup text is
  not bounded; a few things can go wrong when two actions happen at the same moment.

## What we'll change

Each step has a test, or a check, that shows it is done. Only `confirm_selected_series` with a `previewId`
sends anything but GET requests, before and after.

1. **Only named fields are sent to Sonarr.** The add posts a fixed list: the show's TVDB id, title, title
   slug, year, images and seasons from Sonarr's lookup, plus the values the preview showed (quality profile,
   root folder, series type, monitoring, search). Nothing else from the lookup record goes back, in
   particular no `path`, `id` or `tags`. *Check:* a test pins the exact body, with a lookup record that
   carries extra fields.
2. **Seasons are part of what the preview shows.** The preview stores each show's seasons; at confirm time
   any difference (a season more or fewer, a monitored flag changed) adds nothing and returns a new preview,
   like every other difference. *Check:* tests for a season added and a flag changed between the two.
3. **A preview lasts 15 minutes.** After that its id adds nothing and the reply asks for a new preview. The
   preview says so. *Check:* a test with the clock moved.
4. **The docs say what the preview is and is not.** `docs/assurance-case.md` and `docs/security.md`: the
   preview makes sure that what is added is what was shown; the person's approval in their MCP client is
   what stops injected text, so "always allow" should not be set for `confirm_selected_series` or
   `confirm_selected_choices`; the residual risk is named. The user guide carries the same advice.
   *Check:* the security review reads the sentences against the code.
5. **An outcome that is not known is not called a failure.** When Sonarr answers with an error, the show
   "failed" with Sonarr's message, as today. When no answer comes back, the line says the outcome is not
   known, that the show may have been added, and how to find out. *Check:* a test where the fake accepts the
   show and then drops the connection.
6. **One row per show.** A TVDB id that the lookup returns twice appears once in the grid and once in a
   preview. *Check:* a test.
7. **A failed search loses nothing.** The grid and the current preview are replaced only once the lookup
   has answered, in one step, and each grid number exists once. A preview worked out from a grid that has
   since been replaced is not stored. *Check:* tests for a failed lookup, and for two searches and a late
   preview overlapping.
8. **One confirmation talks to one Sonarr.** If the Sonarr address changes while shows are being added, the
   remaining shows are not attempted and the reply says so. The key that was in use when the call started is
   removed from replies as well as the one saved now. *Check:* tests that change the settings between two
   POSTs.
9. **Settings are checked when saved.** A series type or monitor option outside the allowed values is
   refused by the settings API with a message that lists them. *Check:* a test on the route.
10. **Lookup text is bounded.** Title and network are cut to 200 characters where they are stored and
    shown; status is escaped like the other cells. *Check:* a test.
11. **Missing tests added**: two confirmations of one id at the same moment add once; Sonarr unreachable at
    preview stores nothing.

All of: `npm run check`, `npx tsc --noEmit`, `npm run test:coverage`, `npm audit --audit-level=high`,
`npm run build:skill` (no stale skill file), and in `web/` `npx tsc --noEmit` and `npm run build`, must
pass. `test/confirm.test.ts` (adding movies) must pass unchanged.

## Who's on it

An engineer makes the change. QA, a security review and an independent code review check it; the lead runs
the full checks and verifies each finding.

## Risks

- **Nothing here can be tried against a live Sonarr.** Step 1 changes what is posted: if a real Sonarr needs
  a field that is no longer sent, it will refuse the add with a message and add nothing. The owner should
  try an add on a real Sonarr before #123 is merged.
- A 15-minute life means a preview left open over lunch has to be asked for again.
- The two new tables change shape. They only exist on this unreleased branch, so no migration is written.

## Out of scope

- Whether Plex Director should add series at all: the roadmap on `main` lists it as undecided, and that is
  the owner's decision when merging #123.
- Finding a show again by TVDB id instead of by title: it needs a live Sonarr to confirm the lookup accepts
  it.
- A stored record of what each confirmation did.
- Adding movies: `confirm_selected_choices` and its tests are not changed.
- Nothing under `.github/`; no dependency changes; the tool count stays at 29 and the chat's at 13.
