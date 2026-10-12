# Going live

The defaults are safe for trying things out: Base Sepolia test USDC and the public x402.org facilitator. Before accepting real payments, work through this list.

## Checklist

1. **Use a wallet you control.** `payTo` can be any EVM address: a hardware wallet, a Safe multisig, or a company treasury. Avoid exchange deposit addresses unless the exchange explicitly supports USDC on Base.
2. **Switch the network.**
   ```ts
   network: "eip155:8453", // Base mainnet
   ```
3. **Choose a mainnet facilitator.** The x402.org facilitator is intended for testnets. Pick a provider that settles on Base mainnet and set:
   ```ts
   facilitator: httpFacilitator({
     url: process.env.X402_FACILITATOR_URL!,
     headers: async () => ({ Authorization: `Bearer ${process.env.X402_FACILITATOR_KEY}` }),
   }),
   ```
   Call the facilitator's `GET /supported` and confirm it lists `exact` on `eip155:8453`.
4. **Decide on `failMode`.** `"closed"` (default) keeps content locked if the facilitator is down. `"open"` lets crawlers in unpaid instead.
5. **Check caching.** If a CDN caches your HTML, make sure bots bypass the cache or the cache key varies on `User-Agent`. Otherwise a crawler could get a cached page without reaching the proxy.
6. **Keep search engines free** unless you mean to charge them. The default `userAgent()` detector allows the `search-engine` category.
7. **Record revenue.** Use `onPaid` to log `transaction`, `amountFormatted`, `payer` and `url`, for example to a database or analytics.
8. **Tell crawlers.** Add a comment to `robots.txt` explaining that AI access is paid via x402, and keep `robots.txt` reachable (it's excluded from the paywall by default).
9. **Taxes and compliance.** Revenue received in USDC may have tax and reporting obligations where you operate. Check with an accountant.

## Testing on Base Sepolia first

1. Keep `network: "eip155:84532"` and the default facilitator.
2. Get test USDC for a separate "crawler" wallet from a Base Sepolia faucet.
3. Request a page with an x402 client, such as `@x402/fetch`, using that wallet and a crawler User-Agent.
4. Confirm the transaction on a Base Sepolia block explorer and that `onPaid` fired.
