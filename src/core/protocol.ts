/**
 * x402 protocol v2 types and header codecs.
 * Spec: https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md
 *
 * Only Web-standard APIs are used (TextEncoder, atob/btoa), so this runs on the
 * Edge runtime, Node.js, Bun, Deno and Cloudflare Workers.
 */

export const X402_VERSION = 2 as const;

/** HTTP header names defined by the x402 v2 HTTP transport. */
export const HEADERS = {
  /** Server → client. Base64 JSON `PaymentRequired`, sent with status 402. */
  paymentRequired: "PAYMENT-REQUIRED",
  /** Client → server. Base64 JSON `PaymentPayload`. */
  paymentSignature: "PAYMENT-SIGNATURE",
  /** Server → client. Base64 JSON `SettlementResponse`. */
  paymentResponse: "PAYMENT-RESPONSE",
} as const;

export interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
  /** Printable ASCII, max 32 characters. */
  serviceName?: string;
  /** Max 5 entries, each max 32 characters. */
  tags?: string[];
  iconUrl?: string;
}

export interface PaymentRequirements {
  /** Payment scheme, e.g. "exact". */
  scheme: string;
  /** CAIP-2 network id, e.g. "eip155:8453". */
  network: string;
  /** Amount in the asset's atomic units, as a decimal string. */
  amount: string;
  /** Token contract / mint address. */
  asset: string;
  /** Recipient address. */
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface PaymentRequired {
  x402Version: typeof X402_VERSION;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirements[];
  extensions?: Record<string, unknown>;
}

export interface PaymentPayload {
  x402Version: number;
  resource?: ResourceInfo;
  accepted: PaymentRequirements;
  /** Scheme-specific data, e.g. `{ signature, authorization }` for EVM "exact". */
  payload: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface SettlementResponse {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction: string;
  network: string;
  amount?: string;
}

/** Encode any JSON value as the base64 string an x402 header carries. UTF-8 safe. */
export function encodeHeader(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Decode a base64 JSON x402 header. Throws on malformed input. */
export function decodeHeader<T = unknown>(header: string): T {
  const binary = atob(header.trim());
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/**
 * Convert a human price to atomic units.
 * `toAtomicUnits("$0.002", 6) === "2000"`. A leading "$" is allowed and ignored.
 */
export function toAtomicUnits(price: string | number, decimals: number): string {
  const text = String(price).trim().replace(/^\$/, "");
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`crawl402: invalid price "${price}"`);
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) {
    throw new Error(`crawl402: price "${price}" has more than ${decimals} decimal places`);
  }
  const atomic = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (atomic <= 0n) throw new Error("crawl402: price must be greater than zero");
  return atomic.toString();
}

/** Convert atomic units back to a decimal string. `fromAtomicUnits("2000", 6) === "0.002"`. */
export function fromAtomicUnits(amount: string | bigint, decimals: number): string {
  const value = BigInt(amount);
  const base = 10n ** BigInt(decimals);
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return (value / base).toString() + (fraction ? "." + fraction : "");
}
