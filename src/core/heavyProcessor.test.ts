import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { processHeavyFiles } from "./heavyProcessor.ts";
import { processFile } from "./pipeline.ts";
import { ensureFfmpeg } from "../utils/validators.ts";
import type { ConfigEntry } from "../types/index.ts";

vi.mock("./pipeline.ts", () => ({
    processFile: vi.fn(),
}));

// ensureFfmpeg defaults to available; individual tests flip it to simulate
// a host without ffmpeg.
vi.mock("../utils/validators.ts", () => ({
    ensureFfmpeg: vi.fn(),
}));

let root: string;
let heavyDir: string;
const mockTemps: string[] = [];

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "grub-heavy-"));
    heavyDir = join(root, "heavy");
    mkdirSync(heavyDir, { recursive: true });
    vi.mocked(processFile).mockReset();
    vi.mocked(ensureFfmpeg).mockReset();
    vi.mocked(ensureFfmpeg).mockResolvedValue(true);
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    for (const temp of mockTemps) rmSync(temp, { force: true });
    mockTemps.length = 0;
    vi.unstubAllEnvs();
});

function configForRoot(): ConfigEntry[] {
    // A path inside the root so getUniqueRoots resolves the root itself.
    return [{ path: join(root, "videos"), channelId: "123" }];
}

function putHeavyFile(name: string, size = 100): void {
    writeFileSync(join(heavyDir, name), Buffer.alloc(size, 1));
}

function stubProcessFile(size: number, ext = ".mp4"): void {
    vi.mocked(processFile).mockImplementation(
        (_logoPath: string, _filePath: string, _fileName: string): Promise<string> => {
            const tempPath = join(tmpdir(), `grub-wm-${randomUUID()}${ext}`);
            writeFileSync(tempPath, Buffer.alloc(size, 1));
            mockTemps.push(tempPath);
            return Promise.resolve(tempPath);
        }
    );
}

describe("processHeavyFiles", () => {
    it("handles an empty heavy folder without crashing", async () => {
        await expect(
            processHeavyFiles(configForRoot(), "/logo.webp", { skipWatermark: true })
        ).resolves.toBeUndefined();
    });

    it("ignores files inside subfolders such as _failed/", async () => {
        mkdirSync(join(heavyDir, "_failed"));
        writeFileSync(join(heavyDir, "_failed", "old.mp4"), "x");
        putHeavyFile("clip.mp4");
        stubProcessFile(100);

        await processHeavyFiles(configForRoot(), "/logo.webp", { skipWatermark: false });

        expect(existsSync(join(heavyDir, "_failed", "old.mp4"))).toBe(true);
        expect(vi.mocked(processFile)).toHaveBeenCalledTimes(1);
    });

    it("skips files of unsupported types, leaving them in heavy/", async () => {
        putHeavyFile("notes.txt");

        await processHeavyFiles(configForRoot(), "/logo.webp", { skipWatermark: false });

        expect(existsSync(join(heavyDir, "notes.txt"))).toBe(true);
        expect(vi.mocked(processFile)).not.toHaveBeenCalled();
    });

    describe("skipWatermark mode", () => {
        it("copies a video keeping its original extension", async () => {
            putHeavyFile("clip.webm");

            await processHeavyFiles(configForRoot(), "/logo.webp", { skipWatermark: true });

            expect(existsSync(join(heavyDir, "clip.webm"))).toBe(false);
            expect(existsSync(join(root, "videos", "clip.webm"))).toBe(true);
            expect(vi.mocked(processFile)).not.toHaveBeenCalled();
        });

        it("converts 3gp to mp4 even without a watermark", async () => {
            putHeavyFile("clip.3gp");
            stubProcessFile(100);

            await processHeavyFiles(configForRoot(), "/logo.webp", { skipWatermark: true });

            // Discord cannot play .3gp inline, so skip-watermark copies are
            // still converted (without the logo) and promoted as .mp4.
            expect(vi.mocked(processFile)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(processFile)).toHaveBeenCalledWith(
                "/logo.webp",
                join(heavyDir, "clip.3gp"),
                "clip.3gp",
                false
            );
            expect(existsSync(join(heavyDir, "clip.3gp"))).toBe(false);
            expect(existsSync(join(root, "videos", "clip.mp4"))).toBe(true);
        });

        it("skips 3gp conversion when ffmpeg is missing, keeping the file in heavy/", async () => {
            putHeavyFile("clip.3gp");
            vi.mocked(ensureFfmpeg).mockResolvedValue(false);

            await processHeavyFiles(configForRoot(), "/logo.webp", { skipWatermark: true });

            // Without ffmpeg/ffprobe the forced conversion cannot run; the
            // file stays in heavy/ (NOT quarantined) so a later rerun with
            // ffmpeg installed can still process it.
            expect(vi.mocked(processFile)).not.toHaveBeenCalled();
            expect(existsSync(join(heavyDir, "clip.3gp"))).toBe(true);
            expect(existsSync(join(root, "videos", "clip.mp4"))).toBe(false);
        });

        it("keeps the original extension of unsupported images", async () => {
            putHeavyFile("photo.bmp");

            await processHeavyFiles(configForRoot(), "/logo.webp", { skipWatermark: true });

            expect(existsSync(join(root, "images", "photo.bmp"))).toBe(true);
        });
    });

    describe("watermark mode", () => {
        it("promotes a watermarked video to videos/ as .mp4", async () => {
            putHeavyFile("clip.mkv");
            stubProcessFile(100);

            await processHeavyFiles(configForRoot(), "/logo.webp", { skipWatermark: false });

            expect(vi.mocked(processFile)).toHaveBeenCalledTimes(1);
            expect(existsSync(join(heavyDir, "clip.mkv"))).toBe(false);
            expect(existsSync(join(root, "videos", "clip.mp4"))).toBe(true);
        });

        it("normalizes unsupported image formats to .jpg in images/", async () => {
            putHeavyFile("photo.bmp");
            stubProcessFile(100, ".jpg");

            await processHeavyFiles(configForRoot(), "/logo.webp", { skipWatermark: false });

            expect(existsSync(join(root, "images", "photo.jpg"))).toBe(true);
            expect(readdirSync(join(root, "images"))).toEqual(["photo.jpg"]);
        });

        it("promotes watermarked GIFs to images/ keeping .gif", async () => {
            putHeavyFile("anim.gif");
            stubProcessFile(100, ".gif");

            await processHeavyFiles(configForRoot(), "/logo.webp", { skipWatermark: false });

            expect(existsSync(join(root, "images", "anim.gif"))).toBe(true);
        });

        it("quarantines unprocessable files to heavy/_failed/", async () => {
            putHeavyFile("broken.mp4");
            vi.mocked(processFile).mockRejectedValue(new Error("encode failed"));

            await processHeavyFiles(configForRoot(), "/logo.webp", { skipWatermark: false });

            expect(existsSync(join(heavyDir, "broken.mp4"))).toBe(false);
            expect(existsSync(join(heavyDir, "_failed", "broken.mp4"))).toBe(true);
        });
    });
});

describe("processHeavyFiles with a small size limit", () => {
    it("keeps oversized watermarked copies in heavy/ instead of promoting them", async () => {
        vi.stubEnv("MAX_FILE_SIZE_MB", "0.001");
        vi.resetModules();
        const fresh = await import("./heavyProcessor.ts");
        const freshPipeline = await import("./pipeline.ts");
        const freshProcessFile = vi.mocked(freshPipeline.processFile);

        putHeavyFile("clip.mp4");
        freshProcessFile.mockImplementation(
            (_logoPath: string, _filePath: string, _fileName: string): Promise<string> => {
                const tempPath = join(tmpdir(), `grub-wm-${randomUUID()}.mp4`);
                writeFileSync(tempPath, Buffer.alloc(2000, 1));
                mockTemps.push(tempPath);
                return Promise.resolve(tempPath);
            }
        );

        await fresh.processHeavyFiles(configForRoot(), "/logo.webp", { skipWatermark: false });

        // Oversized: never promoted to videos/, but the watermarked copy
        // replaces the original inside heavy/.
        expect(existsSync(join(root, "videos", "clip.mp4"))).toBe(false);
        expect(existsSync(join(heavyDir, "clip.mp4"))).toBe(true);
    });

    it("keeps oversized skip-watermark copies in heavy/", async () => {
        vi.stubEnv("MAX_FILE_SIZE_MB", "0.001");
        vi.resetModules();
        const fresh = await import("./heavyProcessor.ts");

        // Files land in heavy/ because they exceed the limit; a byte-for-byte
        // copy keeps the same size, so it must stay in heavy/.
        putHeavyFile("clip.mp4", 2000);

        await fresh.processHeavyFiles(configForRoot(), "/logo.webp", { skipWatermark: true });

        expect(existsSync(join(root, "videos", "clip.mp4"))).toBe(false);
        expect(existsSync(join(heavyDir, "clip.mp4"))).toBe(true);
    });

    it("keeps oversized 3gp files converted as .mp4, never as .3gp", async () => {
        vi.stubEnv("MAX_FILE_SIZE_MB", "0.001");
        vi.resetModules();
        const fresh = await import("./heavyProcessor.ts");
        const freshPipeline = await import("./pipeline.ts");
        const freshProcessFile = vi.mocked(freshPipeline.processFile);

        putHeavyFile("clip.3gp");
        freshProcessFile.mockImplementation(
            (_logoPath: string, _filePath: string, _fileName: string): Promise<string> => {
                const tempPath = join(tmpdir(), `grub-wm-${randomUUID()}.mp4`);
                writeFileSync(tempPath, Buffer.alloc(2000, 1));
                mockTemps.push(tempPath);
                return Promise.resolve(tempPath);
            }
        );

        await fresh.processHeavyFiles(configForRoot(), "/logo.webp", { skipWatermark: false });

        // Oversized: never promoted to videos/, but the conversion ran anyway
        // and the processed copy replaces the .3gp under the .mp4 name — the
        // file must never be left behind as a .3gp container.
        expect(existsSync(join(root, "videos", "clip.mp4"))).toBe(false);
        expect(existsSync(join(heavyDir, "clip.mp4"))).toBe(true);
        expect(existsSync(join(heavyDir, "clip.3gp"))).toBe(false);
    });
});
