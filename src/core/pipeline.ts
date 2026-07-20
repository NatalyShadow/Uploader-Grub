import os from "os";
import { join, extname, basename, dirname } from "path";
import { randomUUID } from "crypto";
import type { Client } from "discord.js";

import { MAX_FILE_SIZE, SEND_REASON_TOO_LARGE } from "../utils/constants.ts";
import {
    readDirectory,
    getFileStats,
    isImage,
    isGif,
    isVideo,
    deleteFile,
    moveFile,
    ensureDirectory,
} from "../utils/files.ts";
import { getVideoDimensions } from "../utils/ffprobe.ts";
import type { ConfigEntry } from "../types/index.ts";

import { resolveChannel } from "./channel.ts";
import { applyImageWatermark } from "./imageProcessor.ts";
import { applyVideoWatermark } from "./videoProcessor.ts";
import { applyGifWatermark } from "./gifProcessor.ts";
import { sendFile } from "./sender.ts";
import { registerTemp, unregisterTemp } from "../utils/tempTracker.ts";
import { calculateLogoSize } from "../utils/watermark.ts";

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

async function processFile(logoPath: string, filePath: string, fileName: string): Promise<string> {
    const tmpDir = os.tmpdir();
    const ext = extname(fileName).toLowerCase();
    const base = basename(fileName, ext).replace(/\s+/g, "_");

    const outputExt = isVideo(fileName) ? ".mp4" : isGif(fileName) ? ".gif" : ext || ".png";

    const outputPath = join(tmpDir, `wm_${randomUUID()}_${base}${outputExt}`);
    registerTemp(outputPath);

    if (isImage(fileName)) {
        await applyImageWatermark(logoPath, filePath, outputPath);
        return outputPath;
    }

    if (isGif(fileName) || isVideo(fileName)) {
        const dims = await getVideoDimensions(filePath);
        const logoSize = calculateLogoSize(dims.width, dims.height);

        if (isGif(fileName)) {
            await applyGifWatermark(logoPath, filePath, outputPath, logoSize);
        } else {
            await applyVideoWatermark(logoPath, filePath, outputPath, logoSize, MAX_FILE_SIZE);
        }
        return outputPath;
    }

    return filePath;
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

        for (const fileName of files) {
            const filePath = join(path, fileName);

            const stats = getFileStats(filePath);
            if (!stats?.isFile()) continue;

            if (stats.size > MAX_FILE_SIZE) {
                console.log(`⚠️ Too large: ${fileName}`);
                continue;
            }

            let finalPath = filePath;

            try {
                if (isImage(fileName) || isGif(fileName) || isVideo(fileName)) {
                    if (!options.skipWatermark) {
                        finalPath = await processFile(logoPath, filePath, fileName);
                    }
                } else {
                    const parentDir = dirname(path);
                    const skippedPath = join(parentDir, `_SKIPPED_${fileName}`);
                    console.log(`⏭️ Skipped unsupported type: ${fileName}`);
                    moveFile(filePath, skippedPath);
                    continue;
                }

                const result = await sendFile(channel, finalPath, fileName, channelId);

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
            }
        }
    }

    console.log("✅ All files processed.");
}
