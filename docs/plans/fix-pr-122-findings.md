# Plan: fix the review findings on #122

Job `fix-pr-122-findings`. This branch sits on top of #122 (`find_series_by_size`) and its pull request
goes into the branch of #122, not into `main`.

## What the owner asked for

"Team fixes it now": fix what the [review of #122](https://github.com/HoneyBearTech/plex-director-mcp/pull/122#issuecomment-6887779876)
found, as a small pull request against #122's branch.

## What we found

- A show can be listed as "not watched" although it was watched: when one Plex copy of it has an old watch
  date and another copy, or Tautulli, shows watching with no date, the old date wins.
- Five places in the docs still say every outgoing request has a 10-second timeout. The Tautulli call of
  this tool has 30 seconds.
- Smaller items: a Plex library of more than 5,000 shows is read incompletely without saying so; shows that
  are in Plex but could not be matched are called "not found in Plex"; a Tautulli play time in the wrong
  unit is not noticed; a Sonarr answer that is not a list is not caught.

## What we'll change

Each step has a test, or a check, that shows it is done.

1. **Watching with no date is never outweighed by an old date.** A show goes with the shows that "can't be
   judged" (left out and counted) when any Plex copy of it has watched episodes and no watch date, or when
   Tautulli reports plays for it without a usable play time. This is decided inside the report
   (`src/tools/seriesSize.ts`); the watch helpers that `search_plex_library` shares are not changed.
   *Check:* tests for both cases, each failing on the current code.
2. **A Tautulli play time that cannot be a time in seconds** (one that lies in the future, as a time in
   milliseconds would) counts as "no usable play time", so step 1 applies to it. *Check:* a test with play
   times in milliseconds: the shows are left out as "can't be judged", not dropped as "played recently".
3. **Plex libraries are read completely.** The report reads a library page by page until it has every show
   Plex says the library holds; if that cannot be established, the watch part is an error that says so,
   never a list built from part of a library. *Check:* a test whose fake Plex honours the page size, with
   more shows than one page.
4. **Truthful wording.** Sonarr shows with no Plex match are described as "could not be matched to a Plex
   show", in the reply and in the docs. A show whose libraries include one Tautulli could not answer for is
   marked with that reason. *Check:* tests on the reply text.
5. **A Sonarr answer that is not a list of series** is the "Failed to check Sonarr" error, not an
   exception. *Check:* a test with a text answer and HTTP 200.
6. **Docs say what the code does.** `docs/security.md`, `docs/assurance-case.md`, `docs/architecture.md`
   and `docs/interfaces.md`: the 10-second timeout has one exception, the Tautulli library list read by
   this tool (30 seconds, at most one per show library at a time). `docs/security.md` and
   `docs/assurance-case.md` say that the chat's new tool passes per-show sizes and watch dates to the
   service that answers the chat. The changelog entry matches the reply. *Check:* a search of `docs/` for
   "10-second" finds no statement without the exception.
7. **Missing tests added**: a show with files and a size of 0, a show with no statistics, a fractional
   `notWatchedInYears`, two Plex shows matched to one Sonarr series.

All of: `npm run check`, `npx tsc --noEmit`, `npm run test:coverage`, `npm audit --audit-level=high` and
`npm run build:skill` (no change to the skill file) must pass.

## Who's on it

An engineer makes the change. A security review and an independent code review check it; the lead runs
the full checks and verifies each finding.

## Risks

- #123 is stacked on #122 and will need this change too once it is merged.
- Nothing here can be tried against a live Plex, Sonarr or Tautulli; the tests use the suite's fakes.
- Reading a library page by page means more than one request to Plex for a library of over 5,000 shows.

## Out of scope

- The length of a "year" (365.25 days), and how a fractional period is printed.
- Service addresses in error text: the same in every tool, and a change of its own.
- The tool's behaviour beyond the items above; no new options; nothing under `.github/`; no dependency
  changes; the tool count stays at 27.
