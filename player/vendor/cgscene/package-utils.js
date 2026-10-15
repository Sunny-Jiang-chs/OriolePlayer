const OUTPUT_NAMES = new Set(["package.json", "selection.json", "selection-report.json"]);

/** Decode a package URI exactly once into a safe, portable filesystem-relative path. */
export function safeRelativePath(uri) {
  if (typeof uri !== "string" || !uri || /[?#]/.test(uri)) throw new Error("资源必须使用非空包内相对 URI（文件名中的 #、? 需要编码）");
  const normalized = uri.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(normalized)) throw new Error("资源 URI 不能是绝对路径或网址");
  const parts = normalized.split("/").map((part) => {
    let decoded;
    try { decoded = decodeURIComponent(part); }
    catch { throw new Error("资源 URI 包含无效百分号编码"); }
    if (!decoded || decoded === "." || decoded === ".." || /[\\/<>:"|?*\u0000-\u001f\u007f]/.test(decoded) || /[ .]$/.test(decoded)) {
      throw new Error("资源 URI 包含不安全的路径段");
    }
    if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(decoded)) throw new Error("资源 URI 包含 Windows 保留文件名");
    return decoded;
  });
  if (OUTPUT_NAMES.has(parts[0].toLowerCase())) throw new Error("资源 URI 与导出元数据文件冲突");
  return parts.join("/");
}

function addReference(set, value) { if (typeof value === "string" && value) set.add(value); }

/** Only runtime fields create media dependencies; arbitrary source metadata does not. */
export function pageReferences(page) {
  const visuals = new Set();
  const audio = new Set();
  addReference(visuals, page.visual?.assetId);
  for (const layer of page.visualState?.layers || []) addReference(visuals, layer.assetId);
  const events = [page.audioEvents, page.next?.audioEvents, ...(page.choices || []).map((choice) => choice?.audioEvents)];
  for (const list of events) for (const event of Array.isArray(list) ? list : []) addReference(audio, event?.assetId);
  for (const state of [page.audioState, page.seekAudioState]) {
    addReference(audio, state?.bgmAssetId);
    for (const bus of Object.values(state?.buses || {})) addReference(audio, bus?.assetId);
  }
  return { visuals, audio };
}

/** Include model textures/motions/physics when moving a referenced visual asset. */
export function visualAssetUris(asset) {
  return [...new Set([asset.uri, ...(asset.dependencies || [])].filter(Boolean))];
}

