import { KNOWN_BOTS, matchBot, type BotCategory, type BotSignature } from "./bots.js";

export { KNOWN_BOTS, matchBot };
export type { BotCategory, BotSignature };

/**
 * What a detector decided about a request.
 * - `charge`: this client must pay.
 * - `allow`: this client is explicitly free (e.g. Googlebot); later detectors are skipped.
 * - `null`: no opinion; the next detector runs. If every detector returns null, the request passes free.
 */
export type Detection =
  | { verdict: "charge"; reason: string; bot?: BotSignature }
  | { verdict: "allow"; reason: string; bot?: BotSignature }
  | null;

/**
 * A detector inspects a request and returns a Detection.
 * Write your own as a plain function, e.g. to check a verified-bot header from your CDN.
 */
export type Detector = (request: Request) => Detection | Promise<Detection>;

export interface UserAgentDetectorOptions {
  /** Categories that always pass free. Default: ["search-engine"], so SEO is unaffected. */
  allowCategories?: BotCategory[];
  /** Bot names that pass free, e.g. a crawler you've licensed. Case-insensitive. */
  allowBots?: string[];
  /** Categories to charge. Default: every category not in `allowCategories`. */
  chargeCategories?: BotCategory[];
  /** Extra signatures, checked before the built-in list. */
  extraBots?: BotSignature[];
  /** Replace the built-in list entirely. */
  bots?: readonly BotSignature[];
}

/** Match the User-Agent against known crawlers. This is the default detector. */
export function userAgent(options: UserAgentDetectorOptions = {}): Detector {
  const bots = [...(options.extraBots ?? []), ...(options.bots ?? KNOWN_BOTS)];
  const allowCategories = new Set<string>(options.allowCategories ?? ["search-engine"]);
  const allowBots = new Set((options.allowBots ?? []).map((name) => name.toLowerCase()));
  const chargeCategories = options.chargeCategories ? new Set<string>(options.chargeCategories) : null;

  return (request) => {
    const bot = matchBot(request.headers.get("user-agent"), bots);
    if (!bot) return null;
    if (allowBots.has(bot.name.toLowerCase())) return { verdict: "allow", reason: `allow-listed bot ${bot.name}`, bot };
    if (allowCategories.has(bot.category)) return { verdict: "allow", reason: `allowed category ${bot.category}`, bot };
    if (chargeCategories && !chargeCategories.has(bot.category)) return null;
    return { verdict: "charge", reason: `matched ${bot.name}`, bot };
  };
}

/**
 * Charge clients that don't send the headers real browsers send on page loads
 * (Sec-Fetch-*, Client Hints, Accept-Language). Catches scripts and simple scrapers
 * that don't identify themselves. Put it after `userAgent()` so allowed bots stay free.
 */
export function missingBrowserHeaders(): Detector {
  return (request) => {
    const h = request.headers;
    if (!h.get("user-agent")) return { verdict: "charge", reason: "no user-agent" };
    const looksLikeBrowser = h.has("sec-fetch-mode") || h.has("sec-ch-ua") || h.has("accept-language");
    return looksLikeBrowser ? null : { verdict: "charge", reason: "no browser headers" };
  };
}

/**
 * Trust a header your CDN or WAF sets, e.g. a bot score or a verified-bot flag.
 *
 *   fromHeader("x-bot-score", (v) => Number(v) < 30)
 *
 * Only use headers your edge overwrites on every request; clients can send any header.
 */
export function fromHeader(name: string, isBot: (value: string) => boolean, reason = `header ${name}`): Detector {
  return (request) => {
    const value = request.headers.get(name);
    if (value == null) return null;
    return isBot(value) ? { verdict: "charge", reason } : null;
  };
}

/** Run detectors in order; the first non-null Detection wins. */
export async function runDetectors(detectors: readonly Detector[], request: Request): Promise<Detection> {
  for (const detect of detectors) {
    const result = await detect(request);
    if (result) return result;
  }
  return null;
}
