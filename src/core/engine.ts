import { runDetectors, userAgent, type Detection, type Detector } from "../detectors/index.js";
import { httpFacilitator, X402_ORG_FACILITATOR, type Facilitator, type HttpFacilitatorOptions } from "../facilitator/index.js";
import { resolvePrice, type PriceContext, type PriceResolver } from "../pricing/index.js";
import { NETWORKS, isValidAddress, sameAddress, usdc, type Asset } from "./assets.js";
import { DEFAULT_EXCLUDE, matchAny, type PathPattern } from "./paths.js";
import {
  HEADERS,
  X402_VERSION,
  decodeHeader,
  encodeHeader,
  fromAtomicUnits,
  toAtomicUnits,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type ResourceInfo,
  type SettlementResponse,
} from "./protocol.js";

/** One way a crawler can pay. Offer several to accept more than one network or token. */
export interface PaymentOption {
  /** CAIP-2 network id, e.g. "eip155:8453" (Base). */
  network: string;
  /** Address that receives the payment. */
  payTo: string;
  /** Token to charge in. Default: USDC on `network` (needs a preset). */
  asset?: Asset;
  /** Payment scheme. Default "exact". */
  scheme?: string;
  /** Price for this option only; falls back to the top-level `price`. Return null to hide the option. */
  price?: PriceResolver;
  /** Default: the top-level `maxTimeoutSeconds`, else 60. */
  maxTimeoutSeconds?: number;
  /** Merged into `PaymentRequirements.extra`, e.g. `{ feePayer }` for Solana. */
  extra?: Record<string, unknown>;
}

export interface CrawlerEvent {
  request: Request;
  /** Resource URL without the query string. */
  url: string;
  detection: NonNullable<Detection>;
}

export interface ChallengeEvent extends CrawlerEvent {
  paymentRequired: PaymentRequired;
}

export interface PaidEvent extends CrawlerEvent {
  requirements: PaymentRequirements;
  settlement: SettlementResponse;
  /** Amount in atomic units. */
  amount: string;
  /** Amount as a decimal string in whole token units, e.g. "0.002". */
  amountFormatted: string;
  payer?: string;
  transaction: string;
  network: string;
}

export interface RejectedEvent extends CrawlerEvent {
  /** x402 error code, e.g. "insufficient_funds" or "invalid_payment_requirements". */
  reason: string;
}

export interface Crawl402Config {
  /** Price per request, e.g. "$0.002". A function lets you price per path or per bot; null means free. */
  price: PriceResolver;

  /** Shorthand for a single USDC option: recipient address. */
  payTo?: string;
  /** Shorthand network. Default "eip155:84532" (Base Sepolia testnet). */
  network?: string;
  /** Shorthand token override. Default: USDC on `network`. */
  asset?: Asset;
  /** Full list of payment options. When set, `payTo` / `network` / `asset` are ignored. */
  accepts?: PaymentOption[];

  /** Facilitator instance, options, or URL. Default: the x402.org testnet facilitator. */
  facilitator?: Facilitator | HttpFacilitatorOptions | string;

  /** Who to charge. Run in order; the first non-null verdict wins. Default: [userAgent()]. */
  detectors?: Detector[];
  /** Bypass the paywall entirely, e.g. for signed-in users or partners with an API key. */
  skip?: (request: Request) => boolean | Promise<boolean>;

  /** Only these paths are paywalled. Default: all paths. */
  protect?: PathPattern[];
  /** Never paywalled, in addition to robots.txt, sitemaps, favicon, /_next and /.well-known. */
  exclude?: PathPattern[];

  /** Describes your content in the 402 response. `url` is filled in per request. */
  resource?: Omit<ResourceInfo, "url">;
  /** Seconds a crawler has to complete payment. Default 60. */
  maxTimeoutSeconds?: number;
  /**
   * If the facilitator can't be reached: "closed" (default) answers 503 and keeps content locked;
   * "open" serves the content unpaid.
   */
  failMode?: "closed" | "open";

  /** Replace the default JSON 402 body. The PAYMENT-REQUIRED header is added for you. */
  renderPaymentRequired?: (event: ChallengeEvent) => Response | Promise<Response>;

  onChallenge?: (event: ChallengeEvent) => void | Promise<void>;
  onPaid?: (event: PaidEvent) => void | Promise<void>;
  onRejected?: (event: RejectedEvent) => void | Promise<void>;
  onError?: (error: unknown, request: Request) => void;
}

export type Decision =
  /** Serve normally: not a crawler, an allowed crawler, a free path, or fail-open. */
  | { action: "pass"; detection: Detection }
  /** The crawler paid. Serve the content and add `headers` to the response. */
  | { action: "paid"; headers: Record<string, string>; event: PaidEvent }
  /** Send this response instead of the content (402 or 503). */
  | { action: "respond"; response: Response };

export interface HandleOptions {
  /**
   * When to collect the payment.
   * - "after" (default): verify, run the handler, settle only if it returned status < 400.
   *   The crawler isn't charged for errors. This is the x402 "authorization" flow.
   * - "before": settle first, then run the handler.
   */
  settle?: "after" | "before";
}

export interface Crawl402 {
  /** Decide what to do with a request, settling payment up front. Used by proxies and middleware. */
  evaluate(request: Request): Promise<Decision>;
  /** Run `handler` behind the paywall. Used by route handlers and fetch-style servers. */
  handle(request: Request, handler: () => Response | Promise<Response>, options?: HandleOptions): Promise<Response>;
}

// ---------------------------------------------------------------------------

type Prepared =
  | { kind: "pass"; detection: Detection }
  | { kind: "respond"; response: Response }
  | {
      kind: "payment";
      event: CrawlerEvent;
      payload: PaymentPayload;
      requirements: PaymentRequirements;
      decimals: number;
      challenge: (error: string) => Promise<Response>;
    };

type Step<T> = { ok: true; value: T } | { ok: false; response: Response } | { ok: "failopen" };

interface ResolvedOption extends Omit<PaymentOption, "asset"> {
  asset: Asset;
}

let warnedMainnetDefault = false;

function resolveOptions(config: Crawl402Config): ResolvedOption[] {
  const raw: PaymentOption[] = config.accepts?.length
    ? config.accepts
    : [{ network: config.network ?? NETWORKS.baseSepolia, payTo: config.payTo ?? "", asset: config.asset }];

  return raw.map((option) => {
    if (!option.payTo) throw new Error("crawl402: `payTo` is required (the address that receives payments)");
    if (!isValidAddress(option.network, option.payTo)) {
      throw new Error(`crawl402: "${option.payTo}" is not a valid address for ${option.network}`);
    }
    return { ...option, asset: option.asset ?? usdc(option.network) };
  });
}

function resolveFacilitator(config: Crawl402Config, options: ResolvedOption[]): Facilitator {
  const f = config.facilitator;
  if (f && typeof f === "object" && "verify" in f && "settle" in f) return f;
  if (f) return httpFacilitator(f as HttpFacilitatorOptions | string);
  if (!warnedMainnetDefault && options.some((o) => o.network === NETWORKS.base)) {
    warnedMainnetDefault = true;
    console.warn(
      "[crawl402] Base mainnet is configured without a `facilitator`. The default x402.org facilitator is meant for testnets; " +
        "set `facilitator` to a mainnet provider.",
    );
  }
  return httpFacilitator(X402_ORG_FACILITATOR);
}

function sameRequirements(a: PaymentRequirements, b: PaymentRequirements): boolean {
  return (
    a.scheme === b.scheme &&
    a.network === b.network &&
    a.amount === b.amount &&
    sameAddress(a.network, a.asset, b.asset) &&
    sameAddress(a.network, a.payTo, b.payTo)
  );
}

const NO_STORE = { "cache-control": "no-store" };

/** Create a paywall. Framework-agnostic: takes a standard `Request`. */
export function createCrawl402(config: Crawl402Config): Crawl402 {
  const options = resolveOptions(config);
  const facilitator = resolveFacilitator(config, options);
  const detectors = config.detectors ?? [userAgent()];
  const exclude = [...DEFAULT_EXCLUDE, ...(config.exclude ?? [])];

  async function buildRequirements(ctx: PriceContext) {
    const base = await resolvePrice(config.price, ctx);
    const list: Array<{ requirements: PaymentRequirements; decimals: number; symbol?: string }> = [];
    for (const option of options) {
      const price = option.price !== undefined ? await resolvePrice(option.price, ctx) : base;
      if (price == null) continue;
      const extra = { ...(option.asset.extra ?? {}), ...(option.extra ?? {}) };
      list.push({
        decimals: option.asset.decimals,
        symbol: option.asset.symbol,
        requirements: {
          scheme: option.scheme ?? "exact",
          network: option.network,
          amount: toAtomicUnits(price, option.asset.decimals),
          asset: option.asset.address,
          payTo: option.payTo,
          maxTimeoutSeconds: option.maxTimeoutSeconds ?? config.maxTimeoutSeconds ?? 60,
          ...(Object.keys(extra).length ? { extra } : {}),
        },
      });
    }
    return list;
  }

  async function paymentRequiredResponse(event: CrawlerEvent, accepts: PaymentRequirements[], error: string, label: string) {
    const paymentRequired: PaymentRequired = {
      x402Version: X402_VERSION,
      error,
      resource: {
        mimeType: "text/html",
        description: "Automated access to this content requires a micropayment.",
        ...config.resource,
        ...(config.resource?.serviceName ? { serviceName: config.resource.serviceName.slice(0, 32) } : {}),
        url: event.url,
      },
      accepts,
    };
    const challenge: ChallengeEvent = { ...event, paymentRequired };
    const custom = config.renderPaymentRequired ? await config.renderPaymentRequired(challenge) : null;
    const response =
      custom ??
      new Response(JSON.stringify({ ...paymentRequired, message: `Payment required for automated access: ${label}. See https://x402.org` }, null, 2), {
        status: 402,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    const headers = new Headers(response.headers);
    headers.set(HEADERS.paymentRequired, encodeHeader(paymentRequired));
    headers.set("cache-control", "no-store");
    headers.set("vary", "User-Agent, PAYMENT-SIGNATURE");
    headers.set("access-control-expose-headers", `${HEADERS.paymentRequired}, ${HEADERS.paymentResponse}`);
    return { response: new Response(response.body, { status: 402, headers }), challenge };
  }

  async function prepare(request: Request): Promise<Prepared> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return { kind: "pass", detection: null };
    if (matchAny(url.pathname, exclude)) return { kind: "pass", detection: null };
    if (config.protect && !matchAny(url.pathname, config.protect)) return { kind: "pass", detection: null };
    if (config.skip && (await config.skip(request))) return { kind: "pass", detection: null };

    const signature = request.headers.get(HEADERS.paymentSignature);
    let detection = await runDetectors(detectors, request);
    // A client offering payment is treated as a crawler unless explicitly allowed.
    if (!detection && signature) detection = { verdict: "charge", reason: "payment offered" };
    if (!detection || detection.verdict === "allow") return { kind: "pass", detection };

    const event: CrawlerEvent = { request, url: url.origin + url.pathname, detection };
    const offered = await buildRequirements({ request, url, detection });
    if (offered.length === 0) return { kind: "pass", detection };

    const accepts = offered.map((o) => o.requirements);
    const label = offered.map((o) => `${fromAtomicUnits(o.requirements.amount, o.decimals)} ${o.symbol ?? "tokens"} on ${o.requirements.network}`).join(" or ");
    const challenge = async (error: string) => (await paymentRequiredResponse(event, accepts, error, label)).response;
    const reject = async (reason: string): Promise<Prepared> => {
      await config.onRejected?.({ ...event, reason });
      return { kind: "respond", response: await challenge(reason) };
    };

    if (!signature) {
      const built = await paymentRequiredResponse(event, accepts, "PAYMENT-SIGNATURE header is required", label);
      await config.onChallenge?.(built.challenge);
      return { kind: "respond", response: built.response };
    }

    let payload: PaymentPayload;
    try {
      payload = decodeHeader<PaymentPayload>(signature);
    } catch {
      return reject("invalid_payload");
    }
    if (payload?.x402Version !== X402_VERSION) return reject("invalid_x402_version");
    // Never trust the client's copy of the terms; it must equal one we offered.
    const match = payload.accepted && offered.find((o) => sameRequirements(o.requirements, payload.accepted));
    if (!match) return reject("invalid_payment_requirements");

    return { kind: "payment", event, payload, requirements: match.requirements, decimals: match.decimals, challenge };
  }

  async function guarded<T>(request: Request, fn: () => Promise<T>): Promise<Step<T>> {
    try {
      return { ok: true, value: await fn() };
    } catch (error) {
      config.onError?.(error, request);
      if (config.failMode === "open") return { ok: "failopen" };
      return {
        ok: false,
        response: new Response(JSON.stringify({ error: "payment_service_unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json", "retry-after": "30", ...NO_STORE },
        }),
      };
    }
  }

  async function verify(p: Extract<Prepared, { kind: "payment" }>): Promise<Step<true>> {
    const step = await guarded(p.event.request, () => facilitator.verify(p.payload, p.requirements));
    if (step.ok !== true) return step;
    if (!step.value.isValid) {
      const reason = step.value.invalidReason ?? "invalid_payment";
      await config.onRejected?.({ ...p.event, reason });
      return { ok: false, response: await p.challenge(reason) };
    }
    return { ok: true, value: true };
  }

  async function settle(p: Extract<Prepared, { kind: "payment" }>): Promise<Step<{ headers: Record<string, string>; event: PaidEvent }>> {
    const step = await guarded(p.event.request, () => facilitator.settle(p.payload, p.requirements));
    if (step.ok !== true) return step;
    const settlement = step.value;
    if (!settlement.success) {
      const reason = settlement.errorReason ?? "settlement_failed";
      await config.onRejected?.({ ...p.event, reason });
      return { ok: false, response: await p.challenge(reason) };
    }
    const event: PaidEvent = {
      ...p.event,
      requirements: p.requirements,
      settlement,
      amount: settlement.amount ?? p.requirements.amount,
      amountFormatted: fromAtomicUnits(settlement.amount ?? p.requirements.amount, p.decimals),
      payer: settlement.payer,
      transaction: settlement.transaction,
      network: settlement.network,
    };
    await config.onPaid?.(event);
    return {
      ok: true,
      value: {
        event,
        headers: {
          [HEADERS.paymentResponse]: encodeHeader(settlement),
          "cache-control": "private, no-store",
          "access-control-expose-headers": HEADERS.paymentResponse,
        },
      },
    };
  }

  function withHeaders(response: Response, headers: Record<string, string>): Response {
    const merged = new Headers(response.headers);
    for (const [k, v] of Object.entries(headers)) merged.set(k, v);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged });
  }

  async function decide(p: Prepared): Promise<Decision> {
      if (p.kind === "pass") return { action: "pass", detection: p.detection };
      if (p.kind === "respond") return { action: "respond", response: p.response };
      const v = await verify(p);
      if (v.ok === "failopen") return { action: "pass", detection: p.event.detection };
      if (!v.ok) return { action: "respond", response: v.response };
      const s = await settle(p);
      if (s.ok === "failopen") return { action: "pass", detection: p.event.detection };
      if (!s.ok) return { action: "respond", response: s.response };
      return { action: "paid", headers: s.value.headers, event: s.value.event };
  }

  return {
    async evaluate(request) {
      return decide(await prepare(request));
    },

    async handle(request, handler, handleOptions = {}) {
      const p = await prepare(request);
      if (p.kind === "pass") return handler();
      if (p.kind === "respond") return p.response;

      if (handleOptions.settle === "before") {
        const d = await decide(p);
        if (d.action === "respond") return d.response;
        const response = await handler();
        return d.action === "paid" ? withHeaders(response, d.headers) : response;
      }

      const v = await verify(p);
      if (v.ok === "failopen") return handler();
      if (!v.ok) return v.response;
      const response = await handler();
      if (response.status >= 400) return response; // not charged for errors
      const s = await settle(p);
      if (s.ok === "failopen") return response;
      if (!s.ok) {
        await response.body?.cancel();
        return s.response;
      }
      return withHeaders(response, s.value.headers);
    },
  };
}
