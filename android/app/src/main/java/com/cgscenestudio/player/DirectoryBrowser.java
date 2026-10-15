package com.cgscenestudio.player;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Environment;
import android.os.Build;
import android.text.TextUtils;
import android.view.*;
import android.widget.*;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Local, read-only primary-storage browser. It never previews media. */
final class DirectoryBrowser {
    interface Listener {
        void onSelected(File directory);
        void onCancelled();
        void onSystemPicker();
    }
    private static final int BACKGROUND = Color.rgb(17, 18, 20);
    private static final int SURFACE = Color.rgb(32, 33, 37);
    private static final int TEXT = Color.rgb(232, 237, 243);
    private static final int MUTED = Color.rgb(174, 181, 192);
    private static final int ACCENT = Color.rgb(233, 189, 84);
    private final Activity activity;
    private final Listener listener;
    private final ExecutorService reader = Executors.newSingleThreadExecutor();
    private final AtomicInteger generation = new AtomicInteger();
    private Future<?> pending;
    private Dialog dialog;
    private File root, current;
    private LinearLayout panel;
    private TextView title, hint, pathView, statusView, countView;
    private Button upButton, openButton;
    private ListView list;
    private boolean closed, valid;

    DirectoryBrowser(Activity activity, Listener listener) {
        this.activity = activity;
        this.listener = listener;
    }

    void show() throws IOException {
        root = Environment.getExternalStorageDirectory().getCanonicalFile();
        String saved = activity.getSharedPreferences("directory-browser", Activity.MODE_PRIVATE).getString("last", root.getPath());
        File initial;
        try {
            initial = new File(saved).getCanonicalFile();
            if (!withinRoot(initial) || !initial.isDirectory() || !initial.canRead()) initial = root;
        } catch (IOException | SecurityException ignored) { initial = root; }
        dialog = new Dialog(activity);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        panel = new LinearLayout(activity);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(16), dp(18), dp(16), dp(12));
        panel.setBackground(rounded(BACKGROUND, 18));
        title = text("浏览目录", 20, TEXT);
        title.setTypeface(null, Typeface.BOLD);
        panel.addView(title);
        hint = text("手机共享存储 · 已显示隐藏目录", 12, MUTED);
        hint.setPadding(0, dp(4), 0, dp(12));
        panel.addView(hint);
        pathView = text("", 12, MUTED);
        pathView.setMaxLines(2);
        pathView.setEllipsize(TextUtils.TruncateAt.MIDDLE);
        pathView.setTextIsSelectable(true);
        panel.addView(pathView, new LinearLayout.LayoutParams(-1, dp(40)));
        upButton = button("↑ 上一级", ACCENT);
        upButton.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        upButton.setOnClickListener(view -> { if (current != null && !current.equals(root)) navigate(current.getParentFile()); });
        panel.addView(upButton, new LinearLayout.LayoutParams(-1, dp(46)));
        statusView = text("", 13, MUTED);
        statusView.setMaxLines(4);
        statusView.setEllipsize(TextUtils.TruncateAt.END);
        statusView.setPadding(dp(12), dp(10), dp(12), dp(10));
        statusView.setBackground(rounded(SURFACE, 10));
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(-1, -2);
        statusParams.setMargins(0, dp(8), 0, dp(8));
        panel.addView(statusView, statusParams);
        countView = text("", 12, MUTED);
        countView.setPadding(0, 0, 0, dp(6));
        panel.addView(countView);
        list = new ListView(activity);
        list.setDividerHeight(dp(6));
        list.setDivider(new android.graphics.drawable.ColorDrawable(BACKGROUND));
        list.setClipToPadding(false);
        list.setOnItemClickListener((parent, view, position, id) -> {
            Entry entry = (Entry) parent.getItemAtPosition(position);
            if (entry.directory) navigate(entry.file);
        });
        panel.addView(list, new LinearLayout.LayoutParams(-1, 0, 1));
        LinearLayout buttons = new LinearLayout(activity);
        buttons.setPadding(0, dp(8), 0, 0);
        Button system = button("系统选择", ACCENT);
        system.setContentDescription("使用系统目录选择器");
        system.setOnClickListener(view -> { close(); listener.onSystemPicker(); });
        buttons.addView(system, new LinearLayout.LayoutParams(0, dp(48), 1));
        Button cancel = button("取消", MUTED);
        cancel.setOnClickListener(view -> cancel());
        buttons.addView(cancel, new LinearLayout.LayoutParams(0, dp(48), 1));
        openButton = button("打开作品", ACCENT);
        openButton.setEnabled(false);
        openButton.setOnClickListener(view -> {
            if (valid && current != null) { File selected = current; close(); listener.onSelected(selected); }
        });
        buttons.addView(openButton, new LinearLayout.LayoutParams(0, dp(48), 1));
        panel.addView(buttons);
        dialog.setContentView(panel);
        dialog.setOnCancelListener(value -> cancel());
        dialog.setOnKeyListener((value, key, event) -> {
            if (key != android.view.KeyEvent.KEYCODE_BACK) return false;
            if (event.getAction() == android.view.KeyEvent.ACTION_UP) handleBack();
            return true;
        });
        dialog.setCanceledOnTouchOutside(false);
        dialog.show();
        if (Build.VERSION.SDK_INT >= 33) dialog.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        resize();
        navigate(initial);
    }

    void onConfigurationChanged() { if (!closed) resize(); }
    void dismiss() { close(); }
    void handleBack() {
        if (closed) return;
        if (current != null && !current.equals(root)) navigate(current.getParentFile());
        else cancel();
    }

    private void resize() {
        Window window = dialog == null ? null : dialog.getWindow();
        if (window == null) return;
        android.util.DisplayMetrics metrics = activity.getResources().getDisplayMetrics();
        boolean compact = metrics.widthPixels > metrics.heightPixels;
        title.setVisibility(compact ? View.GONE : View.VISIBLE);
        hint.setVisibility(compact ? View.GONE : View.VISIBLE);
        panel.setPadding(dp(16), dp(compact ? 8 : 18), dp(16), dp(compact ? 8 : 12));
        pathView.setMaxLines(compact ? 1 : 2);
        pathView.setLayoutParams(new LinearLayout.LayoutParams(-1, dp(compact ? 22 : 40)));
        upButton.setLayoutParams(new LinearLayout.LayoutParams(-1, dp(compact ? 40 : 46)));
        statusView.setMaxLines(compact ? 2 : 4);
        statusView.setPadding(dp(12), dp(compact ? 6 : 10), dp(12), dp(compact ? 6 : 10));
        window.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
        window.setDimAmount(.65f);
        window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        window.setLayout(Math.min(metrics.widthPixels - dp(24), dp(680)), metrics.heightPixels - dp(compact ? 48 : 72));
    }

    private boolean withinRoot(File file) {
        return file.equals(root) || file.getPath().startsWith(root.getPath() + File.separator);
    }

    private void navigate(File requested) {
        if (closed || requested == null) return;
        int ticket = generation.incrementAndGet();
        if (pending != null) pending.cancel(true);
        valid = false;
        openButton.setEnabled(false);
        statusView.setTextColor(MUTED);
        statusView.setText("正在检查目录…");
        countView.setText("正在载入…");
        list.setAdapter(new Entries(Collections.emptyList()));
        pending = reader.submit(() -> {
            try {
                File folder = requested.getCanonicalFile();
                if (!withinRoot(folder)) throw new IOException("请选择手机共享存储中的目录。");
                post(ticket, () -> {
                    current = folder;
                    pathView.setText(folder.getPath());
                    upButton.setEnabled(!folder.equals(root));
                });
                File[] children = folder.listFiles();
                if (children == null) throw new IOException("无法读取此目录；可返回上一级，或使用系统目录选择器。");
                ArrayList<Entry> entries = new ArrayList<>();
                int folders = 0, files = 0;
                for (File child : children) {
                    if (generation.get() != ticket || Thread.currentThread().isInterrupted()) return;
                    try {
                        File canonical = child.getCanonicalFile();
                        if (!withinRoot(canonical)) continue;
                        boolean directory = canonical.isDirectory();
                        if (directory) folders++; else files++;
                        entries.add(new Entry(canonical, child.getName(), directory));
                    } catch (IOException | SecurityException ignored) { /* Unreadable entry, keep browsing. */ }
                }
                entries.sort(Comparator.comparing((Entry entry) -> !entry.directory)
                        .thenComparing(entry -> entry.name.toLowerCase(Locale.ROOT)));
                String counts = folders + " 个子目录 · " + files + " 个文件";
                post(ticket, () -> {
                    countView.setText(counts);
                    list.setAdapter(new Entries(entries));
                    activity.getSharedPreferences("directory-browser", Activity.MODE_PRIVATE)
                            .edit().putString("last", folder.getPath()).apply();
                });
                if (!new File(folder, "package.json").exists()) {
                    post(ticket, () -> statusView.setText("此目录没有 package.json。进入作品文件夹后即可打开。"));
                    return;
                }
                File manifestFile = PackageStore.resolveFileWithin(folder, "package.json");
                post(ticket, () -> statusView.setText("发现 package.json，正在读取作品信息…"));
                JSONObject manifest;
                try (InputStream stream = new FilterInputStream(new FileInputStream(manifestFile)) {
                    private void check() throws InterruptedIOException {
                        if (Thread.currentThread().isInterrupted() || generation.get() != ticket) throw new InterruptedIOException();
                    }
                    @Override public int read() throws IOException { check(); return super.read(); }
                    @Override public int read(byte[] bytes, int offset, int length) throws IOException {
                        check(); return super.read(bytes, offset, length);
                    }
                }) { manifest = PackageStore.readManifest(stream); }
                JSONArray scenes = manifest.getJSONArray("scenes");
                long pages = 0;
                for (int i = 0; i < scenes.length(); i++) {
                    JSONObject scene = scenes.optJSONObject(i);
                    if (scene != null) pages += scene.optLong("pageCount");
                }
                String description = manifest.getJSONObject("project").getString("title")
                        + "\n" + scenes.length() + " 个场景 · " + pages + " 页 · 直接读取，无需复制";
                post(ticket, () -> {
                    valid = true;
                    statusView.setTextColor(ACCENT);
                    statusView.setText(description);
                    openButton.setEnabled(true);
                });
            } catch (Exception error) {
                post(ticket, () -> {
                    statusView.setText("无法打开此目录或作品：" + (error.getMessage() == null ? "请检查访问权限与 package.json。" : error.getMessage()));
                    countView.setText("");
                });
            }
        });
    }

    private void post(int ticket, Runnable action) {
        activity.runOnUiThread(() -> {
            if (!closed && !activity.isFinishing() && !activity.isDestroyed() && generation.get() == ticket) action.run();
        });
    }
    private void cancel() { if (!closed) { close(); listener.onCancelled(); } }
    private void close() {
        if (closed) return;
        closed = true;
        generation.incrementAndGet();
        if (pending != null) pending.cancel(true);
        reader.shutdownNow();
        if (dialog != null) dialog.dismiss();
    }
    private int dp(float value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }
    private GradientDrawable rounded(int color, int radius) {
        GradientDrawable background = new GradientDrawable();
        background.setColor(color); background.setCornerRadius(dp(radius));
        return background;
    }
    private TextView text(String value, float size, int color) {
        TextView text = new TextView(activity);
        text.setText(value); text.setTextSize(size); text.setTextColor(color);
        return text;
    }
    private Button button(String value, int color) {
        Button button = new Button(activity);
        button.setText(value); button.setTextColor(color); button.setTextSize(13);
        button.setAllCaps(false); button.setMinWidth(0); button.setMinimumWidth(0);
        button.setPadding(dp(8), 0, dp(8), 0);
        return button;
    }
    private static final class Entry {
        final File file;
        final String name;
        final boolean directory;
        Entry(File file, String name, boolean directory) { this.file = file; this.name = name; this.directory = directory; }
    }
    private final class Entries extends BaseAdapter {
        private final List<Entry> entries;
        Entries(List<Entry> entries) { this.entries = entries; }
        @Override public int getCount() { return entries.size(); }
        @Override public Entry getItem(int position) { return entries.get(position); }
        @Override public long getItemId(int position) { return position; }
        @Override public boolean areAllItemsEnabled() { return false; }
        @Override public boolean isEnabled(int position) { return getItem(position).directory; }
        @Override public View getView(int position, View recycled, ViewGroup parent) {
            TextView row = recycled instanceof TextView ? (TextView) recycled : text("", 14, TEXT);
            Entry entry = getItem(position);
            row.setText((entry.directory ? "▸ " : "  ") + entry.name + (entry.name.startsWith(".") ? "  · 隐藏" : ""));
            row.setTextColor(entry.directory ? TEXT : MUTED);
            row.setTypeface(null, entry.name.equals("package.json") ? Typeface.BOLD : Typeface.NORMAL);
            row.setPadding(dp(12), dp(12), dp(12), dp(12));
            row.setMinHeight(dp(48));
            row.setMaxLines(2);
            row.setEllipsize(TextUtils.TruncateAt.MIDDLE);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setBackground(rounded(SURFACE, 10));
            return row;
        }
    }
}
