import fetch from "node-fetch";
import { BLOCKSCOUT_API, FETCH_HEADERS } from "./config.js";

async function bsGet(path) {
  const res = await fetch(`${BLOCKSCOUT_API}${path}`, { headers: FETCH_HEADERS });
  if (!res.ok) {
    throw new Error(`Blockscout ${path} -> HTTP ${res.status}`);
  }
  return res.json();
}

export async function getAddressInfo(address) {
  return bsGet(`/addresses/${address}`);
}

export async function getTokenInfo(address) {
  return bsGet(`/tokens/${address}`);
}

export async function getTokenHolders(address, limit = 20) {
  const data = await bsGet(`/tokens/${address}/holders?limit=${limit}`);
  return data.items || [];
}

export async function getAddressTransactions(address, limit = 50) {
  const data = await bsGet(`/addresses/${address}/transactions?limit=${limit}`);
  return data.items || [];
}

export async function getSmartContract(address) {
  try {
    return await bsGet(`/smart-contracts/${address}`);
  } catch {
    return null; // unverified or not a contract
  }
}
