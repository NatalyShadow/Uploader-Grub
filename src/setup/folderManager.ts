import { join } from "path";
import { ensureDirectory } from "../utils/files.ts";

export function createFolders(rootPaths: string[]): void {
    console.log("📁 Setting up folder structure...\n");

    for (const root of rootPaths) {
        const subfolders = ["images", "videos", "heavy"];

        const createdRoot = ensureDirectory(root);
        if (!createdRoot) continue;

        for (const sub of subfolders) {
            ensureDirectory(join(root, sub));
        }

        console.log(`✅ ${root}`);
    }

    console.log("");
}
