package com.easysmart.einform;

import android.app.Notification;
import android.app.AlarmManager;
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
import java.util.HashSet;
import java.net.URLEncoder;

public final class AgentService extends Service {
    public interface Listener {
        void image(Image image, boolean refresh);
        void status(String message, boolean failure, String detail);
        void timing(long displayedAt, long nextRefreshAt);
        void restart();
        void update(JSONObject release, String error, boolean downloaded);
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
    private HandlerThread heartbeatThread, commandThread;
    private Handler heartbeatWorker, commandWorker;
    private volatile HttpTransport heartbeatHttp, commandHttp, displayHttp;
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
    private String message = "等待连接";
    private volatile String activeIdentity = "";
    private boolean messageFailure;
    private String errorDetail = "";
    private final LinkedHashMap<Long,String> acknowledgements = new LinkedHashMap<Long,String>();
    private final LinkedHashMap<Long,String> completed = new LinkedHashMap<Long,String>();
    private final Object ackLock = new Object();
    private final LinkedHashMap<Long,JSONObject> queued = new LinkedHashMap<Long,JSONObject>();
    private final HashSet<Long> inFlight = new HashSet<Long>();
    private String commandIdentity = "";
    private long commandCursor;
    private long highestManualCommand;
    private int commandFailures;
    private boolean restarting;
    private UpdateClient updater;
    private JSONObject updateResult;
    private String updateError = "";
    private boolean updateReady, updatePending;
    private final Runnable periodic = new Runnable() { public void run() { tick(false, false); } };
    private final Runnable beatPeriodic = new Runnable() { public void run() { beat(); } };
    private final Runnable commandPeriodic = new Runnable() { public void run() { pollCommands(); } };

    public void onCreate() {
        super.onCreate();
        DisplayMetrics metrics = new DisplayMetrics();
        ((WindowManager)getSystemService(WINDOW_SERVICE)).getDefaultDisplay().getMetrics(metrics);
        width = Math.max(200, metrics.widthPixels); height = Math.max(200, metrics.heightPixels);
        thread = new HandlerThread("EasyDesk.Network"); thread.start(); worker = new Handler(thread.getLooper());
        heartbeatThread = new HandlerThread("EasyDesk.Heartbeat"); heartbeatThread.start(); heartbeatWorker = new Handler(heartbeatThread.getLooper());
        commandThread = new HandlerThread("EasyDesk.Commands"); commandThread.start(); commandWorker = new Handler(commandThread.getLooper());
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), 0);
        Notification notification = new Notification.Builder(this).setSmallIcon(R.drawable.ic_agent)
            .setContentTitle("EasyDesk Einform").setContentText("局域网显示终端").setContentIntent(open).setOngoing(true).build();
        startForeground(19, notification);
        updater = new UpdateClient(this, new UpdateClient.Callback() { public void result(final JSONObject release, final String error, final boolean downloaded) {
            main.post(new Runnable() { public void run() {
                if (destroyed) return;
                updateResult = release; updateError = error; updateReady = downloaded; updatePending = true;
                if (listener != null) { updatePending = false; listener.update(release, error, downloaded); }
            } });
        } });
        worker.post(periodic);
        heartbeatWorker.post(beatPeriodic); commandWorker.post(commandPeriodic);
    }
    public int onStartCommand(Intent intent, int flags, int startId) { return START_STICKY; }
    public IBinder onBind(Intent intent) { return binder; }
    void attach(Listener value) {
        listener = value;
        if (pending != null) listener.image(pending, true);
        else if (displayed != null) listener.image(displayed, false);
        listener.status(message, messageFailure, errorDetail);
        listener.timing(displayedAt, nextRefreshAt);
        if (updatePending) { updatePending = false; listener.update(updateResult, updateError, updateReady); }
    }
    void detach(Listener value) { if (listener == value) listener = null; }
    void checkUpdate() { updater.check(); }
    void downloadUpdate(JSONObject release) { updater.download(release); }
    void restored(Image image) {
        if (displayed == image && pending == null)
            new AppConfig(this).preferences.edit().putString("displayedRevision:" + activeIdentity, image.revision).commit();
    }
    void refresh(final boolean force) {
        // A local redraw uses the already validated page immediately, even while a heartbeat is timing out.
        worker.removeCallbacks(periodic);
        worker.post(new Runnable() { public void run() {
            try {
                initialise();
                if (force && cachedBitmap != null && !rendering) {
                    offer(cachedBitmap, cache.revision, new ArrayList<Long>(), true); return;
                }
            } catch (Exception exception) { Log.w("EasyDesk.Storage", "Preparing local redraw failed", exception); }
            tick(true, force);
        } });
        heartbeatWorker.removeCallbacks(beatPeriodic); heartbeatWorker.post(beatPeriodic);
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
                inFlight.removeAll(image.commands);
                rendering = false;
                nextMeta = SystemClock.elapsedRealtime() + interval * 1000L;
                schedule();
                drainCommands(); // Commands received during the clean sequence remain queued.
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
        synchronized (ackLock) { acknowledgements.clear(); }
        completed.clear(); queued.clear(); inFlight.clear();
        highestManualCommand = config.preferences.getLong("manualCommand:" + activeIdentity, 0);
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
    private JSONObject heartbeat(HttpTransport http, AppConfig heartbeatConfig) throws Exception {
        AppConfig config = heartbeatConfig;
        JSONObject body = new JSONObject();
        body.put("internalUuid", config.uuid); body.put("deviceId", config.deviceId); body.put("siteId", config.siteId);
        if (config.profile.length() > 0) body.put("profile", config.profile);
        body.put("appVersion", AppConfig.VERSION); body.put("androidVersion", Build.VERSION.RELEASE);
        body.put("uptime", SystemClock.elapsedRealtime() / 1000L);
        body.put("contentRevision", config.preferences.getString("displayedRevision:" + config.identity(), ""));
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
        if (config.identity().equals(new AppConfig(this).identity()))
            config.preferences.edit().putString("deviceId", device).putString("siteId", site).commit();
        return result;
    }
    private void beat() {
        if (destroyed) return;
        long delay = 60000;
        try {
            final AppConfig sending = new AppConfig(this);
            if (sending.configured) {
                heartbeatHttp = new HttpTransport(sending.server);
                final JSONObject response = heartbeat(heartbeatHttp, sending);
                worker.post(new Runnable() { public void run() { accept(response, sending.identity()); } });
            }
        } catch (Exception exception) {
            delay = 15000;
            // Telemetry failure must not prevent metadata, commands, or local redraws.
            Log.w("EasyDesk.Heartbeat", "Telemetry failed; independent display and command channels remain active", exception);
        } finally {
            if (!destroyed) { heartbeatWorker.removeCallbacks(beatPeriodic); heartbeatWorker.postDelayed(beatPeriodic, delay); }
        }
    }
    private void pollCommands() {
        if (destroyed) return;
        long delay = 1000;
        try {
            final AppConfig sending = new AppConfig(this);
            if (!sending.configured) { delay = 3000; return; }
            if (!sending.identity().equals(commandIdentity)) { commandIdentity = sending.identity(); commandCursor = 0; commandFailures = 0; }
            HttpTransport http = new HttpTransport(sending.server);
            commandHttp = http;
            flush(http, sending);
            if (destroyed) return;
            final JSONObject response = new JSONObject(http.json("/api/device/" + sending.deviceId + "/commands?internalUuid="
                + URLEncoder.encode(sending.uuid, "UTF-8") + "&after=" + commandCursor + "&wait=25", null, 30000));
            if (!response.optBoolean("ok")) throw new Exception("Command channel rejected");
            commandCursor = Math.max(commandCursor, response.optLong("cursor", commandCursor)); commandFailures = 0;
            worker.post(new Runnable() { public void run() { accept(response, sending.identity()); } });
            // Unacknowledged executing commands may be redelivered. Bound polling until the final paint is ACKed.
            delay = response.optJSONArray("commands") != null && response.optJSONArray("commands").length() > 0 ? 1000 : 100;
        } catch (Exception exception) {
            commandFailures++; delay = Math.min(30000, 1000L << Math.min(5, commandFailures - 1));
            Log.w("EasyDesk.Commands", "Command channel reconnecting", exception);
        } finally {
            if (!destroyed) { commandWorker.removeCallbacks(commandPeriodic); commandWorker.postDelayed(commandPeriodic, delay); }
        }
    }
    private void accept(JSONObject response, String identity) {
        if (destroyed || restarting || !identity.equals(new AppConfig(this).identity())) return;
        try {
            initialise();
            interval = Math.max(30, Math.min(86400, response.optInt("refreshIntervalSeconds", interval)));
            android.content.SharedPreferences.Editor edit = config.preferences.edit();
            if (response.has("deviceId")) edit.putString("deviceId", response.getString("deviceId"));
            if (response.has("siteId")) edit.putString("siteId", response.getString("siteId"));
            if (response.has("profile")) edit.putString("profile", response.getString("profile"));
            edit.commit(); config = new AppConfig(this);
            JSONArray commands = response.optJSONArray("commands");
            if (commands != null) {
                long previous = highestManualCommand;
                for (int i=0; i<commands.length(); i++) {
                    JSONObject command = commands.getJSONObject(i); JSONObject payload = command.optJSONObject("payload");
                    if (payload == null || !payload.optBoolean("automatic")) highestManualCommand = Math.max(highestManualCommand, command.getLong("id"));
                }
                if (previous != highestManualCommand) config.preferences.edit().putLong("manualCommand:" + activeIdentity, highestManualCommand).commit();
                // A delayed heartbeat cannot replay an older scheduled page over a newer manual selection/maintenance request.
                for (Long id : new ArrayList<Long>(queued.keySet())) {
                    JSONObject payload = queued.get(id).optJSONObject("payload");
                    if (id.longValue() < highestManualCommand && payload != null && payload.optBoolean("automatic")) { queued.remove(id); mark(id, "failed"); }
                }
            }
            if (commands != null) for (int i=0; i<commands.length(); i++) {
                JSONObject command = commands.getJSONObject(i); Long id = Long.valueOf(command.getLong("id"));
                if (completed.containsKey(id)) { synchronized (ackLock) { acknowledgements.put(id, completed.get(id)); } }
                else if (!inFlight.contains(id) && id.longValue() < highestManualCommand && command.optJSONObject("payload") != null && command.optJSONObject("payload").optBoolean("automatic")) mark(id, "failed");
                else if (!inFlight.contains(id) && !queued.containsKey(id)) queued.put(id, command);
            }
            drainCommands();
            if (cachedBitmap == null && !rendering && queued.isEmpty()) {
                worker.removeCallbacks(periodic); worker.post(periodic);
            }
        } catch (Exception exception) { Log.w("EasyDesk.Commands", "Invalid command response", exception); }
    }
    private void drainCommands() {
        if (rendering || restarting || destroyed || queued.isEmpty()) return;
        for (Long id : new ArrayList<Long>(queued.keySet())) {
            JSONObject command = queued.remove(id); String type = command.optString("type");
            if ("restart_app".equals(type)) { restart(id); return; }
            if ("reload_config".equals(type)) { mark(id, "completed"); nextMeta = 0; continue; }
            if ("refresh".equals(type) || "force_redraw".equals(type) || "show_maintenance".equals(type)) {
                ArrayList<Long> images = new ArrayList<Long>(); images.add(id); inFlight.add(id);
                JSONObject payload = command.optJSONObject("payload");
                boolean force = !"refresh".equals(type) || (payload != null && payload.optBoolean("automatic"));
                boolean cacheFallback = "force_redraw".equals(type) && (payload == null || !payload.has("revision") || payload.optString("revision").equals(cache.revision));
                tick(true, force, images, cacheFallback, payload);
                return; // Do not ACK a different command's page. The remaining commands stay queued.
            } else { mark(id, "failed"); Log.w("EasyDesk.Commands", "Unsupported command: " + type); }
        }
    }
    private void restart(final Long id) {
        // Persist before any shutdown. Redelivery after an interrupted ACK cannot trigger a restart loop.
        if (!mark(id, "completed")) return;
        restarting = true;
        final AppConfig sending = config;
        new Thread(new Runnable() { public void run() {
            try {
                JSONObject body = new JSONObject(); body.put("internalUuid", sending.uuid); body.put("status", "completed");
                new HttpTransport(sending.server).json("/api/device/command/" + id + "/ack", body.toString(), 3000);
            } catch (Exception exception) { Log.w("EasyDesk.Commands", "Restart ACK will retry after launch", exception); }
            main.post(new Runnable() { public void run() {
                if (destroyed) return;
                Intent open = new Intent(AgentService.this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                PendingIntent launch = PendingIntent.getActivity(AgentService.this, 913, open, PendingIntent.FLAG_CANCEL_CURRENT);
                ((AlarmManager)getSystemService(ALARM_SERVICE)).setExact(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + 500, launch);
                if (listener != null) listener.restart();
                stopSelf();
                Log.i("EasyDesk.Commands", "Restarting activity and display service for command " + id);
            } });
        } }, "EasyDesk.Restart").start();
    }
    private boolean mark(Long id, String result) {
        completed.put(id, result);
        synchronized (ackLock) { acknowledgements.put(id, result); }
        while (completed.size() > 64) completed.remove(completed.keySet().iterator().next());
        JSONObject value = new JSONObject();
        try { for (Map.Entry<Long,String> entry : completed.entrySet()) value.put(entry.getKey().toString(), entry.getValue()); }
        catch (Exception exception) { Log.e("EasyDesk.Storage", "Could not serialize completed commands", exception); return false; }
        boolean saved = config.preferences.edit().putString("completed:" + activeIdentity, value.toString()).commit();
        if (!saved) {
            completed.remove(id); synchronized (ackLock) { acknowledgements.remove(id); }
            Log.e("EasyDesk.Storage", "Could not persist command completion");
        }
        return saved;
    }
    private void flush(HttpTransport http, AppConfig sendingConfig) throws Exception {
        if (!sendingConfig.identity().equals(activeIdentity)) return;
        ArrayList<Long> ids;
        synchronized (ackLock) { ids = new ArrayList<Long>(acknowledgements.keySet()); }
        for (Long id : ids) {
            String result;
            synchronized (ackLock) { result = acknowledgements.get(id); }
            if (result == null) continue;
            JSONObject body = new JSONObject(); body.put("internalUuid", sendingConfig.uuid); body.put("status", result);
            try { http.json("/api/device/command/" + id + "/ack", body.toString()); }
            catch (HttpTransport.HttpError exception) {
                if (exception.code != 404 && exception.code != 409) throw exception;
                Log.w("EasyDesk.Heartbeat", "ACK no longer available for command " + id);
            }
            synchronized (ackLock) { if (result.equals(acknowledgements.get(id))) acknowledgements.remove(id); }
        }
    }
    private void tick(boolean manual, boolean force) {
        tick(manual, force, new ArrayList<Long>(), true, null);
    }
    private void tick(boolean manual, boolean force, ArrayList<Long> executing, boolean cacheFallback, JSONObject selection) {
        if (destroyed) return;
        boolean forceRequested = force;
        try {
            initialise();
            if (!config.configured) { status("点击设置，填写服务器与设备 ID", false); return; }
            HttpTransport http = new HttpTransport(config.server);
            displayHttp = http;
            if (rendering) { status("正在显示；请稍后", false); return; }
            if (!manual && SystemClock.elapsedRealtime() < nextMeta) { failures = 0; status("已连接 · 保留当前页面", false); return; }
            boolean selected = selection != null && selection.has("image") && selection.has("revision");
            JSONObject meta = selected ? selection : new JSONObject(http.json("/api/device/" + config.deviceId + "/meta", null));
            interval = Math.max(30, Math.min(86400, meta.optInt("refreshIntervalSeconds", interval)));
            String revision = meta.getString("revision");
            boolean changed = cachedBitmap == null || !revision.equals(cache.revision);
            if (changed || selected) {
                File temporary = new File(cache.directory, "download.tmp");
                try {
                    HttpTransport.ImageResponse response = http.image(meta.getString("image"), cachedBitmap == null || selected ? "" : cache.etag, temporary);
                    if (response.unchanged) {
                        if (cachedBitmap == null || !revision.equals(cache.revision)) throw new Exception("Unexpected 304 for changed revision");
                        changed = false;
                    } else {
                        Bitmap decoded = ImageCache.decode(temporary, width, height);
                        try { cache.commit(temporary, response.revision.length() > 0 ? response.revision : revision, response.etag); }
                        catch (Exception exception) { decoded.recycle(); throw exception; }
                        cachedBitmap = decoded;
                        changed = true;
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
                for (Long id : executing) mark(id, "completed"); inFlight.removeAll(executing);
                status("已是最新页面", false);
            }
        } catch (OutOfMemoryError exception) {
            Log.e("EasyDesk.Display", "Not enough memory to decode PNG; keeping previous page", exception);
            failures++; for (Long id : executing) mark(id, "failed"); inFlight.removeAll(executing);
            status(cachedBitmap == null ? "图片过大 · 等待有效图片" : "图片过大 · 已保留上一页", true, exception.toString());
        } catch (Exception exception) {
            Log.w("EasyDesk.Network", "Refresh failed; keeping previous page", exception);
            failures++;
            status(cachedBitmap == null ? "连接 / 图片失败 · 等待有效图片" : "连接 / 图片失败 · 已保留上一页", true, exception.toString());
            if (forceRequested && cacheFallback && cachedBitmap != null && !rendering) offer(cachedBitmap, cache.revision, executing, true);
            else { for (Long id : executing) if (config != null) mark(id, "failed"); inFlight.removeAll(executing); }
        } finally {
            schedule();
            if (!rendering && !queued.isEmpty()) worker.post(new Runnable() { public void run() { drainCommands(); } });
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
        if (updater != null) updater.stop();
        if (heartbeatHttp != null) heartbeatHttp.cancel();
        if (commandHttp != null) commandHttp.cancel();
        if (displayHttp != null) displayHttp.cancel();
        worker.removeCallbacksAndMessages(null); thread.quitSafely();
        heartbeatWorker.removeCallbacksAndMessages(null); heartbeatThread.quitSafely();
        commandWorker.removeCallbacksAndMessages(null); commandThread.quitSafely();
        stopForeground(true); super.onDestroy();
    }
}
