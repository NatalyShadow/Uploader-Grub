import { readFileSync } from "fs";
import { join } from "path";
import { expandEnvVars } from "../utils/env.ts";
import type { ConfigEntry } from "../types/index.ts";

export function loadConfig(): ConfigEntry[] {
    let raw: string;
    try {
        raw = readFileSync(join(process.cwd(), "config.json"), "utf-8");
    } catch {
        console.error("❌ config.json not found. Run: cp config.example.json config.json");
        process.exit(1);
    }

    let parsed: { path: string; channelId: string }[];
    try {
        parsed = JSON.parse(raw) as { path: string; channelId: string }[];
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`❌ Invalid JSON in config.json: ${msg}`);
        process.exit(1);
    }

    return parsed.map((entry) => ({
        ...entry,
        path: expandEnvVars(entry.path),
    }));
}
