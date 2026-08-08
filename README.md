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

| Variable        | Required | Description                                                  |
| --------------- | :------: | ------------------------------------------------------------ |
| `DISCORD_TOKEN` |    ✅    | Bot token from Discord Developer Portal                      |
| `MEDIA_PATH`    |    ✅    | Path to your media root on the host machine                  |
| `UID`           |    ❌    | Your host user ID (only needed if you get permission errors) |
| `GID`           |    ❌    | Your host group ID (same as above)                           |

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
make process-heavy                               # process heavy/ folder locally
make up FLAGS="--process-heavy"                  # same via flag
make build                                       # rebuild image
make down                                        # stop
```

| Flag               | Effect                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--skip-watermark` | 🌿 Send without watermark                                                                                                                                                  |
| `--move-sent`      | 📦 Move originals to `sent/` instead of deleting                                                                                                                           |
| `--watch`          | 👀 Keep running, process new files as they arrive                                                                                                                          |
| `--process-heavy`  | 🔄 Process `heavy/` folder with the same quality-first watermarking; move files that now fit the limit up one level, keep oversized ones (already watermarked) in `heavy/` |

---

### 🔄 Process Heavy Folder (`--process-heavy`)

Processes files that were moved to `heavy/` (size > the upload limit) by applying the **same quality-first watermarking as the normal pipeline** (CRF video + audio copied losslessly). It never sacrifices quality just to fit under a limit: whatever still exceeds it is kept watermarked in `heavy/` for manual upload.

```bash
# Using dedicated target (recommended)
make process-heavy

# Or via flag
make up FLAGS="--process-heavy"
```

**What it does:**

- Reads all files from each `heavy/` folder (images, videos, GIFs)
- Applies watermark (unless `--skip-watermark`)
- Compresses nothing: videos use the same encode as the normal pipeline — **CRF** (default 20, constant quality) + **audio copied without loss** (only re-encoded to AAC if the container can't take the original codec). No bitrate forcing, no resolution downscale; preset defaults to `fast` to keep CPU/heat low
- Moves files that now fit the limit **directly into their matching media folder** — `videos/` for videos, `images/` for images and GIFs (same level as `heavy/`) — so the next normal `make up` / `--watch` run uploads them without needing another organize pass
- Files that still exceed the limit are kept in `heavy/` **replaced by their watermarked copy** — nothing stays unmarked
- Deletes originals from `heavy/` only after a successful move
- **Does not connect to Discord** — no upload, no token needed (but Docker requires it)
- **No watch mode** — runs once and exits

**Folder layout after processing:**

```
your-media-root/
└── category/
    ├── images/       ← processed images/GIFs that fit the limit land here (ready to upload)
    ├── videos/       ← processed videos that fit land here (ready to upload)
    ├── heavy/        ← still-oversized files (watermarked) await manual upload
    └── sent/         ← originals kept when using --move-sent
```

**Use case:** You have large videos in `heavy/` that you want watermarked (and possibly shrunk — the quality-first CRF re-encode often reduces high-bitrate sources). Files that end up fitting the limit go straight into `videos/` (or `images/`) and your next `make up` run sends them to Discord; the rest stay watermarked in `heavy/` for manual upload.

> 💡 **Oversized files are not compressed to fit** — that's the point. If a file
> stays over the limit after watermarking, it remains in `heavy/` (marked) with
> its quality and audio intact, ready for manual upload.

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

### 📏 Discord limits & video quality

- **Upload limit** (default **10 MB**) — this is a threshold, not a quality target. Files over it are sent to `heavy/` and never have their quality squeezed to fit. Configurable via `MAX_FILE_SIZE_MB` (raise it if you have Nitro or a boosted server).
- **Video watermarking is quality-first, one single standard** for the normal pipeline and `--process-heavy`:
    - **CRF near-lossless** encode (`-crf`, default 20) instead of a hard bitrate cap → keeps visual quality constant regardless of video length.
    - **Audio is copied losslessly** (`-c:a copy`) — zero audio loss; only falls back to AAC if the source track can't be remuxed.
    - Files that still exceed the upload limit after watermarking stay in `heavy/` as watermarked copies, ready for manual upload.
- **`--process-heavy`** uses exactly the same quality-first encode — it watermark/re-encodes, promotes the files that now fit the limit, and leaves the rest watermarked in `heavy/`. No size/fit bitrate math, no downscaling.
- Encode knobs available via env: `VIDEO_CRF`, `VIDEO_PRESET` (default `fast`), `VIDEO_FFMPEG_TIMEOUT_MS` (base timeout; scales with video length, capped at 6h).
- **Per-file progress counter** — in both the normal upload pipeline and `--process-heavy`, a `🔢 [i/total]` line is printed before each file so you always know how many are left in the folder. Disable with `SHOW_FILE_PROGRESS=0` for quieter logs.

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
