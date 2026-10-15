package com.cgscenestudio.player;

import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Package manifests and media stay on the device; external folders are registered in place. */
final class PackageStore {
    interface Progress { void update(String value) throws IOException; }
    static final class DirectoryAccessException extends IOException {
        DirectoryAccessException() { super("所选目录无法读取，请恢复文件访问权限或重新选择数据包目录"); }
    }
    static final String ORIGIN = "https://appassets.androidplatform.net";
    private final Context context;
    private final SharedPreferences preferences;
    private final File directory;
    private final Map<String, Map<String, Uri>> childCache = new ConcurrentHashMap<>();

    PackageStore(Context context) {
        this.context = context;
        preferences = context.getSharedPreferences("packages", Context.MODE_PRIVATE);
        directory = new File(context.getFilesDir(), "packages");
        directory.mkdirs();
    }

    private synchronized JSONArray entries() {
        try { return new JSONArray(preferences.getString("list", "[]")); }
        catch (Exception ignored) { return new JSONArray(); }
    }

    synchronized JSONArray packages() {
        JSONArray active = new JSONArray(), all = entries();
        for (int i = 0; i < all.length(); i++) {
            JSONObject row = all.optJSONObject(i);
            if (row != null && !row.optBoolean("trashed")) active.put(row);
        }
        return active;
    }

    private synchronized void register(JSONObject entry) throws Exception {
        JSONArray before = entries(), after = new JSONArray();
        for (int i = 0; i < before.length(); i++) {
            JSONObject item = before.getJSONObject(i);
            if (!item.getString("id").equals(entry.getString("id"))) after.put(item);
        }
        after.put(entry);
        if (!preferences.edit().putString("list", after.toString()).commit()) throw new IOException("无法保存数据包登记");
    }

    /** Metadata and file sizes only: no media content is opened for the manager. */
    JSONArray managementEntries() throws Exception {
        JSONArray result = entries();
        ManagedPackageFiles files = new ManagedPackageFiles(directory.toPath());
        for (int i = 0; i < result.length(); i++) {
            JSONObject row = result.getJSONObject(i);
            switch (row.getString("kind")) {
                case "local":
                    try {
                        String id = row.getString("id");
                        // Reconcile an interrupted move with the actual directory location.
                        boolean active = files.path(id, false).toFile().exists();
                        boolean trash = files.path(id, true).toFile().exists();
                        if (active != trash && row.optBoolean("trashed") != trash) {
                            row.put("trashed", trash);
                            register(row);
                            row.put("reconciled", true);
                        }
                        boolean trashed = row.optBoolean("trashed");
                        row.put("location", files.path(id, trashed).toString());
                        row.put("bytes", files.size(id, trashed));
                        row.put("missing", !(trashed ? trash : active));
                        if (row.optBoolean("purging")) row.put("warning", "上次彻底删除未完成，请继续删除；该副本已不能恢复。");
                    } catch (IOException error) {
                        row.put("location", "目录无法读取").put("bytes", -1).put("warning", error.getMessage());
                    }
                    break;
                case "file": row.put("location", row.getString("path")); break;
                case "tree": row.put("location", row.getString("uri")); break;
                default: row.put("location", "未知存储方式");
            }
        }
        return result;
    }

    private synchronized void forget(String id) throws Exception {
        JSONArray all = entries(), kept = new JSONArray();
        for (int i = 0; i < all.length(); i++) {
            JSONObject row = all.getJSONObject(i);
            if (!id.equals(row.getString("id"))) kept.put(row);
        }
        SharedPreferences.Editor edit = preferences.edit().putString("list", kept.toString());
        if ((ORIGIN + "/packages/" + id + "/package.json").equals(lastPackage())) edit.remove("last");
        if (!edit.commit()) throw new IOException("无法保存作品列表，请重试");
        childCache.clear();
    }

    private JSONObject managementEntry(String id) throws Exception {
        JSONArray all = entries();
        for (int i = 0; i < all.length(); i++) {
            JSONObject row = all.getJSONObject(i);
            if (id.equals(row.getString("id"))) return row;
        }
        throw new IOException("作品记录不存在，请刷新列表");
    }

    synchronized void removeExternal(String id) throws Exception {
        JSONObject row = managementEntry(id);
        if (!row.optString("kind").equals("file") && !row.optString("kind").equals("tree"))
            throw new IOException("导入副本请移入回收站");
        forget(id);
        if (row.optString("kind").equals("tree")) {
            try { context.getContentResolver().releasePersistableUriPermission(Uri.parse(row.getString("uri")), Intent.FLAG_GRANT_READ_URI_PERMISSION); }
            catch (SecurityException ignored) { /* The grant may already have expired. */ }
        }
    }

    synchronized void setTrashed(String id, boolean trashed) throws Exception {
        JSONObject row = managementEntry(id);
        if (!row.optString("kind").equals("local")) throw new IOException("仅管理应用内导入副本");
        if (!trashed && row.optBoolean("purging")) throw new IOException("该副本已开始彻底删除，请继续删除后重新导入");
        if (row.optBoolean("trashed") == trashed) return;
        ManagedPackageFiles files = new ManagedPackageFiles(directory.toPath());
        boolean exists = files.path(id, !trashed).toFile().exists();
        if (!exists && !trashed) throw new IOException("副本文件已不存在，无法恢复");
        if (exists) files.move(id, trashed);
        row.put("trashed", trashed);
        try { register(row); }
        catch (Exception error) {
            if (exists) files.move(id, !trashed);
            throw error;
        }
        if (trashed && (ORIGIN + "/packages/" + id + "/package.json").equals(lastPackage()))
            preferences.edit().remove("last").commit();
    }

    synchronized void deleteTrashed(String id) throws Exception {
        JSONObject row = managementEntry(id);
        if (!row.optString("kind").equals("local") || !row.optBoolean("trashed"))
            throw new IOException("只能彻底删除回收站中的导入副本");
        // Persist before removing files so interrupted deletion cannot be restored as a complete copy.
        row.put("purging", true);
        register(row);
        new ManagedPackageFiles(directory.toPath()).purge(id);
        forget(id);
    }

    String lastPackage() { return preferences.getString("last", ""); }
    void remember(String url) {
        Uri uri = Uri.parse(url);
        if (ORIGIN.equals(uri.getScheme() + "://" + uri.getHost()) &&
                (uri.getPath().startsWith("/packages/") || uri.getPath().equals("/datasets/example/package.json")))
            // The JavaScript bridge runs off the UI thread. Persist before returning so an
            // immediate process stop cannot lose the package the player just opened.
            preferences.edit().putString("last", url).commit();
    }

    JSONObject index() throws Exception {
        JSONArray list = new JSONArray();
        list.put(new JSONObject().put("id", "example").put("title", "创作者示例").put("uri", "/datasets/example/package.json"));
        JSONArray saved = packages();
        for (int i = 0; i < saved.length(); i++) {
            JSONObject row = saved.getJSONObject(i);
            list.put(new JSONObject().put("id", row.getString("id")).put("title", row.getString("title"))
                    .put("uri", "/packages/" + row.getString("id") + "/package.json"));
        }
        return new JSONObject().put("packages", list);
    }

    static String safePath(String value) throws IOException {
        if (value == null || value.isEmpty() || value.startsWith("/") || value.contains("\\") || value.contains(":"))
            throw new IOException("无效的数据包路径");
        for (String part : value.split("/", -1))
            if (part.isEmpty() || part.equals(".") || part.equals("..") || part.indexOf('\0') >= 0)
                throw new IOException("数据包路径超出目录");
        return value;
    }

    /** A decoded package-relative filename. Canonical checks also reject symlink escapes. */
    static File resolveFileWithin(File root, String relative) throws IOException {
        safePath(relative);
        File canonicalRoot = root.getCanonicalFile();
        if (!canonicalRoot.isDirectory() || !canonicalRoot.canRead()) throw new DirectoryAccessException();
        File file = new File(canonicalRoot, relative).getCanonicalFile();
        String boundary = canonicalRoot.getPath();
        if (!boundary.endsWith(File.separator)) boundary += File.separator;
        if (!file.getPath().startsWith(boundary)) throw new IOException("数据包路径超出所选目录");
        if (!file.isFile()) throw new FileNotFoundException("数据包资源文件不存在，请重新选择完整的数据包目录");
        if (!file.canRead()) throw new DirectoryAccessException();
        return file;
    }

    static JSONObject readManifest(InputStream stream) throws Exception {
            JSONObject manifest = ManifestSummary.read(stream);
            String version = manifest.getString("schemaVersion");
            if (!version.equals("1.0.0") && !version.equals("1.1.0") && !version.equals("1.2.0")) throw new IOException("仅支持 CG Scene Package 1.0 / 1.1 / 1.2");
            manifest.getJSONObject("project").getString("title");
            manifest.getJSONArray("scenes");
            JSONObject assets = manifest.getJSONObject("assets");
            for (String kind : new String[]{"visuals", "audio"}) {
                JSONArray rows = assets.getJSONArray(kind);
                for (int i = 0; i < rows.length(); i++) {
                    JSONObject row = rows.getJSONObject(i);
                    if (row.has("uri")) safePath(Uri.decode(row.getString("uri")));
                    JSONArray dependencies = row.optJSONArray("dependencies");
                    if (row.optString("kind").equals("live2d") && dependencies == null)
                        throw new IOException("Live2D 模型需要完整的 dependencies 文件列表");
                    if (dependencies != null) for (int j = 0; j < dependencies.length(); j++) safePath(Uri.decode(dependencies.getString(j)));
                }
            }
            return manifest;
    }

    /** All declared model dependencies travel with the model, even if only one motion is selected. */
    static Set<String> requiredFiles(JSONObject manifest) throws Exception {
        Set<String> result = new LinkedHashSet<>();
        JSONObject assets = manifest.getJSONObject("assets");
        for (String kind : new String[]{"visuals", "audio"}) {
            JSONArray rows = assets.getJSONArray(kind);
            for (int i = 0; i < rows.length(); i++) {
                JSONObject asset = rows.getJSONObject(i);
                if (!asset.optString("status").equals("available")) continue;
                result.add(safePath(Uri.decode(asset.getString("uri"))));
                JSONArray dependencies = asset.optJSONArray("dependencies");
                if (kind.equals("visuals") && dependencies != null)
                    for (int j = 0; j < dependencies.length(); j++) result.add(safePath(Uri.decode(dependencies.getString(j))));
            }
        }
        return result;
    }

    JSONObject addTree(Uri tree) throws Exception {
        context.getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        childCache.clear();
        Uri manifestUri = resolveTree(tree, "package.json");
        JSONObject manifest = readManifest(context.getContentResolver().openInputStream(manifestUri));
        for (String path : requiredFiles(manifest)) resolveTree(tree, path);
        String id = UUID.nameUUIDFromBytes(tree.toString().getBytes(StandardCharsets.UTF_8)).toString();
        JSONObject row = new JSONObject().put("id", id).put("kind", "tree").put("uri", tree.toString())
                .put("title", manifest.getJSONObject("project").getString("title"));
        register(row);
        return selection(row);
    }

    /** Registers a folder without copying media or scanning unrelated files. */
    JSONObject addDirectory(File root) throws Exception {
        File canonicalRoot = root.getCanonicalFile();
        File manifestFile = resolveFileWithin(canonicalRoot, "package.json");
        JSONObject manifest = readManifest(new FileInputStream(manifestFile));
        for (String path : requiredFiles(manifest)) resolveFileWithin(canonicalRoot, path);
        String id = UUID.nameUUIDFromBytes(("file:" + canonicalRoot.getPath()).getBytes(StandardCharsets.UTF_8)).toString();
        JSONObject row = new JSONObject().put("id", id).put("kind", "file").put("path", canonicalRoot.getPath())
                .put("title", manifest.getJSONObject("project").getString("title"));
        register(row);
        return selection(row);
    }

    JSONObject importZip(Uri uri, Progress progress) throws Exception {
        String id = UUID.randomUUID().toString();
        File stage = new File(directory, ".import-" + id), destination = new File(directory, id);
        if (!stage.mkdir()) throw new IOException("无法建立导入目录");
        try {
            long total = 0; int files = 0; Set<String> seen = new HashSet<>();
            try (InputStream raw = context.getContentResolver().openInputStream(uri);
                 ZipInputStream zip = new ZipInputStream(new BufferedInputStream(raw))) {
                ZipEntry entry; byte[] buffer = new byte[131072];
                while ((entry = zip.getNextEntry()) != null) {
                    String name = entry.getName();
                    if (entry.isDirectory()) { safePath(name.replaceAll("/+$", "")); continue; }
                    safePath(name);
                    if (!seen.add(name) || ++files > 100000) throw new IOException("重复条目或数据包条目过多");
                    File output = new File(stage, name);
                    if (!output.getParentFile().isDirectory() && !output.getParentFile().mkdirs()) throw new IOException("无法写入数据包目录");
                    try (OutputStream out = new BufferedOutputStream(new FileOutputStream(output))) {
                        int n; long nextUpdate = total;
                        while ((n = zip.read(buffer)) != -1) {
                            total += n;
                            if (total > 16L * 1024 * 1024 * 1024) throw new IOException("数据包解压后超过 16 GB");
                            out.write(buffer, 0, n);
                            if (total >= nextUpdate) {
                                progress.update("已导入 " + (total / 1048576) + " MB · " + files + " 个文件");
                                nextUpdate = total + 8 * 1048576;
                            }
                        }
                    }
                    zip.closeEntry();
                }
            }
            File manifestFile = new File(stage, "package.json");
            if (!manifestFile.isFile()) throw new IOException("压缩包根目录必须包含 package.json");
            JSONObject manifest = readManifest(new FileInputStream(manifestFile));
            for (String path : requiredFiles(manifest)) resolveFileWithin(stage, path);
            progress.update("正在保存数据包…");
            if (!stage.renameTo(destination)) throw new IOException("无法保存导入结果");
            JSONObject row = new JSONObject().put("id", id).put("kind", "local")
                    .put("title", manifest.getJSONObject("project").getString("title"));
            register(row);
            return selection(row);
        } catch (Exception error) {
            removeTemporary(stage);
            // A completed rename belongs only to this failed import.
            removeTemporary(destination);
            throw error;
        }
    }

    private static void removeTemporary(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) removeTemporary(child);
        file.delete();
    }

    private JSONObject selection(JSONObject row) throws Exception {
        return new JSONObject().put("title", row.getString("title"))
                .put("url", ORIGIN + "/packages/" + row.getString("id") + "/package.json");
    }

    private JSONObject find(String id) throws Exception {
        JSONArray rows = packages();
        for (int i = 0; i < rows.length(); i++) if (rows.getJSONObject(i).getString("id").equals(id)) return rows.getJSONObject(i);
        throw new FileNotFoundException("数据包不存在");
    }

    InputStream open(String id, String path) throws Exception {
        JSONObject row = find(id); safePath(path);
        if (row.getString("kind").equals("tree")) {
            InputStream stream = context.getContentResolver().openInputStream(resolveTree(Uri.parse(row.getString("uri")), path));
            if (stream == null) throw new DirectoryAccessException();
            return stream;
        }
        return new FileInputStream(resolveRegisteredFile(row, path));
    }

    long size(String id, String path) throws Exception {
        JSONObject row = find(id); safePath(path);
        if (!row.getString("kind").equals("tree")) {
            return resolveRegisteredFile(row, path).length();
        }
        Uri uri = resolveTree(Uri.parse(row.getString("uri")), path);
        try (Cursor cursor = context.getContentResolver().query(uri, new String[]{DocumentsContract.Document.COLUMN_SIZE}, null, null, null)) {
            return cursor != null && cursor.moveToFirst() && !cursor.isNull(0) ? cursor.getLong(0) : -1;
        }
    }

    private File resolveRegisteredFile(JSONObject row, String path) throws Exception {
        switch (row.getString("kind")) {
            case "file": return resolveFileWithin(new File(row.getString("path")), path);
            case "local":
                String id = safePath(row.getString("id"));
                if (id.contains("/")) throw new IOException("无效的数据包登记");
                return resolveFileWithin(new File(directory, id), path);
            default: throw new IOException("未知的数据包访问方式，请重新选择数据包");
        }
    }

    private Uri resolveTree(Uri tree, String path) throws Exception {
        safePath(path);
        Uri current = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        for (String part : path.split("/")) {
            String key = current.toString();
            Map<String, Uri> children = childCache.get(key);
            if (children == null) {
                children = new HashMap<>();
                Uri query = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getDocumentId(current));
                try (Cursor cursor = context.getContentResolver().query(query,
                        new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_DOCUMENT_ID}, null, null, null)) {
                    if (cursor == null) throw new IOException("无法读取所选目录");
                    while (cursor.moveToNext()) children.put(cursor.getString(0), DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(1)));
                }
                childCache.put(key, children);
            }
            current = children.get(part);
            if (current == null) throw new FileNotFoundException("所选目录缺少文件，请选择直接包含 package.json 的目录");
        }
        return current;
    }
}
