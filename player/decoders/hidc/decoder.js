const HIDC = 0x43444948;

function readU32(view, offset) { return view.getUint32(offset, true); }

function readVarUint(view, state) {
  let value = 0;
  for (let shift = 0; shift <= 28; shift += 7) {
    if (state.offset >= view.byteLength) throw new Error("HIDC varuint ended early");
    const byte = view.getUint8(state.offset++);
    value |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) return value >>> 0;
  }
  throw new Error("HIDC varuint is invalid");
}

function takeBytes(view, state, length) {
  if (state.offset + length > view.byteLength) throw new Error("HIDC frame payload ended early");
  const bytes = new Uint8Array(view.buffer, view.byteOffset + state.offset, length);
  state.offset += length;
  return new Uint8Array(bytes);
}

function parseHeader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 24 || readU32(view, 0) !== HIDC) throw new Error("Invalid HIDC magic");
  const version = readU32(view, 4);
  if (version !== 2 && version !== 3) throw new Error(`Unsupported HIDC version ${version}`);
  let offset = 8;
  const textureEncoding = version === 3 ? view.getUint8(offset++) : 0;
  const width = readU32(view, offset);
  const height = readU32(view, offset + 4);
  const firstFrameIndex = readU32(view, offset + 8);
  const frameCount = readU32(view, offset + 12);
  return { version, textureEncoding, width, height, firstFrameIndex, frameCount, dataOffset: offset + 16 };
}

function decodeFrame(bytes, targetFrameIndex) {
  const header = parseHeader(bytes);
  if (targetFrameIndex < header.firstFrameIndex || targetFrameIndex >= header.firstFrameIndex + header.frameCount) {
    throw new Error(`Frame ${targetFrameIndex} is outside HIDC chunk`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const blockBytes = 8;
  const blocksX = Math.ceil(header.width / 4);
  const blocksY = Math.ceil(header.height / 4);
  const dataSize = blocksX * blocksY * blockBytes;
  const totalBlocks = blocksX * blocksY;
  const state = { offset: header.dataOffset };
  const localTarget = targetFrameIndex - header.firstFrameIndex;
  const frames = [];
  for (let frame = 0; frame <= localTarget; frame += 1) {
    const kind = state.offset < bytes.byteLength ? bytes[state.offset++] : -1;
    if (kind === 0) {
      frames[frame] = takeBytes(view, state, dataSize);
      if (frame !== 0) throw new Error("HIDC keyframe is not first");
    } else if (kind === 2 || kind === 1) {
      const distance = readVarUint(view, state);
      if (distance < 1 || distance > frame || !frames[frame - distance]) throw new Error("HIDC frame reference is invalid");
      if (kind === 2) frames[frame] = frames[frame - distance];
      else {
        const next = new Uint8Array(frames[frame - distance]);
        const runCount = readVarUint(view, state);
        if (!runCount || runCount > totalBlocks) throw new Error("HIDC sparse run count is invalid");
        let blockIndex = 0;
        for (let run = 0; run < runCount; run += 1) {
          blockIndex += readVarUint(view, state);
          const changed = readVarUint(view, state);
          if (!changed || blockIndex + changed > totalBlocks) throw new Error("HIDC sparse run is invalid");
          next.set(takeBytes(view, state, changed * blockBytes), blockIndex * blockBytes);
          blockIndex += changed;
        }
        frames[frame] = next;
      }
    } else throw new Error(`HIDC frame kind ${kind} is invalid`);
  }
  return { header, compressed: frames[localTarget] };
}

function rgb565(value) {
  return [((value >> 11) & 0x1f) * 255 / 31, ((value >> 5) & 0x3f) * 255 / 63, (value & 0x1f) * 255 / 31];
}

function dxt1ToRgba(compressed, width, height, flipY) {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const block = new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength);
  for (let by = 0; by < blocksY; by += 1) for (let bx = 0; bx < blocksX; bx += 1) {
    const offset = (by * blocksX + bx) * 8;
    const c0 = block.getUint16(offset, true);
    const c1 = block.getUint16(offset + 2, true);
    const a = rgb565(c0); const b = rgb565(c1);
    const colors = [a, b, [(2 * a[0] + b[0]) / 3, (2 * a[1] + b[1]) / 3, (2 * a[2] + b[2]) / 3], [(a[0] + 2 * b[0]) / 3, (a[1] + 2 * b[1]) / 3, (a[2] + 2 * b[2]) / 3]];
    if (c0 <= c1) colors[3] = [0, 0, 0, 0];
    const indices = block.getUint32(offset + 4, true);
    for (let py = 0; py < 4; py += 1) for (let px = 0; px < 4; px += 1) {
      const x = bx * 4 + px; const sourceY = by * 4 + py;
      if (x >= width || sourceY >= height) continue;
      const y = flipY ? height - 1 - sourceY : sourceY;
      const color = colors[(indices >> (2 * (py * 4 + px))) & 3];
      const dst = (y * width + x) * 4;
      rgba[dst] = color[0]; rgba[dst + 1] = color[1]; rgba[dst + 2] = color[2]; rgba[dst + 3] = color.length > 3 ? color[3] : 255;
    }
  }
  return rgba;
}

export function renderHidcFrame(bytes, frameIndex, canvas, flipY = true) {
  const { header, compressed } = decodeFrame(bytes, frameIndex);
  const rgba = dxt1ToRgba(compressed, header.width, header.height, flipY);
  canvas.width = header.width;
  canvas.height = header.height;
  const context = canvas.getContext("2d", { alpha: false });
  context.putImageData(new ImageData(rgba, header.width, header.height), 0, 0);
  return header;
}
