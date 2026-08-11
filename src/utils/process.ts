import { spawn, type ChildProcess, type StdioOptions } from "child_process";
import { registerProcess, unregisterProcess } from "./processTracker.ts";

/** Thrown when a spawned process is killed for exceeding its timeout. */
export class TimeoutError extends Error {
    constructor(label: string) {
        super(`${label} timed out`);
        this.name = "TimeoutError";
    }
}

/** Thrown when a spawned process exits with a non-zero code (or fails to spawn). */
export class ProcessError extends Error {
    readonly code: number | null;
    readonly stderr: string;

    constructor(label: string, code: number | null, stderr: string) {
        super(`${label} exited with code ${code}`);
        this.name = "ProcessError";
        this.code = code;
        this.stderr = stderr;
    }
}

export interface RunCommandOptions {
    /** Executable to run (e.g. "ffmpeg", "ffprobe"). */
    command: string;
    /** Arguments, excluding the executable itself. */
    args: string[];
    /** Hard timeout; on expiry the whole process tree is SIGKILLed. */
    timeoutMs: number;
    /** Human-readable label used in timeout/error messages. */
    label: string;
    /** Wrap the command with `nice -n <nice>` (Linux only, ignored elsewhere). */
    nice?: number;
    /** Called with each stdout chunk (e.g. for ffmpeg -progress parsing). */
    onStdout?: (chunk: string) => void;
    /** Bounded stdout capture — only the tail is kept. Default 8192 chars. */
    maxStdoutChars?: number;
    /** Bounded stderr capture — only the tail is kept. Default 4096 chars. */
    maxStderrChars?: number;
    /** Defaults to ["ignore", "pipe", "pipe"]. */
    stdio?: StdioOptions;
}

export interface RunCommandResult {
    stdout: string;
    stderr: string;
}

/**
 * Kills the whole process group (`-pid`) so children of wrappers like
 * `nice` are terminated too — otherwise the wrapped ffmpeg survives as an
 * orphan. Falls back to killing the process itself when not a group leader.
 */
function killTree(proc: ChildProcess, signal: "SIGTERM" | "SIGKILL"): void {
    try {
        if (proc.pid !== undefined) process.kill(-proc.pid, signal);
    } catch {
        try {
            proc.kill(signal);
        } catch {
            // ignore
        }
    }
}

/**
 * Runs a child process with process-tracking, a hard timeout, bounded output
 * capture and optional `nice` wrapping. Spawns detached so the whole group can
 * be killed on timeout/shutdown. Resolves with the captured output; rejects
 * with TimeoutError (timeout) or ProcessError (spawn error / non-zero exit).
 */
export function runCommand(opts: RunCommandOptions): Promise<RunCommandResult> {
    return new Promise((resolve, reject) => {
        const useNice = opts.nice !== undefined && opts.nice > 0 && process.platform === "linux";
        const command = useNice ? "nice" : opts.command;
        const args = useNice ? [`-n`, String(opts.nice), opts.command, ...opts.args] : opts.args;

        const proc = spawn(command, args, {
            stdio: opts.stdio ?? ["ignore", "pipe", "pipe"],
            detached: true,
        });
        registerProcess(proc);

        let stdout = "";
        let stderr = "";
        const maxStdout = opts.maxStdoutChars ?? 8192;
        const maxStderr = opts.maxStderrChars ?? 4096;

        proc.stdout?.on("data", (chunk: Buffer) => {
            const text = chunk.toString();
            if (opts.onStdout) opts.onStdout(text);
            stdout += text;
            if (stdout.length > maxStdout) stdout = stdout.slice(-maxStdout);
        });

        proc.stderr?.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
            if (stderr.length > maxStderr) stderr = stderr.slice(-maxStderr);
        });

        const timeout = setTimeout(() => {
            console.error(
                `⏱️ ${opts.label} timed out after ${Math.round(opts.timeoutMs / 1000)}s, killing process tree...`
            );
            killTree(proc, "SIGKILL");
            unregisterProcess(proc);
            reject(new TimeoutError(opts.label));
        }, opts.timeoutMs);

        proc.on("error", (err) => {
            clearTimeout(timeout);
            unregisterProcess(proc);
            reject(err instanceof Error ? err : new ProcessError(opts.label, null, ""));
        });

        proc.on("close", (code: number | null) => {
            clearTimeout(timeout);
            unregisterProcess(proc);
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                if (stderr) {
                    console.error(`stderr: ${stderr.slice(-500)}`);
                }
                reject(new ProcessError(opts.label, code, stderr));
            }
        });
    });
}
