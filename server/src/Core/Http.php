<?php
declare(strict_types=1);

namespace Trix\Core;

/** أدوات HTTP: JSON، الطلبات، الرؤوس، CORS */
final class Http
{
    private static ?array $body = null;

    /**
     * إعادة ضبط الذاكرة المؤقتة للطلب.
     * في الاستضافة العادية يُنفَّذ كل طلب في عملية مستقلة، أما في جسر التطوير المحلي
     * فتبقى العملية نفسها تعمل بين الطلبات، لذا يلزم تصفير الحالة الثابتة.
     */
    public static function resetRequestState(): void
    {
        self::$body = null;
    }

    /** رؤوس CORS — التطبيق يستخدم توكِن Bearer لذا لا نحتاج الكوكيز */
    public static function cors(): void
    {
        if (defined('TRIX_DEV_THROW')) {
            // داخل جسر التطوير المحلي لا توجد رؤوس حقيقية
            return;
        }
        $origins = (array) Config::get('allow_origins', ['*']);
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        if (in_array('*', $origins, true)) {
            header('Access-Control-Allow-Origin: *');
        } elseif ($origin !== '' && in_array($origin, $origins, true)) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Vary: Origin');
        } else {
            header('Access-Control-Allow-Origin: *');
        }
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
        header('Access-Control-Max-Age: 86400');
    }

    public static function json(mixed $data, int $code = 200): void
    {
        if (defined('TRIX_DEV_THROW')) {
            /*
             * جسر التطوير المحلي يعمل داخل PHP-WASM حيث لا يمكن إنهاء العملية بـ exit
             * لذا نرمي استثناءً يحمله الجسر ويحوّله إلى استجابة HTTP حقيقية.
             * هذا المسار لا يعمل في الاستضافة العادية إطلاقاً.
             */
            $GLOBALS['__trix_response'] = ['code' => $code, 'data' => $data];
            throw new HttpExit('response');
        }
        if (!headers_sent()) {
            http_response_code($code);
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: no-store, no-cache, must-revalidate');
            header('X-Content-Type-Options: nosniff');
        }
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
        exit;
    }

    public static function ok(array $data = []): void
    {
        self::json(array_merge(['ok' => true], $data));
    }

    public static function fail(string $message, int $code = 400, string $errorCode = 'error'): void
    {
        self::json(['ok' => false, 'error' => $message, 'code' => $errorCode], $code);
    }

    /** قراءة جسم الطلب (JSON أو نموذج عادي) */
    public static function body(): array
    {
        if (self::$body !== null) {
            return self::$body;
        }
        $raw = $GLOBALS['TRIX_RAW_BODY'] ?? file_get_contents('php://input');
        $data = [];
        if (is_string($raw) && $raw !== '') {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                $data = $decoded;
            } else {
                parse_str($raw, $parsed);
                if (is_array($parsed)) {
                    $data = $parsed;
                }
            }
        }
        if (!empty($_POST)) {
            $data = array_merge($data, $_POST);
        }
        self::$body = $data;
        return $data;
    }

    public static function input(string $key, mixed $default = null): mixed
    {
        $b = self::body();
        if (array_key_exists($key, $b)) {
            return $b[$key];
        }
        if (array_key_exists($key, $_GET)) {
            return $_GET[$key];
        }
        return $default;
    }

    public static function str(string $key, string $default = ''): string
    {
        $v = self::input($key, $default);
        return is_scalar($v) ? trim((string) $v) : $default;
    }

    public static function int(string $key, int $default = 0): int
    {
        $v = self::input($key, $default);
        return is_numeric($v) ? (int) $v : $default;
    }

    public static function bool(string $key, bool $default = false): bool
    {
        $v = self::input($key, $default);
        if (is_bool($v)) {
            return $v;
        }
        if (is_string($v)) {
            return in_array(strtolower($v), ['1', 'true', 'yes', 'on'], true);
        }
        return (bool) $v;
    }

    public static function bearer(): ?string
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if ($header === '' && function_exists('apache_request_headers')) {
            $headers = apache_request_headers();
            foreach ($headers as $k => $v) {
                if (strtolower($k) === 'authorization') {
                    $header = $v;
                    break;
                }
            }
        }
        if (preg_match('/Bearer\s+(.+)/i', (string) $header, $m)) {
            return trim($m[1]);
        }
        // بديل احتياطي لبعض الاستضافات التي تحذف الرأس
        $alt = self::str('token');
        return $alt !== '' ? $alt : null;
    }

    public static function method(): string
    {
        return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    }

    public static function clientIp(): string
    {
        return (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    }

    /** مسار الطلب: يدعم ?r=route و /index.php/route و /api/route */
    public static function route(): string
    {
        $r = self::str('r');
        if ($r !== '') {
            return trim($r, '/');
        }
        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
        $path = (string) parse_url($uri, PHP_URL_PATH);
        $path = preg_replace('#^.*?/api/#', '', $path) ?? $path;
        $path = preg_replace('#^.*?/index\.php/?#', '', $path) ?? $path;
        return trim((string) $path, '/');
    }
}

/** استثناء داخلي يُستخدم في جسر التطوير فقط (PHP-WASM) */
final class HttpExit extends \Exception
{
}
