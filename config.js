// ── Robinhood Chain (4663) ──────────────────────────────────────────
export const RPC_URL = process.env.RH_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
export const CHAIN_ID = 4663;
export const BLOCKSCOUT_API = "https://robinhoodchain.blockscout.com/api/v2";

// Blockscout fronts Cloudflare and 403s on bare requests without a UA.
export const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; rh-alpha-tracker/1.0)",
  "Accept": "application/json",
};

// ── DEX addresses ────────────────────────────────────────────────────
// All confirmed against official sources:
//   Uniswap: developers.uniswap.org (Robinhood Chain deployments)
//   WETH:    docs.robinhood.com/chain/protocol-contracts
//
// Uniswap deployed BOTH V2 and V3 to this chain. This scanner watches V2
// only. See V3 note below — that is a real coverage gap, not an oversight.

export const ROUTER_ADDRESS  = process.env.RH_ROUTER_ADDRESS  || "0x89e5DB8B5aA49aA85AC63f691524311AEB649eba"; // UniswapV2Router02
export const FACTORY_ADDRESS = process.env.RH_FACTORY_ADDRESS || "0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f"; // UniswapV2Factory

export const WETH_ADDRESS = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"; // official L2 WETH
export const USDG_ADDRESS = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"; // third-party source, unverified

// ── Uniswap V3 (present on this chain, NOT currently scanned) ────────
// The scanner assumes V2 end to end: PairCreated events, getReserves(),
// fungible LP tokens for the lock check. V3 uses PoolCreated and NFT
// liquidity positions, so pair watching, LP lock detection, and bundle
// analysis would all need V3 equivalents.
//
// Run `npm run discover` to see which factory has real launch activity.
// If tokens are launching on V3, this scanner will not see them.
export const V3 = {
  factory:         "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  swapRouter02:    "0xCaf681a66D020601342297493863E78C959E5cb2",
  positionManager: "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3",
  universalRouter: "0x8876789976dEcBfCbBbe364623C63652db8C0904",
  quoterV2:        "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
  permit2:         "0x000000000022D473030F116dDEE9F6B43aC78BA3",
};

// Common burn/dead addresses — LP tokens sent here count as "locked".
export const BURN_ADDRESSES = new Set([
  "0x000000000000000000000000000000000000dead",
  "0x0000000000000000000000000000000000000000",
]);

// ── Scoring weights (must sum to 1.0) ───────────────────────────────
export const WEIGHTS = {
  lpLock: 0.22,
  contractRisk: 0.22,
  bundle: 0.18,
  holderConcentration: 0.15,
  deployerHistory: 0.13,
  volumeMomentum: 0.10,
};

// Sellability is NOT in the weights — it acts as a veto in composite().
// A token that can't be sold scores 0 no matter what else is true.

// Blocks after launch to scan for bundled/sniped buys.
export const BUNDLE_WINDOW_BLOCKS = 3;

// Minimum WETH sitting in a pool/pair contract to bother scoring it.
// Applies to both V2 and V3 — see getPoolWethBalance() in rpc.js.
export const MIN_LP_ETH = Number(process.env.RH_MIN_LP_ETH || 0.5);

// How far back / how often the scanner looks for new pairs.
export const POLL_INTERVAL_MS = 15_000;
export const BLOCK_LOOKBACK_ON_START = 500;

// Data file — flat JSON, swap for SQLite/Postgres once this proves out.
export const DB_PATH = new URL("./data/tokens.json", import.meta.url).pathname;
