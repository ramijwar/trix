<?php
declare(strict_types=1);

namespace Trix\Core;

/**
 * تخزين الرسائل الصوتية القصيرة في الدردشة
 * ------------------------------------------------------------------
 * • تُحفظ الملفات خارج قاعدة البيانات في مجلد data/voice (محمي بـ .htaccess)
 * • يُعاد الملف عبر مسار API (voice/get) بعد التحقق من تسجيل الدخول
 * • الحد الأقصى: 45 ثانية / ~600 كيلوبايت للمقطع
 */
final class Voice
{
    /** أقصى حجم للمقطع بعد فك الترميز (بايت) */
    public const MAX_BYTES = 614400;
    /** أقصى مدة مسموحة بالثواني */
    public const MAX_SECONDS = 45;

    /** أنواع الصوت المدعومة → امتداد الملف */
    private const TYPES = [
        'audio/webm' => 'webm',
        'audio/ogg' => 'ogg',
        'audio/opus' => 'opus',
        'audio/mp4' => 'm4a',
        'audio/aac' => 'aac',
        'audio/mpeg' => 'mp3',
        'audio/wav' => 'wav',
        'audio/x-wav' => 'wav',
    ];

    private const EXT_MIME = [
        'webm' => 'audio/webm',
        'ogg' => 'audio/ogg',
        'opus' => 'audio/ogg',
        'm4a' => 'audio/mp4',
        'aac' => 'audio/aac',
        'mp3' => 'audio/mpeg',
        'wav' => 'audio/wav',
    ];

    /** مجلد التخزين (يُنشأ عند الحاجة) */
    public static function dir(): string
    {
        $base = (string) Config::get('data_dir', TRIX_ROOT . '/data');
        $dir = rtrim($base, '/\\') . '/voice';
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        return $dir;
    }

    /** تحويل نوع MIME إلى امتداد مدعوم */
    public static function extOf(string $mime): string
    {
        $mime = strtolower(trim($mime));
        if (strpos($mime, ';') !== false) {
            $mime = trim(substr($mime, 0, (int) strpos($mime, ';')));
        }
        return self::TYPES[$mime] ?? 'webm';
    }

    /** نوع MIME المقابل لامتداد الملف */
    public static function mimeOf(string $ext): string
    {
        return self::EXT_MIME[strtolower($ext)] ?? 'application/octet-stream';
    }

    /**
     * حفظ مقطع صوتي (base64) وإرجاع معرّفه
     * @return array{id:string,mime:string,dur:int,bytes:int}
     */
    public static function save(string $base64, string $mime, int $duration): array
    {
        $clean = preg_replace('#^data:[^;]+;base64,#', '', trim($base64)) ?? '';
        $clean = str_replace(' ', '+', $clean);
        $raw = base64_decode($clean, true);
        if (!is_string($raw) || $raw === '') {
            Http::fail('المقطع الصوتي غير صالح', 422, 'bad_audio');
        }
        if (strlen($raw) > self::MAX_BYTES) {
            Http::fail('المقطع الصوتي كبير جداً', 413, 'audio_too_large');
        }
        $ext = self::extOf($mime);
        $id = bin2hex(random_bytes(16));
        $file = self::dir() . '/' . $id . '.' . $ext;
        if (@file_put_contents($file, $raw, LOCK_EX) === false) {
            Http::fail('تعذّر حفظ المقطع الصوتي', 500, 'voice_write_failed');
        }
        return [
            'id' => $id,
            'mime' => self::mimeOf($ext),
            'dur' => max(1, min(self::MAX_SECONDS, $duration)),
            'bytes' => strlen($raw),
        ];
    }

    /** مسار ملف مقطع صوتي (أو null إن كان المعرّف غير صالح) */
    public static function path(string $id): ?string
    {
        if (!preg_match('/^[a-f0-9]{32}$/', $id)) {
            return null;
        }
        foreach (array_keys(self::EXT_MIME) as $ext) {
            $file = self::dir() . '/' . $id . '.' . $ext;
            if (is_file($file)) {
                return $file;
            }
        }
        return null;
    }

    /** قراءة المقطع وإرجاعه base64 مع نوعه */
    public static function read(string $id): array
    {
        $file = self::path($id);
        if ($file === null) {
            Http::fail('المقطع الصوتي غير موجود', 404, 'voice_not_found');
        }
        $raw = (string) @file_get_contents($file);
        return [
            'audio' => base64_encode($raw),
            'mime' => self::mimeOf((string) pathinfo($file, PATHINFO_EXTENSION)),
            'bytes' => strlen($raw),
        ];
    }

    /** حذف المقاطع القديمة (تنظيف دوري) */
    public static function prune(int $maxAgeSeconds = 86400): void
    {
        $dir = self::dir();
        if (!is_dir($dir)) {
            return;
        }
        $limit = time() - $maxAgeSeconds;
        foreach ((array) @scandir($dir) as $entry) {
            if (!is_string($entry) || $entry === '.' || $entry === '..') {
                continue;
            }
            $file = $dir . '/' . $entry;
            if (is_file($file) && (int) @filemtime($file) < $limit) {
                @unlink($file);
            }
        }
    }
}
