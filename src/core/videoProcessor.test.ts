import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EncoderInfo } from "../utils/encoder.ts";
import type * as ProcessModule from "../utils/process.ts";

// runCommand is mocked so no real ffmpeg is ever spawned, but the real
// ProcessError / TimeoutError classes are kept so the stderr classification
// in videoProcessor can be exercised.
vi.mock("../utils/process.ts", async (importOriginal) => {
    const actual = await importOriginal<typeof ProcessModule>();
    return {
        ...actual,
        runCommand: vi.fn(),
    };
});

vi.mock("../utils/encoder.ts", () => ({
    getEncoderInfo: vi.fn(),
    softwareEncoder: vi.fn(),
}));

// Silence the progress bar so tests produce no \r noise.
vi.mock("../utils/progress.ts", () => ({
    createProgressTracker: vi.fn(() => ({
        update: vi.fn(),
        complete: vi.fn(),
        fail: vi.fn(),
    })),
}));

import { getEncoderInfo, softwareEncoder } from "../utils/encoder.ts";
import { ProcessError, runCommand, TimeoutError } from "../utils/process.ts";
import { applyVideoWatermark } from "./videoProcessor.ts";

const mockRunCommand = vi.mocked(runCommand);
const mockGetEncoderInfo = vi.mocked(getEncoderInfo);
const mockSoftwareEncoder = vi.mocked(softwareEncoder);

const LIBX264: EncoderInfo = {
    backend: "libx264",
    initArgs: [],
    filterTail: "",
    outLabel: "v",
    encoderArgs: (crf, preset) => ["-c:v", "libx264", "-crf", String(crf), "-preset", preset],
};

const QSV: EncoderInfo = {
    backend: "qsv",
    initArgs: ["-init_hw_device", "qsv=hw", "-filter_hw_device", "hw"],
    filterTail: ";[v]format=nv12,hwupload[vhw]",
    outLabel: "vhw",
    encoderArgs: (crf, preset) => [
        "-c:v",
        "h264_qsv",
        "-global_quality",
        String(crf),
        "-preset",
        preset,
    ],
};

const AUDIO_REMUX_ERROR =
    "Could not find tag for codec opus in stream #1, codec not currently supported in container";
const VIDEO_ENCODE_ERROR =
    "Error initializing output stream 0:0 -- Error while opening encoder for output stream #0:0";

function ffmpegError(stderr: string): ProcessError {
    return new ProcessError("clip.mp4", 1, stderr);
}

function argsOf(callIndex: number): string[] {
    return mockRunCommand.mock.calls[callIndex][0].args;
}

function joinedArgs(callIndex: number): string {
    return argsOf(callIndex).join(" ");
}

const LOGO = "/logo.webp";
const INPUT = "/in/clip.webm";
const OUTPUT = "/tmp/clip.mp4";

beforeEach(() => {
    mockRunCommand.mockReset();
    mockGetEncoderInfo.mockReset();
    mockSoftwareEncoder.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("applyVideoWatermark fallback classification", () => {
    it("retries with AAC when the software copy fails on an audio-remux error", async () => {
        mockGetEncoderInfo.mockResolvedValue(LIBX264);
        mockRunCommand
            .mockRejectedValueOnce(ffmpegError(AUDIO_REMUX_ERROR))
            .mockResolvedValueOnce({ stdout: "", stderr: "" });

        await expect(applyVideoWatermark(LOGO, INPUT, OUTPUT, 100, 10)).resolves.toBeUndefined();

        expect(mockRunCommand).toHaveBeenCalledTimes(2);
        expect(joinedArgs(0)).toContain("-c:a copy");
        expect(joinedArgs(1)).toContain("-c:a aac -b:a 192k");
        // Same (software) encoder, only the audio changes.
        expect(joinedArgs(1)).toContain("-c:v libx264");
    });

    it("retries with libx264 when a hardware encoder fails on a video error", async () => {
        mockGetEncoderInfo.mockResolvedValue(QSV);
        mockSoftwareEncoder.mockReturnValue(LIBX264);
        mockRunCommand
            .mockRejectedValueOnce(ffmpegError(VIDEO_ENCODE_ERROR))
            .mockResolvedValueOnce({ stdout: "", stderr: "" });

        await expect(applyVideoWatermark(LOGO, INPUT, OUTPUT, 100, 10)).resolves.toBeUndefined();

        expect(mockRunCommand).toHaveBeenCalledTimes(2);
        expect(joinedArgs(0)).toContain("-c:v h264_qsv");
        expect(joinedArgs(1)).toContain("-c:v libx264");
        // No misleading AAC retry on a video failure: the retry keeps copy.
        expect(joinedArgs(1)).toContain("-c:a copy");
    });

    it("keeps the hardware encoder and re-encodes audio to AAC on an audio error", async () => {
        mockGetEncoderInfo.mockResolvedValue(QSV);
        mockRunCommand
            .mockRejectedValueOnce(ffmpegError(AUDIO_REMUX_ERROR))
            .mockResolvedValueOnce({ stdout: "", stderr: "" });

        await expect(applyVideoWatermark(LOGO, INPUT, OUTPUT, 100, 10)).resolves.toBeUndefined();

        expect(mockRunCommand).toHaveBeenCalledTimes(2);
        expect(joinedArgs(0)).toContain("-c:v h264_qsv");
        expect(joinedArgs(1)).toContain("-c:v h264_qsv");
        expect(joinedArgs(1)).toContain("-c:a aac -b:a 192k");
        // The software fallback was never needed.
        expect(mockSoftwareEncoder).not.toHaveBeenCalled();
    });

    it("propagates a genuine software video-encode failure without an AAC retry", async () => {
        mockGetEncoderInfo.mockResolvedValue(LIBX264);
        mockRunCommand.mockRejectedValue(ffmpegError(VIDEO_ENCODE_ERROR));

        await expect(applyVideoWatermark(LOGO, INPUT, OUTPUT, 100, 10)).rejects.toBeInstanceOf(
            ProcessError
        );

        // One attempt only: the failure was video, AAC cannot fix it.
        expect(mockRunCommand).toHaveBeenCalledTimes(1);
        expect(joinedArgs(0)).toContain("-c:a copy");
    });

    it("never retries a timeout", async () => {
        mockGetEncoderInfo.mockResolvedValue(LIBX264);
        mockRunCommand.mockRejectedValue(new TimeoutError("clip.mp4"));

        await expect(applyVideoWatermark(LOGO, INPUT, OUTPUT, 100, 10)).rejects.toBeInstanceOf(
            TimeoutError
        );

        expect(mockRunCommand).toHaveBeenCalledTimes(1);
    });

    it("walks hardware-copy → hardware-aac → software-aac when audio fails on both", async () => {
        mockGetEncoderInfo.mockResolvedValue(QSV);
        mockSoftwareEncoder.mockReturnValue(LIBX264);
        mockRunCommand
            .mockRejectedValueOnce(ffmpegError(AUDIO_REMUX_ERROR))
            .mockRejectedValueOnce(
                ffmpegError(
                    "Error while opening encoder for output stream #0:1 - maybe incorrect parameters"
                )
            )
            .mockResolvedValueOnce({ stdout: "", stderr: "" });

        await expect(applyVideoWatermark(LOGO, INPUT, OUTPUT, 100, 10)).resolves.toBeUndefined();

        expect(mockRunCommand).toHaveBeenCalledTimes(3);
        expect(joinedArgs(0)).toContain("-c:v h264_qsv");
        expect(joinedArgs(0)).toContain("-c:a copy");
        expect(joinedArgs(1)).toContain("-c:v h264_qsv");
        expect(joinedArgs(1)).toContain("-c:a aac");
        expect(joinedArgs(2)).toContain("-c:v libx264");
        expect(joinedArgs(2)).toContain("-c:a aac -b:a 192k");
    });

    it("walks hardware-copy(video fail) → software-copy(audio fail) → software-aac", async () => {
        mockGetEncoderInfo.mockResolvedValue(QSV);
        mockSoftwareEncoder.mockReturnValue(LIBX264);
        mockRunCommand
            .mockRejectedValueOnce(ffmpegError(VIDEO_ENCODE_ERROR))
            .mockRejectedValueOnce(ffmpegError(AUDIO_REMUX_ERROR))
            .mockResolvedValueOnce({ stdout: "", stderr: "" });

        await expect(applyVideoWatermark(LOGO, INPUT, OUTPUT, 100, 10)).resolves.toBeUndefined();

        expect(mockRunCommand).toHaveBeenCalledTimes(3);
        expect(joinedArgs(0)).toContain("-c:v h264_qsv");
        expect(joinedArgs(0)).toContain("-c:a copy");
        expect(joinedArgs(1)).toContain("-c:v libx264");
        expect(joinedArgs(1)).toContain("-c:a copy");
        expect(joinedArgs(2)).toContain("-c:v libx264");
        expect(joinedArgs(2)).toContain("-c:a aac -b:a 192k");
    });
});
