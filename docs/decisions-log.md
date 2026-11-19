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

## 2026-11-15: how show titles are compared when Plex has no TVDB id

Job `fix-pr-121-findings`, following the review of #121.

**Decision.** A Plex show is matched to a Sonarr series by TVDB id. Only when Plex holds no TVDB id for the
show are the title and year compared, after both titles are folded by one rule (`foldShowTitle` in
`src/tools/showMatch.ts`):

- Folded away: case; symbols and punctuation (they become spaces, symbols first, so "™" and "№" never turn
  into letters); "&" reads as "and"; width and compatibility forms (full-width letters and digits, half-width
  katakana, ligatures); optional marks on Latin, Greek, Hebrew and Arabic letters (accents, tonos, points,
  vowel marks, hamza and madda); a mark that follows no letter, such as an emoji selector.
- Kept: the letters and digits of every script, and the marks that tell letters apart in the other scripts
  (Japanese か and が, Cyrillic й and и, Devanagari and Thai signs).

**Why.** The first version kept only a-z and 0-9. Two different Japanese titles from the same year that
shared a digit folded to the same text and matched each other, and a title wholly in Japanese or Cyrillic
folded to nothing and could never match. A wrong match gives a show another show's status, which is worse
than no match, so the rule keeps whatever distinguishes two titles and folds only what people write
inconsistently for the same title.

**Considered and not done.**

- Stripping every combining mark in every script: simpler, but it folds different titles together (か and
  が, कि and की).
- Keeping every mark: the same title with and without accents, tonos or vowel marks would not match.
- Folding symbols to the letters inside them (a circled "Ⓐ" as "A", "℃" as "°C"): turning every symbol into
  a space first is what keeps "™" and "№" from becoming letters, and titles written with such symbols on one
  side and spelled out on the other are rare. An exception list can be added if one turns up.
- Known limits, stated in the code: Cyrillic "ё" and "е" stay different, and "ß" is not "ss". Superscripts
  and fractions fold to their digits ("²" is "2", "½" is "1 2").

**Also decided.**

- Shows left out by `showStatus` are described as "could not be matched to a Sonarr series". "Not in Sonarr"
  was wrong when Sonarr has the show but no single match exists (two series share a title and year, or the
  series has no TVDB id while the Plex show has one).
- A Sonarr answer that is not a list of series (for example a sign-in page from a proxy, answered with
  HTTP 200) is the "Sonarr could not be read" error. The check is made where the search reads Sonarr, so the
  other tools that read the series list behave as before.

**Review findings declined, and why.**

- *A Sonarr answer with an empty JSON body (`null`) still reads as an empty list.* Catching it means changing
  `fetchAllSeries`, which other tools share; that is a change of its own. The reply in that case still says
  the shows could not be matched.
- *The Sonarr error reply can include Sonarr's address.* The same pattern is used by the other tools, and the
  reply is shown only to the person running the app. Changing it belongs in one change across all tools.
- *A library is read in one request of at most 5,000 items.* That limit was already there and applies to
  every search; paging the read is a change of its own.
- *The dashboard chat's filter hint does not name the two new filters.* The tool description reaches the
  chat anyway.
