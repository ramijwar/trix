<?php
declare(strict_types=1);

namespace Trix\Api;

use Trix\Core\Config;
use Trix\Core\Db;
use Trix\Core\Http;
use Trix\Core\Auth;
use Trix\Core\Updates;

/**
 * مسارات تحديث التطبيق
 * ------------------------------------------------------------------
 * عامة (لأي جهاز):
 *   app/version   → فحص وجود نسخة جديدة حسب رقم نسخة العميل
 *   app/apk       → تنزيل ملف APK المخزَّن
 * للمدير فقط:
 *   admin/update  • admin/update/settings  • admin/update/upload/start
 *   admin/update/upload/chunk  • admin/update/upload/finish  • admin/update/upload/cancel
 *   admin/update/delete (حذف النسخة المخزَّنة)
 */
final class UpdateApi
{
    /* ============================ عام ============================ */

    /** فحص التحديث — يعمل بلا تسجيل دخول (وإن وُجد التوكِن يُسجَّل أنه رأى الإشعار) */
    public static function version(): void
    {
        $client = Http::int('version_code', 0);
        if ($client <= 0 && Http::str('version_code') === '') {
            // بعض العملاء يرسلون الاسم فقط
            $client = Http::int('code', 0);
        }
        $user = Auth::user();
        $userId = $user !== null ? (int) $user['id'] : 0;
        $res = Updates::check($client, $userId > 0 ? $userId : null);
        Http::ok($res);
    }

    /** تنزيل ملف الـ APK (بلا محتوى حسّاس، لكن لا يكشفه إلا بعد وجود نسخة منشورة) */
    public static function apk(): void
    {
        $path = Updates::apkPath();
        if ($path === null) {
            Http::fail('لا توجد نسخة مخزَّنة على الخادم', 404, 'no_apk');
        }
        $settings = Updates::settings();
        $name = 'trix-' . ($settings['versionCode'] > 0 ? $settings['versionCode'] : 'update') . '.apk';
        $size = (int) @filesize($path);

        /*
         * في جسر التطوير المحلي (PHP-WASM) لا يمكن إرسال بيانات ثنائية،
         * فنُعيد الملف بترميز base64 عند طلب ذلك صراحةً (?b64=1).
         */
        if (defined('TRIX_DEV_THROW')) {
            $b64 = @base64_encode((string) @file_get_contents($path));
            Http::ok(['file' => $name, 'size' => $size, 'b64' => $b64]);
            return;
        }

        while (ob_get_level() > 0) {
            @ob_end_clean();
        }
        @set_time_limit(0);
        if (!headers_sent()) {
            http_response_code(200);
            header('Content-Type: application/vnd.android.package-archive');
            header('Content-Disposition: attachment; filename="' . $name . '"');
            header('Content-Length: ' . $size);
            header('Cache-Control: no-store, no-cache, must-revalidate');
            header('X-Content-Type-Options: nosniff');
        }
        $fp = @fopen($path, 'rb');
        if ($fp === false) {
            Http::fail('تعذّر قراءة ملف النسخة', 500, 'read_failed');
        }
        while (!feof($fp)) {
            $buf = fread($fp, 262144);
            if ($buf === false || $buf === '') {
                break;
            }
            echo $buf;
            @flush();
        }
        fclose($fp);
        exit;
    }

    /* ============================ لوحة المدير ============================ */

    /** حالة النسخة + تقرير من لم يُحدِّث */
    public static function state(): void
    {
        AdminApi::requireAdmin();
        $days = max(1, min(365, Http::int('days', 30)));
        Http::ok([
            'settings' => Updates::settings(),
            'report' => Updates::report($days),
            'uploading' => (array) (Updates::settings()['upload'] ?? []),
            'limits' => [
                'chunkBytes' => Updates::CHUNK_MAX,
                'maxBytes' => Updates::MAX_BYTES,
                'maxChunks' => Updates::MAX_CHUNKS,
            ],
            'installed' => [
                'code' => Http::int('version_code', 0),
                'name' => Http::str('version_name'),
                'platform' => Http::str('platform'),
            ],
        ]);
    }

    /** حفظ بيانات النسخة (الرقم/الاسم/الملاحظات/الإجباري/الحد الأدنى/رابط خارجي) */
    public static function settings(): void
    {
        AdminApi::requireAdmin();
        $saved = Updates::save([
            'versionCode' => Http::int('versionCode', -1) >= 0 ? Http::int('versionCode') : null,
            'versionName' => Http::input('versionName', null),
            'notes' => Http::input('notes', null),
            'forced' => Http::input('forced', null),
            'minCode' => Http::int('minCode', -1) >= 0 ? Http::int('minCode') : null,
            'url' => Http::input('url', null),
            'package' => Http::input('package', null),
        ]);
        Http::ok(['settings' => $saved]);
    }

    public static function uploadStart(): void
    {
        $admin = AdminApi::requireAdmin();
        $session = Updates::uploadStart(
            [
                'size' => Http::int('size', 0),
                'total' => Http::int('total', 0),
                'versionCode' => Http::int('versionCode', 0),
                'versionName' => Http::str('versionName'),
                'sha256' => Http::str('sha256'),
                'notes' => Http::str('notes'),
            ],
            (int) $admin['id']
        );
        Http::ok(['upload' => $session]);
    }

    public static function uploadChunk(): void
    {
        AdminApi::requireAdmin();
        $session = Updates::uploadChunk(
            Http::str('upload'),
            Http::int('index', -1),
            Http::str('data')
        );
        $total = max(1, (int) $session['total']);
        Http::ok([
            'upload' => $session,
            'percent' => (int) round(min(100, (int) $session['received'] * 100 / $total)),
        ]);
    }

    public static function uploadFinish(): void
    {
        AdminApi::requireAdmin();
        $res = Updates::uploadFinish(Http::str('upload'));
        Http::ok($res);
    }

    public static function uploadCancel(): void
    {
        AdminApi::requireAdmin();
        Updates::uploadCancel(Http::str('upload'));
        Http::ok(['settings' => Updates::settings()]);
    }

    /** حذف النسخة المخزَّنة (يبقى الرقم والملاحظات) */
    public static function remove(): void
    {
        AdminApi::requireAdmin();
        Updates::deleteApk();
        Http::ok(['settings' => Updates::settings()]);
    }

    /** نشر مباشر: المدير يعطّل النسخة تماماً (رقم النسخة = 0) */
    public static function disable(): void
    {
        AdminApi::requireAdmin();
        Updates::deleteApk();
        Db::exec('DELETE FROM meta WHERE k IN (?, ?, ?)', ['apk_version_code', 'apk_forced', 'apk_min_code']);
        Db::exec('DELETE FROM meta WHERE k = ?', ['apk_url']);
        Http::ok(['settings' => Updates::settings(), 'app' => (string) Config::get('app_name', '')]);
    }
}
