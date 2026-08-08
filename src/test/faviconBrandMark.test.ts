import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { resolve } from 'node:path';

/**
 * The app shipped for months with the default Lovable scaffold icon at
 * public/favicon.ico — an orange/blue gradient heart — while public/favicon.png
 * held the real Verdanote leaf mark. index.html only referenced the .png, so the
 * mismatch stayed invisible in the app itself, but browsers and crawlers probe
 * /favicon.ico by convention and rendered someone else's logo.
 *
 * These tests pin the .ico to the same brand mark as the .png, structurally and
 * by colour, so a stale or scaffold icon can't silently come back.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const publicFile = (name: string) => resolve(__dirname, '../../public', name);

interface IcoEntry {
  width: number;
  height: number;
  bitsPerPixel: number;
  data: Buffer;
}

function parseIco(buffer: Buffer): IcoEntry[] {
  const reserved = buffer.readUInt16LE(0);
  const type = buffer.readUInt16LE(2);
  const count = buffer.readUInt16LE(4);
  if (reserved !== 0 || type !== 1) {
    throw new Error('not a valid ICO container');
  }

  return Array.from({ length: count }, (_, i) => {
    const offset = 6 + 16 * i;
    // A stored dimension of 0 means 256 in the ICO format.
    const width = buffer.readUInt8(offset) || 256;
    const height = buffer.readUInt8(offset + 1) || 256;
    const bitsPerPixel = buffer.readUInt16LE(offset + 6);
    const size = buffer.readUInt32LE(offset + 8);
    const dataOffset = buffer.readUInt32LE(offset + 12);
    return { width, height, bitsPerPixel, data: buffer.subarray(dataOffset, dataOffset + size) };
  });
}

/** Decode a non-interlaced 8-bit RGBA PNG far enough to sample its pixels. */
function decodeRgbaPng(png: Buffer): { width: number; height: number; pixels: Buffer } {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG');
  }

  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const bitDepth = png.readUInt8(24);
  const colourType = png.readUInt8(25);
  const interlace = png.readUInt8(28);
  if (bitDepth !== 8 || colourType !== 6 || interlace !== 0) {
    throw new Error(`unsupported PNG: depth=${bitDepth} colour=${colourType} interlace=${interlace}`);
  }

  const idat: Buffer[] = [];
  let cursor = 8;
  while (cursor < png.length) {
    const length = png.readUInt32BE(cursor);
    const chunkType = png.toString('ascii', cursor + 4, cursor + 8);
    if (chunkType === 'IDAT') idat.push(png.subarray(cursor + 8, cursor + 8 + length));
    if (chunkType === 'IEND') break;
    cursor += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const pixels = Buffer.alloc(height * stride);

  // Undo the per-scanline PNG filters (spec section 9.2).
  for (let y = 0; y < height; y += 1) {
    const filter = raw.readUInt8(y * (stride + 1));
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bytesPerPixel ? pixels[y * stride + x - bytesPerPixel] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= bytesPerPixel && y > 0 ? pixels[(y - 1) * stride + x - bytesPerPixel] : 0;
      const value = line[x];
      let recon: number;
      switch (filter) {
        case 0: recon = value; break;
        case 1: recon = value + a; break;
        case 2: recon = value + b; break;
        case 3: recon = value + Math.floor((a + b) / 2); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          recon = value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unknown PNG filter ${filter}`);
      }
      pixels[y * stride + x] = recon & 0xff;
    }
  }

  return { width, height, pixels };
}

/** Mean colour of the opaque, non-near-white pixels — i.e. the mark itself. */
function markColour(png: Buffer): { r: number; g: number; b: number } {
  const { width, height, pixels } = decodeRgbaPng(png);
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < width * height; i += 1) {
    const [pr, pg, pb, pa] = [pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2], pixels[i * 4 + 3]];
    if (pa < 200) continue;
    if (pr > 230 && pg > 230 && pb > 230) continue;
    r += pr; g += pg; b += pb; n += 1;
  }
  if (n === 0) throw new Error('icon has no opaque non-white pixels');
  return { r: r / n, g: g / n, b: b / n };
}

describe('favicon.ico carries the Verdanote brand mark', () => {
  const ico = readFileSync(publicFile('favicon.ico'));
  const brandPng = readFileSync(publicFile('favicon.png'));
  const entries = parseIco(ico);

  it('is a valid ICO container with at least one entry', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('embeds the classic favicon sizes browsers request', () => {
    const sizes = entries.map((e) => e.width);
    for (const expected of [16, 32, 48]) {
      expect(sizes).toContain(expected);
    }
  });

  it('stores every entry as a PNG whose real dimensions match its directory entry', () => {
    for (const entry of entries) {
      expect(entry.data.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
      expect(entry.data.readUInt32BE(16)).toBe(entry.width);
      expect(entry.data.readUInt32BE(20)).toBe(entry.height);
      expect(entry.width).toBeLessThanOrEqual(256);
      expect(entry.height).toBeLessThanOrEqual(256);
    }
  });

  it('renders the same green mark as favicon.png, not a scaffold icon', () => {
    const brand = markColour(brandPng);
    const largest = entries.reduce((a, b) => (b.width > a.width ? b : a));
    const actual = markColour(largest.data);

    // Same mark, so the mean mark colour should land within a small distance.
    const distance = Math.hypot(actual.r - brand.r, actual.g - brand.g, actual.b - brand.b);
    expect(distance).toBeLessThan(30);

    // And the Verdanote mark is green-dominant — the Lovable scaffold heart it
    // replaced was an orange/blue gradient, which fails both of these.
    expect(actual.g).toBeGreaterThan(actual.r);
    expect(actual.g).toBeGreaterThan(actual.b);
  });
});
