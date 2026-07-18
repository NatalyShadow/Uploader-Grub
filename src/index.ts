import "dotenv/config";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { Client } from "discord.js";

import { loadConfig } from "./config/loader.ts";
import { initClient } from "./core/client.ts";
import { runPipeline } from "./core/pipeline.ts";
import { watchRoots } from "./core/watcher.ts";
import { runSetup, getUniqueRoots } from "./setup/index.ts";
import { checkFfmpeg } from "./utils/validators.ts";
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
                void client.destroy();
            }
            process.exit(0);
        })
        .catch(() => {
            cleanupAllTemps();
            if (client) {
                void client.destroy();
            }
            process.exit(1);
        });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const options = {
        skipWatermark: args.includes("--skip-watermark"),
        moveSent: args.includes("--move-sent"),
    };
    const watchMode = args.includes("--watch");

    if (options.skipWatermark) {
        console.log("🏷️ Watermark disabled via --skip-watermark");
    }
    if (options.moveSent) {
        console.log("📦 Move-to-sent enabled via --move-sent");
    }
    if (watchMode) {
        console.log("👀 Watch mode enabled — will keep running for new files");
    }

    if (!options.skipWatermark && !existsSync(logoPath)) {
        console.error(`❌ Logo not found: ${logoPath}`);
        process.exit(1);
    }

    if (!options.skipWatermark) {
        const hasFfmpeg = await checkFfmpeg();
        if (!hasFfmpeg) {
            console.error("❌ ffmpeg not found. Please install ffmpeg.");
            process.exit(1);
        }
    }

    const config = loadConfig();
    runSetup(config);

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
                void client!.destroy();
                process.exit(0);
            })
            .catch((err) => {
                console.error("❌ Pipeline error:", err);
                process.exit(1);
            });
    });

    await client.login(process.env.DISCORD_TOKEN);
}

void main();
