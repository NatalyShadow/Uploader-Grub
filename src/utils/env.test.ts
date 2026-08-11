import { afterEach, describe, expect, it, vi } from "vitest";

import { expandEnvVars } from "./env.ts";

describe("expandEnvVars", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("expands $VAR references", () => {
        vi.stubEnv("MEDIA_HOME", "/data");
        expect(expandEnvVars("$MEDIA_HOME/videos")).toBe("/data/videos");
        expect(expandEnvVars("$MEDIA_HOME")).toBe("/data");
    });

    it("expands %VAR% references (Windows style)", () => {
        vi.stubEnv("MEDIA_HOME", "/data");
        expect(expandEnvVars("%MEDIA_HOME%/images")).toBe("/data/images");
    });

    it("expands unknown variables to an empty string", () => {
        expect(expandEnvVars("$DOES_NOT_EXIST/path")).toBe("/path");
        expect(expandEnvVars("%DOES_NOT_EXIST%")).toBe("");
    });

    it("expands multiple variables in the same path", () => {
        vi.stubEnv("A", "/one");
        vi.stubEnv("B", "/two");
        expect(expandEnvVars("$A/sub$B")).toBe("/one/sub/two");
    });

    it("leaves paths without variables untouched", () => {
        expect(expandEnvVars("/plain/path")).toBe("/plain/path");
        expect(expandEnvVars("")).toBe("");
    });
});
