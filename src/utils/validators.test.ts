import { describe, expect, it, vi } from "vitest";

const { mockRunCommand } = vi.hoisted(() => ({
    mockRunCommand: vi.fn(),
}));

vi.mock("./process.ts", () => ({
    runCommand: mockRunCommand,
}));

// Import after the mock so the module under test picks up the hoisted mock.
import { checkFfmpeg } from "./validators.ts";

function makeResolver(success: boolean) {
    mockRunCommand.mockReset();
    mockRunCommand.mockImplementation(() =>
        success ? Promise.resolve({ stdout: "", stderr: "" }) : Promise.reject(new Error("ENOENT"))
    );
    return mockRunCommand;
}

// ensureFfmpeg keeps module-level cache state, so tests that exercise it need
// a fresh module instance (vi.resetModules keeps the hoisted mock in place).
async function freshValidators() {
    vi.resetModules();
    return await import("./validators.ts");
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

    it("ensureFfmpeg caches the check for the whole process once it succeeds", async () => {
        const runCommand = makeResolver(true);
        const { ensureFfmpeg } = await freshValidators();
        await expect(ensureFfmpeg()).resolves.toBe(true);
        await expect(ensureFfmpeg()).resolves.toBe(true);
        await expect(ensureFfmpeg()).resolves.toBe(true);
        // Only ffmpeg + ffprobe once, not per call
        expect(runCommand).toHaveBeenCalledTimes(2);
        expect(runCommand.mock.calls.map((c) => c[0].command)).toEqual(["ffmpeg", "ffprobe"]);
    });

    it("ensureFfmpeg retries the check after a negative result", async () => {
        mockRunCommand.mockReset();
        mockRunCommand
            // First attempt: ffmpeg missing → false
            .mockRejectedValueOnce(new Error("ENOENT"))
            // Retry: ffmpeg + ffprobe both available → true
            .mockResolvedValueOnce({ stdout: "", stderr: "" })
            .mockResolvedValueOnce({ stdout: "", stderr: "" });

        const { ensureFfmpeg } = await freshValidators();

        await expect(ensureFfmpeg()).resolves.toBe(false);
        await expect(ensureFfmpeg()).resolves.toBe(true);

        // ffmpeg (failed), then ffmpeg + ffprobe (retry)
        expect(mockRunCommand).toHaveBeenCalledTimes(3);
        expect(mockRunCommand.mock.calls.map((c) => c[0].command)).toEqual([
            "ffmpeg",
            "ffmpeg",
            "ffprobe",
        ]);
    });
});
