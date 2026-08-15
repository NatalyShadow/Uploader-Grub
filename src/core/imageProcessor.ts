import type { Metadata } from "sharp";
import sharp from "sharp";
import { SHARP_CONCURRENCY, WATERMARK_MARGIN, WATERMARK_OPACITY } from "../utils/constants.ts";
import { calculateLogoSize } from "../utils/watermark.ts";

// Cap libvips' worker pool so image watermarking never spikes all CPU cores
// at once. `4` (default) keeps fans calm; raise for well-cooled machines.
sharp.concurrency(SHARP_CONCURRENCY);

export async function applyImageWatermark(
    logoPath: string,
    inputPath: string,
    outputPath: string
): Promise<void> {
    const metadata: Metadata = await sharp(inputPath).metadata();

    const imgW = metadata.width || 800;
    const imgH = metadata.height || 600;

    const logoWidth = calculateLogoSize(imgW, imgH);

    // 1. Resize the logo and read back its actual output size (metadata only
    //    reports the input dims, so `toBuffer({ resolveWithObject: true })`).
    const resized = await sharp(logoPath)
        .resize({ width: logoWidth, withoutEnlargement: true, fit: "contain" })
        .ensureAlpha()
        .png()
        .toBuffer({ resolveWithObject: true });

    // 2. Apply opacity natively: `dest-in` keeps the logo where the overlay
    //    is, scaling the alpha channel by the overlay's own alpha — no manual
    //    pixel loop, no second raw re-encode.
    const logoFinal = await sharp(resized.data)
        .composite([
            {
                input: {
                    create: {
                        width: resized.info.width,
                        height: resized.info.height,
                        channels: 4,
                        background: { r: 255, g: 255, b: 255, alpha: WATERMARK_OPACITY },
                    },
                },
                blend: "dest-in",
            },
        ])
        .png()
        .toBuffer();

    // 3. Position: bottom-right corner with margin
    const left = Math.max(0, imgW - resized.info.width - WATERMARK_MARGIN);
    const top = Math.max(0, imgH - resized.info.height - WATERMARK_MARGIN);

    // 4. Composite
    await sharp(inputPath)
        .composite([
            {
                input: logoFinal,
                top,
                left,
                blend: "over",
            },
        ])
        .toFile(outputPath);
}
