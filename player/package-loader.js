import { normalizePackage } from "./vendor/cgscene/package-model.js";
export { normalizePackage, SCHEMA_VERSION } from "./vendor/cgscene/package-model.js";

export async function loadUrlPackage(url) {
  const manifestUrl = new URL(url, location.href);
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) {
    // The Android local server provides useful permission/reselection guidance.
    const localMessage = manifestUrl.origin === "https://appassets.androidplatform.net"
      && response.headers.get("content-type")?.startsWith("text/plain")
      ? (await response.text()).trim().slice(0, 300) : "";
    throw new Error(localMessage || `数据包请求失败 (${response.status})：${manifestUrl.pathname}`);
  }
  const data = normalizePackage(await response.json());
  return { data, resolve: (uri) => new URL(uri, manifestUrl).href, dispose() {} };
}

function relativePath(value) {
  const parts = [];
  for (const part of value.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("资源路径超出所选目录");
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

export async function loadDirectoryPackage(fileList) {
  const files = [...fileList];
  const manifest = files.find((file) => file.name === "package.json");
  if (!manifest) throw new Error("所选目录里没有 package.json");
  const paths = new Map(files.map((file) => [file.webkitRelativePath || file.name, file]));
  const manifestPath = manifest.webkitRelativePath || manifest.name;
  const base = manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1);
  const data = normalizePackage(JSON.parse(await manifest.text()));
  const objectUrls = new Map();
  return {
    data,
    resolve(uri) {
      const path = relativePath(`${base}${uri}`);
      const file = paths.get(path);
      if (!file) throw new Error(`数据包缺少文件：${uri}`);
      if (!objectUrls.has(path)) objectUrls.set(path, URL.createObjectURL(file));
      return objectUrls.get(path);
    },
    dispose() {
      for (const url of objectUrls.values()) URL.revokeObjectURL(url);
      objectUrls.clear();
    }
  };
}
