# Extending crawl402

Every moving part is a plain function or a small interface. You can replace any of them without forking.

## Custom detectors

A detector receives the `Request` and returns a verdict, or `null` for no opinion:

```ts
import type { Detector } from "crawl402";

// Trust your CDN's verified-bot flag. Only use headers your edge overwrites on every request.
export const cdnVerifiedBot: Detector = (request) => {
  const flag = request.headers.get("x-verified-bot");
  if (flag === "search") return { verdict: "allow", reason: "verified search engine" };
  if (flag === "ai") return { verdict: "charge", reason: "verified AI crawler" };
  return null;
};
```

Detectors run in order and the first non-null verdict wins, so put allow rules first:

```ts
createCrawl402({
  detectors: [cdnVerifiedBot, userAgent(), missingBrowserHeaders()],
  // ...
});
```

Built-ins:

- `userAgent(options)` matches the User-Agent against [known crawlers](../src/detectors/bots.ts). Options: `allowCategories`, `allowBots`, `chargeCategories`, `extraBots`, `bots`.
- `missingBrowserHeaders()` charges clients that don't send the headers browsers send on page loads.
- `fromHeader(name, isBot)` charges based on a header, such as a bot score from your CDN.

### Adding a crawler to the built-in list

Edit `src/detectors/bots.ts` and open a pull request with a link to the crawler's documentation. Categories:

| Category | Meaning | Charged by default |
| --- | --- | --- |
| `ai-crawler` | Bulk crawling for training or indexing | Yes |
| `ai-assistant` | Fetches on behalf of a user inside an AI product | Yes |
| `scraper` | Generic HTTP libraries and headless browsers | Yes |
| `search-engine` | Classic search indexing | No |

## Custom pricing

`price` accepts a value, `null` for free, or a function that can be async:

```ts
createCrawl402({
  price: async ({ url, detection, request }) => {
    const article = await getArticleMeta(url.pathname);
    if (!article) return null;
    return article.premium ? "$0.01" : "$0.001";
  },
});
```

Helpers compose with your own logic:

```ts
import { byPath, byBot } from "crawl402";

const pathPrice = byPath({ "/research/*": "$0.02" }, "$0.002");
const botPrice = byBot({ "ai-assistant": "$0.0005" }, null);

createCrawl402({ price: (ctx) => botPrice(ctx) ?? pathPrice(ctx) });
```

## More payment networks and tokens

Offer several options; the crawler pays with whichever it supports:

```ts
import { createCrawl402, usdc } from "crawl402";

createCrawl402({
  price: "$0.002",
  accepts: [
    { network: "eip155:8453", payTo: "0xYourEvmAddress" },                    // USDC on Base (preset)
    { network: "eip155:43114", payTo: "0xYourEvmAddress",                     // any EIP-3009 token
      asset: { address: "0xTokenAddress", decimals: 6, extra: { name: "USD Coin", version: "2" }, symbol: "USDC" } },
    { network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", payTo: "YourSolanaAddress", // experimental
      asset: { address: "UsdcMintAddress", decimals: 6, symbol: "USDC" }, extra: { feePayer: "FacilitatorSignerAddress" } },
  ],
});
```

`extra` must match what your facilitator expects for that network. On EVM it carries the token's EIP-712 domain `name` and `version`. Check the token contract or your facilitator's docs.

To add a preset to the package itself, add it to `src/core/assets.ts` with a link to the official contract address in your pull request.

## Custom facilitators

Anything that implements two methods works:

```ts
import type { Facilitator } from "crawl402";

export const myFacilitator: Facilitator = {
  async verify(payload, requirements) {
    // Return { isValid: true, payer } or { isValid: false, invalidReason }
  },
  async settle(payload, requirements) {
    // Return { success: true, transaction, network, payer } or { success: false, errorReason, transaction: "", network }
  },
};
```

For any provider that speaks the standard x402 HTTP API, use `httpFacilitator`:

```ts
httpFacilitator({
  url: "https://facilitator.example.com",
  headers: async () => ({ Authorization: `Bearer ${await getToken()}` }),
  timeoutMs: 8000,
});
```

## Framework adapters

The engine only needs a `Request`. `withCrawl402Fetch` covers any server that speaks fetch:

```ts
// Cloudflare Workers
import { withCrawl402Fetch } from "crawl402/fetch";
export default { fetch: withCrawl402Fetch(handleRequest, { payTo: "0x…", price: "$0.002" }) };

// Bun
Bun.serve({ fetch: withCrawl402Fetch(app.fetch, paywall) });

// Hono (wrap the whole app)
export default { fetch: withCrawl402Fetch(app.fetch, paywall) };
```

For a framework with its own request type, convert to a `Request`, call `paywall.evaluate()` or `paywall.handle()`, and convert back. Here is an Express sketch:

```ts
import { createCrawl402 } from "crawl402";
const paywall = createCrawl402({ payTo: "0x…", price: "$0.002" });

app.use(async (req, res, next) => {
  const request = new Request(`${req.protocol}://${req.get("host")}${req.originalUrl}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
  });
  const decision = await paywall.evaluate(request);
  if (decision.action === "respond") {
    res.status(decision.response.status);
    decision.response.headers.forEach((v, k) => res.setHeader(k, v));
    return res.send(await decision.response.text());
  }
  if (decision.action === "paid") for (const [k, v] of Object.entries(decision.headers)) res.setHeader(k, v);
  next();
});
```

Pull requests for first-class adapters (Express, Fastify, Astro, SvelteKit, Remix) are welcome. Put them in `src/adapters/`, add a subpath export in `package.json`, and add tests that run the sandbox flow through the adapter.

## Custom 402 responses

```ts
createCrawl402({
  renderPaymentRequired: ({ paymentRequired, detection }) =>
    new Response(`<h1>This content is available to AI crawlers for ${paymentRequired.accepts[0].amount} units</h1>`, {
      headers: { "content-type": "text/html" },
    }),
});
```

The status is always 402 and the `PAYMENT-REQUIRED` header is always added, so x402 clients keep working.
