import { spawn } from "child_process";
import { FFPROBE_TIMEOUT_MS } from "./constants.ts";
import { registerProcess, unregisterProcess } from "./processTracker.ts";
import type { Dimensions } from "../types/index.ts";

function spawnFfprobe(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        let output = "";
        const proc = spawn("ffprobe", args);
        registerProcess(proc);

        const timeout = setTimeout(() => {
            console.error(`⏱️ ffprobe timed out after ${FFPROBE_TIMEOUT_MS / 1000}s, killing...`);
            try {
                proc.kill("SIGKILL");
            } catch {
                // ignore
            }
            unregisterProcess(proc);
            reject(new Error("ffprobe timed out"));
        }, FFPROBE_TIMEOUT_MS);

        proc.stdout.on("data", (data: Buffer) => {
            output += data.toString();
        });

        proc.on("error", (err) => {
            clearTimeout(timeout);
            unregisterProcess(proc);
            reject(err);
        });

        proc.on("close", (code: number | null) => {
            clearTimeout(timeout);
            unregisterProcess(proc);
            if (code !== 0) {
                reject(new Error(`ffprobe exited with code ${code}`));
                return;
            }
            resolve(output.trim());
        });
    });
}

export async function getVideoDimensions(inputPath: string): Promise<Dimensions> {
    const output = await spawnFfprobe([
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
    const output = await spawnFfprobe([
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
