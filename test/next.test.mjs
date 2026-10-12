// Runs in CI where `next` is installed; skipped locally if it isn't.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HEADERS } from "../dist/index.js";
import { PAY_TO, UA, BROWSER_HEADERS, setup } from "./helpers.mjs";

let next;
try {
  next = await import("../dist/adapters/next.js");
} catch {
  next = null;
}
const { NextRequest } = next ? await import("next/server") : {};
const nreq = (path, headers = {}) => new NextRequest("https://site.example" + path, { headers });

test("crawl402Proxy: 402 for crawlers, continue for humans, headers on paid", { skip: !next && "next is not installed" }, async () => {
  const { sandbox, wallet } = setup();
  const proxy = next.crawl402Proxy({ payTo: PAY_TO, price: "$0.002", facilitator: sandbox.facilitator });

  const human = await proxy(nreq("/blog", BROWSER_HEADERS));
  assert.equal(human.headers.get("x-middleware-next"), "1");

  const challenge = await proxy(nreq("/blog", { "user-agent": UA.gptbot }));
  assert.equal(challenge.status, 402);

  const paid = await proxy(nreq("/blog", { "user-agent": UA.gptbot, [HEADERS.paymentSignature]: wallet.pay(challenge) }));
  assert.equal(paid.headers.get("x-middleware-next"), "1");
  assert.ok(paid.headers.get(HEADERS.paymentResponse));
});

test("crawl402Proxy chains existing middleware", { skip: !next && "next is not installed" }, async () => {
  const { sandbox } = setup();
  const { NextResponse } = await import("next/server");
  const proxy = next.crawl402Proxy(
    { payTo: PAY_TO, price: "$0.002", facilitator: sandbox.facilitator },
    { next: (r) => (r.nextUrl.pathname === "/old" ? NextResponse.redirect(new URL("/new", r.url)) : undefined) },
  );
  const res = await proxy(nreq("/old", BROWSER_HEADERS));
  assert.equal(res.status, 307);
});

test("withCrawl402 wraps a route handler", { skip: !next && "next is not installed" }, async () => {
  const { sandbox, wallet } = setup();
  const GET = next.withCrawl402(async () => Response.json({ ok: true }), { payTo: PAY_TO, price: "$0.01", facilitator: sandbox.facilitator });
  const challenge = await GET(nreq("/api/data", { "user-agent": UA.gptbot }));
  assert.equal(challenge.status, 402);
  const res = await GET(nreq("/api/data", { "user-agent": UA.gptbot, [HEADERS.paymentSignature]: wallet.pay(challenge) }));
  assert.deepEqual(await res.json(), { ok: true });
});
