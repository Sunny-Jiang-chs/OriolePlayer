import http from "node:http";
import { createReadStream } from "node:fs";
import { stat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
// Optional local integration. Neither the player nor its release needs this sibling project.
const parsersRoot = path.resolve(root, "../CGSceneParsers");
const organizerEntry = path.join(parsersRoot, "organizer/index.html");
async function organizerAvailable() {
  try { return (await stat(organizerEntry)).isFile(); } catch { return false; }
}
function inside(base, filename) {
  const relative = path.relative(base, filename);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
const portArgument = process.argv.indexOf('--port');
const port = Number(portArgument >= 0 ? process.argv[portArgument + 1] : process.env.PORT || 8768);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ogg": "audio/ogg", ".wav": "audio/wav", ".mp3": "audio/mpeg" };

const server = http.createServer(async (request, response) => {
  try {
    if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405); response.end(); return; }
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname === '/__cgscene_status') {
      const body = JSON.stringify({ app: 'cg-scene-studio', root, pid: process.pid,
        integrationVersion: 1, organizer: await organizerAvailable() ? { url: '/organizer/index.html' } : null });
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
      response.end(request.method === 'HEAD' ? undefined : body);
      return;
    }
    // Only these two directories are mounted; exporters, reports and source games stay outside.
    const mountedFolder = ['/organizer/', '/vendor/'].find((prefix) => pathname.startsWith(prefix));
    const base = mountedFolder ? path.join(parsersRoot, mountedFolder.slice(1, -1)) : root;
    const requested = mountedFolder ? pathname.slice(mountedFolder.length) : pathname === '/' ? 'index.html' : pathname.slice(1);
    const filename = path.resolve(base, requested);
    if (!inside(base, filename)) { response.writeHead(403); response.end(); return; }
    if (!inside(await realpath(base), await realpath(filename))) { response.writeHead(403); response.end(); return; }
    const info = await stat(filename);
    if (!info.isFile()) { response.writeHead(404); response.end(); return; }
    const headers = { "Content-Type": types[path.extname(filename).toLowerCase()] || "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "no-cache" };
    let start = 0;
    let end = info.size - 1;
    let status = 200;
    if (request.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      if (!match || (!match[1] && !match[2])) { response.writeHead(416, { "Content-Range": `bytes */${info.size}` }); response.end(); return; }
      if (match[1]) { start = Number(match[1]); end = match[2] ? Number(match[2]) : end; }
      else start = Math.max(0, info.size - Number(match[2]));
      end = Math.min(end, info.size - 1);
      if (start > end || start >= info.size) { response.writeHead(416, { "Content-Range": `bytes */${info.size}` }); response.end(); return; }
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
    }
    headers["Content-Length"] = Math.max(0, end - start + 1);
    response.writeHead(status, headers);
    if (request.method === "HEAD" || info.size === 0) response.end();
    else createReadStream(filename, { start, end }).on("error", () => response.destroy()).pipe(response);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 400);
    response.end();
  }
});
server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
server.listen(port, "127.0.0.1", () => console.log(`黄鹂播放器: http://127.0.0.1:${port}/`));
