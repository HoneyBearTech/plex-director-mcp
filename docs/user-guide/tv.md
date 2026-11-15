# TV shows

These tools read **Sonarr**: which episodes you have, which are missing and why, what quality you have them
in, how much space they take, and what is coming up. They only read; none of them changes anything in Sonarr. All seven are available in
Claude Desktop and in the [Query chat](query-chat.md).

To search the shows in Plex, or find a particular episode by its plot, see [Your library](library.md).

Throughout, **episodes that haven't aired yet and specials (season 0) are never counted as missing**. Specials
are reported on their own.

When two shows share a name, add the year the show first aired ("Doctor Who 2005") to pick one.

## Do I have every episode? `check_series_completeness`

"Do I have every episode of Breaking Bad?" From Sonarr's episode list: how many aired episodes are downloaded,
exactly which seasons and episodes are missing, what hasn't aired yet, and whether Sonarr monitors the show
(and so will fetch the rest).

It counts the episodes themselves rather than trusting Sonarr's summary, which treats a partly downloaded,
unmonitored show as complete. It looks at what Sonarr has downloaded, not at what Plex has scanned.

## Which shows have gaps? `find_series_gaps`

"Which of my shows are missing episodes?" Lists the shows with missing aired episodes, most missing first, with
how many are downloaded and whether Sonarr is looking for the rest.

| Option | Example |
| :--- | :--- |
| Monitoring | Only monitored shows, only unmonitored ones, or only those Sonarr is actively searching for. |
| How many missing | "missing at most 5" for nearly complete shows; "at least 10". |
| Hide empty shows | Skip shows with nothing downloaded at all. |
| Limit | 15 by default, 200 at most. |

## Why is an episode missing? `diagnose_missing_episodes`

"Why is Bluey season 2 episode 5 missing?" For each aired episode with no file, Sonarr's history and download
queue say what happened:

- **never grabbed**: Sonarr never found or took a release;
- **grabbed but never imported**: a release was downloaded but didn't make it into the library;
- **download failed**, with Sonarr's reason;
- **file removed**, with the reason if Sonarr recorded one;
- **in the queue**: it is downloading, or stuck there;
- **not monitored**: Sonarr will never look for it.

You can ask about a whole show, one season, or one episode.

## What quality do I have? `find_series_by_quality`

"Which shows do I only have in 720p?", "Which shows have 1080p or better?", "Which shows mix qualities?" (good
candidates for an upgrade). Reads the resolution Sonarr recorded for each downloaded file, and lists the shows
with the lowest best quality first, with how many files are at each resolution.

| Option | Example |
| :--- | :--- |
| Best quality at most | 720 for "only in 720p or lower". |
| Best quality at least | 1080, or 2160 for 4K. |
| Mixed only | Only shows whose files aren't all the same resolution. |
| Monitoring | Monitored, unmonitored, or any. |
| Folder | Only shows in a Sonarr folder whose path contains the text, such as `kids` or `anime`. |
| Limit | 15 by default, 200 at most. |

It only sees what Sonarr downloaded. A 4K copy kept in a separate Plex 4K library that Sonarr doesn't manage isn't
counted; to find those, search the library with `4k` ([Your library](library.md)).

## Which shows take the most space? `find_series_by_size`

"Which shows take the most disk space?" Ranks the shows that have files by the size Sonarr reports for them,
largest first, each with its size, number of episode files, status and whether it is monitored. The reply opens
with how many shows have files and how much space they take in all.

| Option | Example |
| :--- | :--- |
| Status | Continuing, ended or upcoming (Sonarr's status). |
| Monitoring | Monitored, unmonitored, or any. |
| Folder | Only shows in a Sonarr folder whose path contains the text, such as `kids` or `anime`. |
| At least this big | "over 50 GB". A GB is 10^9 bytes, as the sizes are shown. |
| Not watched in N years | See below. |
| Limit | 15 by default, 200 at most. |

**Big shows nobody has watched in years.** "Which big shows haven't been watched in three years?" lists
clean-up candidates, still largest first. Each show is looked up in every Plex show library (also the ones
the "libraries to skip" setting leaves out of searches) and kept only when it was last watched longer ago than
that; a show that was never watched counts from the day it was added to Plex. Each line says "last watched"
with the date, or "never watched, added" with the date. This part needs Plex.

What "watched" can know is limited, and the reply says which of these it had:

- **Without Tautulli**, the watch history is that of the one Plex account Plex Director is connected with.
  A show someone else in the house watched can still be listed.
- **With Tautulli set up**, the plays in Tautulli's history count too. That history starts when Tautulli was
  installed and may leave out users archived there. Tautulli can only take a show off the list (someone played
  it more recently) or correct the date on its line; "no plays in Tautulli" is never read as "nobody watched
  it". Shows that Tautulli had no row or no plays for are judged from the Plex account alone and marked
  "Plex account only". If Tautulli's answer for a library fails or is incomplete, the reply names the library
  and judges its shows from the Plex account alone. Tautulli is never asked to rebuild its lists.

Left out, and counted in the reply: shows Sonarr has that could not be matched to a Plex show (they are matched by TVDB id,
or by title and year when Plex has none), and shows Plex marks as watched without a date.

It is a report: it deletes nothing and changes nothing.

## What does Sonarr know about a show? `check_series_status`

"What's the status of Severance in Sonarr?" Whether it is monitored, its quality profile and folder, when the
next episode airs, when something was last downloaded, what is in the download queue for it, and how many aired
episodes are downloaded.

## What's on, and when does it come back? `get_upcoming_episodes`

From Sonarr's calendar:

- **With no show named**, "what's on this week?": every episode airing in the next 7 days (up to 60) from the
  shows Sonarr monitors, by day, with season premieres and finales flagged and episodes already downloaded
  marked.
- **With a show named**, "when does The Bear come back?": its next episodes, or that none is scheduled yet, or
  that the show has ended.

Shows Sonarr doesn't monitor are left out unless you ask for them, and the reply says how many were left out.

## Not available

Batch upgrades of TV shows aren't supported: `plan_media_upgrade` refuses TV and only plans movies
([Batch jobs](jobs.md)). There is no tool to add a show to Sonarr.
