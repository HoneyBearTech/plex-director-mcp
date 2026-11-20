# Decisions log

Why things in Plex Director are the way they are: each entry gives the decision, the reason, what was
considered and not done, and review findings that were declined, with why. Newest first. What shipped when
is in the [pass map](pass-map.md).

## 2026-11-20: land the open pull requests through one combined pull request

Job `land-open-prs`.

**Decision.** The owner chose to land #118 to #126 through one branch that merges them in order (#118,
#119, #120, #121, #124, #122, #125, #123, #126) with real merge commits, which he merges once with "Create a
merge commit". #123, the roadmap's open question of whether to add TV series at all, is included on his
word. Afterwards #124 to #126 are closed as included, and Dependabot's open pull requests are closed once
Renovate is seen running.

**Why.** Merging the fixes into their feature branches and then each feature into `main` would have
clashed twice in the notes and once in the changelog, each needing an edit on GitHub, and the full CI
workflow had never run on the fixes, which targeted the feature branches. One branch gives one place to
resolve the clashes and one full run of every check.

**Not done.** Merging the pull requests one by one (more clicks for the owner, three clashes to resolve
by hand); squashing (GitHub would not mark #118 to #123 as merged, and the reviewed commits would be lost).

**Review findings moved to the roadmap, not fixed here** (this pull request only combines what was
already reviewed):
- *Lookup text is cut before the Sonarr key is removed* (code audit, reported as must-fix). Taken as
  minor: the text cut is a show's title and overview from Sonarr's lookup, which never holds the owner's
  key; error text, which can, already has the key removed before it is cut.
- *A Sonarr lookup or library answer that is not a list reads as "no series"* (code audit). Real, and the
  other tools were fixed for the same thing in #124 and #125; Sonarr itself refuses to add a series it
  already has, so a wrong "not in Sonarr" cannot add a duplicate.
- *A late confirmation can replace a newer preview* (code audit). Real but narrow: it needs two previews
  of one grid and a settings change between them, and it can only make a preview id stop working, which
  adds nothing.
- *The series status from Sonarr is not cut to length* (security review).
- *Read requests to Sonarr still follow redirects* (security review, already known from #126).
- *Stale tool counts in the user guide and contributing guide, and remaining mentions of Dependabot*
  (QA). Already wrong on `main`, outside the nine pull requests.

## 2026-11-15: what a series preview holds an add to, and what it does not

Job `fix-pr-123-findings`, following the review of #123.

**Decision.** `confirm_selected_series` adds nothing unless the preview being confirmed is the current one,
at most 15 minutes old, and still true. The preview is a consistency check, not the human gate.

- What the preview covers is stored with it and compared again at confirm time: the shows (title, year and
  TVDB id), whether each is already in Sonarr, each show's seasons with their monitored flags, the quality
  profile, root folder, series type, monitor option, whether a search starts, and Sonarr's address. Any
  difference adds nothing and returns a new preview that says what differs.
- What is posted to Sonarr is a fixed list of fields. From the lookup record: the TVDB id, the title as
  shown, slug, year, the images reduced to their type and addresses, and the seasons the preview stored.
  Plus the resolved settings. Nothing else the lookup returns is sent back, in particular no path, id or
  tags.
- The add is never sent on to another address: a redirect from Sonarr's address is not followed, because
  following it would repeat the add, with the API key, to a host no preview showed.
- A preview can be confirmed for 15 minutes. An expired id is removed and nothing is sent.
- One confirmation talks to one Sonarr, for one grid. Before each show is sent, the saved address must
  still be the one the preview was made with and the grid must still be the one the preview came from;
  otherwise the remaining shows are "not attempted".
- Each show's line says only what is known. "Added" needs a successful answer that is the added series.
  "Failed" needs a refusal (a 4xx answer). No answer, a redirect, a server-side error, or any other answer
  is "not known": the show may have been added, and a new search and preview will show it as already in
  Sonarr if it was. Nothing is retried. Error text from Sonarr or a proxy is cut to 300 characters.
- A search replaces the grid and clears the preview only after Sonarr has answered, in one transaction. A
  grid number exists once. A preview worked out from a grid that has since been replaced is not stored.
- The security docs say that the preview does not show a person saw it, because the reply hands its id
  straight back to the caller. The control against text in a looked-up title or overview causing an add is
  the MCP client asking the person before each tool call. The docs advise against "always allow" for
  `confirm_selected_series` and `confirm_selected_choices` and name that as the residual risk.

**Why.** Adding a series can start a large download, so the costly mistakes are adding something the
person did not agree to, adding it with other settings than the ones shown, adding it twice, and saying
"failed" about an add that went through. The first version posted Sonarr's whole lookup record back with
the settings on top, compared the settings and not the seasons, kept a preview for ever, and counted the
preview's id as a control against injected text.

**Considered and not done.**

- Checking the 15 minutes again before each show is sent: the limit is on when a confirmation is accepted.
  What follows is bounded by the request timeouts, and everything is resolved again at that point anyway.
- Retrying an add whose outcome is not known: a retry could add twice. The person previews again and sees
  the show as already in Sonarr if it was added.
- Keeping a record of each confirmation and what it sent: useful after an unknown outcome, and a feature of
  its own. Left for the roadmap.
- Looking a show up again by `tvdb:<id>` instead of by title: believed to work, not checked against a live
  Sonarr. The title lookup that finds nothing adds nothing.
- Escaping markup in a looked-up title: the title is also the term the show is looked up by. Whitespace and
  newlines are folded and the text is cut to 200 whole characters.
- Checking the series type and monitor defaults when they are seeded from the environment: they are checked
  when saved on the Settings page, and a bad seeded value is reported at preview time, where nothing is
  added.

**Declined review findings.**

- "Expiry is checked only before the settings are resolved again" (audit): see the first point above.
- "A title longer than 200 characters is looked up by its cut form" (QA, audit): it fails safe. If the
  lookup does not return the show, nothing is added and the reply says so.
- "No test for a database that holds the grid table in its first shape" (QA): the table only ever holds
  the last grid, the shape check runs once when the database is opened, and the first shape only existed on
  an unreleased branch.

**Decided by the owner.** A redirect from Sonarr's address was first reported as "failed". The last audit
pointed out that one kind of redirect (a 303) can follow a request that was carried out, so "not known" is
the strictly true word for it. The security review and QA had judged "failed" acceptable, since Sonarr
itself never answers an add with a redirect. The owner chose "not known", which keeps the rule above
without an exception.

**Not decided here.** Whether adding TV series belongs in the product at all is the owner's decision; the
roadmap lists it as undecided. Nothing in this job was tried against a live Sonarr.

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
