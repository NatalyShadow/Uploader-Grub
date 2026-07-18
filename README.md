# 🐛 Uploader Grub 🤖

> _a tiny bot-worm that carries your media to Discord_

---

🌸 **Uploader Grub** is a Discord bot that automatically organizes,
watermarks, and uploads media files from local folders to categorized
Discord threads and channels. It sorts, stamps, sends, and cleans up —
all on its own. 🤖🪱✨

---

## 🚀 Quick Start (Docker)

### 1. Create a Discord bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. Go to **Bot** → **Reset Token** → copy it
3. Under **Privileged Gateway Intents**, enable: `Guilds`, `Message Content`
4. Go to **OAuth2 → URL Generator** → check `bot` + `Send Messages` + `Attach Files` → invite to your server

### 2. Configure your `.env`

```env
DISCORD_TOKEN=paste_your_token_here
MEDIA_PATH=/home/you/path/to/your/media
```

> 💡 `MEDIA_PATH` is your root media folder. Inside the container it's mounted at `/data`,
> which is what `$HOME` resolves to. Your folder structure stays intact.

### 3. Create your `config.json`

```bash
cp config.example.json config.json
```

Edit it with your own folder paths and Discord channel/thread IDs:

```json
[
  {
    "path": "$HOME/vanilla/videos",
    "channelId": "REPLACE_WITH_THREAD_OR_CHANNEL_ID"
  },
  {
    "path": "$HOME/vanilla/images",
    "channelId": "REPLACE_WITH_THREAD_OR_CHANNEL_ID"
  }
]
```

### 4. Run it

```bash
make up
```

That's it. Files appear, get watermarked, and land in Discord. 🐛✨

---

## ✨ Features

🐛 **Auto-organizes** — loose files get sorted into `videos/`, `images/`, and `heavy/`
🎨 **Watermarks** — applies your logo to images, GIFs, and videos via sharp + ffmpeg
📤 **Uploads** — sends each file to its matching Discord channel or thread with retry logic
📦 **Cleans up** — deletes or moves originals to `sent/` after successful upload
⚡ **CLI flags** — skip watermark, keep originals, watch mode
🐳 **Docker-ready** — runs with a single `make up`
👀 **Watch mode** — stays alive and processes new files as they appear

---

## ⚙️ Configuration

### `.env`

| Variable | Required | Description |
|----------|:---:|---|
| `DISCORD_TOKEN` | ✅ | Bot token from Discord Developer Portal |
| `MEDIA_PATH` | ✅ | Path to your media root on the host machine |
| `UID` | ❌ | Your host user ID (only needed if you get permission errors) |
| `GID` | ❌ | Your host group ID (same as above) |

### `config.json`

Each entry maps a folder to a Discord channel/thread:

```json
{ "path": "$HOME/category/videos",   "channelId": "123456789" },
{ "path": "$HOME/category/images",   "channelId": "987654321" }
```

### Expected folder layout

```
your-media-root/
└── category/
    ├── images/       ← images land here after organizing
    ├── videos/       ← videos land here after organizing
    ├── heavy/        ← files > 10MB (manual cloud upload)
    └── sent/         ← originals kept when using --move-sent
```

---

## 🪱 Usage

```bash
make up                                          # default
make up FLAGS="--skip-watermark"                 # no watermark
make up FLAGS="--move-sent"                      # keep originals
make up FLAGS="--skip-watermark --move-sent"     # both
make up FLAGS="--watch"                          # watch mode
make up FLAGS="--watch --skip-watermark"         # watch + no WM
make up FLAGS="--watch --move-sent"             # watch + keep
make build                                       # rebuild image
make down                                        # stop
```

| Flag | Effect |
|------|--------|
| `--skip-watermark` | 🌿 Send without watermark |
| `--move-sent` | 📦 Move originals to `sent/` instead of deleting |
| `--watch` | 👀 Keep running, process new files as they arrive |

---

## 🐝 How it works

```
   🌅 Boot
    │
    ├─ 🌱 Check ffmpeg & logo exist
    ├─ 🌿 Load config.json
    ├─ 🪴 Setup: create folders, organize loose files
    └─ 🤖 Login to Discord
         │
         ▼
   🐛 Main Pipeline
    │
    └─ For each config entry:
         │
         ├─ 🌸 Resolve channel (unarchive if thread)
         ├─ 📂 Read files from folder
         └─ For each file:
              ├─ ⚖️  Size check (max 10MB)
              ├─ 🎨 Watermark (skip with --skip-watermark)
              ├─ 📤 Upload to Discord (retry 3×)
              ├─ ✨ Success → delete / move original
              └─ 💔 Failure → clean temp, keep original

   👀 Watch Mode (--watch)
    │
    ├─ 🔍 fs.watch on all roots
    ├─ ⏱️  3s debounce
    ├─ 🗂️  Organize + pipeline for changed root only
    └─ 🔁 Loops until SIGINT/SIGTERM
```

### 📏 Discord limits

- **10 MB** per file — oversized files go to `heavy/` for manual handling
- Videos re-encode with bitrate caps and auto-downscale to fit

---

## 🛠️ Without Docker (dev)

> Requires pnpm. Enable it once: `corepack enable pnpm`

```bash
git clone https://github.com/NatalyShadow/Uploader-Grub.git
cd uploader-grub-server
pnpm install
cp config.example.json config.json   # edit it
# create .env with DISCORD_TOKEN and MEDIA_PATH

pnpm dev                             # hot reload
pnpm start                           # production
pnpm start -- --skip-watermark       # flags work the same
```

---

## 🌻 Troubleshooting

### 🐛 How do I create a Discord bot?

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → give it a name
2. **Bot** tab → **Reset Token** → copy the token into your `.env`
3. Enable intents: `Guilds` and `Message Content`
4. **OAuth2 → URL Generator** → scopes: `bot`, permissions: `Send Messages` + `Attach Files` → open the URL to invite the bot

### 🐛 "ffmpeg not found"

```bash
# Debian/Ubuntu
sudo apt install ffmpeg

# macOS
brew install ffmpeg
```

### 🐛 "Permission denied" (EACCES)

Your media folder was created by a previous run as `root`. Fix it once:

```bash
sudo chown -R $(whoami):$(whoami) $(grep MEDIA_PATH .env | cut -d= -f2)
```

### 🐛 "Channel not found / not text-based"

Make sure `channelId` points to a **text channel** or **thread** — not a voice channel or DM.

### 🐛 Duplicate files on Discord

Files are tracked by channel + filename during a run. Use `--move-sent` to keep originals — this prevents re-uploading if something goes wrong between runs.

---

## 📜 License

GNU General Public License v3.0 © 2026

🐛🌼 _Uploader Grub is free software — plant it, grow it, share it_ 🌸🤖🪱

---

## 💌

Made with 🌿 🐛 and 🤖 by garden-loving devs.

_Grub works hard so you don't have to. Be nice to your local worm-bot._
