package com.cgscenestudio.player;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.text.format.Formatter;
import android.view.*;
import android.widget.*;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;

/** Metadata-only management for imported copies and external folder registrations. */
final class PackageManagerDialog {
    interface Listener { void onClosed(boolean changed); }
    private interface Operation { void run() throws Exception; }
    private final Activity activity;
    private final PackageStore store;
    private final ExecutorService worker;
    private final Listener listener;
    private Dialog dialog;
    private AlertDialog details;
    private TextView summary;
    private Button library, trash, empty, done;
    private ListView list;
    private List<JSONObject> visible = new ArrayList<>();
    private boolean showTrash, busy, mutating, closed, changed;
    private int generation;

    PackageManagerDialog(Activity activity, PackageStore store, ExecutorService worker, Listener listener) {
        this.activity = activity; this.store = store; this.worker = worker; this.listener = listener;
    }

    private int dp(int value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }
    private TextView text(String value, int size) {
        TextView view = new TextView(activity); view.setText(value); view.setTextSize(size);
        view.setTextColor(Color.rgb(238, 238, 240)); return view;
    }
    private Button button(String label) {
        Button view = new Button(activity); view.setText(label); view.setAllCaps(false);
        view.setTextColor(Color.rgb(233, 189, 84)); return view;
    }

    void show() {
        dialog = new Dialog(activity);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout panel = new LinearLayout(activity);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(16), dp(12), dp(16), dp(12));
        panel.setBackgroundColor(Color.rgb(32, 33, 37));
        TextView title = text("作品管理", 20); title.setTypeface(null, Typeface.BOLD); panel.addView(title);
        LinearLayout tabs = new LinearLayout(activity);
        library = button("已配置作品"); trash = button("回收站");
        tabs.addView(library, new LinearLayout.LayoutParams(0, dp(48), 1));
        tabs.addView(trash, new LinearLayout.LayoutParams(0, dp(48), 1));
        library.setOnClickListener(v -> { showTrash = false; reload(); });
        trash.setOnClickListener(v -> { showTrash = true; reload(); });
        panel.addView(tabs);
        summary = text("正在统计导入副本…", 12);
        summary.setPadding(0, dp(8), 0, dp(8)); panel.addView(summary);
        list = new ListView(activity);
        list.setDividerHeight(dp(1));
        list.setOnItemClickListener((parent, view, position, id) -> { if (!busy) showDetails(visible.get(position)); });
        TextView none = text("这里还没有作品", 14);
        none.setGravity(Gravity.CENTER);
        FrameLayout contents = new FrameLayout(activity);
        contents.addView(list, new FrameLayout.LayoutParams(-1, -1));
        contents.addView(none, new FrameLayout.LayoutParams(-1, -1)); list.setEmptyView(none);
        panel.addView(contents, new LinearLayout.LayoutParams(-1, 0, 1));
        LinearLayout actions = new LinearLayout(activity);
        empty = button("清空回收站"); done = button("完成");
        empty.setOnClickListener(v -> confirmEmpty()); done.setOnClickListener(v -> close());
        actions.addView(empty, new LinearLayout.LayoutParams(0, dp(48), 1));
        actions.addView(done, new LinearLayout.LayoutParams(0, dp(48), 1)); panel.addView(actions);
        dialog.setContentView(panel);
        dialog.setCanceledOnTouchOutside(false);
        dialog.setOnCancelListener(d -> close());
        dialog.setOnKeyListener((d, key, event) -> {
            if (key != KeyEvent.KEYCODE_BACK) return false;
            if (event.getAction() == KeyEvent.ACTION_UP) close(); return true;
        });
        dialog.show();
        if (Build.VERSION.SDK_INT >= 33) dialog.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::close);
        onConfigurationChanged();
        reload();
    }

    void onConfigurationChanged() {
        if (closed || dialog == null) return;
        android.util.DisplayMetrics metrics = activity.getResources().getDisplayMetrics();
        dialog.getWindow().setLayout(Math.min(metrics.widthPixels - dp(24), dp(680)), metrics.heightPixels - dp(64));
    }

    private void setBusy(boolean value) {
        busy = value; list.setEnabled(!value); library.setEnabled(!value); trash.setEnabled(!value);
        empty.setEnabled(!value && showTrash && !visible.isEmpty()); done.setEnabled(!mutating);
        dialog.setCancelable(!mutating);
    }

    private void reload() {
        final int ticket = ++generation;
        setBusy(true); summary.setText("正在统计文件占用…");
        worker.execute(() -> {
            try {
                JSONArray entries = store.managementEntries();
                activity.runOnUiThread(() -> {
                    if (closed || ticket != generation) return;
                    visible = new ArrayList<>();
                    long activeBytes = 0, trashBytes = 0; int activeCount = 0, trashCount = 0;
                    boolean incomplete = false;
                    for (int i = 0; i < entries.length(); i++) {
                        JSONObject row = entries.optJSONObject(i);
                        if (row == null) continue;
                        if (row.optBoolean("reconciled")) changed = true;
                        boolean trashed = row.optBoolean("trashed");
                        if (trashed) { trashCount++; trashBytes += Math.max(0, row.optLong("bytes")); }
                        else { activeCount++; activeBytes += Math.max(0, row.optLong("bytes")); }
                        if (row.optLong("bytes") < 0) incomplete = true;
                        if (trashed == showTrash) visible.add(row);
                    }
                    library.setText("已配置作品（" + activeCount + "）"); trash.setText("回收站（" + trashCount + "）");
                    summary.setText(showTrash ? "回收站占用 " + size(trashBytes) + "。清空后才释放空间。"
                            : "导入副本 " + size(activeBytes) + " · 回收站 " + size(trashBytes)
                            + "\n点作品可查看位置。外部目录只移除记录，文件由你管理。"
                            + (incomplete ? "\n部分目录无法统计。" : ""));
                    list.setAdapter(new Rows()); setBusy(false);
                });
            } catch (Exception error) { activity.runOnUiThread(() -> {
                if (closed || ticket != generation) return;
                summary.setText("无法读取作品列表：" + error.getMessage()); setBusy(false);
            }); }
        });
    }

    private String size(long bytes) { return Formatter.formatFileSize(activity, bytes); }
    private String type(JSONObject row) {
        switch (row.optString("kind")) {
            case "local": return "ZIP 导入副本 · " + (row.optLong("bytes") < 0 ? "占用未知" : size(row.optLong("bytes")));
            case "file": return "外部文件夹 · 未复制文件";
            case "tree": return "系统授权目录 · 未复制文件";
            default: return "未知来源";
        }
    }

    private final class Rows extends BaseAdapter {
        public int getCount() { return visible.size(); }
        public JSONObject getItem(int position) { return visible.get(position); }
        public long getItemId(int position) { return position; }
        public View getView(int position, View reuse, ViewGroup parent) {
            JSONObject row = getItem(position);
            TextView view = text(row.optString("title", "未命名作品") + "\n" + type(row)
                    + "\n" + row.optString("location") + (row.optBoolean("missing") ? "\n副本文件已不存在" : ""), 14);
            view.setPadding(dp(8), dp(12), dp(8), dp(12));
            return view;
        }
    }

    private void showDetails(JSONObject row) {
        boolean local = row.optString("kind").equals("local"), trashed = row.optBoolean("trashed");
        String location = row.optString("location");
        TextView body = text(type(row) + "\n\n位置：\n" + location + "\n\n"
                + (local ? "这是应用私有目录，普通文件管理器无法进入。删除整个导入副本请使用下面的操作。"
                         : "移除记录不会删除原目录或其中的 package.json、图片、音频。可复制位置后自行管理。")
                + (row.has("warning") ? "\n\n" + row.optString("warning") : ""), 14);
        body.setTextIsSelectable(true); body.setPadding(dp(20), dp(12), dp(20), dp(12));
        ScrollView scroll = new ScrollView(activity); scroll.addView(body);
        AlertDialog.Builder builder = new AlertDialog.Builder(activity).setTitle(row.optString("title", "作品"))
                .setView(scroll).setNegativeButton("关闭", null);
        if (trashed) {
            if (!row.optBoolean("purging")) builder.setNeutralButton("恢复", (d, w) -> run("正在恢复…", () -> store.setTrashed(row.getString("id"), false)));
            builder.setPositiveButton("彻底删除", (d, w) -> confirmDelete(row));
        } else {
            builder.setNeutralButton("复制位置", (d, w) -> {
                ((ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("作品位置", location));
                Toast.makeText(activity, "位置已复制", Toast.LENGTH_SHORT).show();
            });
            builder.setPositiveButton(local ? "移入回收站" : "移除记录", (d, w) -> run(local ? "正在移入回收站…" : "正在移除记录…", () -> {
                if (local) store.setTrashed(row.getString("id"), true); else store.removeExternal(row.getString("id"));
            }));
        }
        details = builder.show();
    }

    private void confirmDelete(JSONObject row) {
        details = new AlertDialog.Builder(activity).setTitle("彻底删除导入副本？")
                .setMessage(row.optString("title") + "\n将删除这个副本的清单和全部资源，释放 " + size(Math.max(0, row.optLong("bytes")))
                        + "。此操作无法恢复；以后需要重新导入原 ZIP。")
                .setNegativeButton("取消", null)
                .setPositiveButton("彻底删除", (d, w) -> run("正在释放空间…", () -> store.deleteTrashed(row.getString("id")))).show();
    }

    private void confirmEmpty() {
        if (!showTrash || busy || visible.isEmpty()) return;
        List<JSONObject> selected = new ArrayList<>(visible);
        details = new AlertDialog.Builder(activity).setTitle("清空回收站？")
                .setMessage("彻底删除回收站中的 " + selected.size() + " 个导入副本及其全部资源。此操作无法恢复。外部文件夹不受影响。")
                .setNegativeButton("取消", null)
                .setPositiveButton("清空并释放空间", (d, w) -> run("正在清空回收站…", () -> {
                    for (JSONObject row : selected) store.deleteTrashed(row.getString("id"));
                })).show();
    }

    private void run(String message, Operation operation) {
        if (closed || busy) return;
        mutating = true; changed = true; setBusy(true); summary.setText(message);
        worker.execute(() -> {
            String failure = null;
            try { operation.run(); } catch (Exception error) { failure = error.getMessage(); }
            final String problem = failure;
            activity.runOnUiThread(() -> {
                if (closed) return;
                mutating = false;
                if (problem != null) Toast.makeText(activity, "操作未完成：" + problem, Toast.LENGTH_LONG).show();
                reload();
            });
        });
    }

    void close() {
        if (closed || mutating) return;
        dismiss(); listener.onClosed(changed);
    }

    void dismiss() {
        closed = true; generation++;
        if (details != null) details.dismiss();
        if (dialog != null) dialog.dismiss();
    }
}
