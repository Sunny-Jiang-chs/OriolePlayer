package com.cgscenestudio.player;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/** Device-only storage and HTTP checks. No image reads, rendering, or audio playback. */
public final class SmokeInstrumentation extends Instrumentation {
    private Bundle arguments;
    private int checks;
    private final List<File> temporaryFiles = new ArrayList<>();

    @Override public void onCreate(Bundle values) {
        super.onCreate(values);
        arguments = values == null ? new Bundle() : values;
        start();
    }

    @Override public void onStart() {
        super.onStart();
        Bundle result = new Bundle();
        try {
            runChecks(result);
            result.putString("result", "PASS");
            result.putInt("passed", checks);
            result.putInt("failed", 0);
            result.putString("stream", "\nPASS: " + checks + " package/storage/HTTP checks; no media playback.\n");
            finish(Activity.RESULT_OK, result);
        } catch (Throwable error) {
            result.putString("result", "FAIL");
            result.putInt("passed", checks);
            result.putInt("failed", 1);
            result.putString("error", error.getClass().getSimpleName() + ": " + error.getMessage());
            result.putString("stream", "\nFAIL after " + checks + " checks: " + error.getClass().getSimpleName()
                    + ": " + error.getMessage() + "\n");
            finish(Activity.RESULT_CANCELED, result);
        } finally {
            for (File file : temporaryFiles) if (file.exists()) file.delete();
        }
    }

    private void check(boolean condition, String message) throws IOException {
        if (!condition) throw new IOException(message);
        checks++;
    }

    private void runChecks(Bundle result) throws Exception {
        Context context = getTargetContext();
        PackageStore store = new PackageStore(context);
        String suppliedPath = arguments.getString("packageZip", "");
        File zip;
        if (suppliedPath.isEmpty()) zip = createExampleArchive(context);
        else {
            zip = new File(suppliedPath).getCanonicalFile();
            String privateRoot = context.getFilesDir().getCanonicalPath() + File.separator;
            check(zip.getPath().startsWith(privateRoot), "packageZip must be inside the target app files directory");
        }
        check(zip.isFile(), "Input archive is missing");
        JSONObject selected = store.importZip(Uri.fromFile(zip), value -> {});
        Uri packageUri = Uri.parse(selected.getString("url"));
        List<String> segments = packageUri.getPathSegments();
        check(LocalContent.trusted(packageUri) && segments.size() == 3
                && segments.get(0).equals("packages") && segments.get(2).equals("package.json"),
                "Import did not return a local package URL");
        String id = segments.get(1);
        JSONObject manifest = PackageStore.readManifest(store.open(id, "package.json"));
        check(manifest.getJSONArray("scenes").length() > 0, "Imported manifest has no scenes");

        boolean found = false;
        JSONArray catalog = store.index().getJSONArray("packages");
        for (int i = 0; i < catalog.length(); i++) if (catalog.getJSONObject(i).getString("id").equals(id)) found = true;
        check(found, "Imported package is absent from the catalog");
        store.remember(packageUri.toString());
        check(packageUri.toString().equals(new PackageStore(context).lastPackage()), "Remembered package did not persist");

        JSONArray clips = manifest.getJSONObject("assets").getJSONArray("audio");
        String audioPath = null;
        boolean ogg = false;
        for (int i = 0; i < clips.length(); i++) {
            JSONObject clip = clips.getJSONObject(i);
            if (!clip.optString("status").equals("available")) continue;
            String path = Uri.decode(clip.getString("uri"));
            if (path.toLowerCase(Locale.ROOT).endsWith(".ogg")) { audioPath = path; ogg = true; break; }
            if (audioPath == null) audioPath = path;
        }
        check(audioPath != null, "No available audio resource for range checks");
        if (!suppliedPath.isEmpty()) check(ogg, "Supplied mobile package has no OGG resource");
        long size = store.size(id, audioPath);
        check(size >= 32, "Audio resource is too short for a 32-byte range");
        byte[] expected = new byte[32];
        try (DataInputStream input = new DataInputStream(store.open(id, audioPath))) { input.readFully(expected); }

        LocalContent content = new LocalContent(context, store);
        Uri audioUri = Uri.parse(PackageStore.ORIGIN).buildUpon()
                .appendPath("packages").appendPath(id).build();
        // appendPath encodes each literal filename while preserving folder boundaries.
        Uri.Builder audioBuilder = audioUri.buildUpon();
        for (String part : audioPath.split("/")) audioBuilder.appendPath(part);
        Uri resource = audioBuilder.build();
        WebResourceResponse range = content.serve(new Request(resource, "GET", "bytes=0-31"));
        check(range.getStatusCode() == 206, "Audio range did not return 206");
        check(("bytes 0-31/" + size).equals(range.getResponseHeaders().get("Content-Range"))
                && "32".equals(range.getResponseHeaders().get("Content-Length")), "Audio range headers are incorrect");
        byte[] actual;
        try (InputStream input = range.getData()) { actual = readLimited(input, 64); }
        check(Arrays.equals(expected, actual), "Audio range bytes differ from the imported source");
        if (ogg) check("audio/ogg".equals(range.getMimeType()), "OGG MIME type is incorrect");

        WebResourceResponse invalid = content.serve(new Request(resource, "GET", "bytes=" + size + "-"));
        try (InputStream input = invalid.getData()) {
            check(invalid.getStatusCode() == 416 && ("bytes */" + size).equals(invalid.getResponseHeaders().get("Content-Range")),
                    "Out-of-bounds range was not rejected");
        }
        WebResourceResponse head = content.serve(new Request(resource, "HEAD", null));
        try (InputStream input = head.getData()) {
            check(head.getStatusCode() == 200 && Long.toString(size).equals(head.getResponseHeaders().get("Content-Length"))
                    && input.read() == -1, "Audio HEAD response is incorrect");
        }

        int countBefore = store.packages().length();
        String marker = "cgscene-traversal-" + UUID.randomUUID() + ".txt";
        File malicious = File.createTempFile("cgscene-traversal-", ".zip", context.getCacheDir());
        temporaryFiles.add(malicious);
        try (ZipOutputStream out = new ZipOutputStream(new FileOutputStream(malicious))) {
            out.putNextEntry(new ZipEntry("../" + marker));
            out.write("traversal-check".getBytes(StandardCharsets.UTF_8));
            out.closeEntry();
        }
        boolean rejected = false;
        try { store.importZip(Uri.fromFile(malicious), value -> {}); }
        catch (IOException error) { rejected = true; }
        check(rejected, "Traversal archive was accepted");
        check(!new File(context.getFilesDir(), "packages/" + marker).exists(), "Traversal archive escaped its staging directory");
        check(store.packages().length() == countBefore, "Rejected archive was registered");
        result.putString("packageUrl", packageUri.toString());
        result.putInt("scenes", manifest.getJSONArray("scenes").length());
        result.putInt("audioAssets", clips.length());
        result.putString("rangeMime", range.getMimeType());
    }

    /** The fallback keeps example text and audio, but marks images missing without opening them. */
    private File createExampleArchive(Context context) throws Exception {
        JSONObject manifest = PackageStore.readManifest(context.getAssets().open("web/datasets/example/package.json"));
        JSONArray visuals = manifest.getJSONObject("assets").getJSONArray("visuals");
        for (int i = 0; i < visuals.length(); i++) visuals.getJSONObject(i).put("status", "missing");
        File zip = File.createTempFile("cgscene-example-", ".zip", context.getCacheDir());
        temporaryFiles.add(zip);
        try (ZipOutputStream output = new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(zip)))) {
            output.putNextEntry(new ZipEntry("package.json"));
            output.write(manifest.toString().getBytes(StandardCharsets.UTF_8));
            output.closeEntry();
            JSONArray clips = manifest.getJSONObject("assets").getJSONArray("audio");
            Set<String> copied = new HashSet<>();
            byte[] buffer = new byte[65536];
            for (int i = 0; i < clips.length(); i++) {
                JSONObject clip = clips.getJSONObject(i);
                if (!clip.optString("status").equals("available")) continue;
                String path = PackageStore.safePath(Uri.decode(clip.getString("uri")));
                if (!copied.add(path)) continue;
                output.putNextEntry(new ZipEntry(path));
                try (InputStream input = context.getAssets().open("web/datasets/example/" + path)) {
                    int n; while ((n = input.read(buffer)) != -1) output.write(buffer, 0, n);
                }
                output.closeEntry();
            }
        }
        return zip;
    }

    private static byte[] readLimited(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] bytes = new byte[limit + 1];
        int n;
        while ((n = input.read(bytes)) != -1) {
            if (output.size() + n > limit) throw new IOException("Range returned more bytes than expected");
            output.write(bytes, 0, n);
        }
        return output.toByteArray();
    }

    private static final class Request implements WebResourceRequest {
        private final Uri uri;
        private final String method;
        private final Map<String, String> headers = new HashMap<>();
        Request(Uri uri, String method, String range) {
            this.uri = uri; this.method = method;
            if (range != null) headers.put("Range", range);
        }
        @Override public Uri getUrl() { return uri; }
        @Override public boolean isForMainFrame() { return false; }
        @Override public boolean isRedirect() { return false; }
        @Override public boolean hasGesture() { return false; }
        @Override public String getMethod() { return method; }
        @Override public Map<String, String> getRequestHeaders() { return headers; }
    }
}
