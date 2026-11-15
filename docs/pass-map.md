# Pass map

A short record of each piece of work on Plex Director: what shipped, or what a review found, and where to
look. Newest first. The reasons behind the choices are in the [decisions log](decisions-log.md); what is
planned next is in the [roadmap](roadmap.md).

| Date | Job | What shipped or was found | Where |
| --- | --- | --- | --- |
| 2026-11-15 | `fix-pr-123-findings` | Fixes for the findings of the review below, in `search_and_select_series` and `confirm_selected_series`. Only a fixed list of fields is posted to Sonarr. The preview stores each show's title, year and seasons, and any change at confirm time adds nothing and returns a new preview. A preview lasts 15 minutes. Each show's line says added, already there, failed, not known or not attempted, and says "failed" or "added" only when that is known. One row per show. A failed search keeps the grid and the preview; overlapping searches, previews and confirmations cannot mix. One confirmation talks to one Sonarr, a redirect is not followed, and the key in use is always removed from replies. The two list-valued defaults are checked when saved. Lookup text is folded and cut. The security docs say the preview is a consistency check and the MCP client's approval is the human gate. 27 more tests. Not tried against a live Sonarr. | #126, into the branch of #123 |
| 2026-11-15 | `review-pr-123` | Review of #123 (adding series to Sonarr): QA, a security review and a code audit of its commit. The confirm-before-adding design holds (the chat cannot reach the tools, a preview is required, its id is random and single-use, the key is removed from replies), with four things to fix before merging (the whole lookup record was posted back; seasons were shown and not compared; the assurance case counted the preview's id as a control against injected text; a preview never expired) and seven smaller items. Not tried against a live Sonarr. | Review comment on #123 |
