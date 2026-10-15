import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const sdk = path.resolve(process.argv[2] || "D:/tools/CubismSdkForWeb-5-r.5");
const output = path.join(root, "datasets/animation-demo");
await mkdir(output, { recursive: true });
const origin = path.join(sdk, "Samples/Resources/Wanko");
const setting = JSON.parse(await readFile(path.join(origin, "Wanko.model3.json"), "utf8"));
const files = setting.FileReferences;
const refs = [files.Moc, ...files.Textures, files.Physics, files.DisplayInfo, ...Object.values(files.Motions).flat().map((motion) => motion.File)].filter(Boolean);
for (const file of ["Wanko.model3.json", ...refs]) {
  const target = path.join(output, "model", file);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(origin, file), target);
}
await writeFile(path.join(output, "background.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#243744"/><path d="M0 500H1280M320 0V720M960 0V720" stroke="#446474" stroke-width="2"/><text x="36" y="65" font-family="sans-serif" font-size="30" fill="#b7d6df">CG Scene 1.2 / desktop animation demo</text></svg>');
await writeFile(path.join(output, "model/expression.exp3.json"), JSON.stringify({ Type: "Live2D Expression", FadeInTime: 0.2, FadeOutTime: 0.2, Parameters: [{ Id: "PARAM_MOUTH_OPEN_Y", Value: 0.6, Blend: "Overwrite" }] }));
const asset = { id: "wanko", kind: "live2d", status: "available", uri: "model/Wanko.model3.json", dependencies: [...refs.map((r) => `model/${r}`), "model/expression.exp3.json"] };
const background = { id: "back", assetId: "background", status: "available", role: "background" };
const dog = (playback = {}) => ({ id: "subject", assetId: "wanko", status: "available", role: "event-cg", x: 300, y: 30, width: 680, height: 650,
  playback: { instanceId: "idle-A", motion: "model/motions/idle_01.motion3.json", loop: true, ...playback } });
const entries = [
  ["循环动画", "这是 SDK 的 Wanko 示例模型。动画独立循环，页面不会自己翻动；可以全屏查看。", [background, dog()]],
  ["跨页延续", "实例 ID 和动作相同，接着上一页播放。这一页的速度提高到 1.5 倍，参数和位置改变也不需要重建实例。", [background, dog({ rate: 1.5, parameters: { PARAM_ANGLE_X: 12 } })]],
  ["表情与单次动作", "切换实例和动作后从头播放；这一页使用单次动作与一个示例表情。上方可暂停动画，或重播本页。", [background, dog({ instanceId: "touch-B", motion: "model/motions/touch_02.motion3.json", expression: "model/expression.exp3.json", loop: false })]],
  ["明确清屏", "这一页 layers 为空。上一页的模型和背景都应消失，只保留黑底和对白。", []],
  ["待解析占位", "无法确定资源时显示明确占位，不继承此前画面，也不猜测原游戏的演出。", [{ id: "pending", assetId: null, status: "unresolved" }]],
  ["恢复动画", "再次进入模型页，实例从声明的起点播放。通过页码、进度条或上一页定位时也会重新恢复目标页状态。", [background, dog({ instanceId: "idle-C" })]]
];
const pages = entries.map(([label, body, layers], i) => ({ id: `p${i + 1}`, order: i, label,
  text: { speaker: "预览说明", body }, visual: { assetId: null, status: "unresolved" },
  visualState: { width: 1280, height: 720, background: "#000000", layers }, audioEvents: [], choices: [],
  next: i < entries.length - 1 ? { targetPageId: `p${i + 2}`, status: "resolved" } : null }));
const manifest = { schemaVersion: "1.2.0", project: { id: "animation-demo", title: "动态页面演示 · Wanko", engine: "CGScene 1.2" },
  assets: { visuals: [asset, { id: "background", kind: "image", uri: "background.svg", status: "available" }], audio: [] },
  scenes: [{ id: "animation", title: "图层与动画生命周期", entryPageId: "p1", pages }] };
const ffmpeg = process.env.FFMPEG_EXE || "D:/tools/ffmpeg/ffmpeg-9.0.1-essentials_build/bin/ffmpeg.exe";
const video = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24", "-t", "3", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(output, "test-pattern.mp4")], { stdio: "inherit" });
if (video.error || video.status !== 0) throw new Error("无法生成合成视频，请设置 FFMPEG_EXE");
manifest.assets.visuals.push({ id: "video", kind: "video", uri: "test-pattern.mp4", status: "available" });
manifest.scenes.push({ id: "video", title: "视频与跨页延续", entryPageId: "v1", pages: [
  { body: "三秒合成视频循环播放；视频内嵌声音关闭，配音和 BGM 仍由 audioEvents 管理。", playback: { instanceId: "video-A", loop: true } },
  { body: "同一视频实例继续播放，速度变为 0.75 倍。", playback: { instanceId: "video-A", loop: true, rate: 0.75 } },
  { body: "新实例从第 1 秒开始，playing=false 保持暂停。播放器暂停控制不会覆盖作者声明的暂停状态。", playback: { instanceId: "video-B", loop: false, startTime: 1, playing: false } },
  { body: "明确清屏，视频实例应已释放。", clear: true }
].map((entry, i) => ({ id: `v${i + 1}`, order: i, text: { speaker: "视频测试", body: entry.body },
  visual: { assetId: null, status: "unresolved" }, audioEvents: [], choices: [],
  visualState: { width: 1280, height: 720, layers: entry.clear ? [] : [{ id: "clip", assetId: "video", status: "available", role: "event-cg", playback: entry.playback }] },
  next: i < 3 ? { targetPageId: `v${i + 2}`, status: "resolved" } : null })) });
await writeFile(path.join(output, "package.json"), JSON.stringify(manifest, null, 2));
await copyFile(path.join(sdk, "LICENSE.md"), path.join(output, "SDK-LICENSE.md"));
await writeFile(path.join(output, "README.md"), "SDK Wanko 模型仅用于本地验证；模型授权见 SDK/LICENSE 和官方样例使用条款。不是游戏提取结果。本目录不进入 Git。\n");
console.log(`Demo ready: ${output}`);
