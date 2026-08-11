import { describe, expect, it } from "vitest";

import { runCommand, TimeoutError, ProcessError } from "./process.ts";

const ECHO_CODE = "-e";

describe("runCommand", () => {
    it("resolves with the captured stdout on success", async () => {
        const { stdout, stderr } = await runCommand({
            command: process.execPath,
            args: [ECHO_CODE, "console.log('hello')"],
            timeoutMs: 5000,
            label: "echo",
        });
        expect(stdout).toContain("hello");
        expect(stderr).toBe("");
    });

    it("rejects with ProcessError carrying the exit code", async () => {
        const err: unknown = await runCommand({
            command: process.execPath,
            args: [ECHO_CODE, "process.exit(3)"],
            timeoutMs: 5000,
            label: "failing",
        }).catch((e: unknown) => e);

        expect(err).toBeInstanceOf(ProcessError);
        if (err instanceof ProcessError) {
            expect(err.code).toBe(3);
        }
    });

    it("rejects with TimeoutError when the command exceeds the timeout", async () => {
        const promise = runCommand({
            command: process.execPath,
            args: [ECHO_CODE, "setTimeout(() => {}, 100000)"],
            timeoutMs: 300,
            label: "sleepy",
        });
        await expect(promise).rejects.toBeInstanceOf(TimeoutError);
    });

    it("forwards stdout chunks to the onStdout callback", async () => {
        const chunks: string[] = [];
        await runCommand({
            command: process.execPath,
            args: [ECHO_CODE, "process.stdout.write('abc')"],
            timeoutMs: 5000,
            label: "chunks",
            onStdout(chunk) {
                chunks.push(chunk);
            },
        });
        expect(chunks.join("")).toContain("abc");
    });
});

describe("TimeoutError", () => {
    it("carries the label in the message", () => {
        const err = new TimeoutError("my-label");
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe("TimeoutError");
        expect(err.message).toBe("my-label timed out");
    });
});

describe("ProcessError", () => {
    it("exposes code and stderr", () => {
        const err = new ProcessError("my-label", 2, "boom");
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe("ProcessError");
        expect(err.code).toBe(2);
        expect(err.stderr).toBe("boom");
        expect(err.message).toBe("my-label exited with code 2");
    });
});
