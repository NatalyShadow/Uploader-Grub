import {
    readdirSync,
    statSync,
    unlinkSync,
    existsSync,
    mkdirSync,
    renameSync,
    copyFileSync,
} from "fs";
import { extname, parse as parsePath, join as joinPath } from "path";
import { randomUUID } from "crypto";
import type { Stats } from "fs";

import { IMAGE_EXTS, VIDEO_EXTS, GIF_EXT, UUID_PREFIX } from "./constants.ts";

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
        try {
            renameSync(source, finalTarget);
        } catch (e) {
            if (e instanceof Error && "code" in e && e.code === "EXDEV") {
                // Cross-device move: copy then delete
                copyFileSync(source, finalTarget);
                unlinkSync(source);
            } else {
                throw e;
            }
        }
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

/**
 * Moves `source` over `target`, overwriting it (unlike `moveFile`, which
 * appends a timestamp suffix when the target already exists). Used to keep
 * the watermarked copy as the new heavy/ file when the output is still
 * oversized. Falls back to copy+delete on cross-device (EXDEV) moves.
 */
export function replaceFile(source: string, target: string): boolean {
    try {
        if (existsSync(target)) {
            unlinkSync(target);
        }
        ensureDirectory(parsePath(target).dir);
        try {
            renameSync(source, target);
        } catch (e) {
            if (e instanceof Error && "code" in e && e.code === "EXDEV") {
                copyFileSync(source, target);
                unlinkSync(source);
            } else {
                throw e;
            }
        }
        console.log(`♻️ Replaced: ${target} (from ${source})`);
        return true;
    } catch (e) {
        if (e instanceof Error) {
            console.error(`⚠️ Error replacing file: ${e.message}`);
        }
        return false;
    }
}

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;

/**
 * Normalises a user-supplied prefix so the generated file name always
 * has exactly one underscore between the prefix and the UUID, regardless
 * of how the user formatted the env value.
 *
 *   "grub"    → "grub"
 *   "grub_"   → "grub"
 *   "_grub_"  → "grub"
 *   "grub__"  → "grub"
 *   "grub v2" → "grub_v2"
 *   "  "      → ""
 */
function normalizePrefix(raw: string | undefined): string {
    if (!raw) return "";
    return raw
        .trim()
        .replace(INVALID_FILENAME_CHARS, "")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
}

export function generateUuidName(extension: string): string {
    const prefix = normalizePrefix(UUID_PREFIX);
    return prefix ? `${prefix}_${randomUUID()}${extension}` : `${randomUUID()}${extension}`;
}

export function copyFile(source: string, target: string): boolean {
    try {
        ensureDirectory(parsePath(target).dir);
        copyFileSync(source, target);
        console.log(`📋 Copied: ${source} → ${target}`);
        return true;
    } catch (e) {
        if (e instanceof Error) {
            console.error(`⚠️ Error copying file: ${e.message}`);
        }
        return false;
    }
}
