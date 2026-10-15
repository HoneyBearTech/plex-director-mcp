# Your library

These tools answer "what do I have?" from **Plex**, and "what is out there that I don't have?" from **TMDb**.
They only read; none of them changes anything. All four are available in Claude Desktop and in the
[Query chat](query-chat.md).

Watch state (watched, in progress, On Deck) is that of the Plex account whose token Plex Director uses.

## Searching what you own: `search_plex_library`

Searches the movies and TV shows in every Plex library at once. Ask things like:

- "Do I have Heat?" / "Which Harrison Ford movies do I have?" / "Horror movies from the 80s"
- "What's in the 4K library from Christopher Nolan?" / "Kids' shows rated TV-Y"
- "Unwatched sci-fi" / "Shows I started but never finished" / "Movies I haven't watched in five years"
- "What was added in the last two weeks?"

What it can filter and sort by:

| Filter | Example |
| :--- | :--- |
| Title (part of it) | "Dark" finds *Dark* and *The Dark Knight*. |
| Movies, shows, or both | "only shows". |
| Genre, actor (full name) | "Horror", "Harrison Ford". |
| Year, or a range | 1995; 1990 to 1999 for "the 90s". |
| Library | Any library whose name contains the text: `4k` for the 4K libraries, `kids`, `anime`. |
| Watch state | Unwatched, in progress, watched. |
| Not watched in N years | A title never watched counts from when it was added. |
| Network or studio | "HBO", "Netflix", "A24". |
| Content rating, audience rating | "TV-MA", "R"; "rated 8 or more". |
| Added within N days | "added this month". |
| Sort | By title (default), recently added, last watched, or least recently watched. |

Results come 25 at a time by default (up to 500), and Claude can ask for the next page. A title held in both an
HD and a 4K library is one result, with both libraries listed. Shows come with their seasons, episodes, and how
many episodes you have watched.

**Left-out libraries.** Libraries named in `PLEX_SKIP_LIBRARIES` (the **Plex** tab of Settings), such as Sports,
aren't searched, unless you name one in the question ("in Sports").

**Titles with no watch date.** Plex sometimes marks a title as watched but holds no date for it. For "not watched
in N years" those are set aside and counted in the reply, rather than guessed at.

## Finding episodes: `search_episodes`

Finds individual TV episodes:

- "The episode of Entourage where they go to Cannes" (searches that show's episode titles **and plots**)
- "Breaking Bad season 3 episode 7" / "Episodes of The Bear that aired in June 2024"
- "Season finales of Severance" / "Season premieres of Bluey"

With a show named, it searches the words in the episode titles and plots. Without one, it can only search
titles and air dates across your shows, because Plex can't search plots across the whole library. Each episode
comes with its season and episode number, air date and whether you have watched it. Up to 15 episodes by
default, 100 at most.

## What to watch next: `get_on_deck`

Plex's On Deck (Continue Watching): the movies you have partly watched and, for each show you are following,
the next episode (or the one you are part way through), most recently active first, with how far through each
one you are.

You can limit it to movies or shows, a library (`kids`), or a title. It lists 10 by default. Plex itself only
keeps about 50 items on deck, so for "everything I haven't finished", ask for a library search with the
*in progress* watch state instead.

## An actor's titles, owned and missing: `resolve_actor_filmography`

Looks up an actor on TMDb and marks each of their movies and shows as in Plex or not:

- "Which of Tom Hanks's movies don't I have?"
- "Harrison Ford movies from 1980 to 1989 that I have in 4K"
- "Bryan Cranston TV shows"

| Option | What it does |
| :--- | :--- |
| Movies, shows or both | Default both. |
| Year range | Released in or after, in or before. |
| Owned, missing, or all | "Owned" means in Plex. |
| Library | Judges ownership against matching libraries only: with `4k`, "owned" means held in a 4K library. |
| Limit | Newest first, 15 by default, 100 at most. |

Talk-show and "Self" appearances are left out, and a title appears once even when the actor played several
roles in it. Shows are matched to Plex by their TMDb id, so a show that Plex hasn't matched to TMDb shows as
missing even if you have it.

This needs the TMDb token (Settings → **TMDB**) as well as Plex.
