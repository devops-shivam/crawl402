import { NextResponse, type NextRequest } from "next/server";
import type { Crawl402, Crawl402Config, HandleOptions } from "../core/engine.js";
import { toCrawl402 } from "./fetch.js";

type ProxyResult = Response | NextResponse | undefined | null | void;

export interface Crawl402ProxyOptions {
  /**
   * Your existing proxy/middleware logic. Runs only for requests that are allowed through
   * (humans, free bots, and crawlers that paid). Return nothing to continue.
   */
  next?: (request: NextRequest) => ProxyResult | Promise<ProxyResult>;
}

/**
 * Next.js proxy (`proxy.ts`, Next 16+) or middleware (`middleware.ts`, Next 13.4–15).
 * Payment is settled before the page renders, so crawlers only get content once the money has moved.
 *
 *   // proxy.ts
 *   import { crawl402Proxy } from "crawl402/next";
 *   export default crawl402Proxy({ payTo: "0x…", price: "$0.002" });
 *   export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
 */
export function crawl402Proxy(config: Crawl402Config | Crawl402, options: Crawl402ProxyOptions = {}) {
  const paywall = toCrawl402(config);

  return async function proxy(request: NextRequest): Promise<Response> {
    const decision = await paywall.evaluate(request);
    if (decision.action === "respond") return decision.response;

    const result = options.next ? await options.next(request) : undefined;
    const response = result ?? NextResponse.next();
    if (decision.action === "paid") {
      for (const [key, value] of Object.entries(decision.headers)) response.headers.set(key, value);
    }
    return response;
  };
}

/**
 * Wrap an App Router route handler. By default the crawler is charged only if the handler
 * returns a status below 400 (verify → run → settle).
 *
 *   // app/api/articles/route.ts
 *   export const GET = withCrawl402(async () => Response.json(data), { payTo, price: "$0.01" });
 */
export function withCrawl402<Rest extends unknown[]>(
  handler: (request: NextRequest, ...rest: Rest) => Response | Promise<Response>,
  config: Crawl402Config | Crawl402,
  options?: HandleOptions,
): (request: NextRequest, ...rest: Rest) => Promise<Response> {
  const paywall = toCrawl402(config);
  return (request, ...rest) => paywall.handle(request, () => handler(request, ...rest), options);
}

export { createCrawl402 } from "../core/engine.js";
