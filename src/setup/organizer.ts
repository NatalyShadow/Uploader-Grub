import { join, extname } from "path";
import { readdirSync, statSync, renameSync, existsSync } from "fs";
import { randomUUID } from "crypto";

import { IMAGE_EXTS, VIDEO_EXTS, GIF_EXT, MAX_FILE_SIZE, UUID_PREFIX } from "../utils/constants.ts";
import { ensureDirectory } from "../utils/files.ts";
import type { OrganizerStats, MediaFolder } from "../types/index.ts";

function getOrganizerType(fileName: string): MediaFolder | null {
    const ext = extname(fileName).toLowerCase();
    if (IMAGE_EXTS.includes(ext as (typeof IMAGE_EXTS)[number]) || ext === GIF_EXT) return "images";
    if (VIDEO_EXTS.includes(ext as (typeof VIDEO_EXTS)[number])) return "videos";
    return null;
}

function generateUuidName(extension: string): string {
    return `${UUID_PREFIX}${randomUUID()}${extension}`;
}

export function organizeFiles(rootPath: string): OrganizerStats {
    let entries;
    try {
        entries = readdirSync(rootPath);
    } catch (err) {
        if (err instanceof Error) {
            console.error(`❌ Cannot read ${rootPath}:`, err.message);
        }
        return { moved: 0, skipped: 0, errors: 1, heavy: 0 };
    }

    let moved = 0;
    let skipped = 0;
    let errors = 0;
    let heavy = 0;

    for (const entry of entries) {
        const filePath = join(rootPath, entry);

        let stats;
        try {
            stats = statSync(filePath);
        } catch {
            continue;
        }

        if (!stats.isFile()) continue;

        const type = getOrganizerType(entry);
        if (!type) {
            console.log(`⏭️ Skipped (unsupported ext): ${entry}`);
            skipped++;
            continue;
        }

        const subfolder: MediaFolder = stats.size > MAX_FILE_SIZE ? "heavy" : type;
        const destDir = join(rootPath, subfolder);
        ensureDirectory(destDir);

        const ext = extname(entry).toLowerCase();
        const newName = generateUuidName(ext);
        const destPath = join(destDir, newName);

        if (existsSync(destPath)) {
            console.log(`⚠️ Destination exists, skipping: ${entry}`);
            skipped++;
            continue;
        }

        try {
            renameSync(filePath, destPath);
            console.log(`📦 ${entry} → ${subfolder}/${newName}`);
            moved++;
            if (subfolder === "heavy") heavy++;
        } catch (e) {
            if (e instanceof Error) {
                console.error(`❌ Error moving ${entry}:`, e.message);
            }
            errors++;
        }
    }

    return { moved, skipped, errors, heavy };
}
