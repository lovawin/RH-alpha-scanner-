import { provider } from "./rpc.js";

/**
 * Launchpad registry.
 *
 * IMPORTANT: these addresses are NOT prefilled. I don't have verified
 * factory addresses for hood.fun, pons, or any other Robinhood Chain
 * launchpad, and guessing one would make every token look like it came
 * from a launchpad it didn't. Fill these in yourself:
 *
 *   1. Open a token you KNOW launched on the pad you care about
 *   2. Look at its creation tx on Blockscout
 *   3. The `from` (or the factory it internal-called) is the address
 *
 * Until an entry is filled in, tokens from that pad show as "direct".
 */
export const LAUNCHPADS = [
  // { name: "hood.fun", factory: "0x...", bondingCurve: true },
  // { name: "pons",     factory: "0x...", bondingCurve: true },
];

/**
 * A launchpad launch is generally SAFER than a direct deploy — the pad
 * controls the token template, usually burns or locks LP automatically,
 * and the deployer can't inject custom logic. Direct-to-CA means the
 * deployer wrote whatever they wanted.
 */
export async function detectLaunchpad(tokenAddress, deployerAddress, creationTxHash) {
  const deployer = deployerAddress?.toLowerCase();

  for (const pad of LAUNCHPADS) {
    if (!pad.factory) continue;
    if (pad.factory.toLowerCase() === deployer) {
      return { origin: pad.name, viaLaunchpad: true, detail: `deployed via ${pad.name}` };
    }
  }

  // Check whether the creating tx was sent TO a known pad (factory pattern).
  if (creationTxHash) {
    try {
      const tx = await provider.getTransaction(creationTxHash);
      const target = tx?.to?.toLowerCase();
      for (const pad of LAUNCHPADS) {
        if (pad.factory && pad.factory.toLowerCase() === target) {
          return { origin: pad.name, viaLaunchpad: true, detail: `created through ${pad.name} factory` };
        }
      }
    } catch {
      /* fall through */
    }
  }

  return {
    origin: LAUNCHPADS.length ? "direct" : "unknown",
    viaLaunchpad: false,
    detail: LAUNCHPADS.length
      ? "direct deploy — deployer wrote the contract themselves"
      : "no launchpads configured (see src/launchpad.js)",
  };
}
