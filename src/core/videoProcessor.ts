import { spawn } from "child_process";
import {
    WATERMARK_MARGIN,
    WATERMARK_OPACITY,
    MAX_FILE_SIZE,
    AUDIO_BITRATE_TARGET,
    MIN_VIDEO_BITRATE,
    VIDEO_FFMPEG_TIMEOUT_MS,
} from "../utils/constants.ts";
import { getVideoDuration } from "../utils/ffprobe.ts";
import { registerProcess, unregisterProcess } from "../utils/processTracker.ts";

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

export async function applyVideoWatermark(
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

    const args = [
        "-y",
        "-i",
        inputPath,
        "-i",
        logoPath,
        "-filter_complex",
        filterComplex,
        "-map",
        "[v]",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-b:v",
        `${videoKbps}k`,
        "-maxrate",
        `${totalKbps}k`,
        "-bufsize",
        `${Math.floor(totalKbps / 2)}k`,
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

    return new Promise((resolve, reject) => {
        const ffmpeg = spawn("ffmpeg", args, { stdio: "inherit" });
        registerProcess(ffmpeg);

        const timeout = setTimeout(() => {
            console.error(
                `⏱️ Video processing timed out after ${VIDEO_FFMPEG_TIMEOUT_MS / 1000}s, killing ffmpeg...`
            );
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
            reject(err);
        });

        ffmpeg.on("close", (code: number | null) => {
            clearTimeout(timeout);
            unregisterProcess(ffmpeg);
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg exited with code ${code}`));
        });
    });
}
