import { CubismFramework, Option } from '@framework/live2dcubismframework';
import { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import { CubismUserModel } from '@framework/model/cubismusermodel';
import { CubismShaderManager_WebGL } from '@framework/rendering/cubismshader_webgl';
import { dependencyUri } from '../vendor/cgscene/visual-state.js';

// The SDK is bundled at build time; Core is loaded locally by visual-stage.js.
let liveSessions = 0;
class Session extends CubismUserModel {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  textures: WebGLTexture[] = [];
  disposed = false;
  frame = 0;
  lastTime = 0;
  layer: any;
  paused = false;
  modelWidth = 2;
  modelHeight = 2;
  observer: ResizeObserver;
  baseParts: number[] = [];
  elapsed = 0;
  pixelRatioLimit = 2;
  renderSizeLimit = 4096;
  frameInterval = 0;

  constructor(canvas: HTMLCanvasElement) {
    super();
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true }) as any;
    if (!this.gl) this.gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true });
    if (!this.gl) throw new Error('WebGL 不可用');
    const touch = matchMedia('(pointer: coarse)').matches;
    this.pixelRatioLimit = touch ? 1.5 : 2;
    this.renderSizeLimit = Math.min(touch ? 2048 : 4096, this.gl.getParameter(this.gl.MAX_RENDERBUFFER_SIZE));
    this.frameInterval = touch ? 1000 / 30 : 0;
    liveSessions++;
    this.observer = new ResizeObserver(() => { this.resize(); if (this.layer && !this.disposed) this.draw(); });
    this.observer.observe(canvas);
  }

  resize() {
    const ratio = Math.min(devicePixelRatio || 1, this.pixelRatioLimit);
    const rect = this.canvas.getBoundingClientRect();
    const scale = Math.min(ratio, this.renderSizeLimit / Math.max(1, rect.width, rect.height));
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  async init(asset: any, source: any, signal: AbortSignal, layer: any) {
    const buffer = async (uri: string) => {
      const response = await fetch(source.resolve(uri), { signal });
      if (!response.ok) throw new Error(`模型文件请求失败 (${response.status})：${uri}`);
      return response.arrayBuffer();
    };
    const check = () => { if (signal.aborted || this.disposed) throw new DOMException('Aborted', 'AbortError'); };
    const settings = JSON.parse(new TextDecoder().decode(await buffer(asset.uri)));
    check();
    const files = settings.FileReferences;
    if (!files?.Moc || !Array.isArray(files.Textures)) throw new Error('需要 Cubism model3.json / moc3 模型');
    const dependency = (relative: string) => dependencyUri(asset, relative);
    const moc = await buffer(dependency(files.Moc)); check();
    this.loadModel(moc, true);
    if (!this.getModel()) throw new Error('MOC3 初始化失败');
    this.resize();
    this.createRenderer(this.canvas.width, this.canvas.height);
    const renderer = this.getRenderer();
    renderer.startUp(this.gl);
    renderer.setIsPremultipliedAlpha(true);
    renderer.loadShaders(new URL('./shaders/', import.meta.url).href);
    const shader = CubismShaderManager_WebGL.getInstance().getShader(this.gl);
    const deadline = performance.now() + 10000;
    while (!shader._isShaderLoaded) {
      if (!shader._isShaderLoading || performance.now() > deadline) throw new Error('Cubism 着色器载入失败');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    check();
    for (let index = 0; index < files.Textures.length; index++) {
      const response = await fetch(source.resolve(dependency(files.Textures[index])), { signal });
      if (!response.ok) throw new Error(`纹理请求失败 (${response.status})`);
      const blob = await response.blob(); check();
      const url = URL.createObjectURL(blob);
      const image = new Image();
      try {
        image.src = url;
        await image.decode(); check();
        const gl = this.gl, texture = gl.createTexture();
        if (!texture) throw new Error('纹理初始化失败');
        this.textures.push(texture);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
        const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        if (image.naturalWidth > maxTextureSize || image.naturalHeight > maxTextureSize) {
          const scaled = document.createElement('canvas');
          const ratio = maxTextureSize / Math.max(image.naturalWidth, image.naturalHeight);
          scaled.width = Math.max(1, Math.floor(image.naturalWidth * ratio));
          scaled.height = Math.max(1, Math.floor(image.naturalHeight * ratio));
          scaled.getContext('2d').drawImage(image, 0, 0, scaled.width, scaled.height);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scaled);
          scaled.width = scaled.height = 0;
        } else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        renderer.bindTexture(index, texture);
      } finally { URL.revokeObjectURL(url); }
    }
    for (const [field, method] of [['Physics', 'loadPhysics'], ['Pose', 'loadPose']] as const) {
      if (!files[field]) continue;
      const bytes = await buffer(dependency(files[field])); check();
      this[method](bytes, bytes.byteLength);
    }
    const model = this.getModel();
    const info = model.getModel().canvasinfo;
    const w = model.getCanvasWidth(), h = model.getCanvasHeight();
    const scale = 2 / Math.max(w, h);
    this.modelWidth = w * scale; this.modelHeight = h * scale;
    const matrix = this.getModelMatrix();
    matrix.loadIdentity(); matrix.scale(scale, scale);
    matrix.translate(-(w / 2 - info.CanvasOriginX / model.getPixelsPerUnit()) * scale,
      -(h / 2 - info.CanvasOriginY / model.getPixelsPerUnit()) * scale);
    this.baseParts = Array.from({ length: model.getPartCount() }, (_, i) => model.getPartOpacityByIndex(i));
    model.saveParameters();
    if (layer.playback.motion) {
      const bytes = await buffer(layer.playback.motion); check();
      const motion = this.loadMotion(bytes, bytes.byteLength, layer.playback.motion);
      if (!motion) throw new Error('motion3 解析失败');
      motion.setLoop(layer.playback.loop);
      const duration = motion.getLoopDuration();
      motion.setOffsetTime(layer.playback.loop && duration > 0 ? layer.playback.startTime % duration : layer.playback.startTime);
      const groupIds = (name: string) => {
        const ids = [];
        for (const group of settings.Groups || []) if (group.Name === name && group.Target === 'Parameter') {
          for (const id of group.Ids || []) ids.push(CubismFramework.getIdManager().getId(id));
        }
        return ids;
      };
      motion.setEffectIds(groupIds('EyeBlink'), groupIds('LipSync'));
      this._motionManager.startMotionPriority(motion, true, 3);
    }
    if (layer.playback.expression) {
      const bytes = await buffer(layer.playback.expression); check();
      const expression = this.loadExpression(bytes, bytes.byteLength, layer.playback.expression);
      if (!expression) throw new Error('exp3 解析失败');
      this._expressionManager.startMotion(expression, true);
    }
    this.layer = layer;
    this.step(0);
    this.draw();
    this.schedule();
  }

  schedule() {
    if (!this.frame && !this.disposed && !this.paused && this.layer?.playback.playing)
      this.frame = requestAnimationFrame((time) => this.tick(time));
  }
  update(layer: any, paused: boolean) {
    this.layer = layer; this.paused = paused;
    this.step(0); this.draw();
    if (paused || !layer.playback.playing) { cancelAnimationFrame(this.frame); this.frame = 0; this.lastTime = 0; }
    else this.schedule();
  }
  step(delta: number) {
    const model = this.getModel();
    model.loadParameters();
    this.baseParts.forEach((value, i) => model.setPartOpacityByIndex(i, value));
    this._motionManager.updateMotion(model, delta);
    model.saveParameters();
    this.baseParts = this.baseParts.map((_, i) => model.getPartOpacityByIndex(i));
    this._expressionManager.updateMotion(model, delta);
    this._physics?.evaluate(model, delta);
    this._pose?.updateParameters(model, delta);
    const ids = CubismFramework.getIdManager();
    for (const [id, value] of Object.entries(this.layer.playback.parameters)) model.setParameterValueById(ids.getId(id), value as number);
    for (const [id, value] of Object.entries(this.layer.playback.parts)) model.setPartOpacityById(ids.getId(id), value as number);
    model.update();
  }
  draw() {
    const gl = this.gl, { width, height } = this.canvas;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const aspect = width / height;
    const fit = (this.layer.fit === 'cover' ? Math.max : Math.min)(2 / this.modelHeight, 2 * aspect / this.modelWidth);
    const matrix = new CubismMatrix44();
    matrix.scale(fit / aspect, fit); matrix.multiplyByMatrix(this.getModelMatrix());
    const renderer = this.getRenderer();
    renderer.setRenderState(null, [0, 0, width, height]); renderer.setMvpMatrix(matrix); renderer.drawModel();
  }
  tick(time: number) {
    this.frame = 0;
    if (this.disposed) return;
    if (this.lastTime && time - this.lastTime + 0.5 < this.frameInterval) { this.schedule(); return; }
    const delta = this.lastTime ? Math.min((time - this.lastTime) / 1000, 0.1) : 0;
    this.lastTime = time;
    if (!this.paused && this.layer.playback.playing) {
      this.elapsed += delta * this.layer.playback.rate;
      this.step(delta * this.layer.playback.rate);
    }
    this.draw();
    this.schedule();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame); this.observer.disconnect();
    this.release();
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    this.textures = [];
    if (--liveSessions === 0) CubismShaderManager_WebGL.deleteInstance();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

export async function createCubismLayer({ canvas, asset, source, signal, layer }: any) {
  if (!CubismFramework.isStarted()) CubismFramework.startUp(new Option());
  if (!CubismFramework.isInitialized()) CubismFramework.initialize();
  const session = new Session(canvas);
  try { await session.init(asset, source, signal, layer); return session; }
  catch (error) { session.dispose(); throw error; }
}
