import { RPC_URL, FACTORY_ADDRESS, WETH_ADDRESS } from "./config.js";


export const provider = new ethers.JsonRpcProvider(RPC_URL);

// Minimal ABIs — just what we need.
const FACTORY_ABI = [
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint256)",
];
const PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112,uint112,uint32)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];
const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
];

export function factoryContract() {
  if (!FACTORY_ADDRESS) {
    throw new Error(
      "FACTORY_ADDRESS not set. Run: cast call <router> \"factory()(address)\" and set RH_FACTORY_ADDRESS."
    );
  }
  return new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
}

export function pairContract(address) {
  return new ethers.Contract(address, PAIR_ABI, provider);
}

export function erc20Contract(address) {
  return new ethers.Contract(address, ERC20_ABI, provider);
}

/**
 * WETH balance actually held by a pool/pair contract, in whole ETH.
 * Works for V2 (== reserve) and V3 (sum across all position ticks) —
 * same read either way, no venue-specific liquidity math needed.
 */
export async function getPoolWethBalance(poolAddress) {
  const weth = erc20Contract(WETH_ADDRESS);
  const bal = await weth.balanceOf(poolAddress);
  return Number(ethers.formatEther(bal));
}

/** Pull PairCreated logs between two blocks. */
export async function getNewPairs(fromBlock, toBlock) {
  const factory = factoryContract();
  const events = await factory.queryFilter(
    factory.filters.PairCreated(),
    fromBlock,
    toBlock
  );
  return events.map((e) => ({
    token0: e.args.token0,
    token1: e.args.token1,
    pair: e.args.pair,
    blockNumber: e.blockNumber,
    txHash: e.transactionHash,
    version: "v2",
  }));
}

/** Given a pair's two tokens, return whichever one isn't WETH (the "new" token). */
export function pickNonWeth(token0, token1) {
  const weth = WETH_ADDRESS.toLowerCase();
  if (token0.toLowerCase() === weth) return token1;
  if (token1.toLowerCase() === weth) return token0;
  return null; // neither side is WETH — not a token/ETH pair, skip
}

export async function getTx(txHash) {
  return provider.getTransaction(txHash);
}
