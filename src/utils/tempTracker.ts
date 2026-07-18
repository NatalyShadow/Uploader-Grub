import { deleteFile } from "./files.ts";

const activeTemps = new Set<string>();

export function registerTemp(path: string): void {
    activeTemps.add(path);
}

export function unregisterTemp(path: string): void {
    activeTemps.delete(path);
}

export function cleanupAllTemps(): void {
    for (const path of activeTemps) {
        deleteFile(path, `temp: ${path}`);
    }
    activeTemps.clear();
}
