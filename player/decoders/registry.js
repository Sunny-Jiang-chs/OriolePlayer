const decoders = new Map([
  ["kurea.hidc-dxt1", async () => {
    const { renderHidcFrame } = await import("./hidc/decoder.js");
    return { render: (bytes, options, canvas) => renderHidcFrame(bytes, options.frameIndex, canvas, options.flipY !== false) };
  }],
  ["unity.texture", async () => {
    const { renderUnityTexture } = await import("./unity-texture/decoder.js");
    return { render: (bytes, descriptor, canvas) => renderUnityTexture(bytes, descriptor.options ?? descriptor, canvas) };
  }]
]);
const loaded = new Map();

export function registerDecoder(id, loader) {
  decoders.set(id, loader);
  loaded.delete(id);
}

export async function getDecoder(id) {
  const loader = decoders.get(id);
  if (!loader) throw new Error(`未注册的解码器：${id}`);
  if (!loaded.has(id)) loaded.set(id, loader());
  return loaded.get(id);
}
