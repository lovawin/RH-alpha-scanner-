import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAll } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/tokens", (req, res) => {
  const all = loadAll();
  const list = Object.entries(all)
    .map(([address, data]) => ({ address, ...data }))
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  res.json(list);
});

app.listen(PORT, () => {
  console.log(`Dashboard running on http://localhost:${PORT}`);
});
