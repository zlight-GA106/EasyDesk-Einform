package com.easysmart.einform.checks;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;

/** Download tests use only a same-signed future-version fixture on the isolated emulator. */
public final class UpdateChecks extends Instrumentation {
    private String server;
    private final ArrayList<Object[]> results = new ArrayList<Object[]>();
    private Object updater;
    private Method check,download,stop;
    public void onCreate(Bundle arguments){server=arguments.getString("server","http://10.0.2.2:8079");start();}
    public void onStart(){
        Bundle result=new Bundle();
        try{
            Context context=getTargetContext();
            context.getSharedPreferences("agent",Context.MODE_PRIVATE).edit().putString("updateServer",server).commit();
            Class<?> type=Class.forName("com.easysmart.einform.UpdateClient");
            Class<?> callback=Class.forName("com.easysmart.einform.UpdateClient$Callback");
            Object listener=Proxy.newProxyInstance(callback.getClassLoader(),new Class<?>[]{callback},new InvocationHandler(){
                public Object invoke(Object proxy,Method method,Object[] args){if("result".equals(method.getName()))synchronized(results){results.add(args);results.notifyAll();}return null;}
            });
            java.lang.reflect.Constructor<?> constructor=type.getDeclaredConstructor(Context.class,callback);constructor.setAccessible(true);updater=constructor.newInstance(context,listener);
            check=type.getDeclaredMethod("check");check.setAccessible(true);download=type.getDeclaredMethod("download",JSONObject.class);download.setAccessible(true);stop=type.getDeclaredMethod("stop");stop.setAccessible(true);
            control("good");JSONObject release=checked();require(release.getInt("version_code")==6,"Wrong fixture version");
            Object[] good=downloaded(release);require(((Boolean)good[2]).booleanValue()&&"".equals(good[1]),"Valid API19 update rejected: "+good[1]);
            File verified=new File(context.getFilesDir(),"updates/update.apk");String hash=digest(verified);
            java.io.InputStream shared=context.getContentResolver().openInputStream(Uri.parse("content://com.easysmart.einform.updates/apk"));
            require(shared!=null&&shared.read()>0,"Verified APK URI unreadable");shared.close();
            for(String mode:new String[]{"hash","size","signature","redirect","sdk"}){
                control(mode);release=checked();Object[] failed=downloaded(release);
                require(!((Boolean)failed[2]).booleanValue()&&((String)failed[1]).length()>0,"Rejected fixture accepted: "+mode);
                require(hash.equals(digest(verified)),"Bad update replaced previously verified APK: "+mode);
            }
            control("foreign");release=checked();Object[] forwarded=downloaded(release);
            require(((Boolean)forwarded[2]).booleanValue()&&"".equals(forwarded[1]),"Forwarded update origin rejected: "+forwarded[1]);
            JSONObject telemetry=control("foreign");org.json.JSONArray received=telemetry.getJSONArray("downloads");
            JSONObject last=received.getJSONObject(received.length()-1);
            require("foreign".equals(last.getString("mode"))&&new URL(server).getAuthority().equals(last.getString("host")),"Download escaped configured Easyupdate origin");
            require("/api/v1/apps/com.easysmart.einform/releases/6/download".equals(last.getString("path")),"Wrong fixed download path");
            require(hash.equals(digest(verified)),"Alias download changed verified APK");
            for(String mode:new String[]{"scheme","path","versionpath","query","fragment","userinfo","relative","port","package","old","same"}){
                control(mode);check.invoke(updater);Object[] rejected=await();require(((String)rejected[1]).length()>0,"Invalid metadata accepted: "+mode);
                if("old".equals(mode)||"same".equals(mode))require("拒绝降级或重复安装".equals(rejected[1]),"Version guard was not the rejecting check: "+mode);
            }
            control("good");
            Method installerMethod=Class.forName("com.easysmart.einform.UpdateProvider").getDeclaredMethod("installerIntent",Context.class);installerMethod.setAccessible(true);
            Intent installer=((Intent)installerMethod.invoke(null,context)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            require(context.getPackageManager().resolveActivity(installer,0)!=null,"No system APK installer");
            context.startActivity(installer); // Opens confirmation only. The fixture is never installed.
            result.putString("stream","PASS API19 Easyupdate: v1 check/heartbeat, forwarded PublicURL rebased to configured same-origin download, future same-signature APK validation and content URI, SHA/size/signature/minSdk/redirect/invalid-scheme/path/version-path/query/fragment/userinfo/relative/port/wrong-package/downgrade/reinstall rejection, prior verified APK preservation; system installer confirmation opened without installing fixture\n");
            finish(Activity.RESULT_OK,result);
        }catch(Throwable exception){android.util.Log.e("EasyDesk.Checks","Update check failed",exception);result.putString("stream","FAIL: "+exception+"\n");finish(Activity.RESULT_CANCELED,result);}
        finally{if(updater!=null&&stop!=null)try{stop.invoke(updater);}catch(Exception ignored){}}
    }
    private JSONObject checked()throws Exception{check.invoke(updater);Object[] result=await();require("".equals(result[1]),"Check failed: "+result[1]);return (JSONObject)result[0];}
    private Object[] downloaded(JSONObject release)throws Exception{download.invoke(updater,release);return await();}
    private Object[] await()throws Exception{long deadline=SystemClock.elapsedRealtime()+30000;synchronized(results){while(results.isEmpty()&&SystemClock.elapsedRealtime()<deadline)results.wait(200);require(!results.isEmpty(),"Updater callback timed out");return results.remove(0);}}
    private JSONObject control(String mode)throws Exception{HttpURLConnection connection=(HttpURLConnection)new URL(server+"/control?mode="+mode).openConnection();connection.setConnectTimeout(5000);connection.setReadTimeout(5000);try{java.io.InputStream input=connection.getInputStream();java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[4096];int count;try{while((count=input.read(buffer))!=-1)bytes.write(buffer,0,count);}finally{input.close();}return new JSONObject(bytes.toString("UTF-8"));}finally{connection.disconnect();}}
    private static String digest(File file)throws Exception{MessageDigest hash=MessageDigest.getInstance("SHA-256");FileInputStream input=new FileInputStream(file);try{byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1)hash.update(buffer,0,count);}finally{input.close();}StringBuilder value=new StringBuilder();for(byte b:hash.digest())value.append(String.format("%02x",b&255));return value.toString();}
    private static void require(boolean condition,String message)throws Exception{if(!condition)throw new Exception(message);}
}
