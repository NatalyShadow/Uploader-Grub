import { runCommand } from "./process.ts";

const CHECK_TIMEOUT_MS = 10_000;

async function checkCommand(name: string, args: string[] = ["-version"]): Promise<boolean> {
    try {
        await runCommand({
            command: name,
            args,
            timeoutMs: CHECK_TIMEOUT_MS,
            label: name,
            stdio: ["ignore", "ignore", "ignore"],
        });
        return true;
    } catch {
        return false;
    }
}

export async function checkFfmpeg(): Promise<boolean> {
    const hasFfmpeg = await checkCommand("ffmpeg");
    if (!hasFfmpeg) return false;

    const hasFfprobe = await checkCommand("ffprobe");
    return hasFfprobe;
}

// Cached availability check, so a running watch-mode session never re-probes
// ffmpeg/ffprobe for every .3gp that arrives. Mirrors getEncoderInfo()'s
// module-level promise caching. Only successful results are cached: a negative
// result is discarded so the next call retries, in case ffmpeg/ffprobe become
// available mid-session (e.g. a container that was still starting up).
let ffmpegCheckPromise: Promise<boolean> | null = null;

/**
 * Returns true if both ffmpeg and ffprobe are available. Successful results
 * are cached for the whole process; a negative result is not, so the check is
 * retried on the next call. Lazy fallback for forced-mp4 (.3gp) conversions in
 * skip-watermark mode, where the startup check is skipped unless a .3gp is
 * already present.
 */
export function ensureFfmpeg(): Promise<boolean> {
    ffmpegCheckPromise ??= checkFfmpeg().then((ok) => {
        if (!ok) ffmpegCheckPromise = null; // negative result → retry next time
        return ok;
    });
    return ffmpegCheckPromise;
}
