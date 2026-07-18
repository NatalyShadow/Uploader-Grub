import { spawn } from "child_process";

const CHECK_TIMEOUT_MS = 10_000;

function checkCommand(name: string, args: string[] = ["-version"]): Promise<boolean> {
    return new Promise((resolve) => {
        const proc = spawn(name, args, { stdio: "ignore" });

        const timeout = setTimeout(() => {
            proc.kill("SIGKILL");
            resolve(false);
        }, CHECK_TIMEOUT_MS);

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

export async function checkFfmpeg(): Promise<boolean> {
    const hasFfmpeg = await checkCommand("ffmpeg");
    if (!hasFfmpeg) return false;

    const hasFfprobe = await checkCommand("ffprobe");
    return hasFfprobe;
}
