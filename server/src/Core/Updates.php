<?php
declare(strict_types=1);

namespace Trix\Core;

/**
 * تحديث التطبيق من داخله (OTA)
 * ------------------------------------------------------------------
 * • المدير يرفع ملف APK جديد من لوحة التحكم على شكل أجزاء (chunks) صغيرة
 *   حتى يعمل الرفع على أي استضافة (بدون الحاجة إلى رفع ملفات كبيرة في طلب واحد).
 * • يُخزَّن الملف في data/apk (محمي بـ .htaccess) ويُقدَّم عبر مسار app/apk.
 * • كل لاعب يتحقق عند فتح التطبيق: app/version بمقارنة رقم نسخته برقم النسخة
 *   المنشورة → رسالة تحديث، وإجبارية إن كانت مفعّلة أو إن كانت نسخته أقدم من
 *   الحد الأدنى المدعوم.
 * • يُسجَّل لكل لاعب أنه رأى إشعار النسخة (users.apk_seen_code) ليظهر للمدير
 *   تقرير من لم يُحدِّث بعد.
 */
final class Updates
{
    /** أقصى حجم لملف APK مسموح (٢٠٠ ميجابايت) */
    public const MAX_BYTES = 209715200;
    /** أقصى حجم للجزء الواحد بعد فك الترميز (٢ ميجابايت) */
    public const CHUNK_MAX = 2097152;
    /** عدد الأجزاء الأقصى */
    public const MAX_CHUNKS = 4000;

    /** مفاتيح الإعدادات داخل جدول meta */
    private const KEYS = [
        'apk_version_code',
        'apk_version_name',
        'apk_notes',
        'apk_forced',
        'apk_min_code',
        'apk_size',
        'apk_sha256',
        'apk_file',
        'apk_url',
        'apk_package',
        'apk_updated_at',
        'apk_upload',
    ];

    /* ============================ التخزين ============================ */

    public static function dir(): string
    {
        $base = (string) Config::get('data_dir', TRIX_ROOT . '/data');
        $dir = rtrim($base, '/\\') . '/apk';
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        return $dir;
    }

    private static function chunksDir(): string
    {
        $dir = self::dir() . '/chunks';
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        return $dir;
    }

    /** حماية المجلد من الوصول المباشر (في حال كان الخادم لا يمنع المجلدات) */
    private static function guard(array $dirs): void
    {
        $ht = "# منع الوصول المباشر إلى ملفات التحديث\n<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n";
        foreach ($dirs as $dir) {
            $file = rtrim($dir, '/') . '/.htaccess';
            if (!is_file($file)) {
                @file_put_contents($file, $ht);
            }
        }
        $index = $dirs[0] ?? '';
        if ($index !== '' && !is_file($index . '/index.html')) {
            @file_put_contents($index . '/index.html', '');
        }
    }

    /* ============================ الإعدادات ============================ */

    /** كل الإعدادات المخزّنة (مع القيم الافتراضية) */
    public static function settings(): array
    {
        $rows = Db::all('SELECT k, v FROM meta');
        $map = [];
        foreach ($rows as $r) {
            $map[(string) $r['k']] = (string) $r['v'];
        }
        $upload = [];
        if (!empty($map['apk_upload'])) {
            $decoded = json_decode($map['apk_upload'], true);
            if (is_array($decoded)) {
                $upload = $decoded;
            }
        }
        return [
            'versionCode' => (int) ($map['apk_version_code'] ?? 0),
            'versionName' => (string) ($map['apk_version_name'] ?? ''),
            'notes' => (string) ($map['apk_notes'] ?? ''),
            'forced' => (int) ($map['apk_forced'] ?? 0) === 1,
            'minCode' => (int) ($map['apk_min_code'] ?? 0),
            'size' => (int) ($map['apk_size'] ?? 0),
            'sha256' => (string) ($map['apk_sha256'] ?? ''),
            'file' => (string) ($map['apk_file'] ?? ''),
            'url' => (string) ($map['apk_url'] ?? ''),
            'package' => (string) ($map['apk_package'] ?? 'com.trix.game'),
            'updatedAt' => (int) ($map['apk_updated_at'] ?? 0),
            'upload' => $upload,
        ];
    }

    /** حفظ إعدادات النسخة (المدير) */
    public static function save(array $data): array
    {
        $current = self::settings();
        $patch = [
            'apk_version_code' => isset($data['versionCode']) ? max(0, (int) $data['versionCode']) : $current['versionCode'],
            'apk_version_name' => isset($data['versionName']) ? mb_substr(trim((string) $data['versionName']), 0, 40) : $current['versionName'],
            'apk_notes' => isset($data['notes']) ? mb_substr(trim((string) $data['notes']), 0, 2000) : $current['notes'],
            'apk_forced' => array_key_exists('forced', $data) ? ((bool) $data['forced'] ? 1 : 0) : ($current['forced'] ? 1 : 0),
            'apk_min_code' => isset($data['minCode']) ? max(0, (int) $data['minCode']) : $current['minCode'],
            'apk_url' => isset($data['url']) ? mb_substr(trim((string) $data['url']), 0, 500) : $current['url'],
            'apk_package' => isset($data['package']) ? mb_substr(trim((string) $data['package']), 0, 80) : $current['package'],
            'apk_updated_at' => time(),
        ];
        // الحد الأدنى لا يمكن أن يتجاوز رقم النسخة المنشورة
        if ($patch['apk_min_code'] > $patch['apk_version_code']) {
            $patch['apk_min_code'] = $patch['apk_version_code'];
        }
        foreach ($patch as $k => $v) {
            Db::exec('INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)', [$k, (string) $v]);
        }
        return self::settings();
    }

    /* ============================ رفع الأجزاء ============================ */

    /** بدء جلسة رفع: يُعيد معرّف الجلسة وعدد الأجزاء المتوقع */
    public static function uploadStart(array $data, int $adminId): array
    {
        $size = (int) ($data['size'] ?? 0);
        if ($size <= 0) {
            Http::fail('حجم الملف غير صالح', 422, 'bad_size');
        }
        if ($size > self::MAX_BYTES) {
            Http::fail('الملف أكبر من الحد المسموح (' . (int) (self::MAX_BYTES / 1048576) . ' ميجابايت)', 422, 'too_large');
        }
        $total = (int) ($data['total'] ?? 0);
        if ($total <= 0 || $total > self::MAX_CHUNKS) {
            Http::fail('عدد الأجزاء غير صالح', 422, 'bad_total');
        }
        $versionCode = (int) ($data['versionCode'] ?? 0);
        $versionName = mb_substr(trim((string) ($data['versionName'] ?? '')), 0, 40);
        if ($versionCode <= 0) {
            Http::fail('رقم النسخة مطلوب (مثلاً 2)', 422, 'bad_version');
        }
        if ($versionName === '') {
            // نشتقّ الاسم تلقائياً من رقم النسخة إن لم يُذكر
            $versionName = '1.0.' . max(0, $versionCode - 1);
        }

        self::cleanupStaleChunks();
        $uploadId = bin2hex(random_bytes(8));
        $session = [
            'id' => $uploadId,
            'size' => $size,
            'total' => $total,
            'received' => 0,
            'bytes' => 0,
            'versionCode' => $versionCode,
            'versionName' => $versionName,
            'sha256' => strtolower(trim((string) ($data['sha256'] ?? ''))),
            'startedAt' => time(),
            'by' => $adminId,
        ];
        self::guard([self::dir(), self::chunksDir()]);
        Db::exec('INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)', ['apk_upload', json_encode($session, JSON_UNESCAPED_UNICODE)]);
        return $session;
    }

    /** استلام جزء واحد (base64) وكتابته على القرص */
    public static function uploadChunk(string $uploadId, int $index, string $b64): array
    {
        $session = self::session($uploadId);
        if ($index < 0 || $index >= (int) $session['total']) {
            Http::fail('رقم الجزء خارج الحدود', 422, 'bad_index');
        }
        $bin = base64_decode(str_replace([' ', "\n", "\r", "\t"], '', $b64), true);
        if (!is_string($bin) || $bin === '') {
            Http::fail('الجزء فارغ أو غير صالح', 422, 'bad_chunk');
        }
        if (strlen($bin) > self::CHUNK_MAX) {
            Http::fail('حجم الجزء كبير جداً', 422, 'chunk_too_large');
        }
        $path = self::chunksDir() . '/' . $uploadId . '_' . str_pad((string) $index, 6, '0', STR_PAD_LEFT) . '.bin';
        if (@file_put_contents($path, $bin, LOCK_EX) === false) {
            Http::fail('تعذّر تخزين الجزء على الخادم (تحقّق من صلاحيات مجلد data)', 500, 'write_failed');
        }
        $files = glob(self::chunksDir() . '/' . $uploadId . '_*.bin') ?: [];
        $bytes = 0;
        foreach ($files as $f) {
            $bytes += (int) @filesize($f);
        }
        $session['received'] = count($files);
        $session['bytes'] = $bytes;
        Db::exec('INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)', ['apk_upload', json_encode($session, JSON_UNESCAPED_UNICODE)]);
        return $session;
    }

    /** دمج الأجزاء وتثبيت النسخة الجديدة */
    public static function uploadFinish(string $uploadId): array
    {
        $session = self::session($uploadId);
        $files = glob(self::chunksDir() . '/' . $uploadId . '_*.bin') ?: [];
        sort($files, SORT_STRING);
        if (count($files) !== (int) $session['total']) {
            Http::fail(
                'لم تصل كل الأجزاء: ' . count($files) . ' من ' . (int) $session['total'],
                422,
                'incomplete'
            );
        }
        if (count($files) === 0) {
            Http::fail('لا توجد أجزاء', 422, 'no_chunks');
        }
        self::guard([self::dir(), self::chunksDir()]);
        $target = self::dir() . '/app-' . (int) $session['versionCode'] . '.apk';
        $tmp = $target . '.part';
        $out = @fopen($tmp, 'wb');
        if ($out === false) {
            Http::fail('تعذّر إنشاء ملف النسخة الجديدة', 500, 'write_failed');
        }
        $hash = hash_init('sha256');
        $bytes = 0;
        foreach ($files as $f) {
            $in = @fopen($f, 'rb');
            if ($in === false) {
                fclose($out);
                @unlink($tmp);
                Http::fail('تعذّر قراءة أحد الأجزاء', 500, 'read_failed');
            }
            while (!feof($in)) {
                $buf = fread($in, 262144);
                if ($buf === false || $buf === '') {
                    break;
                }
                fwrite($out, $buf);
                hash_update($hash, $buf);
                $bytes += strlen($buf);
            }
            fclose($in);
        }
        fclose($out);
        $sha = hash_final($hash);

        if ($bytes !== (int) $session['size']) {
            @unlink($tmp);
            Http::fail('حجم الملف المرفوع لا يطابق المعلن (' . $bytes . ' ≠ ' . (int) $session['size'] . ')', 422, 'size_mismatch');
        }
        if ($session['sha256'] !== '' && $session['sha256'] !== $sha) {
            @unlink($tmp);
            Http::fail('بصمة الملف (SHA-256) لا تطابق الملف المرفوع', 422, 'hash_mismatch');
        }

        // ملف APK حقيقي؟ نتأكد من السجل المميّز للحزمة (PK\x03\x04)
        $magic = @file_get_contents($tmp, false, null, 0, 4);
        if ($magic !== "PK\x03\x04") {
            @unlink($tmp);
            Http::fail('الملف المرفوع ليس حزمة APK صالحة', 422, 'not_apk');
        }

        // إزالة النسخ القديمة ثم تثبيت الجديدة باسم ثابت
        foreach (glob(self::dir() . '/app-*.apk') ?: [] as $old) {
            @unlink($old);
        }
        $final = self::dir() . '/app-' . (int) $session['versionCode'] . '.apk';
        if (!@rename($tmp, $final)) {
            if (!@copy($tmp, $final)) {
                @unlink($tmp);
                Http::fail('تعذّر حفظ النسخة النهائية', 500, 'write_failed');
            }
            @unlink($tmp);
        }
        foreach ($files as $f) {
            @unlink($f);
        }

        $saved = self::save([
            'versionCode' => (int) $session['versionCode'],
            'versionName' => (string) $session['versionName'],
            'notes' => (string) ($session['notes'] ?? ''),
        ]);
        Db::exec('INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)', ['apk_size', (string) $bytes]);
        Db::exec('INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)', ['apk_sha256', $sha]);
        Db::exec('INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)', ['apk_file', basename($final)]);
        Db::exec('DELETE FROM meta WHERE k = ?', ['apk_upload']);

        return [
            'settings' => self::settings(),
            'file' => basename($final),
            'size' => $bytes,
            'sha256' => $sha,
        ];
    }

    /** إلغاء جلسة رفع جارية */
    public static function uploadCancel(string $uploadId): void
    {
        foreach (glob(self::chunksDir() . '/' . $uploadId . '_*.bin') ?: [] as $f) {
            @unlink($f);
        }
        $current = self::settings();
        if (($current['upload']['id'] ?? '') === $uploadId) {
            Db::exec('DELETE FROM meta WHERE k = ?', ['apk_upload']);
        }
    }

    private static function session(string $uploadId): array
    {
        $current = self::settings();
        $session = (array) ($current['upload'] ?? []);
        if ($uploadId === '' || ($session['id'] ?? '') !== $uploadId) {
            Http::fail('جلسة الرفع غير موجودة — أعد بدء الرفع', 404, 'upload_not_found');
        }
        return $session;
    }

    /** حذف أجزاء جلسات قديمة (أكثر من ١٢ ساعة) */
    private static function cleanupStaleChunks(): void
    {
        $now = time();
        foreach (glob(self::chunksDir() . '/*.bin') ?: [] as $f) {
            if ($now - (int) @filemtime($f) > 43200) {
                @unlink($f);
            }
        }
        $upload = self::settings()['upload'];
        if (!empty($upload['startedAt']) && $now - (int) $upload['startedAt'] > 43200) {
            self::uploadCancel((string) ($upload['id'] ?? ''));
        }
    }

    /* ============================ الحالة والتنزيل ============================ */

    /** مسار ملف APK المخزَّن (أو null) */
    public static function apkPath(): ?string
    {
        $s = self::settings();
        if ($s['file'] === '') {
            return null;
        }
        $path = self::dir() . '/' . basename((string) $s['file']);
        return is_file($path) ? $path : null;
    }

    /** حذف النسخة المخزَّنة */
    public static function deleteApk(): void
    {
        foreach (glob(self::dir() . '/app-*.apk') ?: [] as $f) {
            @unlink($f);
        }
        Db::exec('DELETE FROM meta WHERE k IN (?, ?, ?, ?)', ['apk_file', 'apk_size', 'apk_sha256', 'apk_upload']);
    }

    /** المعلومات العامة التي تُرسل للتطبيق */
    public static function publicInfo(): array
    {
        $s = self::settings();
        $hasFile = self::apkPath() !== null;
        $url = '';
        if ($hasFile) {
            $url = 'index.php?r=app/apk';
        } elseif ($s['url'] !== '' && preg_match('#^https?://#i', $s['url'])) {
            $url = $s['url'];
        }
        return [
            'versionCode' => $s['versionCode'],
            'versionName' => $s['versionName'],
            'notes' => $s['notes'],
            'forced' => $s['forced'],
            'minCode' => $s['minCode'],
            'size' => $s['size'],
            'url' => $url,
            'hasFile' => $hasFile,
            'package' => $s['package'],
            'updatedAt' => $s['updatedAt'],
        ];
    }

    /**
     * فحص التحديث لعميل معيّن.
     * @return array{update:bool, forced:bool, versionCode:int, ...}
     */
    public static function check(int $clientCode, ?int $userId = null): array
    {
        $info = self::publicInfo();
        $latest = (int) $info['versionCode'];
        $available = $latest > 0 && (string) $info['url'] !== '';
        $update = $available && $clientCode < $latest;
        $forced = $update && ($info['forced'] || ($info['minCode'] > 0 && $clientCode < (int) $info['minCode']));

        if ($userId !== null && $userId > 0) {
            // رقم النسخة المثبّتة لدى اللاعب (يُحدَّث مع كل فحص → أساس تقرير «من لم يُحدِّث»)
            Db::exec('UPDATE users SET apk_client_code = ? WHERE id = ?', [$clientCode, $userId]);
            if ($update) {
                // نسجّل أنه رأى إشعار النسخة الجديدة
                Db::exec('UPDATE users SET apk_seen_code = ?, apk_seen_at = ? WHERE id = ?', [$latest, time(), $userId]);
            }
        }

        return [
            'update' => $update,
            'forced' => $forced,
            'available' => $available,
            'versionCode' => $latest,
            'versionName' => (string) $info['versionName'],
            'notes' => (string) $info['notes'],
            'size' => (int) $info['size'],
            'url' => (string) $info['url'],
            'minCode' => (int) $info['minCode'],
            'clientCode' => $clientCode,
            'serverTime' => time(),
        ];
    }

    /* ============================ تقرير من لم يُحدِّث ============================ */

    public static function report(int $days = 30): array
    {
        $info = self::publicInfo();
        $latest = (int) $info['versionCode'];
        $since = time() - max(1, $days) * 86400;
        $active = (int) Db::value('SELECT COUNT(*) FROM users WHERE last_seen >= ? AND is_guest = 0', [$since]);
        // «حدَّث» = اللاعب فتح نسخة رقمها >= رقم النسخة المنشورة
        $updated = (int) Db::value(
            'SELECT COUNT(*) FROM users WHERE last_seen >= ? AND is_guest = 0 AND apk_client_code >= ?',
            [$since, $latest]
        );
        $rows = Db::all(
            'SELECT id, username, display_name, avatar, last_seen, apk_seen_code, apk_seen_at, apk_client_code,
                    CASE WHEN apk_seen_at = 0 THEN 0 ELSE 1 END AS asked
             FROM users
             WHERE last_seen >= ? AND is_guest = 0 AND apk_client_code < ?
             ORDER BY last_seen DESC LIMIT 100',
            [$since, $latest]
        );
        $users = [];
        foreach ($rows as $r) {
            $users[] = [
                'id' => (int) $r['id'],
                'username' => (string) $r['username'],
                'name' => (string) $r['display_name'],
                'avatar' => (string) $r['avatar'],
                'lastSeen' => (int) $r['last_seen'],
                'asked' => (int) $r['asked'] === 1,
                'seenCode' => (int) $r['apk_seen_code'],
                'clientCode' => (int) $r['apk_client_code'],
            ];
        }
        return [
            'latestCode' => $latest,
            'active' => $active,
            'updated' => $updated,
            'pending' => max(0, $active - $updated),
            'users' => $users,
            'days' => $days,
        ];
    }
}
