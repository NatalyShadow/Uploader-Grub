import { watch } from "chokidar";
import type { Client } from "discord.js";
import type { ConfigEntry } from "../types/index.ts";
import { organizeFiles } from "../setup/organizer.ts";
import { runPipeline } from "./pipeline.ts";
import type { PipelineOptions } from "./pipeline.ts";

const DEBOUNCE_MS = 3000;

/**
 * Per-root debounce timers. We always keep at most one timer per root
 * to avoid the timer-leak that the old design had when re-scheduling
 * during a running pipeline.
 */
const debounceTimers = new Map<string, NodeJS.Timeout>();

/**
 * FIFO queue of roots that are ready to be processed. Only one root
 * is processed at a time; when a pipeline finishes, the next one is
 * dequeued automatically.
 */
const pendingRoots = new Set<string>();

/** Mutex flag — only one pipeline is ever in flight. */
let isProcessing = false;

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

function markRootReady(
    client: Client,
    config: ConfigEntry[],
    logoPath: string,
    options: PipelineOptions,
    root: string
): void {
    pendingRoots.add(root);
    void drainQueue(client, config, logoPath, options);
}

function drainQueue(
    client: Client,
    config: ConfigEntry[],
    logoPath: string,
    options: PipelineOptions
): Promise<void> {
    if (isProcessing) {
        return Promise.resolve();
    }

    const next = pendingRoots.values().next();
    if (next.done) {
        return Promise.resolve();
    }
    const root = next.value;
    pendingRoots.delete(root);
    isProcessing = true;

    return processRoot(client, config, logoPath, options, root)
        .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`❌ Watcher error on ${root}:`, message);
        })
        .finally(() => {
            isProcessing = false;
            if (pendingRoots.size > 0) {
                void drainQueue(client, config, logoPath, options);
            }
        });
}

function debounceRoot(
    client: Client,
    config: ConfigEntry[],
    logoPath: string,
    options: PipelineOptions,
    root: string
): void {
    const existing = debounceTimers.get(root);
    if (existing) {
        clearTimeout(existing);
    }

    const timer = setTimeout(() => {
        debounceTimers.delete(root);
        markRootReady(client, config, logoPath, options, root);
    }, DEBOUNCE_MS);

    debounceTimers.set(root, timer);
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
        markRootReady(client, config, logoPath, options, root);
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

        debounceRoot(client, config, logoPath, options, root);
    });

    watcher.on("error", (error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`❌ Watcher error:`, message);
    });
}
