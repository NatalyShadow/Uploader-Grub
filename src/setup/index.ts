import { createFolders } from "./folderManager.ts";
import { organizeFiles } from "./organizer.ts";
import type { ConfigEntry, OrganizerStats } from "../types/index.ts";

const SUBFOLDERS = new Set<string>(["images", "videos", "heavy"]);

function extractRoot(path: string): string {
    const parts = path.replace(/\\/g, "/").split("/");
    const last = parts[parts.length - 1];

    if (SUBFOLDERS.has(last)) {
        return parts.slice(0, -1).join("/");
    }

    return path;
}

export function getUniqueRoots(config: ConfigEntry[]): string[] {
    const roots = new Set<string>();

    for (const entry of config) {
        if (entry.path) {
            roots.add(extractRoot(entry.path));
        }
    }

    return Array.from(roots);
}

export function runSetup(config: ConfigEntry[]): void {
    const roots = getUniqueRoots(config);

    if (roots.length === 0) {
        console.log("⚠️ No roots to set up.\n");
        return;
    }

    createFolders(roots);

    let totalMoved = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let totalHeavy = 0;

    for (const root of roots) {
        const stats: OrganizerStats = organizeFiles(root);
        totalMoved += stats.moved;
        totalSkipped += stats.skipped;
        totalErrors += stats.errors;
        totalHeavy += stats.heavy;
    }

    if (totalMoved > 0 || totalSkipped > 0 || totalErrors > 0) {
        const heavyInfo = totalHeavy > 0 ? ` (${totalHeavy} heavy)` : "";
        console.log(
            `\n📊 Organizer summary: ${totalMoved} moved${heavyInfo}, ${totalSkipped} skipped, ${totalErrors} errors\n`
        );
    } else {
        console.log("📂 No loose files to organize.\n");
    }
}
