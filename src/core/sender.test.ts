import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordAPIError, RateLimitError } from "@discordjs/rest";
import type { GuildTextBasedChannel } from "discord.js";

import { markAsSent, sendFile, hasBeenSent } from "./sender.ts";

let tmpDir: string;
let filePath: string;

beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "grub-sender-"));
    filePath = join(tmpDir, "clip.mp4");
    writeFileSync(filePath, Buffer.alloc(1024, 1));
});

afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.useRealTimers();
});

function mockChannel(): { send: ReturnType<typeof vi.fn> } {
    return { send: vi.fn() };
}

function asChannel(channel: { send: ReturnType<typeof vi.fn> }): GuildTextBasedChannel {
    return channel as unknown as GuildTextBasedChannel;
}

function networkError(code: string): Error & { code: string } {
    return Object.assign(new Error("socket hang up"), { code });
}

describe("sendFile", () => {
    it("sends the file and reports success", async () => {
        const channel = mockChannel();
        channel.send.mockResolvedValue({ id: "msg-1" });

        const result = await sendFile(asChannel(channel), filePath, "clip.mp4", "111");

        expect(result).toEqual({ success: true });
        expect(channel.send).toHaveBeenCalledTimes(1);
        expect(channel.send).toHaveBeenCalledWith({
            files: [{ attachment: filePath, name: "clip.mp4" }],
        });
    });

    it("uses the attachmentName override while keeping the original dedup key", async () => {
        const channel = mockChannel();
        channel.send.mockResolvedValue({ id: "msg-1" });

        // clip.3gp was transcoded to a real mp4: the attachment must carry the
        // output extension so Discord renders it as a video.
        const result = await sendFile(
            asChannel(channel),
            filePath,
            "clip.3gp",
            "111",
            undefined,
            "clip.mp4"
        );

        expect(result).toEqual({ success: true });
        expect(channel.send).toHaveBeenCalledWith({
            files: [{ attachment: filePath, name: "clip.mp4" }],
        });
        // The dedup registry still keys on the original file name.
        expect(hasBeenSent("111:clip.3gp")).toBe(true);
    });

    it("does not send the same channel+file combination twice", async () => {
        const channel = mockChannel();
        channel.send.mockResolvedValue({ id: "msg-1" });

        await sendFile(asChannel(channel), filePath, "clip.mp4", "222");
        const second = await sendFile(asChannel(channel), filePath, "clip.mp4", "222");

        expect(second).toEqual({ success: false, reason: "duplicate" });
        expect(channel.send).toHaveBeenCalledTimes(1);
    });

    it("reports duplicate even when markAsSent was set externally", async () => {
        const channel = mockChannel();
        markAsSent("333:already.mp4");
        const result = await sendFile(asChannel(channel), filePath, "already.mp4", "333");
        expect(result).toEqual({ success: false, reason: "duplicate" });
        expect(channel.send).not.toHaveBeenCalled();
    });

    it("retries transient network errors and then succeeds", async () => {
        vi.useFakeTimers();
        try {
            const channel = mockChannel();
            channel.send
                .mockRejectedValueOnce(networkError("ECONNRESET"))
                .mockResolvedValueOnce({ id: "msg-2" });

            const promise = sendFile(asChannel(channel), filePath, "clip.mp4", "444");
            await vi.advanceTimersByTimeAsync(10_000);
            const result = await promise;

            expect(result).toEqual({ success: true });
            expect(channel.send).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it("retries on Discord 429 rate limits using the retry window", async () => {
        vi.useFakeTimers();
        try {
            const channel = mockChannel();
            const rateLimited = Object.assign(Object.create(DiscordAPIError.prototype), {
                status: 429,
                message: "rate limited",
            });
            channel.send.mockRejectedValueOnce(rateLimited).mockResolvedValueOnce({ id: "msg-3" });

            const promise = sendFile(asChannel(channel), filePath, "clip.mp4", "555");
            await vi.advanceTimersByTimeAsync(40_000);
            const result = await promise;

            expect(result).toEqual({ success: true });
            expect(channel.send).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it("honours the retryAfter from a RateLimitError", async () => {
        vi.useFakeTimers();
        try {
            const channel = mockChannel();
            const rateLimited = Object.assign(Object.create(RateLimitError.prototype), {
                retryAfter: 1000,
            });
            channel.send.mockRejectedValueOnce(rateLimited).mockResolvedValueOnce({ id: "msg-4" });

            const promise = sendFile(asChannel(channel), filePath, "clip.mp4", "666");
            await vi.advanceTimersByTimeAsync(3000);
            const result = await promise;

            expect(result).toEqual({ success: true });
            expect(channel.send).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it("gives up after exhausting the retries", async () => {
        vi.useFakeTimers();
        try {
            const channel = mockChannel();
            channel.send.mockRejectedValue(networkError("ETIMEDOUT"));

            const promise = sendFile(asChannel(channel), filePath, "clip.mp4", "777");
            // 3 retries, each backing off up to 30s
            await vi.advanceTimersByTimeAsync(120_000);
            const result = await promise;

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.reason).toBe("error");
            }
            expect(channel.send).toHaveBeenCalledTimes(4); // initial + 3 retries
        } finally {
            vi.useRealTimers();
        }
    });

    it("fails fast on non-retryable errors", async () => {
        const channel = mockChannel();
        channel.send.mockRejectedValue(new Error("403 forbidden"));

        const result = await sendFile(asChannel(channel), filePath, "clip.mp4", "888");

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.reason).toBe("error");
        }
        expect(channel.send).toHaveBeenCalledTimes(1);
    });
});

describe("sendFile with a small size limit", () => {
    it("returns too_large when the file exceeds the limit", async () => {
        vi.stubEnv("MAX_FILE_SIZE_MB", "0.001");
        vi.resetModules();
        const fresh = await import("./sender.ts");

        writeFileSync(filePath, Buffer.alloc(2000, 1));
        const channel = mockChannel();
        const result = await fresh.sendFile(asChannel(channel), filePath, "clip.mp4", "999");

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.reason).toBe("too_large");
        }
        expect(channel.send).not.toHaveBeenCalled();
    });
});
