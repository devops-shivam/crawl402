import { createCrawl402, byPath, userAgent, httpFacilitator, X402_ORG_FACILITATOR } from "crawl402";
import { createSandbox } from "crawl402/testing";

// One paywall instance, shared by proxy.ts and the API route.
//
// By default this example uses the in-memory sandbox so you can try the whole
// flow locally with `npm run bot`. Set CRAWL402_FACILITATOR=x402.org to use
// Base Sepolia with real test USDC instead.
const useSandbox = !process.env.CRAWL402_FACILITATOR;

// Keep the sandbox on globalThis so proxy.ts, route handlers and the bot
// endpoint share one ledger across hot reloads in development.
const g = globalThis as unknown as { __crawl402Sandbox?: ReturnType<typeof createSandbox> };
export const sandbox = useSandbox ? (g.__crawl402Sandbox ??= createSandbox()) : null;

export const paywall = createCrawl402({
  payTo: process.env.CRAWL402_PAY_TO ?? "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
  network: "eip155:84532", // Base Sepolia
  facilitator: sandbox ? sandbox.facilitator : httpFacilitator(X402_ORG_FACILITATOR),
  price: byPath(
    {
      "/articles/*": "$0.002",
      "/api/data": "$0.01",
    },
    null, // everything else is free
  ),
  detectors: [userAgent()],
  resource: { serviceName: "crawl402 example", description: "Example articles" },
  onPaid: (e) =>
    console.log(`[crawl402] ${e.detection.bot?.name ?? "client"} paid ${e.amountFormatted} USDC for ${e.url} (tx ${e.transaction})`),
  onRejected: (e) => console.log(`[crawl402] rejected ${e.url}: ${e.reason}`),
});
