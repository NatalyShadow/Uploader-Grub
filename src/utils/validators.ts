import { runCommand } from "./process.ts";

const CHECK_TIMEOUT_MS = 10_000;

async function checkCommand(name: string, args: string[] = ["-version"]): Promise<boolean> {
    try {
        await runCommand({
            command: name,
            args,
            timeoutMs: CHECK_TIMEOUT_MS,
            label: name,
            stdio: ["ignore", "ignore", "ignore"],
        });
        return true;
    } catch {
        return false;
    }
}

export async function checkFfmpeg(): Promise<boolean> {
    const hasFfmpeg = await checkCommand("ffmpeg");
    if (!hasFfmpeg) return false;

    const hasFfprobe = await checkCommand("ffprobe");
    return hasFfprobe;
}
