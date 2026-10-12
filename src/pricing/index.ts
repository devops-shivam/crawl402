import type { Detection } from "../detectors/index.js";
import { matchPath, type PathPattern } from "../core/paths.js";

/** A price in whole token units, e.g. "$0.002", "0.002" or 0.002 (USDC). */
export type Price = string | number;

export interface PriceContext {
  request: Request;
  url: URL;
  detection: NonNullable<Detection>;
}

/** Return null to let this request through free. */
export type PriceResolver = Price | null | ((ctx: PriceContext) => Price | null | Promise<Price | null>);

export async function resolvePrice(resolver: PriceResolver, ctx: PriceContext): Promise<Price | null> {
  return typeof resolver === "function" ? resolver(ctx) : resolver;
}

/**
 * Price by path. The first matching pattern wins.
 *
 *   byPath({ "/research/*": "$0.02", "/blog/*": "$0.002" }, "$0.001")
 *
 * Patterns: "/exact", "/prefix/*" (prefix and below), or a RegExp via the array form.
 */
export function byPath(
  rules: Record<string, Price | null> | Array<[PathPattern, Price | null]>,
  fallback: Price | null = null,
): (ctx: PriceContext) => Price | null {
  const entries: Array<[PathPattern, Price | null]> = Array.isArray(rules) ? rules : Object.entries(rules);
  return ({ url }) => {
    for (const [pattern, price] of entries) if (matchPath(url.pathname, pattern)) return price;
    return fallback;
  };
}

/**
 * Price by bot name or category. Bot names take precedence over categories.
 *
 *   byBot({ "ai-assistant": "$0.0005", GPTBot: "$0.003" }, "$0.002")
 */
export function byBot(rules: Record<string, Price | null>, fallback: Price | null = null): (ctx: PriceContext) => Price | null {
  const lower = new Map(Object.entries(rules).map(([k, v]) => [k.toLowerCase(), v]));
  return ({ detection }) => {
    const bot = detection.bot;
    if (bot) {
      const byName = lower.get(bot.name.toLowerCase());
      if (byName !== undefined) return byName;
      const byCategory = lower.get(String(bot.category).toLowerCase());
      if (byCategory !== undefined) return byCategory;
    }
    return fallback;
  };
}
