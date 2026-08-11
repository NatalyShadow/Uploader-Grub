import { FFPROBE_TIMEOUT_MS } from "./constants.ts";
import { runCommand } from "./process.ts";
import type { Dimensions } from "../types/index.ts";

async function probe(args: string[]): Promise<string> {
    const { stdout } = await runCommand({
        command: "ffprobe",
        args,
        timeoutMs: FFPROBE_TIMEOUT_MS,
        label: "ffprobe",
        maxStdoutChars: 4096,
        maxStderrChars: 1024,
    });
    return stdout.trim();
}

export async function getVideoDimensions(inputPath: string): Promise<Dimensions> {
    const output = await probe([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=s=x:p=0",
        inputPath,
    ]);

    const parts = output.split("x");
    const width = parseInt(parts[0], 10) || 0;
    const height = parseInt(parts[1], 10) || 0;

    return { width, height };
}

export async function getVideoDuration(inputPath: string): Promise<number> {
    const output = await probe([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        inputPath,
    ]);

    const duration = parseFloat(output);
    return isNaN(duration) ? 0 : duration;
}
