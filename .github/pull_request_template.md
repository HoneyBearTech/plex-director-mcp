## What this changes, and why

<!-- One change per pull request. Link the issue it fixes, if there is one: "Fixes #123". -->

## How it was tested

<!-- The tests you added, and anything you checked by hand (against a real service, in a browser, in Claude Desktop). -->

## Checklist

- [ ] Every commit is signed off (`git commit -s`), certifying the [Developer Certificate of Origin](https://developercertificate.org/).
- [ ] This pull request makes one change.
- [ ] New functionality has tests, and a bug fix has a regression test (or the description says why not).
- [ ] `npm test` passes and `npx tsc --noEmit` is clean, at the root and in `web/` (and `npm run build` in `web/` if the dashboard changed).
- [ ] `README.md` (and `.env.example`, for a new or changed environment variable) is updated for anything people see or configure.
- [ ] If an MCP tool was added, removed or renamed: the tool count in `test/stdio.test.ts` and the counts and tools table in `README.md` are updated.
- [ ] No API keys, tokens, passwords, databases or `.env` files are included.
- [ ] Changes to authentication, settings, secret handling, SSH, or tools that change or delete things are called out above.
