// lib/realtime.mjs
//
// Socket.io chat: history, join/leave presence, messages, friends refresh.
// Matches the events chat.html already emits/listens for exactly, so the
// existing front-end needed no changes.
//
// NOTE ON HOSTING: this needs a long-lived Node process. `npm start`
// (server.mjs) gives you that anywhere — a VPS, Render, Railway, Fly.io,
// etc. Vercel's default serverless functions do NOT keep a persistent
// connection or share memory across invocations, so live chat on Vercel
// is best-effort only (see api/socket.mjs and README.md).

import { Server } from "socket.io";
import { read, write, makeId } from "./store.mjs";

const online = new Map(); // username -> { avatar, joined }

function onlineList() {
  return [...online.entries()].map(([username, data]) => ({ username, avatar: data.avatar }));
}

let ioInstance = null;

export function attachRealtime(httpServer, opts = {}) {
  if (ioInstance) return ioInstance;

  const io = new Server(httpServer, {
    path: "/socket.io/",
    cors: { origin: "*" },
    transports: opts.transports || ["websocket", "polling"],
  });

  io.on("connection", async (socket) => {
    try {
      const history = await read("messages.json", []);
      socket.emit("chat-history", history.slice(-100));
    } catch (e) {
      console.error("chat-history error:", e.message);
    }

    socket.on("join", async ({ username, avatar } = {}) => {
      if (!username) return;
      socket.username = username;
      socket.avatar = avatar || "png/logo.png";
      online.set(username, { avatar: socket.avatar, joined: Date.now() });
      io.emit("user-list", onlineList());
      io.emit("system", { text: `${username} joined the chat` });
    });

    socket.on("message", async (payload) => {
      if (!socket.username) return;
      let text = "",
        replyTo = null,
        stickerUrl = null;
      if (typeof payload === "string") text = payload;
      else if (payload && typeof payload === "object") {
        text = payload.text || "";
        replyTo = payload.replyTo || null;
        stickerUrl = payload.stickerUrl || null;
      }
      if (!text && !stickerUrl) return;

      const msg = {
        id: makeId(),
        username: socket.username,
        avatar: socket.avatar,
        text: String(text).slice(0, 500),
        stickerUrl,
        replyTo,
        time: Date.now(),
      };

      try {
        const history = await read("messages.json", []);
        history.push(msg);
        await write("messages.json", history);
      } catch (e) {
        console.error("message save error:", e.message);
      }

      io.emit("message", msg);
    });

    socket.on("refresh-friends", async () => {
      if (!socket.username) return;
      const friends = await read("friends.json", {});
      const users = await read("users.json", []);
      const list = (friends[socket.username] || []).map((username) => {
        const u = users.find((x) => x.username === username);
        return { username, avatar: u ? u.avatar : "png/logo.png" };
      });
      socket.emit("friends-update", list);
    });

    socket.on("disconnect", () => {
      if (socket.username) {
        online.delete(socket.username);
        io.emit("user-list", onlineList());
        io.emit("system", { text: `${socket.username} left the chat` });
      }
    });
  });

  ioInstance = io;
  return io;
}
