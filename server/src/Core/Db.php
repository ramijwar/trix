<?php
declare(strict_types=1);

namespace Trix\Core;

use PDO;
use PDOException;

/** اتصال قاعدة بيانات SQLite مع تهيئة مناسبة للتشغيل المتزامن */
final class Db
{
    private static ?PDO $pdo = null;
    private static bool $migrated = false;

    public static function conn(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }
        $path = (string) Config::get('db_path');
        $dir = dirname($path);
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        try {
            $pdo = new PDO('sqlite:' . $path, null, null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]);
        } catch (PDOException $e) {
            Http::fail('تعذّر فتح قاعدة البيانات: ' . $e->getMessage(), 500);
        }
        /*
         * إعدادات الأداء والتحمل.
         * ملاحظة: نستخدم journal_mode = TRUNCATE بدل WAL لأن WAL يحتاج ذاكرة مشتركة
         * قد لا تكون متاحة على بعض الاستضافات المشتركة أو داخل بيئات المحاكاة،
         * وTRUNCATE يعمل مع أي استضافة ويحافظ على سلامة البيانات مع عدة عمليات PHP.
         */
        try {
            $pdo->exec('PRAGMA journal_mode = TRUNCATE');
        } catch (\Throwable $e) {
            $pdo->exec('PRAGMA journal_mode = DELETE');
        }
        $pdo->exec('PRAGMA synchronous = NORMAL');
        $pdo->exec('PRAGMA busy_timeout = 8000');
        $pdo->exec('PRAGMA foreign_keys = ON');
        self::$pdo = $pdo;
        return $pdo;
    }

    /** إنشاء الجداول إن لم تكن موجودة */
    public static function migrate(): void
    {
        if (self::$migrated) {
            return;
        }
        $pdo = self::conn();
        foreach (Schema::statements() as $sql) {
            $pdo->exec($sql);
        }
        $pdo->prepare('INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)')->execute(['schema_version', (string) Schema::VERSION]);
        self::$migrated = true;
    }

    /** تنفيذ استعلام وإرجاع كل الصفوف */
    public static function all(string $sql, array $params = []): array
    {
        $st = self::conn()->prepare($sql);
        $st->execute($params);
        return $st->fetchAll();
    }

    /** صف واحد أو null */
    public static function one(string $sql, array $params = []): ?array
    {
        $st = self::conn()->prepare($sql);
        $st->execute($params);
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    /** قيمة واحدة */
    public static function value(string $sql, array $params = []): mixed
    {
        $st = self::conn()->prepare($sql);
        $st->execute($params);
        $v = $st->fetchColumn();
        return $v === false ? null : $v;
    }

    /** تنفيذ أمر وتعديل */
    public static function exec(string $sql, array $params = []): int
    {
        $st = self::conn()->prepare($sql);
        $st->execute($params);
        return $st->rowCount();
    }

    /** إدراج وإرجاع المعرّف */
    public static function insert(string $table, array $data): int
    {
        $cols = array_keys($data);
        $sql = 'INSERT INTO ' . $table . ' (' . implode(',', $cols) . ') VALUES (' . rtrim(str_repeat('?,', count($cols)), ',') . ')';
        self::exec($sql, array_values($data));
        return (int) self::conn()->lastInsertId();
    }

    /** تحديث صف */
    public static function update(string $table, array $data, string $where, array $params = []): int
    {
        $sets = [];
        $vals = [];
        foreach ($data as $k => $v) {
            $sets[] = $k . ' = ?';
            $vals[] = $v;
        }
        $sql = 'UPDATE ' . $table . ' SET ' . implode(', ', $sets) . ' WHERE ' . $where;
        return self::exec($sql, array_merge($vals, $params));
    }

    /** تنفيذ عملية داخل معاملة */
    public static function tx(callable $fn): mixed
    {
        $pdo = self::conn();
        $pdo->exec('BEGIN IMMEDIATE');
        try {
            $result = $fn($pdo);
            $pdo->exec('COMMIT');
            return $result;
        } catch (\Throwable $e) {
            @$pdo->exec('ROLLBACK');
            throw $e;
        }
    }

    /**
     * قفل حصري لملف (لمنع تعارض تعديل حالة الغرفة بين طلبات متزامنة)
     * @return resource
     */
    public static function lock(string $name, int $timeoutMs = 8000)
    {
        $dir = (string) Config::get('data_dir') . '/locks';
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        $fp = fopen($dir . '/' . preg_replace('/[^a-zA-Z0-9_.-]/', '_', $name) . '.lock', 'c');
        if ($fp === false) {
            Http::fail('تعذّر إنشاء قفل الغرفة', 500);
        }
        $start = microtime(true);
        while (!flock($fp, LOCK_EX | LOCK_NB)) {
            if ((microtime(true) - $start) * 1000 > $timeoutMs) {
                fclose($fp);
                Http::fail('الخادم مشغول، حاول مرة أخرى', 503);
            }
            usleep(25000);
        }
        return $fp;
    }

    public static function unlock($fp): void
    {
        if (is_resource($fp)) {
            flock($fp, LOCK_UN);
            fclose($fp);
        }
    }

    /** نسخة احتياطية سريعة للملف (تُستخدم قبل الترقيات) */
    public static function backup(): ?string
    {
        $path = (string) Config::get('db_path');
        if (!is_file($path)) {
            return null;
        }
        $dir = (string) Config::get('data_dir') . '/backups';
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        $target = $dir . '/trix-' . date('Ymd-His') . '.sqlite';
        return @copy($path, $target) ? $target : null;
    }
}
