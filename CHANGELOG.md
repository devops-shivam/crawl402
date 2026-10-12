# Changelog

All notable changes are documented here. This project follows [Semantic Versioning](https://semver.org/). Until 1.0, minor versions may contain breaking changes.

Each release needs a `## x.y.z` section; its text becomes the GitHub Release notes. See [docs/releasing.md](docs/releasing.md).

## 0.1.1

No API changes.

- Published from GitHub Actions with npm trusted publishing, so this and future versions carry a provenance attestation linking each release to the commit and workflow that built it
- Releases are now automatic: merging a version bump publishes to npm and creates the GitHub Release

## 0.1.0

First public release.

- `createCrawl402` engine with `evaluate()` (settle before serving) and `handle()` (settle after a successful response)
- Next.js adapters: `crawl402Proxy` for `proxy.ts` / `middleware.ts`, `withCrawl402` for route handlers
- `withCrawl402Fetch` for Cloudflare Workers, Bun, Deno and Hono
- Detectors: `userAgent` (33 known crawlers and scrapers), `missingBrowserHeaders`, `fromHeader`, or your own function
- Pricing: fixed, `byPath`, `byBot`, or your own function; `null` for free
- Multiple payment options per request via `accepts`; USDC presets for Base and Base Sepolia
- `httpFacilitator` client for the standard x402 v2 facilitator API
- `crawl402/testing`: in-memory facilitator, wallets and an auto-paying fetch
