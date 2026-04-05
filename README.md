# 🎨 SketchParty

A clean, private multiplayer draw-and-guess game for friend/cousin groups. 
Built with Node.js + Socket.io. No accounts, no ads — just share a link.

---

## Features

- Create a private room → share link with friends
- Draw on a shared canvas in real time
- Hint letters revealed as timer counts down
- Points based on how fast you guess
- 2–5 rounds, up to 8 players per room
- Clean UI, works on mobile too

---

## Running Locally

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start         # production
npm run dev       # auto-restart on file changes (needs nodemon)

# 3. Open in browser
http://localhost:3000
```

---

## Free Hosting on Render.com (Recommended)

Render's free tier is perfect — it's a real Node.js server, no config needed.

### Steps:

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   gh repo create sketchparty --public --push
   # or push manually via GitHub Desktop
   ```

2. **Create a Render account** at https://render.com

3. **New → Web Service**
   - Connect your GitHub repo
   - Name: `sketchparty` (or anything)
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: **Free**

4. **Deploy** — Render gives you a URL like `https://sketchparty-xxxx.onrender.com`

5. **Share that URL with your cousins!**
   The invite link is auto-generated when you create a room.

### ⚠ Free Tier Note
Render's free tier spins down after 15 min of inactivity.
The first person to open the URL may wait ~30 seconds for it to wake up.
To avoid this, upgrade to the $7/month "Starter" tier, or use Railway/Fly.io.

---

## Alternative: Railway

1. Go to https://railway.app
2. New Project → Deploy from GitHub
3. Select repo — Railway auto-detects Node.js
4. No extra config needed, uses `npm start`
5. Gets $5 free credit/month (enough for ~500 hrs)

---

## File Structure

```
sketchparty/
├── server.js          ← Express + Socket.io backend
├── package.json
├── .gitignore
└── public/
    ├── index.html     ← SPA: all screens in one file
    ├── style.css      ← All styles (warm paper aesthetic)
    └── app.js         ← All client-side logic + canvas drawing
```

---

## Customising

**Add more words:** Edit the `WORDS` array in `server.js`

**Change turn time:** Edit `TURN_TIME` in `server.js` (default: 80 seconds)

**Change hint reveal interval:** Edit `HINT_INTERVAL` (default: every 25 seconds)

**Change max players:** Edit the `>= 8` check in `joinRoom` handler in `server.js`
