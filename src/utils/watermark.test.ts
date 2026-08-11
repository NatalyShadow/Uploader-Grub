import { describe, expect, it } from "vitest";

import { calculateLogoSize } from "./watermark.ts";

describe("calculateLogoSize", () => {
    it("uses 8% of the longest side when within bounds", () => {
        expect(calculateLogoSize(800, 600)).toBe(64);
        expect(calculateLogoSize(600, 800)).toBe(64);
        expect(calculateLogoSize(1000, 800)).toBe(80);
    });

    it("clamps to the minimum size", () => {
        expect(calculateLogoSize(100, 100)).toBe(60);
        expect(calculateLogoSize(0, 0)).toBe(60);
        expect(calculateLogoSize(700, 700)).toBe(60);
    });

    it("clamps to the maximum size", () => {
        expect(calculateLogoSize(3000, 2000)).toBe(200);
        expect(calculateLogoSize(10000, 1)).toBe(200);
    });

    it("rounds to the nearest integer before clamping", () => {
        expect(calculateLogoSize(812, 812)).toBe(65); // 64.96 → 65
        expect(calculateLogoSize(762, 762)).toBe(61); // 60.96 → 61
    });
});
