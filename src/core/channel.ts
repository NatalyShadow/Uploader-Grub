import type { Client, GuildTextBasedChannel } from "discord.js";

export async function resolveChannel(
    client: Client,
    channelId: string
): Promise<GuildTextBasedChannel | null> {
    try {
        const channel = await client.channels.fetch(channelId);

        if (!channel) {
            console.log(`❌ Channel not found: ${channelId}`);
            return null;
        }

        if (!channel.isTextBased()) {
            console.log(`⚠️ ${channelId} is not a text-based channel`);
            return null;
        }

        if (channel.isDMBased()) {
            console.log(`⚠️ ${channelId} is a DM channel, not supported`);
            return null;
        }

        if (channel.isThread() && channel.archived) {
            console.log(`♻️ Reactivating ${channel.name}`);
            await channel.setArchived(false);
        }

        console.log(`✅ Connected to ${channel.name}`);
        return channel;
    } catch (err) {
        if (err instanceof Error) {
            console.log(`❌ Error accessing channel ${channelId}:`, err.message);
        }
        return null;
    }
}
