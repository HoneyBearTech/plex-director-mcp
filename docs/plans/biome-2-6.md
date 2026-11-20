# Plan: biome-2-6

## What Sean asked for

"Fix biome": let the formatter's next version merge, so Renovate's weekly
group of library updates can merge by itself.

## What we found

- The Biome formatter's new version, 2.6.7 (from 2.5.15), also formats
  Markdown. It wants to rewrap 19 Markdown files (README, CONTRIBUTING, the
  docs), so the "Typecheck & audit" check fails. The closed update pull
  requests #129 and #130 failed this way.
- Renovate puts Biome in the same group as the other library updates, so that
  whole group would fail and stay open on its next run.
- Tried on a copy: with Biome 2.6.7, its config migrated and Markdown
  formatting off, `biome ci . --error-on-warnings` passes with no other change.

## What we'll change

1. `package.json` and `package-lock.json`: Biome 2.6.7, exact version as now.
   Check: `npm ci` installs it, and the lock file changes only for Biome.
2. `biome.jsonc`: point the schema at 2.6.7 (`biome migrate`) and turn off
   Markdown formatting, with a comment saying why: the docs are wrapped by
   hand. JavaScript, TypeScript, JSON and CSS stay checked as before. Check:
   `npx biome ci . --error-on-warnings`, typecheck, tests and build pass, as in
   CI.
3. Record the change in CHANGELOG (if it lists tooling changes) and the notes
   in `docs/`.

## Who's on it

Engineer, Security Officer, Auditor. No Researcher (the cause is already
found).

## Risks

- Markdown is no longer formatted by any tool here; it wasn't before 2.6
  either.

## Out of scope

- Reformatting the Markdown files.
- Other library updates: Renovate proposes them.
