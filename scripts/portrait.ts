import { removeBackground } from "@imgly/background-removal-node";
import sharp from "sharp";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { readdirSync } from "fs";

const SRC_DIR = "scripts/source";
const OUT_DIR = "public/portraits";
const SIZE = 320; // dithering grid size
const FULL_WIDTH = 480; // displayed image width

// --- Atkinson dithering ---
function atkinson(pixels: Uint8Array, w: number, h: number) {
  const buf = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) buf[i] = pixels[i];
  const out = new Uint8Array(pixels.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = buf[i];
      const newPx = old < 128 ? 0 : 255;
      out[i] = newPx;
      const err = (old - newPx) / 8;
      const add = (dx: number, dy: number) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) buf[ny * w + nx] += err;
      };
      add(1, 0); add(2, 0);
      add(-1, 1); add(0, 1); add(1, 1);
      add(0, 2);
    }
  }
  return out;
}

async function processOne(srcPath: string, basename: string) {
  console.log(`[${basename}] removing background...`);
  const srcUrl = pathToFileURL(resolve(srcPath));
  const blob = await removeBackground(srcUrl);
  const fgBuffer = Buffer.from(await blob.arrayBuffer());

  // 1. Dithered B&W of full image, upscaled to FULL_WIDTH with pixelated edges
  const { data: grayData, info } = await sharp(srcPath)
    .resize({ width: SIZE, fit: "cover", position: "attention" })
    .grayscale()
    .normalise()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const dithered = atkinson(new Uint8Array(grayData), info.width, info.height);

  // Convert to opaque black-bg image: white pixels stay white, black pixels become black
  const ditheredRgb = new Uint8Array(info.width * info.height * 3);
  for (let i = 0; i < info.width * info.height; i++) {
    const v = dithered[i];
    ditheredRgb[i * 3 + 0] = v;
    ditheredRgb[i * 3 + 1] = v;
    ditheredRgb[i * 3 + 2] = v;
  }

  // Upscale to FULL_WIDTH while preserving square pixels (nearest-neighbor)
  const ditheredOpaqueBuf = await sharp(ditheredRgb, {
    raw: { width: info.width, height: info.height, channels: 3 },
  })
    .resize({ width: FULL_WIDTH, kernel: "nearest" })
    .png()
    .toBuffer();

  // Resize foreground to match FULL_WIDTH — same crop region as the dither
  // Use cover with attention to match what the dither sees
  const fgResized = await sharp(fgBuffer)
    .resize({ width: FULL_WIDTH, fit: "cover", position: "attention" })
    .png()
    .toBuffer();

  // Composite: dithered bg + color fg on top
  await sharp(ditheredOpaqueBuf)
    .composite([{ input: fgResized, blend: "over" }])
    .webp({ quality: 85 })
    .toFile(`${OUT_DIR}/${basename}-composite.webp`);
  console.log(`[${basename}] wrote ${basename}-composite.webp`);

  // 2. Full color image, same crop
  await sharp(srcPath)
    .resize({ width: FULL_WIDTH, fit: "cover", position: "attention" })
    .webp({ quality: 85 })
    .toFile(`${OUT_DIR}/${basename}-color.webp`);
  console.log(`[${basename}] wrote ${basename}-color.webp`);
}

async function main() {
  const files = readdirSync(SRC_DIR).filter((f) => /\.(jpe?g|png)$/i.test(f));
  for (const file of files) {
    const basename = file.replace(/\.[^.]+$/, "");
    await processOne(`${SRC_DIR}/${file}`, basename);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
