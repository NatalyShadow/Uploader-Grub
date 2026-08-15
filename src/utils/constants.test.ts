import { describe, expect, it } from "vitest";

import { GIF_FFMPEG_TIMEOUT_MS, gifFfmpegTimeoutMs } from "./constants.ts";

describe("gifFfmpegTimeoutMs", () => {
    it("keeps the fixed 60s base when the duration is unknown (0)", () => {
        expect(gifFfmpegTimeoutMs(0)).toBe(GIF_FFMPEG_TIMEOUT_MS);
        expect(gifFfmpegTimeoutMs(NaN)).toBe(GIF_FFMPEG_TIMEOUT_MS);
    });

    it("scales with the GIF duration (3s budget per second + 60s headroom)", () => {
        expect(gifFfmpegTimeoutMs(10)).toBe(10 * 1000 * 3 + 60_000);
        expect(gifFfmpegTimeoutMs(60)).toBe(60 * 1000 * 3 + 60_000);
    });

    it("never drops below the fixed base", () => {
        expect(gifFfmpegTimeoutMs(0.1)).toBe(60_300);
        expect(gifFfmpegTimeoutMs(1)).toBe(63_000);
    });

    it("caps at 6 hours like the video timeout", () => {
        expect(gifFfmpegTimeoutMs(100_000)).toBe(6 * 60 * 60 * 1000);
        expect(gifFfmpegTimeoutMs(10_000)).toBe(6 * 60 * 60 * 1000);
    });
});
