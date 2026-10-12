package com.trix.game;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * مزوّد محتوى صغير (بلا أي مكتبات خارجية) لتسليم ملف الـ APK المُنزَّل
 * إلى مُثبِّت الحزم في أندرويد بشكل آمن.
 * ------------------------------------------------------------------
 * أندرويد يمنع تمرير مسار ملف (file://) بين التطبيقات منذ الإصدار ٧،
 * وهذا المزوّد يعطي رابطاً (content://) قابلاً للقراءة لهذا الملف وحده.
 */
public class ApkProvider extends ContentProvider {

    public static final String AUTHORITY = "com.trix.game.files";

    /** رابط المحتوى لملف التحديث */
    public static Uri uriFor(File file) {
        return Uri.parse("content://" + AUTHORITY + "/update/" + file.getName());
    }

    /** مجلد ملفات التحديث (خارجي إن أمكن وإلا داخلي — بلا حاجة لأي إذن) */
    public static File updateDir(Context ctx) {
        File dir = null;
        try {
            File base = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (base != null) {
                dir = new File(base, "apk");
            }
        } catch (Exception ignored) {
        }
        if (dir == null || (!dir.exists() && !dir.mkdirs())) {
            dir = new File(ctx.getFilesDir(), "apk");
            if (!dir.exists()) {
                dir.mkdirs();
            }
        }
        return dir;
    }

    /** استخراج الملف المطلوب من الرابط (لا يسمح بالخروج عن مجلد التحديثات) */
    private File fileFor(Uri uri) {
        if (uri == null || uri.getPathSegments() == null || uri.getPathSegments().size() < 2) {
            return null;
        }
        if (!"update".equals(uri.getPathSegments().get(0))) {
            return null;
        }
        String name = uri.getPathSegments().get(1);
        if (name.contains("/") || name.contains("..")) {
            return null;
        }
        Context ctx = getContext();
        if (ctx == null) {
            return null;
        }
        return new File(updateDir(ctx), name);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File f = fileFor(uri);
        if (f == null || !f.exists()) {
            return null;
        }
        String[] cols = projection != null && projection.length > 0
                ? projection
                : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor cursor = new MatrixCursor(cols, 1);
        MatrixCursor.RowBuilder row = cursor.newRow();
        for (String col : cols) {
            if (OpenableColumns.DISPLAY_NAME.equals(col)) {
                row.add(f.getName());
            } else if (OpenableColumns.SIZE.equals(col)) {
                row.add(f.length());
            } else {
                row.add(null);
            }
        }
        return cursor;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = fileFor(uri);
        if (f == null || !f.exists()) {
            throw new FileNotFoundException("ملف التحديث غير موجود");
        }
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
