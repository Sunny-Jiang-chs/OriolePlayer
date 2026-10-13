import { loadUrlPackage, loadDirectoryPackage } from "./package-loader.js";
import { getDecoder } from "./decoders/registry.js";

const $ = (id) => document.getElementById(id);
const nativeHost = location.origin === "https://appassets.androidplatform.net" ? window.CGSceneNative : null;
document.body.classList.toggle("is-android", Boolean(nativeHost));
function callNative(method, ...args) {
  try { return nativeHost?.[method]?.(...args); }
  catch (error) { console.warn(`Android ${method} failed`, error); return undefined; }
}
const el = {
  title: $("project-title"), projectMeta: $("project-meta"), packageStatus: $("package-status"), assetCount: $("asset-count"),
  search: $("scene-search"), category: $("scene-category"), visualOnly: $("scene-visual-only"), eventCgOnly: $("scene-event-cg-only"), locateScene: $("locate-scene"),
  sceneList: $("scene-list"), sceneCount: $("scene-count"), sceneHeading: $("scene-heading"), pagePosition: $("page-position"),
  stage: $("stage"), frame: $("visual-frame"), image: $("still-image"), canvas: $("decoded-image"), placeholder: $("stage-placeholder"), imageNote: $("image-note"),
  specialPlaceholder: $("special-placeholder"), specialReason: $("special-reason"),
  dialogue: $("dialogue"), dialogueToggle: $("dialogue-toggle"), pageNumber: $("page-number"), pageTotal: $("page-total"),
  speaker: $("speaker"), pageLabel: $("page-label"), text: $("dialogue-text"), choices: $("choices"), previous: $("previous"), next: $("next"), firstEventCg: $("first-event-cg"), slider: $("page-slider"),
  sound: $("sound-toggle"), mixerToggle: $("mixer-toggle"), mixer: $("audio-mixer"),
  bgmVolume: $("bgm-volume"), bgmVolumeValue: $("bgm-volume-value"), otherVolume: $("other-volume"), otherVolumeValue: $("other-volume-value"),
  bgmStatus: $("bgm-status"), bgmRetry: $("bgm-retry"),
  auto: $("auto-toggle"), fullscreenView: $("fullscreen-view"), exitFullscreen: $("exit-fullscreen"),
  scenePanelToggle: $("scene-panel-toggle"), inspectorPanelToggle: $("inspector-panel-toggle"), status: $("page-status"),
  scenePanel: $("scene-panel"), sceneClose: $("scene-close"), infoPanel: $("info-panel"), infoClose: $("info-close"), backdrop: $("panel-backdrop"),
  detailScene: $("detail-scene"), detailPage: $("detail-page"), detailVisual: $("detail-visual"), detailVisualRole: $("detail-visual-role"), detailBgm: $("detail-bgm"), detailStanding: $("detail-standing"),
  audioEvents: $("audio-events"), sourceNote: $("source-note"), toast: $("toast"), packageSelect: $("package-select"), packageFolder: $("package-folder")
};

const state = {
  data: null, source: null, scene: null, pageIndex: 0, audio: new Map(),
  muted: false, audioSuspended: false, auto: false, autoTimer: 0, toastTimer: 0, lastWheelAt: 0, wheelDelta: 0, renderToken: 0, loadToken: 0, bytes: new Map(),
  bgmIntent: null, bgmFinished: false, bgmFailure: null,
  audioSequence: 0, audioPageToken: 0, audioPageStartedAt: 0, voiceWait: null
};
state.audioOnceKeys = new Set();
state.readingHistory = [];
const ui = { scenesHidden: false, scenesOpen: false, infoOpen: false, dialogueVisible: true };
const mobileLayout = matchMedia("(max-width: 760px), (pointer: coarse) and (max-height: 600px)");
const portraitLibrary = matchMedia("(max-width: 760px) and (orientation: portrait)");
const overlayInfo = matchMedia("(max-width: 1120px), (pointer: coarse) and (max-height: 600px)");
function savedVolume(key) {
  try {
    const saved = localStorage.getItem(key);
    if (saved === null) return 1;
    const value = Number(saved);
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
  } catch { return 1; }
}
const masterVolume = { bgm: savedVolume("cgscene-volume-bgm"), other: savedVolume("cgscene-volume-other") };
globalThis.lucide?.createIcons();

const visualReasonLabels = new Map([
  ["scene-entry", "场景开始，尚未确认事件CG"],
  ["line-clears-himage", "本页未使用CG；原游戏的场景或立绘演出暂未还原"],
  ["sprite-reference-unresolved", "本页Sprite引用尚未映射到画面"],
  ["branch-dependent-visual", "画面随剧情分支变化，需在游戏中确认"],
  ["event-cg-loaded", "事件CG已载入"],
  ["unresolved-event-cg-reference", "事件CG引用尚未匹配到资源"],
  ["no-confirmed-event-cg", "尚未确认本页的事件CG"],
  ["background-and-standing-composition-not-reproduced", "背景与立绘组合尚未还原"],
  ["fade-out-clears-image-layers", "画面已淡出并清除"],
  ["background-slot-deleted", "背景画面已删除"],
  ["dynamic-slot-deletion", "待删除的画面图层由运行时决定"],
  ["dynamic-delete-all-exclusions", "待保留的画面图层由运行时决定"],
  ["all-image-layers-deleted", "画面图层已清除"],
  ["uninterpreted-image-queue-replaces-background", "背景由未还原的图层队列替换"],
  ["dynamic-image-queue-slot", "目标画面图层由运行时决定"],
  ["uninterpreted-raw-image-operation", "直接操作画面图层的演出尚未还原"],
  ["nonlinear-control-transfer", "剧情发生跳转，后续画面状态待核对"],
  ["runtime-transition-and-camera-not-reproduced", "转场与镜头变化尚未还原"],
  ["runtime-transition-not-reproduced", "转场效果尚未还原"],
  ["additional-layer-composition-not-reproduced", "附加图层组合尚未还原"],
  ["Linear page review does not execute choices or game variables.", "逐页预览不执行选项或游戏变量"],
  ["The preview shows the event base image; camera, transitions, and additional layers are retained as unsupported source metadata.", "预览显示事件CG基础图；镜头、转场与附加图层保留为待还原数据"],
  ["Audio wrapper calls are not yet resolved by this adapter.", "音频封装调用尚未解析"]
]);

function describeVisualReasons(values) {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  return list.map((value) => visualReasonLabels.get(value) || String(value));
}

function setButtonIcon(button, icon, label = "") {
  const mark = document.createElement("i");
  mark.dataset.lucide = icon;
  button.replaceChildren(mark);
  if (label) { const text = document.createElement("span"); text.textContent = label; button.append(text); }
  globalThis.lucide?.createIcons();
}

function say(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3600);
}

function assetUrl(asset) {
  return state.source.resolve(asset.uri);
}

function currentPage() {
  return state.scene?.pages?.[state.pageIndex] || null;
}

function sceneButton(scene) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "scene-item";
  button.setAttribute("role", "option");
  button.setAttribute("aria-selected", String(scene.id === state.scene?.id));
  const title = document.createElement("span");
  title.className = "scene-title";
  title.textContent = scene.title || scene.id;
  button.title = scene.title || scene.id;
  const subtitle = document.createElement("span");
  subtitle.className = "scene-subtitle";
  const mapped = scene.mappedPages;
  button.dataset.sceneId = scene.id;
  subtitle.textContent = `${scene.category || "场景"} · ${scene.pages.length} 页 · ${mapped} 画面`;
  button.append(title, subtitle);
  if (scene.eventCgPages > 0) {
    const eventCg = document.createElement("span");
    eventCg.className = "scene-event-cg";
    const first = scene.firstEventCgPageIndex;
    eventCg.textContent = `事件CG ${scene.eventCgPages} 页 · ${first >= 0 ? `首张第 ${first + 1} 页` : "首张页待核对"}`;
    button.append(eventCg);
  }
  button.addEventListener("click", () => selectScene(scene.id));
  return button;
}

function renderSceneList() {
  if (!state.data) return;
  const query = el.search.value.trim().toLocaleLowerCase();
  const scenes = state.data.scenes.filter((scene) =>
    `${scene.id} ${scene.title || ""} ${scene.category || ""}`.toLocaleLowerCase().includes(query)
    && (!el.category.value || scene.category === el.category.value)
    && (!el.visualOnly.checked || scene.mappedPages > 0)
    && (!el.eventCgOnly.checked || scene.eventCgPages > 0));
  el.sceneCount.textContent = scenes.length === state.data.scenes.length ? String(scenes.length) : `${scenes.length} / ${state.data.scenes.length}`;
  if (!scenes.length) {
    const empty = document.createElement("p");
    empty.className = "scene-empty";
    empty.textContent = el.eventCgOnly.checked ? "没有确认含事件CG的场景" : "没有匹配的场景";
    el.sceneList.replaceChildren(empty);
    return;
  }
  el.sceneList.replaceChildren(...scenes.map(sceneButton));
}

function locateCurrentScene() {
  if (!state.scene) return;
  el.search.value = "";
  el.category.value = "";
  el.visualOnly.checked = false;
  el.eventCgOnly.checked = false;
  renderSceneList();
  const button = [...el.sceneList.children].find((item) => item.dataset.sceneId === state.scene.id);
  button?.scrollIntoView({ block: "nearest" });
  button?.focus({ preventScroll: true });
}

function scenePageDuration(page) {
  const voice = [...page.audioEvents].reverse().find((event) => event.action === "play" && event.bus === "voice" && !event.loop && event.assetId);
  const asset = voice && state.data.assets.audioById.get(voice.assetId);
  if (Number.isFinite(asset?.duration) && asset.duration > 0) return Math.max(1200, Math.round(asset.duration * 1000 + 250));
  return Math.max(1800, Math.min(7200, 1800 + (page.text.body || "").length * 45));
}

function audioVolume(value, fallback = 1) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function cancelAudioFade(player) {
  if (player._fadeFrame) cancelAnimationFrame(player._fadeFrame);
  player._fadeFrame = 0;
  player._fadeToken = (player._fadeToken || 0) + 1;
}

function settleVoiceWait(player) {
  const wait = player._voiceWait;
  if (!wait || wait.settled) return;
  clearTimeout(wait.timer);
  wait.settled = true;
  wait.finishedAt = performance.now();
  if (state.voiceWait === wait && wait.pageToken === state.audioPageToken && state.auto) scheduleAuto();
}

function removeAudioPlayer(player) {
  cancelAudioFade(player);
  player._playAttempt = (player._playAttempt || 0) + 1;
  player._playPending = false;
  player.pause();
  if (state.audio.get(player._key) === player) state.audio.delete(player._key);
  settleVoiceWait(player);
}

function fadeAudioPlayer(player, target, fadeMs = 0, onFinish = null) {
  cancelAudioFade(player);
  const token = player._fadeToken;
  const from = player._eventVolume;
  player._targetVolume = audioVolume(target);
  const duration = Number.isFinite(fadeMs) && fadeMs > 0 ? fadeMs : 0;
  if (!duration || from === player._targetVolume) {
    player._eventVolume = player._targetVolume;
    updatePlayerVolume(player);
    onFinish?.();
    return;
  }
  const startedAt = performance.now();
  const step = (now) => {
    if (state.audio.get(player._key) !== player || player._fadeToken !== token) return;
    const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
    player._eventVolume = from + (player._targetVolume - from) * progress;
    updatePlayerVolume(player);
    if (progress < 1) player._fadeFrame = requestAnimationFrame(step);
    else { player._fadeFrame = 0; onFinish?.(); }
  };
  player._fadeFrame = requestAnimationFrame(step);
}

function stopBus(bus, fadeMs = 0) {
  if (bus === "bgm") {
    state.bgmIntent = null;
    state.bgmFinished = false;
    state.bgmFailure = null;
  }
  for (const player of [...state.audio.values()]) {
    if (player._bus !== bus) continue;
    player._stopping = true;
    fadeAudioPlayer(player, 0, fadeMs, () => removeAudioPlayer(player));
  }
  if (bus === "bgm") syncBgmStatus();
}

function stopAllAudio() {
  state.bgmIntent = null;
  state.bgmFinished = false;
  state.bgmFailure = null;
  state.voiceWait = null;
  for (const player of [...state.audio.values()]) removeAudioPlayer(player);
  state.audio.clear();
  syncBgmStatus();
}

function updatePlayerVolume(player) {
  const master = player._bus === "bgm" || player._bus.startsWith("bgm:") ? masterVolume.bgm : masterVolume.other;
  player.volume = Math.max(0, Math.min(1, player._eventVolume * master));
  if (player._bus === "bgm") syncBgmStatus();
}

function applyMasterVolumes() {
  for (const player of state.audio.values()) updatePlayerVolume(player);
}

function synchronizeAudioPlayer(player, settings, { immediate = false } = {}) {
  if (typeof settings.loop === "boolean") player.loop = settings.loop;
  player._persistent = player.loop && player._bus !== "voice" && player._bus !== "bgm";
  const target = audioVolume(settings.volume, player._targetVolume);
  if (player._bus === "bgm" && state.bgmIntent?.assetId === player._assetId) {
    state.bgmIntent.volume = target;
    state.bgmIntent.loop = player.loop;
  }
  if (immediate || player._stopping || target !== player._targetVolume) {
    player._stopping = false;
    fadeAudioPlayer(player, target, immediate ? 0 : settings.fadeMs);
  } else updatePlayerVolume(player);
  if (player.loop) settleVoiceWait(player);
}

function syncBgmStatus() {
  const intent = state.bgmIntent;
  const player = state.audio.get("bgm");
  let status = "none", label = "无 BGM";
  if (intent) {
    if (state.bgmFailure) {
      status = "failed";
      const { name, code } = state.bgmFailure;
      const reason = { 2: "读取失败", 3: "解码失败", 4: "格式或资源不可用" }[code] || "播放失败";
      label = `${reason} · ${name}${code ? ` (${code})` : ""}`;
    } else if (state.bgmFinished) { status = "ended"; label = "BGM 已结束"; }
    else if (state.muted) { status = "muted"; label = "已静音 · 声音开关已关闭"; }
    else if (masterVolume.bgm === 0) { status = "muted"; label = "已静音 · BGM 主音量为 0%"; }
    else if (intent.volume === 0) { status = "muted"; label = "已静音 · 本段 BGM 音量为 0%"; }
    else if (state.audioSuspended || document.hidden) { status = "paused"; label = "已暂停 · 应用在后台"; }
    else if (player?._blocked) { status = "paused"; label = "已暂停 · 点击页面开始播放"; }
    else if (player?._interrupted) { status = "paused"; label = "BGM 播放中断 · 点击页面重试"; }
    else if (player?._playPending || player?._loading || player && typeof player.readyState === "number" && player.readyState < 3) {
      status = "loading"; label = "BGM 载入中";
    } else if (!player || player.paused) { status = "paused"; label = "BGM 已暂停"; }
    else { status = "playing"; label = "BGM 播放中"; }
  }
  el.bgmStatus.textContent = label;
  el.bgmStatus.dataset.status = status;
  el.bgmRetry.disabled = !intent || state.bgmFinished || state.audioSuspended || document.hidden || state.muted || Boolean(player?._playPending);
}

function audioFailure(player, error) {
  player._playAttempt = (player._playAttempt || 0) + 1;
  player._playPending = false;
  const code = Number(error?.code) || 0;
  const knownNames = new Set(["AbortError", "NotAllowedError", "NotSupportedError", "NetworkError", "EncodingError", "MediaError"]);
  const name = knownNames.has(error?.name) ? error.name : code ? "MediaError" : "Error";
  if (name === "AbortError" || code === 1) {
    // Media interruptions are recoverable; do not discard the desired track.
    player._retryAfter = performance.now() + 1000;
    player._interrupted = true;
    player._loading = false;
    settleVoiceWait(player);
    syncBgmStatus();
    return;
  }
  if (player._bus === "bgm") state.bgmFailure = { name, code };
  removeAudioPlayer(player);
  syncBgmStatus();
  say(player._bus === "bgm" ? "BGM 播放失败，可在音量面板查看状态并重试。" : "音频载入失败，请检查数据包中的音频文件。");
}

function recoverBgm({ userInitiated = false } = {}) {
  if (!state.bgmIntent || state.bgmFinished || state.muted || state.audioSuspended || document.hidden) { syncBgmStatus(); return; }
  const current = state.audio.get("bgm");
  if (current) {
    if (userInitiated) current._retryAfter = 0;
    if (current.paused && (!current._blocked || userInitiated)) startAudioPlayer(current);
  } else if (!state.bgmFailure || userInitiated) {
    playAudioEvent({ ...state.bgmIntent, fadeMs: 0 });
  }
  syncBgmStatus();
}

function watchVoiceProgress(player) {
  const wait = player._voiceWait;
  if (!wait || wait.settled) return;
  const position = Number.isFinite(player.currentTime) ? player.currentTime : 0;
  if (wait.timer && position <= wait.lastTime) return;
  wait.lastTime = position;
  clearTimeout(wait.timer);
  wait.timer = setTimeout(() => {
    if (state.audio.get(player._key) !== player || wait.settled) return;
    settleVoiceWait(player);
    if (state.auto) say("配音未能继续加载，自动模式将按文本推进。");
  }, 15000);
}

function startAudioPlayer(player) {
  if (state.audio.get(player._key) !== player || state.audioSuspended || document.hidden || player._ended || player._stopping || player._playPending || performance.now() < (player._retryAfter || 0)) return;
  const attempt = (player._playAttempt || 0) + 1;
  player._playAttempt = attempt;
  player._playPending = true;
  player._blocked = false;
  player._interrupted = false;
  player.muted = state.muted;
  if (!state.muted && player._voiceWait?.pageToken === state.audioPageToken) {
    player._voiceWait.settled = false;
    player._voiceWait.finishedAt = 0;
    state.voiceWait = player._voiceWait;
    watchVoiceProgress(player);
  }
  const failed = (error) => {
    if (state.audio.get(player._key) !== player || player._playAttempt !== attempt) return;
    player._playPending = false;
    if (error?.name === "NotAllowedError") {
      // Keep the current BGM/voice until a user gesture unlocks browser playback.
      player._blocked = true;
      settleVoiceWait(player);
      say("点击页面即可开始播放声音。");
      syncBgmStatus();
      return;
    }
    audioFailure(player, error);
  };
  try {
    if (player.error?.code === 1) player.load();
    Promise.resolve(player.play()).then(() => {
      if (player._playAttempt === attempt) player._playPending = false;
      syncBgmStatus();
    }).catch(failed);
  } catch (error) { failed(error); }
  syncBgmStatus();
}

function retryBlockedAudio() {
  if (state.muted || state.audioSuspended) return;
  for (const player of state.audio.values()) {
    if (player._blocked) startAudioPlayer(player);
  }
  recoverBgm();
}

function playAudioEvent(event) {
  if (event.status === "unresolved") return null;
  if (event.action === "stop") {
    stopBus(event.bus, event.fadeMs);
    return null;
  }
  if (event.action === "volume") {
    if (event.bus === "bgm" && state.bgmIntent) {
      state.bgmIntent.volume = audioVolume(event.volume, state.bgmIntent.volume);
      if (typeof event.loop === "boolean") state.bgmIntent.loop = event.loop;
    }
    for (const player of state.audio.values()) {
      if (player._bus === event.bus) synchronizeAudioPlayer(player, event);
    }
    syncBgmStatus();
    return null;
  }
  if (event.onceKey && state.audioOnceKeys.has(event.onceKey)) return null;
  const asset = event.assetId && state.data.assets.audioById.get(event.assetId);
  if (!asset || asset.status !== "available") {
    if (event.bus !== "sfx") stopBus(event.bus);
    return null;
  }
  const current = state.audio.get(event.bus);
  if (event.onceKey) state.audioOnceKeys.add(event.onceKey);
  if ((event.bus === "bgm" || event.loop) && current?._assetId === asset.id && !current._ended) {
    if (event.bus === "bgm") {
      state.bgmIntent = { action: "play", bus: "bgm", assetId: asset.id,
        volume: audioVolume(event.volume, current._stopping ? audioVolume(asset.volume) : current._targetVolume), loop: event.loop ?? current.loop };
      state.bgmFinished = false;
      state.bgmFailure = null;
    }
    synchronizeAudioPlayer(current, { ...event, volume: event.volume ?? (current._stopping ? audioVolume(asset.volume) : current._targetVolume) });
    if (event.bus === "bgm") recoverBgm();
    return current;
  }
  if (event.bus !== "sfx") stopBus(event.bus);
  else if (event.loop) {
    for (const player of [...state.audio.values()]) {
      if (player._bus === "sfx" && player._persistent) removeAudioPlayer(player);
    }
  }
  const key = event.bus === "sfx" ? `sfx:${++state.audioSequence}` : event.bus;
  if (event.bus === "bgm") {
    state.bgmIntent = { action: "play", bus: "bgm", assetId: asset.id,
      volume: audioVolume(event.volume, audioVolume(asset.volume)), loop: event.loop ?? true };
    state.bgmFinished = false;
    state.bgmFailure = null;
  }
  let uri;
  try { uri = assetUrl(asset); } catch (error) { say(error.message); return null; }
  const player = new Audio(uri);
  player._key = key;
  player._assetId = asset.id;
  player._bus = event.bus;
  player._eventVolume = event.fadeMs > 0 ? 0 : audioVolume(event.volume, audioVolume(asset.volume));
  player._targetVolume = player._eventVolume;
  player._fadeFrame = 0;
  player._fadeToken = 0;
  player._stopping = false;
  player._ended = false;
  player.muted = state.muted;
  player.loop = event.loop ?? (event.bus === "bgm");
  player._persistent = player.loop && event.bus !== "voice" && event.bus !== "bgm";
  updatePlayerVolume(player);
  player.addEventListener("ended", () => {
    if (state.audio.get(key) !== player) return;
    if (event.bus === "bgm") {
      cancelAudioFade(player);
      player._ended = !player.loop;
      state.bgmFinished = !player.loop;
      syncBgmStatus();
    } else removeAudioPlayer(player);
  });
  const failed = () => {
    if (state.audio.get(key) !== player) return;
    player._playAttempt = (player._playAttempt || 0) + 1;
    player._playPending = false;
    audioFailure(player, player.error);
  };
  player.addEventListener("error", failed);
  if (event.bus === "bgm") {
    for (const name of ["loadstart", "waiting", "stalled"]) player.addEventListener(name, () => { player._loading = true; syncBgmStatus(); });
    for (const name of ["canplay", "playing"]) player.addEventListener(name, () => { player._loading = false; syncBgmStatus(); });
    player.addEventListener("pause", syncBgmStatus);
  }
  state.audio.set(key, player);
  if (event.bus === "voice" && !player.loop) {
    player._voiceWait = { pageToken: state.audioPageToken, settled: false, finishedAt: 0, timer: 0, lastTime: -1 };
    if (!state.muted && !state.audioSuspended) state.voiceWait = player._voiceWait;
    for (const eventName of ["playing", "timeupdate", "waiting", "stalled"]) {
      player.addEventListener(eventName, () => watchVoiceProgress(player));
    }
  }
  fadeAudioPlayer(player, audioVolume(event.volume, audioVolume(asset.volume)), event.fadeMs);
  startAudioPlayer(player);
  return player;
}

function pageBgmAsset(page) {
  if (!page.audioState || !Object.prototype.hasOwnProperty.call(page.audioState, "bgmAssetId")) return undefined;
  const id = page.audioState.bgmAssetId;
  return id ? state.data.assets.audioById.get(id) || null : null;
}

function bgmSnapshotEvent(page, previous = null) {
  if (!Object.prototype.hasOwnProperty.call(page.audioState || {}, "bgmAssetId")) return undefined;
  const id = page.audioState.bgmAssetId;
  if (!id) return null;
  const before = previous?.assetId === id ? previous : null;
  const asset = state.data.assets.audioById.get(id);
  return {
    action: "play", bus: "bgm", assetId: id,
    volume: page.audioState.bgmVolume ?? before?.volume ?? asset?.volume ?? 1,
    loop: page.audioState.bgmLoop ?? before?.loop ?? true
  };
}

function enforceBgm(page) {
  const current = state.audio.get("bgm");
  const before = current ? { assetId: current._assetId, volume: current._targetVolume, loop: current.loop } : state.bgmIntent;
  const wanted = bgmSnapshotEvent(page, before);
  if (wanted === undefined) { recoverBgm(); return; }
  if (!wanted) {
    if (state.bgmIntent || current && !current._stopping) stopBus("bgm");
    return;
  }
  if (state.bgmIntent?.assetId === wanted.assetId) {
    state.bgmIntent = { ...state.bgmIntent, ...wanted };
    if (current) synchronizeAudioPlayer(current, wanted);
    recoverBgm();
    return;
  }
  playAudioEvent(wanted);
}

function restoreBgm(scene, index, includePage = false) {
  const seek = scene.pages[index]?.seekAudioState;
  if (seek) {
    state.audioOnceKeys = new Set(seek.onceKeys || []);
    const id = seek.bgmAssetId;
    if (!id) stopBus("bgm");
    else playAudioEvent({ action: "play", bus: "bgm", assetId: id, loop: seek.bgmLoop ?? true, volume: seek.bgmVolume ?? 1 });
    return;
  }
  let event = null;
  const limit = includePage ? index : index - 1;
  for (let i = 0; i <= limit; i += 1) {
    const page = scene.pages[i];
    for (const item of page.audioEvents) {
      if (item.bus !== "bgm") continue;
      if (item.action === "play") event = item.assetId ? { ...item } : null;
      else if (item.action === "stop") event = null;
      else if (item.action === "volume" && event) event = { ...event, volume: item.volume, loop: item.loop ?? event.loop };
    }
    const snapshot = bgmSnapshotEvent(page, event);
    if (snapshot !== undefined) event = snapshot;
  }
  const current = state.audio.get("bgm");
  if (!event) stopBus("bgm");
  else if (current?._assetId === event.assetId && !current._ended) {
    const asset = state.data.assets.audioById.get(event.assetId);
    synchronizeAudioPlayer(current, { volume: event.volume ?? asset?.volume ?? 1, loop: event.loop ?? true }, { immediate: true });
  } else playAudioEvent({ ...event, fadeMs: 0 });
}

function auxiliarySnapshot(page) {
  if (!Object.prototype.hasOwnProperty.call(page.audioState || {}, "buses")) return undefined;
  return new Map(Object.entries(page.audioState.buses).filter(([bus, entry]) => bus !== "voice" && bus !== "bgm" && entry?.assetId));
}

function enforceAuxiliaryAudio(page) {
  const desired = auxiliarySnapshot(page);
  if (desired === undefined) return;
  for (const player of [...state.audio.values()]) {
    if (player._persistent && desired.get(player._bus)?.assetId !== player._assetId && !player._stopping) removeAudioPlayer(player);
  }
  for (const [bus, entry] of desired) {
    const current = [...state.audio.values()].find((player) => player._bus === bus && player._assetId === entry.assetId && player.loop);
    if (current) synchronizeAudioPlayer(current, entry);
    else playAudioEvent({ ...entry, action: "play", bus, loop: entry.loop ?? true });
  }
}

function restoreAuxiliaryAudio(scene, index, includePage = false) {
  const seek = scene.pages[index]?.seekAudioState;
  if (seek) {
    for (const player of [...state.audio.values()]) {
      if (player._bus !== "bgm" && player._bus !== "voice") removeAudioPlayer(player);
    }
    for (const [bus, settings] of Object.entries(seek.buses || {})) {
      playAudioEvent({ action: "play", bus, ...settings });
    }
    return;
  }
  let desired = new Map();
  const limit = includePage ? index : index - 1;
  for (let i = 0; i <= limit; i += 1) {
    const page = scene.pages[i];
    for (const item of page.audioEvents) {
      if (item.bus === "voice" || item.bus === "bgm") continue;
      if (item.action === "play") {
        if (item.assetId && item.loop) desired.set(item.bus, { ...item });
        else desired.delete(item.bus);
      } else if (item.action === "stop") desired.delete(item.bus);
      else if (item.action === "volume" && desired.has(item.bus)) {
        desired.set(item.bus, { ...desired.get(item.bus), volume: item.volume, loop: item.loop ?? desired.get(item.bus).loop });
      }
    }
    const snapshot = auxiliarySnapshot(page);
    if (snapshot !== undefined) desired = snapshot;
  }
  for (const player of [...state.audio.values()]) {
    if (player._bus !== "bgm" && player._bus !== "voice") removeAudioPlayer(player);
  }
  for (const [bus, event] of desired) playAudioEvent({ ...event, action: "play", bus, loop: event.loop ?? true, fadeMs: 0 });
}

function processPageAudio(page) {
  state.audioPageToken += 1;
  state.audioPageStartedAt = performance.now();
  state.voiceWait = null;
  stopBus("voice");
  for (const event of page.audioEvents) playAudioEvent(event);
  enforceBgm(page);
  enforceAuxiliaryAudio(page);
}

async function renderVisual(page) {
  const token = ++state.renderToken;
  el.image.hidden = true;
  el.canvas.hidden = true;
  el.image.removeAttribute("src");
  el.imageNote.hidden = true;
  el.frame.style.setProperty("--visual-aspect", "1.777778");
  el.specialPlaceholder.hidden = true;
  el.stage.classList.toggle("is-special", page.presentation?.mode === "special");
  if (page.presentation?.mode === "special") {
    el.placeholder.hidden = true;
    el.imageNote.hidden = true;
    el.specialPlaceholder.hidden = false;
    const reasons = describeVisualReasons(page.presentation.reason || page.source?.presentation?.reason);
    el.specialReason.textContent = reasons.length ? `画面说明：${reasons.join("；")}` : "演出画面暂未还原";
    return;
  }
  const ref = page.visual;
  if (!ref?.assetId) {
    el.placeholder.hidden = false;
    el.imageNote.textContent = `待核对画面：${ref?.sourceRef || "未指定"}`;
    el.imageNote.hidden = false;
    return;
  }
  const asset = state.data.assets.visualById.get(ref.assetId);
  if (asset?.width > 0 && asset?.height > 0) el.frame.style.setProperty("--visual-aspect", String(asset.width / asset.height));
  if (!asset || asset.status !== "available") {
    el.placeholder.hidden = false;
    el.imageNote.textContent = `资源不可用：${ref.sourceRef || ref.assetId}`;
    el.imageNote.hidden = false;
    return;
  }
  el.placeholder.hidden = true;
  if (asset.decoder?.id) {
    try {
      const decoder = await getDecoder(asset.decoder.id);
      const uri = assetUrl(asset);
      let bytes = state.bytes.get(uri);
      if (!bytes) {
        const response = await fetch(uri);
        if (!response.ok) throw new Error(`${asset.uri} (${response.status})`);
        bytes = new Uint8Array(await response.arrayBuffer());
        if (token !== state.renderToken) return;
        if (state.bytes.size >= 4) state.bytes.delete(state.bytes.keys().next().value);
        state.bytes.set(uri, bytes);
      }
      if (token !== state.renderToken) return;
      decoder.render(bytes, asset.decoder, el.canvas);
      el.canvas.hidden = false;
      return;
    } catch (error) {
      if (token !== state.renderToken) return;
      el.placeholder.hidden = false;
      el.imageNote.textContent = `解码失败：${error.message}`;
      el.imageNote.hidden = false;
      return;
    }
  }
  el.image.onload = () => {
    if (token !== state.renderToken) return;
    if (el.image.naturalWidth && el.image.naturalHeight) el.frame.style.setProperty("--visual-aspect", String(el.image.naturalWidth / el.image.naturalHeight));
    el.image.hidden = false;
  };
  el.image.onerror = () => {
    if (token !== state.renderToken) return;
    el.placeholder.hidden = false;
    el.imageNote.textContent = `图片载入失败：${asset.uri}`;
    el.imageNote.hidden = false;
  };
  try { el.image.src = assetUrl(asset); }
  catch (error) { el.placeholder.hidden = false; el.imageNote.textContent = error.message; el.imageNote.hidden = false; }
}

function renderChoices(page) {
  el.choices.replaceChildren();
  const choices = page.choices || [];
  for (const choice of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice-button";
    button.textContent = choice.label || "继续";
    button.disabled = !choice.enabled || (!choice.targetPageId && choice.status !== "end");
    if (choice.condition) button.title = `原始条件：${choice.condition}`;
    if (!choice.targetPageId && choice.targetRef) button.title = `目标待核对：${choice.targetRef}`;
    button.addEventListener("click", () => {
      if (state.data.schemaVersion === "1.1.0") {
        const next = currentPage()?.next;
        if (next?.status === "choice") {
          for (const event of next.audioEvents || []) playAudioEvent(event);
        }
        followTransition(choice);
        return;
      }
      if (choice.targetSceneId && choice.targetSceneId !== state.scene.id) {
        selectScene(choice.targetSceneId, choice.targetPageId);
      } else if (choice.targetPageId) {
        const targetIndex = state.scene.pages.findIndex((item) => item.id === choice.targetPageId);
        if (targetIndex >= 0) selectPage(targetIndex);
      }
    });
    el.choices.append(button);
  }
  el.choices.hidden = choices.length === 0;
}

function renderPageDetails(page) {
  const visual = page.visual;
  const audio = page.audioEvents;
  const eventCg = visual?.role === "event-cg" || page.source?.visualState?.role === "event-cg";
  const limitations = describeVisualReasons(page.source?.visualState?.limitations);
  el.status.textContent = page.presentation?.mode === "special"
    ? "特殊演出待还原"
    : visual?.status === "available" ? eventCg ? limitations.length ? "CG基础画面" : "事件CG已映射" : "已映射" : "待核对画面";
  el.detailScene.textContent = `${state.scene.title || state.scene.id} · ${state.scene.category || "场景"}`;
  el.detailPage.textContent = `${state.pageIndex + 1} / ${state.scene.pages.length} · ${page.label || page.id}`;
  el.detailVisual.textContent = visual?.sourceRef || visual?.assetId || "无";
  el.detailVisualRole.textContent = eventCg
    ? limitations.length ? "CG基础画面 · 源演出未完全还原" : "事件CG"
    : visual?.role || page.source?.visualState?.role || "未标注";
  const bgm = pageBgmAsset(page);
  const active = state.data.assets.audioById.get(state.audio.get("bgm")?._assetId);
  el.detailBgm.textContent = bgm?.name || page.audioState?.sourceBgmKey || active?.name || "无";
  const standing = page.source?.standing || [];
  el.detailStanding.textContent = Array.isArray(standing) && standing.length ? standing.map((item) => item.standingKey || item.characterId).filter(Boolean).join("、") : "无";
  el.audioEvents.replaceChildren();
  const namedEvents = audio.map((event) => ({ event, asset: event.assetId && state.data.assets.audioById.get(event.assetId) }));
  if (!namedEvents.length) {
    const li = document.createElement("li"); li.className = "muted"; li.textContent = "无"; el.audioEvents.append(li);
  } else {
    for (const { event, asset } of namedEvents) {
      const li = document.createElement("li");
      const name = document.createElement("span"); name.textContent = asset?.name || event.sourceName || event.sourceKey || event.bus;
      const kind = document.createElement("span"); kind.className = "event-type";
      const action = { play: "播放", stop: "停止", volume: "调音量" }[event.action] || event.action;
      kind.textContent = `${action} · ${event.bus}${event.status === "unresolved" ? " · 名称未匹配" : ""}${event.loop ? " · 循环" : ""}${event.volume !== undefined ? ` · ${Math.round(event.volume * 100)}%` : ""}${event.fadeMs > 0 ? ` · 淡变 ${event.fadeMs}ms` : ""}${event.sourceTiming ? " · 时机待核对" : ""}`;
      li.append(name, kind); el.audioEvents.append(li);
    }
  }
  el.sourceNote.textContent = [page.source?.dialogueKey, page.source?.originalHImage, page.source?.commandCount ? `${page.source.commandCount} 源命令` : "",
    page.source?.visualState?.reason ? `画面说明：${describeVisualReasons(page.source.visualState.reason).join("；")}` : "",
    page.source?.dialogueSlot !== undefined ? `段落 ${page.source.dialogueSlot} · ${page.source.dialogueRole} · 行 ${page.source.lineIndex + 1}` : "",
    page.next?.status === "unresolved" ? "段落后续待核对；停止自动衔接" : page.next?.status === "end" ? "当前段落终点" : "",
    limitations.length ? `未还原演出：${limitations.join("、")}` : ""].filter(Boolean).join(" · ") || "已标准化页面数据";
}

function renderPage() {
  const page = currentPage();
  if (!page) return;
  el.sceneHeading.textContent = state.scene.title || state.scene.id;
  el.sceneHeading.title = el.sceneHeading.textContent;
  el.pagePosition.textContent = `${state.pageIndex + 1} / ${state.scene.pages.length}`;
  el.speaker.textContent = page.text.speaker || "";
  el.pageLabel.textContent = page.label || "";
  el.text.textContent = page.text.body || "";
  el.dialogue.scrollTop = 0;
  el.slider.max = String(Math.max(0, state.scene.pages.length - 1));
  el.slider.value = String(state.pageIndex);
  el.slider.disabled = state.scene.pages.length <= 1;
  el.pageNumber.max = String(state.scene.pages.length);
  el.pageNumber.value = String(state.pageIndex + 1);
  el.pageTotal.textContent = `/ ${state.scene.pages.length}`;
  el.slider.setAttribute("aria-valuetext", `第 ${state.pageIndex + 1} 页，共 ${state.scene.pages.length} 页`);
  el.previous.disabled = state.pageIndex === 0 && !state.readingHistory.length;
  el.next.disabled = state.data.schemaVersion === "1.1.0"
    ? page.choices.length > 0 : state.pageIndex >= state.scene.pages.length - 1;
  el.firstEventCg.hidden = state.scene.eventCgPages <= 0;
  el.firstEventCg.disabled = state.scene.firstEventCgPageIndex < 0;
  el.firstEventCg.title = state.scene.firstEventCgPageIndex >= 0
    ? `跳至首张CG（第 ${state.scene.firstEventCgPageIndex + 1} 页）` : "首张CG页码待核对";
  el.firstEventCg.setAttribute("aria-label", el.firstEventCg.title);
  renderChoices(page);
  if (page.choices.some((choice) => choice.enabled)) setDialogueVisible(true);
  renderVisual(page);
  for (const button of el.sceneList.querySelectorAll(".scene-item")) button.setAttribute("aria-selected", String(button.dataset.sceneId === state.scene.id));
  processPageAudio(page);
  renderPageDetails(page);
  if (state.auto) scheduleAuto();
}

function selectPage(index, { continueAuto = false } = {}) {
  if (!state.scene || !Number.isFinite(index)) return;
  if (!continueAuto) stopAuto();
  const nextIndex = Math.max(0, Math.min(Math.round(index), state.scene.pages.length - 1));
  const sequential = nextIndex === state.pageIndex + 1;
  state.readingHistory = [];
  state.pageIndex = nextIndex;
  if (!sequential || state.data.schemaVersion === "1.1.0") {
    restoreBgm(state.scene, state.pageIndex, true);
    restoreAuxiliaryAudio(state.scene, state.pageIndex);
  }
  renderPage();
}

function selectScene(id, targetPageId = null) {
  stopAuto();
  const scene = state.data.scenes.find((item) => item.id === id);
  if (!scene) return;
  state.scene = scene;
  state.readingHistory = [];
  state.audioOnceKeys.clear();
  const entry = targetPageId || scene.entryPageId;
  const targetIndex = entry ? scene.pages.findIndex((page) => page.id === entry) : -1;
  state.pageIndex = targetIndex >= 0 ? targetIndex : 0;
  stopAllAudio();
  restoreBgm(scene, state.pageIndex, true);
  restoreAuxiliaryAudio(scene, state.pageIndex);
  if (mobileLayout.matches) { ui.scenesOpen = false; syncPanels(); }
  renderPage();
  [...el.sceneList.children].find((item) => item.dataset.sceneId === id)?.scrollIntoView({ block: "nearest" });
}

function stopAuto() {
  state.auto = false;
  clearTimeout(state.autoTimer);
  setButtonIcon(el.auto, "play", "自动");
  el.auto.setAttribute("aria-pressed", "false");
  el.auto.title = "自动推进";
  el.auto.setAttribute("aria-label", "自动推进");
}

function scheduleAuto() {
  clearTimeout(state.autoTimer);
  const page = currentPage();
  if (!state.auto || !page || page.choices.some((choice) => choice.enabled)) { stopAuto(); return; }
  const wait = state.voiceWait;
  if (wait && wait.pageToken === state.audioPageToken && !wait.settled) return;
  const pageToken = state.audioPageToken;
  const dueAt = Math.max(state.audioPageStartedAt + scenePageDuration(page), wait?.finishedAt ? wait.finishedAt + 250 : 0);
  state.autoTimer = setTimeout(() => {
    if (!state.auto || currentPage() !== page || pageToken !== state.audioPageToken) return;
    if (state.data.schemaVersion === "1.1.0" || state.pageIndex < state.scene.pages.length - 1) {
      advancePage(1);
    } else stopAuto();
  }, Math.max(0, dueAt - performance.now()));
}

function advancePage(direction) {
  if (!state.scene) return;
  if (state.data.schemaVersion === "1.1.0") {
    if (direction > 0) {
      if (currentPage().choices.length) return;
      followTransition(currentPage().next);
    } else if (state.readingHistory.length) {
      const previous = state.readingHistory.pop();
      state.scene = state.data.sceneById.get(previous.sceneId);
      state.pageIndex = previous.pageIndex;
      restoreBgm(state.scene, state.pageIndex, true);
      restoreAuxiliaryAudio(state.scene, state.pageIndex);
      renderPage();
    } else if (state.pageIndex > 0) selectPage(state.pageIndex - 1, { continueAuto: state.auto });
    return;
  }
  const nextIndex = state.pageIndex + direction;
  if (nextIndex >= 0 && nextIndex < state.scene.pages.length) selectPage(nextIndex, { continueAuto: state.auto });
}

function followTransition(transition) {
  if (!transition) { stopAuto(); say("当前段落已结束"); return; }
  const scene = state.data.sceneById.get(transition.targetSceneId || state.scene.id);
  const targetIndex = scene?.pages.findIndex((page) => page.id === transition.targetPageId) ?? -1;
  for (const event of transition.audioEvents || []) playAudioEvent(event);
  if (targetIndex < 0) {
    stopAuto();
    stopBus("voice");
    say(transition.status === "end" ? "当前段落已结束" : "后续需要原游戏演出或状态，暂在这里停止");
    return;
  }
  state.readingHistory.push({ sceneId: state.scene.id, pageIndex: state.pageIndex });
  state.scene = scene;
  state.pageIndex = targetIndex;
  renderPage();
}

function usePackage(source) {
  stopAuto();
  stopAllAudio();
  state.renderToken += 1;
  state.bytes.clear();
  state.source?.dispose();
  state.source = source;
  state.data = source.data;
  state.scene = null;
  el.search.value = "";
  el.category.replaceChildren(new Option("全部分类", ""));
  for (const category of new Set(state.data.scenes.map((scene) => scene.category).filter(Boolean))) {
    el.category.add(new Option(category, category));
  }
  el.visualOnly.checked = false;
  el.eventCgOnly.checked = false;
  el.eventCgOnly.disabled = !state.data.scenes.some((scene) => scene.eventCgKnown);
  el.eventCgOnly.closest("label").title = el.eventCgOnly.disabled ? "数据包未提供事件CG角色信息" : "按导出器确认的事件CG筛选";
  el.title.textContent = state.data.project.title;
  el.projectMeta.textContent = `${state.data.project.engine || "通用数据包"} · schema ${state.data.schemaVersion}`;
  el.packageStatus.textContent = "数据包已载入";
  el.assetCount.textContent = `${state.data.assets.visuals.length} 画面资源 · ${state.data.assets.audio.length} 音频`;
  renderSceneList();
  if (state.data.scenes.length) selectScene(state.data.scenes[0].id);
  say(`${state.data.scenes.length} 个场景已载入`);
}

async function openPackage(url) {
  const token = ++state.loadToken;
  try {
    const source = await loadUrlPackage(url);
    if (token !== state.loadToken) { source.dispose(); return; }
    usePackage(source);
    callNative("rememberPackage", new URL(url, location.href).href);
    callNative("setKeepScreenOn", !document.hidden);
  } catch (error) {
    if (token !== state.loadToken) return;
    el.packageStatus.textContent = "载入失败";
    el.text.textContent = error.message;
    say(error.message);
  }
}

async function refreshPackageCatalog() {
  const indexUrl = new URL("./datasets/index.json", location.href);
  try {
    const response = await fetch(indexUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("Package catalog unavailable");
    const catalog = await response.json();
    el.packageSelect.replaceChildren(new Option("数据包", ""));
    for (const item of catalog.packages || []) {
      const option = document.createElement("option");
      option.value = new URL(item.uri, indexUrl).href;
      option.textContent = item.title;
      el.packageSelect.append(option);
    }
  } catch { /* A single standalone package does not require a package index. */ }
}

function choosePackageUrl(value, title) {
  const url = new URL(value, location.href);
  if (![...el.packageSelect.options].some((option) => option.value === url.href)) {
    el.packageSelect.add(new Option(title || "本地数据包", url.href));
  }
  el.packageSelect.value = url.href;
  return url;
}

async function start() {
  const token = state.loadToken;
  await refreshPackageCatalog();
  if (token !== state.loadToken) return;
  const query = new URLSearchParams(location.search);
  const defaultPackage = el.packageSelect.options[1]?.value;
  const initialPackage = query.get("package") || callNative("getInitialPackage") || defaultPackage;
  if (!initialPackage) { say("请打开本地数据包目录"); return; }
  const url = choosePackageUrl(initialPackage);
  await openPackage(url);
}

const packageFolderLabel = el.packageFolder.closest("label");
if (nativeHost) {
  packageFolderLabel.setAttribute("role", "button");
  packageFolderLabel.tabIndex = 0;
  packageFolderLabel.addEventListener("click", (event) => {
    event.preventDefault();
    callNative("pickPackage");
  });
  packageFolderLabel.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    callNative("pickPackage");
  });
}

el.packageSelect.addEventListener("change", () => {
  if (!el.packageSelect.value) return;
  const url = new URL(location.href);
  url.searchParams.set("package", el.packageSelect.value);
  history.replaceState(null, "", url);
  openPackage(el.packageSelect.value);
});
el.packageFolder.addEventListener("change", async () => {
  if (!el.packageFolder.files.length) return;
  const token = ++state.loadToken;
  try {
    const source = await loadDirectoryPackage(el.packageFolder.files);
    if (token !== state.loadToken) { source.dispose(); return; }
    usePackage(source); el.packageSelect.value = "";
  }
  catch (error) { say(error.message); }
  el.packageFolder.value = "";
});

el.search.addEventListener("input", renderSceneList);
el.category.addEventListener("change", renderSceneList);
el.visualOnly.addEventListener("change", renderSceneList);
el.eventCgOnly.addEventListener("change", renderSceneList);
el.locateScene.addEventListener("click", locateCurrentScene);
el.previous.addEventListener("click", () => advancePage(-1));
el.next.addEventListener("click", () => advancePage(1));
el.firstEventCg.addEventListener("click", () => {
  if (state.scene?.firstEventCgPageIndex >= 0) selectPage(state.scene.firstEventCgPageIndex, { continueAuto: state.auto });
});
el.slider.addEventListener("input", () => {
  stopAuto();
  const number = Number(el.slider.value) + 1;
  el.pageNumber.value = String(number);
  el.pagePosition.textContent = state.scene ? `${number} / ${state.scene.pages.length}` : "";
  el.slider.setAttribute("aria-valuetext", `第 ${number} 页`);
});
el.slider.addEventListener("change", () => selectPage(Number(el.slider.value)));
el.pageNumber.addEventListener("change", () => {
  const value = el.pageNumber.value.trim();
  if (!value) { el.pageNumber.value = String(state.pageIndex + 1); return; }
  selectPage(Number(value) - 1);
});
el.pageNumber.addEventListener("keydown", (event) => {
  if (event.key === "Enter") el.pageNumber.blur();
});
el.stage.addEventListener("click", (event) => {
  if (event.target.closest(".dialogue, button") || currentPage()?.choices.some((choice) => choice.enabled)) return;
  advancePage(1);
});
el.stage.addEventListener("wheel", (event) => {
  if (event.ctrlKey || event.metaKey || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
  const dialogueCanScroll = el.dialogue.contains(event.target)
    && el.dialogue.scrollHeight > el.dialogue.clientHeight + 2
    && (event.deltaY > 0
      ? el.dialogue.scrollTop + el.dialogue.clientHeight < el.dialogue.scrollHeight - 1
      : el.dialogue.scrollTop > 0);
  if (dialogueCanScroll) { state.wheelDelta = 0; return; }
  event.preventDefault();
  const now = performance.now();
  if (state.lastWheelAt && now - state.lastWheelAt < 360) return;
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? Math.max(1, el.stage.clientHeight) : 1;
  state.wheelDelta += event.deltaY * unit;
  if (Math.abs(state.wheelDelta) < 36) return;
  const direction = Math.sign(state.wheelDelta);
  state.wheelDelta = 0;
  state.lastWheelAt = now;
  advancePage(direction);
}, { passive: false });
el.auto.addEventListener("click", () => {
  if (state.auto) stopAuto();
  else {
    state.auto = true;
    setButtonIcon(el.auto, "pause", "暂停");
    el.auto.title = "暂停自动推进";
    el.auto.setAttribute("aria-label", el.auto.title);
    el.auto.setAttribute("aria-pressed", "true");
    scheduleAuto();
  }
});
function syncSoundButton() {
  setButtonIcon(el.sound, state.muted ? "volume-x" : "volume-2");
  el.sound.title = state.muted ? "开启声音" : "关闭声音";
  el.sound.setAttribute("aria-label", el.sound.title);
  el.sound.setAttribute("aria-pressed", String(!state.muted));
}
el.sound.addEventListener("click", () => {
  state.muted = !state.muted;
  syncSoundButton();
  for (const player of state.audio.values()) {
    player.muted = state.muted;
    if (state.muted) settleVoiceWait(player);
    else startAudioPlayer(player);
  }
  if (!state.muted) recoverBgm({ userInitiated: true });
  syncBgmStatus();
  if (currentPage()) renderPageDetails(currentPage());
  if (state.auto) scheduleAuto();
});
function setMasterVolume(bus, input, output, storageKey) {
  const level = Number(input.value) / 100;
  masterVolume[bus] = level;
  output.value = `${input.value}%`;
  output.textContent = output.value;
  try { localStorage.setItem(storageKey, String(level)); } catch { /* Volume remains available for this session. */ }
  applyMasterVolumes();
  syncBgmStatus();
}
el.bgmRetry.addEventListener("click", () => recoverBgm({ userInitiated: true }));
el.bgmVolume.value = String(Math.round(masterVolume.bgm * 100));
el.otherVolume.value = String(Math.round(masterVolume.other * 100));
setMasterVolume("bgm", el.bgmVolume, el.bgmVolumeValue, "cgscene-volume-bgm");
setMasterVolume("other", el.otherVolume, el.otherVolumeValue, "cgscene-volume-other");
el.bgmVolume.addEventListener("input", () => setMasterVolume("bgm", el.bgmVolume, el.bgmVolumeValue, "cgscene-volume-bgm"));
el.otherVolume.addEventListener("input", () => setMasterVolume("other", el.otherVolume, el.otherVolumeValue, "cgscene-volume-other"));
function setMixerOpen(open) {
  syncBgmStatus();
  el.mixer.hidden = !open;
  el.mixerToggle.setAttribute("aria-expanded", String(open));
}
el.mixerToggle.addEventListener("click", () => setMixerOpen(el.mixer.hidden));
document.addEventListener("pointerdown", (event) => {
  if (!el.mixer.hidden && !event.target.closest(".mixer-wrap")) setMixerOpen(false);
});
async function toggleFullscreen() {
  closePanels();
  setMixerOpen(false);
  if (nativeHost) {
    const active = !document.body.classList.contains("is-fullscreen");
    document.body.classList.toggle("is-fullscreen", active);
    callNative("setFullscreen", active);
    syncFullscreen();
    return;
  }
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.body.classList.contains("is-fullscreen")) document.body.classList.remove("is-fullscreen");
    else await document.documentElement.requestFullscreen();
  } catch { document.body.classList.toggle("is-fullscreen"); }
  syncFullscreen();
}
el.fullscreenView.addEventListener("click", toggleFullscreen);
el.exitFullscreen.addEventListener("click", (event) => {
  event.stopPropagation();
  handleBack();
});

function syncPanels() {
  const fullscreen = document.body.classList.contains("is-fullscreen");
  const scenesDrawer = mobileLayout.matches && !portraitLibrary.matches;
  const scenesVisible = !fullscreen && (portraitLibrary.matches || (scenesDrawer ? ui.scenesOpen : !ui.scenesHidden));
  document.body.classList.toggle("scenes-hidden", ui.scenesHidden);
  document.body.classList.toggle("scenes-open", scenesDrawer && ui.scenesOpen);
  document.body.classList.toggle("info-open", ui.infoOpen);
  el.scenePanel.inert = !scenesVisible;
  el.scenePanelToggle.setAttribute("aria-expanded", String(scenesVisible));
  el.inspectorPanelToggle.setAttribute("aria-expanded", String(ui.infoOpen));
  el.infoPanel.hidden = !ui.infoOpen;
  el.backdrop.hidden = fullscreen || !(scenesDrawer && ui.scenesOpen || overlayInfo.matches && ui.infoOpen);
}
function closePanels() { ui.scenesOpen = false; ui.infoOpen = false; syncPanels(); }
el.scenePanelToggle.addEventListener("click", () => {
  if (mobileLayout.matches) {
    ui.scenesOpen = !ui.scenesOpen;
    ui.infoOpen = false;
  } else ui.scenesHidden = !ui.scenesHidden;
  syncPanels();
});
el.inspectorPanelToggle.addEventListener("click", () => {
  ui.infoOpen = !ui.infoOpen;
  ui.scenesOpen = false;
  syncPanels();
});
el.infoClose.addEventListener("click", () => { closePanels(); el.inspectorPanelToggle.focus(); });
el.sceneClose.addEventListener("click", () => { closePanels(); el.scenePanelToggle.focus(); });
el.backdrop.addEventListener("click", () => {
  const returnFocus = ui.scenesOpen ? el.scenePanelToggle : el.inspectorPanelToggle;
  closePanels();
  returnFocus.focus();
});
mobileLayout.addEventListener("change", () => { ui.scenesOpen = false; syncPanels(); });
portraitLibrary.addEventListener("change", () => { ui.scenesOpen = false; syncPanels(); });
overlayInfo.addEventListener("change", syncPanels);
function setDialogueVisible(visible) {
  ui.dialogueVisible = visible;
  el.dialogue.hidden = !ui.dialogueVisible;
  el.dialogueToggle.setAttribute("aria-pressed", String(!ui.dialogueVisible));
  el.dialogueToggle.title = ui.dialogueVisible ? "隐藏对白" : "显示对白";
  el.dialogueToggle.setAttribute("aria-label", el.dialogueToggle.title);
  setButtonIcon(el.dialogueToggle, ui.dialogueVisible ? "message-square" : "message-square-off");
}
el.dialogueToggle.addEventListener("click", () => setDialogueVisible(!ui.dialogueVisible));
function syncFullscreen() {
  const active = document.body.classList.contains("is-fullscreen");
  syncPanels();
  el.exitFullscreen.hidden = !active;
  if (active && document.activeElement === el.fullscreenView) el.exitFullscreen.focus({ preventScroll: true });
  else if (!active && document.activeElement === el.exitFullscreen) el.fullscreenView.focus({ preventScroll: true });
  setButtonIcon(el.fullscreenView, active ? "minimize" : "maximize");
  el.fullscreenView.title = active ? "退出全屏" : "全屏预览";
  el.fullscreenView.setAttribute("aria-label", el.fullscreenView.title);
  el.fullscreenView.setAttribute("aria-pressed", String(active));
}
document.addEventListener("fullscreenchange", () => {
  if (nativeHost) return;
  document.body.classList.toggle("is-fullscreen", Boolean(document.fullscreenElement));
  syncFullscreen();
});

function handleBack() {
  if (!el.mixer.hidden) { setMixerOpen(false); el.mixerToggle.focus(); return true; }
  if (ui.scenesOpen || ui.infoOpen) {
    const returnFocus = ui.scenesOpen ? el.scenePanelToggle : el.inspectorPanelToggle;
    closePanels(); returnFocus.focus();
    return true;
  }
  if (document.body.classList.contains("is-fullscreen") || document.fullscreenElement) {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    document.body.classList.remove("is-fullscreen");
    callNative("setFullscreen", false);
    syncFullscreen();
    return true;
  }
  return false;
}

function pauseForBackground() {
  stopAuto();
  if (state.audioSuspended) return;
  state.audioSuspended = true;
  for (const player of [...state.audio.values()]) {
    if (player._stopping) { removeAudioPlayer(player); continue; }
    cancelAudioFade(player);
    player._playAttempt = (player._playAttempt || 0) + 1;
    player._playPending = false;
    player.pause();
    settleVoiceWait(player);
  }
  syncBgmStatus();
  callNative("setKeepScreenOn", false);
}

function resumeForForeground() {
  if (document.hidden) return;
  const suspended = state.audioSuspended;
  state.audioSuspended = false;
  if (suspended) {
    for (const player of state.audio.values()) {
      fadeAudioPlayer(player, player._targetVolume, 0);
      startAudioPlayer(player);
    }
  }
  recoverBgm();
  callNative("setKeepScreenOn", Boolean(state.data));
}

window.CGSceneAndroid = {
  async onPackageSelected({ url, title } = {}) {
    if (!nativeHost || !url) return;
    const selected = new URL(url, location.href);
    if (selected.origin !== location.origin) { say("请选择本机数据包"); return; }
    const token = ++state.loadToken;
    await refreshPackageCatalog();
    if (token !== state.loadToken) return;
    choosePackageUrl(selected, title);
    const currentUrl = new URL(location.href);
    currentUrl.searchParams.set("package", selected.href);
    history.replaceState(null, "", currentUrl);
    await openPackage(selected);
  },
  onBackground: pauseForBackground,
  onForeground: resumeForForeground,
  onFullscreenChanged(active) {
    document.body.classList.toggle("is-fullscreen", Boolean(active));
    syncFullscreen();
  },
  handleBack
};
document.addEventListener("visibilitychange", () => {
  if (!nativeHost) return;
  if (document.hidden) pauseForBackground();
  // Native foreground callback also checks the activity and any active file picker.
  else callNative("requestForeground");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { if (handleBack()) event.preventDefault(); return; }
  if (event.target.closest("input, select, textarea, [role='listbox'], [contenteditable='true']") || ui.scenesOpen || overlayInfo.matches && ui.infoOpen) return;
  if (event.key === "ArrowLeft") { event.preventDefault(); advancePage(-1); }
  if (event.key === "ArrowRight" || event.key === " " && !event.target.closest("button, a")) { event.preventDefault(); advancePage(1); }
});

document.addEventListener("click", retryBlockedAudio);
document.addEventListener("keydown", retryBlockedAudio);

syncPanels();
syncSoundButton();
start();
