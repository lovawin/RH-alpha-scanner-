import { provider, getNewPairs, pickNonWeth, erc20Contract, getTx, getPoolWethBalance } from "./rpc.js";
import { getNewPools, pickNonWethV3, scoreV3LpLock, feeLabel } from "./v3.js";
import {
  scoreLpLock, scoreDeployerHistory, scoreHolderConcentration,
  scoreVolumeMomentum, scoreContractRisk, composite,
} from "./scoring.js";
import { saveToken, getToken, countLaunchesByDeployer } from "./store.js";
import { getAddressInfo } from "./blockscout.js";
import { detectProxy } from "./proxy.js";
import { inspectBytecode } from "./bytecode.js";
import { simulateSell } from "./simulate.js";
import { analyzeBundle, scoreBundle } from "./bundle.js";
import { detectLaunchpad } from "./launchpad.js";
import { getMentions, queryFor } from "./social.js";
import { POLL_INTERVAL_MS, BLOCK_LOOKBACK_ON_START, BUNDLE_WINDOW_BLOCKS, MIN_LP_ETH } from "../config.js";

/**
 * Handles both V2 pairs and V3 pools. The only parts that genuinely
 * differ are which token is "new" and how LP lock is determined —
 * everything downstream (bytecode, proxy, holders, bundle, sim) is
 * about the TOKEN, not the pool, so it's shared.
 */
async function processPool(p) {
  const isV3 = p.version === "v3";
  const tokenAddress = isV3
    ? pickNonWethV3(p.token0, p.token1)
    : pickNonWeth(p.token0, p.token1);
  if (!tokenAddress) return;

  const ethInPool = await getPoolWethBalance(p.pair).catch(() => null);
  if (ethInPool !== null && ethInPool < MIN_LP_ETH) {
    console.log(`[skip] ${tokenAddress} LP too thin: ${ethInPool.toFixed(3)} ETH < ${MIN_LP_ETH} ETH min (${isV3 ? "v3" : "v2"})`);
    return;
  }

  const existing = getToken(tokenAddress);

  // A token can list on both V2 and V3. Keep the better-scoring venue
  // rather than letting the second one overwrite the first.
  const launchTx = await getTx(p.txHash);
  const deployer = launchTx?.from;
  if (!deployer) return;

  const block = await provider.getBlock(p.blockNumber);
  const launchedAt = existing?.launchedAt || block.timestamp * 1000;
  const minutes = (Date.now() - launchedAt) / 60000;

  let name = "?", symbol = "?";
  try {
    const t = erc20Contract(tokenAddress);
    [name, symbol] = await Promise.all([t.name(), t.symbol()]);
  } catch { /* nonstandard metadata */ }

  let swapCount = 0;
  try {
    const info = await getAddressInfo(p.pair);
    swapCount = Number(info.transactions_count || 0);
  } catch { /* leave 0 */ }

  const [proxy, bytecode, sellability, bundleData, launchpad] = await Promise.all([
    detectProxy(tokenAddress).catch(() => ({ kind: "unknown", upgradeable: false })),
    inspectBytecode(tokenAddress).catch(() => ({ found: [], verified: false })),
    simulateSell(tokenAddress).catch(() => ({ status: "error", sellable: null, detail: "sim failed" })),
    analyzeBundle(tokenAddress, p.pair, p.blockNumber, BUNDLE_WINDOW_BLOCKS)
      .catch(() => ({ bundlePct: null, walletCount: 0, detail: "bundle scan failed" })),
    detectLaunchpad(tokenAddress, deployer, p.txHash).catch(() => ({ origin: "unknown", viaLaunchpad: false })),
  ]);

  const lpLock = isV3
    ? await scoreV3LpLock(p, deployer, p.blockNumber).catch((e) => ({ score: 50, detail: "V3 LP check failed" }))
    : await scoreLpLock(p.pair, deployer).catch(() => ({ score: 50, detail: "LP check failed" }));

  const [deployerHistory, holderConcentration] = await Promise.all([
    scoreDeployerHistory(deployer, countLaunchesByDeployer(deployer)),
    scoreHolderConcentration(tokenAddress, p.pair),
  ]);

  const scores = {
    lpLock,
    deployerHistory,
    holderConcentration,
    volumeMomentum: scoreVolumeMomentum(swapCount, minutes),
    bundle: scoreBundle(bundleData),
    contractRisk: scoreContractRisk(proxy, bytecode, launchpad),
  };

  const result = composite(scores, sellability);
  const social = await getMentions(queryFor(symbol, tokenAddress)).catch(() => ({ count: null, configured: false }));

  const venue = isV3 ? `v3 ${feeLabel(p.fee)}` : "v2";

  // If we already scored this token on another venue, keep the higher score.
  if (existing && existing.score > result.score && existing.venue !== venue) {
    saveToken(tokenAddress, {
      alsoOn: [...new Set([...(existing.alsoOn || []), venue])],
    });
    console.log(`[skip] ${symbol} also on ${venue} (${result.score}) — keeping ${existing.venue} (${existing.score})`);
    return;
  }

  saveToken(tokenAddress, {
    name, symbol, pair: p.pair, deployer, launchedAt, launchTxHash: p.txHash,
    venue, dexVersion: isV3 ? "v3" : "v2", feeTier: isV3 ? p.fee : null,
    alsoOn: existing?.alsoOn || [],
    score: result.score, vetoed: result.vetoed, vetoReason: result.vetoReason, capped: result.capped,
    scores, proxy, bytecode, sellability, bundle: bundleData, launchpad, social,
  });

  console.log(`[scored] ${symbol} ${tokenAddress} (${venue}) -> ${result.vetoed ? "VETOED" : result.score + "/100"}`);
}

async function tick(state) {
  const latest = await provider.getBlockNumber();
  const from = state.lastBlock + 1;
  if (from > latest) return;

  const [pairs, pools] = await Promise.all([
    getNewPairs(from, latest).catch((e) => { console.error("v2 scan:", e.message); return []; }),
    getNewPools(from, latest).catch((e) => { console.error("v3 scan:", e.message); return []; }),
  ]);

  if (pairs.length || pools.length) {
    console.log(`Blocks ${from}-${latest}: ${pairs.length} V2 pairs, ${pools.length} V3 pools`);
  }

  for (const p of [...pairs, ...pools]) {
    try { await processPool(p); }
    catch (e) { console.error(`${p.version || "v2"} ${p.pair}:`, e.message); }
  }
  state.lastBlock = latest;
}

async function main() {
  const latest = await provider.getBlockNumber();
  const state = { lastBlock: latest - BLOCK_LOOKBACK_ON_START };
  console.log(`Scanner starting at block ${state.lastBlock} — watching Uniswap V2 + V3`);
  await tick(state);
  setInterval(() => tick(state).catch((e) => console.error("tick:", e.message)), POLL_INTERVAL_MS);
}

main().catch((e) => { console.error("crashed:", e); process.exit(1); });
