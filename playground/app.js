// crawl402 playground. Runs the real engine in the browser against the in-memory sandbox.
import { createCrawl402, decodeHeader, toAtomicUnits, fromAtomicUnits, HEADERS } from "./lib/index.js";
import { createSandbox } from "./lib/testing/index.js";

const SITE_ORIGIN = "https://demo-news.example";
const SITE_WALLET = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const NETWORK = "eip155:84532";

const CLIENTS = [
  { id: "gptbot", label: "GPTBot (OpenAI crawler)", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)" },
  { id: "claudebot", label: "ClaudeBot (Anthropic crawler)", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)" },
  { id: "perplexity", label: "PerplexityBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)" },
  { id: "python", label: "python-requests scraper", ua: "python-requests/2.32.3" },
  { id: "googlebot", label: "Googlebot (search, free)", ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
  { id: "human", label: "Human in Chrome", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", browser: true },
  { id: "custom", label: "Custom User-Agent…", ua: "" },
];

const ARTICLES = {
  "/articles/monsoon-retreat-2026": {
    title: "Monsoon withdrawal from northwest India runs nine days late",
    by: "Weather desk · 8 Oct 2026",
    body: [
      "The southwest monsoon began withdrawing from west Rajasthan this week, about nine days behind its normal date of 17 September, according to the regional forecast office.",
      "Delhi recorded 41 mm of rain in the first week of October. Forecasters expect dry northwesterly winds to set in over the capital by mid-month, with night temperatures dropping toward 20 °C.",
    ],
  },
  "/articles/metro-phase-5-corridors": {
    title: "Three new corridors proposed for the next metro expansion",
    by: "City desk · 6 Oct 2026",
    body: [
      "Planners shortlisted three corridors for the next phase of the metro network, prioritising links between outer residential districts and existing interchange stations.",
      "Public consultation on station locations opens next month. Construction would begin only after funding approval, which planners expect to take at least a year.",
    ],
  },
};

// ---------- sandbox: facilitator, crawler wallet, ledger ----------
const sandbox = createSandbox();
sandbox.setLatency(250);
const wallet = sandbox.createWallet({ address: "0x857b06519E91e3A54538791bDbb0E22373e36b66", balance: 50_000n });
const counts = { paid: 0, blocked: 0 };
let lastGoodHeader = null;

// ---------- the site ----------
let paywall = null;
let priceStr = "$0.002";

function buildPaywall() {
  paywall = createCrawl402({
    payTo: SITE_WALLET,
    price: priceStr,
    network: NETWORK,
    facilitator: sandbox.facilitator,
    resource: { serviceName: "Demo News" },
  });
  $("configCode").textContent = `import { crawl402Proxy } from "crawl402/next";

export default crawl402Proxy({
  payTo: "${SITE_WALLET}",
  price: "${priceStr}",
  network: "${NETWORK}", // Base Sepolia
  resource: { serviceName: "Demo News" },
});`;
}

function renderPage(path) {
  if (path === "/robots.txt") {
    return { type: "text/plain", text: `User-agent: *\nAllow: /\n\n# AI crawlers: pages under /articles cost ${priceStr} USDC each via x402.\nSitemap: ${SITE_ORIGIN}/sitemap.xml` };
  }
  if (path === "/sitemap.xml") {
    return {
      type: "application/xml",
      text: '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        Object.keys(ARTICLES).map((p) => `  <url><loc>${SITE_ORIGIN}${p}</loc></url>`).join("\n") + "\n</urlset>",
    };
  }
  return { type: "text/html", article: ARTICLES[path] };
}

// Plays the role of Next.js: run the proxy, then either return its response or render the page.
async function siteHandle(req) {
  const callsBefore = sandbox.calls.length;
  const decision = await paywall.evaluate(req);
  const calls = sandbox.calls.slice(callsBefore);
  if (decision.action === "respond") {
    const r = decision.response;
    return { status: r.status, headers: Object.fromEntries(r.headers.entries()), bodyText: await r.text(), calls };
  }
  const page = renderPage(new URL(req.url).pathname);
  const headers = { "content-type": page.type + "; charset=utf-8" };
  if (decision.action === "paid") {
    for (const [k, v] of Object.entries(decision.headers)) headers[k.toLowerCase()] = v;
  }
  return { status: 200, headers, page, calls, decision };
}

// ---------- helpers ----------
function $(id) {
  return document.getElementById(id);
}
const fmt = (atomic) => fromAtomicUnits(atomic, 6);
const fmtFixed = (atomic) => {
  const [w, f = ""] = fmt(atomic).split(".");
  return `${w}.${f.padEnd(6, "0")}`;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function hl(obj) {
  const json = esc(JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  return json.replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(-?\d+(?:\.\d+)?|true|false|null)\b/g, (m, str, colon, num) => {
    if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
    return `<span class="n">${num}</span>`;
  });
}
const chip = (el, text, kind) => {
  el.textContent = text;
  el.className = "chip" + (kind ? " " + kind : "");
};

// ---------- crawler side ----------
const state = { req1: null, paymentRequired: null, header: null, payload: null, tamper: "none", replayed: false };

function currentClient() {
  const c = CLIENTS.find((x) => x.id === $("client").value);
  return { ...c, ua: c.id === "custom" ? $("customUa").value.trim() || "MyCrawler/0.1" : c.ua };
}

// Browsers won't let a page set User-Agent on a real Request, so we hand the engine
// a request-shaped object. The engine only reads url, method and headers.
function buildRequest(extra = {}) {
  const c = currentClient();
  const path = $("path").value;
  const headers = new Headers({ "user-agent": c.ua, accept: "text/html,*/*" });
  if (c.browser) {
    headers.set("accept-language", "en-IN,en;q=0.9");
    headers.set("sec-fetch-mode", "navigate");
    headers.set("sec-ch-ua", '"Chromium";v="141"');
  }
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return { url: SITE_ORIGIN + path, method: "GET", headers, _client: c, _path: path };
}

function requestText(req) {
  let s = `<span class="h">GET</span> ${esc(req._path)} HTTP/1.1\nHost: demo-news.example\n`;
  for (const [k, v] of req.headers.entries()) s += `${esc(k.replace(/(^|-)\w/g, (m) => m.toUpperCase()))}: ${esc(v)}\n`;
  return s;
}
function responseText(res) {
  const text = { 200: "OK", 402: "Payment Required", 503: "Service Unavailable" }[res.status] || "";
  const cls = res.status === 200 ? "st-ok" : res.status === 402 ? "st-pay" : "st-err";
  let s = `HTTP/1.1 <span class="${cls}">${res.status} ${text}</span>\n`;
  for (const [k, v] of Object.entries(res.headers)) s += `${esc(k)}: ${esc(v)}\n`;
  return s;
}
function pagePreview(res, path) {
  const bar = `<div class="bar">${SITE_ORIGIN}${esc(path)}</div>`;
  if (res.page.article) {
    const a = res.page.article;
    return `<div class="browser">${bar}<article><h3>${esc(a.title)}</h3><p class="by">${esc(a.by)}</p>${a.body.map((p) => `<p>${esc(p)}</p>`).join("")}</article></div>`;
  }
  return `<div class="browser">${bar}<pre>${esc(res.page.text)}</pre></div>`;
}
function exchange(req, res) {
  return `<div class="pair"><div class="panel"><div class="cap">Request</div><pre>${requestText(req)}</pre></div><div class="panel"><div class="cap">Response</div><pre>${responseText(res)}</pre></div></div>`;
}

function logRow(req, res, amount, tx) {
  const tbody = $("log");
  if (tbody.querySelector(".empty")) tbody.innerHTML = "";
  const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const kind = res.status === 200 ? "ok" : res.status === 402 ? "pay" : "err";
  const tr = document.createElement("tr");
  tr.innerHTML = `<td class="mono">${t}</td><td>${esc(req._client.label.replace(/ \(.+\)/, ""))}</td><td class="mono">${esc(req._path)}</td><td><span class="chip ${kind}">${res.status}</span></td><td class="mono">${amount ? fmt(amount) : "—"}</td><td class="mono">${tx ? esc(tx.slice(0, 10) + "…" + tx.slice(-6)) : "—"}</td>`;
  tbody.prepend(tr);
  if (res.status === 402) counts.blocked++;
  if (tx) counts.paid++;
  refreshLedger();
}
function refreshLedger() {
  $("botBal").textContent = fmtFixed(wallet.balance()) + " USDC";
  $("siteBal").textContent = fmtFixed(sandbox.received(SITE_WALLET));
  $("paidCount").textContent = counts.paid;
  $("blockedCount").textContent = counts.blocked;
}
function setVerdict(kind, title, sub) {
  const v = $("verdict");
  v.className = "verdict" + (kind ? " " + kind : "");
  v.innerHTML = `<span>${esc(title)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ""}`;
}
function setStep(n, mode) {
  const el = $("s" + n);
  el.classList.remove("pending", "active", "done");
  el.classList.add(mode);
}

// ---------- step 1: request ----------
async function step1() {
  resetSteps(false);
  buildPaywall();
  const req = buildRequest();
  state.req1 = req;
  $("send").disabled = true;
  chip($("s1chip"), "sending…");
  const res = await siteHandle(req);
  $("send").disabled = false;
  let html = exchange(req, res);

  if (res.status === 402) {
    const pr = decodeHeader(res.headers[HEADERS.paymentRequired.toLowerCase()]);
    state.paymentRequired = pr;
    const acc = pr.accepts[0];
    html += `<p class="note">The proxy recognised <b>${esc(req._client.label)}</b> as a crawler and returned <b>402</b>. The <code>PAYMENT-REQUIRED</code> header is Base64 JSON. Decoded, it asks for <b>${fmt(acc.amount)} USDC</b> (${esc(acc.amount)} atomic units) on <b>${esc(acc.network)}</b>, paid to <b>${esc(acc.payTo.slice(0, 8))}…</b>, within ${acc.maxTimeoutSeconds} s.</p>`;
    html += `<div class="panel"><div class="cap">PAYMENT-REQUIRED, decoded</div><pre>${hl(pr)}</pre></div>`;
    chip($("s1chip"), "402 Payment Required", "pay");
    setStep(1, "done");
    setStep(2, "active");
    $("sign").disabled = false;
    setVerdict("pay", "Payment required", "Sign a payment in step 2 to continue.");
  } else {
    const reason = req._client.browser
      ? "Real browser headers, so the proxy let the visitor through for free."
      : /Googlebot/i.test(req._client.ua)
        ? "Search engines are allowed by default, so SEO is unaffected."
        : /robots|sitemap/.test(req._path)
          ? "robots.txt and sitemaps are always excluded so crawlers can read your terms."
          : "This client didn't match any crawler signature, so it passes. Add the missingBrowserHeaders() detector to charge unknown clients.";
    html += `<p class="note">${esc(reason)}</p>` + pagePreview(res, req._path);
    chip($("s1chip"), "200 OK", "ok");
    setStep(1, "done");
    setVerdict("ok", "Served for free", "No payment needed for this client and page.");
  }
  logRow(req, res);
  const body = $("s1body");
  body.hidden = false;
  body.innerHTML = html;
  $("phaseChip").textContent = res.status === 402 ? "Awaiting payment" : "Done";
  return res.status;
}

// ---------- step 2: sign ----------
const TAMPER_NOTES = {
  underpay: "Tampered: the crawler rewrote the amount to 1 atomic unit (0.000001 USDC).",
  wrongRecipient: "Tampered: the authorization pays a different wallet than the site asked for.",
  expired: "Tampered: the authorization's validity window ended five minutes ago.",
  badSignature: "Tampered: the last bytes of the signature were replaced.",
  offline: "The payment is valid, but the facilitator will be unreachable on retry.",
};

function step2() {
  const tamper = $("tamper").value;
  state.tamper = tamper;
  state.replayed = false;
  if (tamper === "replay" && lastGoodHeader) {
    state.header = lastGoodHeader;
    state.replayed = true;
  } else {
    const walletTamper = ["underpay", "wrongRecipient", "expired", "badSignature"].includes(tamper) ? tamper : undefined;
    state.header = wallet.pay(state.paymentRequired, { tamper: walletTamper });
  }
  state.payload = decodeHeader(state.header);

  let note =
    "The crawler's wallet signs an <b>EIP-3009 transferWithAuthorization</b> for exactly the terms it was given. No money moves yet; it's a signed promise the facilitator can redeem. The signature here comes from the sandbox and is not cryptographic.";
  if (tamper === "replay") {
    note += state.replayed
      ? " <b>Tampered: the crawler is resending the payment header from its last successful purchase.</b>"
      : " <b>No earlier successful payment to replay yet, so this is a fresh, valid payment. Complete one paid request, then try again.</b>";
  } else if (TAMPER_NOTES[tamper]) note += ` <b>${esc(TAMPER_NOTES[tamper])}</b>`;

  const body = $("s2body");
  body.hidden = false;
  body.innerHTML = `<p class="note">${note}</p>
    <div class="pair">
      <div class="panel"><div class="cap">PaymentPayload</div><pre>${hl(state.payload)}</pre></div>
      <div class="panel"><div class="cap">PAYMENT-SIGNATURE header (Base64)<button class="small" type="button" id="copySig">Copy</button></div><pre id="sigHeader">${esc(state.header)}</pre></div>
    </div>`;
  $("copySig").addEventListener("click", () => copyText(state.header, $("copySig")));
  const clean = tamper === "none" || tamper === "offline" || (tamper === "replay" && !state.replayed);
  chip($("s2chip"), clean ? "signed" : "signed (tampered)", clean ? "ok" : "err");
  setStep(2, "done");
  setStep(3, "active");
  $("retry").disabled = false;
  setVerdict("pay", "Payment signed", "Retry the request with the PAYMENT-SIGNATURE header in step 3.");
}

// ---------- step 3: retry ----------
const EXPLAIN = {
  invalid_payment_requirements: "The payment's terms (amount, asset, network or recipient) don't match what the site asked for.",
  insufficient_funds: "The crawler's wallet doesn't hold enough USDC. Add funds in the setup panel and start again from step 1.",
  invalid_exact_evm_payload_recipient_mismatch: "The authorization pays a different wallet than the site's.",
  invalid_exact_evm_payload_authorization_valid_before: "The authorization has expired.",
  invalid_exact_evm_payload_signature: "The signature doesn't match the wallet that supposedly signed it.",
  invalid_transaction_state: "This authorization's nonce was already spent, so the replay was refused.",
};

async function step3() {
  sandbox.setOffline(state.tamper === "offline");
  const req = buildRequest({ [HEADERS.paymentSignature]: state.header });
  req._client = state.req1._client;
  req._path = state.req1._path;
  $("retry").disabled = true;
  chip($("s3chip"), "verifying…");
  const res = await siteHandle(req).finally(() => sandbox.setOffline(false));

  let html = exchange(req, res);
  if (res.calls.length) {
    html += `<div class="calls"><div class="eyebrow">What the site's proxy did behind the scenes</div>${res.calls
      .map((c) => {
        const ok = c.response && (c.response.isValid || c.response.success);
        return `<div class="call ${ok ? "ok" : "err"}"><span class="t">POST /${esc(c.endpoint)} → facilitator</span>
          <div class="pair"><div class="panel"><div class="cap">Request body</div><pre>${hl({ x402Version: 2, paymentPayload: c.payload, paymentRequirements: c.requirements })}</pre></div>
          <div class="panel"><div class="cap">Response</div><pre>${hl(c.response)}</pre></div></div></div>`;
      })
      .join("")}</div>`;
  } else if (res.status === 402) {
    html += `<p class="note"><b>Rejected by the proxy before contacting the facilitator.</b> The signed terms didn't match what the site issued, so no network call was made.</p>`;
  }

  if (res.status === 200) {
    const settlement = decodeHeader(res.headers[HEADERS.paymentResponse.toLowerCase()]);
    lastGoodHeader = state.header;
    html += `<div class="panel"><div class="cap">PAYMENT-RESPONSE, decoded</div><pre>${hl(settlement)}</pre></div>` + pagePreview(res, req._path);
    chip($("s3chip"), "200 OK · paid", "ok");
    setVerdict("ok", `Access granted for ${fmt(settlement.amount)} USDC`, `Settled in transaction ${settlement.transaction.slice(0, 12)}…`);
    logRow(req, res, settlement.amount, settlement.transaction);
  } else if (res.status === 402) {
    const pr = decodeHeader(res.headers[HEADERS.paymentRequired.toLowerCase()]);
    const explain = EXPLAIN[pr.error] || "The payment was not accepted.";
    html += `<p class="note"><b>Still 402: ${esc(pr.error)}.</b> ${esc(explain)}</p><div class="panel"><div class="cap">PAYMENT-REQUIRED, decoded</div><pre>${hl(pr)}</pre></div>`;
    chip($("s3chip"), "402 · " + pr.error, "err");
    setVerdict("err", "Payment rejected", explain);
    logRow(req, res);
  } else {
    html += `<p class="note"><b>503 Service Unavailable.</b> The facilitator couldn't be reached. With the default <code>failMode: "closed"</code> the content stays locked and the crawler is told to retry in 30 seconds.</p><pre>${esc(res.bodyText)}</pre>`;
    chip($("s3chip"), "503", "err");
    setVerdict("err", "Facilitator offline", "Content stays locked (fail closed).");
    logRow(req, res);
  }
  const body = $("s3body");
  body.hidden = false;
  body.innerHTML = html;
  setStep(3, "done");
  $("phaseChip").textContent = "Done";
}

// ---------- controls ----------
function copyText(text, btn) {
  const done = () => {
    btn.textContent = "Copied";
    setTimeout(() => (btn.textContent = "Copy"), 1400);
  };
  const select = () => {
    const range = document.createRange();
    range.selectNodeContents($("sigHeader"));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };
  try {
    navigator.clipboard.writeText(text).then(done, select);
  } catch {
    select();
  }
}

function resetSteps(full = true) {
  for (const n of [1, 2, 3]) {
    $("s" + n + "body").hidden = true;
    $("s" + n + "body").innerHTML = "";
  }
  setStep(1, "active");
  setStep(2, "pending");
  setStep(3, "pending");
  chip($("s1chip"), "not sent");
  chip($("s2chip"), "waiting");
  chip($("s3chip"), "waiting");
  $("sign").disabled = true;
  $("retry").disabled = true;
  $("send").disabled = false;
  $("phaseChip").textContent = "Ready";
  if (full) setVerdict("", "Choose who is requesting, then send the request in step 1.");
}

async function runAll() {
  $("runAll").disabled = true;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    if ((await step1()) !== 402) return;
    await wait(450);
    step2();
    await wait(450);
    await step3();
    $("s3").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  } finally {
    $("runAll").disabled = false;
  }
}

function updatePriceHint() {
  const v = $("price").value;
  try {
    const atomic = toAtomicUnits(v, 6);
    priceStr = v.trim().startsWith("$") ? v.trim() : "$" + v.trim();
    $("priceHint").textContent = `= ${atomic} atomic units (USDC has 6 decimals)`;
    $("priceHint").style.color = "";
    $("send").disabled = false;
    $("runAll").disabled = false;
  } catch {
    $("priceHint").textContent = "Enter a positive amount with up to 6 decimals, like $0.002.";
    $("priceHint").style.color = "var(--err)";
    $("send").disabled = true;
    $("runAll").disabled = true;
  }
}

const TAMPER_HINTS = {
  none: "A valid payment unlocks the page.",
  underpay: "The proxy rejects this itself, without calling the facilitator.",
  wrongRecipient: "The facilitator rejects the recipient.",
  expired: "The facilitator rejects the time window.",
  badSignature: "The facilitator rejects the signature.",
  replay: "Needs one earlier successful payment. The nonce is single-use.",
  offline: "The proxy answers 503 and keeps the page locked.",
};

function init() {
  $("client").innerHTML = CLIENTS.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("");
  const onClient = () => {
    const c = CLIENTS.find((x) => x.id === $("client").value);
    $("customUa").hidden = c.id !== "custom";
    $("uaView").textContent = c.id === "custom" ? "Type a User-Agent below" : c.ua;
    resetSteps();
  };
  $("client").addEventListener("change", onClient);
  $("customUa").addEventListener("input", () => resetSteps());
  $("path").addEventListener("change", () => resetSteps());
  $("price").addEventListener("input", () => {
    updatePriceHint();
    resetSteps();
  });
  $("tamper").addEventListener("change", () => {
    $("tamperHint").textContent = TAMPER_HINTS[$("tamper").value];
  });
  $("topUp").addEventListener("click", () => {
    wallet.fund(10_000n);
    refreshLedger();
  });
  $("drain").addEventListener("click", () => {
    wallet.fund(-wallet.balance());
    refreshLedger();
  });
  $("send").addEventListener("click", step1);
  $("sign").addEventListener("click", step2);
  $("retry").addEventListener("click", step3);
  $("runAll").addEventListener("click", runAll);
  $("reset").addEventListener("click", () => resetSteps());
  $("botAddr").textContent = wallet.address;
  onClient();
  updatePriceHint();
  buildPaywall();
  refreshLedger();
}

init();
