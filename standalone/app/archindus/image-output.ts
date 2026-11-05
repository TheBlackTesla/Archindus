/** Reject malformed or truncated image messages before creating a preview URL. */
export async function validateGeneratedImage(blob: Blob, dimension = 512): Promise<void> {
  if (!(blob instanceof Blob) || blob.type !== "image/png" || blob.size < 100 || blob.size > 10_000_000) {
    throw new Error("Image generation did not return a valid PNG.");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, i) => bytes[i] === value)) throw new Error("The image output is not a PNG.");
  let offset = 8, hasData = false;
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset);
    if (offset + 12 + size > bytes.length) break;
    let crc = 0xffffffff;
    for (let i = offset + 4; i < offset + 8 + size; i++) {
      crc ^= bytes[i];
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(offset + 8 + size)) throw new Error("The generated image is corrupted. Please retry.");
    const kind = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (offset === 8 && (kind !== "IHDR" || size !== 13 || view.getUint32(offset + 8) !== dimension || view.getUint32(offset + 12) !== dimension)) {
      throw new Error("The image dimensions are invalid.");
    }
    if (kind === "IDAT" && size > 0) hasData = true;
    if (kind === "IEND" && size === 0 && hasData && offset + 12 === bytes.length) return;
    offset += 12 + size;
  }
  throw new Error("The generated image is incomplete. Please retry.");
}
