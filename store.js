import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "tokens.json");

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, "{}");
  }
}

export function loadAll() {
  ensureDb();

  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch (error) {
    console.error("Database read error:", error);
    return {};
  }
}

export function saveToken(tokenAddress, record) {
  ensureDb();

  const all = loadAll();
  const key = tokenAddress.toLowerCase();

  all[key] = {
    ...all[key],
    ...record,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(DB_PATH, JSON.stringify(all, null, 2));

  return all[key];
}

export function getToken(tokenAddress) {
  return loadAll()[tokenAddress.toLowerCase()];
}

export function countLaunchesByDeployer(deployerAddress) {
  const all = loadAll();

  return Object.values(all).filter(
    (token) =>
      token.deployer?.toLowerCase() === deployerAddress.toLowerCase()
  ).length;
}
