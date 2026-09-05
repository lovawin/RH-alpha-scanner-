import { WEIGHTS, BURN_ADDRESSES } from "./config.js";
import { pairContract } from "./rpc.js";
import { getTokenHolders, getAddressTransactions } from "./blockscout.js";

export async function scoreLpLock(pairAddress, deployerAddress) {
  const pair = pairContract(pairAddress);
  const totalSupply = await pair.totalSupply();
  if (totalSupply === 0n) return { score: 0, detail: "no LP supply" };

  for (const burn of BURN_ADDRESSES) {
    const bal = await pair.balanceOf(burn);
    if (bal > 0n && bal >= (totalSupply * 90n) / 100n) {
      return { score: 100, detail: ">=90% LP burned" };
    }
  }

  const deployerBal = await pair.balanceOf(deployerAddress);
  if (deployerBal >= (totalSupply * 50n) / 100n) {
    return { score: 0, detail: "deployer holds majority of LP — can pull anytime" };
  }
  return { score: 50, detail: "LP not burned, not deployer-held — verify manually" };
}

export async function scoreDeployerHistory(deployerAddress, priorLaunchCount) {
  let score = Math.max(0, Math.min(100, 100 - priorLaunchCount * 15));
  let detail = `${priorLaunchCount} prior launches seen`;
  try {
    const txs = await getAddressTransactions(deployerAddress, 50);
    if (txs.length < 5) {
      score = Math.min(score, 30);
      detail += "; fresh wallet (<5 txs)";
    }
  } catch {
    detail += "; history lookup failed";
  }
  return { score, detail };
}

export async function scoreHolderConcentration(tokenAddress, pairAddress) {
  try {
    const holders = await getTokenHolders(tokenAddress, 15);
    if (!holders.length) return { score: 50, detail: "no holder data yet" };
    const total = holders.reduce((s, h) => s + BigInt(h.value || 0), 0n);
    if (total === 0n) return { score: 50, detail: "supply unreadable" };
    const top10 = holders
      .filter((h) => h.address?.hash?.toLowerCase() !== pairAddress.toLowerCase())
      .slice(0, 10)
      .reduce((s, h) => s + BigInt(h.value || 0), 0n);
    const pct = Number((top10 * 10000n) / total) / 100;
    return { score: Math.max(0, Math.round(100 - pct)), detail: `top 10 non-LP hold ${pct.toFixed(1)}%` };
  } catch (e) {
    return { score: 50, detail: `holder lookup failed` };
  }
}

export function scoreVolumeMomentum(swapCount, minutes) {
  if (minutes <= 0) return { score: 0, detail: "just launched" };
  const rate = swapCount / minutes;
  return {
    score: Math.max(0, Math.min(100, Math.round(rate * 70))),
    detail: `${swapCount} txs in ${minutes.toFixed(1)}m`,
  };
}

/**
 * Contract risk from proxy status + bytecode findings.
 * Upgradeable proxy is the big one: the token you audited can be
 * replaced with different code after you buy.
 */
export function scoreContractRisk(proxy, bytecode, launchpad) {
  let score = 100;
  const notes = [];

  if (proxy.kind === "eip1967" || proxy.kind === "eip1822" || proxy.kind === "beacon-proxy") {
    score -= 45;
    notes.push(`upgradeable ${proxy.kind} — logic can be swapped post-launch`);
  } else if (proxy.kind === "eip7702") {
    score -= 50;
    notes.push("7702 delegated account — key holder can re-delegate");
  }

  const tags = new Set((bytecode.found || []).map((f) => f.tag));
  if (tags.has("mint")) { score -= 25; notes.push("mint present"); }
  if (tags.has("blacklist")) { score -= 25; notes.push("blacklist present"); }
  if (tags.has("tradinggate")) { score -= 15; notes.push("trading can be gated"); }
  if (tags.has("pausable")) { score -= 15; notes.push("pausable"); }
  if (tags.has("tax")) { score -= 10; notes.push("adjustable tax"); }

  if (bytecode.verified) { score += 10; notes.push("source verified"); }
  else notes.push("source NOT verified");

  if (launchpad.viaLaunchpad) { score += 15; notes.push(`via ${launchpad.origin}`); }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    detail: notes.join("; ") || "no flags found",
  };
}

/**
 * Composite. Sellability is a VETO, not a weight — a token you cannot
 * sell is worth zero regardless of how good everything else looks.
 */
export function composite(scores, sellability) {
  if (sellability?.sellable === false) {
    return { score: 0, vetoed: true, vetoReason: "sell simulation reverted — honeypot" };
  }

  const total =
    scores.lpLock.score * WEIGHTS.lpLock +
    scores.deployerHistory.score * WEIGHTS.deployerHistory +
    scores.holderConcentration.score * WEIGHTS.holderConcentration +
    scores.volumeMomentum.score * WEIGHTS.volumeMomentum +
    scores.bundle.score * WEIGHTS.bundle +
    scores.contractRisk.score * WEIGHTS.contractRisk;

  // Unknown sellability caps the score — unknown is not safe.
  let score = Math.round(total);
  let capped = false;
  if (sellability?.sellable === null) {
    if (score > 70) { score = 70; capped = true; }
  }

  return { score, vetoed: false, capped };
}
