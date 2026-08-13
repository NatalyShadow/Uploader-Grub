import { basename } from "path";
import {
    WATERMARK_MARGIN,
    WATERMARK_OPACITY,
    USE_NICE,
    gifFfmpegTimeoutMs,
} from "../utils/constants.ts";
import { runCommand } from "../utils/process.ts";

export function applyGifWatermark(
    logoPath: string,
    inputPath: string,
    outputPath: string,
    logoSize: number,
    duration: number
): Promise<void> {
    const label = basename(inputPath);

    const args = [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostats",
        "-i",
        inputPath,
        "-i",
        logoPath,
        "-filter_complex",
        `[0:v]scale=iw:ih:flags=fast_bilinear[gif_norm];` +
            `[1:v]scale=${logoSize}:${logoSize}:force_original_aspect_ratio=decrease[logo];` +
            `[logo]format=rgba,colorchannelmixer=aa=${WATERMARK_OPACITY}[wm];` +
            `[gif_norm][wm]overlay=W-w-${WATERMARK_MARGIN}:H-h-${WATERMARK_MARGIN}[overlaid];` +
            `[overlaid]split[s0][s1];` +
            `[s0]palettegen=max_colors=256:stats_mode=single[palette];` +
            `[s1][palette]paletteuse=dither=bayer:bayer_scale=3`,
        outputPath,
    ];

    console.log(`⏳ Processing GIF: ${label}...`);

    return runCommand({
        command: "ffmpeg",
        args,
        nice: USE_NICE ? 10 : undefined,
        timeoutMs: gifFfmpegTimeoutMs(duration),
        label: `GIF ${label}`,
        maxStderrChars: 4096,
    }).then(() => {
        console.log(`✅ ${label} done`);
    });
}
