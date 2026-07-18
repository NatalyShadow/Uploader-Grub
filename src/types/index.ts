/**
 * Shared domain types for the Discord uploader bot.
 *
 * These types define the contracts used across config loading,
 * media processing, and Discord messaging.
 */

/** Single entry mapping a local folder to a Discord thread ID. */
export interface ConfigEntry {
    /** Resolved absolute path on disk. */
    path: string;
    /** Discord thread/channel ID (must be a thread). */
    channelId: string;
}

/** Dimensions for watermark sizing calculations. */
export interface Dimensions {
    width: number;
    height: number;
}

/** Categories the organizer can detect. */
export type MediaFolder = "images" | "videos" | "heavy";

/** Result of a single file send attempt. */
export type SendResult = { success: true } | { success: false; reason: string };

/** Stats returned by the loose-file organizer. */
export interface OrganizerStats {
    moved: number;
    skipped: number;
    errors: number;
    heavy: number;
}
