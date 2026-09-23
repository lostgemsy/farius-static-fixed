// server.mjs — run with `npm start`.
//
// Serves the whole site (static pages + /api/* + Socket.io chat) as one
// normal, persistent Node process. This works anywhere with `npm install
// && npm start`: your own machine, a VPS, Render, Railway, Fly.io, etc.
//
// For Vercel specifically, see api/index.mjs + vercel.json + README.md —
// Vercel's default serverless hosting can't keep a persistent Socket.io
// connection or write to disk, so this file (a real server) is the
// version to use if you want chat, signup, and admin actions to actually
// persist.

import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import apiRouter from "./api-router.mjs";
import { attachRealtime } from "./lib/realtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(apiRouter);

// Static site: `/`, `/chat`, `/chat.html`, `/games`, etc. all resolve.
app.use(express.static(__dirname, { extensions: ["html"] }));

// Anything else -> the site's own 404 page (instead of Express's default
// "Cannot GET /..." text).
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "404.html"), (err) => {
    if (err) res.status(404).send("Not found");
  });
});

const server = http.createServer(app);
attachRealtime(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Farius is running at http://localhost:${PORT}`);
  if ((process.env.ADMIN_PASSWORD || "farius2024") === "farius2024") {
    console.log(`Using the default admin password ("farius2024") — set ADMIN_PASSWORD in your environment to change it.`);
  }
});
