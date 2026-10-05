package com.easysmart.einform;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.ServiceConnection;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.util.Log;
import android.util.DisplayMetrics;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import com.easysmart.einform.core.RefreshSequence;
import org.json.JSONObject;

public final class MainActivity extends Activity implements AgentService.Listener, ScreenView.Controls {
    private final Handler handler = new Handler();
    private ScreenView screen;
    private AgentService service;
    private AgentService.Image current;
    private RefreshSequence sequence;
    private ToneGenerator tone;
    private boolean bound, resumed, failureSounded;
    private AlertDialog settings;
    private AlertDialog updateDialog;
    private ProgressDialog updateProgress;
    private String debugStatus = "等待连接", debugError = "none";
    private final Runnable diagnostics = new Runnable() {
        public void run() {
            if (!resumed) return;
            updateDiagnostics();
            handler.postDelayed(this, 15000);
        }
    };
    private final ServiceConnection connection = new ServiceConnection() {
        public void onServiceConnected(ComponentName name, IBinder binder) {
            service = ((AgentService.LocalBinder)binder).service();
            if (resumed) service.attach(MainActivity.this);
        }
        public void onServiceDisconnected(ComponentName name) { service = null; }
    };
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        screen = new ScreenView(this, this); setContentView(screen);
        immersive();
        try { tone = new ToneGenerator(AudioManager.STREAM_MUSIC, 80); }
        catch (RuntimeException exception) { Log.w("EasyDesk.Display", "Speaker unavailable", exception); }
        startService(new Intent(this, AgentService.class));
    }
    protected void onResume() {
        super.onResume(); resumed = true;
        bound = bindService(new Intent(this, AgentService.class), connection, Context.BIND_AUTO_CREATE);
        handler.post(diagnostics);
    }
    protected void onPause() {
        resumed = false;
        if (updateProgress != null) { updateProgress.dismiss(); updateProgress = null; }
        if (sequence != null) { sequence.cancel(); sequence = null; }
        handler.removeCallbacksAndMessages(null);
        if (service != null) service.detach(this);
        if (bound) { unbindService(connection); bound = false; }
        service = null;
        screen.show(current == null ? null : current.bitmap, RefreshSequence.Frame.PAGE, false, null);
        super.onPause();
    }
    protected void onDestroy() {
        if (settings != null) settings.dismiss();
        if (updateDialog != null) updateDialog.dismiss();
        if (updateProgress != null) updateProgress.dismiss();
        if (tone != null) { tone.release(); tone = null; }
        super.onDestroy();
    }
    public void image(final AgentService.Image image, boolean refresh) {
        if (!resumed) return;
        if (!refresh) {
            current = image;
            screen.show(image.bitmap, RefreshSequence.Frame.PAGE, false, new Runnable() {
                public void run() { if (service != null) service.restored(image); }
            });
            return;
        }
        if (sequence != null) return;
        final AppConfig config = new AppConfig(this);
        sequence = new RefreshSequence(new RefreshSequence.Scheduler() {
            public void after(long millis, Runnable action) { handler.postDelayed(action, millis); }
        }, new RefreshSequence.Renderer() {
            public void show(RefreshSequence.Frame frame, Runnable painted) {
                screen.show(image.bitmap, frame, true, painted);
            }
        }, new RefreshSequence.Completion() {
            public void complete() {
                if (!resumed) return;
                current = image; sequence = null;
                screen.show(image.bitmap, RefreshSequence.Frame.PAGE, false, null);
                beep(120, false);
                if (service != null) service.finish(image);
            }
        }, config.dwell, config.deep, config.clean);
        sequence.start();
    }
    public void status(String text, boolean failure, String detail) {
        debugStatus = text; debugError = detail.length() == 0 ? "none" : detail;
        screen.status(text);
        updateDiagnostics();
        if (failure && !failureSounded) { failureSounded = true; beep(800, true); }
        else if (!failure) failureSounded = false;
    }
    private void updateDiagnostics() {
        // Read hardware statistics only while the waiting page is visible.
        if (screen.waiting()) screen.diagnostics(DeviceDiagnostics.collect(this) + "\nStatus: " + debugStatus + "\nLast error: " + debugError);
    }
    public void timing(long displayedAt, long nextRefreshAt) { screen.timing(displayedAt, nextRefreshAt); }
    public void restart() { finish(); }
    public void update(final JSONObject release, String error, boolean downloaded) {
        if (updateProgress != null) { updateProgress.dismiss(); updateProgress = null; }
        if (!resumed) return;
        if (error.length() > 0) { updateDialog = new AlertDialog.Builder(this).setTitle("APP 更新").setMessage(error).setPositiveButton("返回", null).show(); return; }
        if (downloaded) {
            try {
                Intent install = UpdateProvider.installerIntent(this);
                startActivityForResult(install, 19910);
            } catch (Exception exception) { updateDialog = new AlertDialog.Builder(this).setTitle("已下载并校验 APK")
                .setMessage("这台 ROM 未能打开系统安装器。可使用同签名 APK 通过 ADB 更新；原配置和图片仍保留。\n" + exception.getMessage()).setPositiveButton("返回", null).show(); }
            return;
        }
        if (release == null || !release.optBoolean("update_available")) {
            updateDialog = new AlertDialog.Builder(this).setTitle("APP 更新").setMessage("当前已是最新版本：" + AppConfig.VERSION).setPositiveButton("返回", null).show(); return;
        }
        String notes = release.optString("release_notes"); if (notes.length() > 6000) notes = notes.substring(0,6000);
        updateDialog = new AlertDialog.Builder(this).setTitle("新版本 " + release.optString("version_name"))
            .setMessage((release.optBoolean("mandatory") ? "服务器标记为必要更新。\n" : "") + notes + "\n\nAPK 将校验大小、SHA-256、包名、版本和签名；安装由系统确认。")
            .setPositiveButton("下载并安装", new DialogInterface.OnClickListener() { public void onClick(DialogInterface dialog, int which) {
                if (service != null) { updateProgress = ProgressDialog.show(MainActivity.this, "APP 更新", "正在下载并校验 APK……", true, false); service.downloadUpdate(release); }
            } }).setNegativeButton("返回", null).show();
    }
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 19910 && result == RESULT_FIRST_USER) {
            updateDialog = new AlertDialog.Builder(this).setTitle("安装未完成")
                .setMessage("系统安装器拒绝更新（ROM 安装限制或签名 / 包校验错误）。可用同签名 APK 通过 ADB 更新；现有设置和缓存保留。")
                .setPositiveButton("返回", null).show();
        }
    }
    private void beep(int millis, boolean error) {
        if (!new AppConfig(this).sound || tone == null) return;
        try {
            boolean started = tone.startTone(error ? ToneGenerator.TONE_PROP_NACK : ToneGenerator.TONE_PROP_BEEP, millis);
            Log.i("EasyDesk.Display", (error ? "long" : "short") + " tone " + millis + "ms started=" + started);
        } catch (RuntimeException exception) { Log.w("EasyDesk.Display", "Tone failed", exception); }
    }
    public void refresh(boolean force) {
        if (sequence == null && service != null) {
            debugStatus = force ? "准备完整清屏" : "正在检查更新"; debugError = "none";
            screen.status(debugStatus); updateDiagnostics(); service.refresh(force);
        }
    }
    public void settings() {
        if (!resumed || sequence != null || (settings != null && settings.isShowing())) return;
        final AppConfig config = new AppConfig(this);
        LinearLayout form = new LinearLayout(this); form.setOrientation(LinearLayout.VERTICAL);
        int pad = (int)(12 * getResources().getDisplayMetrics().density); form.setPadding(pad,pad,pad,pad);
        final EditText server = field(form, "服务器根地址", config.server);
        final EditText updateServer = field(form, "Easyupdate 更新服务根地址", config.updateServer);
        final EditText device = field(form, "首次注册设备 ID（注册后由后台改名）", config.deviceId);
        final EditText site = field(form, "站点 ID", config.siteId);
        final EditText profile = field(form, "服务端 Profile 文件 ID（留空使用默认）", config.profile);
        final EditText dwell = field(form, "每帧停留毫秒（300–3000；默认 700）", String.valueOf(config.dwell));
        dwell.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        final CheckBox clean = check(form, "刷新前清洁显示屏", config.clean);
        final CheckBox deep = check(form, "深度清屏：黑白两轮", config.deep);
        final CheckBox sound = check(form, "提示音（使用媒体音量）", config.sound);
        DisplayMetrics display = new DisplayMetrics(); getWindowManager().getDefaultDisplay().getRealMetrics(display);
        TextView help = new TextView(this); help.setText("点击右上角：检查更新；长按：用有效图片完整清屏。\n分辨率：" + display.widthPixels + "×" + display.heightPixels + " px\nUUID：" + config.uuid + "\n版本：" + AppConfig.VERSION); form.addView(help);
        ScrollView scroll = new ScrollView(this); scroll.addView(form);
        settings = new AlertDialog.Builder(this).setTitle("连接与清屏设置").setView(scroll)
            .setPositiveButton("保存并连接", null).setNegativeButton("返回", null).setNeutralButton("检查 APP 更新", null).create();
        settings.setOnShowListener(new DialogInterface.OnShowListener() { public void onShow(DialogInterface dialog) {
            settings.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(new android.view.View.OnClickListener() { public void onClick(android.view.View view) {
                if (service == null) return;
                try {
                    String address = AppConfig.validServer(updateServer.getText().toString());
                    if (!config.preferences.edit().putString("updateServer", address).commit()) throw new Exception("更新服务地址保存失败");
                    settings.dismiss(); updateProgress = ProgressDialog.show(MainActivity.this, "APP 更新", "正在检查 Easyupdate……", true, false); service.checkUpdate();
                } catch (Exception exception) { updateServer.setError(exception.getMessage()); }
            } });
            settings.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(new android.view.View.OnClickListener() {
                public void onClick(android.view.View view) {
                    try {
                        String address = AppConfig.validServer(server.getText().toString());
                        String updates = AppConfig.validServer(updateServer.getText().toString());
                        String deviceId = AppConfig.validId(device.getText().toString());
                        String siteId = AppConfig.validId(site.getText().toString());
                        String profileId = profile.getText().toString().trim();
                        if (profileId.length() > 0 && !profileId.matches("[a-zA-Z0-9_-]{1,64}")) throw new Exception("Profile ID 只能包含英文、数字、下划线或短横线");
                        int milliseconds = Integer.parseInt(dwell.getText().toString());
                        if (milliseconds < 300 || milliseconds > 3000) throw new Exception("停留时间为 300–3000 毫秒");
                        boolean saved = config.preferences.edit().putString("server", address).putString("updateServer", updates).putString("deviceId", deviceId).putString("siteId", siteId)
                            .putString("profile", profileId).putInt("dwell", milliseconds).putBoolean("sound", sound.isChecked())
                            .putBoolean("deep", deep.isChecked()).putBoolean("clean", clean.isChecked()).putBoolean("configured", true).commit();
                        if (!saved) throw new Exception("保存失败，请检查存储空间");
                        settings.dismiss(); refresh(false);
                    } catch (Exception exception) { server.setError(exception.getMessage()); }
                }
            });
        } });
        settings.show();
    }
    private EditText field(LinearLayout form, String label, String value) {
        TextView title = new TextView(this); title.setText(label); form.addView(title);
        EditText input = new EditText(this); input.setSingleLine(true); input.setText(value); input.setTextSize(16);
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        form.addView(input); return input;
    }
    private CheckBox check(LinearLayout form, String label, boolean value) {
        CheckBox box = new CheckBox(this); box.setText(label); box.setChecked(value); form.addView(box); return box;
    }
    public void onBackPressed() { settings(); }
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus && (settings == null || !settings.isShowing())) immersive();
    }
    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
            | android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }
    public boolean onKeyDown(int key, KeyEvent event) {
        if (key == KeyEvent.KEYCODE_MENU) { settings(); return true; }
        return super.onKeyDown(key, event);
    }
}
