export const SCHEMA_VERSION = "1.1.0";
const SUPPORTED_VERSIONS = new Set(["1.0.0", "1.1.0"]);

function fail(message) {
  throw new Error(`数据包错误：${message}`);
}

function indexById(items, name) {
  if (!Array.isArray(items)) fail(`${name} 必须是数组`);
  const index = new Map();
  for (const item of items) {
    if (!item?.id || typeof item.id !== "string") fail(`${name} 存在空 ID`);
    if (index.has(item.id)) fail(`${name} 存在重复 ID：${item.id}`);
    index.set(item.id, item);
  }
  return index;
}

function validateRelativeUri(uri, assetId) {
  const normalized = uri.replaceAll("\\", "/");
  if (/^[a-z][a-z\d+.-]*:/i.test(normalized) || normalized.startsWith("/") || /[?#]/.test(normalized)) {
    fail(`资源 ${assetId} 必须使用包内相对路径`);
  }
  for (const part of normalized.split("/")) {
    let decoded;
    try { decoded = decodeURIComponent(part); }
    catch { fail(`资源 ${assetId} 的 uri 编码无效`); }
    if (!part || decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")) {
      fail(`资源 ${assetId} 的 uri 不能越出数据包目录`);
    }
  }
}

function summarizeEventCg(scene) {
  scene.eventCgPages = 0;
  scene.firstEventCgPageIndex = -1;
  scene.eventCgKnown = false;
  if (scene.source?.catalog) return;

  const hasPreview = (page) => page.visual?.status === "available" && Boolean(page.visual.assetId);
  const roleKnown = scene.pages.some((page) => typeof page.visual?.role === "string" || typeof page.source?.visualState?.role === "string");
  const eventPages = scene.pages.flatMap((page, index) =>
    hasPreview(page) && (page.visual?.role === "event-cg" || page.source?.visualState?.role === "event-cg") ? [index] : []);
  const declared = scene.source?.eventCg;
  scene.eventCgKnown = roleKnown || Boolean(declared && typeof declared === "object");
  if (roleKnown) {
    scene.eventCgPages = eventPages.length;
    scene.firstEventCgPageIndex = eventPages[0] ?? -1;
    return;
  }
  if (!declared || typeof declared !== "object") return;
  const firstIndex = scene.pages.findIndex((page) =>
    declared.firstPageId ? page.id === declared.firstPageId : Number.isInteger(declared.firstPageOrder) && page.order === declared.firstPageOrder);
  if (firstIndex < 0 || !hasPreview(scene.pages[firstIndex])) return;
  if (Number.isInteger(declared.pageCount) && declared.pageCount > 0) {
    scene.eventCgPages = Math.min(declared.pageCount, scene.pages.filter(hasPreview).length);
    scene.firstEventCgPageIndex = firstIndex;
  }
}

export function normalizePackage(input) {
  if (!SUPPORTED_VERSIONS.has(input?.schemaVersion)) fail("支持 schema 1.0.0 / 1.1.0");
  if (typeof input.project?.id !== "string" || !input.project.id || typeof input.project.title !== "string") fail("缺少 project.id/title");
  const visuals = input.assets?.visuals;
  const audio = input.assets?.audio;
  const visualById = indexById(visuals, "assets.visuals");
  const audioById = indexById(audio, "assets.audio");
  const sceneById = indexById(input.scenes, "scenes");
  for (const asset of [...visuals, ...audio]) {
    if (typeof asset.uri !== "string" || !asset.uri) fail(`资源 ${asset.id} 缺少 uri`);
    validateRelativeUri(asset.uri, asset.id);
    if (!["available", "missing", "unresolved"].includes(asset.status)) fail(`资源 ${asset.id} 的 status 无效`);
  }
  for (const scene of input.scenes) {
    scene.pageById = indexById(scene.pages, `场景 ${scene.id} pages`);
    if (scene.pages.some((page) => !Number.isInteger(page.order) || page.order < 0)) fail(`场景 ${scene.id} 的页面 order 无效`);
    if (new Set(scene.pages.map((page) => page.order)).size !== scene.pages.length) fail(`场景 ${scene.id} 的页面 order 重复`);
    scene.pages.sort((a, b) => a.order - b.order);
    scene.mappedPages = 0;
    for (const page of scene.pages) {
      if (!page.text || typeof page.text.body !== "string" || typeof page.text.speaker !== "string") fail(`页面 ${page.id} 缺少 text.speaker/body`);
      if (!page.visual || !Array.isArray(page.audioEvents) || !Array.isArray(page.choices)) fail(`页面 ${page.id} 缺少 visual/audioEvents/choices`);
      if (input.schemaVersion === "1.1.0" && !Object.prototype.hasOwnProperty.call(page, "next")) fail(`页面 ${page.id} 缺少明确后继 next`);
      if (!["available", "missing", "unresolved"].includes(page.visual.status)) fail(`页面 ${page.id} 的 visual.status 无效`);
      if (page.visual.sourceKind !== undefined && !["page", "inherited", "scene-preview"].includes(page.visual.sourceKind)) fail(`页面 ${page.id} 的 visual.sourceKind 无效`);
      if (page.presentation && (page.presentation.mode !== "special" || page.presentation.status !== "unresolved")) fail(`页面 ${page.id} 的 presentation 无效`);
      if (page.visual.sourceKind === "scene-preview" && (page.visual.assetId !== null || page.presentation?.mode !== "special" || page.presentation?.status !== "unresolved")) {
        fail(`页面 ${page.id} 的场景预览图必须使用特殊演出占位`);
      }
      if (page.visual.assetId && !visualById.has(page.visual.assetId)) fail(`页面 ${page.id} 画面引用不存在：${page.visual.assetId}`);
      if (page.visual.assetId) scene.mappedPages += 1;
      if (page.audioState?.bgmAssetId && !audioById.has(page.audioState.bgmAssetId)) fail(`页面 ${page.id} BGM 引用不存在`);
      if (page.audioState?.bgmVolume !== undefined && (!Number.isFinite(page.audioState.bgmVolume) || page.audioState.bgmVolume < 0 || page.audioState.bgmVolume > 1)) fail(`页面 ${page.id} 的 audioState.bgmVolume 无效`);
      if (page.audioState?.bgmLoop !== undefined && typeof page.audioState.bgmLoop !== "boolean") fail(`页面 ${page.id} 的 audioState.bgmLoop 无效`);
      if (page.audioState?.buses !== undefined) {
        if (!page.audioState.buses || typeof page.audioState.buses !== "object" || Array.isArray(page.audioState.buses)) fail(`页面 ${page.id} 的 audioState.buses 无效`);
        for (const [bus, entry] of Object.entries(page.audioState.buses)) {
          if (!bus || bus === "voice" || bus === "bgm" || !entry || typeof entry !== "object" || Array.isArray(entry)) fail(`页面 ${page.id} 的持续声音快照无效`);
          if (entry.assetId && !audioById.has(entry.assetId)) fail(`页面 ${page.id} 的持续声音引用不存在：${entry.assetId}`);
          if (entry.volume !== undefined && (!Number.isFinite(entry.volume) || entry.volume < 0 || entry.volume > 1)) fail(`页面 ${page.id} 的持续声音 volume 无效`);
          if (entry.loop !== undefined && typeof entry.loop !== "boolean") fail(`页面 ${page.id} 的持续声音 loop 无效`);
        }
      }
      const extraEvents = [page.next, ...page.choices].flatMap((transition) => {
        if (transition?.audioEvents !== undefined && !Array.isArray(transition.audioEvents)) fail(`页面 ${page.id} 的转移声音必须是数组`);
        return transition?.audioEvents || [];
      });
      for (const event of [...page.audioEvents, ...extraEvents]) {
        if (!["play", "stop", "volume"].includes(event.action) || typeof event.bus !== "string" || !event.bus) fail(`页面 ${page.id} 有无效声音事件`);
        if (event.loop !== undefined && typeof event.loop !== "boolean" || event.wait !== undefined && typeof event.wait !== "boolean") fail(`页面 ${page.id} 的声音事件 loop/wait 无效`);
        if (event.volume !== undefined && (!Number.isFinite(event.volume) || event.volume < 0 || event.volume > 1)) fail(`页面 ${page.id} 的声音事件 volume 无效`);
        if (event.action === "volume" && event.volume === undefined) fail(`页面 ${page.id} 的调音量事件缺少 volume`);
        if (event.fadeMs !== undefined && (!Number.isFinite(event.fadeMs) || event.fadeMs < 0)) fail(`页面 ${page.id} 的声音事件 fadeMs 无效`);
        if (event.assetId && !audioById.has(event.assetId)) fail(`页面 ${page.id} 音频引用不存在：${event.assetId}`);
        if (event.onceKey !== undefined && (typeof event.onceKey !== "string" || !event.onceKey)) fail(`页面 ${page.id} 的 onceKey 无效`);
      }
      for (const choice of page.choices) {
        if (typeof choice.label !== "string" || typeof choice.enabled !== "boolean") fail(`页面 ${page.id} 有无效选项`);
      }
    }
    summarizeEventCg(scene);
    if (scene.entryPageId && !scene.pageById.has(scene.entryPageId)) fail(`场景 ${scene.id} 入口不存在`);
    for (const page of scene.pages) {
      const seek = page.seekAudioState;
      if (!seek) continue;
      if (seek.bgmAssetId && !audioById.has(seek.bgmAssetId)) fail(`页面 ${page.id} 导航BGM引用不存在`);
      for (const entry of Object.values(seek.buses || {})) {
        if (!entry?.assetId || !audioById.has(entry.assetId)) fail(`页面 ${page.id} 导航循环声音引用不存在`);
      }
      if (seek.onceKeys !== undefined && (!Array.isArray(seek.onceKeys) || seek.onceKeys.some((key) => typeof key !== "string"))) fail(`页面 ${page.id} 导航 onceKeys 无效`);
    }
  }
  for (const scene of input.scenes) {
    for (const page of scene.pages) {
      for (const choice of [page.next, ...page.choices].filter(Boolean)) {
        if (typeof choice !== "object" || Array.isArray(choice)) fail(`页面 ${page.id} 的转移对象无效`);
        if (choice.status !== undefined && !["resolved", "end", "unresolved", "choice"].includes(choice.status)) fail(`页面 ${page.id} 的转移状态无效`);
        const targetScene = sceneById.get(choice.targetSceneId || scene.id);
        if (choice.targetSceneId && !targetScene) fail(`页面 ${page.id} 选项场景不存在：${choice.targetSceneId}`);
        if (choice.targetPageId && !targetScene?.pageById.has(choice.targetPageId)) fail(`页面 ${page.id} 选项目标不存在：${choice.targetPageId}`);
      }
    }
  }
  input.assets.visualById = visualById;
  input.assets.audioById = audioById;
  input.sceneById = sceneById;
  return input;
}

