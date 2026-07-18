import { readdirSync, statSync, unlinkSync, existsSync, mkdirSync, renameSync } from "fs";
import { extname, parse as parsePath, join as joinPath } from "path";
import type { Stats } from "fs";

import { IMAGE_EXTS, VIDEO_EXTS, GIF_EXT } from "./constants.ts";

export function isImage(fileName: string): boolean {
    return IMAGE_EXTS.includes(extname(fileName).toLowerCase() as (typeof IMAGE_EXTS)[number]);
}

export function isGif(fileName: string): boolean {
    return extname(fileName).toLowerCase() === GIF_EXT;
}

export function isVideo(fileName: string): boolean {
    return VIDEO_EXTS.includes(extname(fileName).toLowerCase() as (typeof VIDEO_EXTS)[number]);
}

export function readDirectory(path: string): string[] {
    try {
        return readdirSync(path);
    } catch (err) {
        if (err instanceof Error) {
            console.error(`❌ Error reading folder ${path}:`, err.message);
        }
        return [];
    }
}

export function getFileStats(filePath: string): Stats | null {
    try {
        return statSync(filePath);
    } catch {
        return null;
    }
}

export function deleteFile(filePath: string, label = "file"): boolean {
    if (!existsSync(filePath)) return false;
    try {
        unlinkSync(filePath);
        console.log(`🗑️ ${label} deleted`);
        return true;
    } catch (e) {
        if (e instanceof Error) {
            console.error(`⚠️ Error deleting ${label}: ${e.message}`);
        }
        return false;
    }
}

export function moveFile(source: string, target: string): boolean {
    try {
        let finalTarget = target;
        if (existsSync(target)) {
            const { dir, name, ext } = parsePath(target);
            finalTarget = joinPath(dir, `${name}_${Date.now()}${ext}`);
        }
        ensureDirectory(parsePath(finalTarget).dir);
        renameSync(source, finalTarget);
        console.log(`📦 Moved: ${source} → ${finalTarget}`);
        return true;
    } catch (e) {
        if (e instanceof Error) {
            console.error(`⚠️ Error moving file: ${e.message}`);
        }
        return false;
    }
}

export function ensureDirectory(path: string): boolean {
    if (!existsSync(path)) {
        try {
            mkdirSync(path, { recursive: true });
            return true;
        } catch (e) {
            if (e instanceof Error) {
                console.error(`❌ Failed to create directory ${path}:`, e.message);
            }
            return false;
        }
    }
    return true;
}
