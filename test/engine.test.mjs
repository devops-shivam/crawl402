import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createCrawl402, decodeHeader, HEADERS, usdc } from "../dist/index.js";
import { PAY_TO, UA, BROWSER_HEADERS, req, setup } from "./helpers.mjs";

function paywall(sandbox, extra = {}) {
  return createCrawl402({ payTo: PAY_TO, price: "$0.002", facilitator: sandbox.facilitator, ...extra });
}

describe("who pays", () => {
  const { sandbox } = setup();
  const pw = paywall(sandbox);

  test("humans pass", async () => {
    assert.equal((await pw.evaluate(req("/blog/post", BROWSER_HEADERS))).action, "pass");
  });

  test("search engines pass by default", async () => {
    const d = await pw.evaluate(req("/blog/post", { "user-agent": UA.googlebot }));
    assert.equal(d.action, "pass");
    assert.equal(d.detection.verdict, "allow");
  });

  test("AI crawlers get 402", async () => {
    for (const ua of [UA.gptbot, UA.claudebot, UA.python]) {
      const d = await pw.evaluate(req("/blog/post", { "user-agent": ua }));
      assert.equal(d.action, "respond", ua);
      assert.equal(d.response.status, 402);
    }
  });

  test("robots.txt, sitemaps and Next internals are never charged", async () => {
    for (const path of ["/robots.txt", "/sitemap.xml", "/sitemap-0.xml", "/_next/data/x.json", "/.well-known/x"]) {
      assert.equal((await pw.evaluate(req(path, { "user-agent": UA.gptbot }))).action, "pass", path);
    }
  });

  test("OPTIONS preflight passes", async () => {
    assert.equal((await pw.evaluate(req("/blog", { "user-agent": UA.gptbot }, { method: "OPTIONS" }))).action, "pass");
  });

  test("skip() bypasses the paywall", async () => {
    const pw2 = paywall(sandbox, { skip: (r) => r.headers.get("x-api-key") === "partner" });
    assert.equal((await pw2.evaluate(req("/blog", { "user-agent": UA.gptbot, "x-api-key": "partner" }))).action, "pass");
  });

  test("protect limits the paywall to listed paths", async () => {
    const pw2 = paywall(sandbox, { protect: ["/blog"] });
    assert.equal((await pw2.evaluate(req("/pricing", { "user-agent": UA.gptbot }))).action, "pass");
    assert.equal((await pw2.evaluate(req("/blog/a", { "user-agent": UA.gptbot }))).response.status, 402);
  });
});

describe("402 challenge", () => {
  const { sandbox } = setup();
  const pw = paywall(sandbox, { resource: { serviceName: "Example News", description: "Articles" } });

  test("PAYMENT-REQUIRED follows the x402 v2 shape", async () => {
    const d = await pw.evaluate(req("/blog/post?utm=1", { "user-agent": UA.gptbot }));
    const pr = decodeHeader(d.response.headers.get(HEADERS.paymentRequired));
    assert.equal(pr.x402Version, 2);
    assert.equal(pr.resource.url, "https://site.example/blog/post");
    assert.equal(pr.resource.serviceName, "Example News");
    assert.deepEqual(pr.accepts[0], {
      scheme: "exact",
      network: "eip155:84532",
      amount: "2000",
      asset: usdc("eip155:84532").address,
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
      extra: { name: "USDC", version: "2" },
    });
    assert.equal(d.response.headers.get("cache-control"), "no-store");
    const body = await d.response.json();
    assert.match(body.message, /0\.002 USDC on eip155:84532/);
  });

  test("renderPaymentRequired customises the body, header is still added", async () => {
    const pw2 = paywall(sandbox, { renderPaymentRequired: () => new Response("<h1>Pay to crawl</h1>", { headers: { "content-type": "text/html" } }) });
    const d = await pw2.evaluate(req("/x", { "user-agent": UA.gptbot }));
    assert.equal(d.response.status, 402);
    assert.equal(await d.response.text(), "<h1>Pay to crawl</h1>");
    assert.ok(d.response.headers.get(HEADERS.paymentRequired));
  });

  test("onChallenge fires", async () => {
    let seen;
    const pw2 = paywall(sandbox, { onChallenge: (e) => (seen = e) });
    await pw2.evaluate(req("/x", { "user-agent": UA.gptbot }));
    assert.equal(seen.detection.bot.name, "GPTBot");
    assert.equal(seen.paymentRequired.accepts[0].amount, "2000");
  });
});

describe("paying", () => {
  test("valid payment is verified, settled and served", async () => {
    const { sandbox, wallet } = setup();
    let paid;
    const pw = paywall(sandbox, { onPaid: (e) => (paid = e) });
    const first = await pw.evaluate(req("/blog/post", { "user-agent": UA.gptbot }));
    const header = wallet.pay(first.response);
    const second = await pw.evaluate(req("/blog/post", { "user-agent": UA.gptbot, [HEADERS.paymentSignature]: header }));
    assert.equal(second.action, "paid");
    assert.deepEqual(sandbox.calls.map((c) => c.endpoint), ["verify", "settle"]);
    assert.equal(decodeHeader(second.headers[HEADERS.paymentResponse]).success, true);
    assert.equal(sandbox.received(PAY_TO), 2000n);
    assert.equal(wallet.balance(), 998_000n);
    assert.equal(paid.amountFormatted, "0.002");
    assert.equal(paid.payer, wallet.address);
  });

  test("replaying a used payment is refused", async () => {
    const { sandbox, wallet } = setup();
    const pw = paywall(sandbox);
    const header = wallet.pay((await pw.evaluate(req("/a", { "user-agent": UA.gptbot }))).response);
    const h = { "user-agent": UA.gptbot, [HEADERS.paymentSignature]: header };
    assert.equal((await pw.evaluate(req("/a", h))).action, "paid");
    const again = await pw.evaluate(req("/a", h));
    assert.equal(again.response.status, 402);
    assert.equal(decodeHeader(again.response.headers.get(HEADERS.paymentRequired)).error, "invalid_transaction_state");
  });

  const cases = [
    ["underpay", "invalid_payment_requirements", 0],
    ["wrongRecipient", "invalid_exact_evm_payload_recipient_mismatch", 1],
    ["expired", "invalid_exact_evm_payload_authorization_valid_before", 1],
    ["badSignature", "invalid_exact_evm_payload_signature", 1],
  ];
  for (const [tamper, error, facilitatorCalls] of cases) {
    test(`rejects ${tamper}`, async () => {
      const { sandbox, wallet } = setup();
      let rejected;
      const pw = paywall(sandbox, { onRejected: (e) => (rejected = e.reason) });
      const header = wallet.pay((await pw.evaluate(req("/a", { "user-agent": UA.gptbot }))).response, { tamper });
      const d = await pw.evaluate(req("/a", { "user-agent": UA.gptbot, [HEADERS.paymentSignature]: header }));
      assert.equal(d.response.status, 402);
      assert.equal(decodeHeader(d.response.headers.get(HEADERS.paymentRequired)).error, error);
      assert.equal(rejected, error);
      assert.equal(sandbox.calls.length, facilitatorCalls);
      assert.equal(sandbox.received(PAY_TO), 0n);
    });
  }

  test("insufficient funds", async () => {
    const { sandbox } = setup();
    const poor = sandbox.createWallet({ balance: 10 });
    const pw = paywall(sandbox);
    const header = poor.pay((await pw.evaluate(req("/a", { "user-agent": UA.gptbot }))).response);
    const d = await pw.evaluate(req("/a", { "user-agent": UA.gptbot, [HEADERS.paymentSignature]: header }));
    assert.equal(decodeHeader(d.response.headers.get(HEADERS.paymentRequired)).error, "insufficient_funds");
  });

  test("garbage PAYMENT-SIGNATURE is rejected as invalid_payload", async () => {
    const { sandbox } = setup();
    const d = await paywall(sandbox).evaluate(req("/a", { "user-agent": UA.gptbot, [HEADERS.paymentSignature]: "%%%not-base64" }));
    assert.equal(decodeHeader(d.response.headers.get(HEADERS.paymentRequired)).error, "invalid_payload");
  });

  test("an unidentified client offering payment is charged", async () => {
    const { sandbox, wallet } = setup();
    const pw = paywall(sandbox);
    const header = wallet.pay((await pw.evaluate(req("/a", { "user-agent": UA.gptbot }))).response);
    const d = await pw.evaluate(req("/a", { ...BROWSER_HEADERS, [HEADERS.paymentSignature]: header }));
    assert.equal(d.action, "paid");
  });
});

describe("facilitator outages", () => {
  test("fail closed: 503 by default", async () => {
    const { sandbox, wallet } = setup();
    const errors = [];
    const pw = paywall(sandbox, { onError: (e) => errors.push(e) });
    const header = wallet.pay((await pw.evaluate(req("/a", { "user-agent": UA.gptbot }))).response);
    sandbox.setOffline(true);
    const d = await pw.evaluate(req("/a", { "user-agent": UA.gptbot, [HEADERS.paymentSignature]: header }));
    assert.equal(d.response.status, 503);
    assert.equal(d.response.headers.get("retry-after"), "30");
    assert.equal(errors.length, 1);
  });

  test("fail open: serve unpaid", async () => {
    const { sandbox, wallet } = setup();
    const pw = paywall(sandbox, { failMode: "open" });
    const header = wallet.pay((await pw.evaluate(req("/a", { "user-agent": UA.gptbot }))).response);
    sandbox.setOffline(true);
    assert.equal((await pw.evaluate(req("/a", { "user-agent": UA.gptbot, [HEADERS.paymentSignature]: header }))).action, "pass");
  });
});

describe("multiple payment options", () => {
  const SOL_PAY_TO = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
  const SOL_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

  test("offers every option and accepts payment on any of them", async () => {
    const { sandbox, wallet } = setup();
    const pw = createCrawl402({
      price: "$0.002",
      facilitator: sandbox.facilitator,
      accepts: [
        { network: "eip155:8453", payTo: PAY_TO },
        { network: "eip155:84532", payTo: PAY_TO, price: "$0.001" },
        { network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", payTo: SOL_PAY_TO, asset: { address: SOL_MINT, decimals: 6, symbol: "USDC" }, extra: { feePayer: SOL_PAY_TO } },
      ],
    });
    const first = await pw.evaluate(req("/a", { "user-agent": UA.gptbot }));
    const pr = decodeHeader(first.response.headers.get(HEADERS.paymentRequired));
    assert.deepEqual(pr.accepts.map((a) => [a.network, a.amount]), [
      ["eip155:8453", "2000"],
      ["eip155:84532", "1000"],
      ["solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", "2000"],
    ]);
    assert.deepEqual(pr.accepts[2].extra, { feePayer: SOL_PAY_TO });
    const header = wallet.pay(first.response, { choose: (opts) => opts.find((o) => o.network === "eip155:84532") });
    const d = await pw.evaluate(req("/a", { "user-agent": UA.gptbot, [HEADERS.paymentSignature]: header }));
    assert.equal(d.action, "paid");
    assert.equal(d.event.amount, "1000");
  });

  test("an option whose price resolves to null is hidden", async () => {
    const { sandbox } = setup();
    const pw = createCrawl402({
      price: "$0.002",
      facilitator: sandbox.facilitator,
      accepts: [{ network: "eip155:84532", payTo: PAY_TO }, { network: "eip155:8453", payTo: PAY_TO, price: null }],
    });
    const pr = decodeHeader((await pw.evaluate(req("/a", { "user-agent": UA.gptbot }))).response.headers.get(HEADERS.paymentRequired));
    assert.equal(pr.accepts.length, 1);
  });
});

describe("configuration errors", () => {
  test("missing payTo", () => assert.throws(() => createCrawl402({ price: "$0.01" }), /payTo/));
  test("bad EVM address", () => assert.throws(() => createCrawl402({ price: "$0.01", payTo: "0x123" }), /not a valid address/));
  test("network without preset needs an asset", () =>
    assert.throws(() => createCrawl402({ price: "$0.01", payTo: PAY_TO, network: "eip155:1" }), /no USDC preset/));
});
