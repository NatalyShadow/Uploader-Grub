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

// Encode backend: auto (default) detects the best usable encoder at boot,
// preferring hardware (qsv → vaapi → nvenc → amf) and falling back to libx264.
// Force a specific one with VIDEO_ENCODER=qsv|vaapi|nvenc|amf|libx264.
export const VIDEO_ENCODER = process.env.VIDEO_ENCODER ?? "auto";

// Cap libx264 worker threads (0 = let ffmpeg decide). Only affects the
// software encoder; hardware encoders offload threading to the iGPU/GPU.
export const VIDEO_FFMPEG_THREADS = parseInt(process.env.VIDEO_FFMPEG_THREADS ?? "0", 10) || 0;

// Linux only: run ffmpeg with `nice -n 10` so watermarking never starves the
// rest of the system and fans stay calm (slightly slower wall-clock).
export const USE_NICE = process.platform === "linux" && process.env.VIDEO_NICE === "1";

// sharp (image watermarking) thread pool cap. Lower = less CPU burst on image
// folders; raise it on well-cooled machines for more throughput.
export const SHARP_CONCURRENCY = parseInt(process.env.SHARP_CONCURRENCY ?? "4", 10) || 4;

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
// Hard cap for ffmpeg encode timeouts, shared by videos and GIFs (6h): a stuck
// encode must always abort eventually, but a long legitimate render (e.g. a
// giant heavy/ GIF) is never killed mid-work.
const MAX_FFMPEG_TIMEOUT_MS = 6 * 60 * 60 * 1000;

/**
 * Scaled ffmpeg timeout for GIF watermarking.
 *
 * GIFs are re-encoded frame-by-frame through palettegen/paletteuse, which is
 * far slower per second of content than H.264 video encoding — a fixed 60s
 * timeout would kill large heavy/ GIFs mid-render even though they complete
 * fine. Like the video timeout, scale with the GIF duration: at least the
 * fixed base, ~3s of budget per second of GIF, plus a 60s headroom, capped at
 * MAX_FFMPEG_TIMEOUT_MS. Baked in — no env knob by design.
 */
export function gifFfmpegTimeoutMs(durationSeconds: number): number {
    const safeDuration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
    const scaled = safeDuration * 1000 * 3 + 60_000;
    return Math.max(GIF_FFMPEG_TIMEOUT_MS, Math.min(scaled, MAX_FFMPEG_TIMEOUT_MS));
}
export const VIDEO_FFMPEG_TIMEOUT_MS =
    parseInt(process.env.VIDEO_FFMPEG_TIMEOUT_MS ?? "120000", 10) || 120_000;
export const FFPROBE_TIMEOUT_MS = 30_000;

export const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".avif", ".bmp", ".tiff"] as const;
// Image formats the pipeline can READ (organizer accepts them) but whose
// extension sharp cannot reliably WRITE when watermarking: BMP output is not
// supported at all, and AVIF/TIFF output depends on the libvips build. When a
// watermark is applied these are normalized to .jpg.
export const UNSUPPORTED_IMAGE_EXTS = [".avif", ".bmp", ".tiff"] as const;
export const VIDEO_EXTS = [
    ".mp4",
    ".mov",
    ".webm",
    ".mkv",
    ".avi",
    ".m4v",
    ".flv",
    ".wmv",
    ".3gp",
] as const;
// Video containers Discord cannot render inline (no in-chat player). These
// MUST be converted to .mp4 before sending, even when watermarking is skipped,
// or Discord would show them as plain downloadable files.
export const FORCE_MP4_VIDEO_EXTS = [".3gp"] as const;
export const GIF_EXT = ".gif";

export const UUID_PREFIX = process.env.MEDIA_NAME_PREFIX ?? "";

// Per-folder file progress counter [i/total]. Shown before every file in both
// the normal upload pipeline and the heavy processing mode. Disable with
// SHOW_FILE_PROGRESS=0 to get quieter logs.
export const SHOW_FILE_PROGRESS = process.env.SHOW_FILE_PROGRESS !== "0";
