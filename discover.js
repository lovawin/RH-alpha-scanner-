import { ethers } from "ethers";
import { RPC_URL, WETH_ADDRESS } from "./config.js";

/**
 * Robinhood publishes no DEX addresses (their protocol-contracts page has
 * none — the chain is permissionless, so every DEX on it is third-party).
 * Rather than trusting a forum post, this finds the router empirically:
 * it watches recent blocks for pair/pool creation events and reports which
 * factories are actually active.
 *
 *   node --env-file-if-exists=.env src/discover.js
 */

const provider = new ethers.JsonRpcProvider(RPC_URL);

const V2_PAIR_CREATED = ethers.id("PairCreated(address,address,address,uint256)");
const V3_POOL_CREATED = ethers.id("PoolCreated(address,address,uint24,int24,address)");

// Official Uniswap deployments for Robinhood Chain (developers.uniswap.org)
const CANDIDATE_ROUTERS = [
  ["UniswapV2Router02", "0x89e5DB8B5aA49aA85AC63f691524311AEB649eba"],
  ["UniswapV3 SwapRouter02", "0xCaf681a66D020601342297493863E78C959E5cb2"],
  ["UniversalRouter", "0x8876789976dEcBfCbBbe364623C63652db8C0904"],
];

const CANDIDATE_FACTORIES = [
  ["UniswapV2Factory", "0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f"],
  ["UniswapV3Factory", "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"],
];

async function probeRouter(addr) {
  const code = await provider.getCode(addr);
  if (code === "0x") return { addr, exists: false };

  const out = { addr, exists: true, codeSize: (code.length - 2) / 2 };
  for (const [label, sig] of [["factory", "factory()(address)"], ["WETH", "WETH()(address)"]]) {
    try {
      const iface = new ethers.Interface([`function ${sig.split("(")[0]}() view returns (address)`]);
      const res = await provider.call({
        to: addr,
        data: iface.encodeFunctionData(sig.split("(")[0], []),
      });
      out[label] = res && res !== "0x" ? ethers.getAddress("0x" + res.slice(26)) : null;
    } catch {
      out[label] = null;
    }
  }
  return out;
}

async function findActiveFactories(lookback = 5000) {
  const latest = await provider.getBlockNumber();
  const from = Math.max(0, latest - lookback);
  const counts = { v2: new Map(), v3: new Map() };

  for (const [kind, topic] of [["v2", V2_PAIR_CREATED], ["v3", V3_POOL_CREATED]]) {
    try {
      const logs = await provider.getLogs({ topics: [topic], fromBlock: from, toBlock: latest });
      for (const l of logs) {
        const a = ethers.getAddress(l.address);
        counts[kind].set(a, (counts[kind].get(a) || 0) + 1);
      }
    } catch (e) {
      console.log(`  (${kind} log scan failed: ${e.message.slice(0, 80)})`);
    }
  }
  return { counts, from, latest };
}

async function main() {
  console.log(`RPC: ${RPC_URL}\n`);

  console.log("Candidate routers:");
  for (const [label, r] of CANDIDATE_ROUTERS) {
    const p = await probeRouter(r);
    console.log(`  ${label}`);
    if (!p.exists) {
      console.log(`    ${r}  -> NO CODE (not deployed on this chain)`);
    } else {
      console.log(`    ${r}  -> ${p.codeSize} bytes`);
      console.log(`      factory(): ${p.factory || "call failed / not a router"}`);
      console.log(`      WETH():    ${p.WETH || "call failed"}`);
      if (p.WETH && p.WETH.toLowerCase() !== WETH_ADDRESS.toLowerCase()) {
        console.log(`      WARNING: router WETH != official WETH (${WETH_ADDRESS})`);
      }
    }
  }

  console.log("\nCandidate factories (direct probe):");
  for (const [label, f] of CANDIDATE_FACTORIES) {
    const code = await provider.getCode(f);
    console.log(`  ${label}\n    ${f}  -> ${code === "0x" ? "NO CODE" : ((code.length - 2) / 2) + " bytes"}`);
  }

  console.log("\nScanning recent blocks for live pair/pool creation...");
  const { counts, from, latest } = await findActiveFactories();
  console.log(`  blocks ${from} -> ${latest}\n`);

  for (const kind of ["v2", "v3"]) {
    const sorted = [...counts[kind].entries()].sort((a, b) => b[1] - a[1]);
    if (!sorted.length) {
      console.log(`  ${kind.toUpperCase()}: no ${kind === "v2" ? "PairCreated" : "PoolCreated"} events found`);
      continue;
    }
    console.log(`  ${kind.toUpperCase()} factories by activity:`);
    for (const [addr, n] of sorted.slice(0, 5)) {
      console.log(`    ${addr}  ${n} pools created`);
    }
  }

  console.log(`
Interpreting this:
  - Most activity on V2 -> scanner covers where launches happen. Good.
  - Most activity on V3 -> the scanner is MISSING those launches. It only
    watches V2 PairCreated. V3 support would need PoolCreated handling and
    NFT-position logic for the LP lock check.
  - Split roughly evenly -> you are seeing about half the launches.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
