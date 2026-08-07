import os from "os";
import { join, extname, basename } from "path";
import type { ConfigEntry } from "../types/index.ts";

import {
    readDirectory,
    getFileStats,
    isImage,
    isGif,
    isVideo,
    moveFile,
    deleteFile,
    copyFile,
    ensureDirectory,
    replaceFile,
} from "../utils/files.ts";
import { MAX_FILE_SIZE } from "../utils/constants.ts";
import { registerTemp, unregisterTemp } from "../utils/tempTracker.ts";
import { processFile } from "./pipeline.ts";
import { getUniqueRoots } from "../setup/index.ts";

export interface HeavyProcessorOptions {
    skipWatermark: boolean;
}

export async function processHeavyFiles(
    config: ConfigEntry[],
    logoPath: string,
    options: HeavyProcessorOptions
): Promise<void> {
    const roots = getUniqueRoots(config);

    for (const root of roots) {
        const heavyDir = join(root, "heavy");
        const files = readDirectory(heavyDir);

        if (files.length === 0) {
            console.log(`📂 No files in heavy/: ${heavyDir}`);
            continue;
        }

        console.log(`🔄 Processing ${files.length} file(s) from heavy/: ${heavyDir}`);

        for (const fileName of files) {
            const filePath = join(heavyDir, fileName);
            const stats = getFileStats(filePath);
            if (!stats?.isFile()) continue;

            // Determine type
            let processorType: "image" | "gif" | "video" | null = null;
            if (isImage(fileName)) processorType = "image";
            else if (isGif(fileName)) processorType = "gif";
            else if (isVideo(fileName)) processorType = "video";
            else {
                console.log(`⏭️ Skipped (unsupported type): ${fileName}`);
                continue;
            }

            try {
                const outputExt =
                    processorType === "video"
                        ? ".mp4"
                        : processorType === "gif"
                          ? ".gif"
                          : extname(fileName).toLowerCase() || ".png";

                let processedTempPath: string;

                if (options.skipWatermark) {
                    // Copy to temp without processing. The temp name derives from
                    // the original file name (which already carries the organizer
                    // UUID), so the promoted file keeps its name. Registered with
                    // tempTracker so an interrupted run cleans up on shutdown.
                    const base = basename(fileName, extname(fileName));
                    const tmpDir = os.tmpdir();
                    const tempName = `heavy_${base}${outputExt}`;
                    processedTempPath = join(tmpDir, tempName);
                    registerTemp(processedTempPath);
                    if (!copyFile(filePath, processedTempPath)) {
                        unregisterTemp(processedTempPath);
                        deleteFile(processedTempPath, "Temp file");
                        continue;
                    }
                } else {
                    // Quality-first processing (watermark; videos use the same
                    // CRF + lossless-audio encode as the normal pipeline). No
                    // size target — if the result already fits the upload limit
                    // the size gate below promotes it, otherwise it stays
                    // watermarked in heavy/ for manual upload.
                    processedTempPath = await processFile(logoPath, filePath, fileName);
                }

                // Size gate: promote files that now fit the upload limit.
                // Files that remain oversized are kept in heavy/ but REPLACED by
                // the watermarked copy, so no heavy/ file is ever left unmarked.
                const processedStats = getFileStats(processedTempPath);
                if (!processedStats || processedStats.size > MAX_FILE_SIZE) {
                    const sizeMB = ((processedStats?.size ?? 0) / (1024 * 1024)).toFixed(1);
                    const replaced = replaceFile(processedTempPath, filePath);
                    unregisterTemp(processedTempPath);
                    if (replaced) {
                        console.warn(
                            `💡 ${fileName} still exceeds 10MB (${sizeMB}MB), kept watermarked in heavy/`
                        );
                    } else {
                        console.error(
                            `⚠️ Could not keep watermarked copy, temp cleaned; original stays`
                        );
                        deleteFile(processedTempPath, "Temp file");
                    }
                    continue;
                }

                // Move one level up (same level as heavy/) so the organizer routes
                // it to videos/ on the next normal run.
                const finalName = `${basename(fileName, extname(fileName))}${outputExt}`;
                const finalPath = join(root, finalName);
                const moved = moveFile(processedTempPath, finalPath);
                unregisterTemp(processedTempPath);

                if (moved) {
                    // Delete original from heavy/ only if move succeeded
                    deleteFile(filePath, `Original heavy: ${fileName}`);
                    console.log(`✅ Processed: ${fileName} → ${finalPath} (ready to organize)`);
                } else {
                    console.error(`❌ Failed to move processed file, keeping original in heavy/`);
                    // Clean up orphaned temp file
                    unregisterTemp(processedTempPath);
                    deleteFile(processedTempPath, "Temp file");
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`❌ Error processing ${fileName}:`, message);

                // Quarantine unprocessable files so they are not retried on
                // every run. The `_failed` folder is auto-skipped later because
                // the loop only processes regular files (stats.isFile()).
                const failedDir = join(heavyDir, "_failed");
                ensureDirectory(failedDir);
                const quarantined = moveFile(filePath, join(failedDir, fileName));
                if (quarantined) {
                    console.error(`📦 Quarantined ${fileName} to heavy/_failed/`);
                } else {
                    console.error(`⚠️ Could not quarantine ${fileName}, keeping in heavy/`);
                }
                // Continue with next file
            }
        }
    }

    console.log("✅ Heavy folder processing completed.");
}
