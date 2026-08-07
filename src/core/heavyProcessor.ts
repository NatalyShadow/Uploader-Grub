import { join, extname, basename } from "path";
import type { ConfigEntry } from "../types/index.ts";

import {
    readDirectory,
    getFileStats,
    isImage,
    isGif,
    isVideo,
    ensureDirectory,
    moveFile,
    deleteFile,
    copyFile,
} from "../utils/files.ts";
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

        // Only create the destination folder when there are files to process.
        const processedDir = join(root, "processed");
        ensureDirectory(processedDir);

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
                let processedTempPath: string;

                if (options.skipWatermark) {
                    // Just copy to temp with UUID name, no processing
                    const outputExt =
                        processorType === "video"
                            ? ".mp4"
                            : processorType === "gif"
                              ? ".gif"
                              : extname(fileName).toLowerCase() || ".png";
                    const tempName = `heavy_${basename(fileName, extname(fileName))}${outputExt}`;
                    const tmpDir = (await import("os")).tmpdir();
                    processedTempPath = join(tmpDir, tempName);
                    copyFile(filePath, processedTempPath);
                } else {
                    // Process file (watermark + compression for videos)
                    processedTempPath = await processFile(logoPath, filePath, fileName);
                }

                // Determine output extension
                const outputExt =
                    processorType === "video"
                        ? ".mp4"
                        : processorType === "gif"
                          ? ".gif"
                          : extname(fileName).toLowerCase() || ".png";

                // Keep the original base name (UUID from organizer), only swap extension
                const finalName = `${basename(fileName, extname(fileName))}${outputExt}`;
                const finalPath = join(processedDir, finalName);
                const moved = moveFile(processedTempPath, finalPath);

                if (moved) {
                    // Delete original from heavy/ only if move succeeded
                    deleteFile(filePath, `Original heavy: ${fileName}`);
                    console.log(`✅ Processed: ${fileName} → processed/${finalName}`);
                } else {
                    console.error(`❌ Failed to move processed file, keeping original in heavy/`);
                    // Clean up orphaned temp file
                    deleteFile(processedTempPath, "Temp file");
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`❌ Error processing ${fileName}:`, message);
                // Continue with next file
            }
        }
    }

    console.log("✅ Heavy folder processing completed.");
}
