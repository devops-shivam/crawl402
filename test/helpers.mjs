import { createSandbox } from "../dist/testing/index.js";

export const SITE = "https://site.example";
export const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";

export const UA = {
  gptbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
  claudebot: "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  chatgptUser: "Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  python: "python-requests/2.32.3",
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};

export const BROWSER_HEADERS = { "user-agent": UA.chrome, "accept-language": "en-IN", "sec-fetch-mode": "navigate" };

export function req(path, headers = {}, init = {}) {
  return new Request(SITE + path, { ...init, headers });
}

export function setup() {
  const sandbox = createSandbox();
  const wallet = sandbox.createWallet({ balance: 1_000_000n });
  return { sandbox, wallet };
}
