import { ethers } from "ethers";
import { provider } from "./rpc.js";
import { getSmartContract } from "./blockscout.js";

/**
 * Selectors worth knowing about. Presence in bytecode means the function
 * EXISTS — not that it will be used against you. Treat these as "things
 * to go read the source for", never as proof of intent.
 */
const WATCH = [
  ["mint(address,uint256)",            "mint",       "supply can be inflated"],
  ["setTaxes(uint256,uint256)",        "tax",        "adjustable tax"],
  ["setFees(uint256,uint256)",         "tax",        "adjustable fees"],
  ["setMaxTxAmount(uint256)",          "maxtx",      "per-tx cap can be changed"],
  ["setMaxWalletAmount(uint256)",      "maxwallet",  "per-wallet cap can be changed"],
  ["blacklist(address)",               "blacklist",  "addresses can be blocked"],
  ["setBlacklist(address,bool)",       "blacklist",  "addresses can be blocked"],
  ["addBot(address)",                  "blacklist",  "addresses can be blocked"],
  ["pause()",                          "pausable",   "transfers can be halted"],
  ["setTradingEnabled(bool)",          "tradinggate","trading can be switched off"],
  ["enableTrading()",                  "tradinggate","trading gated behind owner call"],
  ["setSwapEnabled(bool)",             "tradinggate","swaps can be switched off"],
  ["transferOwnership(address)",       "ownable",    "has an owner role"],
  ["renounceOwnership()",              "renounce",   "owner can renounce"],
  ["setUnlockTime(uint256)",           "timelock",   "timelock is adjustable"],
  ["lock(uint256)",                    "timelock",   "has a lock mechanism"],
  ["unlock()",                         "timelock",   "has an unlock mechanism"],
];

function selectorOf(sig) {
  return ethers.id(sig).slice(0, 10).slice(2); // 4-byte hex, no 0x
}

const WATCH_MAP = WATCH.map(([sig, tag, why]) => ({
  sel: selectorOf(sig), sig, tag, why,
}));

/** Raw opcode presence — cheap scan, no full disassembly. */
function opcodeFlags(code) {
  const hex = code.slice(2).toLowerCase();
  return {
    // f4 = DELEGATECALL, ff = SELFDESTRUCT. Byte-level scan is approximate
    // (PUSH data can contain these bytes) so this is a "go look" hint only.
    delegatecall: /f4/.test(hex),
    selfdestruct: /ff/.test(hex),
    sizeBytes: (hex.length / 2) | 0,
  };
}

export async function inspectBytecode(address) {
  const code = await provider.getCode(address);
  if (code === "0x") {
    return { isContract: false, found: [], verified: false, opcodes: null };
  }

  const body = code.slice(2).toLowerCase();
  const found = WATCH_MAP
    .filter((w) => body.includes(w.sel))
    .map(({ sig, tag, why }) => ({ sig, tag, why }));

  // Verified source is worth far more than any bytecode guess — if it's
  // there, say so loudly and let the user go read it.
  const verified = await getSmartContract(address);

  return {
    isContract: true,
    found,
    verified: !!verified?.is_verified,
    sourceName: verified?.name || null,
    // Library links only show up in verified metadata; unverified contracts
    // can't be checked for this at all.
    externalLibraries: verified?.external_libraries || [],
    opcodes: opcodeFlags(code),
  };
}
