/**
 * Crawler detection.
 *
 * Known crawler signatures. Well-behaved AI crawlers identify themselves in the
 * User-Agent header. Spoofed user agents can't be caught by matching alone;
 * pair this with your CDN's bot management for that.
 *
 * Contributions welcome: add new crawlers here with a source link in the PR.
 */

export type BotCategory = "ai-crawler" | "ai-assistant" | "scraper" | "search-engine" | (string & {});

export interface BotSignature {
  name: string;
  category: BotCategory;
  pattern: RegExp;
}

/** Known crawlers. Extend with `userAgent({ extraBots })`. */
export const KNOWN_BOTS: readonly BotSignature[] = [
  // AI training / indexing crawlers
  { name: "GPTBot", category: "ai-crawler", pattern: /GPTBot/i },
  { name: "OAI-SearchBot", category: "ai-crawler", pattern: /OAI-SearchBot/i },
  { name: "ClaudeBot", category: "ai-crawler", pattern: /ClaudeBot|Claude-SearchBot|anthropic-ai/i },
  { name: "CCBot", category: "ai-crawler", pattern: /CCBot/i },
  { name: "Google-CloudVertexBot", category: "ai-crawler", pattern: /Google-CloudVertexBot/i },
  { name: "PerplexityBot", category: "ai-crawler", pattern: /PerplexityBot/i },
  { name: "Bytespider", category: "ai-crawler", pattern: /Bytespider/i },
  { name: "Amazonbot", category: "ai-crawler", pattern: /Amazonbot/i },
  { name: "Applebot-Extended", category: "ai-crawler", pattern: /Applebot-Extended/i },
  { name: "Meta-ExternalAgent", category: "ai-crawler", pattern: /meta-externalagent|FacebookBot/i },
  { name: "cohere-ai", category: "ai-crawler", pattern: /cohere-ai|cohere-training-data-crawler/i },
  { name: "Diffbot", category: "ai-crawler", pattern: /Diffbot/i },
  { name: "YouBot", category: "ai-crawler", pattern: /YouBot/i },
  { name: "MistralAI-User", category: "ai-crawler", pattern: /MistralAI/i },
  { name: "DeepSeekBot", category: "ai-crawler", pattern: /DeepSeek/i },
  { name: "AI2Bot", category: "ai-crawler", pattern: /AI2Bot/i },
  { name: "Timpibot", category: "ai-crawler", pattern: /Timpibot/i },
  { name: "ImagesiftBot", category: "ai-crawler", pattern: /ImagesiftBot/i },

  // On-demand fetchers acting for a user inside an AI product
  { name: "ChatGPT-User", category: "ai-assistant", pattern: /ChatGPT-User/i },
  { name: "Claude-User", category: "ai-assistant", pattern: /Claude-User|Claude-Web/i },
  { name: "Perplexity-User", category: "ai-assistant", pattern: /Perplexity-User/i },

  // Generic scrapers / HTTP libraries
  { name: "scrapy", category: "scraper", pattern: /Scrapy/i },
  { name: "python-requests", category: "scraper", pattern: /python-requests|python-urllib|aiohttp|httpx/i },
  { name: "curl/wget", category: "scraper", pattern: /^(curl|Wget)\//i },
  { name: "Go-http-client", category: "scraper", pattern: /Go-http-client/i },
  { name: "headless", category: "scraper", pattern: /HeadlessChrome|PhantomJS|Puppeteer|Playwright/i },
  { name: "node-fetch/axios", category: "scraper", pattern: /node-fetch|axios\/|undici/i },

  // Classic search engines — allowed by default (see `allowCategories`)
  { name: "Googlebot", category: "search-engine", pattern: /Googlebot/i },
  { name: "Bingbot", category: "search-engine", pattern: /bingbot/i },
  { name: "DuckDuckBot", category: "search-engine", pattern: /DuckDuckBot/i },
  { name: "Applebot", category: "search-engine", pattern: /Applebot(?!-Extended)/i },
  { name: "YandexBot", category: "search-engine", pattern: /YandexBot/i },
  { name: "Baiduspider", category: "search-engine", pattern: /Baiduspider/i },
];

export function matchBot(userAgent: string | null, bots: readonly BotSignature[]): BotSignature | null {
  if (!userAgent) return null;
  for (const bot of bots) if (bot.pattern.test(userAgent)) return bot;
  return null;
}
