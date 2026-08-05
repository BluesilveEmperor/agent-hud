// Generate a 256x256 PNG entry for installer/light.ico from its 128x128 entry,
// so electron-builder's >=256px icon requirement is satisfied. All entries in
// the source ico are PNG-in-ICO, so we decode the 128 one, upscale with bilinear
// interpolation, re-encode as PNG, and prepend a new 256 entry. Pure Node +
// zlib, no external deps.
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";

const file = process.argv[2] || "installer/light.ico";
const buf = fs.readFileSync(file);

// ---- parse ICO ----
const count = buf.readUInt16LE(4);
const entries = [];
let p = 6;
for (let i = 0; i < count; i++) {
  const w = buf[p] || 256;
  const h = buf[p + 1] || 256;
  const size = buf.readUInt32LE(p + 8);
  const dataOff = buf.readUInt32LE(p + 12);
  entries.push({ w, h, size, dataOff, data: buf.subarray(dataOff, dataOff + size) });
  p += 16;
}

// ---- PNG decode (8-bit RGBA, color type 6) ----
function decodePng(png) {
  let o = 8; // skip signature
  let width, height, bitDepth, colorType;
  const idat = [];
  while (o < png.length) {
    const len = png.readUInt32BE(o);
    const type = png.toString("ascii", o + 4, o + 8);
    const data = png.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") break;
    o += 12 + len;
  }
  if (colorType !== 6 || bitDepth !== 8) throw new Error(`unsupported PNG colorType=${colorType} bitDepth=${bitDepth}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = 4;
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const ft = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const v = raw[pos++];
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let r;
      if (ft === 0) r = v;
      else if (ft === 1) r = v + a;
      else if (ft === 2) r = v + b;
      else if (ft === 3) r = v + ((a + b) >> 1);
      else if (ft === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        r = v + pr;
      } else r = v;
      out[y * stride + x] = r & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

// ---- bilinear upscale ----
function upscale(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dh * dw * 4);
  for (let y = 0; y < dh; y++) {
    const sy = (y + 0.5) * sh / dh - 0.5;
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)));
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = (x + 0.5) * sw / dw - 0.5;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)));
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = sx - x0;
      for (let c = 0; c < 4; c++) {
        const v00 = src[(y0 * sw + x0) * 4 + c];
        const v10 = src[(y0 * sw + x1) * 4 + c];
        const v01 = src[(y1 * sw + x0) * 4 + c];
        const v11 = src[(y1 * sw + x1) * 4 + c];
        const top = v00 + (v10 - v00) * fx;
        const bot = v01 + (v11 - v01) * fx;
        out[(y * dw + x) * 4 + c] = Math.round(top + (bot - top) * fy) & 0xff;
      }
    }
  }
  return out;
}

// ---- PNG encode (filter type 0 = None) ----
function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // None filter
    rgba.copy ? rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
              : raw.set(rgba.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    const crcVal = crc32(Buffer.concat([t, data])) >>> 0;
    crc.writeUInt32BE(crcVal, 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrChunk = chunk("IHDR", ihdr);
  const idatChunk = chunk("IDAT", idat);
  const iendChunk = chunk("IEND", Buffer.alloc(0));
  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

// CRC32 (PNG)
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- main ----
const srcEntry = entries.reduce((a, b) => (a.w > b.w ? a : b));
const img = decodePng(srcEntry.data);
const up = upscale(img.data, img.width, img.height, 256, 256);
const png256 = encodePng(up, 256, 256);

// Build new ico: 256 entry first (best practice), then originals.
const newEntries = [{ w: 256, h: 256, data: png256 }, ...entries];
let dataOffset = 6 + newEntries.length * 16;
const dirBuf = Buffer.alloc(6 + newEntries.length * 16);
dirBuf.writeUInt16LE(0, 0); // reserved
dirBuf.writeUInt16LE(1, 2); // type = ico
dirBuf.writeUInt16LE(newEntries.length, 4);
let body = [];
newEntries.forEach((e, i) => {
  const off = 6 + i * 16;
  dirBuf[off] = e.w >= 256 ? 0 : e.w;
  dirBuf[off + 1] = e.h >= 256 ? 0 : e.h;
  dirBuf[off + 2] = 0; // palette
  dirBuf[off + 3] = 0;
  dirBuf.writeUInt16LE(1, off + 4); // planes
  dirBuf.writeUInt16LE(32, off + 6); // bpp
  dirBuf.writeUInt32LE(e.data.length, off + 8);
  dirBuf.writeUInt32LE(dataOffset, off + 12);
  body.push(e.data);
  dataOffset += e.data.length;
});
const out = Buffer.concat([dirBuf, ...body]);
fs.writeFileSync(file, out);
console.log(`wrote ${file}: ${newEntries.length} entries (added 256x256)`);
