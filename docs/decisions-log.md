# Decisions log

Why things in Plex Director are the way they are: each entry gives the decision, the reason, what was
considered and not done, and review findings that were declined, with why. Newest first. What shipped when
is in the [pass map](pass-map.md).

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
