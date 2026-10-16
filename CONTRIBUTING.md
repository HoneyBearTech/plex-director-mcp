# Contributing to Plex Director

Plex Director is a personal project with a single maintainer. Contributions are welcome, but there is no
service-level agreement, and review may take a while. Only the latest release is supported (see
[SUPPORT.md](SUPPORT.md)), and fixes land on `main` first.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) and how the project is run ([GOVERNANCE.md](GOVERNANCE.md))
before you start.

## Reporting bugs and suggesting changes

- Use [GitHub Issues](https://github.com/HoneyBearTech/plex-director-mcp/issues) for bugs, questions and feature
  ideas. There are forms for a bug report and a feature request. For anything bigger than a small fix, please
  open an issue first so we can agree on the approach before you spend time on it.
- New here? Issues labelled [`good first issue`](https://github.com/HoneyBearTech/plex-director-mcp/labels/good%20first%20issue)
  are small, self-contained tasks (a test, a docs gap, an accessibility check) that don't need the whole
  codebase in your head.
- **Never paste API keys, tokens or passwords** into an issue: your Plex token, your Radarr, Sonarr, Prowlarr,
  SABnzbd, Tautulli, TMDb or Anthropic keys, your qBittorrent password or your Discord webhook URL. Redact
  them from logs and screenshots too. If one has been posted by mistake, revoke it in the app it belongs to.
- **Do not report security vulnerabilities in a public issue.** Follow [SECURITY.md](SECURITY.md) and use
  GitHub's [private vulnerability reporting](https://github.com/HoneyBearTech/plex-director-mcp/security/advisories/new)
  instead.

## Development setup

What you need:

- **Node.js 24** and npm. The backend and the dashboard are two separate npm projects, each with its own
  `package-lock.json`: the repo root (the MCP server and the web server) and `web/` (the React dashboard).
- **Docker**, if you want to build and run the image.
- `git`.

You don't need any of the media apps to work on the code: the tests use fakes for every service. To try your
change against a real stack, copy `.env.example` to `.env` and fill in the services you use, or leave it empty
and enter them on the Settings page. `.env` is in `.gitignore`; never commit it.

```sh
git clone https://github.com/HoneyBearTech/plex-director-mcp.git
cd plex-director-mcp
npm install
cp .env.example .env    # optional; then edit as needed
npm start               # MCP server (stdio) + dashboard on WEB_PORT (default 3000)
```

The dashboard has its own dev server, with hot reload, which proxies `/api` to the backend on `:3000`:

```sh
cd web
npm install
npm run dev             # http://localhost:5173
```

Remember that once a service setting has been saved in the database, **the database wins over `.env`** (see
the [environment variable reference](README.md#environment-variable-reference)). If you change a service
variable in `.env` and nothing happens, change it on the Settings page instead.

### Building the image

```sh
docker build -t plex-director-mcp .
```

The Dockerfile builds the dashboard (`npm run build` in `web/`) for you. `.dockerignore` keeps `.env` and the
local database out of the build context. Releases are built and signed by `.github/workflows/ci.yml`; see
[CI/CD](README.md#cicd) in the README.

## The checks, and where they run

| Check | What it does | Runs locally with | Runs in CI |
| --- | --- | --- | --- |
| Typecheck (backend and tests) | TypeScript in strict mode, `tsconfig.json` | `npx tsc --noEmit` | every pull request and push to `main` (required) |
| Tests (`test/`) | Node's built-in test runner through `tsx`: the MCP tools, the web API, settings, jobs, SSH, and the MCP server over real stdio | `npm test` | every pull request and push to `main` (required) |
| Typecheck (dashboard) | TypeScript in strict mode, `web/tsconfig*.json` | `cd web && npx tsc --noEmit` | every pull request and push to `main` (required) |
| Dashboard build | the static assets the backend serves | `cd web && npm run build` | inside the image build (required) |
| Dependency audit | known vulnerabilities, high severity or worse, in both projects | `npm audit --audit-level=high` (and the same in `web/`) | every pull request and push to `main` (required) |
| Image smoke test | the image builds and starts with dummy configuration | `docker build -t plex-director-mcp .` | every pull request and push to `main` (required) |
| Lint and format | [Biome](https://biomejs.dev/) with its recommended rules (`biome.jsonc`) on `src/`, `test/`, `scripts/` and `web/`: lint errors, warnings and unformatted files fail | `npm run check` | every pull request and push to `main` (required) |
| Static analysis | CodeQL security queries on the TypeScript | (CI only) | every pull request, push to `main`, and weekly |

`npm run format` rewrites files in the house style, and `npx biome check --write .` also applies safe lint
fixes. Service responses are typed in `src/types/` (only the fields the code reads); add the fields you
need there rather than reaching for `any`. The bulk reformat is listed in `.git-blame-ignore-revs`; run
`git config blame.ignoreRevsFile .git-blame-ignore-revs` once so local `git blame` skips it too.

**The tests can't touch your real setup.** They run against a throwaway database, never read your `.env`,
have your service credentials removed from the environment, and fail every HTTP request unless a test
installs a fake. `test/isolation.test.ts` fails the run if any of that ever breaks. Keep it that way: a new
test must import `./setup.js` (directly or through `./helpers.js`) and fake every service it calls.

## Before you open a pull request

Run the same checks CI runs, and make sure they pass:

```sh
npx tsc --noEmit
npm run check
npm test
npm audit --audit-level=high
cd web
npx tsc --noEmit
npm run build
npm audit --audit-level=high
```

If you added, removed or renamed an MCP tool, `test/stdio.test.ts` checks the number of tools: update the
count there and the counts in `README.md` ("25 tools", "Twenty-five tools") together, and add the tool to the
[MCP tools](README.md#mcp-tools) table.

## Coding standards

- **TypeScript** in strict mode, with the extra checks in `tsconfig.json` (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) for the backend and `web/tsconfig*.json` for the dashboard. The typecheck must
  be clean.
- **One implementation per capability.** The MCP tools and the dashboard share the same logic modules in
  `src/`; don't write a second copy of something for the web side. If the dashboard needs what a tool does,
  move the logic into a shared module and call it from both.
- **Secrets stay on the server.** Never send a saved key or token back to the browser, and never write one to
  a log or to stdout. stdout belongs to the MCP protocol: anything that isn't JSON-RPC breaks stricter clients.
- **Formatting and lint** are Biome's job (see [the checks](#the-checks-and-where-they-run)); if you need to
  silence a rule, use a `biome-ignore` comment with the reason, not a config change.
- Follow the style of the surrounding code rather than introducing a new one.

## Test policy

- **New functionality must come with automated tests** in `test/`, covering both what it should do and how
  it handles bad input or a service that is down or misconfigured.
- **Bug fixes must come with a regression test** that fails without the fix, unless that is impractical, in
  which case the pull request says why.
- Security-relevant changes should include a test that proves the protection works (for example, that a
  secret is never returned by the API).

## Developer Certificate of Origin

Every commit must be signed off to certify the [Developer Certificate of Origin](https://developercertificate.org/)
(DCO): that you wrote the change, or otherwise have the right to submit it under the project's license.
Sign off by adding a `Signed-off-by` line with your name and e-mail address (a GitHub `noreply` address is
fine) to the commit message, which `git commit -s` does for you:

```text
Signed-off-by: Your Name <you@example.com>
```

A check on pull requests fails if a commit lacks the sign-off. To fix it, amend or rebase with `--signoff`
(for example `git rebase --signoff main`) and force-push your branch.

Signed commits (GPG or SSH, so GitHub shows them as "Verified") are welcome, but not required.

## Pull requests

- `main` is protected: changes land only through a pull request, and the required CI checks must pass.
- Keep each pull request to **one change**, and describe what it does and why.
- Add or update tests for behaviour changes, and update `README.md` and `.env.example` if you change
  configuration, tools or anything else people see.
- Follow the [coding standards](#coding-standards) and the [test policy](#test-policy), and sign off your
  commits ([DCO](#developer-certificate-of-origin)).
- Never commit secrets, API keys, tokens, databases or `.env` files. `.gitignore` excludes them; extend it if
  you need to, rather than working around it.
- Plex Director holds API keys for your whole media stack, can add and delete downloads, and connects to hosts
  over SSH, so treat changes to authentication, settings, secret handling, SSH or the tools that change
  things with extra care, and call them out in the pull request description.

## Code review

Every change reaches `main` through a pull request and is reviewed before it is merged. GitHub enforces the
required checks; the review covers what tools can't.

**How it is done.** The maintainer reviews each pull request on GitHub, Dependabot's included, reading the
whole diff and the CI results, and leaves questions or change requests as review comments. The project has
one maintainer (see [GOVERNANCE.md](GOVERNANCE.md)), so for now the maintainer's own changes are reviewed by
the maintainer against the same list, with no second reviewer.

**What is checked:**

- It does one thing, the thing it says, and the description explains why.
- It is correct for the cases that matter, including errors and empty or unexpected service responses.
- Tests cover the new behaviour, and a bug fix has a regression test ([test policy](#test-policy)).
- Security: no secret reaches the browser, a log or stdout; input from the browser, the model or a service
  is validated; anything that changes a real system is explicit and confirmed; new dependencies are needed,
  maintained and licensed acceptably.
- One implementation per capability: the MCP tools and the dashboard share logic rather than copying it.
- Docs, `README.md`, `.env.example` and the changelog are updated where users would notice the change.

**What is required to merge:** every required check passes (typecheck, Biome lint and format with no
warnings, tests with the coverage floor, dependency audits and review, CodeQL with no high or critical
alerts, secret scan, DCO sign-off, image build and smoke test); every review comment is resolved; and the
maintainer approves.

## License

By contributing, you agree that your contribution is licensed under the project's [MIT License](LICENSE).
