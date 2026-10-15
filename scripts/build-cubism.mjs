import { mkdir, copyFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const sdk = path.resolve(process.argv[2] || "D:/tools/CubismSdkForWeb-5-r.5");
const bun = process.env.BUN_EXE || path.join(process.env.USERPROFILE || "", ".bun/bin/bun.exe");
const output = path.join(root, "player/vendor/cubism");
const tmp = path.join(root, "tmp/cubism-build");
await mkdir(tmp, { recursive: true });
await mkdir(path.join(output, "licenses"), { recursive: true });
const runner = path.join(tmp, "bundle.mjs");
await writeFile(runner, `import path from 'node:path';
const result = await Bun.build({ entrypoints: [${JSON.stringify(path.join(root, "player/cubism/runtime.ts"))}], target: 'browser', format: 'esm', minify: true,
  plugins: [{ name: 'local-cubism-framework', setup(build) {
    build.onResolve({ filter: /^@framework\\// }, args => ({ path: path.join(${JSON.stringify(sdk)}, 'Framework/src', args.path.slice('@framework/'.length) + '.ts') }));
  }}] });
if (!result.success) { for (const log of result.logs) console.error(log); process.exit(1); }
await Bun.write(${JSON.stringify(path.join(output, "runtime.js"))}, result.outputs[0]);
`);
const result = spawnSync(bun, [runner], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
await copyFile(path.join(sdk, "Core/live2dcubismcore.min.js"), path.join(output, "live2dcubismcore.min.js"));
await mkdir(path.join(output, "shaders"), { recursive: true });
for (const filename of await readdir(path.join(sdk, "Framework/Shaders/WebGL"))) {
  await copyFile(path.join(sdk, "Framework/Shaders/WebGL", filename), path.join(output, "shaders", filename));
}
for (const [source, target] of [["LICENSE.md", "SDK-LICENSE.md"], ["NOTICE.md", "SDK-NOTICE.md"], ["Core/LICENSE.md", "CORE-LICENSE.md"], ["Framework/LICENSE.md", "FRAMEWORK-LICENSE.md"]]) {
  await copyFile(path.join(sdk, source), path.join(output, "licenses", target));
}
await writeFile(path.join(output, "README.md"), `# Local Cubism runtime\n\nBuilt with Cubism SDK for Web 5-r.5. Framework and Core have separate licenses; see licenses/.\nRebuild: node scripts/build-cubism.mjs <SDK-directory>\nNo model assets are included in this runtime. Model usage terms are separate.\n`);
console.log("Local desktop Cubism runtime built.");
