// Development helper for scripts/bot.mjs: signs a payment with a sandbox wallet.
// A real crawler signs with its own wallet (e.g. using @x402/fetch). Remove this route in production.
import { sandbox } from "../../../lib/paywall";

const wallet = sandbox?.createWallet({ address: "0x857b06519E91e3A54538791bDbb0E22373e36b66", balance: 1_000_000n });

export async function POST(request: Request) {
  if (!sandbox || !wallet || process.env.NODE_ENV === "production") {
    return Response.json({ error: "sandbox disabled" }, { status: 404 });
  }
  const { paymentRequired } = (await request.json()) as { paymentRequired: string };
  return Response.json({
    paymentSignature: wallet.pay(paymentRequired),
    balanceAfterPayment: (wallet.balance()).toString(),
  });
}
