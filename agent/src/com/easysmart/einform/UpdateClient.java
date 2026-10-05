package com.easysmart.einform;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.res.AssetManager;
import android.content.res.XmlResourceParser;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.AtomicFile;
import android.util.Log;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashSet;

/** Easyupdate v1, kept independent from all display and command network workers. */
final class UpdateClient {
    interface Callback { void result(JSONObject release, String error, boolean downloaded); }
    static final String PACKAGE = "com.easysmart.einform";
    static final int MAX_BYTES = 64 * 1024 * 1024;
    private final Context context;
    private final Callback callback;
    private final HandlerThread thread = new HandlerThread("EasyDesk.Update");
    private final Handler worker;
    private volatile boolean stopped;
    private volatile HttpURLConnection active;
    private long nextCheck;
    private final Runnable periodic = new Runnable() { public void run() {
        try {
            try { heartbeat(); } catch (Exception exception) { Log.w("EasyDesk.Update", "Update telemetry unavailable", exception); }
            if (System.currentTimeMillis() >= nextCheck) {
                checkNow(false); nextCheck = System.currentTimeMillis() + 24 * 60 * 60 * 1000L;
            }
        }
        finally { if (!stopped) worker.postDelayed(this, 60 * 60 * 1000L); }
    } };
    UpdateClient(Context context, Callback callback) {
        this.context = context.getApplicationContext(); this.callback = callback;
        thread.start(); worker = new Handler(thread.getLooper()); worker.post(periodic);
    }
    void check() { worker.post(new Runnable() { public void run() { checkNow(true); } }); }
    void download(final JSONObject release) { worker.post(new Runnable() { public void run() { downloadNow(release); } }); }
    void stop() {
        stopped = true; worker.removeCallbacksAndMessages(null);
        HttpURLConnection connection = active; if (connection != null) connection.disconnect();
        thread.quitSafely();
    }
    private int versionCode() throws Exception { return context.getPackageManager().getPackageInfo(PACKAGE, 0).versionCode; }
    private void heartbeat() throws Exception {
        AppConfig config = new AppConfig(context);
        JSONObject body = new JSONObject(); body.put("device_id", config.uuid); body.put("package_name", PACKAGE);
        body.put("version_name", AppConfig.VERSION); body.put("version_code", versionCode());
        json(config.updateServer, "/api/v1/heartbeat", body.toString());
    }
    private void checkNow(boolean visible) {
        JSONObject release = null; String error = "";
        try {
            AppConfig config = new AppConfig(context);
            release = new JSONObject(json(config.updateServer, "/api/v1/apps/" + PACKAGE + "/latest?version_code=" + versionCode(), null));
            if (!PACKAGE.equals(release.optString("package_name"))) throw new Exception("更新服务返回了错误的包名");
            if (release.optBoolean("update_available")) validateRelease(config.updateServer, release);
            config.preferences.edit().putString("latestUpdate", release.toString()).putLong("updateCheckedAt", System.currentTimeMillis()).commit();
        } catch (Exception exception) { error = message(exception); Log.w("EasyDesk.Update", "Update check failed", exception); }
        if (visible && !stopped) callback.result(release, error, false);
    }
    private URL validateRelease(String base, JSONObject release) throws Exception {
        if (!PACKAGE.equals(release.getString("package_name"))) throw new Exception("更新包名不匹配");
        int code = release.getInt("version_code");
        if (code <= versionCode()) throw new Exception("拒绝降级或重复安装");
        long size = release.getLong("size");
        if (size < 1 || size > MAX_BYTES) throw new Exception("更新 APK 大小不受支持");
        if (!release.getString("sha256").matches("[a-fA-F0-9]{64}")) throw new Exception("更新缺少有效的 SHA-256");
        URI origin = new URI(AppConfig.validServer(base)), download = new URI(release.getString("download_url"));
        String path = "/api/v1/apps/" + PACKAGE + "/releases/" + code + "/download";
        if (!origin.getScheme().equals(download.getScheme()) || !origin.getRawAuthority().equalsIgnoreCase(download.getRawAuthority())
            || !path.equals(download.getRawPath()) || download.getRawQuery() != null || download.getFragment() != null || download.getUserInfo() != null)
            throw new Exception("更新下载地址必须来自配置的 Easyupdate 服务");
        return download.toURL();
    }
    private void downloadNow(JSONObject release) {
        File directory = new File(context.getFilesDir(), "updates");
        File temporary = new File(directory, "incoming.apk");
        HttpURLConnection connection = null;
        try {
            if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("无法创建更新目录");
            AppConfig config = new AppConfig(context);
            URL url = validateRelease(config.updateServer, release);
            connection = open(url); connection.setReadTimeout(30000);
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive");
            if (connection.getResponseCode() != 200) throw new Exception("APK 下载失败：HTTP " + connection.getResponseCode());
            long expected = release.getLong("size");
            if (connection.getContentLength() >= 0 && connection.getContentLength() != expected) throw new Exception("APK 响应长度不匹配");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary);
            long total = 0;
            try {
                byte[] buffer = new byte[16384]; int count;
                while ((count = input.read(buffer)) != -1) {
                    if (stopped) throw new Exception("更新已取消");
                    total += count; if (total > expected || total > MAX_BYTES) throw new Exception("APK 超出声明大小");
                    digest.update(buffer, 0, count); output.write(buffer, 0, count);
                }
                output.getFD().sync();
            } finally { try { input.close(); } finally { output.close(); } }
            if (total != expected || !hex(digest.digest()).equalsIgnoreCase(release.getString("sha256"))) throw new Exception("APK 大小 / SHA-256 校验失败");
            verifyApk(context, temporary, release.getInt("version_code"));
            AtomicFile verified = new AtomicFile(new File(directory, "update.apk"));
            FileOutputStream saved = verified.startWrite();
            try {
                FileInputStream bytes = new FileInputStream(temporary);
                try { byte[] buffer = new byte[16384]; int count; while ((count = bytes.read(buffer)) != -1) saved.write(buffer, 0, count); }
                finally { bytes.close(); }
                verified.finishWrite(saved);
            } catch (Exception exception) { verified.failWrite(saved); throw exception; }
            config.preferences.edit().putString("verifiedUpdate", release.toString()).commit();
            if (!stopped) callback.result(release, "", true);
        } catch (Exception exception) {
            Log.w("EasyDesk.Update", "APK verification/download failed", exception);
            if (!stopped) callback.result(release, message(exception), false);
        } finally {
            if (connection != null) close(connection);
            if (temporary.exists() && !temporary.delete()) Log.w("EasyDesk.Update", "Temporary update remains in private directory");
        }
    }
    static void verifyApk(Context context, File file, int versionCode) throws Exception {
        PackageManager manager = context.getPackageManager();
        PackageInfo candidate = manager.getPackageArchiveInfo(file.getAbsolutePath(), PackageManager.GET_SIGNATURES);
        PackageInfo installed = manager.getPackageInfo(PACKAGE, PackageManager.GET_SIGNATURES);
        if (candidate == null || !PACKAGE.equals(candidate.packageName) || candidate.versionCode != versionCode || versionCode <= installed.versionCode)
            throw new Exception("APK 包名或版本校验失败");
        if (candidate.signatures == null || candidate.signatures.length == 0 || !signatures(installed.signatures).equals(signatures(candidate.signatures)))
            throw new Exception("APK 签名与当前 APP 不一致");
        AssetManager assets = AssetManager.class.newInstance(); XmlResourceParser xml = null;
        try {
            java.lang.reflect.Method add = AssetManager.class.getDeclaredMethod("addAssetPath", String.class); add.setAccessible(true);
            int cookie = ((Integer)add.invoke(assets, file.getAbsolutePath())).intValue();
            if (cookie == 0) throw new Exception("无法读取 APK AndroidManifest.xml");
            xml = assets.openXmlResourceParser(cookie, "AndroidManifest.xml");
            while (xml.next() != XmlPullParser.END_DOCUMENT) if (xml.getEventType() == XmlPullParser.START_TAG && "uses-sdk".equals(xml.getName())) {
                String raw = xml.getAttributeValue("http://schemas.android.com/apk/res/android", "minSdkVersion");
                if (raw != null && !raw.matches("[0-9]+")) throw new Exception("APK minSdkVersion 不能用于这台设备");
                int minimum = xml.getAttributeIntValue("http://schemas.android.com/apk/res/android", "minSdkVersion", 1);
                if (minimum > Build.VERSION.SDK_INT) throw new Exception("此 APK 要求 Android API " + minimum + "，设备是 " + Build.VERSION.SDK_INT);
                return;
            }
        } finally { if (xml != null) xml.close(); assets.close(); }
    }
    private static HashSet<String> signatures(Signature[] signatures) throws Exception {
        HashSet<String> result = new HashSet<String>();
        if (signatures != null) for (Signature signature : signatures) result.add(hex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())));
        return result;
    }
    private String json(String base, String path, String body) throws Exception {
        HttpURLConnection connection = open(new URL(AppConfig.validServer(base) + path));
        try {
            connection.setRequestProperty("Accept", "application/json");
            if (body != null) {
                byte[] bytes = body.getBytes("UTF-8"); connection.setRequestMethod("POST"); connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json"); connection.setFixedLengthStreamingMode(bytes.length);
                java.io.OutputStream output = connection.getOutputStream(); try { output.write(bytes); } finally { output.close(); }
            }
            int code = connection.getResponseCode();
            if (code != 200) throw new Exception(code == 404 ? "Easyupdate 尚未发布本 APP 的版本" : "Easyupdate HTTP " + code);
            InputStream input = connection.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try { byte[] buffer = new byte[4096]; int count, total = 0; while ((count = input.read(buffer)) != -1) {
                total += count; if (total > 128 * 1024) throw new Exception("更新响应过大"); bytes.write(buffer, 0, count);
            } } finally { input.close(); }
            return new String(bytes.toByteArray(), "UTF-8");
        } finally { close(connection); }
    }
    private HttpURLConnection open(URL url) throws Exception {
        if (stopped) throw new Exception("更新已停止");
        HttpURLConnection connection = (HttpURLConnection)url.openConnection(); active = connection;
        connection.setConnectTimeout(7000); connection.setReadTimeout(12000); connection.setInstanceFollowRedirects(false); connection.setUseCaches(false);
        return connection;
    }
    private void close(HttpURLConnection connection) { connection.disconnect(); if (active == connection) active = null; }
    private static String message(Exception exception) { return exception.getMessage() == null ? exception.toString() : exception.getMessage(); }
    private static String hex(byte[] bytes) { StringBuilder value = new StringBuilder(); for (byte b : bytes) value.append(String.format(java.util.Locale.US, "%02x", b & 255)); return value.toString(); }
}
