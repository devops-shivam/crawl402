import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createCrawl402,
  userAgent,
  missingBrowserHeaders,
  fromHeader,
  byPath,
  byBot,
  matchPath,
  toAtomicUnits,
  fromAtomicUnits,
  encodeHeader,
  decodeHeader,
  httpFacilitator,
  withCrawl402Fetch,
  HEADERS,
} from "../dist/index.js";
import { PAY_TO, UA, BROWSER_HEADERS, req, setup } from "./helpers.mjs";

describe("protocol helpers", () => {
  test("atomic units", () => {
    assert.equal(toAtomicUnits("$0.002", 6), "2000");
    assert.equal(toAtomicUnits(1, 6), "1000000");
    assert.equal(fromAtomicUnits("2000", 6), "0.002");
    assert.equal(fromAtomicUnits(1500000n, 6), "1.5");
    assert.throws(() => toAtomicUnits("0.0000001", 6));
    assert.throws(() => toAtomicUnits("0", 6));
    assert.throws(() => toAtomicUnits("abc", 6));
  });
  test("header round trip is UTF-8 safe", () => {
    const value = { text: "₹ नमस्ते", n: 1 };
    assert.deepEqual(decodeHeader(encodeHeader(value)), value);
  });
});

describe("paths", () => {
  test("patterns", () => {
    assert.ok(matchPath("/blog", "/blog"));
    assert.ok(matchPath("/blog/a", "/blog"));
    assert.ok(!matchPath("/blogger", "/blog"));
    assert.ok(matchPath("/blog/a", "/blog/*"));
    assert.ok(matchPath("/sitemap-1.xml", "/sitemap*"));
    assert.ok(matchPath("/x/123", /^\/x\/\d+$/));
    assert.ok(matchPath("/anything", "/"));
    assert.ok(matchPath("/a", (p) => p === "/a"));
  });
});

describe("detectors", () => {
  test("userAgent allow lists and categories", async () => {
    const d = userAgent({ allowBots: ["GPTBot"], chargeCategories: ["ai-crawler"] });
    assert.equal((await d(req("/", { "user-agent": UA.gptbot }))).verdict, "allow");
    assert.equal((await d(req("/", { "user-agent": UA.claudebot }))).verdict, "charge");
    assert.equal(await d(req("/", { "user-agent": UA.python })), null); // scraper category not charged here
  });

  test("extraBots", async () => {
    const d = userAgent({ extraBots: [{ name: "AcmeBot", category: "ai-crawler", pattern: /AcmeBot/ }] });
    assert.equal((await d(req("/", { "user-agent": "AcmeBot/2" }))).bot.name, "AcmeBot");
  });

  test("missingBrowserHeaders", async () => {
    const d = missingBrowserHeaders();
    assert.equal((await d(req("/", { "user-agent": "curl-like/1" }))).verdict, "charge");
    assert.equal(await d(req("/", BROWSER_HEADERS)), null);
  });

  test("fromHeader", async () => {
    const d = fromHeader("x-bot-score", (v) => Number(v) < 30);
    assert.equal((await d(req("/", { "x-bot-score": "5" }))).verdict, "charge");
    assert.equal(await d(req("/", { "x-bot-score": "90" })), null);
  });

  test("order matters: Googlebot stays free even with a strict heuristic after it", async () => {
    const { sandbox } = setup();
    const pw = createCrawl402({ payTo: PAY_TO, price: "$0.001", facilitator: sandbox.facilitator, detectors: [userAgent(), missingBrowserHeaders()] });
    assert.equal((await pw.evaluate(req("/a", { "user-agent": UA.googlebot }))).action, "pass");
    assert.equal((await pw.evaluate(req("/a", { "user-agent": "MyScraper/1.0" }))).action, "respond");
    assert.equal((await pw.evaluate(req("/a", BROWSER_HEADERS))).action, "pass");
  });

  test("custom detector function", async () => {
    const { sandbox } = setup();
    const pw = createCrawl402({
      payTo: PAY_TO,
      price: "$0.001",
      facilitator: sandbox.facilitator,
      detectors: [(r) => (r.headers.get("x-agent") ? { verdict: "charge", reason: "agent header" } : null)],
    });
    assert.equal((await pw.evaluate(req("/a", { "x-agent": "1" }))).action, "respond");
    assert.equal((await pw.evaluate(req("/a", { "user-agent": UA.gptbot }))).action, "pass");
  });
});

describe("pricing", () => {
  const { sandbox } = setup();
  const amountFor = async (pw, path, ua = UA.gptbot) => {
    const d = await pw.evaluate(req(path, { "user-agent": ua }));
    return d.action === "pass" ? null : decodeHeader(d.response.headers.get(HEADERS.paymentRequired)).accepts[0].amount;
  };

  test("byPath", async () => {
    const pw = createCrawl402({ payTo: PAY_TO, facilitator: sandbox.facilitator, price: byPath({ "/research/*": "$0.02", "/free/*": null }, "$0.001") });
    assert.equal(await amountFor(pw, "/research/x"), "20000");
    assert.equal(await amountFor(pw, "/blog/x"), "1000");
    assert.equal(await amountFor(pw, "/free/x"), null);
  });

  test("byBot", async () => {
    const pw = createCrawl402({ payTo: PAY_TO, facilitator: sandbox.facilitator, price: byBot({ "ai-assistant": "$0.0005", GPTBot: "$0.003" }, "$0.002") });
    assert.equal(await amountFor(pw, "/a", UA.gptbot), "3000");
    assert.equal(await amountFor(pw, "/a", UA.chatgptUser), "500");
    assert.equal(await amountFor(pw, "/a", UA.claudebot), "2000");
  });

  test("async price function", async () => {
    const pw = createCrawl402({ payTo: PAY_TO, facilitator: sandbox.facilitator, price: async ({ url }) => (url.pathname.length > 5 ? "0.01" : "0.001") });
    assert.equal(await amountFor(pw, "/long-path"), "10000");
  });
});

describe("handle(): verify, run, settle", () => {
  test("charges only when the handler succeeds", async () => {
    const { sandbox, wallet } = setup();
    const pw = createCrawl402({ payTo: PAY_TO, price: "$0.002", facilitator: sandbox.facilitator });
    const ok = withCrawl402Fetch(() => Response.json({ data: 1 }), pw);
    const failing = withCrawl402Fetch(() => new Response("boom", { status: 500 }), pw);

    const challenge = await ok(req("/api", { "user-agent": UA.gptbot }));
    assert.equal(challenge.status, 402);

    const h1 = wallet.pay(challenge);
    const paid = await ok(req("/api", { "user-agent": UA.gptbot, [HEADERS.paymentSignature]: h1 }));
    assert.equal(paid.status, 200);
    assert.deepEqual(await paid.json(), { data: 1 });
    assert.ok(paid.headers.get(HEADERS.paymentResponse));
    assert.equal(sandbox.received(PAY_TO), 2000n);

    const h2 = wallet.pay(challenge);
    const errored = await failing(req("/api", { "user-agent": UA.gptbot, [HEADERS.paymentSignature]: h2 }));
    assert.equal(errored.status, 500);
    assert.equal(sandbox.received(PAY_TO), 2000n); // not charged for the error
  });

  test("settle: 'before' charges before running the handler", async () => {
    const { sandbox, wallet } = setup();
    const pw = createCrawl402({ payTo: PAY_TO, price: "$0.002", facilitator: sandbox.facilitator });
    let balanceSeenByHandler;
    const h = withCrawl402Fetch(() => {
      balanceSeenByHandler = sandbox.received(PAY_TO);
      return new Response("ok");
    }, pw, { settle: "before" });
    const header = wallet.pay(await h(req("/x", { "user-agent": UA.gptbot })));
    const res = await h(req("/x", { "user-agent": UA.gptbot, [HEADERS.paymentSignature]: header }));
    assert.equal(res.status, 200);
    assert.equal(balanceSeenByHandler, 2000n);
  });

  test("humans get the handler directly", async () => {
    const { sandbox } = setup();
    const h = withCrawl402Fetch(() => new Response("hi"), { payTo: PAY_TO, price: "$0.01", facilitator: sandbox.facilitator });
    assert.equal(await (await h(req("/x", BROWSER_HEADERS))).text(), "hi");
  });

  test("payingFetch completes the 402 round trip like a real x402 client", async () => {
    const { sandbox, wallet } = setup();
    const server = withCrawl402Fetch(() => new Response("article"), { payTo: PAY_TO, price: "$0.002", facilitator: sandbox.facilitator });
    const fetchLike = (input, init) => server(new Request(input, init));
    const botFetch = sandbox.payingFetch(wallet, fetchLike);
    const res = await botFetch("https://site.example/post", { headers: { "user-agent": UA.gptbot } });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "article");
  });
});

describe("httpFacilitator", () => {
  test("posts the x402 v2 body to /verify and /settle", async () => {
    const seen = [];
    const f = httpFacilitator({
      url: "https://fac.example/",
      headers: async () => ({ authorization: "Bearer t" }),
      fetch: async (url, init) => {
        seen.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization });
        return Response.json(url.endsWith("/verify") ? { isValid: true } : { success: true, transaction: "0x1", network: "eip155:84532" });
      },
    });
    const payload = { x402Version: 2, accepted: {}, payload: {} };
    assert.equal((await f.verify(payload, { amount: "1" })).isValid, true);
    assert.equal((await f.settle(payload, { amount: "1" })).success, true);
    assert.deepEqual(seen.map((s) => s.url), ["https://fac.example/verify", "https://fac.example/settle"]);
    assert.equal(seen[0].body.x402Version, 2);
    assert.equal(seen[0].auth, "Bearer t");
  });

  test("non-JSON responses throw FacilitatorError", async () => {
    const f = httpFacilitator({ url: "https://fac.example", fetch: async () => new Response("<html>bad gateway</html>", { status: 502 }) });
    await assert.rejects(() => f.verify({}, {}), { name: "FacilitatorError", status: 502 });
  });
});
