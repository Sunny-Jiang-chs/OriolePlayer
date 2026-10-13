package com.cgscenestudio.player;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.*;
import android.webkit.*;
import android.widget.FrameLayout;
import org.json.JSONObject;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public final class MainActivity extends Activity {
    private static final int PICK_ZIP = 41, PICK_FOLDER = 42;
    private WebView web;
    private FrameLayout container;
    private PackageStore store;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private boolean fullScreen;
    private boolean importing;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocus;

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(23, 26, 29));
        getWindow().setNavigationBarColor(Color.rgb(23, 26, 29));
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        container = new FrameLayout(this);
        container.setBackgroundColor(Color.rgb(23, 26, 29));
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(23, 26, 29));
        container.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(container);
        container.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets edges = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(edges.left, edges.top, edges.right, edges.bottom);
            } else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        container.requestApplyInsets();
        store = new PackageStore(this);
        LocalContent content = new LocalContent(this, store);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);
        settings.setTextZoom(100);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        CookieManager.getInstance().setAcceptCookie(false);
        web.addJavascriptInterface(new NativeBridge(), "CGSceneNative");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) { return content.serve(request); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !LocalContent.trusted(request.getUrl()) || !(request.getUrl().getPath().equals("/") || request.getUrl().getPath().equals("/index.html"));
            }
            @Override public void onPageFinished(WebView view, String url) { call("onForeground", ""); }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                container.removeView(web); web.destroy(); web = null;
                new AlertDialog.Builder(MainActivity.this).setTitle("播放器需要重新载入")
                        .setMessage("系统已回收网页进程。数据包已保留，重新载入即可继续。")
                        .setPositiveButton("重新载入", (dialog, which) -> recreate()).setCancelable(false).show();
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                if (BuildConfig.DEBUG && message.messageLevel() == ConsoleMessage.MessageLevel.ERROR)
                    android.util.Log.e("CGSceneWeb", message.message());
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
        });
        audioManager = (AudioManager)getSystemService(AUDIO_SERVICE);
        audioFocus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                .setOnAudioFocusChangeListener(change -> { if (change < 0) runOnUiThread(() -> call("onBackground", "")); }).build();
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        web.loadUrl(PackageStore.ORIGIN + "/index.html");
    }

    private void call(String method, String arguments) {
        if (web != null) web.evaluateJavascript("window.CGSceneAndroid?." + method + "(" + arguments + ")", null);
    }

    private void pickPackage() {
        if (importing) return;
        call("onBackground", "");
        new AlertDialog.Builder(this).setTitle("打开数据包")
                .setItems(new String[]{"导入 ZIP 数据包", "打开已解压的文件夹"}, (dialog, which) -> {
                    Intent intent = new Intent(which == 0 ? Intent.ACTION_OPEN_DOCUMENT : Intent.ACTION_OPEN_DOCUMENT_TREE);
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                    if (which == 0) { intent.setType("*/*"); intent.addCategory(Intent.CATEGORY_OPENABLE); }
                    try { startActivityForResult(intent, which == 0 ? PICK_ZIP : PICK_FOLDER); }
                    catch (Exception error) { showError("无法打开系统文件选择器"); }
                }).setNegativeButton("取消", null).show();
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if ((request != PICK_ZIP && request != PICK_FOLDER) || result != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        importing = true;
        AtomicBoolean cancelled = new AtomicBoolean();
        ProgressDialog dialog = new ProgressDialog(this);
        dialog.setTitle("黄鹂播放器");
        dialog.setMessage(request == PICK_ZIP ? "正在导入数据包…" : "正在打开文件夹…");
        dialog.setIndeterminate(true); dialog.setCancelable(false);
        if (request == PICK_ZIP) dialog.setButton(ProgressDialog.BUTTON_NEGATIVE, "取消", (d, which) -> cancelled.set(true));
        dialog.show();
        worker.execute(() -> {
            try {
                JSONObject selected = request == PICK_ZIP ? store.importZip(uri, value -> {
                    if (cancelled.get()) throw new IOException("已取消导入");
                    runOnUiThread(() -> { if (!isFinishing()) dialog.setMessage(value); });
                }) : store.addTree(uri);
                runOnUiThread(() -> { importing = false; dialog.dismiss(); call("onPackageSelected", selected.toString()); });
            } catch (Exception error) {
                runOnUiThread(() -> { importing = false; dialog.dismiss(); if (!cancelled.get()) showError(error.getMessage()); });
            }
        });
    }

    private void showError(String message) {
        if (!isFinishing()) new AlertDialog.Builder(this).setTitle("数据包未能打开")
                .setMessage(message == null ? "请检查数据包与文件访问权限。" : message).setPositiveButton("知道了", null).show();
    }

    private void setFullscreen(boolean enabled) {
        fullScreen = enabled;
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                if (enabled) controller.hide(WindowInsets.Type.systemBars()); else controller.show(WindowInsets.Type.systemBars());
            }
        } else getWindow().getDecorView().setSystemUiVisibility(enabled ?
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY : View.SYSTEM_UI_FLAG_VISIBLE);
        container.requestApplyInsets();
        call("onFullscreenChanged", Boolean.toString(enabled));
    }

    private void handleBack() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript("Boolean(window.CGSceneAndroid?.handleBack())", consumed -> {
            if (!"true".equals(consumed)) { if (fullScreen) setFullscreen(false); else finish(); }
        });
    }
    @Override public void onBackPressed() { handleBack(); }
    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        container.requestApplyInsets();
    }
    @Override protected void onPause() {
        call("onBackground", "");
        if (web != null) web.onPause();
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (audioManager != null) audioManager.abandonAudioFocusRequest(audioFocus);
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (web != null) { web.onResume(); call("onForeground", ""); }
        if (audioManager != null) audioManager.requestAudioFocus(audioFocus);
    }
    @Override protected void onDestroy() {
        worker.shutdownNow();
        if (web != null) { web.stopLoading(); web.removeJavascriptInterface("CGSceneNative"); web.destroy(); }
        super.onDestroy();
    }

    private final class NativeBridge {
        @JavascriptInterface public void pickPackage() { runOnUiThread(MainActivity.this::pickPackage); }
        @JavascriptInterface public String getInitialPackage() { return store.lastPackage(); }
        @JavascriptInterface public void rememberPackage(String url) { store.remember(url); }
        @JavascriptInterface public void setFullscreen(boolean enabled) { runOnUiThread(() -> MainActivity.this.setFullscreen(enabled)); }
        @JavascriptInterface public void setKeepScreenOn(boolean enabled) { runOnUiThread(() -> {
            if (enabled) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }); }
    }
}
