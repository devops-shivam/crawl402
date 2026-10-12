export const ARTICLES = [
  {
    slug: "hello-crawlers",
    title: "Hello, crawlers",
    body: "This page is free for people and costs AI crawlers 0.002 USDC. Paid requests carry a PAYMENT-RESPONSE header with the settlement receipt.",
  },
  {
    slug: "how-x402-works",
    title: "How x402 works",
    body: "The server answers 402 with a PAYMENT-REQUIRED header. The client signs a payment for exactly those terms and retries with PAYMENT-SIGNATURE. A facilitator verifies and settles it.",
  },
];
