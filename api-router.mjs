// api-router.mjs
//
// All /api/* routes, as an Express Router. Used both by server.mjs (local /
// traditional hosting) and by api/index.mjs (Vercel). Storage is the plain
// JSON files in /data via lib/store.mjs — no external database needed.

import express from "express";
import multer from "multer";
import { promises as fsp } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { read, write, makeId, makeToken } from "./lib/store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "farius2024";
const SUGGEST_COOLDOWN_MS = 20 * 60 * 1000;

const router = express.Router();

router.use(express.json({ limit: "8mb" }));
router.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

/* ============================================
   HELPERS
   ============================================ */
function getClientIp(req) {
  return (
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function getIdentifier(req, body) {
  const name = ((body && body.yourName) || "").trim();
  if (name && name.toLowerCase() !== "anonymous") return "user:" + name.toLowerCase();
  return "ip:" + getClientIp(req);
}

async function findUser(username) {
  const users = await read("users.json", []);
  return users.find((u) => u.username.toLowerCase() === String(username || "").toLowerCase());
}

/* ============================================
   AUTH
   ============================================ */
router.post("/api/signup", async (req, res) => {
  const { username, password, avatar } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });
  if (username.length < 3) return res.status(400).json({ error: "Username 3+ chars" });
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: "Letters, numbers, underscores only" });
  if (password.length < 6) return res.status(400).json({ error: "Password 6+ chars" });

  const users = await read("users.json", []);
  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: "Username taken" });
  }

  const user = { username, password, avatar: avatar || "png/logo.png", createdAt: Date.now() };
  users.push(user);
  await write("users.json", users);

  res.json({ user: { username, avatar: user.avatar } });
});

router.post("/api/signin", async (req, res) => {
  const { username, password } = req.body || {};
  const user = await findUser(username);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Wrong username or password" });
  }
  res.json({ user: { username: user.username, avatar: user.avatar } });
});

/* ============================================
   FRIENDS
   ============================================ */
router.get("/api/users/search", async (req, res) => {
  const q = (req.query.q || "").toString().toLowerCase();
  if (!q) return res.json({ results: [] });
  const users = await read("users.json", []);
  const results = users
    .filter((u) => u.username.toLowerCase().includes(q))
    .slice(0, 20)
    .map((u) => ({ username: u.username, avatar: u.avatar }));
  res.json({ results });
});

router.post("/api/friends/request", async (req, res) => {
  const { from, to } = req.body || {};
  if (!from || !to || from === to) return res.status(400).json({ error: "Invalid" });
  const target = await findUser(to);
  if (!target) return res.status(404).json({ error: "User not found" });

  const pending = await read("pending.json", {});
  pending[to] = pending[to] || [];
  if (!pending[to].some((r) => r.from === from)) {
    pending[to].push({ from, avatar: req.body.avatar || "png/logo.png", createdAt: Date.now() });
    await write("pending.json", pending);
  }
  res.json({ ok: true });
});

router.get("/api/friends/requests", async (req, res) => {
  const pending = await read("pending.json", {});
  const requests = (pending[req.query.user] || []).map((r) => ({ from: r.from, avatar: r.avatar }));
  res.json({ requests });
});

router.post("/api/friends/respond", async (req, res) => {
  const { user, from, accept } = req.body || {};
  const pending = await read("pending.json", {});
  pending[user] = (pending[user] || []).filter((r) => r.from !== from);
  await write("pending.json", pending);

  if (accept) {
    const friends = await read("friends.json", {});
    friends[user] = friends[user] || [];
    friends[from] = friends[from] || [];
    if (!friends[user].includes(from)) friends[user].push(from);
    if (!friends[from].includes(user)) friends[from].push(user);
    await write("friends.json", friends);
  }
  res.json({ ok: true });
});

router.get("/api/friends", async (req, res) => {
  const friends = await read("friends.json", {});
  const users = await read("users.json", []);
  const list = (friends[req.query.user] || []).map((username) => {
    const u = users.find((x) => x.username === username);
    return { username, avatar: u ? u.avatar : "png/logo.png" };
  });
  res.json({ friends: list });
});

/* ============================================
   SUGGESTIONS
   ============================================ */
router.post("/api/suggest", async (req, res) => {
  const { gameName, gameLink, gameCategory, gameDescription, yourName } = req.body || {};
  const identifier = getIdentifier(req, req.body);
  const now = Date.now();

  const bans = await read("bans.json", {});
  const ban = bans[identifier];
  if (ban && ban.until > now) {
    return res.status(403).json({
      error: "You are banned from suggesting games.",
      reason: ban.reason,
      until: ban.until,
      remainingSeconds: Math.ceil((ban.until - now) / 1000),
    });
  }

  const mutes = await read("mutes.json", {});
  const mute = mutes[identifier];
  if (mute && mute.until > now) {
    return res.status(403).json({
      error: "You are muted.",
      reason: mute.reason,
      until: mute.until,
      remainingSeconds: Math.ceil((mute.until - now) / 1000),
    });
  }

  const rates = await read("suggest-rate.json", {});
  const lastSubmit = rates[identifier];
  if (lastSubmit) {
    const elapsed = now - lastSubmit;
    if (elapsed < SUGGEST_COOLDOWN_MS) {
      return res.status(429).json({
        error: "Please wait before submitting again.",
        remainingSeconds: Math.ceil((SUGGEST_COOLDOWN_MS - elapsed) / 1000),
      });
    }
  }

  if (!gameName || !gameLink || !gameCategory) return res.status(400).json({ error: "Missing fields" });
  try {
    new URL(gameLink);
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  const id = makeId();
  const suggestions = await read("suggestions.json", []);
  suggestions.push({
    id,
    gameName,
    gameLink,
    gameCategory,
    gameDescription: gameDescription || "",
    yourName: yourName || "Anonymous",
    identifier,
    ip: getClientIp(req),
    submittedAt: now,
    status: "pending",
  });
  await write("suggestions.json", suggestions);

  rates[identifier] = now;
  await write("suggest-rate.json", rates);

  res.json({ ok: true, id });
});

router.post("/api/suggest/status", async (req, res) => {
  const identifier = getIdentifier(req, req.body);
  const now = Date.now();
  const bans = await read("bans.json", {});
  const mutes = await read("mutes.json", {});
  const rates = await read("suggest-rate.json", {});
  const ban = bans[identifier];
  const mute = mutes[identifier];
  const elapsed = rates[identifier] ? now - rates[identifier] : SUGGEST_COOLDOWN_MS;
  const cooldownSeconds = elapsed < SUGGEST_COOLDOWN_MS ? Math.ceil((SUGGEST_COOLDOWN_MS - elapsed) / 1000) : 0;

  res.json({
    banned: !!(ban && ban.until > now),
    banReason: ban?.reason || null,
    banUntil: ban?.until || null,
    muted: !!(mute && mute.until > now),
    muteReason: mute?.reason || null,
    muteUntil: mute?.until || null,
    cooldownSeconds,
  });
});

router.post("/api/suggest/warnings", async (req, res) => {
  const identifier = getIdentifier(req, req.body);
  const warnings = await read("warnings.json", {});
  const list = warnings[identifier] || [];
  const unseen = list.filter((w) => !w.seen);
  if (unseen.length) {
    warnings[identifier] = list.map((w) => ({ ...w, seen: true }));
    await write("warnings.json", warnings);
  }
  res.json({ warnings: unseen });
});

router.get("/api/approved-games", async (req, res) => {
  const suggestions = await read("suggestions.json", []);
  const games = suggestions
    .filter((s) => s.status === "approved")
    .sort((a, b) => (b.approvedAt || 0) - (a.approvedAt || 0));
  res.json({ games });
});

/* ============================================
   ADMIN
   ============================================ */
const adminTokens = new Set();

function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"] || req.query.token;
  if (!token || !adminTokens.has(token)) return res.status(401).json({ error: "Unauthorized" });
  next();
}

router.post("/api/admin/login", (req, res) => {
  if ((req.body || {}).password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Wrong password" });
  }
  const token = makeToken();
  adminTokens.add(token);
  res.json({ token });
});

router.post("/api/admin/logout", requireAdmin, (req, res) => {
  adminTokens.delete(req.headers["x-admin-token"] || req.query.token);
  res.json({ ok: true });
});

router.get("/api/admin/verify", requireAdmin, (req, res) => res.json({ ok: true }));

/* ---- Leaderboard (public + admin) ---- */
router.get("/api/leaderboard", async (req, res) => {
  const scores = await read("leaderboard.json", []);
  res.json({ scores: scores.filter((s) => s.status === "approved").sort((a, b) => b.submittedAt - a.submittedAt) });
});

router.post("/api/leaderboard/submit", async (req, res) => {
  const { playerName, gameName, score, proofImage } = req.body || {};
  if (!playerName || !gameName || score === undefined || !proofImage) {
    return res.status(400).json({ error: "Name, game, score, and proof image are required" });
  }
  if (String(playerName).trim().length > 24) return res.status(400).json({ error: "Name must be 24 characters or less" });
  if (String(score).trim().length > 20) return res.status(400).json({ error: "Score is too long" });
  if (typeof proofImage !== "string" || !proofImage.startsWith("data:image/")) {
    return res.status(400).json({ error: "A valid proof image is required" });
  }
  if (proofImage.length > 7 * 1024 * 1024) return res.status(413).json({ error: "Proof image is too large" });

  const entry = {
    id: makeId(),
    playerName: String(playerName).trim(),
    gameName: String(gameName).trim(),
    score: String(score).trim(),
    proofImage,
    avatar: "png/logo.png",
    ip: getClientIp(req),
    submittedAt: Date.now(),
    status: "pending",
  };
  const scores = await read("leaderboard.json", []);
  scores.push(entry);
  await write("leaderboard.json", scores);
  res.status(201).json({ ok: true, score: entry });
});

router.get("/api/admin/leaderboard", requireAdmin, async (req, res) => {
  const scores = await read("leaderboard.json", []);
  const sorted = [...scores].sort((a, b) => b.submittedAt - a.submittedAt);
  res.json({ scores: sorted, total: sorted.length });
});

router.post("/api/admin/leaderboard/:id/:action", requireAdmin, async (req, res) => {
  if (!["approve", "reject"].includes(req.params.action)) return res.status(400).json({ error: "Invalid action" });
  const scores = await read("leaderboard.json", []);
  const entry = scores.find((s) => s.id === req.params.id);
  if (!entry) return res.status(404).json({ error: "Score not found" });
  if (req.params.action === "approve") {
    entry.status = "approved";
    entry.approvedAt = Date.now();
  } else {
    entry.status = "rejected";
    entry.rejectedAt = Date.now();
  }
  await write("leaderboard.json", scores);
  res.json({ ok: true, score: entry });
});

router.delete("/api/admin/leaderboard/:id", requireAdmin, async (req, res) => {
  const scores = await read("leaderboard.json", []);
  const idx = scores.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Score not found" });
  scores.splice(idx, 1);
  await write("leaderboard.json", scores);
  res.json({ ok: true });
});

/* ---- Suggestions (admin) ---- */
router.get("/api/admin/suggestions", requireAdmin, async (req, res) => {
  const filter = req.query.status || "all";
  const suggestions = await read("suggestions.json", []);
  const rows = (filter === "all" ? suggestions : suggestions.filter((s) => s.status === filter)).sort(
    (a, b) => b.submittedAt - a.submittedAt
  );
  res.json({ suggestions: rows, total: rows.length });
});

router.post("/api/admin/suggestions/:id/approve", requireAdmin, async (req, res) => {
  const suggestions = await read("suggestions.json", []);
  const s = suggestions.find((x) => x.id === req.params.id);
  if (s) {
    s.status = "approved";
    s.approvedAt = Date.now();
    await write("suggestions.json", suggestions);
  }
  res.json({ ok: true });
});

router.post("/api/admin/suggestions/:id/reject", requireAdmin, async (req, res) => {
  const suggestions = await read("suggestions.json", []);
  const s = suggestions.find((x) => x.id === req.params.id);
  if (s) {
    s.status = "rejected";
    await write("suggestions.json", suggestions);
  }
  res.json({ ok: true });
});

router.delete("/api/admin/suggestions/:id", requireAdmin, async (req, res) => {
  const suggestions = await read("suggestions.json", []);
  const next = suggestions.filter((x) => x.id !== req.params.id);
  await write("suggestions.json", next);
  res.json({ ok: true });
});

/* ---- Ban / Mute / Warn ---- */
router.get("/api/admin/bans", requireAdmin, async (req, res) => {
  const now = Date.now();
  const bansMap = await read("bans.json", {});
  const mutesMap = await read("mutes.json", {});
  const bans = Object.entries(bansMap)
    .filter(([, b]) => b.until > now)
    .map(([identifier, b]) => ({ identifier, ...b }));
  const mutes = Object.entries(mutesMap)
    .filter(([, m]) => m.until > now)
    .map(([identifier, m]) => ({ identifier, ...m }));
  res.json({ bans, mutes });
});

router.post("/api/admin/ban", requireAdmin, async (req, res) => {
  const { identifier, minutes, reason } = req.body || {};
  if (!identifier) return res.status(400).json({ error: "Missing identifier" });
  const mins = Math.max(1, parseInt(minutes) || 1440);
  const until = Date.now() + mins * 60 * 1000;
  const bans = await read("bans.json", {});
  bans[identifier] = { reason: reason || "Violation of rules", until, bannedAt: Date.now() };
  await write("bans.json", bans);
  res.json({ ok: true, until });
});

router.post("/api/admin/unban", requireAdmin, async (req, res) => {
  const bans = await read("bans.json", {});
  delete bans[req.body.identifier];
  await write("bans.json", bans);
  res.json({ ok: true });
});

router.post("/api/admin/mute", requireAdmin, async (req, res) => {
  const { identifier, minutes, reason } = req.body || {};
  if (!identifier) return res.status(400).json({ error: "Missing identifier" });
  const mins = Math.max(30, parseInt(minutes) || 30);
  const until = Date.now() + mins * 60 * 1000;
  const mutes = await read("mutes.json", {});
  mutes[identifier] = { reason: reason || "You are muted", until, mutedAt: Date.now() };
  await write("mutes.json", mutes);
  res.json({ ok: true, until });
});

router.post("/api/admin/unmute", requireAdmin, async (req, res) => {
  const mutes = await read("mutes.json", {});
  delete mutes[req.body.identifier];
  await write("mutes.json", mutes);
  res.json({ ok: true });
});

router.post("/api/admin/warn", requireAdmin, async (req, res) => {
  const { identifier, message } = req.body || {};
  if (!identifier || !message) return res.status(400).json({ error: "Missing" });
  const warnings = await read("warnings.json", {});
  warnings[identifier] = warnings[identifier] || [];
  warnings[identifier].push({ message, sentAt: Date.now(), seen: false });
  await write("warnings.json", warnings);
  res.json({ ok: true });
});

router.get("/api/admin/suggesters", requireAdmin, async (req, res) => {
  const now = Date.now();
  const suggestions = await read("suggestions.json", []);
  const bansMap = await read("bans.json", {});
  const mutesMap = await read("mutes.json", {});

  const byIdentifier = new Map();
  for (const s of suggestions) {
    const entry = byIdentifier.get(s.identifier) || {
      identifier: s.identifier,
      name: s.yourName,
      ip: s.ip,
      count: 0,
      lastSubmit: 0,
      lastGame: null,
    };
    entry.count += 1;
    if (s.submittedAt > entry.lastSubmit) {
      entry.lastSubmit = s.submittedAt;
      entry.lastGame = s.gameName;
      entry.name = s.yourName;
      entry.ip = s.ip;
    }
    byIdentifier.set(s.identifier, entry);
  }

  const list = [...byIdentifier.values()]
    .sort((a, b) => b.lastSubmit - a.lastSubmit)
    .map((r) => {
      const ban = bansMap[r.identifier];
      const mute = mutesMap[r.identifier];
      return {
        ...r,
        banned: !!(ban && ban.until > now),
        banUntil: ban?.until || null,
        banReason: ban?.reason || null,
        muted: !!(mute && mute.until > now),
        muteUntil: mute?.until || null,
        muteReason: mute?.reason || null,
      };
    });

  res.json({ suggesters: list });
});

/* ============================================
   STICKERS
   ============================================ */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const STICKERS_DIR = path.join(ROOT, "stickers", "custom");

router.get("/api/stickers", async (req, res) => {
  const builtin = [];
  for (let i = 1; i <= 10; i++) builtin.push({ id: "builtin-" + i, url: "/stickers/" + i + ".gif", custom: false });
  const custom = await read("stickers.json", []);
  res.json({ builtin, custom: custom.map((s) => ({ ...s, custom: true })) });
});

router.post("/api/stickers/upload", upload.single("sticker"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  try {
    await fsp.mkdir(STICKERS_DIR, { recursive: true });
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `sticker-${Date.now()}-${Math.floor(Math.random() * 100000)}-${safeName}`;
    await fsp.writeFile(path.join(STICKERS_DIR, filename), req.file.buffer);
    const url = `/stickers/custom/${filename}`;
    const id = "custom-" + Date.now().toString(36);
    const stickers = await read("stickers.json", []);
    stickers.push({ id, url, uploadedAt: Date.now(), size: req.file.size, mimetype: req.file.mimetype });
    await write("stickers.json", stickers);
    res.json({ ok: true, sticker: { id, url, custom: true } });
  } catch (err) {
    console.error("sticker upload failed:", err.message);
    res.status(500).json({ error: "Couldn't save sticker on this host (read-only filesystem?)" });
  }
});

router.delete("/api/stickers/:id", async (req, res) => {
  const stickers = await read("stickers.json", []);
  const next = stickers.filter((s) => s.id !== req.params.id);
  await write("stickers.json", next);
  res.json({ ok: true });
});

export default router;
export { requireAdmin, ADMIN_PASSWORD };
