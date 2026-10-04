package com.easysmart.einform;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.WindowManager;
import com.easysmart.einform.core.HttpTransport;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;

public final class AgentService extends Service {
    public interface Listener {
        void image(Image image, boolean refresh);
        void status(String message, boolean failure, String detail);
        void timing(long displayedAt, long nextRefreshAt);
    }
    public static final class Image {
        final long id;
        final Bitmap bitmap;
        final String revision;
        final ArrayList<Long> commands;
        Image(long id, Bitmap bitmap, String revision, ArrayList<Long> commands) {
            this.id = id; this.bitmap = bitmap; this.revision = revision; this.commands = commands;
        }
    }
    public final class LocalBinder extends Binder { AgentService service() { return AgentService.this; } }
    private final LocalBinder binder = new LocalBinder();
    private final Handler main = new Handler(Looper.getMainLooper());
    private HandlerThread thread;
    private Handler worker;
    private Listener listener;
    private Image displayed, pending; // Main thread only; bitmap ownership stays here.
    private volatile boolean rendering;
    private volatile boolean destroyed;
    private AppConfig config;
    private ImageCache cache;
    private Bitmap cachedBitmap;
    private long serial, nextMeta;
    private long displayedAt, nextRefreshAt; // Main thread owns the displayed timestamp.
    private int width, height, interval = 300, failures;
    private String message = "等待连接", activeIdentity = "";
    private boolean messageFailure;
    private String errorDetail = "";
    private final LinkedHashMap<Long,String> acknowledgements = new LinkedHashMap<Long,String>();
    private final LinkedHashMap<Long,String> completed = new LinkedHashMap<Long,String>();
    private final Runnable periodic = new Runnable() { public void run() { tick(false, false); } };

    public void onCreate() {
        super.onCreate();
        DisplayMetrics metrics = new DisplayMetrics();
        ((WindowManager)getSystemService(WINDOW_SERVICE)).getDefaultDisplay().getMetrics(metrics);
        width = Math.max(200, metrics.widthPixels); height = Math.max(200, metrics.heightPixels);
        thread = new HandlerThread("EasyDesk.Network"); thread.start(); worker = new Handler(thread.getLooper());
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), 0);
        Notification notification = new Notification.Builder(this).setSmallIcon(R.drawable.ic_agent)
            .setContentTitle("EasyDesk Einform").setContentText("局域网显示终端").setContentIntent(open).setOngoing(true).build();
        startForeground(19, notification);
        worker.post(periodic);
    }
    public int onStartCommand(Intent intent, int flags, int startId) { return START_STICKY; }
    public IBinder onBind(Intent intent) { return binder; }
    void attach(Listener value) {
        listener = value;
        if (pending != null) listener.image(pending, true);
        else if (displayed != null) listener.image(displayed, false);
        listener.status(message, messageFailure, errorDetail);
        listener.timing(displayedAt, nextRefreshAt);
    }
    void detach(Listener value) { if (listener == value) listener = null; }
    void restored(Image image) {
        if (displayed == image && pending == null)
            new AppConfig(this).preferences.edit().putString("displayedRevision:" + activeIdentity, image.revision).commit();
    }
    void refresh(final boolean force) {
        worker.removeCallbacks(periodic);
        worker.post(new Runnable() { public void run() { tick(true, force); } });
    }
    void finish(final Image image) {
        if (pending != image) return;
        displayedAt = System.currentTimeMillis();
        new AppConfig(this).preferences.edit().putString("displayedRevision:" + activeIdentity, image.revision)
            .putLong("displayedAt:" + activeIdentity, displayedAt).commit();
        Image old = displayed; displayed = pending; pending = null;
        if (old != null && old.bitmap != image.bitmap) old.bitmap.recycle();
        worker.post(new Runnable() {
            public void run() {
                for (Long id : image.commands) mark(id, "completed");
                rendering = false;
                nextMeta = SystemClock.elapsedRealtime() + interval * 1000L;
                schedule();
                if (!image.commands.isEmpty()) {
                    worker.removeCallbacks(periodic); worker.post(periodic); // ACK only after the painted page + short tone
                }
            }
        });
    }
    private void status(final String text, final boolean failure) {
        status(text, failure, "");
    }
    private void status(final String text, final boolean failure, final String detail) {
        main.post(new Runnable() { public void run() {
            if (destroyed) return;
            message = text; messageFailure = failure; errorDetail = detail.length() > 500 ? detail.substring(0,500) : detail;
            if (listener != null) listener.status(text, failure, errorDetail);
        } });
    }
    private void offer(final Bitmap bitmap, final String revision, final ArrayList<Long> commands, final boolean refresh) {
        final long id = ++serial;
        final String identity = activeIdentity;
        if (refresh) rendering = true;
        main.post(new Runnable() { public void run() {
            if (destroyed || !identity.equals(new AppConfig(AgentService.this).identity())) {
                worker.post(new Runnable() { public void run() { rendering = false; } });
                return;
            }
            Image image = new Image(id, bitmap, revision, commands);
            if (refresh) pending = image;
            else displayed = image;
            if (listener != null) listener.image(image, refresh);
        } });
    }
    private void initialise() throws Exception {
        config = new AppConfig(this);
        if (cache != null && activeIdentity.equals(config.identity())) return;
        activeIdentity = config.identity(); rendering = false; nextMeta = 0;
        final long savedTime = config.preferences.getLong("displayedAt:" + activeIdentity, 0);
        main.post(new Runnable() { public void run() {
            pending = null; displayedAt = savedTime; nextRefreshAt = 0;
            if (listener != null) listener.timing(displayedAt, nextRefreshAt);
        } });
        acknowledgements.clear(); completed.clear();
        JSONObject saved = new JSONObject(config.preferences.getString("completed:" + activeIdentity, "{}"));
        JSONArray names = saved.names();
        if (names != null) for (int i=0; i<names.length(); i++) {
            String key = names.getString(i); completed.put(Long.valueOf(key), saved.getString(key));
        }
        cache = new ImageCache(getFilesDir(), activeIdentity); cachedBitmap = null;
        if (cache.png.exists() || new File(cache.png.getAbsolutePath() + ".bak").exists()) {
            try { cachedBitmap = cache.load(width, height); offer(cachedBitmap, cache.revision, new ArrayList<Long>(), false); }
            catch (Exception exception) { Log.w("EasyDesk.Storage", "Previous PNG unavailable", exception); }
        }
    }
    private JSONObject heartbeat(HttpTransport http) throws Exception {
        JSONObject body = new JSONObject();
        body.put("internalUuid", config.uuid); body.put("deviceId", config.deviceId); body.put("siteId", config.siteId);
        if (config.profile.length() > 0) body.put("profile", config.profile);
        body.put("appVersion", AppConfig.VERSION); body.put("androidVersion", Build.VERSION.RELEASE);
        body.put("uptime", SystemClock.elapsedRealtime() / 1000L);
        body.put("contentRevision", config.preferences.getString("displayedRevision:" + activeIdentity, ""));
        Intent battery = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (battery != null) {
            int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
            int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            if (level >= 0 && scale > 0) body.put("battery", Math.min(100, level * 100 / scale));
            int state = battery.getIntExtra(BatteryManager.EXTRA_STATUS, 0);
            body.put("charging", state == BatteryManager.BATTERY_STATUS_CHARGING || state == BatteryManager.BATTERY_STATUS_FULL);
        }
        WifiManager wifi = (WifiManager)getApplicationContext().getSystemService(WIFI_SERVICE);
        if (wifi != null) { WifiInfo info = wifi.getConnectionInfo(); if (info != null && info.getRssi() >= -150 && info.getRssi() <= 0) body.put("rssi", info.getRssi()); }
        JSONObject result = new JSONObject(http.json("/api/device/heartbeat", body.toString()));
        if (!result.optBoolean("ok")) throw new Exception("Heartbeat rejected");
        String device = result.getString("deviceId"), site = result.getString("siteId");
        config.preferences.edit().putString("deviceId", device).putString("siteId", site).commit();
        config = new AppConfig(this);
        interval = Math.max(30, Math.min(86400, result.optInt("refreshIntervalSeconds", 300)));
        return result;
    }
    private void mark(Long id, String result) {
        completed.put(id, result); acknowledgements.put(id, result);
        while (completed.size() > 64) completed.remove(completed.keySet().iterator().next());
        JSONObject value = new JSONObject();
        try { for (Map.Entry<Long,String> entry : completed.entrySet()) value.put(entry.getKey().toString(), entry.getValue()); }
        catch (Exception exception) { Log.e("EasyDesk.Storage", "Could not serialize completed commands", exception); return; }
        if (!config.preferences.edit().putString("completed:" + activeIdentity, value.toString()).commit()) Log.e("EasyDesk.Storage", "Could not persist command completion");
    }
    private void flush(HttpTransport http) throws Exception {
        ArrayList<Long> ids = new ArrayList<Long>(acknowledgements.keySet());
        for (Long id : ids) {
            JSONObject body = new JSONObject(); body.put("internalUuid", config.uuid); body.put("status", acknowledgements.get(id));
            try { http.json("/api/device/command/" + id + "/ack", body.toString()); }
            catch (HttpTransport.HttpError exception) {
                if (exception.code != 404 && exception.code != 409) throw exception;
                Log.w("EasyDesk.Heartbeat", "ACK no longer available for command " + id);
            }
            acknowledgements.remove(id);
        }
    }
    private void tick(boolean manual, boolean force) {
        if (destroyed) return;
        ArrayList<Long> executing = new ArrayList<Long>();
        boolean forceRequested = force;
        try {
            initialise();
            if (!config.configured) { status("点击设置，填写服务器与设备 ID", false); return; }
            HttpTransport http = new HttpTransport(config.server);
            JSONObject beat = heartbeat(http);
            JSONArray commands = beat.optJSONArray("commands");
            if (commands != null) for (int i=0; i<commands.length(); i++) {
                JSONObject command = commands.getJSONObject(i); Long id = Long.valueOf(command.getLong("id"));
                if (completed.containsKey(id)) { acknowledgements.put(id, completed.get(id)); continue; }
                String type = command.getString("type");
                if ("reload_config".equals(type)) mark(id, "completed");
                else if ("refresh".equals(type) || "force_redraw".equals(type) || "show_maintenance".equals(type)) {
                    executing.add(id); manual = true;
                    if (!"refresh".equals(type)) force = true;
                } else { mark(id, "failed"); Log.w("EasyDesk.Heartbeat", "Unsupported MVP command: " + type); }
            }
            flush(http);
            if (rendering) { status("正在显示；请稍后", false); return; }
            if (!manual && SystemClock.elapsedRealtime() < nextMeta) { failures = 0; status("已连接 · 保留当前页面", false); return; }
            JSONObject meta = new JSONObject(http.json("/api/device/" + config.deviceId + "/meta", null));
            String revision = meta.getString("revision");
            boolean changed = cachedBitmap == null || !revision.equals(cache.revision);
            if (changed) {
                File temporary = new File(cache.directory, "download.tmp");
                try {
                    HttpTransport.ImageResponse response = http.image(meta.getString("image"), cachedBitmap == null ? "" : cache.etag, temporary);
                    if (response.unchanged) {
                        if (cachedBitmap == null || !revision.equals(cache.revision)) throw new Exception("Unexpected 304 for changed revision");
                        changed = false;
                    } else {
                        Bitmap decoded = ImageCache.decode(temporary, width, height);
                        try { cache.commit(temporary, response.revision.length() > 0 ? response.revision : revision, response.etag); }
                        catch (Exception exception) { decoded.recycle(); throw exception; }
                        cachedBitmap = decoded;
                    }
                } finally {
                    if (temporary.exists() && !temporary.delete()) Log.w("EasyDesk.Storage", "Temporary download retained");
                }
            }
            failures = 0; nextMeta = SystemClock.elapsedRealtime() + interval * 1000L;
            if (changed || force) {
                status(meta.optBoolean("stale") ? "服务器返回缓存页面" : "图片校验完成", false);
                offer(cachedBitmap, cache.revision, executing, true);
            } else {
                for (Long id : executing) mark(id, "completed"); flush(http);
                status("已是最新页面", false);
            }
        } catch (OutOfMemoryError exception) {
            Log.e("EasyDesk.Display", "Not enough memory to decode PNG; keeping previous page", exception);
            failures++; for (Long id : executing) mark(id, "failed");
            status(cachedBitmap == null ? "图片过大 · 等待有效图片" : "图片过大 · 已保留上一页", true, exception.toString());
        } catch (Exception exception) {
            Log.w("EasyDesk.Network", "Refresh failed; keeping previous page", exception);
            failures++; for (Long id : executing) if (config != null) mark(id, "failed");
            status(cachedBitmap == null ? "连接 / 图片失败 · 等待有效图片" : "连接 / 图片失败 · 已保留上一页", true, exception.toString());
            if (forceRequested && cachedBitmap != null && !rendering) offer(cachedBitmap, cache.revision, new ArrayList<Long>(), true);
        } finally {
            schedule();
        }
    }
    private void schedule() {
        if (destroyed) return;
        long remaining = Math.max(0, nextMeta - SystemClock.elapsedRealtime());
        long delay = failures == 0 ? (remaining > 0 ? Math.min(60000L, remaining) : 60000L)
            : Math.min(300, 15 * (1 << Math.min(4, failures - 1))) * 1000L;
        final long next = config == null || !config.configured ? 0
            : System.currentTimeMillis() + (failures == 0 ? remaining : delay);
        main.post(new Runnable() { public void run() {
            if (destroyed) return;
            nextRefreshAt = next;
            if (listener != null) listener.timing(displayedAt, nextRefreshAt);
        } });
        worker.removeCallbacks(periodic);
        worker.postDelayed(periodic, Math.max(1000L, delay));
    }
    public void onDestroy() {
        destroyed = true; listener = null;
        worker.removeCallbacksAndMessages(null); thread.quitSafely();
        stopForeground(true); super.onDestroy();
    }
}
