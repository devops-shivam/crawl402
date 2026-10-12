import { createCrawl402, type Crawl402, type Crawl402Config, type HandleOptions } from "../core/engine.js";

/** Accept either a config or an existing instance, so one paywall can be shared across adapters. */
export function toCrawl402(configOrInstance: Crawl402Config | Crawl402): Crawl402 {
  return "evaluate" in configOrInstance && typeof configOrInstance.evaluate === "function"
    ? (configOrInstance as Crawl402)
    : createCrawl402(configOrInstance as Crawl402Config);
}

/**
 * Wrap any fetch-style handler `(request, ...rest) => Response`.
 * Works with Cloudflare Workers, Bun.serve, Deno.serve, Hono's `app.fetch` and similar.
 *
 *   export default { fetch: withCrawl402Fetch(app.fetch, { payTo, price: "$0.002" }) };
 */
export function withCrawl402Fetch<Rest extends unknown[]>(
  handler: (request: Request, ...rest: Rest) => Response | Promise<Response>,
  config: Crawl402Config | Crawl402,
  options?: HandleOptions,
): (request: Request, ...rest: Rest) => Promise<Response> {
  const paywall = toCrawl402(config);
  return (request, ...rest) => paywall.handle(request, () => handler(request, ...rest), options);
}
