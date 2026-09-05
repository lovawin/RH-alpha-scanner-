import { ethers } from "ethers";
import { provider } from "./rpc.js";
import { V3, WETH_ADDRESS, BURN_ADDRESSES } from "../config.js";

const FACTORY_ABI = [
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
];

const POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
];

const NPM_ABI = [
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256, uint256, uint128, uint128)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
];

export function v3Factory() {
  return new ethers.Contract(V3.factory, FACTORY_ABI, provider);
}

export function v3Pool(address) {
  return new ethers.Contract(address, POOL_ABI, provider);
}

export function positionManager() {
  return new ethers.Contract(V3.positionManager, NPM_ABI, provider);
}

/** Pull PoolCreated logs. Mirrors getNewPairs() on the V2 side. */
export async function getNewPools(fromBlock, toBlock) {
  const factory = v3Factory();
  const events = await factory.queryFilter(factory.filters.PoolCreated(), fromBlock, toBlock);
  return events.map((e) => ({
    token0: e.args.token0,
    token1: e.args.token1,
    fee: Number(e.args.fee),
    pair: e.args.pool, // named `pair` so downstream code stays shared
    blockNumber: e.blockNumber,
    txHash: e.transactionHash,
    version: "v3",
  }));
}

/**
 * V3 LP lock is a different question than V2.
 *
 * V2: LP is a fungible ERC-20; you check balanceOf(burn) against
 * totalSupply and you're done.
 *
 * V3: liquidity is an ERC-721 position NFT held by whoever minted it.
 * "Locked" means that NFT is burned or held by a locker — the position
 * itself can't be pulled without the NFT. So we have to find which
 * positions belong to this pool, then check who owns them.
 *
 * There's no on-chain index from pool -> positions, so we scan
 * IncreaseLiquidity events from the position manager in a block window
 * and match each tokenId's positions() data against the pool's
 * token0/token1/fee triple.
 */
export async function scoreV3LpLock(poolInfo, deployerAddress, launchBlock, windowBlocks = 50) {
  const npm = positionManager();

  let logs;
  try {
    logs = await provider.getLogs({
      address: V3.positionManager,
      topics: [ethers.id("IncreaseLiquidity(uint256,uint128,uint256,uint256)")],
      fromBlock: launchBlock,
      toBlock: launchBlock + windowBlocks,
    });
  } catch (e) {
    return { score: 50, detail: `V3 position scan failed: ${e.message.slice(0, 60)}` };
  }

  const t0 = poolInfo.token0.toLowerCase();
  const t1 = poolInfo.token1.toLowerCase();
  const seen = new Set();
  const owners = new Map(); // owner -> total liquidity
  let totalLiquidity = 0n;

  for (const log of logs) {
    const tokenId = BigInt(log.topics[1]);
    if (seen.has(tokenId)) continue;
    seen.add(tokenId);

    try {
      const pos = await npm.positions(tokenId);
      if (
        pos.token0.toLowerCase() !== t0 ||
        pos.token1.toLowerCase() !== t1 ||
        Number(pos.fee) !== poolInfo.fee
      ) continue;

      const owner = (await npm.ownerOf(tokenId)).toLowerCase();
      const liq = BigInt(pos.liquidity);
      owners.set(owner, (owners.get(owner) || 0n) + liq);
      totalLiquidity += liq;
    } catch {
      // burned NFT -> ownerOf reverts. That's the strongest lock there is:
      // no owner means the position can never be withdrawn.
      try {
        const pos = await npm.positions(tokenId);
        if (
          pos.token0.toLowerCase() === t0 &&
          pos.token1.toLowerCase() === t1 &&
          Number(pos.fee) === poolInfo.fee
        ) {
          const liq = BigInt(pos.liquidity);
          owners.set("burned", (owners.get("burned") || 0n) + liq);
          totalLiquidity += liq;
        }
      } catch { /* position gone entirely */ }
    }
  }

  if (totalLiquidity === 0n) {
    return { score: 50, detail: "no V3 positions found in scan window" };
  }

  const burned =
    (owners.get("burned") || 0n) +
    [...BURN_ADDRESSES].reduce((sum, b) => sum + (owners.get(b) || 0n), 0n);

  if (burned >= (totalLiquidity * 90n) / 100n) {
    return { score: 100, detail: ">=90% of V3 position liquidity burned" };
  }

  const deployerLiq = owners.get(deployerAddress.toLowerCase()) || 0n;
  if (deployerLiq >= (totalLiquidity * 50n) / 100n) {
    return { score: 0, detail: "deployer holds majority of V3 position NFTs — can pull anytime" };
  }

  const pct = Number((deployerLiq * 100n) / totalLiquidity);
  return {
    score: 50,
    detail: `V3 positions not burned (deployer holds ${pct}%) — verify locker`,
  };
}

/** V3 has no getReserves(); liquidity + sqrtPrice is the equivalent read. */
export async function getV3PoolState(poolAddress) {
  const pool = v3Pool(poolAddress);
  try {
    const [liquidity, slot0] = await Promise.all([pool.liquidity(), pool.slot0()]);
    return { liquidity: liquidity.toString(), sqrtPriceX96: slot0[0].toString(), tick: Number(slot0[1]) };
  } catch {
    return null;
  }
}

export function pickNonWethV3(token0, token1) {
  const weth = WETH_ADDRESS.toLowerCase();
  if (token0.toLowerCase() === weth) return token1;
  if (token1.toLowerCase() === weth) return token0;
  return null;
}

/** Human-readable fee tier: 3000 -> "0.3%" */
export function feeLabel(fee) {
  return (fee / 10000).toFixed(fee < 1000 ? 2 : 1).replace(/\.?0+$/, "") + "%";
}
