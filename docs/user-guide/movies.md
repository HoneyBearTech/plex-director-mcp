# Movies

These tools work with **Radarr**: what it knows about a movie, why a movie hasn't arrived, and adding new ones.
The first two only read and are also in the [Query chat](query-chat.md). Adding movies is only in Claude Desktop.

To find which movies you already have in Plex, see [Your library](library.md).

## A movie's state in Radarr: `check_movie_status`

"Is Dune in Radarr?" Looks the title up in Radarr and, if it is in your Radarr library, shows whether it is
monitored, its Radarr status, its folder, whether the file is there or still wanted, its synopsis and its
poster. If Radarr knows the title but it isn't in your library, it says so.

## Why is a movie missing? `diagnose_missing_media`

"Why don't I have Heat?" Follows the movie step by step and stops at the first answer:

1. **Radarr**: is the movie in Radarr at all, and is it monitored? An unmonitored movie is never searched for.
   If Radarr already has a file, it says where.
2. **SABnzbd's queue**: is it downloading right now? If so, with its status, progress and time left.
3. **Radarr's history**: did downloads of it fail? It reports how many failed attempts there were. With no
   failures recorded, it suggests that your indexers may have no release that matches the quality profile.

It checks the SABnzbd queue only; a movie downloading in qBittorrent is not found at step 2.

## Adding movies: `search_and_select_movies` and `confirm_selected_choices`

Adding is two steps, so that nothing is added by mistake:

1. **Pick.** "Add Heat" or "Find the movie Heat." `search_and_select_movies` searches TMDb and shows the top five
   matches as a numbered grid, with posters, years and a short overview. Nothing is added yet.
2. **Confirm.** "Grab choice 1" or "Add 1 and 3." `confirm_selected_choices` adds the chosen movies to Radarr,
   **monitored**, and **starts a download search** for each straight away.

Details:

- **Already there?** A movie that is already in Radarr is reported (downloaded, or monitored but not downloaded
  yet) and not added twice.
- **Quality profile.** The one you name ("…in the Ultra-HD profile"), otherwise the default on the **Radarr** tab
  of Settings, otherwise Radarr's first profile. A name that doesn't exist is refused, with the list of the
  profiles that do.
- **Folder.** Radarr's first root folder, unless you name another ("…in /media/movieskids"). An unknown folder is
  refused with the list of real ones.
- **Availability.** Movies are added with Radarr's minimum availability set to *released*.
- Only the most recent grid counts: a new search replaces the previous choices.

Claude Desktop asks before it runs `confirm_selected_choices`. Once it has run, the movies are in Radarr and the
searches have started; remove a movie in Radarr itself if you change your mind.

## Upgrading many movies at once

To search again for every monitored movie that has no file or is below 1080p, plan a batch job: see
[Batch jobs](jobs.md).
