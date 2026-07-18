import { WATERMARK_HEIGHT_RATIO, WATERMARK_MIN_SIZE, WATERMARK_MAX_SIZE } from "./constants.ts";

export function calculateLogoSize(width: number, height: number): number {
    const maxDim = Math.max(width, height);
    const ideal = Math.round(maxDim * WATERMARK_HEIGHT_RATIO);
    return Math.max(WATERMARK_MIN_SIZE, Math.min(WATERMARK_MAX_SIZE, ideal));
}
