# Accessibility

The aim is a dashboard that people who use a keyboard, a screen reader, zoom or high-contrast settings can use
as well as anyone, measured against the [Web Content Accessibility Guidelines (WCAG) 2.1](https://www.w3.org/TR/WCAG21/)
at level AA. It isn't there yet. This page says what the dashboard does today, what has and hasn't been
checked, and the gaps that are known. Problems are bugs: please report them in
[GitHub Issues](https://github.com/HoneyBearTech/plex-director-mcp/issues).

This is about the web dashboard. In Claude Desktop, Plex Director only supplies the tools; Claude Desktop's
own interface is what you use.

## How it is checked

Honestly: not much yet.

- **Few automated accessibility checks.** Biome's recommended accessibility lint rules run on the
  dashboard (`web/`) in CI (for example, images need alternative text). There are no axe checks, and the
  dashboard has no tests of its own; CI typechecks, lints and builds it.
- **No manual audit.** Nobody has yet tested complete tasks with a screen reader (NVDA, JAWS, VoiceOver,
  TalkBack), measured colour contrast, or done a keyboard-only pass of every page.

What follows comes from reading the code in `web/src`. Items marked *(unverified)* are what the code and its
libraries should do, but haven't been confirmed in a browser with assistive technology.

## What the dashboard does today

- **Built on [Radix Themes](https://www.radix-ui.com/themes)**, whose tabs (Settings) and select (Appearance)
  are built on Radix primitives that implement the WAI-ARIA patterns, including arrow-key navigation and focus
  handling *(unverified here)*. Radix Themes components show a visible focus ring when reached by keyboard
  *(unverified here)*.
- **Real links and buttons.** The sidebar items are links, and the current page's link is marked with
  `aria-current="page"` as well as by bold text and a bar beside it, not by colour alone. Actions such as
  **Ask**, **New chat**, **Save**, **Sign out** and **Trust new key** are buttons. Forms submit with Enter.
- **Page language and title.** The page declares `lang="en"`, and the browser tab is titled "Plex Director".
- **Status in words, not just colour.** Every coloured badge says what it means: "Online" / "Offline",
  "Healthy", "Recent failures", "Backing off", "Disabled", "stalled", "Transcoding" / "Direct play", job states
  such as `RUNNING` or `PAUSED`, and "configured" / "not set" on the Settings page.
- **Progress bars have values.** They are ARIA progress bars with a value, and the number is also written next
  to each one. On the Query page, a show's progress bar also has a spoken name ("8 of 10 episodes watched").
- **Tables have headers.** The tables on Node Utilization, Queues, Indexers, Jobs and in Query answers have
  column headers, and those on Indexers, Jobs and in Query answers also use the indexer, job or title as a row
  header.
- **Images have text alternatives.** Posters are named after their title, the logo is labelled
  "Plex Director logo", and a user's avatar falls back to their initial with their name next to it.
- **Light, dark or your system's choice.** **Settings → UI → Appearance** offers System (the default, which
  follows your operating system's light or dark setting and changes with it), Light and Dark. The choice is
  remembered in your browser.
- **Confirmation uses the browser's own dialog.** **Trust new key** asks with the browser's standard confirm
  dialog, which assistive technology handles natively.
- **Nothing moves or flashes.** Pages refresh their data in place every 10 to 60 seconds; there is no
  animation beyond short colour transitions on hover.

## Known gaps

- **Some fields have no label.** The password field on the sign-in page and the question field on the Query
  page have only placeholder text, which disappears as you type and which screen readers may not announce as a
  name.
- **Settings labels aren't tied to their fields.** The Settings page shows a visible label above each field,
  but the label isn't connected to the input, so a screen reader may announce only "edit text" or
  "secure edit text". The same goes for the Appearance select.
- **No landmarks or skip link.** The sidebar isn't marked as navigation and the content isn't marked as the
  main region, so screen reader users can't jump between them, and keyboard users tab through the sidebar on
  every page.
- **Heading levels are flat.** The page title and every section heading (such as "Plex Activity" or
  "SABnzbd") are all level-1 headings, so the outline doesn't show which belongs to which.
- **Chat answers aren't announced.** When the Query chat answers, or shows "Thinking…" or an error, nothing
  tells a screen reader that something new appeared. Error messages elsewhere aren't announced either.
- **Generic image text in chat.** Artwork attached to an answer (for example from a movie status check) is
  described only as "Result artwork".
- **Server Status tables have no headers.** The streams and watch-statistics tables have no header row, so
  their columns (user, title, resolution, plays) aren't named.
- **Some progress bars have no name.** On Node Utilization, Queues and Jobs the bars have a value but no label
  saying what they measure; the column header and the number next to them are the only clue.
- **Small screens.** The sidebar is always 232 pixels wide and never collapses, and only the Node
  Utilization table scrolls sideways on its own. On a phone, or at high zoom, pages are likely to be cramped or
  need sideways scrolling *(unverified)*.
- **Contrast hasn't been measured.** Radix Themes' colour scales are designed so that its text colours have
  good contrast on its backgrounds, but the grey secondary text and the badge colours used here haven't been
  checked against WCAG AA in either theme.
- **English only.** The interface isn't translated, and dates use your browser's format.

Fixing the labels, landmarks and headings, and adding automated checks (axe) to CI, are the natural first steps.
Reports from people who use assistive technology are very welcome.
