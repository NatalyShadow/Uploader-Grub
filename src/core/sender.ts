import type { GuildTextBasedChannel } from "discord.js";
import { statSync } from "fs";
import { DiscordAPIError, HTTPError, RateLimitError } from "@discordjs/rest";
import {
    MAX_FILE_SIZE,
    MAX_SEND_RETRIES,
    RETRY_DELAY_MS,
    MAX_RETRY_AFTER_MS,
    SEND_REASON_TOO_LARGE,
} from "../utils/constants.ts";
import type { SendResult } from "../types/index.ts";

const sentFiles = new Set<string>();

export function hasBeenSent(fileName: string): boolean {
    return sentFiles.has(fileName);
}

export function markAsSent(fileName: string): void {
    sentFiles.add(fileName);
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
    retries: number = MAX_SEND_RETRIES
): Promise<SendResult> {
    const dedupKey = `${channelId}:${fileName}`;

    if (hasBeenSent(dedupKey)) {
        console.log(`⚠️ ${fileName} already sent`);
        return { success: false, reason: "duplicate" };
    }

    const stats = statSync(filePath);
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
                files: [{ attachment: filePath, name: fileName }],
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
            const baseDelay = retryAfterMs ?? RETRY_DELAY_MS * Math.pow(2, attempt);
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
