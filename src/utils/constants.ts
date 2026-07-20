import { GatewayIntentBits } from "discord.js";

export const DISCORD_INTENTS = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
] as const;

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB (Discord limit)

export const AUDIO_BITRATE_TARGET = 64; // kbps
export const MIN_VIDEO_BITRATE = 300; // kbps before downscaling

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
export const VIDEO_FFMPEG_TIMEOUT_MS = 120_000;
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
