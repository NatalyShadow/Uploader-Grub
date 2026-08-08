import { GatewayIntentBits } from "discord.js";

export const DISCORD_INTENTS = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
] as const;

// Discord upload limit (MB). Configurable via env so it can be raised if the
// account/server allows more (Nitro, boosted server, etc.).
export const MAX_FILE_SIZE = (parseFloat(process.env.MAX_FILE_SIZE_MB ?? "10") || 10) * 1024 * 1024;

export const FALLBACK_AUDIO_BITRATE = 192; // kbps (CRF mode fallback when audio copy fails)

// Video encode knobs. CRF: lower = better quality / larger file (18-23 sensible).
// Preset: slower = better compression efficiency at the cost of CPU time.
// Default `fast` keeps visual quality (CRF is constant) while avoiding the CPU
// spikes of slow/veryslow on long files. Set `VIDEO_PRESET=slow` only for
// maximum compression with the heat/time that comes with it.
export const VIDEO_CRF = parseInt(process.env.VIDEO_CRF ?? "20", 10) || 20;
export const VIDEO_PRESET = process.env.VIDEO_PRESET ?? "fast";

export const WATERMARK_MARGIN = 10; // px
export const WATERMARK_HEIGHT_RATIO = 0.08; // 8% of the longest side
export const WATERMARK_OPACITY = 0.5; // 50%
export const WATERMARK_MIN_SIZE = 60; // px
export const WATERMARK_MAX_SIZE = 200; // px

export const RETRY_DELAY_MS = 5000;
export const MAX_SEND_RETRIES = 3;
export const MAX_RETRY_AFTER_MS = 30_000; // ceiling for backoff between send retries

export const SEND_REASON_TOO_LARGE = "too_large";

export const GIF_FFMPEG_TIMEOUT_MS = 60_000;
export const VIDEO_FFMPEG_TIMEOUT_MS =
    parseInt(process.env.VIDEO_FFMPEG_TIMEOUT_MS ?? "120000", 10) || 120_000;
export const FFPROBE_TIMEOUT_MS = 30_000;

export const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".avif", ".bmp", ".tiff"] as const;
export const VIDEO_EXTS = [
    ".mp4",
    ".mov",
    ".webm",
    ".mkv",
    ".avi",
    ".m4v",
    ".flv",
    ".wmv",
] as const;
export const GIF_EXT = ".gif";

export const UUID_PREFIX = process.env.MEDIA_NAME_PREFIX ?? "";

// Per-folder file progress counter [i/total]. Shown before every file in both
// the normal upload pipeline and the heavy processing mode. Disable with
// SHOW_FILE_PROGRESS=0 to get quieter logs.
export const SHOW_FILE_PROGRESS = process.env.SHOW_FILE_PROGRESS !== "0";
