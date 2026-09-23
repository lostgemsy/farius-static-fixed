// api/index.mjs — Vercel serverless function.
//
// vercel.json rewrites /api/* here. This only handles the REST API;
// the actual HTML/CSS/JS/image files are served directly by Vercel's
// static hosting (see "cleanUrls" in vercel.json), which is also what
// fixes the "Cannot GET /" problem — there was no index.html for it to
// find before.
//
// Reads (GET routes) work the same as on a normal server. Writes (signup,
// suggest a game, submit a score, admin actions, chat messages) try to
// save to the JSON files in /data, but Vercel's serverless filesystem is
// read-only, so those saves will silently not persist between requests —
// see README.md for the options (a small real database, or host this on
// a normal Node server instead via `npm start`).

import express from "express";
import apiRouter from "../api-router.mjs";

const app = express();
app.use(apiRouter);

export default app;
