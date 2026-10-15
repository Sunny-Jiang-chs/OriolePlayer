import { safeRelativePath } from "./package-utils.js";

export const VISUAL_KINDS = new Set(["image", "video", "live2d"]);
export const hasExplicitFlow = (version) => version === "1.1.0" || version === "1.2.0";
const fail = (message) => { throw new Error(`显示状态错误：${message}`); };
const finite = (value, fallback, min = -Infinity, max = Infinity) => {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < min || value > max) fail("数值超出范围");
  return value;
};

export function dependencyUri(asset, relative) {
  if (typeof relative !== "string" || !relative || /^[a-z][a-z\d+.-]*:/i.test(relative) || /^[\\/]/.test(relative) || /[?#]/.test(relative)) fail("模型依赖必须是相对文件路径");
  const base = safeRelativePath(asset.uri).split("/"); base.pop();
  for (const part of relative.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!base.length) fail("模型依赖越界"); base.pop(); }
    else base.push(part);
  }
  const uri = base.map(encodeURIComponent).join("/");
  const path = safeRelativePath(uri);
  if (!(asset.dependencies || []).some((item) => safeRelativePath(item) === path)) fail(`模型依赖未登记：${relative}`);
  return uri;
}

export function validateVisualAsset(asset) {
  if (!VISUAL_KINDS.has(asset.kind || "image")) fail(`未知资源类型：${asset.kind}`);
  if (asset.dependencies !== undefined && !Array.isArray(asset.dependencies)) fail("dependencies 必须是数组");
  for (const uri of asset.dependencies || []) safeRelativePath(uri);
  if (asset.kind === "live2d" && !Array.isArray(asset.dependencies)) fail("Live2D 必须声明完整依赖列表");
}

/** A full page snapshot, independent of the path used to reach the page. */
export function normalizeVisualState(value, assets) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("visualState 必须是对象");
  if (!Array.isArray(value.layers)) fail("visualState.layers 必须是数组");
  const width = finite(value.width, 1920, 1, 32768), height = finite(value.height, 1080, 1, 32768);
  if (value.background !== undefined && !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value.background)) fail("背景色须为十六进制颜色");
  const ids = new Set();
  const layers = value.layers.map((layer) => {
    if (!layer || typeof layer.id !== "string" || !layer.id || ids.has(layer.id)) fail("图层 ID 为空或重复");
    ids.add(layer.id);
    if (layer.assetId !== null && (typeof layer.assetId !== "string" || !layer.assetId)) fail("assetId 必须是非空字符串或 null");
    if (!["available", "missing", "unresolved"].includes(layer.status)) fail("图层状态无效");
    const asset = assets.get(layer.assetId);
    if (layer.assetId && !asset) fail(`图层资源不存在：${layer.assetId}`);
    if (layer.status === "available" && (!asset || asset.status !== "available")) fail("可用图层需要可用资源");
    if (layer.visible !== undefined && typeof layer.visible !== "boolean") fail("visible 必须为布尔值");
    const p = layer.playback === undefined ? {} : layer.playback;
    if (!p || typeof p !== "object" || Array.isArray(p)) fail("playback 必须是对象");
    if (p.instanceId !== undefined && (typeof p.instanceId !== "string" || !p.instanceId)) fail("instanceId 无效");
    for (const key of ["loop", "playing"]) if (p[key] !== undefined && typeof p[key] !== "boolean") fail(`${key} 必须为布尔值`);
    for (const key of ["motion", "expression"]) {
      if (p[key] === undefined || p[key] === null) continue;
      safeRelativePath(p[key]);
      if (asset?.kind !== "live2d" || !(asset.dependencies || []).some((uri) => safeRelativePath(uri) === safeRelativePath(p[key]))) fail(`${key} 不在模型依赖列表`);
    }
    for (const key of ["parameters", "parts"]) {
      if (p[key] !== undefined && (!p[key] || typeof p[key] !== "object" || Array.isArray(p[key]))) fail(`${key} 必须为对象`);
      for (const [id, number] of Object.entries(p[key] || {})) {
        if (asset?.kind !== "live2d") fail(`${key} 只适用于 Live2D`);
        if (!id || !Number.isFinite(number) || key === "parts" && (number < 0 || number > 1)) fail(`无效 ${key} 数值`);
      }
    }
    const fit = layer.fit || "contain";
    if (!["contain", "cover"].includes(fit)) fail("fit 无效");
    return { ...layer, x: finite(layer.x, 0), y: finite(layer.y, 0),
      width: finite(layer.width, width, 1, 32768), height: finite(layer.height, height, 1, 32768),
      rotation: finite(layer.rotation, 0), opacity: finite(layer.opacity, 1, 0, 1),
      zIndex: finite(layer.zIndex, 0), visible: layer.visible !== false, fit,
      playback: { ...p, instanceId: p.instanceId || layer.id, loop: p.loop ?? false, playing: p.playing ?? true,
        rate: finite(p.rate, 1, 0.1, 4), startTime: finite(p.startTime, 0, 0, 86400),
        parameters: { ...(p.parameters || {}) }, parts: { ...(p.parts || {}) } } };
  });
  return { ...value, width, height, background: value.background || "#000000", layers };
}

/** Rate/parameters/transforms may change without restarting an existing clip. */
export function playbackIdentity(layer) {
  return JSON.stringify([layer.assetId, layer.playback?.instanceId || layer.id,
    layer.playback?.motion || null, layer.playback?.expression || null,
    layer.playback?.loop ?? false, layer.playback?.startTime ?? 0]);
}
