import type { ChildProcess } from "node:child_process";

const activeProcesses = new Set<ChildProcess>();

export function registerProcess(proc: ChildProcess): void {
    activeProcesses.add(proc);
}

export function unregisterProcess(proc: ChildProcess): void {
    activeProcesses.delete(proc);
}

/**
 * Sends a signal to the whole process group (`-pid`) so children of wrappers
 * like `nice` are terminated too. Falls back to the process itself when not
 * a group leader (e.g. processes spawned without `detached: true`).
 */
function signalProcessTree(proc: ChildProcess, signal: "SIGTERM" | "SIGKILL"): void {
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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function killAllProcesses(): Promise<void> {
    // Gentle shutdown first
    for (const proc of activeProcesses) {
        signalProcessTree(proc, "SIGTERM");
    }

    // Wait for graceful exit
    await sleep(2000);

    // Force kill remaining
    for (const proc of activeProcesses) {
        signalProcessTree(proc, "SIGKILL");
    }

    activeProcesses.clear();
}
