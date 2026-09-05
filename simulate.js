import { ethers } from "ethers";
import { provider } from "./rpc.js";
import { ROUTER_ADDRESS, WETH_ADDRESS } from "./config.js";

/**
 * The only trustworthy honeypot check is actually trying to sell.
 * Bytecode pattern matching cannot do this — a contract can look clean
 * and still block sells through logic no selector reveals.
 *
 * This simulates a buy then a sell using eth_call state overrides.
 * If the RPC doesn't support overrides, we return status "unavailable" —
 * which explicitly does NOT mean safe.
 */

const ROUTER_IFACE = new ethers.Interface([
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
]);

const PROBE = "0x00000000000000000000000000000000000f00d5"; // arbitrary sim address
const BUY_AMOUNT = ethers.parseEther("0.01");

async function supportsOverrides() {
  try {
    await provider.send("eth_call", [
      { to: ethers.ZeroAddress, data: "0x" },
      "latest",
      { [PROBE]: { balance: "0x1" } },
    ]);
    return true;
  } catch (e) {
    return !/unsupported|invalid argument|too many arguments/i.test(e.message || "");
  }
}

export async function simulateSell(tokenAddress) {
  let overridesOk;
  try {
    overridesOk = await supportsOverrides();
  } catch {
    overridesOk = false;
  }

  if (!overridesOk) {
    return {
      status: "unavailable",
      sellable: null,
      detail: "RPC does not support eth_call state overrides — sellability UNKNOWN, not confirmed safe",
    };
  }

  const deadline = Math.floor(Date.now() / 1000) + 600;
  const buyPath = [WETH_ADDRESS, tokenAddress];
  const sellPath = [tokenAddress, WETH_ADDRESS];
  const overrides = { [PROBE]: { balance: "0x" + ethers.parseEther("10").toString(16) } };

  try {
    // Expected output if the token behaved like a plain ERC-20.
    const quoted = await provider.call({
      to: ROUTER_ADDRESS,
      data: ROUTER_IFACE.encodeFunctionData("getAmountsOut", [BUY_AMOUNT, buyPath]),
    });
    const expectedTokens = ROUTER_IFACE.decodeFunctionResult("getAmountsOut", quoted)[0][1];

    // Simulate the buy.
    const buyData = ROUTER_IFACE.encodeFunctionData(
      "swapExactETHForTokensSupportingFeeOnTransferTokens",
      [0n, buyPath, PROBE, deadline]
    );
    await provider.send("eth_call", [
      { from: PROBE, to: ROUTER_ADDRESS, value: "0x" + BUY_AMOUNT.toString(16), data: buyData },
      "latest",
      overrides,
    ]);

    // Simulate the sell of what we'd have received.
    const sellData = ROUTER_IFACE.encodeFunctionData(
      "swapExactTokensForETHSupportingFeeOnTransferTokens",
      [expectedTokens, 0n, sellPath, PROBE, deadline]
    );
    await provider.send("eth_call", [
      { from: PROBE, to: ROUTER_ADDRESS, data: sellData },
      "latest",
      overrides,
    ]);

    return {
      status: "ok",
      sellable: true,
      detail: "simulated buy and sell both succeeded",
    };
  } catch (e) {
    const msg = (e.shortMessage || e.message || "").slice(0, 120);
    return {
      status: "reverted",
      sellable: false,
      detail: `sell simulation reverted — likely honeypot (${msg})`,
    };
  }
}
