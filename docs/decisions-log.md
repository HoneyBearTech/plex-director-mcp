# Decisions log

Why things in Plex Director are the way they are: each entry gives the decision, the reason, what was
considered and not done, and review findings that were declined, with why. Newest first. What shipped when
is in the [pass map](pass-map.md).


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
