# crawl402

**Make AI crawlers pay to read your site. Humans and search engines stay free.**

crawl402 is a drop-in Next.js proxy (or middleware) that answers AI crawlers such as GPTBot, ClaudeBot, CCBot and PerplexityBot with **HTTP 402 Payment Required**. Crawlers that support the open [x402](https://x402.org) protocol pay a micropayment in USDC and get the page. Everyone else browses as usual.

```
Crawler ──GET /articles/post──────────────────────▶ your proxy.ts
        ◀─ 402  PAYMENT-REQUIRED: price, wallet, network
Crawler signs a USDC transfer for exactly those terms
Crawler ──GET /articles/post + PAYMENT-SIGNATURE──▶ proxy.ts ──verify, settle──▶ facilitator
        ◀─ 200  page + PAYMENT-RESPONSE (transaction hash)
```

- **Two lines to add.** One `proxy.ts`, a wallet address and a price.
- **SEO safe.** Googlebot, Bingbot and other search engines pass free by default. `robots.txt` and sitemaps are never charged.
- **Modular.** Swap in your own crawler detection, pricing rules, payment networks, facilitator or framework adapter.
- **Edge ready.** Web-standard APIs only, no Node built-ins. Runs on Node, Edge, Bun, Deno and Cloudflare Workers.
- **Testable.** `crawl402/testing` ships an in-memory facilitator and wallets, so you can test the full payment flow without a blockchain.
- **Zero runtime dependencies.**

**[Try it in your browser →](https://devops-shivam.github.io/crawl402/)**

> **Status:** early release (0.x). The API may change before 1.0. Payments default to **Base Sepolia testnet**.

## Install

```bash
npm install crawl402
```

Requires Next.js 13.4 or later for the Next adapter. The core works without Next.

## Quick start

Create `proxy.ts` in your project root (Next.js 16+). On Next.js 13.4 to 15, name the file `middleware.ts`.

```ts
import { crawl402Proxy } from "crawl402/next";

export default crawl402Proxy({
  payTo: "0xYourWalletAddress", // receives the payments
  price: "$0.002",               // per request, in USDC
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|css|js)$).*)"],
};
```

Check it:

```bash
curl -i http://localhost:3000/                    # 200, you're a human
curl -i -A "GPTBot/1.2" http://localhost:3000/    # 402 with a PAYMENT-REQUIRED header
curl -i -A "Googlebot/2.1" http://localhost:3000/ # 200, search engines are free
```

The defaults use Base Sepolia test USDC and the public `x402.org` facilitator, so nothing real is charged while you try it. See [Going live](docs/going-live.md) when you're ready for real payments.

## Protect a single route handler

```ts
// app/api/data/route.ts
import { withCrawl402 } from "crawl402/next";

export const GET = withCrawl402(async () => Response.json(await getData()), {
  payTo: "0xYourWalletAddress",
  price: "$0.01",
});
```

Route handlers verify the payment, run your code, and only collect the money if your handler returned a status below 400. A crawler is never charged for an error.

## Configuration

```ts
import { createCrawl402, byPath, userAgent, missingBrowserHeaders, httpFacilitator } from "crawl402";

export const paywall = createCrawl402({
  // Who gets paid, and how
  payTo: "0x…",
  network: "eip155:8453",                 // Base mainnet. Default: eip155:84532 (Base Sepolia)
  facilitator: httpFacilitator({ url: process.env.X402_FACILITATOR_URL! }),

  // What it costs
  price: byPath({ "/research/*": "$0.02", "/articles/*": "$0.002" }, null), // null = free

  // Who pays
  detectors: [userAgent({ allowBots: ["Perplexity-User"] }), missingBrowserHeaders()],
  skip: (req) => req.headers.get("x-api-key") === process.env.PARTNER_KEY,

  // Where
  protect: ["/articles", "/research", "/api"],
  exclude: ["/articles/rss.xml"],

  // Observability
  onPaid: (e) => console.log(`${e.detection.bot?.name} paid ${e.amountFormatted} USDC`, e.transaction),
  onRejected: (e) => console.warn("payment rejected", e.reason),
});
```

Pass the same `paywall` instance to `crawl402Proxy(paywall)` and `withCrawl402(handler, paywall)` to share one configuration.

| Option | Default | Description |
| --- | --- | --- |
| `price` | required | `"$0.002"`, a number, or `(ctx) => price \| null`. Helpers: `byPath`, `byBot`. `null` means free. |
| `payTo` | required* | Recipient address. *Or use `accepts`. |
| `network` | `eip155:84532` | CAIP-2 network. `eip155:8453` is Base mainnet. |
| `asset` | USDC preset | Token to charge in: `{ address, decimals, extra }`. |
| `accepts` | | Several payment options at once (other networks or tokens). Overrides `payTo`, `network` and `asset`. |
| `facilitator` | x402.org (testnet) | A `Facilitator` object, `httpFacilitator(options)`, or a URL. |
| `detectors` | `[userAgent()]` | Who to charge. Run in order; first verdict wins. |
| `skip` | | `(request) => boolean`. Bypass the paywall, e.g. for signed-in users. |
| `protect` | all paths | Path patterns to paywall. |
| `exclude` | | Extra paths to never charge. Always excluded: robots.txt, sitemaps, favicon, `/_next`, `/.well-known`. |
| `resource` | | `{ serviceName, description, mimeType, tags, iconUrl }` shown to crawlers in the 402. |
| `maxTimeoutSeconds` | `60` | How long a crawler has to complete payment. |
| `failMode` | `"closed"` | If the facilitator is down: `"closed"` returns 503, `"open"` serves the page unpaid. |
| `renderPaymentRequired` | JSON | Custom 402 body. The `PAYMENT-REQUIRED` header is added for you. |
| `onChallenge`, `onPaid`, `onRejected`, `onError` | | Hooks for logging, analytics and revenue tracking. |

Path patterns: `"/blog"` matches `/blog` and everything below it, `"/sitemap*"` is a prefix match, and you can also pass a `RegExp` or a function.

## Modules

| Import | What's in it |
| --- | --- |
| `crawl402` | `createCrawl402`, detectors, pricing helpers, facilitator client, protocol types and codecs, `withCrawl402Fetch` |
| `crawl402/next` | `crawl402Proxy` for `proxy.ts` / `middleware.ts`, `withCrawl402` for route handlers |
| `crawl402/fetch` | `withCrawl402Fetch` for any `(Request) => Response` server: Cloudflare Workers, Bun, Deno, Hono |
| `crawl402/testing` | `createSandbox()`: in-memory facilitator, wallets, and an auto-paying `fetch` |

Each part is a small interface you can replace. See [Extending crawl402](docs/extending.md) to write a custom detector, pricing rule, facilitator or framework adapter, and [Architecture](docs/architecture.md) for how a request flows through the engine.

## Testing your integration

```ts
import { createCrawl402 } from "crawl402";
import { createSandbox } from "crawl402/testing";

const sandbox = createSandbox();
const bot = sandbox.createWallet({ balance: 1_000_000n }); // 1 USDC in atomic units
const paywall = createCrawl402({ payTo: "0x…", price: "$0.002", facilitator: sandbox.facilitator });

const challenge = await paywall.evaluate(new Request("https://site.test/post", { headers: { "user-agent": "GPTBot/1.2" } }));
const header = bot.pay(challenge.response);                 // or bot.pay(res, { tamper: "underpay" })
const paid = await paywall.evaluate(new Request("https://site.test/post", {
  headers: { "user-agent": "GPTBot/1.2", "payment-signature": header },
}));
// paid.action === "paid"; sandbox.received("0x…") === 2000n
```

The sandbox signatures are not cryptographic. Never use `crawl402/testing` in production.

## Try it without installing anything

- **[Playground](https://devops-shivam.github.io/crawl402/):** an interactive page that runs the real engine in your browser. Pick a crawler, see the 402 headers, sign a simulated payment and unlock the page. To run it locally: `npm run playground`, then serve the folder (for example `npx serve playground/dist`).
- **[Example app](examples/nextjs):** a small Next.js site with a `bot` script that plays the crawler end to end.

## Payments: what's supported

- **Out of the box:** USDC on **Base** (`eip155:8453`) and **Base Sepolia** (`eip155:84532`), paid to any EVM address you control (a wallet, a Safe multisig, or a treasury address).
- **With an `asset` you provide:** other EVM chains and EIP-3009 tokens your facilitator supports.
- **Experimental:** Solana via `accepts` with `{ network: "solana:…", asset, extra: { feePayer } }`. The engine builds and matches these options, but it hasn't been tested against a live Solana facilitator yet.
- **Not supported:** direct fiat or bank payouts. Convert USDC through an exchange or off-ramp.

The facilitator decides what can actually be settled. Its `GET /supported` endpoint lists the networks and schemes it handles.

## Limits

- **User-agent spoofing.** A scraper that pretends to be Chrome isn't caught by user-agent matching. Add `missingBrowserHeaders()`, a `fromHeader()` detector fed by your CDN's bot score, or your own detector.
- **Crawlers must support x402 to pay.** Crawlers that don't will stop at the 402, which still blocks them. Treat it as "pay or don't crawl".
- **Static files served directly by your CDN** (outside the proxy matcher) aren't paywalled.
- **Caching.** 402 and paid responses are sent with `no-store` / `private` so a shared cache can't hand a paid page to an unpaid crawler. If you cache HTML at the edge, make sure the cache key varies on `User-Agent` or bypasses bots.

## Contributing

Issues and pull requests are welcome, especially new crawler signatures, payment network presets and framework adapters. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
