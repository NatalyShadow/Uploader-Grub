import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "./loader.ts";

let tmpDir: string;

beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "grub-config-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
});

afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
});

function writeConfig(entries: unknown): void {
    writeFileSync(join(tmpDir, "config.json"), JSON.stringify(entries));
}

function mockExit(): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("exit called");
    });
}

describe("loadConfig", () => {
    it("loads valid entries", () => {
        writeConfig([
            { path: "/media/vanilla/videos", channelId: "111" },
            { path: "/media/vanilla/images", channelId: "222" },
        ]);
        expect(loadConfig()).toEqual([
            { path: "/media/vanilla/videos", channelId: "111" },
            { path: "/media/vanilla/images", channelId: "222" },
        ]);
    });

    it("expands environment variables in paths", () => {
        vi.stubEnv("MEDIA_HOME", "/data");
        writeConfig([{ path: "$MEDIA_HOME/videos", channelId: "111" }]);
        expect(loadConfig()).toEqual([{ path: "/data/videos", channelId: "111" }]);
    });

    it("skips entries without a valid path", () => {
        writeConfig([
            { channelId: "111" },
            { path: "  ", channelId: "111" },
            { path: "/ok", channelId: "222" },
        ]);
        expect(loadConfig()).toEqual([{ path: "/ok", channelId: "222" }]);
    });

    it("skips entries without a valid channelId", () => {
        writeConfig([{ path: "/media/videos" }, { path: "/ok", channelId: "222" }]);
        expect(loadConfig()).toEqual([{ path: "/ok", channelId: "222" }]);
    });

    it("exits when config.json is missing", () => {
        const exitSpy = mockExit();
        expect(() => loadConfig()).toThrow("exit called");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits on invalid JSON", () => {
        writeFileSync(join(tmpDir, "config.json"), "{ not json");
        const exitSpy = mockExit();
        expect(() => loadConfig()).toThrow("exit called");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits when the JSON root is not an array", () => {
        writeConfig({ path: "/media", channelId: "1" });
        const exitSpy = mockExit();
        expect(() => loadConfig()).toThrow("exit called");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits when no valid entries remain", () => {
        writeConfig([{ path: "", channelId: "" }]);
        const exitSpy = mockExit();
        expect(() => loadConfig()).toThrow("exit called");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});
