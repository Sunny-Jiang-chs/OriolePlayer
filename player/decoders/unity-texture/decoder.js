const FORMATS = new Map([[1, "Alpha8"], [3, "RGB24"], [4, "RGBA32"], [5, "ARGB32"], [10, "DXT1"], [12, "DXT5"]]);
const MAX_SIDE = 16384;
const MAX_PIXELS = 64 * 1024 * 1024;
const ALPHA_DIVISORS = Array.from({ length: 16 }, (_, index) => 2 ** (index * 3));

function dimensions(width, height, label) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`${label}尺寸必须为正整数像素：${width} × ${height}`);
  }
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
    throw new Error(`${label}尺寸超出支持范围：单边最多 ${MAX_SIDE}，总像素最多 ${MAX_PIXELS}`);
  }
}

function payloadBytes(bytes) {
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (bytes instanceof Uint8Array || bytes instanceof Uint8ClampedArray) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  throw new Error("Unity 纹理载荷必须是字节数组");
}

function pixelBuffer(width, height) {
  try { return new Uint8ClampedArray(width * height * 4); }
  catch { throw new Error(`无法分配纹理像素缓冲：${width} × ${height}`); }
}

function rgb565(value, colors, offset) {
  const red = (value >>> 11) & 31;
  const green = (value >>> 5) & 63;
  const blue = value & 31;
  colors[offset] = (red << 3) | (red >>> 2);
  colors[offset + 1] = (green << 2) | (green >>> 4);
  colors[offset + 2] = (blue << 3) | (blue >>> 2);
  colors[offset + 3] = 255;
}

function colorPalette(view, offset, colors, allowTransparency) {
  const first = view.getUint16(offset, true);
  const second = view.getUint16(offset + 2, true);
  rgb565(first, colors, 0);
  rgb565(second, colors, 4);
  const transparent = allowTransparency && first <= second;
  for (let channel = 0; channel < 3; channel += 1) {
    const a = colors[channel];
    const b = colors[4 + channel];
    colors[8 + channel] = Math.floor(transparent ? (a + b) / 2 : (2 * a + b) / 3);
    colors[12 + channel] = transparent ? 0 : Math.floor((a + 2 * b) / 3);
  }
  colors[11] = 255;
  colors[15] = transparent ? 0 : 255;
}

function alphaPalette(first, second, alpha) {
  alpha[0] = first;
  alpha[1] = second;
  if (first > second) {
    for (let index = 1; index <= 6; index += 1) alpha[index + 1] = Math.floor(((7 - index) * first + index * second) / 7);
  } else {
    for (let index = 1; index <= 4; index += 1) alpha[index + 1] = Math.floor(((5 - index) * first + index * second) / 5);
    alpha[6] = 0;
    alpha[7] = 255;
  }
}

function decodeDxt(bytes, width, height, format, flipY, output) {
  const dxt5 = format === 12;
  const blockBytes = dxt5 ? 16 : 8;
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const colors = new Uint8Array(16);
  const alpha = new Uint8Array(8);
  for (let by = 0; by < blocksY; by += 1) {
    for (let bx = 0; bx < blocksX; bx += 1) {
      const offset = (by * blocksX + bx) * blockBytes;
      const colorOffset = offset + (dxt5 ? 8 : 0);
      colorPalette(view, colorOffset, colors, !dxt5);
      const indices = view.getUint32(colorOffset + 4, true);
      let alphaBits = 0;
      if (dxt5) {
        alphaPalette(bytes[offset], bytes[offset + 1], alpha);
        alphaBits = view.getUint32(offset + 2, true) + view.getUint16(offset + 6, true) * 4294967296;
      }
      for (let py = 0; py < 4; py += 1) {
        const sourceY = by * 4 + py;
        if (sourceY >= height) continue;
        const y = flipY ? height - 1 - sourceY : sourceY;
        for (let px = 0; px < 4; px += 1) {
          const x = bx * 4 + px;
          if (x >= width) continue;
          const pixel = py * 4 + px;
          const color = ((indices >>> (pixel * 2)) & 3) * 4;
          const target = (y * width + x) * 4;
          output[target] = colors[color];
          output[target + 1] = colors[color + 1];
          output[target + 2] = colors[color + 2];
          output[target + 3] = dxt5 ? alpha[Math.floor(alphaBits / ALPHA_DIVISORS[pixel]) & 7] : colors[color + 3];
        }
      }
    }
  }
}

function decodeRaw(bytes, width, height, format, flipY, output) {
  const stride = format === 1 ? 1 : format === 3 ? 3 : 4;
  for (let sourceY = 0; sourceY < height; sourceY += 1) {
    const y = flipY ? height - 1 - sourceY : sourceY;
    for (let x = 0; x < width; x += 1) {
      const source = (sourceY * width + x) * stride;
      const target = (y * width + x) * 4;
      if (format === 1) {
        output[target] = output[target + 1] = output[target + 2] = 255;
        output[target + 3] = bytes[source];
      } else if (format === 5) {
        output[target] = bytes[source + 1];
        output[target + 1] = bytes[source + 2];
        output[target + 2] = bytes[source + 3];
        output[target + 3] = bytes[source];
      } else {
        output[target] = bytes[source];
        output[target + 1] = bytes[source + 1];
        output[target + 2] = bytes[source + 2];
        output[target + 3] = format === 4 ? bytes[source + 3] : 255;
      }
    }
  }
}

function spriteLayout(sprite, textureWidth, textureHeight, flipY) {
  if (sprite == null) return null;
  if (typeof sprite !== "object" || Array.isArray(sprite)) throw new Error("Sprite 配置必须是对象");
  if ((sprite.rotation ?? 0) !== 0) throw new Error(`尚不支持 Sprite 旋转或翻转：rotation=${sprite.rotation}`);
  const rect = sprite.rect;
  if (!rect || typeof rect !== "object") throw new Error("Sprite 缺少纹理裁切 rect");
  dimensions(rect.width, rect.height, "Sprite 裁切");
  if (!Number.isInteger(rect.x) || !Number.isInteger(rect.y) || rect.x < 0 || rect.y < 0
      || rect.x + rect.width > textureWidth || rect.y + rect.height > textureHeight) {
    throw new Error("Sprite rect 必须使用纹理范围内的整数像素坐标");
  }
  const width = sprite.canvasWidth ?? rect.width;
  const height = sprite.canvasHeight ?? rect.height;
  dimensions(width, height, "Sprite 画布");
  const offsetX = sprite.offset?.x ?? 0;
  const offsetY = sprite.offset?.y ?? 0;
  if (!Number.isInteger(offsetX) || !Number.isInteger(offsetY) || offsetX < 0 || offsetY < 0
      || offsetX + rect.width > width || offsetY + rect.height > height) {
    throw new Error("Sprite offset 必须使裁切图完整落在原始画布内");
  }
  return {
    width, height, copyWidth: rect.width, copyHeight: rect.height,
    sourceX: rect.x, sourceY: flipY ? textureHeight - rect.y - rect.height : rect.y,
    targetX: offsetX, targetY: flipY ? height - offsetY - rect.height : offsetY
  };
}

/** Decode only the highest mip, then restore the Sprite's transparent margins. */
export function decodeUnityTexture(bytes, options = {}) {
  const payload = payloadBytes(bytes);
  const format = options.textureFormat;
  if (!FORMATS.has(format)) throw new Error(`尚不支持 Unity TextureFormat：${format}`);
  const width = options.textureWidth;
  const height = options.textureHeight;
  dimensions(width, height, "Unity 纹理");
  const flipY = options.flipY ?? true;
  if (typeof flipY !== "boolean") throw new Error("Unity 纹理 flipY 必须为布尔值");
  const required = format === 10 || format === 12
    ? Math.ceil(width / 4) * Math.ceil(height / 4) * (format === 10 ? 8 : 16)
    : width * height * (format === 1 ? 1 : format === 3 ? 3 : 4);
  if (payload.byteLength < required) {
    throw new Error(`Unity ${FORMATS.get(format)} 载荷截断：最高 mip 需要 ${required} 字节，实际 ${payload.byteLength}`);
  }
  const layout = spriteLayout(options.sprite, width, height, flipY);
  const rgba = pixelBuffer(width, height);
  if (format === 10 || format === 12) decodeDxt(payload, width, height, format, flipY, rgba);
  else decodeRaw(payload, width, height, format, flipY, rgba);
  if (!layout) return { width, height, rgba };
  const output = pixelBuffer(layout.width, layout.height);
  for (let row = 0; row < layout.copyHeight; row += 1) {
    const source = ((layout.sourceY + row) * width + layout.sourceX) * 4;
    const target = ((layout.targetY + row) * layout.width + layout.targetX) * 4;
    output.set(rgba.subarray(source, source + layout.copyWidth * 4), target);
  }
  return { width: layout.width, height: layout.height, rgba: output };
}

export function renderUnityTexture(bytes, options, canvas) {
  const frame = decodeUnityTexture(bytes, options);
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("浏览器无法创建 Canvas 2D 上下文");
  context.putImageData(new ImageData(frame.rgba, frame.width, frame.height), 0, 0);
  return { width: frame.width, height: frame.height };
}
