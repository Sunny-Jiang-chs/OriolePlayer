package com.cgscenestudio.player;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.view.*;
import android.webkit.*;
import android.widget.FrameLayout;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public final class MainActivity extends Activity {
    private static final int PICK_ZIP = 41, PICK_FOLDER = 42, ALL_FILES_ACCESS = 43, READ_STORAGE = 44;
    private WebView web;
    private FrameLayout container;
    private PackageStore store;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private boolean fullScreen;
    private boolean fullscreenOrientationSaved;
    private int orientationBeforeFullscreen = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private boolean importing;
    private boolean picking;
    private boolean resumed;
    private boolean waitingForAllFiles;
    private boolean destroyed;
    private DirectoryBrowser directoryBrowser;
    private PackageManagerDialog packageManager;
    private android.app.Dialog pickerDialog;
    private ProgressDialog progressDialog;

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(17, 18, 20));
        getWindow().setNavigationBarColor(Color.rgb(17, 18, 20));
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        container = new FrameLayout(this);
        container.setBackgroundColor(Color.rgb(17, 18, 20));
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(17, 18, 20));
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
        waitingForAllFiles = state != null && state.getBoolean("waitingForAllFiles", false);
        picking = waitingForAllFiles;
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
            @Override public void onPageFinished(WebView view, String url) { notifyForeground(); }
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
        // WebView owns media audio focus. A second native focus request would
        // compete with WebView and suspend it when its own playback starts.
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        web.loadUrl(PackageStore.ORIGIN + "/index.html");
    }

    private void call(String method, String arguments) {
        if (web != null) web.evaluateJavascript("window.CGSceneAndroid?." + method + "(" + arguments + ")", null);
    }

    private void notifyForeground() {
        call(resumed && !picking && !importing ? "onForeground" : "onBackground", "");
    }

    private void finishPicking() {
        picking = false;
        waitingForAllFiles = false;
        notifyForeground();
    }

    private void pickPackage() {
        if (importing || picking) return;
        picking = true;
        call("onBackground", "");
        pickerDialog = new AlertDialog.Builder(this).setTitle("打开作品")
                .setItems(new String[]{"浏览目录（含隐藏）", "系统目录选择器", "导入 ZIP 数据包", "作品管理（位置与空间）"}, (dialog, which) -> {
                    if (which == 0) openDirectoryBrowser();
                    else if (which == 3) showPackageManager();
                    else openSystemPicker(which == 2);
                }).setNegativeButton("取消", (dialog, which) -> finishPicking())
                .setOnCancelListener(dialog -> finishPicking()).show();
    }

    private void showPackageManager() {
        if (destroyed || isFinishing()) { finishPicking(); return; }
        packageManager = new PackageManagerDialog(this, store, worker, changed -> {
            packageManager = null;
            if (!changed || web == null) { finishPicking(); return; }
            // Keep media suspended until removed current packages have been unloaded.
            web.evaluateJavascript("Promise.resolve().then(() => window.CGSceneAndroid?.onPackagesChanged())"
                    + ".finally(() => window.CGSceneNative.packageManagementFinished())", null);
        });
        packageManager.show();
    }

    private void openSystemPicker(boolean zip) {
        Intent intent = new Intent(zip ? Intent.ACTION_OPEN_DOCUMENT : Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        if (zip) { intent.setType("*/*"); intent.addCategory(Intent.CATEGORY_OPENABLE); }
        else intent.addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        try { startActivityForResult(intent, zip ? PICK_ZIP : PICK_FOLDER); }
        catch (Exception error) { finishPicking(); showError("无法打开系统文件选择器"); }
    }

    private void openDirectoryBrowser() {
        if (Build.VERSION.SDK_INT >= 30 && !Environment.isExternalStorageManager()) {
            waitingForAllFiles = true;
            try {
                startActivityForResult(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                        Uri.parse("package:" + getPackageName())), ALL_FILES_ACCESS);
            } catch (Exception specificUnavailable) {
                try { startActivityForResult(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION), ALL_FILES_ACCESS); }
                catch (Exception unavailable) { waitingForAllFiles = false; permissionNotGranted(); }
            }
            return;
        }
        if (Build.VERSION.SDK_INT < 30 && checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE}, READ_STORAGE);
            return;
        }
        showDirectoryBrowser();
    }

    private void showDirectoryBrowser() {
        if (destroyed || isFinishing()) return;
        directoryBrowser = new DirectoryBrowser(this, new DirectoryBrowser.Listener() {
            @Override public void onSelected(File directory) {
                directoryBrowser = null;
                beginOpen("正在打开作品目录…", false, cancelled -> store.addDirectory(directory));
            }
            @Override public void onCancelled() { directoryBrowser = null; finishPicking(); }
            @Override public void onSystemPicker() { directoryBrowser = null; openSystemPicker(false); }
        });
        try { directoryBrowser.show(); }
        catch (Exception error) {
            directoryBrowser.dismiss(); directoryBrowser = null;
            finishPicking(); showError("无法浏览手机存储，请使用系统目录选择器。");
        }
    }

    private void permissionNotGranted() {
        if (destroyed || isFinishing()) { finishPicking(); return; }
        pickerDialog = new AlertDialog.Builder(this).setTitle("目录访问未开启")
                .setMessage("浏览隐藏目录需要文件访问权限。也可以用系统目录选择器授权单个作品文件夹。")
                .setPositiveButton("系统目录选择器", (dialog, which) -> openSystemPicker(false))
                .setNegativeButton("取消", (dialog, which) -> finishPicking())
                .setOnCancelListener(dialog -> finishPicking()).show();
    }

    private void completeAllFilesRequest() {
        if (!waitingForAllFiles) return;
        waitingForAllFiles = false;
        if (Build.VERSION.SDK_INT >= 30 && Environment.isExternalStorageManager()) showDirectoryBrowser();
        else permissionNotGranted();
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request != READ_STORAGE) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) showDirectoryBrowser();
        else permissionNotGranted();
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == ALL_FILES_ACCESS) { completeAllFilesRequest(); return; }
        if (request != PICK_ZIP && request != PICK_FOLDER) return;
        if (result != RESULT_OK || data == null || data.getData() == null) { finishPicking(); return; }
        Uri uri = data.getData();
        beginOpen(request == PICK_ZIP ? "正在导入数据包…" : "正在打开文件夹…", request == PICK_ZIP, cancelled ->
                request == PICK_ZIP ? store.importZip(uri, value -> {
                    if (cancelled.get() || Thread.currentThread().isInterrupted()) throw new IOException("已取消导入");
                    runOnUiThread(() -> { if (!destroyed && !isFinishing() && progressDialog != null) progressDialog.setMessage(value); });
                }) : store.addTree(uri));
    }

    private interface PackageOperation { JSONObject open(AtomicBoolean cancelled) throws Exception; }

    private void beginOpen(String message, boolean cancellable, PackageOperation operation) {
        picking = false;
        importing = true;
        call("onBackground", "");
        AtomicBoolean cancelled = new AtomicBoolean();
        ProgressDialog dialog = new ProgressDialog(this);
        progressDialog = dialog;
        dialog.setTitle("黄鹂播放器");
        dialog.setMessage(message);
        dialog.setIndeterminate(true); dialog.setCancelable(false);
        if (cancellable) dialog.setButton(ProgressDialog.BUTTON_NEGATIVE, "取消", (d, which) -> cancelled.set(true));
        dialog.show();
        worker.execute(() -> {
            try {
                JSONObject selected = operation.open(cancelled);
                runOnUiThread(() -> {
                    if (!destroyed) dialog.dismiss();
                    progressDialog = null;
                    if (destroyed || web == null || isFinishing()) { importing = false; return; }
                    // Keep playback suspended until the asynchronous manifest load finishes.
                    web.evaluateJavascript("Promise.resolve().then(() => window.CGSceneAndroid?.onPackageSelected("
                            + selected.toString() + ")).finally(() => window.CGSceneNative.packageSelectionFinished())", null);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    importing = false;
                    if (!destroyed) dialog.dismiss();
                    progressDialog = null;
                    if (destroyed || isFinishing()) return;
                    notifyForeground();
                    if (!cancelled.get()) showError(error.getMessage());
                });
            }
        });
    }

    private void showError(String message) {
        if (!destroyed && !isFinishing()) new AlertDialog.Builder(this).setTitle("数据包未能打开")
                .setMessage(message == null ? "请检查数据包与文件访问权限。" : message).setPositiveButton("知道了", null).show();
    }

    private void setFullscreen(boolean enabled) {
        if (enabled && !fullScreen) {
            // Keep the user's normal orientation policy so leaving the enlarged
            // viewer returns to the same portrait/sensor behavior as before.
            orientationBeforeFullscreen = getRequestedOrientation();
            fullscreenOrientationSaved = true;
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        } else if (!enabled && fullScreen && fullscreenOrientationSaved) {
            setRequestedOrientation(orientationBeforeFullscreen);
            fullscreenOrientationSaved = false;
        }
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
        if (packageManager != null) { packageManager.close(); return; }
        if (directoryBrowser != null) { directoryBrowser.handleBack(); return; }
        if (web == null) { finish(); return; }
        web.evaluateJavascript("Boolean(window.CGSceneAndroid?.handleBack())", consumed -> {
            if (!"true".equals(consumed)) { if (fullScreen) setFullscreen(false); else finish(); }
        });
    }
    @Override public void onBackPressed() { handleBack(); }
    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        container.requestApplyInsets();
        if (directoryBrowser != null) directoryBrowser.onConfigurationChanged();
        if (packageManager != null) packageManager.onConfigurationChanged();
    }
    @Override protected void onPause() {
        resumed = false;
        call("onBackground", "");
        if (web != null) web.onPause();
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        if (web != null) web.onResume();
        notifyForeground();
        if (waitingForAllFiles) container.post(this::completeAllFilesRequest);
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        state.putBoolean("waitingForAllFiles", waitingForAllFiles);
        super.onSaveInstanceState(state);
    }
    @Override protected void onDestroy() {
        destroyed = true;
        if (directoryBrowser != null) { directoryBrowser.dismiss(); directoryBrowser = null; }
        if (packageManager != null) { packageManager.dismiss(); packageManager = null; }
        if (pickerDialog != null) pickerDialog.dismiss();
        if (progressDialog != null) progressDialog.dismiss();
        worker.shutdownNow();
        if (web != null) { web.stopLoading(); web.removeJavascriptInterface("CGSceneNative"); web.destroy(); web = null; }
        super.onDestroy();
    }

    private final class NativeBridge {
        @JavascriptInterface public String getAppVersion() {
            return BuildConfig.VERSION_NAME + (BuildConfig.DEBUG ? " · Debug" : " · Release");
        }
        @JavascriptInterface public void requestForeground() { runOnUiThread(MainActivity.this::notifyForeground); }
        @JavascriptInterface public void packageManagementFinished() { runOnUiThread(MainActivity.this::finishPicking); }
        @JavascriptInterface public void pickPackage() { runOnUiThread(MainActivity.this::pickPackage); }
        @JavascriptInterface public void packageSelectionFinished() { runOnUiThread(() -> {
            importing = false;
            notifyForeground();
        }); }
        @JavascriptInterface public String getInitialPackage() { return store.lastPackage(); }
        @JavascriptInterface public void rememberPackage(String url) { store.remember(url); }
        @JavascriptInterface public void setFullscreen(boolean enabled) { runOnUiThread(() -> MainActivity.this.setFullscreen(enabled)); }
        @JavascriptInterface public void setKeepScreenOn(boolean enabled) { runOnUiThread(() -> {
            if (enabled) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }); }
    }
}
