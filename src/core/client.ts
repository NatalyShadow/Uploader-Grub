import { Client } from "discord.js";
import { DISCORD_INTENTS } from "../utils/constants.ts";

export function initClient(): Client {
    return new Client({ intents: [...DISCORD_INTENTS] });
}
