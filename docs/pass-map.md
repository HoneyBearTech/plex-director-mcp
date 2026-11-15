# Pass map

A short record of each piece of work on Plex Director: what shipped, or what a review found, and where to
look. Newest first. The reasons behind the choices are in the [decisions log](decisions-log.md); what is
planned next is in the [roadmap](roadmap.md).

| Date | Job | What shipped or was found | Where |
| --- | --- | --- | --- |
| 2026-11-15 | `fix-pr-122-findings` | Fixes for the findings of the review below, in `find_series_by_size`. Watching with no date is never outweighed by an older date: such a show is left out as "can't be judged" instead of being listed as not watched (a Plex copy watched with no date, or Tautulli plays with no usable play time, including a time in the wrong unit). Plex show libraries are read completely, page by page, or the watch part is an error. Shows with no Plex match "could not be matched to a Plex show". A second mark, "Tautulli history incomplete". A Sonarr answer that is not a list of series is an error. The security, assurance, architecture and interface docs name the one exception to the 10-second timeout and what the chat's tool passes on. 14 more tests. | #125, into the branch of #122 |
| 2026-11-15 | `review-pr-122` | Review of #122 (`find_series_by_size`): QA, a security review and a code audit of its commit. Sound and read-only, with two things to fix before merging (a watched show could be listed as not watched; four docs still said every request has a 10-second timeout) and seven smaller items. Not tried against a live Plex, Sonarr or Tautulli. | Review comment on #122 |
