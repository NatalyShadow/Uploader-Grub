/**
 * Minimal type declarations for the `cli-progress` npm package.
 * The package is JavaScript-only and ships no .d.ts files.
 */

declare module "cli-progress" {
    export interface SingleBarOptions {
        format?: string;
        formatTime?: (t: number, options: unknown, roundToMultipleOf: number) => string;
        barCompleteChar?: string;
        barIncompleteChar?: string;
        hideCursor?: boolean;
        clearOnComplete?: boolean;
        stopOnComplete?: boolean;
        fps?: number;
        noTTYOutput?: boolean;
        notTTYSchedule?: number;
        stream?: NodeJS.WriteStream;
        autopadding?: boolean;
        autopaddingChar?: string;
        forceRedraw?: boolean;
        etaAsynchronousUpdate?: boolean;
        etaBufferLength?: number;
    }

    export type PresetName = "legacy" | "shades_classic" | "shades_grey" | "rect";

    export const Presets: Record<PresetName, SingleBarOptions>;

    export class SingleBar {
        constructor(options?: SingleBarOptions, preset?: SingleBarOptions);
        start(total: number, startValue?: number, payload?: Record<string, unknown>): void;
        update(current: number, payload?: Record<string, unknown>): void;
        increment(delta?: number, payload?: Record<string, unknown>): void;
        stop(): void;
        setTotal(total: number): void;
        getTotal(): number;
    }
}
