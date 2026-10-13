package com.cgscenestudio.player;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Virtual HTTPS origin; local files only, including byte ranges for HTML audio. */
final class LocalContent {
    private final Context context;
    private final PackageStore store;
    LocalContent(Context context, PackageStore store) { this.context = context; this.store = store; }

    static boolean trusted(Uri uri) {
        return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost()) && uri.getPort() == -1;
    }

    WebResourceResponse serve(WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!trusted(uri)) return message(403, "Forbidden", "仅允许本地数据包");
        if (!request.getMethod().equals("GET") && !request.getMethod().equals("HEAD")) return message(405, "Method Not Allowed", "");
        try {
            String path = uri.getPath();
            if (path.equals("/datasets/index.json")) return json(store.index().toString());
            if (path.equals("/")) path = "/index.html";
            PackageStore.safePath(path.substring(1));
            InputStream stream; long size; String mime = mime(path);
            if (path.startsWith("/packages/")) {
                String[] parts = path.substring(10).split("/", 2);
                if (parts.length != 2) throw new FileNotFoundException();
                size = store.size(parts[0], parts[1]);
                stream = store.open(parts[0], parts[1]);
            } else {
                stream = context.getAssets().open("web" + path);
                size = stream.available();
            }
            long start = 0, end = size - 1; int status = 200;
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            headers.put("X-Content-Type-Options", "nosniff");
            String range = null;
            for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet())
                if (header.getKey().equalsIgnoreCase("Range")) range = header.getValue();
            if (size >= 0) headers.put("Accept-Ranges", "bytes");
            if (range != null && size >= 0) {
                try {
                    if (!range.matches("bytes=\\d*-\\d*")) throw new IOException();
                    String[] values = range.substring(6).split("-", -1);
                    if (values[0].isEmpty()) {
                        long suffix = Long.parseLong(values[1]);
                        if (suffix <= 0) throw new IOException();
                        start = Math.max(0, size - suffix);
                    } else {
                        start = Long.parseLong(values[0]);
                        if (!values[1].isEmpty()) end = Math.min(Long.parseLong(values[1]), size - 1);
                    }
                    if (start >= size || start > end) throw new IOException();
                } catch (Exception error) {
                    stream.close();
                    headers.put("Content-Range", "bytes */" + size);
                    return new WebResourceResponse(mime, null, 416, "Range Not Satisfiable", headers, new ByteArrayInputStream(new byte[0]));
                }
                status = 206;
                headers.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
            }
            if (size >= 0) {
                long count = Math.max(0, end - start + 1);
                headers.put("Content-Length", Long.toString(count));
                try {
                    long left = start;
                    while (left > 0) { long skipped = stream.skip(left); if (skipped == 0) { if (stream.read() == -1) throw new EOFException(); skipped = 1; } left -= skipped; }
                } catch (Exception error) { stream.close(); throw error; }
                stream = new LimitedStream(stream, count);
            }
            if (request.getMethod().equals("HEAD")) { stream.close(); stream = new ByteArrayInputStream(new byte[0]); }
            return new WebResourceResponse(mime, mime.startsWith("text/") || mime.equals("application/json") ? "UTF-8" : null,
                    status, status == 206 ? "Partial Content" : "OK", headers, stream);
        } catch (Exception error) { return message(404, "Not Found", "本地文件不可用；请重新选择数据包目录"); }
    }

    static WebResourceResponse json(String content) { return response("application/json", 200, "OK", content); }
    static WebResourceResponse message(int status, String reason, String text) { return response("text/plain", status, reason, text); }
    private static WebResourceResponse response(String mime, int status, String reason, String text) {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store"); headers.put("Content-Length", Integer.toString(bytes.length));
        return new WebResourceResponse(mime, "UTF-8", status, reason, headers, new ByteArrayInputStream(bytes));
    }
    private static String mime(String path) {
        String suffix = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        switch (suffix) {
            case "html": return "text/html"; case "js": return "text/javascript"; case "css": return "text/css";
            case "json": return "application/json"; case "svg": return "image/svg+xml"; case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg"; case "webp": return "image/webp";
            case "wav": return "audio/wav"; case "ogg": return "audio/ogg"; case "mp3": return "audio/mpeg";
            case "m4a": return "audio/mp4"; default: return "application/octet-stream";
        }
    }
    private static final class LimitedStream extends FilterInputStream {
        private long left;
        LimitedStream(InputStream input, long size) { super(input); left = size; }
        @Override public int read() throws IOException { if (left <= 0) return -1; int value = super.read(); if (value >= 0) left--; return value; }
        @Override public int read(byte[] buffer, int offset, int length) throws IOException {
            if (length == 0) return 0; if (left <= 0) return -1;
            int count = in.read(buffer, offset, (int)Math.min(left, length)); if (count > 0) left -= count; return count;
        }
        @Override public long skip(long count) throws IOException { long result = in.skip(Math.min(left, count)); left -= result; return result; }
        @Override public int available() throws IOException { return (int)Math.min(left, in.available()); }
    }
}
