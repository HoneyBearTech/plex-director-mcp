# Decisions log

Why things in Plex Director are the way they are: each entry gives the decision, the reason, what was
considered and not done, and review findings that were declined, with why. Newest first. What shipped when
is in the [pass map](pass-map.md).


## 2026-11-15: what "not watched" means when something is not known

Job `fix-pr-122-findings`, following the review of #122.

**Decision.** `find_series_by_size` lists a show as not watched in N years only when everything known about
it says so. Whatever cannot be known takes the show off the list, and the reply counts it:

- A show with any Plex copy that has watched episodes and no watch date, or with Tautulli plays that have no
  usable play time, is left out as "can't be judged", unless a known date already shows it was watched
  recently. An older date from another copy or source does not outweigh it.
- A Tautulli play time is usable only if it can be a time in seconds: later than a day from now (a time in
  milliseconds, say) counts as no usable time.
- A Plex show library is read page by page until every show Plex announces has been read, counted by
  distinct show. A page that is not a proper answer, a repeated page, a page longer than asked for, or a
  library beyond 20 pages of 5,000 makes the watch part an error. No list is built from part of a library.
- A listed show is marked when its picture is incomplete: "Plex account only" when Tautulli gave it no
  plays, "Tautulli history incomplete" when one library gave a date and another library's answer could not
  be used.

**Why.** The list is a set of clean-up candidates, so a watched show on it is the costly mistake; a show
missing from it costs nothing. The first version merged a show's copies by taking the latest known date,
which let an old date hide watching whose date was missing, and it read one page of a library without
checking that it was all of it.

**Considered and not done.**

- Changing the shared watch helpers (`mergeWatch`, `lastActivity`) so they carry "watched, date unknown"
  across copies: `search_plex_library` uses them, and its lists are not clean-up candidates. The rule is
  applied inside the report instead.
- Treating a missing total from Plex as an error: a page shorter than the page size is the normal end when
  Plex gives no total.
- Dividing a play time in milliseconds by 1,000: a guess about the unit is still a guess, and leaving the
  show out is always safe.

**Review findings declined, and why.**

- *A year is counted as 365.25 days.* The cut-off can be some hours from the calendar anniversary, which
  does not matter for a report about years.
- *Failure replies include the underlying error text, which can name a service's address.* The same in
  every tool; one change across all of them. The security docs now say that this text is part of what the
  chat passes on.
- *No size limit on a single answer from Plex.* An over-long page is refused, but it is received first.
  Plex is the owner's own server, and the memory is bounded to one page.
- *A fractional period is printed as given ("0.5 years").* Cosmetic.
