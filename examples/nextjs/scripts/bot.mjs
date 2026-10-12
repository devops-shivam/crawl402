// Plays an AI crawler against the running example: request → 402 → sign → retry → 200.
// Usage: npm run dev   (in another terminal)   then   npm run bot [path]
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const path = process.argv[2] ?? "/articles/hello-crawlers";
const UA = "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)";
const decode = (h) => JSON.parse(Buffer.from(h, "base64").toString("utf8"));

console.log(`1. GET ${path} as GPTBot`);
const first = await fetch(BASE + path, { headers: { "user-agent": UA } });
console.log(`   → ${first.status}`);
const required = first.headers.get("payment-required");
if (first.status !== 402 || !required) process.exit(0);
const terms = decode(required).accepts[0];
console.log(`   price: ${Number(terms.amount) / 1e6} USDC on ${terms.network} to ${terms.payTo}`);

console.log("2. Signing payment with the sandbox wallet");
const signed = await fetch(BASE + "/api/sandbox-pay", { method: "POST", body: JSON.stringify({ paymentRequired: required }) }).then((r) => r.json());
if (!signed.paymentSignature) throw new Error(signed.error ?? "could not sign; is CRAWL402_FACILITATOR unset?");

console.log("3. Retrying with PAYMENT-SIGNATURE");
const second = await fetch(BASE + path, { headers: { "user-agent": UA, "payment-signature": signed.paymentSignature } });
console.log(`   → ${second.status}`);
const receipt = second.headers.get("payment-response");
if (receipt) console.log("   receipt:", decode(receipt));
console.log((await second.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200));
