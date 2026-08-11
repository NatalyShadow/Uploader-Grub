import { readFileSync } from "fs";
import { join } from "path";
import { expandEnvVars } from "../utils/env.ts";
import type { ConfigEntry } from "../types/index.ts";

interface RawConfigEntry {
    path?: unknown;
    channelId?: unknown;
}

export function loadConfig(): ConfigEntry[] {
    let raw: string;
    try {
        raw = readFileSync(join(process.cwd(), "config.json"), "utf-8");
    } catch {
        console.error("❌ config.json not found. Run: cp config.example.json config.json");
        process.exit(1);
    }

    let parsed: RawConfigEntry[];
    try {
        parsed = JSON.parse(raw) as RawConfigEntry[];
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`❌ Invalid JSON in config.json: ${msg}`);
        process.exit(1);
    }

    if (!Array.isArray(parsed)) {
        console.error("❌ config.json must contain a JSON array of { path, channelId } entries.");
        process.exit(1);
    }

    const entries: ConfigEntry[] = [];
    for (const entry of parsed) {
        if (typeof entry.path !== "string" || entry.path.trim() === "") {
            console.warn('⚠️ config.json entry is missing a valid "path", skipped');
            continue;
        }
        if (typeof entry.channelId !== "string" || entry.channelId.trim() === "") {
            console.warn(
                `⚠️ config.json entry is missing a valid "channelId" (path: ${entry.path}), skipped`
            );
            continue;
        }
        entries.push({
            path: expandEnvVars(entry.path),
            channelId: entry.channelId,
        });
    }

    if (entries.length === 0) {
        console.error("❌ config.json has no valid entries.");
        process.exit(1);
    }

    return entries;
}
