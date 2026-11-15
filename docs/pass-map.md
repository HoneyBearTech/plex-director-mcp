# Pass map

A short record of each piece of work on Plex Director: what shipped, or what a review found, and where to
look. Newest first. The reasons behind the choices are in the [decisions log](decisions-log.md); what is
planned next is in the [roadmap](roadmap.md).

| Date | Job | What shipped or was found | Where |
| --- | --- | --- | --- |
| 2026-11-15 | `fix-pr-121-findings` | Fixes for the findings of the review below. Show titles are compared correctly in every script when Plex holds no TVDB id for a show (before, letters outside a-z were dropped, so two different Japanese titles could match each other and a title wholly in Japanese or Cyrillic could never match). The note about shows left out by `showStatus` says they "could not be matched to a Sonarr series". A Sonarr answer that is not a list of series is an error, not "no shows match". The "offset is past the end" reply carries the left-out note. 14 more tests. | Branch `team/fix-pr-121-findings`, a pull request into the branch of #121 |
| 2026-11-15 | `review-pr-121` | Review of #121 (the `showStatus` and `director` filters of `search_plex_library`): QA, a security review and a code audit of its commit. Sound, with one bug to fix before merging (the title matching above) and four smaller items. Not tried against a live Plex or Sonarr. | Review comment on #121 |
