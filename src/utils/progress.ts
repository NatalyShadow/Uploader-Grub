import { Presets, SingleBar } from "cli-progress";

/**
 * Minimal interface to drive a progress indicator from ffmpeg's
 * `-progress pipe:1` output. Two flavours:
 *  - With a known total: renders a single-line bar with %, ETA, etc.
 *  - Without a total: prints a static "Procesando X..." line.
 */
export interface ProgressTracker {
    update(elapsedSeconds: number): void;
    complete(): void;
    fail(): void;
}

function formatHMS(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Custom time formatter for cli-progress: M:SS instead of the default 1m30s.
 * Applied to `{duration_formatted}` and `{eta_formatted}` placeholders.
 */
function formatTimeMSS(t: number): string {
    return formatHMS(t);
}

/**
 * Wraps cli-progress to display a progress bar for a long-running task.
 * The bar auto-closes when complete() is called.
 */
export function createProgressTracker(label: string, totalSeconds: number): ProgressTracker {
    // Without a known total we cannot compute %, so fall back to a static log.
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
        console.log(`⏳ Procesando ${label}...`);
        return {
            update() {
                // no-op
            },
            complete() {
                console.log(`✅ ${label} listo`);
            },
            fail() {
                console.log(`❌ ${label} falló`);
            },
        };
    }

    const total = Math.max(1, Math.ceil(totalSeconds));
    const totalTime = formatHMS(totalSeconds);

    const bar = new SingleBar(
        {
            format: `⏳ {label} |{bar}| {percentage}% | {current_time}/{total_time} | ETA: {eta_formatted}`,
            formatTime: formatTimeMSS,
            barCompleteChar: "\u2588",
            barIncompleteChar: "\u2591",
            hideCursor: true,
            clearOnComplete: false,
            stopOnComplete: true,
            fps: 5,
            // Render the bar even when stdout/stderr is not a TTY (e.g. Docker).
            // In TTY mode the cursor-based redraw still works; in non-TTY mode
            // each update becomes a new line in the log.
            noTTYOutput: true,
            notTTYSchedule: 2000,
        },
        Presets.shades_classic
    );

    bar.start(total, 0, { label, current_time: "0:00", total_time: totalTime });

    return {
        update(elapsedSeconds) {
            const safeSeconds = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
            const value = Math.min(Math.max(0, Math.ceil(safeSeconds)), total);
            bar.update(value, { current_time: formatHMS(safeSeconds) });
        },
        complete() {
            // update() with value=total triggers stopOnComplete auto-stop
            bar.update(total, { current_time: totalTime });
            console.log(`✅ ${label} listo (${totalTime})`);
        },
        fail() {
            bar.stop();
            console.log(`❌ ${label} falló`);
        },
    };
}
