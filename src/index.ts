// Core
export { createCrawl402 } from "./core/engine.js";
export type {
  Crawl402,
  Crawl402Config,
  Decision,
  HandleOptions,
  PaymentOption,
  CrawlerEvent,
  ChallengeEvent,
  PaidEvent,
  RejectedEvent,
} from "./core/engine.js";

// Protocol
export {
  X402_VERSION,
  HEADERS,
  encodeHeader,
  decodeHeader,
  toAtomicUnits,
  fromAtomicUnits,
} from "./core/protocol.js";
export type {
  PaymentRequired,
  PaymentRequirements,
  PaymentPayload,
  ResourceInfo,
  SettlementResponse,
  VerifyResponse,
} from "./core/protocol.js";

// Assets and networks
export { usdc, hasUsdcPreset, isValidAddress, NETWORKS } from "./core/assets.js";
export type { Asset } from "./core/assets.js";

// Paths
export { matchPath, DEFAULT_EXCLUDE } from "./core/paths.js";
export type { PathPattern } from "./core/paths.js";

// Detection
export { userAgent, missingBrowserHeaders, fromHeader, runDetectors, KNOWN_BOTS, matchBot } from "./detectors/index.js";
export type { Detector, Detection, UserAgentDetectorOptions, BotSignature, BotCategory } from "./detectors/index.js";

// Pricing
export { byPath, byBot, resolvePrice } from "./pricing/index.js";
export type { Price, PriceResolver, PriceContext } from "./pricing/index.js";

// Facilitators
export { httpFacilitator, FacilitatorError, X402_ORG_FACILITATOR } from "./facilitator/index.js";
export type { Facilitator, HttpFacilitatorOptions } from "./facilitator/index.js";

// Generic adapter
export { withCrawl402Fetch } from "./adapters/fetch.js";
