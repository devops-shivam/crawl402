/**
 * Test helpers: an in-memory facilitator and wallets that sign simulated payments.
 * Use them to test your integration end to end without a blockchain or real money.
 *
 * Signatures here are NOT cryptographic. Never use this module in production.
 */
import type { Facilitator } from "../facilitator/index.js";
import {
  HEADERS,
  X402_VERSION,
  decodeHeader,
  encodeHeader,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type SettlementResponse,
  type VerifyResponse,
} from "../core/protocol.js";

export interface SandboxCall {
  endpoint: "verify" | "settle";
  payload: PaymentPayload;
  requirements: PaymentRequirements;
  response: VerifyResponse | SettlementResponse | { error: string };
}

export type Tamper = "underpay" | "wrongRecipient" | "expired" | "badSignature";

export interface PayOptions {
  /** Pick which offered option to pay. Default: the first. */
  choose?: (accepts: PaymentRequirements[]) => PaymentRequirements | undefined;
  /** Produce a deliberately bad payment, to test rejections. */
  tamper?: Tamper;
}

export interface SandboxWallet {
  readonly address: string;
  /** Balance in atomic units. */
  balance(): bigint;
  fund(amount: bigint | number): void;
  /** Build a PAYMENT-SIGNATURE header value from a 402 response, its header, or the decoded object. */
  pay(from: Response | string | PaymentRequired, options?: PayOptions): string;
}

export interface Sandbox {
  facilitator: Facilitator;
  createWallet(options?: { address?: string; balance?: bigint | number }): SandboxWallet;
  /** Atomic units received per recipient address (lower-cased). */
  received(address: string): bigint;
  /** Every verify/settle call, most recent last. */
  readonly calls: readonly SandboxCall[];
  /** Simulate the facilitator being unreachable. */
  setOffline(offline: boolean): void;
  /** Delay every facilitator call, in milliseconds. */
  setLatency(ms: number): void;
  /** A fetch that pays 402 responses automatically, like an x402-aware crawler. */
  payingFetch(wallet: SandboxWallet, fetchImpl?: typeof fetch, options?: PayOptions): typeof fetch;
}

function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return "0x" + Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fakeSign(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let out = "";
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < text.length; i++) {
      h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619) >>> 0;
      h2 = Math.imul(h2 + text.charCodeAt(i) + round, 2246822519) >>> 0;
    }
    out += ((h1 ^ h2) >>> 0).toString(16).padStart(8, "0") + h1.toString(16).padStart(8, "0");
  }
  return "0x" + out.slice(0, 130);
}

interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

const authMessage = (a: Authorization, secret: string) =>
  [a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, secret].join("|").toLowerCase();

/** Create an isolated sandbox with its own facilitator, wallets and ledger. */
export function createSandbox(): Sandbox {
  const wallets = new Map<string, { secret: string; balance: bigint }>();
  const received = new Map<string, bigint>();
  const usedNonces = new Set<string>();
  const calls: SandboxCall[] = [];
  let offline = false;
  let latency = 0;

  function check(payload: PaymentPayload, req: PaymentRequirements): string | null {
    const sig = payload.payload?.signature as string | undefined;
    const a = payload.payload?.authorization as Authorization | undefined;
    if (!a || !sig) return "invalid_payload";
    const wallet = wallets.get(a.from.toLowerCase());
    if (!wallet || sig !== fakeSign(authMessage(a, wallet.secret))) return "invalid_exact_evm_payload_signature";
    if (a.to.toLowerCase() !== req.payTo.toLowerCase()) return "invalid_exact_evm_payload_recipient_mismatch";
    if (a.value !== req.amount) return "invalid_exact_evm_payload_authorization_value_mismatch";
    const now = Math.floor(Date.now() / 1000);
    if (now < Number(a.validAfter)) return "invalid_exact_evm_payload_authorization_valid_after";
    if (now > Number(a.validBefore)) return "invalid_exact_evm_payload_authorization_valid_before";
    if (usedNonces.has(a.nonce)) return "invalid_transaction_state";
    if (wallet.balance < BigInt(a.value)) return "insufficient_funds";
    return null;
  }

  async function call<T extends VerifyResponse | SettlementResponse>(
    endpoint: "verify" | "settle",
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    run: () => T,
  ): Promise<T> {
    if (latency) await new Promise((r) => setTimeout(r, latency));
    if (offline) {
      calls.push({ endpoint, payload, requirements, response: { error: "facilitator offline" } });
      throw new Error("sandbox facilitator is offline");
    }
    const response = run();
    calls.push({ endpoint, payload, requirements, response });
    return response;
  }

  const facilitator: Facilitator = {
    verify: (payload, requirements) =>
      call("verify", payload, requirements, () => {
        const reason = check(payload, requirements);
        const from = (payload.payload?.authorization as Authorization | undefined)?.from;
        return reason ? { isValid: false, invalidReason: reason, payer: from } : { isValid: true, payer: from };
      }),
    settle: (payload, requirements) =>
      call("settle", payload, requirements, () => {
        const reason = check(payload, requirements);
        const a = payload.payload?.authorization as Authorization | undefined;
        if (reason || !a) {
          return { success: false, errorReason: reason ?? "invalid_payload", payer: a?.from, transaction: "", network: requirements.network };
        }
        const wallet = wallets.get(a.from.toLowerCase())!;
        wallet.balance -= BigInt(a.value);
        const to = a.to.toLowerCase();
        received.set(to, (received.get(to) ?? 0n) + BigInt(a.value));
        usedNonces.add(a.nonce);
        return { success: true, payer: a.from, transaction: randomHex(32), network: requirements.network, amount: a.value };
      }),
  };

  function createWallet(options: { address?: string; balance?: bigint | number } = {}): SandboxWallet {
    const address = options.address ?? "0x" + randomHex(20).slice(2);
    const state = { secret: randomHex(16), balance: BigInt(options.balance ?? 1_000_000n) };
    wallets.set(address.toLowerCase(), state);
    return {
      address,
      balance: () => state.balance,
      fund: (amount) => {
        state.balance += BigInt(amount);
      },
      pay(from, payOptions = {}) {
        let required: PaymentRequired;
        if (typeof from === "string") required = decodeHeader<PaymentRequired>(from);
        else if (from instanceof Response) {
          const header = from.headers.get(HEADERS.paymentRequired);
          if (!header) throw new Error("crawl402/testing: response has no PAYMENT-REQUIRED header");
          required = decodeHeader<PaymentRequired>(header);
        } else required = from;

        const chosen = payOptions.choose ? payOptions.choose(required.accepts) : required.accepts[0];
        if (!chosen) throw new Error("crawl402/testing: no payment option to pay");
        const accepted = { ...chosen };
        const now = Math.floor(Date.now() / 1000);
        const auth: Authorization = {
          from: address,
          to: accepted.payTo,
          value: accepted.amount,
          validAfter: String(now - 5),
          validBefore: String(now + accepted.maxTimeoutSeconds),
          nonce: randomHex(32),
        };
        if (payOptions.tamper === "underpay") accepted.amount = auth.value = "1";
        if (payOptions.tamper === "wrongRecipient") auth.to = "0x000000000000000000000000000000000000dEaD";
        if (payOptions.tamper === "expired") {
          auth.validAfter = String(now - 600);
          auth.validBefore = String(now - 300);
        }
        let signature = fakeSign(authMessage(auth, state.secret));
        if (payOptions.tamper === "badSignature") signature = signature.slice(0, -8) + "deadbeef";
        const payload: PaymentPayload = {
          x402Version: X402_VERSION,
          resource: required.resource,
          accepted,
          payload: { signature, authorization: auth },
        };
        return encodeHeader(payload);
      },
    };
  }

  return {
    facilitator,
    createWallet,
    received: (address) => received.get(address.toLowerCase()) ?? 0n,
    get calls() {
      return calls;
    },
    setOffline: (value) => {
      offline = value;
    },
    setLatency: (ms) => {
      latency = ms;
    },
    payingFetch(wallet, fetchImpl = fetch, payOptions) {
      return (async (input: RequestInfo | URL, init?: RequestInit) => {
        const first = await fetchImpl(input, init);
        if (first.status !== 402 || !first.headers.get(HEADERS.paymentRequired)) return first;
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        headers.set(HEADERS.paymentSignature, wallet.pay(first, payOptions));
        return fetchImpl(input, { ...init, headers });
      }) as typeof fetch;
    },
  };
}
