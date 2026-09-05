import { ethers } from "ethers";
import { provider } from "./rpc.js";

// Standard storage slots. These are fixed by spec, so reading them is
// deterministic — no guessing involved.
const SLOT_1967_IMPL  = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const SLOT_1967_ADMIN = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const SLOT_1967_BEACON = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
const SLOT_1822_IMPL  = "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7";

function slotToAddress(word) {
  if (!word || word === ethers.ZeroHash) return null;
  const addr = "0x" + word.slice(26);
  return addr === ethers.ZeroAddress ? null : ethers.getAddress(addr);
}

/**
 * Classify what kind of contract (or delegated account) lives at an address.
 * Every branch here is a spec-defined pattern, not a heuristic.
 */
export async function detectProxy(address) {
  const code = await provider.getCode(address);

  if (code === "0x") {
    return { kind: "eoa", implementation: null, admin: null, upgradeable: false };
  }

  // EIP-7702: delegated EOA. Code is exactly 0xef0100 + 20-byte address.
  if (code.startsWith("0xef0100") && code.length === 48) {
    return {
      kind: "eip7702",
      implementation: ethers.getAddress("0x" + code.slice(8)),
      admin: null,
      upgradeable: true, // the EOA key can re-delegate at any time
      note: "delegated EOA — key holder can swap the logic at will",
    };
  }

  // EIP-1167 minimal proxy: fixed bytecode shape with the target embedded.
  const m = code.match(/^0x363d3d373d3d3d363d73([0-9a-fA-F]{40})5af43d82803e903d91602b57fd5bf3$/);
  if (m) {
    return {
      kind: "minimal-proxy",
      implementation: ethers.getAddress("0x" + m[1]),
      admin: null,
      upgradeable: false, // clone target is baked into bytecode
    };
  }

  const [impl1967, admin1967, beacon, impl1822] = await Promise.all([
    provider.getStorage(address, SLOT_1967_IMPL),
    provider.getStorage(address, SLOT_1967_ADMIN),
    provider.getStorage(address, SLOT_1967_BEACON),
    provider.getStorage(address, SLOT_1822_IMPL),
  ]);

  const i1967 = slotToAddress(impl1967);
  if (i1967) {
    return {
      kind: "eip1967",
      implementation: i1967,
      admin: slotToAddress(admin1967),
      upgradeable: true,
      note: "admin can replace token logic after launch",
    };
  }

  const b = slotToAddress(beacon);
  if (b) {
    return { kind: "beacon-proxy", implementation: null, beacon: b, admin: null, upgradeable: true };
  }

  const i1822 = slotToAddress(impl1822);
  if (i1822) {
    return { kind: "eip1822", implementation: i1822, admin: null, upgradeable: true };
  }

  return { kind: "plain", implementation: null, admin: null, upgradeable: false };
}
