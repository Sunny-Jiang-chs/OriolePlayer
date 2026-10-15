package com.cgscenestudio.player;

import android.util.JsonReader;
import android.util.JsonToken;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** Native import needs counts and file references, not a second copy of every dialogue page. */
final class ManifestSummary {
    static JSONObject read(InputStream source) throws Exception {
        if (source == null) throw new IOException("无法读取数据包清单");
        try (JsonReader reader = new JsonReader(new InputStreamReader(new FilterInputStream(source) {
            private long bytes;
            private void count(int size) throws IOException {
                if (size > 0 && (bytes += size) > 96L * 1024 * 1024) throw new IOException("数据包清单超过 96 MB");
            }
            @Override public int read() throws IOException { int value = in.read(); count(value < 0 ? 0 : 1); return value; }
            @Override public int read(byte[] buffer, int offset, int length) throws IOException {
                int size = in.read(buffer, offset, length); count(size); return size;
            }
        }, StandardCharsets.UTF_8))) {
            JSONObject result = new JSONObject();
            reader.beginObject();
            while (reader.hasNext()) {
                String name = reader.nextName();
                switch (name) {
                    case "schemaVersion": result.put(name, reader.nextString()); break;
                    case "project": result.put(name, strings(reader, "id", "title")); break;
                    case "assets": result.put(name, assets(reader)); break;
                    case "scenes": result.put(name, scenes(reader)); break;
                    default: reader.skipValue();
                }
            }
            reader.endObject();
            if (reader.peek() != JsonToken.END_DOCUMENT) throw new IOException("数据包清单末尾有多余内容");
            result.getJSONObject("project").getString("title");
            result.getJSONArray("scenes");
            result.getJSONObject("assets").getJSONArray("visuals");
            result.getJSONObject("assets").getJSONArray("audio");
            return result;
        }
    }

    private static JSONObject strings(JsonReader reader, String... fields) throws Exception {
        JSONObject result = new JSONObject();
        reader.beginObject();
        while (reader.hasNext()) {
            String name = reader.nextName(); boolean keep = false;
            for (String field : fields) if (field.equals(name)) keep = true;
            if (keep) result.put(name, reader.nextString()); else reader.skipValue();
        }
        reader.endObject();
        return result;
    }

    private static JSONObject assets(JsonReader reader) throws Exception {
        JSONObject result = new JSONObject();
        reader.beginObject();
        while (reader.hasNext()) {
            String name = reader.nextName();
            if (!name.equals("visuals") && !name.equals("audio")) { reader.skipValue(); continue; }
            JSONArray rows = new JSONArray();
            reader.beginArray();
            while (reader.hasNext()) {
                JSONObject asset = new JSONObject();
                reader.beginObject();
                while (reader.hasNext()) {
                    String field = reader.nextName();
                    switch (field) {
                        case "id": case "uri": case "status": case "kind":
                            asset.put(field, reader.nextString()); break;
                        case "dependencies":
                            JSONArray dependencies = new JSONArray();
                            reader.beginArray();
                            while (reader.hasNext()) dependencies.put(reader.nextString());
                            reader.endArray(); asset.put(field, dependencies); break;
                        default: reader.skipValue();
                    }
                }
                reader.endObject(); rows.put(asset);
            }
            reader.endArray(); result.put(name, rows);
        }
        reader.endObject();
        return result;
    }

    private static JSONArray scenes(JsonReader reader) throws Exception {
        JSONArray result = new JSONArray();
        reader.beginArray();
        while (reader.hasNext()) {
            long pages = 0;
            reader.beginObject();
            while (reader.hasNext()) {
                if (!reader.nextName().equals("pages")) { reader.skipValue(); continue; }
                reader.beginArray();
                while (reader.hasNext()) { reader.skipValue(); pages++; }
                reader.endArray();
            }
            reader.endObject(); result.put(new JSONObject().put("pageCount", pages));
        }
        reader.endArray();
        return result;
    }
}
