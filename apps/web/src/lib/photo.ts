// Browser photo quality check and compression (docs/ai-integration.md.txt §8).
// Runs on the device; nothing is uploaded until the shot passes.

export type PhotoCheck =
  { ok: true; blob: Blob; brightness: number } | { ok: false; reason: string };

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Mean luminance (Rec. 601) of a 48×48 downscale. */
function brightnessOf(img: HTMLImageElement): number {
  const c = document.createElement("canvas");
  c.width = 48;
  c.height = 48;
  const g = c.getContext("2d");
  if (!g) return 255;
  g.drawImage(img, 0, 0, 48, 48);
  const d = g.getImageData(0, 0, 48, 48).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    sum += 0.299 * (d[i] ?? 0) + 0.587 * (d[i + 1] ?? 0) + 0.114 * (d[i + 2] ?? 0);
  }
  return sum / (d.length / 4);
}

/** Resize so the longer side is at most 1600 px and re-encode as JPEG (keeps storage small). */
async function compress(img: HTMLImageElement): Promise<Blob> {
  const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.85),
  );
}

export async function checkPhoto(
  file: File,
  rules: { minPx: number; minBrightness: number },
): Promise<PhotoCheck> {
  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    return { ok: false, reason: "That file isn't a photo we can read. Take the photo again." };
  }
  const shorter = Math.min(img.naturalWidth, img.naturalHeight);
  if (shorter < rules.minPx) {
    return {
      ok: false,
      reason: `The photo is ${img.naturalWidth}×${img.naturalHeight}. Move closer so it is at least ${rules.minPx} px on the short side.`,
    };
  }
  const brightness = brightnessOf(img);
  if (brightness < rules.minBrightness) {
    return {
      ok: false,
      reason: "Too dark. Move closer to a window or switch on a light, then retake.",
    };
  }
  return { ok: true, blob: await compress(img), brightness };
}
