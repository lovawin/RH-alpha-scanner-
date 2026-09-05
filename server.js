import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAll } from "./store.js";

// Start the blockchain scanner in the same service
import "./scanner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Serve dashboard
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// API used by dashboard
app.get("/api/tokens", (req, res) => {
  try {
    const all = loadAll();

    const list = Object.entries(all)
      .map(([address, data]) => ({
        address,
        ...data
      }))
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    res.json(list);
  } catch (error) {
    console.error("API error:", error);
    res.status(500).json({
      error: "Unable to load scanner data"
    });
  }
});

// Render health check
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "RH Alpha Scanner",
    chain: 4663
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`RH Alpha Scanner live on port ${PORT}`);
});
