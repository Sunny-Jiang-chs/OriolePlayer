import { playbackIdentity } from "./vendor/cgscene/visual-state.js";
import { getDecoder } from "./decoders/registry.js";

let cubismRuntime;
function loadCubism() {
  if (!cubismRuntime) cubismRuntime = (async () => {
    if (!globalThis.Live2DCubismCore) await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("./vendor/cubism/live2dcubismcore.min.js", import.meta.url).href;
      script.onload = resolve;
      script.onerror = () => { script.remove(); reject(new Error("Cubism Core 未安装，请先运行 build:cubism")); };
      document.head.append(script);
    });
    return import("./vendor/cubism/runtime.js");
  })().catch((error) => { cubismRuntime = null; throw error; });
  return cubismRuntime;
}

async function checkedFetch(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`资源请求失败 (${response.status})`);
  return response;
}

function loadMedia(element, url, event, signal) {
  return new Promise((resolve, reject) => {
    const done = (error) => {
      element.removeEventListener(event, ready);
      element.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
      error ? reject(error) : resolve();
    };
    const ready = () => done();
    const failed = () => done(new Error("媒体载入失败或浏览器不支持此格式"));
    const aborted = () => done(new DOMException("Aborted", "AbortError"));
    element.addEventListener(event, ready, { once: true });
    element.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) return aborted();
    element.src = url;
  });
}

/** Local display of complete page snapshots on desktop and Android WebView. */
export class VisualStage {
  constructor(root, onStatus = () => {}) {
    this.root = root;
    this.onStatus = onStatus;
    this.entries = new Map();
    this.paused = false;
    this.suspended = false;
    this.source = null;
  }

  clear() {
    for (const entry of this.entries.values()) this.remove(entry);
    this.entries.clear();
    this.root.hidden = true;
    this.source = null;
    this.emit();
  }

  remove(entry) {
    entry.abort.abort();
    entry.controller?.dispose();
    entry.node.remove();
  }

  emit() {
    this.onStatus([...this.entries.values()].map((entry) => ({
      id: entry.layer.id, kind: entry.kind, status: entry.status,
      instanceId: entry.layer.playback.instanceId, loop: entry.layer.playback.loop,
      message: entry.message || "", paused: this.paused || this.suspended || !entry.layer.playback.playing
    })));
  }

  setPaused(value) { this.paused = value; this.updateControllers(); }
  setSuspended(value) { this.suspended = value; this.updateControllers(); }
  updateControllers() {
    for (const entry of this.entries.values()) entry.controller?.update(entry.layer, this.paused || this.suspended);
    this.emit();
  }

  async show(snapshot, assets, source, { reset = false } = {}) {
    if (source !== this.source || reset) this.clear();
    this.source = source;
    this.root.hidden = false;
    this.root.style.background = snapshot.background;
    const visible = snapshot.layers.filter((layer) => layer.visible);
    const wanted = new Set(visible.map((layer) => layer.id));
    for (const [id, entry] of this.entries) if (!wanted.has(id)) { this.remove(entry); this.entries.delete(id); }
    const pending = [];
    for (const layer of visible) {
      const asset = assets.get(layer.assetId);
      const key = `${playbackIdentity(layer)}:${layer.status}`;
      let entry = this.entries.get(layer.id);
      if (entry && entry.key !== key) { this.remove(entry); this.entries.delete(layer.id); entry = null; }
      if (!entry) {
        const node = document.createElement("div");
        node.className = "visual-layer";
        node.dataset.layerId = layer.id;
        entry = { key, node, layer, kind: asset?.kind || "image", abort: new AbortController(), status: "loading" };
        this.entries.set(layer.id, entry);
        this.root.append(node);
        pending.push(this.create(entry, asset, source));
      }
      entry.layer = layer;
      this.root.append(entry.node);
      Object.assign(entry.node.style, {
        left: `${100 * layer.x / snapshot.width}%`, top: `${100 * layer.y / snapshot.height}%`,
        width: `${100 * layer.width / snapshot.width}%`, height: `${100 * layer.height / snapshot.height}%`,
        transform: `rotate(${layer.rotation}deg)`, opacity: layer.opacity, zIndex: layer.zIndex,
        "--layer-fit": layer.fit
      });
      entry.controller?.update(layer, this.paused || this.suspended);
    }
    this.emit();
    await Promise.all(pending);
  }

  async create(entry, asset, source) {
    const { node, abort } = entry;
    const signal = abort.signal;
    try {
      if (entry.layer.status !== "available" || asset?.status !== "available") throw new Error("特殊演出 · 资源待解析");
      if (entry.kind === "live2d") {
        const runtime = await loadCubism();
        if (signal.aborted) return;
        const canvas = document.createElement("canvas");
        node.append(canvas);
        entry.controller = await runtime.createCubismLayer({ canvas, asset, source, signal, layer: entry.layer });
      } else if (entry.kind === "video") {
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        node.append(video);
        const report = (message) => { if (!signal.aborted) { entry.message = message; this.emit(); } };
        let wantedPlaying = false;
        const controller = {
          update(layer, paused) {
            video.loop = layer.playback.loop;
            video.playbackRate = layer.playback.rate;
            const wanted = entry.status === "ready" && layer.playback.playing && !paused;
            if (wanted && !wantedPlaying) video.play().catch(() => report("浏览器暂停了视频；点击继续动画重试"));
            if (!wanted) video.pause();
            else if (!wantedPlaying) report("");
            wantedPlaying = wanted;
          },
          dispose() { video.pause(); video.removeAttribute("src"); video.load(); }
        };
        entry.controller = controller;
        await loadMedia(video, source.resolve(asset.uri), "loadeddata", signal);
        if (signal.aborted) return;
        const start = entry.layer.playback.startTime;
        video.currentTime = Number.isFinite(video.duration) && video.duration > 0 ? (entry.layer.playback.loop ? start % video.duration : Math.min(start, video.duration)) : start;
        video.addEventListener("ended", () => report("播放结束"));
      } else if (asset.decoder?.id) {
        const decoder = await getDecoder(asset.decoder.id);
        const response = await checkedFetch(source.resolve(asset.uri), signal);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (signal.aborted) return;
        const canvas = document.createElement("canvas");
        decoder.render(bytes, asset.decoder, canvas);
        node.append(canvas);
      } else {
        const image = new Image(); image.alt = ""; image.draggable = false;
        node.append(image);
        await loadMedia(image, source.resolve(asset.uri), "load", signal);
      }
      if (signal.aborted) { entry.controller?.dispose(); return; }
      entry.status = "ready";
      entry.controller?.update(entry.layer, this.paused || this.suspended);
    } catch (error) {
      if (signal.aborted) return;
      entry.controller?.dispose(); entry.controller = null;
      entry.status = "error";
      entry.message = error.message;
      const placeholder = document.createElement("div");
      placeholder.className = "layer-placeholder";
      placeholder.textContent = `${entry.layer.id} · ${error.message}`;
      node.replaceChildren(placeholder);
    }
    this.emit();
  }
}
