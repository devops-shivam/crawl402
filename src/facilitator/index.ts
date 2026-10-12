import {
  X402_VERSION,
  type PaymentPayload,
  type PaymentRequirements,
  type SettlementResponse,
  type VerifyResponse,
} from "../core/protocol.js";

/**
 * A facilitator verifies signed payments and settles them on-chain.
 * Implement this interface to use any provider, or to self-host settlement.
 */
export interface Facilitator {
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettlementResponse>;
}

export interface HttpFacilitatorOptions {
  /** Base URL. POST {url}/verify and {url}/settle are called. */
  url: string;
  /** Extra request headers, e.g. API keys. Called per request so tokens can rotate. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Per-request timeout in milliseconds. Default 10 000. */
  timeoutMs?: number;
  /** Custom fetch, e.g. for tests or tracing. Default: global fetch. */
  fetch?: typeof fetch;
}

/** The public x402.org facilitator. Intended for testnets such as Base Sepolia. */
export const X402_ORG_FACILITATOR = "https://x402.org/facilitator";

export class FacilitatorError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FacilitatorError";
  }
}

/** Facilitator client for the standard x402 v2 HTTP API. */
export function httpFacilitator(options: HttpFacilitatorOptions | string): Facilitator {
  const opts = typeof options === "string" ? { url: options } : options;
  const base = opts.url.replace(/\/+$/, "");

  async function post<T>(path: string, payload: PaymentPayload, requirements: PaymentRequirements): Promise<T> {
    const doFetch = opts.fetch ?? fetch;
    const extra = opts.headers ? await opts.headers() : {};
    const response = await doFetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...extra },
      body: JSON.stringify({ x402Version: X402_VERSION, paymentPayload: payload, paymentRequirements: requirements }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new FacilitatorError(`facilitator ${path} returned ${response.status}: ${text.slice(0, 200)}`, response.status);
    }
  }

  return {
    verify: (payload, requirements) => post<VerifyResponse>("/verify", payload, requirements),
    settle: (payload, requirements) => post<SettlementResponse>("/settle", payload, requirements),
  };
}
