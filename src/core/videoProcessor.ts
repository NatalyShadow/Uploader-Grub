import { basename } from "node:path";
import {
    FALLBACK_AUDIO_BITRATE,
    USE_NICE,
    VIDEO_CRF,
    VIDEO_FFMPEG_TIMEOUT_MS,
    VIDEO_PRESET,
    WATERMARK_MARGIN,
    WATERMARK_OPACITY,
} from "../utils/constants.ts";
import { type EncoderInfo, getEncoderInfo, softwareEncoder } from "../utils/encoder.ts";
import { ProcessError, runCommand, TimeoutError } from "../utils/process.ts";
import { createProgressTracker } from "../utils/progress.ts";

function buildFilterComplex(logoSize: number, watermark: boolean): string {
    if (!watermark) {
        // No-logo conversion (e.g. forced .3gp → .mp4): just scale to even
        // dimensions for the encoder, no second input, no overlay.
        return `[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[v]`;
    }
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
    enc: EncoderInfo,
    watermark: boolean
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
    ];

    // Only the watermark path consumes the logo as a second input.
    if (watermark) {
        args.push("-i", logoPath);
    }

    args.push(
        "-filter_complex",
        filterComplex + enc.filterTail,
        "-map",
        `[${enc.outLabel}]`,
        "-map",
        "0:a:0?",
        ...enc.encoderArgs(VIDEO_CRF, VIDEO_PRESET)
    );

    if (audio === "copy") {
        args.push("-c:a", "copy"); // preserve original audio → zero loss
    } else {
        args.push("-c:a", "aac", "-b:a", `${FALLBACK_AUDIO_BITRATE}k`);
    }

    args.push("-movflags", "+faststart", outputPath);
    return args;
}

/**
 * Run a single ffmpeg attempt, parsing `-progress` output into the tracker.
 * Scale the timeout with the video length so long files are not killed
 * mid-encode: at least the configured base, ~2x the duration, capped at 6h
 * so a stuck encode still always aborts.
 */
async function runFfmpeg(
    args: string[],
    label: string,
    duration: number,
    tracker: ReturnType<typeof createProgressTracker>
): Promise<void> {
    let progressBuffer = "";

    try {
        await runCommand({
            command: "ffmpeg",
            args,
            nice: USE_NICE ? 10 : undefined,
            timeoutMs: Math.max(
                VIDEO_FFMPEG_TIMEOUT_MS,
                Math.min(duration * 1000 * 2 + 60_000, 6 * 60 * 60 * 1000)
            ),
            label,
            maxStderrChars: 4096,
            onStdout(chunk: string) {
                progressBuffer += chunk;
                const lines = progressBuffer.split("\n");
                progressBuffer = lines.pop() ?? "";
                for (const line of lines) {
                    const match = /^out_time_us=(\d+)/.exec(line);
                    if (match) {
                        tracker.update(parseInt(match[1], 10) / 1_000_000);
                    }
                }
            },
        });
        tracker.complete();
    } catch (err) {
        tracker.fail();
        throw err;
    }
}

/**
 * Returns true when ffmpeg's stderr says the failure is an audio-remux problem,
 * i.e. the COPIED audio track cannot be placed in the output container (the one
 * case re-encoding the audio to AAC actually fixes).
 *
 * In this pipeline the video stream is always re-encoded (libx264/hardware),
 * never copied, so the copied stream is always the audio — the output's 0:1.
 * Matching is intentionally conservative: a false "not-audio" only costs the
 * AAC retry (the file is quarantined with the real error), while a false
 * "audio" would revive the old bug of a wasted, misleadingly-logged AAC retry
 * on a genuine video-encode failure.
 */
function isAudioCopyError(err: unknown): boolean {
    if (!(err instanceof ProcessError)) return false;
    const s = err.stderr;
    return (
        /could not find tag for codec/i.test(s) ||
        /codec not currently supported in container/i.test(s) ||
        (/not suitable for output format/i.test(s) && /audio/i.test(s)) ||
        /output stream #0:1/i.test(s)
    );
}

/**
 * Re-encodes a video to H.264/AAC `.mp4`, optionally overlaying the logo.
 *
 * Used for two jobs:
 * - watermarking (the normal pipeline and the heavy processor);
 * - forced conversion to `.mp4` without a logo (e.g. `.3gp` when watermarking
 *   is skipped — Discord cannot render `.3gp` inline at all).
 *
 * Quality-first (CRF near-lossless + copied audio), uses the auto-detected
 * hardware encoder when available (iGPU/GPU, far cooler and faster); falls back
 * to software libx264 if the hardware attempt fails (unsupported input/codec).
 * Falls back to re-encoding audio (AAC) only when the failure is actually an
 * audio-remux problem (stderr-classified, see `isAudioCopyError`), e.g. Opus
 * from a WebM source; a genuine video-encode failure propagates the real error
 * instead of wasting a misleading AAC retry. Timeouts are NOT retried: a
 * timeout is a resource problem, not a codec issue.
 */
export async function applyVideoWatermark(
    logoPath: string,
    inputPath: string,
    outputPath: string,
    logoSize: number,
    duration: number,
    watermark = true
): Promise<void> {
    const label = basename(inputPath);
    const filterComplex = buildFilterComplex(logoSize, watermark);
    const enc = await getEncoderInfo();

    const mode = watermark ? "watermarking" : "converting";
    console.log(
        `🎬 ${label}: ${mode} (encoder=${enc.backend}, crf=${VIDEO_CRF}, preset=${VIDEO_PRESET})...`
    );

    const attempt = (audio: "copy" | "aac", encoder: EncoderInfo): Promise<void> =>
        runFfmpeg(
            buildEncodeArgs(
                inputPath,
                logoPath,
                outputPath,
                filterComplex,
                audio,
                encoder,
                watermark
            ),
            label,
            duration,
            createProgressTracker(label, duration)
        );

    try {
        await attempt("copy", enc);
    } catch (err) {
        if (err instanceof TimeoutError) throw err;

        if (isAudioCopyError(err)) {
            // The copied audio cannot be remuxed into the container (e.g. Opus
            // in a WebM source). The video encode itself is fine, so keep the
            // same encoder and only re-encode the audio to AAC.
            console.log(`🔊 ${label}: audio copy failed, re-encoding audio to AAC...`);
            try {
                await attempt("aac", enc);
            } catch (err2) {
                if (err2 instanceof TimeoutError) throw err2;
                if (enc.backend === "libx264") throw err2;
                console.log(`🔁 ${label}: ${enc.backend} encode failed, retrying with libx264...`);
                await attempt("aac", softwareEncoder());
            }
        } else if (enc.backend === "libx264") {
            // A genuine video-encode failure on the software encoder: there is
            // nothing left to fall back to, so propagate the real error (the
            // caller quarantines the file) instead of wasting an AAC retry.
            throw err;
        } else {
            // Hardware attempt failed (input/codec not supported): retry once
            // with the software encoder before giving up.
            console.log(`🔁 ${label}: ${enc.backend} encode failed, retrying with libx264...`);
            try {
                await attempt("copy", softwareEncoder());
            } catch (err2) {
                if (err2 instanceof TimeoutError) throw err2;
                if (isAudioCopyError(err2)) {
                    console.log(`🔊 ${label}: audio copy failed, re-encoding audio to AAC...`);
                    await attempt("aac", softwareEncoder());
                    return;
                }
                // A video failure on the software encoder has no further
                // fallback: throw err2 (the real error) so the caller
                // quarantines the file.
                throw err2;
            }
        }
    }
}
