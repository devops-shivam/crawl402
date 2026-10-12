# Architecture

crawl402 is a small engine with replaceable parts. Every adapter turns a framework's request into a standard `Request` and asks the engine what to do.

```
                ┌──────────────────────── createCrawl402(config) ─────────────────────────┐
Request ──▶ adapter ──▶ path rules ──▶ skip() ──▶ detectors ──▶ pricing ──▶ payment options
 (Next proxy,            protect/        bypass      who pays?    how much?    which networks
  route handler,         exclude                                               and tokens
  fetch server)                                                                    │
                                                                                   ▼
                         no PAYMENT-SIGNATURE ──▶ 402 + PAYMENT-REQUIRED (onChallenge)
                         PAYMENT-SIGNATURE    ──▶ decode ──▶ match against offered terms
                                                              │
                                                              ▼
                                               facilitator.verify ──▶ facilitator.settle
                                                              │              │
                                                     402 + reason      200 + PAYMENT-RESPONSE
                                                     (onRejected)      (onPaid)
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

## Source layout

| Path | Responsibility |
| --- | --- |
| `src/core/protocol.ts` | x402 v2 types, header names, base64 JSON codecs, price ↔ atomic unit conversion |
| `src/core/assets.ts` | Token presets (USDC on Base / Base Sepolia), address validation |
| `src/core/paths.ts` | Path pattern matching and default exclusions |
| `src/core/engine.ts` | `createCrawl402`: the request pipeline, `evaluate()` and `handle()` |
| `src/detectors/` | `Detector` type, built-in detectors, known bot signatures |
| `src/pricing/` | `PriceResolver` type, `byPath`, `byBot` |
| `src/facilitator/` | `Facilitator` interface and the HTTP client for the standard API |
| `src/adapters/next.ts` | `crawl402Proxy`, `withCrawl402` |
| `src/adapters/fetch.ts` | `withCrawl402Fetch` for any fetch-style server |
| `src/testing/` | `createSandbox()`: in-memory facilitator and wallets |

The core never imports from `next`. Only `src/adapters/next.ts` does, and `next` is an optional peer dependency.

## Two ways to collect payment

**`evaluate(request)`: settle before serving.** Proxies and middleware run before the page renders and can't see whether rendering succeeds. So the engine verifies and settles first, then lets the request through. The crawler only gets content after the money has moved.

**`handle(request, handler)`: settle after success.** Route handlers and fetch servers wrap the code that produces the response. The engine verifies the payment, runs the handler, and settles only if the status is below 400. This is the x402 "authorization" flow. Pass `{ settle: "before" }` to switch to the first behaviour.

## Security properties

- **The server's terms win.** The client's `accepted` terms must exactly equal one of the options the server offered for this request (scheme, network, amount, asset, recipient). The engine checks this before calling the facilitator.
- **Replay protection** comes from the payment itself. EIP-3009 authorizations carry a single-use nonce and an expiry window, enforced by the token contract and the facilitator.
- **Fail closed by default.** If the facilitator can't be reached, the content stays locked (503 with `Retry-After`).
- **No caching of paid content.** 402 responses are `no-store` and vary on `User-Agent` and `PAYMENT-SIGNATURE`. Paid responses are `private, no-store`.
- **Spoofing.** Detection is only as good as your detectors. User-agent matching catches honest crawlers. Use CDN signals for the rest.
