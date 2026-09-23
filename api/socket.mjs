// api/socket.mjs — best-effort Socket.io endpoint for Vercel.
//
// Vercel's standard serverless functions don't keep a persistent process
// or share memory between invocations, so "online users" and "who's
// connected" state here is NOT reliable in production once you have more
// than one function instance running (which Vercel does automatically
// under load). Chat messages/history still read and write through the
// same lib/store.mjs as everywhere else, so on Vercel they'll also hit
// the read-only-filesystem limit described in README.md.
//
// If you want chat that actually works reliably, deploy server.mjs to a
// normal persistent Node host (Render, Railway, Fly.io, a VPS, etc.) and
// point this domain's /socket.io traffic there instead — or just use
// `npm start` locally / on that host and skip this file entirely.

import { attachRealtime } from "../lib/realtime.mjs";

export default async function handler(req, res) {
  if (!res.socket?.server) {
    res.status(500).json({ error: "Socket.io isn't supported in this runtime." });
    return;
  }
  if (!res.socket.server.__farius_io) {
    res.socket.server.__farius_io = attachRealtime(res.socket.server, { transports: ["polling", "websocket"] });
  }
  res.end();
}

export const config = { api: { bodyParser: false } };
