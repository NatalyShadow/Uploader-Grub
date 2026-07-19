import { watch } from "chokidar";
import type { Client } from "discord.js";
import type { ConfigEntry } from "../types/index.ts";
import { organizeFiles } from "../setup/organizer.ts";
import { runPipeline } from "./pipeline.ts";
import type { PipelineOptions } from "./pipeline.ts";

const DEBOUNCE_MS = 3000;
const RETRY_MS = 2000;
const timeouts = new Map<string, NodeJS.Timeout>();
let pipelineRunning = false;

async function processRoot(
    client: Client,
    config: ConfigEntry[],
    logoPath: string,
    options: PipelineOptions,
    root: string
): Promise<void> {
    const stats = organizeFiles(root);
    if (stats.moved === 0) return;

    if (stats.moved === stats.heavy) {
        console.log(`📦 ${stats.heavy} file(s) moved to heavy/, skipping pipeline`);
        return;
    }

    const rootEntries = config.filter((e) => e.path.startsWith(root + "/"));
    await runPipeline(client, rootEntries, logoPath, options);
}

function scheduleProcess(
    client: Client,
    config: ConfigEntry[],
    logoPath: string,
    options: PipelineOptions,
    root: string
): void {
    if (pipelineRunning) {
        timeouts.set(
            root,
            setTimeout(() => scheduleProcess(client, config, logoPath, options, root), RETRY_MS)
        );
        return;
    }

    timeouts.set(
        root,
        setTimeout(() => {
            void (async () => {
                timeouts.delete(root);

                try {
                    pipelineRunning = true;
                    await processRoot(client, config, logoPath, options, root);
                } catch (err) {
                    if (err instanceof Error) {
                        console.error(`❌ Watcher error on ${root}:`, err.message);
                    }
                } finally {
                    pipelineRunning = false;
                }
            })();
        }, DEBOUNCE_MS)
    );
}

export function watchRoots(
    client: Client,
    config: ConfigEntry[],
    logoPath: string,
    options: PipelineOptions,
    roots: string[]
): void {
    console.log(`👀 Watching ${roots.length} root(s) for new files...`);

    // Initial scan to catch files that arrived between setup and watch start
    for (const root of roots) {
        void processRoot(client, config, logoPath, options, root).catch(() => {
            // errors already logged inside processRoot
        });
    }

    const watcher = watch(roots, {
        ignored: /(^|[/\\])\../, // ignore dotfiles
        persistent: true,
        ignoreInitial: true,
        depth: 0, // only watch root level, not subdirectories
        awaitWriteFinish: {
            stabilityThreshold: 2000, // wait until file stops growing for 2s
            pollInterval: 100,
        },
    });

    watcher.on("add", (filePath: string) => {
        // Determine which root this file belongs to
        const root = roots.find((r) => filePath.startsWith(r + "/") || filePath === r);
        if (!root) return;

        const existing = timeouts.get(root);
        if (existing) clearTimeout(existing);

        scheduleProcess(client, config, logoPath, options, root);
    });

    watcher.on("error", (error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`❌ Watcher error:`, message);
    });
}
