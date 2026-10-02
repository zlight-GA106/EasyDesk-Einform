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
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.UUID;

public final class LiveChecks extends Instrumentation {
    private String base;
    private String uuid;
    public void onCreate(Bundle arguments){base=arguments.getString("server","http://10.0.2.2:8068");start();}
    public void onStart(){
        Bundle result=new Bundle();
        try{
            Context context=getTargetContext();context.stopService(new Intent(context,AgentService.class));
            uuid=UUID.randomUUID().toString();String identity=base+"|"+uuid;
            SharedPreferences preferences=context.getSharedPreferences("agent",Context.MODE_PRIVATE);
            preferences.edit().clear().putString("uuid",uuid).putString("server",base).putString("deviceId","Z9-LIVE-"+uuid.substring(0,6)).putString("siteId","Z9-LIVE")
                .putString("profile","").putBoolean("configured",true).putBoolean("clean",true).putBoolean("sound",true).putInt("dwell",700).commit();
            final MainActivity activity=(MainActivity)startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            long deadline=SystemClock.elapsedRealtime()+90000;
            while(preferences.getString("displayedRevision:"+identity,"").length()==0&&SystemClock.elapsedRealtime()<deadline)SystemClock.sleep(200);
            if(preferences.getString("displayedRevision:"+identity,"").length()==0)throw new Exception("Actual server PNG never reached display");
            get("/control?uuid="+uuid+"&force=1");runOnMainSync(new Runnable(){public void run(){activity.refresh(false);}});
            deadline=SystemClock.elapsedRealtime()+90000;
            while(!get("/control?uuid="+uuid).contains("\"status\":\"completed\"")&&SystemClock.elapsedRealtime()<deadline)SystemClock.sleep(300);
            if(!get("/control?uuid="+uuid).contains("\"status\":\"completed\""))throw new Exception("Actual server force_redraw ACK missing");
            result.putString("stream","PASS API19 actual backend: UUID heartbeat registration, native meta/PNG, default 700ms clean flow, forced redraw, completed server ACK\n");
            finish(Activity.RESULT_OK,result);
        }catch(Throwable exception){android.util.Log.e("EasyDesk.Checks","Actual server check failed",exception);result.putString("stream","FAIL: "+exception+"\n");finish(Activity.RESULT_CANCELED,result);}
    }
    private String get(String path)throws Exception{
        HttpURLConnection connection=(HttpURLConnection)new URL(base+path).openConnection();connection.setConnectTimeout(5000);connection.setReadTimeout(12000);
        try{java.io.InputStream input=connection.getInputStream();java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();
            try{byte[] buffer=new byte[4096];int count;while((count=input.read(buffer))!=-1)bytes.write(buffer,0,count);}finally{input.close();}return new String(bytes.toByteArray(),"UTF-8");
        }finally{connection.disconnect();}
    }
}
