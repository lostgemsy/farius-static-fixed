# Farius 2

Node/Express Farius with Scramjet/Ultraviolet proxy assets, Socket.IO real-time chat, authentication, friend requests, stickers, games, suggestions and leaderboards.

## Run
```bash
npm install
npm start
```
Then open `http://localhost:3000`.

## Deploy
For the full Node + Socket.IO version, use a long-running Node host such as Render/Railway/Fly.io. Vercel serverless hosting does not provide the persistent WebSocket server required by Socket.IO.

## Games
Put HTML games in `public/games/`. The game library discovers them automatically. Game pages can submit scores with:
```js
window.FariusGames.submitScore("Game Name", 12345)
```

## Stickers
Put PNG/WebP/GIF/SVG sticker files in `public/stickers/`. They appear in the chat sticker picker automatically.
