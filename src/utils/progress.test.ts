import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProgressTracker } from "./progress.ts";

describe("createProgressTracker", () => {
    let writeSpy: MockInstance;

    beforeEach(() => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("falls back to a plain log when the duration is unknown", () => {
        const tracker = createProgressTracker("unknown.mp4", 0);
        tracker.update(10);
        tracker.complete();

        expect(writeSpy).not.toHaveBeenCalled();
        expect(console.log).toHaveBeenCalledWith("✅ unknown.mp4 done");
    });

    it("renders a bar that reaches 100% with the total time", () => {
        const tracker = createProgressTracker("clip.mp4", 100);

        tracker.update(0);
        expect(writeSpy).not.toHaveBeenCalled(); // 0% is throttled

        tracker.update(50);
        expect(writeSpy).toHaveBeenCalledTimes(1);

        tracker.update(100);
        tracker.complete();

        const output = writeSpy.mock.calls.map((call) => String(call[0])).join("");
        expect(output).toContain("100%");
        expect(output).toContain("1:40/1:40");
        expect(output).toContain("|");
        expect(console.log).toHaveBeenCalledWith("✅ clip.mp4 done (1:40)");
    });

    it("clamps percentages above the total duration", () => {
        const tracker = createProgressTracker("clip.mp4", 100);
        tracker.update(500); // beyond total → 100%
        const output = writeSpy.mock.calls.map((call) => String(call[0])).join("");
        expect(output).toContain("100%");
    });
});
