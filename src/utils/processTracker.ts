import type { ChildProcess } from "child_process";

const activeProcesses = new Set<ChildProcess>();

export function registerProcess(proc: ChildProcess): void {
    activeProcesses.add(proc);
}

export function unregisterProcess(proc: ChildProcess): void {
    activeProcesses.delete(proc);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function killAllProcesses(): Promise<void> {
    // Gentle shutdown first
    for (const proc of activeProcesses) {
        try {
            proc.kill("SIGTERM");
        } catch {
            // ignore
        }
    }

    // Wait for graceful exit
    await sleep(2000);

    // Force kill remaining
    for (const proc of activeProcesses) {
        try {
            proc.kill("SIGKILL");
        } catch {
            // ignore
        }
    }

    activeProcesses.clear();
}
