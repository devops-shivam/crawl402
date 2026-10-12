/**
 * Tokens a crawler can pay with.
 *
 * Presets are only included where the contract address has been checked.
 * Any other EIP-3009 token (EVM) or SPL token (Solana) can be used by passing
 * an `Asset` object yourself. See docs/extending.md.
 */

export interface Asset {
  /** Token contract (EVM) or mint (Solana) address. */
  address: string;
  /** Token decimals, e.g. 6 for USDC. */
  decimals: number;
  /** Scheme-specific data sent in `PaymentRequirements.extra` (EIP-712 domain name/version on EVM). */
  extra?: Record<string, unknown>;
  /** Display symbol, used in human-readable messages only. */
  symbol?: string;
}

export const NETWORKS = {
  base: "eip155:8453",
  baseSepolia: "eip155:84532",
} as const;

const USDC_PRESETS: Record<string, Asset> = {
  [NETWORKS.base]: {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    extra: { name: "USD Coin", version: "2" },
    symbol: "USDC",
  },
  [NETWORKS.baseSepolia]: {
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    decimals: 6,
    extra: { name: "USDC", version: "2" },
    symbol: "USDC",
  },
};

/** USDC on a supported network. Throws for networks without a preset. */
export function usdc(network: string): Asset {
  const asset = USDC_PRESETS[network];
  if (!asset) {
    throw new Error(
      `crawl402: no USDC preset for "${network}". Pass an asset object instead: { address, decimals, extra }. ` +
        `Presets: ${Object.keys(USDC_PRESETS).join(", ")}`,
    );
  }
  return { ...asset, extra: asset.extra ? { ...asset.extra } : undefined };
}

/** True for networks this package ships a USDC preset for. */
export function hasUsdcPreset(network: string): boolean {
  return network in USDC_PRESETS;
}

/** Check that an address looks right for its network family. Unknown families pass. */
export function isValidAddress(network: string, address: string): boolean {
  if (network.startsWith("eip155:")) return /^0x[0-9a-fA-F]{40}$/.test(address);
  if (network.startsWith("solana:")) return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  return address.length > 0;
}

/** EVM addresses are case-insensitive; others (e.g. Solana base58) are not. */
export function sameAddress(network: string, a: string, b: string): boolean {
  return network.startsWith("eip155:") ? a.toLowerCase() === b.toLowerCase() : a === b;
}
