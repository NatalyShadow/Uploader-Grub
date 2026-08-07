import { spawn } from "child_process";
import { basename } from "path";
import {
    WATERMARK_MARGIN,
    WATERMARK_OPACITY,
    FALLBACK_AUDIO_BITRATE,
    VIDEO_FFMPEG_TIMEOUT_MS,
    VIDEO_CRF,
    VIDEO_PRESET,
} from "../utils/constants.ts";
import { getVideoDuration } from "../utils/ffprobe.ts";
import { registerProcess, unregisterProcess } from "../utils/processTracker.ts";
import { createProgressTracker } from "../utils/progress.ts";

function buildFilterComplex(logoSize: number): string {
    return (
        `[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[base];` +
        `[1:v]scale=${logoSize}:${logoSize}:force_original_aspect_ratio=decrease[logo];` +
        `[logo]format=rgba,colorchannelmixer=aa=${WATERMARK_OPACITY}[wm];` +
        `[base][wm]overlay=W-w-${WATERMARK_MARGIN}:H-h-${WATERMARK_MARGIN}[v]`
    );
}

/**
 * Quality-first encode: CRF (visually near-lossless) + copied audio.
 * No bitrate caps — output is quality-driven; size will scale with the
 * source, so long/high-bitrate files land in heavy/ untouched in quality.
 */
function buildCrfFfmpegArgs(
    inputPath: string,
    logoPath: string,
    outputPath: string,
    filterComplex: string,
    audio: "copy" | "aac"
): string[] {
    const args = [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-progress",
        "pipe:1",
        "-nostats",
        "-i",
        inputPath,
        "-i",
        logoPath,
        "-filter_complex",
        filterComplex,
        "-map",
        "[v]",
        "-map",
        "0:a:0?",
        "-c:v",
        "libx264",
        "-crf",
        String(VIDEO_CRF),
        "-preset",
        VIDEO_PRESET,
        "-pix_fmt",
        "yuv420p",
    ];

    if (audio === "copy") {
        args.push("-c:a", "copy"); // preserve original audio → zero loss
    } else {
        args.push("-c:a", "aac", "-b:a", `${FALLBACK_AUDIO_BITRATE}k`);
    }

    args.push("-movflags", "+faststart", outputPath);
    return args;
}

/** Run a single ffmpeg attempt. Rejects on any failure (non-zero exit, timeout, spawn error). */
async function runFfmpeg(
    args: string[],
    label: string,
    duration: number,
    tracker: ReturnType<typeof createProgressTracker>
): Promise<{ stderr: string }> {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
        registerProcess(ffmpeg);

        let progressBuffer = "";
        ffmpeg.stdout.on("data", (chunk: Buffer) => {
            progressBuffer += chunk.toString();
            const lines = progressBuffer.split("\n");
            progressBuffer = lines.pop() ?? "";
            for (const line of lines) {
                const match = /^out_time_us=(\d+)/.exec(line);
                if (match) {
                    tracker.update(parseInt(match[1], 10) / 1_000_000);
                }
            }
        });

        let stderrBuffer = "";
        ffmpeg.stderr.on("data", (chunk: Buffer) => {
            stderrBuffer += chunk.toString();
            if (stderrBuffer.length > 4096) {
                stderrBuffer = stderrBuffer.slice(-4096);
            }
        });

        // Scale the timeout with the video length so long files are not killed
        // mid-encode: at least the configured base, ~2x the duration, capped at
        // 6h so a stuck encode still always aborts.
        const timeoutMs = Math.max(
            VIDEO_FFMPEG_TIMEOUT_MS,
            Math.min(duration * 1000 * 2 + 60_000, 6 * 60 * 60 * 1000)
        );
        const timeout = setTimeout(() => {
            console.error(
                `⏱️ ${label} timed out after ${Math.round(timeoutMs / 1000)}s, killing ffmpeg...`
            );
            tracker.fail();
            try {
                ffmpeg.kill("SIGKILL");
            } catch {
                // ignore
            }
            unregisterProcess(ffmpeg);
            reject(new Error("Video processing timed out"));
        }, timeoutMs);

        ffmpeg.on("error", (err) => {
            clearTimeout(timeout);
            unregisterProcess(ffmpeg);
            tracker.fail();
            reject(err);
        });

        ffmpeg.on("close", (code: number | null) => {
            clearTimeout(timeout);
            unregisterProcess(ffmpeg);
            if (code === 0) {
                tracker.complete();
                resolve({ stderr: stderrBuffer });
            } else {
                tracker.fail();
                if (stderrBuffer) {
                    console.error(`stderr: ${stderrBuffer.slice(-500)}`);
                }
                reject(new Error(`ffmpeg exited with code ${code}`));
            }
        });
    });
}

/**
 * Quality-first watermark (single standard, used by the normal pipeline and the
 * heavy processor): CRF near-lossless + copied audio. Falls back to re-encoding
 * audio (AAC) if the original audio track can't be remuxed into the output
 * container (e.g. Opus from a WebM source). Timeouts are NOT retried: a timeout
 * is a resource problem, not an audio issue, and retrying would burn CPU.
 */
export async function applyVideoWatermark(
    logoPath: string,
    inputPath: string,
    outputPath: string,
    logoSize: number
): Promise<void> {
    const duration = await getVideoDuration(inputPath);
    const label = basename(inputPath);
    const filterComplex = buildFilterComplex(logoSize);
    const tracker = createProgressTracker(label, duration);

    console.log(`🎬 ${label}: watermarking (crf=${VIDEO_CRF}, preset=${VIDEO_PRESET})...`);
    try {
        await runFfmpeg(
            buildCrfFfmpegArgs(inputPath, logoPath, outputPath, filterComplex, "copy"),
            label,
            duration,
            tracker
        );
    } catch (err) {
        if (err instanceof Error && err.message === "Video processing timed out") {
            throw err;
        }
        console.log(`🔊 ${label}: audio copy failed, re-encoding audio to AAC...`);
        const retryTracker = createProgressTracker(label, duration);
        await runFfmpeg(
            buildCrfFfmpegArgs(inputPath, logoPath, outputPath, filterComplex, "aac"),
            label,
            duration,
            retryTracker
        );
    }
}
