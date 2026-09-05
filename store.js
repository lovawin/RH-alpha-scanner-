import fs from "node:fs";
import path from "node:path";
import { DB_PATH } from "./config.js";

function ensureDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, "{}");
}

export function loadAll() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

export function saveToken(tokenAddress, record) {
  ensureDb();
  const all = loadAll();
  all[tokenAddress.toLowerCase()] = {
    ...all[tokenAddress.toLowerCase()],
    ...record,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(DB_PATH, JSON.stringify(all, null, 2));
  return all[tokenAddress.toLowerCase()];
}

export function getToken(tokenAddress) {
  return loadAll()[tokenAddress.toLowerCase()];
}

export function countLaunchesByDeployer(deployerAddress) {
  const all = loadAll();
  return Object.values(all).filter(
    (t) => t.deployer?.toLowerCase() === deployerAddress.toLowerCase()
  ).length;
}
