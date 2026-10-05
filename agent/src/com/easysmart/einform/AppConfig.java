package com.easysmart.einform;

import android.content.Context;
import android.content.SharedPreferences;
import java.net.URI;
import java.util.UUID;

final class AppConfig {
    static final String VERSION = "0.1.4-z9";
    final SharedPreferences preferences;
    final String server, updateServer, uuid, deviceId, siteId, profile;
    final boolean configured, sound, deep, clean;
    final int dwell;

    AppConfig(Context context) {
        preferences = context.getSharedPreferences("agent", Context.MODE_PRIVATE);
        String saved = preferences.getString("uuid", "");
        if (saved.length() == 0) { saved = UUID.randomUUID().toString(); preferences.edit().putString("uuid", saved).commit(); }
        uuid = saved;
        server = preferences.getString("server", "http://192.168.95.55:19900");
        updateServer = preferences.getString("updateServer", "http://192.168.95.55:19910");
        deviceId = preferences.getString("deviceId", "Z9-" + uuid.substring(0, 6));
        siteId = preferences.getString("siteId", deviceId);
        profile = preferences.getString("profile", "z9");
        configured = preferences.getBoolean("configured", false);
        sound = preferences.getBoolean("sound", true);
        deep = preferences.getBoolean("deep", false);
        clean = preferences.getBoolean("clean", true);
        dwell = preferences.getInt("dwell", 700);
    }
    String identity() { return server + "|" + uuid; }
    static String validServer(String text) throws Exception {
        String value = text.trim();
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        URI uri = new URI(value);
        if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) || uri.getHost() == null
            || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
            || (uri.getPath() != null && uri.getPath().length() > 0) || uri.getPort() > 65535)
            throw new Exception("填写服务器根地址，例如 http://192.168.95.55:19900");
        return value;
    }
    static String validId(String text) throws Exception {
        String value = text.trim();
        if (!value.matches("[A-Za-z0-9_-]{1,48}")) throw new Exception("设备 / 站点 ID 使用 1–48 位英文、数字、下划线或短横线");
        return value;
    }
}
