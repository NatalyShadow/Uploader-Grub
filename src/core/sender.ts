import type { GuildTextBasedChannel } from "discord.js";
import { statSync } from "fs";
import { MAX_FILE_SIZE, MAX_SEND_RETRIES, RETRY_DELAY_MS } from "../utils/constants.ts";
import type { SendResult } from "../types/index.ts";

const sentFiles = new Set<string>();

export function hasBeenSent(fileName: string): boolean {
    return sentFiles.has(fileName);
}

export function markAsSent(fileName: string): void {
    sentFiles.add(fileName);
}

export async function sendFile(
    channel: GuildTextBasedChannel,
    filePath: string,
    fileName: string,
    channelId: string,
    retries = MAX_SEND_RETRIES
): Promise<SendResult> {
    const dedupKey = `${channelId}:${fileName}`;

    if (hasBeenSent(dedupKey)) {
        console.log(`⚠️ ${fileName} already sent`);
        return { success: false, reason: "duplicate" };
    }

    try {
        const stats = statSync(filePath);

        if (stats.size > MAX_FILE_SIZE) {
            const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
            const limitMB = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(1);
            console.log(`⚠️ Final file too large: ${fileName} (${sizeMB}MB > ${limitMB}MB)`);
            return { success: false, reason: "too_large" };
        }

        const message = await channel.send({
            files: [{ attachment: filePath, name: fileName }],
        });

        console.log(`📤 Sent: ${fileName} → ${message.id}`);
        markAsSent(dedupKey);

        return { success: true };
    } catch (err) {
        if (err instanceof Error && err.name === "AbortError" && retries > 0) {
            console.log(`⏱️ Retrying ${fileName}...`);
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            return sendFile(channel, filePath, fileName, channelId, retries - 1);
        }

        if (err instanceof Error) {
            console.error(`❌ Error sending ${fileName}:`, err.message);
            return { success: false, reason: err.message };
        }

        console.error(`❌ Error sending ${fileName}:`, err);
        return { success: false, reason: String(err) };
    }
}
