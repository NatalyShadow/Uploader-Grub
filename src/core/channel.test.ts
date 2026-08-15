import type { Client } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { resolveChannel } from "./channel.ts";

interface FakeChannel {
    name: string;
    isTextBased: () => boolean;
    isDMBased: () => boolean;
    isThread: () => boolean;
    archived: boolean;
    setArchived: ReturnType<typeof vi.fn>;
}

function fakeChannel(overrides: Partial<FakeChannel> = {}): FakeChannel {
    return {
        name: "test-channel",
        isTextBased: () => true,
        isDMBased: () => false,
        isThread: () => false,
        archived: false,
        setArchived: vi.fn(),
        ...overrides,
    };
}

function clientWithFetch(fetch: ReturnType<typeof vi.fn>): Client {
    return { channels: { fetch } } as unknown as Client;
}

describe("resolveChannel", () => {
    it("returns the channel when it is an active text-based channel", async () => {
        const channel = fakeChannel();
        const client = clientWithFetch(vi.fn().mockResolvedValue(channel));

        const resolved = await resolveChannel(client, "111");

        expect(resolved).toBe(channel);
        expect(channel.setArchived).not.toHaveBeenCalled();
    });

    it("returns null when the channel does not exist", async () => {
        const client = clientWithFetch(vi.fn().mockResolvedValue(null));

        expect(await resolveChannel(client, "111")).toBeNull();
    });

    it("returns null for non-text-based channels", async () => {
        const channel = fakeChannel({ isTextBased: () => false });
        const client = clientWithFetch(vi.fn().mockResolvedValue(channel));

        expect(await resolveChannel(client, "111")).toBeNull();
    });

    it("returns null for DM channels", async () => {
        const channel = fakeChannel({ isDMBased: () => true });
        const client = clientWithFetch(vi.fn().mockResolvedValue(channel));

        expect(await resolveChannel(client, "111")).toBeNull();
    });

    it("unarchives archived threads", async () => {
        const channel = fakeChannel({ isThread: () => true, archived: true });
        const client = clientWithFetch(vi.fn().mockResolvedValue(channel));

        const resolved = await resolveChannel(client, "111");

        expect(resolved).toBe(channel);
        expect(channel.setArchived).toHaveBeenCalledWith(false);
    });

    it("does not unarchive active threads", async () => {
        const channel = fakeChannel({ isThread: () => true, archived: false });
        const client = clientWithFetch(vi.fn().mockResolvedValue(channel));

        await resolveChannel(client, "111");

        expect(channel.setArchived).not.toHaveBeenCalled();
    });

    it("returns null when fetching throws", async () => {
        const client = clientWithFetch(vi.fn().mockRejectedValue(new Error("network")));

        expect(await resolveChannel(client, "111")).toBeNull();
    });
});
