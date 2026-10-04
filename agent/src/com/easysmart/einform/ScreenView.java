package com.easysmart.einform;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.View;
import com.easysmart.einform.core.RefreshSequence;

final class ScreenView extends View {
    interface Controls { void refresh(boolean force); void settings(); }
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final GestureDetector gestures;
    private final float density;
    private Bitmap bitmap;
    private RefreshSequence.Frame frame = RefreshSequence.Frame.PAGE;
    private Runnable painted;
    private String status = "点击左下角设置连接";
    private String diagnostics = "";
    private boolean cleaning;
    ScreenView(Context context, final Controls controls) {
        super(context); density = getResources().getDisplayMetrics().density;
        gestures = new GestureDetector(context, new GestureDetector.SimpleOnGestureListener() {
            public boolean onDown(MotionEvent event) { return true; }
            public boolean onSingleTapUp(MotionEvent event) {
                if (!cleaning && event.getX() > getWidth() - dp(100) && event.getY() < dp(70)) controls.refresh(false);
                else if (!cleaning && event.getX() < dp(100) && event.getY() > getHeight() - dp(60)) controls.settings();
                return true;
            }
            public void onLongPress(MotionEvent event) {
                if (!cleaning && event.getX() > getWidth() - dp(100) && event.getY() < dp(70)) controls.refresh(true);
                else if (!cleaning) controls.settings();
            }
        });
    }
    void show(Bitmap image, RefreshSequence.Frame value, boolean busy, Runnable callback) {
        bitmap = image; frame = value; cleaning = busy; painted = callback; invalidate();
    }
    void status(String value) { status = value; if (!cleaning) invalidate(); }
    boolean waiting() { return bitmap == null || bitmap.isRecycled(); }
    void diagnostics(String value) { diagnostics = value; if (waiting() && !cleaning) invalidate(); }
    protected void onDraw(Canvas canvas) {
        canvas.drawColor(frame == RefreshSequence.Frame.BLACK ? Color.BLACK : Color.WHITE);
        paint.setColor(Color.BLACK);
        if (frame == RefreshSequence.Frame.PROMPT) {
            paint.setTextAlign(Paint.Align.CENTER); paint.setTextSize(dp(30)); paint.setFakeBoldText(true);
            canvas.drawText("请稍后", getWidth()/2f, getHeight()/2f - dp(40), paint);
            paint.setTextSize(dp(22)); paint.setFakeBoldText(false);
            canvas.drawText("系统正在清洁显示屏……", getWidth()/2f, getHeight()/2f + dp(10), paint);
            paint.setTextSize(dp(14)); canvas.drawText("EasyDesk Einform", getWidth()/2f, getHeight()/2f + dp(55), paint);
        } else if (frame == RefreshSequence.Frame.PAGE) {
            if (bitmap != null && !bitmap.isRecycled()) {
                float scale = Math.min((float)getWidth()/bitmap.getWidth(), (float)getHeight()/bitmap.getHeight());
                float width = bitmap.getWidth()*scale, height = bitmap.getHeight()*scale;
                canvas.drawBitmap(bitmap, null, new RectF((getWidth()-width)/2f, (getHeight()-height)/2f, (getWidth()+width)/2f, (getHeight()+height)/2f), paint);
            } else {
                paint.setTextAlign(Paint.Align.LEFT); paint.setTextSize(dp(26)); paint.setFakeBoldText(true);
                float y = wrapped(canvas, "请稍事等待，服务器正在准备今日信息......", dp(28), dp(115), getWidth()-dp(56), dp(38));
                paint.setFakeBoldText(false); paint.setTextSize(dp(16));
                y += dp(24);
                for (String line : diagnostics.split("\n")) {
                    y = wrapped(canvas, line, dp(28), y, getWidth()-dp(56), dp(26));
                    if (y > getHeight()-dp(60)) break;
                }
            }
            {
                paint.setColor(Color.WHITE); canvas.drawRect(getWidth()-dp(78), dp(3), getWidth()-dp(3), dp(43), paint);
                paint.setColor(Color.BLACK); paint.setStyle(Paint.Style.STROKE);
                canvas.drawRect(getWidth()-dp(78), dp(3), getWidth()-dp(3), dp(43), paint); paint.setStyle(Paint.Style.FILL);
                paint.setTextAlign(Paint.Align.CENTER); paint.setTextSize(dp(16));
                canvas.drawText("刷新", getWidth()-dp(40), dp(29), paint);
                paint.setColor(Color.WHITE); canvas.drawRect(0, getHeight()-dp(31), getWidth(), getHeight(), paint);
                paint.setColor(Color.BLACK); paint.setTextAlign(Paint.Align.LEFT); paint.setTextSize(dp(12));
                canvas.drawText("设置", dp(8), getHeight()-dp(11), paint);
                canvas.drawText(status, dp(60), getHeight()-dp(11), paint);
            }
        }
        if (painted != null) {
            Runnable callback = painted; painted = null;
            android.util.Log.i("EasyDesk.Display", "painted " + frame.name());
            post(callback);
        }
    }
    public boolean onTouchEvent(MotionEvent event) { return gestures.onTouchEvent(event); }
    private float wrapped(Canvas canvas, String text, float x, float y, float width, float lineHeight) {
        int offset = 0;
        while (offset < text.length() && y < getHeight()-dp(40)) {
            int count = Math.max(1, paint.breakText(text, offset, text.length(), true, Math.max(1,width), null));
            canvas.drawText(text, offset, offset+count, x, y, paint);
            offset += count; y += lineHeight;
        }
        return y;
    }
    private float dp(float value) { return value*density; }
}
