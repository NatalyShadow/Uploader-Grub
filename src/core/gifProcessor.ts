import { spawn } from "child_process";
import { WATERMARK_MARGIN, WATERMARK_OPACITY, GIF_FFMPEG_TIMEOUT_MS } from "../utils/constants.ts";
import { registerProcess, unregisterProcess } from "../utils/processTracker.ts";

export function applyGifWatermark(
    logoPath: string,
    inputPath: string,
    outputPath: string,
    logoSize: number
): Promise<void> {
    return new Promise((resolve, reject) => {
        const args = [
            "-y",
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

        const ffmpeg = spawn("ffmpeg", args, { stdio: "inherit" });
        registerProcess(ffmpeg);

        const timeout = setTimeout(() => {
            console.error(
                `⏱️ GIF processing timed out after ${GIF_FFMPEG_TIMEOUT_MS / 1000}s, killing ffmpeg...`
            );
            try {
                ffmpeg.kill("SIGKILL");
            } catch {
                // ignore
            }
            unregisterProcess(ffmpeg);
            reject(new Error("GIF processing timed out"));
        }, GIF_FFMPEG_TIMEOUT_MS);

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
