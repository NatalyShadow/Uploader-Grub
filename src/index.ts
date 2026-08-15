import "dotenv/config";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { Client } from "discord.js";

import { loadConfig } from "./config/loader.ts";
import { initClient } from "./core/client.ts";
import { runPipeline } from "./core/pipeline.ts";
import { watchRoots } from "./core/watcher.ts";
import { processHeavyFiles } from "./core/heavyProcessor.ts";
import { initSentRegistry } from "./core/sender.ts";
import { runSetup, getUniqueRoots } from "./setup/index.ts";
import { checkFfmpeg } from "./utils/validators.ts";
import { hasForcedMp4Files } from "./utils/files.ts";
import { getEncoderInfo } from "./utils/encoder.ts";
import { killAllProcesses } from "./utils/processTracker.ts";
import { cleanupAllTemps } from "./utils/tempTracker.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const logoPath = join(__dirname, "logo.webp");

let client: Client | null = null;

function shutdown(signal: string): void {
    console.log(`\n🛑 ${signal} received, cleaning up...`);
    void killAllProcesses()
        .then(() => {
            cleanupAllTemps();
            if (client) {
                void client.destroy().catch(() => undefined);
            }
            process.exit(0);
        })
        .catch(() => {
            cleanupAllTemps();
            if (client) {
                void client.destroy().catch(() => undefined);
            }
            process.exit(1);
        });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// A single stray rejection must not take down a long-running watch session:
// log it and keep going. The codebase already catches expected errors; this is
// a safety net for unexpected ones.
process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    console.error("⚠️ Unhandled promise rejection:", message);
});

// An uncaught exception leaves the process in an undefined state, so clean up
// (kill ffmpeg children, remove temps, destroy the client) and exit.
process.on("uncaughtException", (error) => {
    console.error("❌ Uncaught exception:", error);
    shutdown("uncaughtException");
});

/** Logs the detected video encoder once (hardware vs software). */
async function logVideoEncoder(): Promise<void> {
    const enc = await getEncoderInfo();
    if (enc.backend === "libx264") {
        console.log("🧠 Video encoding: software (libx264). Enable hardware via VIDEO_ENCODER.");
    } else {
        console.log(`⚡ Video encoding: hardware (${enc.backend}).`);
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const options = {
        skipWatermark: args.includes("--skip-watermark"),
        moveSent: args.includes("--move-sent"),
    };
    const watchMode = args.includes("--watch");
    const processHeavy = args.includes("--process-heavy");

    if (options.skipWatermark) {
        console.log("🏷️ Watermark disabled via --skip-watermark");
    }
    if (options.moveSent) {
        console.log("📦 Move-to-sent enabled via --move-sent");
    }
    if (watchMode) {
        console.log("👀 Watch mode enabled — will keep running for new files");
    }
    if (processHeavy) {
        console.log("🔄 Process-heavy mode enabled — processing heavy/ folder");
    }

    // Mutually exclusive flags
    if (processHeavy && watchMode) {
        console.error("❌ --process-heavy and --watch are mutually exclusive");
        process.exit(1);
    }

    if (processHeavy) {
        // Heavy processing mode: no Discord, no watch, just process heavy/ → processed/
        const config = loadConfig();
        runSetup(config);

        if (!options.skipWatermark && !existsSync(logoPath)) {
            console.error(`❌ Logo not found: ${logoPath}`);
            process.exit(1);
        }

        // Forced-mp4 containers (.3gp) in heavy/ are always converted, even
        // with --skip-watermark, so ffmpeg/ffprobe are mandatory if any exist.
        const roots = getUniqueRoots(config);
        const needsFfmpeg =
            !options.skipWatermark || hasForcedMp4Files(roots.map((root) => join(root, "heavy")));

        if (needsFfmpeg) {
            const hasFfmpeg = await checkFfmpeg();
            if (!hasFfmpeg) {
                console.error(
                    options.skipWatermark
                        ? "❌ ffmpeg not found. .3gp files in heavy/ must be converted even with --skip-watermark."
                        : "❌ ffmpeg not found. Please install ffmpeg."
                );
                process.exit(1);
            }
            await logVideoEncoder();
        }

        await processHeavyFiles(config, logoPath, { skipWatermark: options.skipWatermark });
        cleanupAllTemps();
        process.exit(0);
    }

    // Normal bot mode
    const config = loadConfig();
    runSetup(config);

    // Persist the sent-file dedup registry in the first root's hidden .state/
    // folder so a restart never re-sends files that were already uploaded.
    // The folder is invisible to the organizer, the watcher and the pipeline.
    const dedupRoot = getUniqueRoots(config)[0];
    if (dedupRoot) {
        initSentRegistry(join(dedupRoot, ".state", "sent.log"));
    }

    if (!options.skipWatermark && !existsSync(logoPath)) {
        console.error(`❌ Logo not found: ${logoPath}`);
        process.exit(1);
    }

    // With --skip-watermark, ffmpeg is only required when a forced-mp4
    // container (.3gp) is present — those are converted without a logo. With
    // watermarking enabled it is always required. heavy/ is scanned too: the
    // organizer moves oversized .3gp files there unconverted, and --process-heavy
    // skips them silently if ffmpeg is missing.
    const roots = getUniqueRoots(config);
    const needsFfmpeg =
        !options.skipWatermark ||
        hasForcedMp4Files([
            ...config.map((entry) => entry.path),
            ...roots.map((root) => join(root, "heavy")),
        ]);

    if (needsFfmpeg) {
        const hasFfmpeg = await checkFfmpeg();
        if (!hasFfmpeg) {
            console.error(
                options.skipWatermark
                    ? "❌ ffmpeg not found. .3gp files must be converted even with --skip-watermark."
                    : "❌ ffmpeg not found. Please install ffmpeg."
            );
            process.exit(1);
        }
        await logVideoEncoder();
    }

    client = initClient();

    client.once("ready", () => {
        console.log(`✅ Bot logged in as ${client!.user!.tag}`);

        runPipeline(client!, config, logoPath, options)
            .then(() => {
                if (watchMode) {
                    const roots = getUniqueRoots(config);
                    watchRoots(client!, config, logoPath, options, roots);
                    return;
                }
                void client!.destroy().catch(() => undefined);
                cleanupAllTemps();
                process.exit(0);
            })
            .catch((err) => {
                console.error("❌ Pipeline error:", err);
                process.exit(1);
            });
    });

    await client.login(process.env.DISCORD_TOKEN);
}

void main().catch((err) => {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error("❌ Fatal error:", message);
    process.exit(1);
});
