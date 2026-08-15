import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { organizeFiles } from "./organizer.ts";

let tmpDir: string;

beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "grub-organizer-"));
});

afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
});

function touch(name: string): string {
    const filePath = join(tmpDir, name);
    writeFileSync(filePath, "x");
    return filePath;
}

describe("organizeFiles", () => {
    it("moves images to images/", () => {
        touch("a.png");
        const stats = organizeFiles(tmpDir);
        expect(stats.moved).toBe(1);
        expect(stats.errors).toBe(0);
        expect(readdirSync(join(tmpDir, "images"))).toHaveLength(1);
    });

    it("moves videos to videos/", () => {
        touch("b.mp4");
        const stats = organizeFiles(tmpDir);
        expect(stats.moved).toBe(1);
        expect(readdirSync(join(tmpDir, "videos"))).toHaveLength(1);
    });

    it("moves 3gp videos to videos/", () => {
        touch("g.3gp");
        const stats = organizeFiles(tmpDir);
        expect(stats.moved).toBe(1);
        expect(readdirSync(join(tmpDir, "videos"))).toHaveLength(1);
    });

    it("moves GIFs to images/", () => {
        touch("c.gif");
        const stats = organizeFiles(tmpDir);
        expect(stats.moved).toBe(1);
        expect(readdirSync(join(tmpDir, "images"))).toHaveLength(1);
    });

    it("is case-insensitive for extensions", () => {
        touch("d.JPG");
        touch("e.WEBM");
        const stats = organizeFiles(tmpDir);
        expect(stats.moved).toBe(2);
    });

    it("skips unsupported extensions", () => {
        touch("notes.txt");
        const stats = organizeFiles(tmpDir);
        expect(stats.moved).toBe(0);
        expect(stats.skipped).toBe(1);
    });

    it("renames files with a UUID", () => {
        touch("f.png");
        organizeFiles(tmpDir);
        const name = readdirSync(join(tmpDir, "images"))[0];
        expect(name).toMatch(/^[0-9a-f-]{36}\.png$/);
    });

    it("does not move directories", () => {
        mkdirSync(join(tmpDir, "subdir"));
        writeFileSync(join(tmpDir, "subdir", "inside.png"), "x");
        const stats = organizeFiles(tmpDir);
        expect(stats.moved).toBe(0);
    });

    it("returns an error count when the folder cannot be read", () => {
        const stats = organizeFiles(join(tmpDir, "missing"));
        expect(stats.errors).toBe(1);
        expect(stats.moved).toBe(0);
    });
});

describe("organizeFiles with a small size limit", () => {
    it("routes oversized files to heavy/", async () => {
        vi.stubEnv("MAX_FILE_SIZE_MB", "0.001");
        vi.resetModules();
        const fresh = await import("./organizer.ts");

        writeFileSync(join(tmpDir, "big.mp4"), Buffer.alloc(2000, 1));
        const stats = fresh.organizeFiles(tmpDir);

        expect(stats.moved).toBe(1);
        expect(stats.heavy).toBe(1);
        expect(readdirSync(join(tmpDir, "heavy"))).toHaveLength(1);
    });

    it("keeps small files in their normal folder", async () => {
        vi.stubEnv("MAX_FILE_SIZE_MB", "0.001");
        vi.resetModules();
        const fresh = await import("./organizer.ts");

        writeFileSync(join(tmpDir, "small.png"), "tiny");
        const stats = fresh.organizeFiles(tmpDir);

        expect(stats.moved).toBe(1);
        expect(stats.heavy).toBe(0);
        expect(readdirSync(join(tmpDir, "images"))).toHaveLength(1);
    });
});
