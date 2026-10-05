package com.easysmart.einform;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/** Shares only the verified APK through a temporary installer URI grant on API19. */
public final class UpdateProvider extends ContentProvider {
    static Intent installerIntent(Context context) throws FileNotFoundException {
        Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE).setDataAndType(Uri.parse("content://com.easysmart.einform.updates/apk"), "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION).putExtra(Intent.EXTRA_RETURN_RESULT, true);
        if (context.getPackageManager().resolveActivity(intent, 0) != null) return intent;
        // KitKat's stock installer accepts file:// only. Share the verified APK read-only,
        // leaving incoming.apk, preferences and PNG caches private and unmodified.
        File directory = new File(context.getFilesDir(), "updates"), file = new File(directory, "update.apk");
        if (!file.isFile() || !directory.setExecutable(true, false) || !file.setReadable(true, false))
            throw new FileNotFoundException("无法将已验证 APK 交给系统安装器");
        return intent.setDataAndType(Uri.fromFile(file), "application/vnd.android.package-archive");
    }
    public boolean onCreate() { return true; }
    private File apk(Uri uri) throws FileNotFoundException {
        if (!"com.easysmart.einform.updates".equals(uri.getAuthority()) || !"/apk".equals(uri.getPath()) || uri.getQuery() != null)
            throw new FileNotFoundException("Invalid update URI");
        File file = new File(getContext().getFilesDir(), "updates/update.apk");
        if (!file.isFile()) throw new FileNotFoundException("No verified update");
        return file;
    }
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read only");
        return ParcelFileDescriptor.open(apk(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    public String getType(Uri uri) { return "application/vnd.android.package-archive"; }
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        try {
            File file = apk(uri); String[] columns = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE} : projection;
            MatrixCursor cursor = new MatrixCursor(columns); Object[] row = new Object[columns.length];
            for (int i=0; i<columns.length; i++) row[i] = OpenableColumns.DISPLAY_NAME.equals(columns[i]) ? "EasyDesk-Einform-update.apk" : OpenableColumns.SIZE.equals(columns[i]) ? Long.valueOf(file.length()) : null;
            cursor.addRow(row); return cursor;
        } catch (FileNotFoundException exception) { return null; }
    }
    public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read only"); }
    public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException("Read only"); }
    public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException("Read only"); }
}
