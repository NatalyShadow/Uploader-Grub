import { spawn } from "child_process";
import { existsSync } from "fs";
import { VIDEO_ENCODER, VIDEO_FFMPEG_THREADS } from "./constants.ts";

export type EncoderBackend = "qsv" | "vaapi" | "nvenc" | "amf" | "libx264";

export interface EncoderInfo {
    backend: EncoderBackend;
    /**
     * Global ffmpeg args that initialise the hardware device. They must
     * appear before the input files (empty for software encoding).
     */
    initArgs: string[];
    /**
     * Tail appended to the filter_complex to prepare frames for the encoder
     * (e.g. `;[v]format=nv12,hwupload[vhw]`). Empty for software encoding.
     */
    filterTail: string;
    /** Label produced by the filter graph that the encoder maps. */
    outLabel: string;
    /** Video encoder args, quality-first (maps CRF onto the encoder's metric). */
    encoderArgs: (crf: number, preset: string) => string[];
}

const VAAPI_DEVICE = "/dev/dri/renderD128";

/** Detection priority: hardware first, software always last. */
const PRIORITY: EncoderBackend[] = ["qsv", "vaapi", "nvenc", "amf", "libx264"];

let encoderInfoPromise: Promise<EncoderInfo> | null = null;

function encoderName(backend: EncoderBackend): string {
    switch (backend) {
        case "qsv":
            return "h264_qsv";
        case "vaapi":
            return "h264_vaapi";
        case "nvenc":
            return "h264_nvenc";
        case "amf":
            return "h264_amf";
        case "libx264":
            return "libx264";
    }
}

function swArgs(crf: number, preset: string): string[] {
    const args = ["-c:v", "libx264", "-crf", String(crf), "-preset", preset, "-pix_fmt", "yuv420p"];
    if (VIDEO_FFMPEG_THREADS > 0) {
        args.push("-threads", String(VIDEO_FFMPEG_THREADS));
    }
    return args;
}

function buildInfo(backend: EncoderBackend): EncoderInfo {
    switch (backend) {
        case "qsv":
            return {
                backend,
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
        case "vaapi":
            return {
                backend,
                initArgs: ["-vaapi_device", VAAPI_DEVICE],
                filterTail: ";[v]format=nv12,hwupload[vhw]",
                outLabel: "vhw",
                encoderArgs: (crf) => ["-c:v", "h264_vaapi", "-qp", String(crf)],
            };
        case "nvenc":
            return {
                backend,
                initArgs: [],
                filterTail: ";[v]format=yuv420p[vf]",
                outLabel: "vf",
                encoderArgs: (crf) => ["-c:v", "h264_nvenc", "-cq", String(crf), "-preset", "p5"],
            };
        case "amf":
            return {
                backend,
                initArgs: [],
                filterTail: ";[v]format=yuv420p[vf]",
                outLabel: "vf",
                encoderArgs: (crf) => [
                    "-c:v",
                    "h264_amf",
                    "-qp_i",
                    String(crf),
                    "-quality",
                    "balanced",
                ],
            };
        default:
            return {
                backend: "libx264",
                initArgs: [],
                filterTail: "",
                outLabel: "v",
                encoderArgs: swArgs,
            };
    }
}

function validationArgs(backend: EncoderBackend): string[] {
    switch (backend) {
        case "qsv":
            return [
                "-hide_banner",
                "-init_hw_device",
                "qsv=hw",
                "-filter_hw_device",
                "hw",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=64x64:d=0.2",
                "-vf",
                "format=nv12,hwupload",
                "-c:v",
                "h264_qsv",
                "-global_quality",
                "20",
                "-preset",
                "fast",
                "-f",
                "null",
                "-",
            ];
        case "vaapi":
            return [
                "-hide_banner",
                "-vaapi_device",
                VAAPI_DEVICE,
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=64x64:d=0.2",
                "-vf",
                "format=nv12,hwupload",
                "-c:v",
                "h264_vaapi",
                "-qp",
                "20",
                "-f",
                "null",
                "-",
            ];
        case "nvenc":
            return [
                "-hide_banner",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=64x64:d=0.2",
                "-c:v",
                "h264_nvenc",
                "-cq",
                "20",
                "-preset",
                "p5",
                "-f",
                "null",
                "-",
            ];
        case "amf":
            return [
                "-hide_banner",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=64x64:d=0.2",
                "-c:v",
                "h264_amf",
                "-qp_i",
                "20",
                "-quality",
                "balanced",
                "-f",
                "null",
                "-",
            ];
        default:
            return [];
    }
}

function isBackend(value: string): value is EncoderBackend {
    return (
        value === "qsv" ||
        value === "vaapi" ||
        value === "nvenc" ||
        value === "amf" ||
        value === "libx264"
    );
}

/** Runs `ffmpeg -encoders` once, returning the set of available encoder names. */
function listFfmpegEncoders(): Promise<Set<string>> {
    return new Promise((resolve) => {
        let output = "";
        const proc = spawn("ffmpeg", ["-hide_banner", "-encoders"], {
            stdio: ["ignore", "pipe", "pipe"],
        });
        proc.stdout?.on("data", (chunk: Buffer) => {
            output += chunk.toString();
        });
        proc.on("error", () => resolve(new Set()));
        proc.on("close", (code: number | null) => {
            if (code !== 0) {
                resolve(new Set());
                return;
            }
            const set = new Set<string>();
            for (const line of output.split("\n")) {
                const match = /^\s+[AVS]\S*\s+([a-zA-Z0-9_]+)\s/.exec(line);
                if (match) set.add(match[1]);
            }
            resolve(set);
        });
    });
}

/**
 * Checks that a hardware encoder is actually usable: the encoder must exist in
 * ffmpeg, the DRM render node must be present (qsv/vaapi) and a micro-encode
 * must succeed (catches missing drivers/devices, so Docker hosts without
 * hardware passthrough degrade cleanly to software).
 */
async function validateBackend(backend: EncoderBackend): Promise<boolean> {
    if (backend === "libx264") return true;

    if (!(await listFfmpegEncoders()).has(encoderName(backend))) return false;

    if ((backend === "qsv" || backend === "vaapi") && !existsSync(VAAPI_DEVICE)) return false;

    return new Promise((resolve) => {
        const proc = spawn("ffmpeg", validationArgs(backend), { stdio: "ignore" });
        const timeout = setTimeout(() => {
            try {
                proc.kill("SIGKILL");
            } catch {
                // ignore
            }
            resolve(false);
        }, 10_000);
        proc.on("error", () => {
            clearTimeout(timeout);
            resolve(false);
        });
        proc.on("close", (code: number | null) => {
            clearTimeout(timeout);
            resolve(code === 0);
        });
    });
}

async function resolveEncoderInfo(): Promise<EncoderInfo> {
    if (VIDEO_ENCODER !== "auto") {
        if (isBackend(VIDEO_ENCODER) && (await validateBackend(VIDEO_ENCODER))) {
            return buildInfo(VIDEO_ENCODER);
        }
        console.warn(
            `⚠️ VIDEO_ENCODER=${VIDEO_ENCODER} is not usable, falling back to auto-detect`
        );
    }

    for (const backend of PRIORITY) {
        if (await validateBackend(backend)) {
            return buildInfo(backend);
        }
    }

    // Unreachable in practice: libx264 always validates.
    return buildInfo("libx264");
}

/**
 * Returns the best usable video encoder for this machine, cached for the
 * whole process. Priority: qsv → vaapi → nvenc → amf → libx264 (software is
 * always the last resort). Override with VIDEO_ENCODER (qsv|vaapi|nvenc|amf|libx264).
 * Async so the boot-time micro-encodes never block the event loop.
 */
export function getEncoderInfo(): Promise<EncoderInfo> {
    encoderInfoPromise ??= resolveEncoderInfo();
    return encoderInfoPromise;
}

/** The software fallback encoder, used when a hardware attempt fails at encode time. */
export function softwareEncoder(): EncoderInfo {
    return buildInfo("libx264");
}
