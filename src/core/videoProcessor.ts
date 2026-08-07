import { spawn } from "child_process";
import { basename } from "path";
import {
    WATERMARK_MARGIN,
    WATERMARK_OPACITY,
    MAX_FILE_SIZE,
    AUDIO_BITRATE_TARGET,
    FALLBACK_AUDIO_BITRATE,
    MIN_VIDEO_BITRATE,
    VIDEO_FFMPEG_TIMEOUT_MS,
    VIDEO_CRF,
    VIDEO_PRESET,
} from "../utils/constants.ts";
import { getVideoDuration } from "../utils/ffprobe.ts";
import { registerProcess, unregisterProcess } from "../utils/processTracker.ts";
import { createProgressTracker } from "../utils/progress.ts";

function buildFilterComplex(logoSize: number, scaleFactor?: number): string {
    let videoChain = "[0:v]";
    if (scaleFactor) {
        videoChain += `scale=trunc(iw*${scaleFactor}/2)*2:trunc(ih*${scaleFactor}/2)*2`;
    } else {
        videoChain += "scale=trunc(iw/2)*2:trunc(ih/2)*2";
    }
    videoChain += "[base];";

    return (
        videoChain +
        `[1:v]scale=${logoSize}:${logoSize}:force_original_aspect_ratio=decrease[logo];` +
        `[logo]format=rgba,colorchannelmixer=aa=${WATERMARK_OPACITY}[wm];` +
        `[base][wm]overlay=W-w-${WATERMARK_MARGIN}:H-h-${WATERMARK_MARGIN}[v]`
    );
}

function calculateBitrateKbps(
    maxBytes: number,
    durationSeconds: number
): { videoKbps: number; totalKbps: number; needsScale: boolean } {
    if (durationSeconds <= 0) {
        return {
            videoKbps: MIN_VIDEO_BITRATE,
            totalKbps: MIN_VIDEO_BITRATE + AUDIO_BITRATE_TARGET,
            needsScale: false,
        };
    }

    const totalKbps = Math.floor((maxBytes * 8) / durationSeconds / 1000);
    let videoKbps = totalKbps - AUDIO_BITRATE_TARGET;
    const needsScale = videoKbps < MIN_VIDEO_BITRATE;

    if (needsScale) {
        // When resolution is reduced by 75%, bitrate demand drops roughly 44%
        // (fewer pixels to encode). Recalculate for lower resolution.
        const adjustedTotalKbps = Math.floor(totalKbps * 1.4);
        videoKbps = adjustedTotalKbps - AUDIO_BITRATE_TARGET;
        if (videoKbps < MIN_VIDEO_BITRATE * 0.5) {
            videoKbps = Math.floor(MIN_VIDEO_BITRATE * 0.5);
        }
    }

    return { videoKbps, totalKbps, needsScale };
}

/**
 * Quality-first encode: CRF (visually near-lossless) + copied audio.
 * No bitrate caps — output is best-effort; if it exceeds the upload limit the
 * downstream size gate moves it to heavy/.
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

/**
 * Size/fit encode used by the heavy processor: picks a bitrate from the
 * duration + MAX_FILE_SIZE budget so the output is guaranteed (roughly) to fit.
 */
function buildSizeFfmpegArgs(
    inputPath: string,
    logoPath: string,
    outputPath: string,
    filterComplex: string,
    videoKbps: number,
    totalKbps: number
): string[] {
    return [
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
        "-preset",
        VIDEO_PRESET,
        "-b:v",
        `${videoKbps}k`,
        "-maxrate",
        `${totalKbps}k`,
        "-bufsize",
        `${Math.floor(totalKbps * 2)}k`,
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        `${AUDIO_BITRATE_TARGET}k`,
        "-movflags",
        "+faststart",
        outputPath,
    ];
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

        const timeout = setTimeout(() => {
            console.error(
                `⏱️ ${label} timed out after ${VIDEO_FFMPEG_TIMEOUT_MS / 1000}s, killing ffmpeg...`
            );
            tracker.fail();
            try {
                ffmpeg.kill("SIGKILL");
            } catch {
                // ignore
            }
            unregisterProcess(ffmpeg);
            reject(new Error("Video processing timed out"));
        }, VIDEO_FFMPEG_TIMEOUT_MS);

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
 * Quality-first watermark (normal pipeline): CRF near-lossless + copied audio.
 * Falls back to re-encoding audio (AAC) if the original audio track can't be
 * remuxed into the output container (e.g. Opus from a WebM source).
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
    } catch {
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

/**
 * Size/fit-driven watermark (heavy processor): picks a bitrate from the
 * duration and MAX_FILE_SIZE budget so the output is guaranteed to fit the
 * upload limit. Downscales as a last resort when the bitrate budget is tiny.
 */

export async function applyVideoWatermarkForSize(
    logoPath: string,
    inputPath: string,
    outputPath: string,
    logoSize: number,
    maxBytes: number = MAX_FILE_SIZE
): Promise<void> {
    const duration = await getVideoDuration(inputPath);
    const { videoKbps, totalKbps, needsScale } = calculateBitrateKbps(maxBytes, duration);

    if (needsScale) {
        console.log(
            `📐 ${inputPath} needs scale 75% (bitrate ${videoKbps}kbps < ${MIN_VIDEO_BITRATE}kbps)`
        );
    } else {
        console.log(
            `🎯 ${inputPath} bitrate target: video=${videoKbps}kbps total=${totalKbps}kbps`
        );
    }

    const filterComplex = buildFilterComplex(logoSize, needsScale ? 0.75 : undefined);
    const label = basename(inputPath);
    const tracker = createProgressTracker(label, duration);

    console.log(`🎬 ${label}: watermarking (fit ≤${(maxBytes / (1024 * 1024)).toFixed(0)}MB)...`);
    await runFfmpeg(
        buildSizeFfmpegArgs(inputPath, logoPath, outputPath, filterComplex, videoKbps, totalKbps),
        label,
        duration,
        tracker
    );
}
