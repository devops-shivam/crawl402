// Next.js 16+. On Next 13.4–15 name this file middleware.ts instead.
import { crawl402Proxy } from "crawl402/next";
import { paywall } from "./lib/paywall";

export default crawl402Proxy(paywall);

// Must be a literal so Next can read it at build time. Skips static assets.
// /api routes are excluded here because app/api/data/route.ts wraps itself with withCrawl402.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|css|js|woff2?)$).*)"],
};
