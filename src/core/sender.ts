import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DiscordAPIError, HTTPError, RateLimitError } from "@discordjs/rest";
import type { GuildTextBasedChannel } from "discord.js";
import type { SendResult } from "../types/index.ts";
import {
    MAX_FILE_SIZE,
    MAX_RETRY_AFTER_MS,
    MAX_SEND_RETRIES,
    RETRY_DELAY_MS,
    SEND_REASON_TOO_LARGE,
} from "../utils/constants.ts";
import { ensureDirectory, getFileStats } from "../utils/files.ts";

// Dedup registry of sent files. Bounded so watch-mode sessions (which can run
// for days) never grow it without limit; evicts the oldest key when full.
// Optionally persisted to disk (one key per line) so a restart of the bot does
// not re-send files that were already uploaded.
const sentFiles = new Set<string>();
const SENT_DEDUP_LIMIT = 2000;
let sentRegistryPath: string | null = null;

export function hasBeenSent(fileName: string): boolean {
    return sentFiles.has(fileName);
}

/**
 * Loads the persisted sent-file registry (one key per line) into memory and
 * records the file path so every markAsSent() updates it. Missing or
 * unreadable files are ignored — the bot starts with an empty registry.
 */
export function initSentRegistry(filePath: string): void {
    sentRegistryPath = filePath;
    sentFiles.clear();
    if (!existsSync(filePath)) return;

    try {
        const lines = readFileSync(filePath, "utf-8").split("\n");
        for (const line of lines) {
            const key = line.trim();
            if (key === "" || sentFiles.size >= SENT_DEDUP_LIMIT) continue;
            sentFiles.add(key);
        }
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`⚠️ Could not read sent-file registry (${filePath}): ${message}`);
    }
}

/**
 * Writes the registry to disk atomically (temp file + rename) so a crash never
 * leaves a half-written file. Failures are logged but never fatal: dedup keeps
 * working in memory for the current session.
 */
function persistSentRegistry(): void {
    if (sentRegistryPath === null) return;
    ensureDirectory(dirname(sentRegistryPath));
    const tmpPath = `${sentRegistryPath}.tmp`;
    try {
        writeFileSync(tmpPath, [...sentFiles].join("\n"));
        renameSync(tmpPath, sentRegistryPath);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`⚠️ Could not persist sent-file registry (${sentRegistryPath}): ${message}`);
    }
}

export function markAsSent(fileName: string): void {
    sentFiles.add(fileName);
    if (sentFiles.size > SENT_DEDUP_LIMIT) {
        const oldest = sentFiles.values().next().value;
        if (oldest !== undefined) {
            sentFiles.delete(oldest);
        }
    }
    persistSentRegistry();
}

/**
 * Determines whether an error is worth retrying and, if so, the minimum
 * delay to honour before the next attempt (Discord's Retry-After, when present).
 */
function classifyError(err: unknown): { retryable: boolean; retryAfterMs?: number } {
    if (err instanceof RateLimitError) {
        return { retryable: true, retryAfterMs: err.retryAfter };
    }
    if (err instanceof DiscordAPIError) {
        // 429 means the global/local bucket is exhausted — always retry with a delay
        if (err.status === 429) {
            return { retryable: true, retryAfterMs: RETRY_DELAY_MS };
        }
        // 5xx are transient server errors — safe to retry
        if (err.status >= 500 && err.status < 600) {
            return { retryable: true };
        }
        // 4xx other than 429 are permanent (bad request, forbidden, not found, etc.)
        return { retryable: false };
    }
    if (err instanceof HTTPError) {
        // Network/HTTP layer errors (timeouts, aborts, malformed responses)
        return { retryable: true };
    }
    // Node-level network errors
    if (err instanceof Error && "code" in err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code && ["ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN"].includes(code)) {
            return { retryable: true };
        }
    }
    return { retryable: false };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendFile(
    channel: GuildTextBasedChannel,
    filePath: string,
    fileName: string,
    channelId: string,
    retries: number = MAX_SEND_RETRIES,
    attachmentName?: string
): Promise<SendResult> {
    const dedupKey = `${channelId}:${fileName}`;

    if (hasBeenSent(dedupKey)) {
        console.log(`⚠️ ${fileName} already sent`);
        return { success: false, reason: "duplicate" };
    }

    const stats = getFileStats(filePath);
    if (stats === null) {
        // The file vanished or is unreadable between the scan and the send
        // (e.g. a watch-mode race where the organizer moved it, or a temp that
        // no longer exists). Report it as a failed send instead of throwing, so
        // the pipeline does not quarantine a perfectly fine file.
        console.error(`❌ Cannot stat ${fileName}: file missing or unreadable (${filePath})`);
        return { success: false, reason: "error", message: "file missing or unreadable" };
    }
    if (stats.size > MAX_FILE_SIZE) {
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
        const limitMB = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(1);
        const message = `${sizeMB}MB > ${limitMB}MB`;
        console.log(`⚠️ Final file too large: ${fileName} (${message})`);
        return { success: false, reason: SEND_REASON_TOO_LARGE, message };
    }

    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const message = await channel.send({
                // attachmentName overrides the extension-only name used by
                // Discord to detect inline media: a transcoded .3gp/.avif is
                // uploaded as its real output extension (.mp4/.jpg) so Discord
                // renders it as video/image instead of a plain file.
                files: [{ attachment: filePath, name: attachmentName ?? fileName }],
            });

            console.log(`📤 Sent: ${fileName} → ${message.id}`);
            markAsSent(dedupKey);
            return { success: true };
        } catch (err) {
            lastError = err;
            const { retryable, retryAfterMs } = classifyError(err);

            if (!retryable || attempt === retries) {
                break;
            }

            // Exponential backoff with jitter, capped at MAX_RETRY_AFTER_MS
            const baseDelay = retryAfterMs ?? RETRY_DELAY_MS * 2 ** attempt;
            const jitter = Math.random() * 500;
            const delay = Math.min(baseDelay + jitter, MAX_RETRY_AFTER_MS);

            const errName = err instanceof Error ? err.name : String(err);
            console.log(
                `⏱️ Retry ${attempt + 1}/${retries} for ${fileName} in ${Math.round(delay)}ms (${errName})`
            );
            await sleep(delay);
        }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    console.error(`❌ Error sending ${fileName}:`, message);
    return { success: false, reason: "error", message };
}
