package com.easysmart.einform.checks;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.SystemClock;
import com.easysmart.einform.MainActivity;
import com.easysmart.einform.AgentService;
import java.io.File;
import java.io.FileInputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.UUID;

/** Runs in an actual API19 Android process against the isolated HTTP fixture. */
public final class AgentChecks extends Instrumentation {
    private MainActivity activity;
    private String base;
    private SharedPreferences preferences;
    private String identity;
    public void onCreate(Bundle arguments) { base = arguments.getString("server", "http://10.0.2.2:8067"); start(); }
    public void onStart() {
        Bundle result = new Bundle();
        try {
            Context context = getTargetContext();
            context.stopService(new Intent(context, AgentService.class));
            String uuid = UUID.randomUUID().toString(); identity = base + "|" + uuid;
            preferences = context.getSharedPreferences("agent", Context.MODE_PRIVATE);
            preferences.edit().clear().putString("uuid",uuid).putString("server",base).putString("deviceId","Z9-QA")
                .putString("siteId","QA").putString("profile","z9").putBoolean("configured",true)
                .putBoolean("sound",true).putBoolean("clean",true).putBoolean("deep",false).putInt("dwell",400).commit();
            control("mode=good&revision=qa-1"); launch(); waitRevision("qa-1");
            long firstPaint = displayedAt(); require(firstPaint > 0, "Painted page has no refresh timestamp");
            int requestsBefore=imagesRequested(control("")); refresh(false); SystemClock.sleep(2000);
            require(imagesRequested(control(""))==requestsBefore,"Unchanged revision downloaded PNG again");
            require(displayedAt() == firstPaint, "Unchanged revision advanced refresh timestamp");
            File cache = activePng(context.getFilesDir()); String hash = digest(cache);
            control("mode=corrupt&revision=qa-bad"); refresh(false); SystemClock.sleep(6000);
            require(hash.equals(digest(cache)), "Corrupt PNG replaced last good file");
            require("qa-1".equals(displayed()), "Corrupt PNG advanced displayed revision");
            require(displayedAt() == firstPaint, "Corrupt PNG advanced refresh timestamp");
            refresh(false); SystemClock.sleep(3000);
            control("mode=good&revision=qa-2&command=101"); refresh(false); waitRevision("qa-2");
            require(displayedAt() > firstPaint, "New page did not advance refresh timestamp");
            SystemClock.sleep(2500);
            String ack = control(""); require(ack.contains("\"id\":101,\"status\":\"completed\""), "No completed ACK after display");
            String updated = digest(cache); control("mode=offline"); refresh(false); SystemClock.sleep(2500);
            require(updated.equals(digest(cache)), "Offline changed cached PNG");
            refresh(true); SystemClock.sleep(6000);
            require("qa-2".equals(displayed()), "Offline forced redraw lost revision");
            long beforeRestart = displayedAt();
            runOnMainSync(new Runnable() { public void run() { activity.finish(); } }); waitForIdleSync();
            context.stopService(new Intent(context, AgentService.class)); SystemClock.sleep(1000);
            // Emulate power loss during AtomicFile replacement: backup is good, current file is partial.
            copy(cache,new File(cache.getAbsolutePath()+".bak"));
            java.io.FileOutputStream partial=new java.io.FileOutputStream(cache); partial.write(new byte[]{1,2,3});partial.close();
            launch(); SystemClock.sleep(3000);
            require(updated.equals(digest(activePng(context.getFilesDir()))), "Cold restart lost last-good PNG");
            require(displayedAt() == beforeRestart, "Restoring cache changed actual refresh timestamp");
            runOnMainSync(new Runnable() { public void run() {
                try {
                    java.lang.reflect.Field field=MainActivity.class.getDeclaredField("screen");field.setAccessible(true);
                    Object screen=field.get(activity);
                    java.lang.reflect.Field image=screen.getClass().getDeclaredField("bitmap");image.setAccessible(true);
                    android.graphics.Bitmap bitmap=(android.graphics.Bitmap)image.get(screen);
                    if(bitmap==null||bitmap.isRecycled())throw new IllegalStateException("Cold restart did not restore screen bitmap");
                }catch(Exception exception){throw new IllegalStateException(exception);}
            } });
            // Repeated starts must reuse a single network worker.
            for (int i=0;i<5;i++) context.startService(new Intent(context, AgentService.class));
            SystemClock.sleep(1000); int workers=0;
            for (Thread thread : Thread.getAllStackTraces().keySet()) if (thread.isAlive() && "EasyDesk.Network".equals(thread.getName())) workers++;
            require(workers==1, "Repeated service starts created " + workers + " network threads");
            result.putString("stream","PASS API19: first PNG, unchanged revision, corrupt/truncated rejection, last-good preservation, new revision, ACK after rendering, offline forced redraw, interrupted-write recovery, cold cached restart, bounded service worker\n");
            finish(Activity.RESULT_OK,result);
        } catch (Throwable exception) {
            android.util.Log.e("EasyDesk.Checks","Integration check failed",exception);
            result.putString("stream","FAIL: " + exception.toString() + "\n"); finish(Activity.RESULT_CANCELED,result);
        }
    }
    private void launch() {
        Intent intent = new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity=(MainActivity)startActivitySync(intent); waitForIdleSync();
    }
    private void refresh(final boolean force) { runOnMainSync(new Runnable() { public void run() { activity.refresh(force); } }); }
    private String displayed() { return preferences.getString("displayedRevision:" + identity,""); }
    private long displayedAt() { return preferences.getLong("displayedAt:" + identity,0); }
    private void waitRevision(String revision) throws Exception {
        long deadline=SystemClock.elapsedRealtime()+90000;
        while (SystemClock.elapsedRealtime()<deadline) { if (revision.equals(displayed())) return; SystemClock.sleep(200); }
        throw new Exception("Timed out waiting for painted revision " + revision + "; actual=" + displayed());
    }
    private String control(String query) throws Exception {
        HttpURLConnection connection=(HttpURLConnection)new URL(base+"/control?"+query).openConnection();
        connection.setConnectTimeout(5000); connection.setReadTimeout(5000);
        try {
            java.io.InputStream input=connection.getInputStream(); java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();
            try { byte[] buffer=new byte[4096];int count;while((count=input.read(buffer))!=-1)bytes.write(buffer,0,count); }
            finally {input.close();} return new String(bytes.toByteArray(),"UTF-8");
        } finally {connection.disconnect();}
    }
    private File activePng(File dir) throws Exception {
        byte[] bytes=MessageDigest.getInstance("SHA-256").digest(identity.getBytes("UTF-8"));
        StringBuilder value=new StringBuilder(); for(byte b:bytes)value.append(String.format("%02x",b&255));
        File file=new File(new File(dir,"display-"+value.substring(0,24)),"last-good.png");
        require(file.isFile(),"No last-good.png"); return file;
    }
    private static String digest(File file) throws Exception {
        MessageDigest digest=MessageDigest.getInstance("SHA-256");FileInputStream input=new FileInputStream(file);
        try{byte[] bytes=new byte[8192];int count;while((count=input.read(bytes))!=-1)digest.update(bytes,0,count);}finally{input.close();}
        StringBuilder value=new StringBuilder();for(byte b:digest.digest())value.append(String.format("%02x",b&255));return value.toString();
    }
    private static int imagesRequested(String value)throws Exception{
        org.json.JSONArray requests=new org.json.JSONObject(value).getJSONArray("requests");int count=0;
        for(int i=0;i<requests.length();i++)if(requests.getJSONObject(i).getString("url").equals("/api/display/Z9-QA.png"))count++;
        return count;
    }
    private static void copy(File from,File to)throws Exception{
        FileInputStream input=new FileInputStream(from);java.io.FileOutputStream output=new java.io.FileOutputStream(to);
        try{byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);output.getFD().sync();}
        finally{input.close();output.close();}
    }
    private static void require(boolean value,String message)throws Exception{if(!value)throw new Exception(message);}
}
