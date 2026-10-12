# crawl402 Next.js example

A tiny App Router site where people read for free and AI crawlers pay per article.

```bash
cd examples/nextjs
npm install
cp .env.example .env.local
npm run dev
```

In another terminal:

```bash
npm run bot                      # crawler: 402 → sign → retry → 200
curl -i http://localhost:3000/articles/hello-crawlers                 # human: 200
curl -i -A "GPTBot/1.2" http://localhost:3000/articles/hello-crawlers # crawler: 402
curl -i -A "Googlebot/2.1" http://localhost:3000/articles/hello-crawlers # search engine: 200
```

By default the example uses the in-memory sandbox from `crawl402/testing`, so no wallet or testnet is needed.
Set `CRAWL402_FACILITATOR=x402.org` to use Base Sepolia with real test USDC; then pay with an x402 client such as `@x402/fetch`.

Files to look at:

- `lib/paywall.ts`: the shared paywall config
- `proxy.ts`: protects pages (settles before rendering)
- `app/api/data/route.ts`: protects one route handler (charges only on success)
