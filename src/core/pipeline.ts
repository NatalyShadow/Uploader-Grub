import os from "os";
import { join, extname, basename, dirname } from "path";
import { randomUUID } from "crypto";
import type { Client } from "discord.js";

import { MAX_FILE_SIZE, SEND_REASON_TOO_LARGE, SHOW_FILE_PROGRESS } from "../utils/constants.ts";
import {
    readDirectory,
    getFileStats,
    isImage,
    isGif,
    isVideo,
    isForcedMp4Video,
    deleteFile,
    moveFile,
    ensureDirectory,
    getOutputExtension,
} from "../utils/files.ts";
import { getVideoDimensions, getVideoDuration } from "../utils/ffprobe.ts";
import type { ConfigEntry } from "../types/index.ts";

import { resolveChannel } from "./channel.ts";
import { applyImageWatermark } from "./imageProcessor.ts";
import { applyVideoWatermark } from "./videoProcessor.ts";
import { applyGifWatermark } from "./gifProcessor.ts";
import { sendFile } from "./sender.ts";
import { registerTemp, unregisterTemp } from "../utils/tempTracker.ts";
import { calculateLogoSize } from "../utils/watermark.ts";
import { ensureFfmpeg } from "../utils/validators.ts";

export interface PipelineOptions {
    skipWatermark: boolean;
    moveSent: boolean;
}

/**
 * Moves the original file to `<root>/heavy/` when the post-watermark
 * file exceeds Discord's 10MB upload limit. If the move fails (e.g. due
 * to permissions or disk full), logs a warning and leaves the original
 * in place to avoid data loss.
 */
function moveToHeavy(filePath: string, configPath: string): boolean {
    const root = dirname(configPath);
    const heavyDir = join(root, "heavy");
    ensureDirectory(heavyDir);
    const dest = join(heavyDir, basename(filePath));
    const moved = moveFile(filePath, dest);
    if (moved) {
        console.log(`📦 Oversized → heavy/: ${basename(filePath)}`);
    } else {
        console.warn(
            `⚠️ Could not move oversized ${basename(filePath)} to heavy/, keeping in place`
        );
    }
    return moved;
}

export async function processFile(
    logoPath: string,
    filePath: string,
    fileName: string,
    watermark = true
): Promise<string> {
    const tmpDir = os.tmpdir();
    const ext = extname(fileName).toLowerCase();
    const base = basename(fileName, ext).replace(/\s+/g, "_");

    // processFile is only ever called when a real re-encode is needed
    // (watermark, or a forced .3gp → .mp4 conversion in skip-watermark mode),
    // so the output extension always matches the actual encode: videos → .mp4.
    const outputExt = getOutputExtension(fileName, true);

    const outputPath = join(tmpDir, `wm_${randomUUID()}_${base}${outputExt}`);

    try {
        if (isImage(fileName)) {
            registerTemp(outputPath);
            await applyImageWatermark(logoPath, filePath, outputPath);
            return outputPath;
        }

        if (isGif(fileName) || isVideo(fileName)) {
            registerTemp(outputPath);
            const dims = await getVideoDimensions(filePath);
            const logoSize = calculateLogoSize(dims.width, dims.height);

            // Probe the duration once so the progress bar and the timeout
            // scale with the real GIF/video length instead of fixed guesses.
            const duration = await getVideoDuration(filePath);

            if (isGif(fileName)) {
                await applyGifWatermark(logoPath, filePath, outputPath, logoSize, duration);
            } else {
                await applyVideoWatermark(
                    logoPath,
                    filePath,
                    outputPath,
                    logoSize,
                    duration,
                    watermark
                );
            }
            return outputPath;
        }

        return filePath;
    } catch (err) {
        // Clean up the temp on failure so watermark errors never leak files
        // in /tmp. The callers (runPipeline / heavyProcessor) only quarantine
        // the original; they cannot know the temp path, so it is removed here
        // before the error propagates.
        unregisterTemp(outputPath);
        deleteFile(outputPath, "Temp file");
        throw err;
    }
}

export async function runPipeline(
    client: Client,
    config: ConfigEntry[],
    logoPath: string,
    options: PipelineOptions
): Promise<void> {
    for (const { path, channelId } of config) {
        const channel = await resolveChannel(client, channelId);
        if (!channel) continue;

        const files = readDirectory(path);
        // Count only regular files: subfolders (sent/, heavy/, _SKIPPED_…)
        // are skipped by the loop and would skew the [i/total] counter.
        const eligible = files.filter((fileName) => getFileStats(join(path, fileName))?.isFile());
        const total = eligible.length;

        for (const [index, fileName] of eligible.entries()) {
            const filePath = join(path, fileName);

            if (SHOW_FILE_PROGRESS) {
                console.log(`🔢 [${index + 1}/${total}] ${fileName}`);
            }

            const stats = getFileStats(filePath);
            if (!stats?.isFile()) continue;

            if (stats.size > MAX_FILE_SIZE) {
                moveToHeavy(filePath, path);
                continue;
            }

            let finalPath = filePath;

            try {
                if (isImage(fileName) || isGif(fileName) || isVideo(fileName)) {
                    // Even with --skip-watermark, forced-mp4 containers (.3gp)
                    // must be converted (without the logo) because Discord
                    // cannot play them inline at all.
                    const needsConversion = isVideo(fileName) && isForcedMp4Video(fileName);

                    // Lazy fallback for skip-watermark mode: a .3gp may arrive
                    // after the startup check (e.g. in watch mode) when no
                    // forced file was present at boot. Conversion always needs
                    // ffmpeg/ffprobe, so check once (cached) and skip the file
                    // WITHOUT quarantining it — it stays in place and is
                    // retried once ffmpeg exists.
                    if (options.skipWatermark && needsConversion && !(await ensureFfmpeg())) {
                        console.error(
                            `⚠️ ${fileName}: .3gp conversion requires ffmpeg/ffprobe, skipping`
                        );
                        continue;
                    }

                    if (!options.skipWatermark || needsConversion) {
                        finalPath = await processFile(
                            logoPath,
                            filePath,
                            fileName,
                            !options.skipWatermark
                        );
                    }
                } else {
                    const parentDir = dirname(path);
                    const skippedPath = join(parentDir, `_SKIPPED_${fileName}`);
                    console.log(`⏭️ Skipped unsupported type: ${fileName}`);
                    moveFile(filePath, skippedPath);
                    continue;
                }

                // Discord detects inline media (video/image) by the attachment
                // name's extension. When the file was transcoded the output may
                // be a different container (e.g. .3gp → .mp4, .avif → .jpg), so
                // the attachment must carry the OUTPUT extension — otherwise
                // Discord shows a perfectly good mp4 as a plain file.
                const attachmentName =
                    finalPath !== filePath
                        ? `${basename(fileName, extname(fileName))}${extname(finalPath)}`
                        : fileName;
                const result = await sendFile(
                    channel,
                    finalPath,
                    fileName,
                    channelId,
                    undefined,
                    attachmentName
                );

                if (finalPath !== filePath) {
                    deleteFile(finalPath, "Temp file");
                    unregisterTemp(finalPath);
                }

                if (result.success) {
                    if (options.moveSent) {
                        const parentDir = dirname(path);
                        const sentDir = join(parentDir, "sent");
                        ensureDirectory(sentDir);
                        const moved = moveFile(filePath, join(sentDir, fileName));
                        if (!moved) {
                            console.warn(`⚠️ Could not move ${fileName} to sent, keeping in place`);
                        }
                    } else {
                        deleteFile(filePath, `Original file (${fileName})`);
                    }
                } else if (result.reason === SEND_REASON_TOO_LARGE) {
                    moveToHeavy(filePath, path);
                }
            } catch (err) {
                if (err instanceof Error) {
                    console.error(`❌ Error processing ${fileName}:`, err.message);
                } else {
                    console.error(`❌ Error processing ${fileName}:`, err);
                }

                // Quarantine unprocessable files so they are not retried on
                // every run (e.g. a corrupt/truncated source). The `_failed`
                // subfolder is auto-skipped later because the loop only
                // processes regular files (stats.isFile()).
                const failedDir = join(path, "_failed");
                ensureDirectory(failedDir);
                const quarantined = moveFile(filePath, join(failedDir, fileName));
                if (quarantined) {
                    console.error(`📦 Quarantined ${fileName} to ${failedDir}/`);
                } else {
                    console.warn(`⚠️ Could not quarantine ${fileName}, keeping in place`);
                }
            }
        }
    }

    console.log("✅ All files processed.");
}
