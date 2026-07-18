import sharp from "sharp";
import type { Metadata } from "sharp";
import { WATERMARK_MARGIN, WATERMARK_OPACITY } from "../utils/constants.ts";
import { calculateLogoSize } from "../utils/watermark.ts";

export async function applyImageWatermark(
    logoPath: string,
    inputPath: string,
    outputPath: string
): Promise<void> {
    const metadata: Metadata = await sharp(inputPath).metadata();

    const imgW = metadata.width || 800;
    const imgH = metadata.height || 600;

    const logoWidth = calculateLogoSize(imgW, imgH);

    // 1. Resize logo
    const logoResized = await sharp(logoPath)
        .resize({ width: logoWidth, withoutEnlargement: true, fit: "contain" })
        .ensureAlpha()
        .png()
        .toBuffer();

    // 2. Apply opacity by manipulating alpha channel in raw buffer
    const { data, info } = await sharp(logoResized).raw().toBuffer({ resolveWithObject: true });

    for (let i = 3; i < data.length; i += 4) {
        data[i] = Math.round(data[i] * WATERMARK_OPACITY);
    }

    const logoFinal = await sharp(data, {
        raw: { width: info.width, height: info.height, channels: 4 },
    })
        .png()
        .toBuffer();

    // 3. Position: bottom-right corner with margin
    const logoMeta = await sharp(logoFinal).metadata();

    const left = Math.max(0, imgW - (logoMeta.width || logoWidth) - WATERMARK_MARGIN);
    const top = Math.max(0, imgH - (logoMeta.height || 60) - WATERMARK_MARGIN);

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
