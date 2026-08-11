import { spawn } from "child_process";
import { basename } from "path";
import {
    WATERMARK_MARGIN,
    WATERMARK_OPACITY,
    FALLBACK_AUDIO_BITRATE,
    VIDEO_FFMPEG_TIMEOUT_MS,
    VIDEO_CRF,
    VIDEO_PRESET,
    USE_NICE,
} from "../utils/constants.ts";
import { getEncoderInfo, softwareEncoder, type EncoderInfo } from "../utils/encoder.ts";
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
 * The chosen encoder (hardware or software) is injected here.
 */
function buildEncodeArgs(
    inputPath: string,
    logoPath: string,
    outputPath: string,
    filterComplex: string,
    audio: "copy" | "aac",
    enc: EncoderInfo
): string[] {
    const args = [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-progress",
        "pipe:1",
        "-nostats",
        ...enc.initArgs,
        "-i",
        inputPath,
        "-i",
        logoPath,
        "-filter_complex",
        filterComplex + enc.filterTail,
        "-map",
        `[${enc.outLabel}]`,
        "-map",
        "0:a:0?",
        ...enc.encoderArgs(VIDEO_CRF, VIDEO_PRESET),
    ];

    if (audio === "copy") {
        args.push("-c:a", "copy"); // preserve original audio → zero loss
    } else {
        args.push("-c:a", "aac", "-b:a", `${FALLBACK_AUDIO_BITRATE}k`);
    }

    args.push("-movflags", "+faststart", outputPath);
    return args;
}

/** Spawns ffmpeg, optionally through `nice` so it never starves the system. */
function spawnFfmpeg(args: string[]): ReturnType<typeof spawn> {
    if (USE_NICE) {
        return spawn("nice", ["-n", "10", "ffmpeg", ...args], {
            stdio: ["ignore", "pipe", "pipe"],
        });
    }
    return spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
}

/** Run a single ffmpeg attempt. Rejects on any failure (non-zero exit, timeout, spawn error). */
async function runFfmpeg(
    args: string[],
    label: string,
    duration: number,
    tracker: ReturnType<typeof createProgressTracker>
): Promise<{ stderr: string }> {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawnFfmpeg(args);
        registerProcess(ffmpeg);

        let progressBuffer = "";
        ffmpeg.stdout?.on("data", (chunk: Buffer) => {
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
        ffmpeg.stderr?.on("data", (chunk: Buffer) => {
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

function isTimeout(err: unknown): boolean {
    return err instanceof Error && err.message === "Video processing timed out";
}

/**
 * Quality-first watermark (single standard, used by the normal pipeline and the
 * heavy processor): CRF near-lossless + copied audio. Uses the auto-detected
 * hardware encoder when available (iGPU/GPU, far cooler and faster); falls back
 * to software libx264 if the hardware attempt fails (unsupported input/audio).
 * Falls back to re-encoding audio (AAC) if the original audio track can't be
 * remuxed into the output container (e.g. Opus from a WebM source). Timeouts
 * are NOT retried: a timeout is a resource problem, not a codec issue.
 */
export async function applyVideoWatermark(
    logoPath: string,
    inputPath: string,
    outputPath: string,
    logoSize: number,
    duration: number
): Promise<void> {
    const label = basename(inputPath);
    const filterComplex = buildFilterComplex(logoSize);
    const enc = getEncoderInfo();

    console.log(
        `🎬 ${label}: watermarking (encoder=${enc.backend}, crf=${VIDEO_CRF}, preset=${VIDEO_PRESET})...`
    );

    const attempt = (audio: "copy" | "aac", encoder: EncoderInfo): Promise<{ stderr: string }> =>
        runFfmpeg(
            buildEncodeArgs(inputPath, logoPath, outputPath, filterComplex, audio, encoder),
            label,
            duration,
            createProgressTracker(label, duration)
        );

    try {
        await attempt("copy", enc);
    } catch (err) {
        if (isTimeout(err)) throw err;

        if (enc.backend !== "libx264") {
            // Hardware attempt failed (input/codec not supported): retry once
            // with the software encoder before giving up.
            console.log(`🔁 ${label}: ${enc.backend} encode failed, retrying with libx264...`);
            const sw = softwareEncoder();
            try {
                await attempt("copy", sw);
            } catch (err2) {
                if (isTimeout(err2)) throw err2;
                console.log(`🔊 ${label}: audio copy failed, re-encoding audio to AAC...`);
                await attempt("aac", sw);
            }
        } else {
            console.log(`🔊 ${label}: audio copy failed, re-encoding audio to AAC...`);
            await attempt("aac", enc);
        }
    }
}
