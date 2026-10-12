# Contributing to crawl402

Thanks for helping. Bug reports, crawler signatures, payment network presets, adapters and docs fixes are all welcome.

## Setup

```bash
git clone https://github.com/devops-shivam/crawl402.git
cd crawl402
npm install
npm test        # builds, then runs the test suite
npm run typecheck
```

Node.js 20 or later is recommended for development.

## Project layout

See [docs/architecture.md](docs/architecture.md). In short: `src/core` is the engine, `src/detectors`, `src/pricing` and `src/facilitator` are the replaceable parts, `src/adapters` connects frameworks, and `src/testing` is the sandbox.

## Good first contributions

- **New crawler signature.** Add it to `src/detectors/bots.ts` with the right category and a link to the crawler's documentation in the PR.
- **New token preset.** Add it to `src/core/assets.ts` with a link to the official contract address.
- **New adapter.** Add `src/adapters/<framework>.ts`, a subpath export in `package.json`, and tests that run the sandbox payment flow through it.

## Pull requests

- Keep the core free of runtime dependencies and Node-only APIs, so it keeps working on Edge runtimes.
- Add or update tests for behaviour changes. Use `createSandbox()` from `src/testing` rather than mocking `fetch`.
- Update `README.md` or `docs/` when you change the public API, and add a line to `CHANGELOG.md`.
- One logical change per PR.

## Reporting security issues

Please don't open a public issue. See [SECURITY.md](SECURITY.md).

## Code of conduct

Be respectful and constructive. Harassment or personal attacks aren't tolerated. Maintainers may remove comments or contributors that break this.
