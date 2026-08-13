import { describe, expect, it, vi } from "vitest";

const { mockRunCommand } = vi.hoisted(() => ({
    mockRunCommand: vi.fn(),
}));

vi.mock("./process.ts", () => ({
    runCommand: mockRunCommand,
}));

// Import after the mock so the module under test picks up the hoisted mock.
import { checkFfmpeg, ensureFfmpeg } from "./validators.ts";

function makeResolver(success: boolean) {
    mockRunCommand.mockReset();
    mockRunCommand.mockImplementation(() =>
        success ? Promise.resolve({ stdout: "", stderr: "" }) : Promise.reject(new Error("ENOENT"))
    );
    return mockRunCommand;
}

describe("validators", () => {
    it("checkFfmpeg returns true when both ffmpeg and ffprobe run successfully", async () => {
        const runCommand = makeResolver(true);
        await expect(checkFfmpeg()).resolves.toBe(true);
        // ffmpeg + ffprobe
        expect(runCommand).toHaveBeenCalledTimes(2);
    });

    it("checkFfmpeg returns false when ffmpeg is unavailable", async () => {
        const runCommand = makeResolver(false);
        await expect(checkFfmpeg()).resolves.toBe(false);
        expect(runCommand).toHaveBeenCalledTimes(1);
    });

    it("ensureFfmpeg caches the check for the whole process", async () => {
        const runCommand = makeResolver(true);
        await expect(ensureFfmpeg()).resolves.toBe(true);
        await expect(ensureFfmpeg()).resolves.toBe(true);
        await expect(ensureFfmpeg()).resolves.toBe(true);
        // Only ffmpeg + ffprobe once, not per call
        expect(runCommand).toHaveBeenCalledTimes(2);
        expect(runCommand.mock.calls.map((c) => c[0].command)).toEqual(["ffmpeg", "ffprobe"]);
    });
});
