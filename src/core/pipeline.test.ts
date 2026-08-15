import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client, GuildTextBasedChannel } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigEntry } from "../types/index.ts";
import { ensureFfmpeg } from "../utils/validators.ts";
import { runPipeline } from "./pipeline.ts";

vi.mock("./channel.ts", () => ({
    resolveChannel: vi.fn(),
}));

vi.mock("./sender.ts", () => ({
    sendFile: vi.fn(),
}));

vi.mock("../utils/validators.ts", () => ({
    ensureFfmpeg: vi.fn(),
}));

// Unit isolation: never touch ffmpeg/ffprobe or encode anything for real.
vi.mock("../utils/ffprobe.ts", () => ({
    getVideoDimensions: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
    getVideoDuration: vi.fn().mockResolvedValue(1),
}));

vi.mock("./videoProcessor.ts", () => ({
    applyVideoWatermark: vi.fn().mockResolvedValue(undefined),
}));

const mockResolveChannel = vi.mocked((await import("./channel.ts")).resolveChannel);
const mockSendFile = vi.mocked((await import("./sender.ts")).sendFile);

let root: string;
let mediaDir: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "grub-pipeline-"));
    mediaDir = join(root, "videos");
    mkdirSync(mediaDir, { recursive: true });
    mockResolveChannel.mockReset();
    mockSendFile.mockReset();
    vi.mocked(ensureFfmpeg).mockReset();
    vi.mocked(ensureFfmpeg).mockResolvedValue(true);
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

function configFor(): ConfigEntry[] {
    return [{ path: mediaDir, channelId: "123" }];
}

function fakeChannel(): GuildTextBasedChannel {
    return { id: "123", send: vi.fn() } as unknown as GuildTextBasedChannel;
}

describe("runPipeline skip-watermark forced conversion guard", () => {
    it("skips .3gp conversion (no quarantine) when ffmpeg is unavailable", async () => {
        writeFileSync(join(mediaDir, "clip.3gp"), "x");
        mockResolveChannel.mockResolvedValue(fakeChannel());
        vi.mocked(ensureFfmpeg).mockResolvedValue(false);

        await runPipeline({} as Client, configFor(), "/logo.webp", {
            skipWatermark: true,
            moveSent: false,
        });

        // The file stays where it is, NOT quarantined into _failed/ or deleted,
        // so a later run with ffmpeg installed can still convert it.
        expect(mockSendFile).not.toHaveBeenCalled();
        expect(existsSync(join(mediaDir, "clip.3gp"))).toBe(true);
        expect(existsSync(join(root, "_failed", "clip.3gp"))).toBe(false);
        expect(existsSync(join(root, "_SKIPPED_clip.3gp"))).toBe(false);
    });

    it("still converts .3gp to mp4 when ffmpeg is available", async () => {
        writeFileSync(join(mediaDir, "clip.3gp"), "x");
        mockResolveChannel.mockResolvedValue(fakeChannel());
        mockSendFile.mockResolvedValue({ success: true });
        vi.mocked(ensureFfmpeg).mockResolvedValue(true);

        await runPipeline({} as Client, configFor(), "/logo.webp", {
            skipWatermark: true,
            moveSent: false,
        });

        // ffmpeg present → the forced conversion runs; the file is replaced by
        // the processed temp and the .3gp is gone.
        expect(mockSendFile).toHaveBeenCalledTimes(1);
        expect(existsSync(join(mediaDir, "clip.3gp"))).toBe(false);
    });
});
