// lib/store.mjs
//
// Tiny JSON-file "database". Everything in /data is read into memory on
// first use and written back to disk on every change. This is what lets
// the whole site run with nothing but `npm install && npm start` — no
// Postgres/Redis/Blob account required.
//
// IMPORTANT: Vercel's serverless functions run on a READ-ONLY filesystem
// (except /tmp, which is wiped between invocations and not shared across
// them). Reads always work there, but writes (signup, chat messages,
// leaderboard submissions, admin actions, etc.) will fail and this module
// will log a warning instead of crashing the request. See README.md.

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

const cache = new Map();
let writesDisabled = false;
let warnedReadOnly = false;

async function loadFromDisk(name, fallback) {
  const file = path.join(DATA_DIR, name);
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});
      await fs.writeFile(file, JSON.stringify(fallback, null, 2)).catch(() => {});
      return fallback;
    }
    console.error(`[store] couldn't read ${name}, using empty default:`, err.message);
    return fallback;
  }
}

/** Read a data file (cached after first load). `fallback` is used if the file doesn't exist yet. */
export async function read(name, fallback) {
  if (!cache.has(name)) {
    cache.set(name, await loadFromDisk(name, fallback));
  }
  return cache.get(name);
}

/** Persist a data file. Always updates the in-memory cache; disk write is best-effort. */
export async function write(name, data) {
  cache.set(name, data);
  if (writesDisabled) return false;
  const file = path.join(DATA_DIR, name);
  try {
    await fs.writeFile(file, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    if (err.code === "EROFS" || err.code === "EACCES") {
      writesDisabled = true;
      if (!warnedReadOnly) {
        warnedReadOnly = true;
        console.warn(
          `[store] Filesystem here is read-only, so "${name}" (and every other data file) can't be saved permanently. ` +
          `This is expected on Vercel's default hosting — see README.md for options.`
        );
      }
    } else {
      console.error(`[store] couldn't write ${name}:`, err.message);
    }
    return false;
  }
}

export function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function makeToken() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}
