/**
 * Path patterns:
 * - "/blog"      matches /blog and anything below it (/blog/post)
 * - "/sitemap*"  matches anything starting with /sitemap (/sitemap-0.xml)
 * - RegExp       tested against the pathname
 * - function     called with the pathname
 */
export type PathPattern = string | RegExp | ((pathname: string) => boolean);

export function matchPath(pathname: string, pattern: PathPattern): boolean {
  if (typeof pattern === "function") return pattern(pathname);
  if (pattern instanceof RegExp) return pattern.test(pathname);
  if (pattern.endsWith("/*")) {
    const base = pattern.slice(0, -2);
    return pathname === base || pathname.startsWith(base + "/");
  }
  if (pattern.endsWith("*")) return pathname.startsWith(pattern.slice(0, -1));
  const base = pattern.length > 1 && pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
  if (base === "/") return true;
  return pathname === base || pathname.startsWith(base + "/");
}

export function matchAny(pathname: string, patterns: readonly PathPattern[]): boolean {
  return patterns.some((p) => matchPath(pathname, p));
}

/** Never charged: crawlers must always be able to read your terms and sitemap. */
export const DEFAULT_EXCLUDE: readonly PathPattern[] = [
  "/robots.txt",
  "/sitemap*",
  "/favicon*",
  "/_next",
  "/.well-known",
  "/manifest*",
];
