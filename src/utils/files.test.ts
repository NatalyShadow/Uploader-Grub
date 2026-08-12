import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    isImage,
    isGif,
    isVideo,
    isUnsupportedImage,
    isForcedMp4Video,
    readDirectory,
    getFileStats,
    deleteFile,
    moveFile,
    replaceFile,
    ensureDirectory,
    generateUuidName,
    getOutputExtension,
} from "./files.ts";

let tmpDir: string;

beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "grub-files-"));
});

afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
});

describe("isImage", () => {
    it.each([
        ["photo.png", true],
        ["photo.PNG", true],
        ["photo.jpg", true],
        ["photo.jpeg", true],
        ["photo.webp", true],
        ["photo.avif", true],
        ["photo.bmp", true],
        ["photo.tiff", true],
        ["photo.gif", false],
        ["photo.mp4", false],
        ["photo.txt", false],
    ])("detects %s as %s", (name, expected) => {
        expect(isImage(name)).toBe(expected);
    });
});

describe("isGif", () => {
    it("detects gif case-insensitively", () => {
        expect(isGif("anim.gif")).toBe(true);
        expect(isGif("anim.GIF")).toBe(true);
    });

    it("rejects non-gif files", () => {
        expect(isGif("anim.png")).toBe(false);
        expect(isGif("anim.mp4")).toBe(false);
    });
});

describe("isVideo", () => {
    it.each([
        ["clip.mp4", true],
        ["clip.MOV", true],
        ["clip.webm", true],
        ["clip.mkv", true],
        ["clip.avi", true],
        ["clip.m4v", true],
        ["clip.flv", true],
        ["clip.wmv", true],
        ["clip.3gp", true],
        ["clip.3GP", true],
        ["clip.gif", false],
        ["clip.png", false],
        ["clip.txt", false],
    ])("detects %s as %s", (name, expected) => {
        expect(isVideo(name)).toBe(expected);
    });
});

describe("getOutputExtension", () => {
    it("transcodes videos to .mp4 when watermarking", () => {
        expect(getOutputExtension("clip.webm", true)).toBe(".mp4");
        expect(getOutputExtension("clip.mkv", true)).toBe(".mp4");
        expect(getOutputExtension("clip.mov", true)).toBe(".mp4");
        expect(getOutputExtension("clip.3gp", true)).toBe(".mp4");
    });

    it("keeps the original video extension when copying without watermark", () => {
        expect(getOutputExtension("clip.webm", false)).toBe(".webm");
        expect(getOutputExtension("clip.mkv", false)).toBe(".mkv");
        expect(getOutputExtension("clip.mov", false)).toBe(".mov");
    });

    it("forces .3gp to .mp4 even when copying without watermark", () => {
        expect(getOutputExtension("clip.3gp", false)).toBe(".mp4");
    });

    it("is case-insensitive for video extensions", () => {
        expect(getOutputExtension("clip.MP4", false)).toBe(".mp4");
        expect(getOutputExtension("clip.3GP", false)).toBe(".mp4");
    });

    it("always keeps GIFs as .gif", () => {
        expect(getOutputExtension("anim.gif", true)).toBe(".gif");
        expect(getOutputExtension("anim.gif", false)).toBe(".gif");
    });

    it("keeps the image extension", () => {
        expect(getOutputExtension("photo.png", true)).toBe(".png");
        expect(getOutputExtension("photo.jpg", true)).toBe(".jpg");
        expect(getOutputExtension("photo.webp", true)).toBe(".webp");
    });

    it("normalizes unsupported image formats to .jpg when watermarking", () => {
        expect(getOutputExtension("photo.avif", true)).toBe(".jpg");
        expect(getOutputExtension("photo.bmp", true)).toBe(".jpg");
        expect(getOutputExtension("photo.tiff", true)).toBe(".jpg");
        expect(getOutputExtension("photo.TIFF", true)).toBe(".jpg");
    });

    it("keeps the original extension of unsupported images when copying without watermark", () => {
        expect(getOutputExtension("photo.avif", false)).toBe(".avif");
        expect(getOutputExtension("photo.bmp", false)).toBe(".bmp");
        expect(getOutputExtension("photo.tiff", false)).toBe(".tiff");
    });

    it("falls back to .png for extensionless files", () => {
        expect(getOutputExtension("noext", true)).toBe(".png");
    });
});

describe("isUnsupportedImage", () => {
    it.each([
        ["photo.avif", true],
        ["photo.bmp", true],
        ["photo.tiff", true],
        ["photo.TIFf", true],
        ["photo.png", false],
        ["photo.jpg", false],
        ["photo.webp", false],
        ["photo.gif", false],
        ["photo.mp4", false],
    ])("detects %s as %s", (name, expected) => {
        expect(isUnsupportedImage(name)).toBe(expected);
    });
});

describe("isForcedMp4Video", () => {
    it.each([
        ["clip.3gp", true],
        ["clip.3GP", true],
        ["clip.mp4", false],
        ["clip.webm", false],
        ["clip.mkv", false],
        ["clip.gif", false],
        ["photo.png", false],
    ])("detects %s as %s", (name, expected) => {
        expect(isForcedMp4Video(name)).toBe(expected);
    });
});

describe("readDirectory", () => {
    it("returns the entries of an existing directory", () => {
        writeFileSync(join(tmpDir, "a.txt"), "");
        writeFileSync(join(tmpDir, "b.txt"), "");
        expect(readDirectory(tmpDir).sort()).toEqual(["a.txt", "b.txt"]);
    });

    it("returns an empty array for a missing directory", () => {
        expect(readDirectory(join(tmpDir, "missing"))).toEqual([]);
    });
});

describe("getFileStats", () => {
    it("returns stats for an existing file", () => {
        writeFileSync(join(tmpDir, "a.txt"), "hello");
        const stats = getFileStats(join(tmpDir, "a.txt"));
        expect(stats).not.toBeNull();
        expect(stats?.isFile()).toBe(true);
        expect(stats?.size).toBe(5);
    });

    it("returns null for a missing file", () => {
        expect(getFileStats(join(tmpDir, "missing.txt"))).toBeNull();
    });
});

describe("deleteFile", () => {
    it("deletes an existing file and reports success", () => {
        writeFileSync(join(tmpDir, "a.txt"), "");
        expect(deleteFile(join(tmpDir, "a.txt"))).toBe(true);
        expect(existsSync(join(tmpDir, "a.txt"))).toBe(false);
    });

    it("returns false for a missing file", () => {
        expect(deleteFile(join(tmpDir, "missing.txt"))).toBe(false);
    });
});

describe("moveFile", () => {
    it("moves a file to the target path", () => {
        writeFileSync(join(tmpDir, "src.txt"), "content");
        const target = join(tmpDir, "sub", "dest.txt");
        expect(moveFile(join(tmpDir, "src.txt"), target)).toBe(true);
        expect(existsSync(target)).toBe(true);
        expect(existsSync(join(tmpDir, "src.txt"))).toBe(false);
    });

    it("creates missing parent directories", () => {
        writeFileSync(join(tmpDir, "src.txt"), "content");
        expect(moveFile(join(tmpDir, "src.txt"), join(tmpDir, "a", "b", "dest.txt"))).toBe(true);
        expect(existsSync(join(tmpDir, "a", "b", "dest.txt"))).toBe(true);
    });

    it("avoids overwriting an existing target by adding a timestamp suffix", () => {
        writeFileSync(join(tmpDir, "src.txt"), "new");
        const target = join(tmpDir, "dest.txt");
        writeFileSync(target, "old");
        expect(moveFile(join(tmpDir, "src.txt"), target)).toBe(true);
        expect(existsSync(join(tmpDir, "src.txt"))).toBe(false);
        const entries = readdirSync(tmpDir).filter((e) => e !== "dest.txt");
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatch(/^dest_\d+\.txt$/);
    });
});

describe("replaceFile", () => {
    it("overwrites an existing target", () => {
        writeFileSync(join(tmpDir, "src.txt"), "new");
        writeFileSync(join(tmpDir, "dest.txt"), "old");
        expect(replaceFile(join(tmpDir, "src.txt"), join(tmpDir, "dest.txt"))).toBe(true);
        expect(existsSync(join(tmpDir, "src.txt"))).toBe(false);
        expect(readFileSync(join(tmpDir, "dest.txt"), "utf-8")).toBe("new");
    });

    it("moves when the target does not exist", () => {
        writeFileSync(join(tmpDir, "src.txt"), "new");
        expect(replaceFile(join(tmpDir, "src.txt"), join(tmpDir, "dest.txt"))).toBe(true);
        expect(readFileSync(join(tmpDir, "dest.txt"), "utf-8")).toBe("new");
    });
});

describe("ensureDirectory", () => {
    it("creates nested directories", () => {
        const target = join(tmpDir, "nested", "deep");
        expect(ensureDirectory(target)).toBe(true);
        expect(existsSync(target)).toBe(true);
    });

    it("returns true when the directory already exists", () => {
        expect(ensureDirectory(tmpDir)).toBe(true);
    });
});

describe("generateUuidName", () => {
    it("returns a UUID-based name with the extension when no prefix is set", () => {
        expect(generateUuidName(".png")).toMatch(/^[0-9a-f-]{36}\.png$/);
    });

    it.each([
        ["grub", "grub"],
        ["grub_", "grub"],
        ["_grub_", "grub"],
        ["grub__", "grub"],
        ["grub v2", "grub_v2"],
        ["grub__  v2!", "grub_v2!"],
        ["  ", ""],
    ])("normalises the MEDIA_NAME_PREFIX %j to %j", async (prefix, expected) => {
        vi.stubEnv("MEDIA_NAME_PREFIX", prefix);
        vi.resetModules();
        const { generateUuidName: freshGenerate } = await import("./files.ts");
        const name = freshGenerate(".png");
        if (expected === "") {
            expect(name).toMatch(/^[0-9a-f-]{36}\.png$/);
        } else {
            expect(name).toMatch(new RegExp(`^${expected}_[0-9a-f-]{36}\\.png$`));
        }
    });
});
