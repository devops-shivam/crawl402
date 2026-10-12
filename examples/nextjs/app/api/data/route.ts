import { withCrawl402 } from "crawl402/next";
import { paywall } from "../../../lib/paywall";

// Route handlers use verify → run → settle: the crawler is only charged if this returns < 400.
export const GET = withCrawl402(async () => {
  return Response.json({ temperatureC: 21.4, updatedAt: new Date().toISOString() });
}, paywall);
