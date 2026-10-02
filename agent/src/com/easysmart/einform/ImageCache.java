package com.easysmart.einform;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.AtomicFile;
import com.easysmart.einform.core.PngGuard;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.security.MessageDigest;

final class ImageCache {
    final File directory, png;
    String revision = "", etag = "";
    long syncedAt;
    ImageCache(File root, String identity) throws Exception {
        directory = new File(root, "display-" + hex(MessageDigest.getInstance("SHA-256").digest(identity.getBytes("UTF-8"))).substring(0, 24));
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create image cache");
        png = new File(directory, "last-good.png");
    }
    Bitmap load(int width, int height) throws Exception {
        AtomicFile file = new AtomicFile(png);
        // openRead recovers AtomicFile's previous valid version after interrupted replacement.
        FileInputStream recovery = file.openRead(); recovery.close();
        PngGuard.validate(png);
        Bitmap bitmap = decode(png, width, height);
        try {
            JSONObject metadata = new JSONObject(read(new AtomicFile(new File(directory, "last-good.json"))));
            if (metadata.optString("sha256").equals(digest(png))) {
                revision = metadata.optString("revision"); etag = metadata.optString("etag"); syncedAt = metadata.optLong("syncedAt");
            }
        } catch (Exception exception) {
            android.util.Log.w("EasyDesk.Storage", "Cache metadata unavailable; PNG will be revalidated with server", exception);
        }
        return bitmap;
    }
    void commit(File temporary, String nextRevision, String nextEtag) throws Exception {
        JSONObject metadata = new JSONObject();
        long time = System.currentTimeMillis();
        metadata.put("revision", nextRevision); metadata.put("etag", nextEtag); metadata.put("syncedAt", time); metadata.put("sha256", digest(temporary));
        AtomicFile file = new AtomicFile(png);
        FileOutputStream output = file.startWrite();
        try {
            FileInputStream input = new FileInputStream(temporary);
            try { byte[] buffer = new byte[8192]; int count; while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count); }
            finally { input.close(); }
            file.finishWrite(output);
        } catch (Exception exception) { file.failWrite(output); throw exception; }
        // If power fails between the two commits, the hash mismatch prevents a false "unchanged".
        AtomicFile info = new AtomicFile(new File(directory, "last-good.json"));
        output = info.startWrite();
        try { output.write(metadata.toString().getBytes("UTF-8")); info.finishWrite(output); }
        catch (Exception exception) { info.failWrite(output); revision = ""; etag = ""; throw exception; }
        revision = nextRevision; etag = nextEtag; syncedAt = time;
    }
    static Bitmap decode(File file, int width, int height) throws IOException {
        BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(file.getAbsolutePath(), bounds);
        if (bounds.outWidth < 1 || bounds.outHeight < 1) throw new IOException("PNG decode bounds failed");
        BitmapFactory.Options options = new BitmapFactory.Options(); options.inPreferredConfig = Bitmap.Config.RGB_565;
        options.inSampleSize = 1;
        while ((long)(bounds.outWidth / options.inSampleSize) * (bounds.outHeight / options.inSampleSize) > 2000000L
            || (bounds.outWidth / options.inSampleSize > width * 2 && bounds.outHeight / options.inSampleSize > height * 2)) options.inSampleSize *= 2;
        Bitmap result = BitmapFactory.decodeFile(file.getAbsolutePath(), options);
        if (result == null) throw new IOException("PNG decode failed");
        return result;
    }
    private static String read(AtomicFile file) throws IOException {
        FileInputStream input = file.openRead();
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) { if (bytes.size() + count > 16384) throw new IOException("Cache metadata too large"); bytes.write(buffer, 0, count); }
            return new String(bytes.toByteArray(), "UTF-8");
        } finally { input.close(); }
    }
    private static String digest(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256"); FileInputStream input = new FileInputStream(file);
        try { byte[] buffer = new byte[8192]; int count; while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count); }
        finally { input.close(); }
        return hex(digest.digest());
    }
    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte b : bytes) result.append(String.format(java.util.Locale.US, "%02x", b & 255));
        return result.toString();
    }
}
