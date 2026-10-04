package com.easysmart.einform;

import android.content.Context;
import android.app.ActivityManager;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Debug;
import android.os.SystemClock;
import android.util.Log;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Enumeration;
import java.util.Locale;
import java.io.BufferedReader;
import java.io.FileReader;

/** Plain, local diagnostics for the waiting screen. No network requests. */
final class DeviceDiagnostics {
    static String collect(Context context) {
        AppConfig config = new AppConfig(context);
        String ip = "unavailable", mac = "unavailable", signal = "unavailable", network = "disconnected";
        try {
            WifiManager wifi = (WifiManager)context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            WifiInfo info = wifi == null ? null : wifi.getConnectionInfo();
            if (info != null) {
                int address = info.getIpAddress();
                if (address != 0) ip = (address & 255) + "." + ((address >>> 8) & 255) + "." + ((address >>> 16) & 255) + "." + ((address >>> 24) & 255);
                if (info.getMacAddress() != null) mac = info.getMacAddress();
                signal = info.getRssi() + " dBm";
            }
            if ("unavailable".equals(ip)) {
                Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
                while (interfaces != null && interfaces.hasMoreElements()) {
                    Enumeration<InetAddress> addresses = interfaces.nextElement().getInetAddresses();
                    while (addresses.hasMoreElements()) {
                        InetAddress address = addresses.nextElement();
                        if (!address.isLoopbackAddress() && !address.isLinkLocalAddress() && address.getAddress().length == 4) ip = address.getHostAddress();
                    }
                }
            }
            ConnectivityManager manager = (ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkInfo active = manager == null ? null : manager.getActiveNetworkInfo();
            if (active != null) network = active.getTypeName() + " / " + active.getState().name();
        } catch (Exception exception) { Log.w("EasyDesk.Diagnostics", "Network diagnostics unavailable", exception); }
        String batteryText = "unavailable";
        Intent battery = context.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (battery != null) {
            int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1), scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, 0);
            int status = battery.getIntExtra(BatteryManager.EXTRA_STATUS, 0);
            String charging = status == BatteryManager.BATTERY_STATUS_FULL ? "full"
                : status == BatteryManager.BATTERY_STATUS_CHARGING ? "charging" : "not charging";
            if (level >= 0 && scale > 0) batteryText = (level * 100 / scale) + "% / " + charging;
        }
        long seconds = SystemClock.elapsedRealtime() / 1000L;
        String uptime = String.format(Locale.US, "%dd %02d:%02d:%02d", seconds / 86400L, (seconds / 3600L) % 24L, (seconds / 60L) % 60L, seconds % 60L);
        DisplayMetrics display = new DisplayMetrics();
        ((WindowManager)context.getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getRealMetrics(display);
        String memory = "unavailable";
        try {
            ActivityManager.MemoryInfo info = new ActivityManager.MemoryInfo();
            ((ActivityManager)context.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(info);
            memory = mib(info.totalMem - info.availMem) + " / " + mib(info.totalMem) + " MiB used; available " + mib(info.availMem) + " MiB";
        } catch (RuntimeException exception) { Log.w("EasyDesk.Diagnostics", "Memory diagnostics unavailable", exception); }
        return "IP address: " + ip + "\nMAC: " + mac + "\nNetwork: " + network + "\nRSSI: " + signal
            + "\nUptime: " + uptime + "\nBattery: " + batteryText
            + "\nCPU: " + cpuModel() + "\nCPU frequency: " + frequency("scaling_cur_freq") + " MHz; max " + frequency("cpuinfo_max_freq") + " MHz"
            + "\nRAM: " + memory + "\nApp memory: " + (Debug.getPss() / 1024L) + " MiB (PSS)"
            + "\nAndroid: " + Build.VERSION.RELEASE + " / API " + Build.VERSION.SDK_INT
            + "\nDisplay: " + display.widthPixels + " x " + display.heightPixels + " px"
            + "\nServer: " + config.server + "\nDevice ID: " + config.deviceId + "\nSite ID: " + config.siteId
            + "\nApp: " + AppConfig.VERSION;
    }
    private static long mib(long bytes) { return bytes / (1024L * 1024L); }
    private static String frequency(String name) {
        try { return String.valueOf(Long.parseLong(readFirst("/sys/devices/system/cpu/cpu0/cpufreq/" + name)) / 1000L); }
        catch (Exception exception) { return "unavailable"; }
    }
    private static String readFirst(String file) throws Exception {
        BufferedReader reader = new BufferedReader(new FileReader(file));
        try { return reader.readLine(); } finally { reader.close(); }
    }
    private static String cpuModel() {
        String fallback = Build.HARDWARE;
        try {
            BufferedReader reader = new BufferedReader(new FileReader("/proc/cpuinfo"));
            try {
                String line; int count = 0;
                while ((line = reader.readLine()) != null && count++ < 128) {
                    int separator = line.indexOf(':'); if (separator < 0) continue;
                    String key = line.substring(0, separator).trim(), value = line.substring(separator + 1).trim();
                    if ("Hardware".equals(key)) return value;
                    if ("model name".equals(key) || "Processor".equals(key)) fallback = value;
                }
            } finally { reader.close(); }
        } catch (Exception exception) { Log.w("EasyDesk.Diagnostics", "CPU model unavailable", exception); }
        return fallback;
    }
    private DeviceDiagnostics() {}
}
