import { ethers } from "ethers";
import { provider } from "./rpc.js";

const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

/**
 * "Bundle %" — how much of supply was scooped in the launch block and the
 * few blocks right after, and by how many distinct wallets.
 *
 * High % across few wallets = the deployer's own bundle, and those wallets
 * are the ones who will dump on you. This is computed from Transfer logs,
 * so it's real data, not an estimate.
 */
export async function analyzeBundle(tokenAddress, pairAddress, launchBlock, windowBlocks = 3) {
  const logs = await provider.getLogs({
    address: tokenAddress,
    topics: [TRANSFER_TOPIC],
    fromBlock: launchBlock,
    toBlock: launchBlock + windowBlocks,
  });

  const pair = pairAddress.toLowerCase();
  const buys = new Map(); // wallet -> total received from the pair

  for (const log of logs) {
    const from = ("0x" + log.topics[1].slice(26)).toLowerCase();
    const to = ("0x" + log.topics[2].slice(26)).toLowerCase();
    if (from !== pair) continue; // only count tokens leaving the LP = buys
    const amount = BigInt(log.data);
    buys.set(to, (buys.get(to) || 0n) + amount);
  }

  let totalSupply = 0n;
  try {
    const erc20 = new ethers.Contract(
      tokenAddress,
      ["function totalSupply() view returns (uint256)"],
      provider
    );
    totalSupply = await erc20.totalSupply();
  } catch {
    /* fall through */
  }

  const bundled = [...buys.values()].reduce((a, b) => a + b, 0n);
  const wallets = buys.size;
  const pct = totalSupply > 0n ? Number((bundled * 10000n) / totalSupply) / 100 : null;

  return {
    bundlePct: pct,
    walletCount: wallets,
    blocksScanned: windowBlocks + 1,
    detail:
      pct === null
        ? "supply unreadable — bundle % unknown"
        : `${pct.toFixed(1)}% of supply taken by ${wallets} wallet${wallets === 1 ? "" : "s"} in first ${windowBlocks + 1} blocks`,
  };
}

/**
 * Bundle score (0-100). Heavy early concentration across few wallets is
 * the strongest single predictor of a coordinated dump.
 */
export function scoreBundle({ bundlePct, walletCount }) {
  if (bundlePct === null) return { score: 50, detail: "bundle % unknown" };

  let score = Math.max(0, 100 - bundlePct * 2);
  // Few wallets holding a lot is worse than many wallets holding the same.
  if (walletCount > 0 && walletCount <= 3 && bundlePct > 15) score = Math.min(score, 20);
  if (walletCount === 1 && bundlePct > 10) score = Math.min(score, 10);

  return {
    score: Math.round(score),
    detail: `${bundlePct.toFixed(1)}% bundled across ${walletCount} wallet${walletCount === 1 ? "" : "s"}`,
  };
}
