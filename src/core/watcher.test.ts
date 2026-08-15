import { EventEmitter } from "events";
import type { FSWatcher } from "chokidar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";

import { watchRoots } from "./watcher.ts";
import { runPipeline } from "./pipeline.ts";
import { organizeFiles } from "../setup/organizer.ts";
import type { ConfigEntry } from "../types/index.ts";
import type { PipelineOptions } from "./pipeline.ts";

// chokidar is mocked so tests drive the watcher's events directly instead of
// depending on real filesystem notifications.
vi.mock("chokidar", () => ({
    watch: vi.fn(),
}));

vi.mock("./pipeline.ts", () => ({
    runPipeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../setup/organizer.ts", () => ({
    organizeFiles: vi.fn(() => ({ moved: 0, skipped: 0, errors: 0, heavy: 0 })),
}));

const mockWatch = vi.mocked((await import("chokidar")).watch);
const mockRunPipeline = vi.mocked(runPipeline);
const mockOrganizeFiles = vi.mocked(organizeFiles);

let lastWatcher: EventEmitter;
let lastDirs: string[];
let lastOptions: Record<string, unknown>;

const OPTIONS: PipelineOptions = { skipWatermark: false, moveSent: false };

function fakeClient(): Client {
    return {} as unknown as Client;
}

beforeEach(() => {
    vi.useFakeTimers();
    mockWatch.mockReset();
    mockRunPipeline.mockReset();
    mockOrganizeFiles.mockReset();
    mockRunPipeline.mockResolvedValue(undefined);
    mockOrganizeFiles.mockReturnValue({ moved: 0, skipped: 0, errors: 0, heavy: 0 });
    mockWatch.mockImplementation((paths: string | string[], options?: Record<string, unknown>) => {
        lastDirs = Array.isArray(paths) ? paths : [paths];
        lastOptions = options ?? {};
        lastWatcher = new EventEmitter();
        return lastWatcher as unknown as FSWatcher;
    });
});

afterEach(() => {
    vi.useRealTimers();
});

describe("watchRoots", () => {
    it("watches both the roots and every configured subfolder", () => {
        const config: ConfigEntry[] = [
            { path: "/data/cat/videos", channelId: "1" },
            { path: "/data/cat/images", channelId: "2" },
            { path: "/data/dog/videos", channelId: "3" },
        ];
        const roots = ["/data/cat", "/data/dog"];

        watchRoots(fakeClient(), config, "/logo.webp", OPTIONS, roots);

        expect(mockWatch).toHaveBeenCalledTimes(1);
        expect(lastDirs).toEqual(
            expect.arrayContaining([
                "/data/cat",
                "/data/dog",
                "/data/cat/videos",
                "/data/cat/images",
                "/data/dog/videos",
            ])
        );
        expect(lastDirs).toHaveLength(5);
        expect(lastOptions.depth).toBe(0);
    });

    it("ignores dotfiles via the watcher configuration", () => {
        watchRoots(fakeClient(), [], "/logo.webp", OPTIONS, ["/data/cat"]);

        const ignored = lastOptions.ignored as RegExp;
        expect(ignored.test("/data/cat/.hidden.mp4")).toBe(true);
        expect(ignored.test("/data/cat/videos/movie.mp4")).toBe(false);
    });

    it("runs the pipeline when a file lands in a configured subfolder", async () => {
        const config: ConfigEntry[] = [{ path: "/data/cat/videos", channelId: "1" }];
        watchRoots(fakeClient(), config, "/logo.webp", OPTIONS, ["/data/cat"]);

        // The initial scan already ran once; clear it to isolate this event.
        mockRunPipeline.mockClear();
        mockOrganizeFiles.mockClear();

        lastWatcher.emit("add", "/data/cat/videos/new.mp4");
        await vi.advanceTimersByTimeAsync(3000);

        expect(mockOrganizeFiles).toHaveBeenCalledWith("/data/cat");
        expect(mockRunPipeline).toHaveBeenCalledTimes(1);
        expect(mockRunPipeline).toHaveBeenCalledWith(
            expect.anything(),
            config,
            expect.anything(),
            OPTIONS
        );
    });

    it("runs the pipeline even when the organizer moved nothing", async () => {
        const config: ConfigEntry[] = [{ path: "/data/cat/videos", channelId: "1" }];
        // The default mock returns moved: 0 — a file dropped directly into the
        // configured subfolder must still be processed.
        watchRoots(fakeClient(), config, "/logo.webp", OPTIONS, ["/data/cat"]);

        mockRunPipeline.mockClear();

        lastWatcher.emit("add", "/data/cat/videos/straight.mp4");
        await vi.advanceTimersByTimeAsync(3000);

        expect(mockRunPipeline).toHaveBeenCalledTimes(1);
        expect(mockRunPipeline).toHaveBeenCalledWith(
            expect.anything(),
            config,
            expect.anything(),
            OPTIONS
        );
    });

    it("ignores files outside every watched root", async () => {
        const config: ConfigEntry[] = [{ path: "/data/cat/videos", channelId: "1" }];
        watchRoots(fakeClient(), config, "/logo.webp", OPTIONS, ["/data/cat"]);

        mockRunPipeline.mockClear();

        lastWatcher.emit("add", "/unrelated/path/file.mp4");
        await vi.advanceTimersByTimeAsync(3000);

        expect(mockRunPipeline).not.toHaveBeenCalled();
    });

    it("processes roots one at a time (mutex + FIFO queue)", async () => {
        const config: ConfigEntry[] = [
            { path: "/data/a/videos", channelId: "1" },
            { path: "/data/b/videos", channelId: "2" },
        ];
        const roots = ["/data/a", "/data/b"];

        watchRoots(fakeClient(), config, "/logo.webp", OPTIONS, roots);

        // Let the initial scan finish (its queue drain is async) before
        // isolating the events below.
        await vi.advanceTimersByTimeAsync(0);
        mockRunPipeline.mockClear();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let gateUsed = false;
        mockRunPipeline.mockImplementation(() => {
            if (!gateUsed) {
                gateUsed = true;
                return gate;
            }
            return Promise.resolve();
        });

        lastWatcher.emit("add", "/data/a/videos/x.mp4");
        lastWatcher.emit("add", "/data/b/videos/y.mp4");
        await vi.advanceTimersByTimeAsync(3000);

        // Only the first root's pipeline is running; the second is queued.
        expect(mockRunPipeline).toHaveBeenCalledTimes(1);
        expect(mockRunPipeline).toHaveBeenCalledWith(
            expect.anything(),
            [config[0]],
            expect.anything(),
            OPTIONS
        );

        release();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockRunPipeline).toHaveBeenCalledTimes(2);
        expect(mockRunPipeline).toHaveBeenLastCalledWith(
            expect.anything(),
            [config[1]],
            expect.anything(),
            OPTIONS
        );
    });
});
