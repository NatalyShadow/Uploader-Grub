/**
 * Single-line progress tracker.
 *
 * Writes progress text to a stream using carriage returns so each update
 * overwrites the previous one in place. In a TTY (`docker logs -f`,
 * `make up` direct) the bar animates smoothly on a single line; in a
 * non-TTY viewer that does not interpret `\r`, the events are still
 * readable, just not animated.
 */
export interface ProgressTracker {
    update(elapsedSeconds: number): void;
    complete(): void;
    fail(): void;
}

const BAR_WIDTH = 15;
const FILL_CHAR = "\u2588";
const EMPTY_CHAR = "\u2591";

function formatHMS(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

function truncate(s: string, max: number): string {
    return s.length <= max ? s : `${s.slice(0, max - 1)}\u2026`;
}

function renderBar(percent: number): string {
    const filled = Math.round((percent / 100) * BAR_WIDTH);
    return FILL_CHAR.repeat(filled) + EMPTY_CHAR.repeat(BAR_WIDTH - filled);
}

/**
 * Writes text to a single line, overwriting previous content with \r.
 * Pads each write to the longest text ever written so no leftover
 * characters remain visible from a longer previous line.
 */
class SingleLineWriter {
    private maxLength = 0;

    constructor(private readonly stream: NodeJS.WriteStream = process.stdout) {}

    write(text: string): void {
        if (text.length > this.maxLength) this.maxLength = text.length;
        const padded = text + " ".repeat(this.maxLength - text.length);
        this.stream.write(`\r${padded}`);
    }

    finish(text: string): void {
        this.write(text);
        this.stream.write("\n");
        this.maxLength = 0;
    }

    clear(): void {
        this.stream.write(`\r${" ".repeat(this.maxLength)}\r`);
        this.maxLength = 0;
    }
}

export function createProgressTracker(label: string, totalSeconds: number): ProgressTracker {
    const shortLabel = truncate(label, 22);

    // No known duration — fall back to a static log, no bar
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
        console.log(`⏳ Processing ${shortLabel}...`);
        return {
            update() {
                // no-op
            },
            complete() {
                console.log(`✅ ${shortLabel} done`);
            },
            fail() {
                console.log(`❌ ${shortLabel} failed`);
            },
        };
    }

    const totalTime = formatHMS(totalSeconds);
    const writer = new SingleLineWriter();
    let lastPercent = -1;
    let finished = false;

    function buildLine(percent: number, currentTime: string): string {
        return `\u23F3 ${shortLabel} |${renderBar(percent)}| ${percent}% | ${currentTime}/${totalTime}`;
    }

    return {
        update(elapsedSeconds) {
            if (finished) return;
            const safe = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
            const percent = Math.min(100, Math.floor((safe / totalSeconds) * 100));
            // Throttle to every 5% to avoid coalescing when writes happen faster
            // than the TTY/log-driver can render. Always allow 100% through.
            if (percent === 100 || percent - lastPercent >= 5) {
                lastPercent = percent;
                writer.write(buildLine(percent, formatHMS(safe)));
            }
        },
        complete() {
            if (finished) return;
            finished = true;
            writer.finish(buildLine(100, totalTime));
            console.log(`✅ ${shortLabel} done (${totalTime})`);
        },
        fail() {
            if (finished) return;
            finished = true;
            writer.clear();
            console.log(`❌ ${shortLabel} failed`);
        },
    };
}
