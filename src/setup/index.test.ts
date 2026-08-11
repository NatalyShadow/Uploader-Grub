import { describe, expect, it } from "vitest";

import { getUniqueRoots } from "./index.ts";
import type { ConfigEntry } from "../types/index.ts";

function entry(path: string): ConfigEntry {
    return { path, channelId: "123456" };
}

describe("getUniqueRoots", () => {
    it("extracts the root above images/videos/heavy subfolders", () => {
        const roots = getUniqueRoots([
            entry("/media/vanilla/videos"),
            entry("/media/vanilla/images"),
        ]);
        expect(roots).toEqual(["/media/vanilla"]);
    });

    it("returns the path unchanged when it is not a media subfolder", () => {
        expect(getUniqueRoots([entry("/media/loose")])).toEqual(["/media/loose"]);
    });

    it("deduplicates repeated roots", () => {
        const roots = getUniqueRoots([
            entry("/a/videos"),
            entry("/a/images"),
            entry("/a/heavy"),
            entry("/b/videos"),
        ]);
        expect(roots).toEqual(["/a", "/b"]);
    });

    it("normalises backslashes to forward slashes", () => {
        expect(getUniqueRoots([entry("C:\\media\\videos")])).toEqual(["C:/media"]);
    });

    it("handles the root itself being a media subfolder", () => {
        expect(getUniqueRoots([entry("/media/images")])).toEqual(["/media"]);
    });

    it("skips entries without a path", () => {
        const entries = [
            { path: "/media/videos", channelId: "1" },
            { path: "", channelId: "2" },
        ] as ConfigEntry[];
        expect(getUniqueRoots(entries)).toEqual(["/media"]);
    });
});
