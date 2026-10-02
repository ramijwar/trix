<?php
/**
 * جسر التطوير المحلي: يحوّل طلب HTTP (مكتوب في /request.json) إلى تنفيذ لخادم PHP الأصلي
 * ويحفظ الاستجابة في /response.json — يُستخدم من tools/dev/php-server.mjs فقط.
 */
declare(strict_types=1);

if (!defined('TRIX_DEV_THROW')) {
    define('TRIX_DEV_THROW', true);
}
if (!defined('TRIX')) {
    define('TRIX', true);
}

/*
 * تحميل كلاسات الخادم عند الحاجة.
 * بيئة PHP-WASM تُبقي العملية نفسها بين الطلبات، لذلك نتأكد من وجود الكلاسات فعلياً
 * قبل تنفيذ bootstrap وإلا تُتخطّى require_once بدون تحميل الكلاس.
 */
$preload = [
    '/src/Core/Http.php' => 'Trix\Core\Http',
    '/src/Core/Config.php' => 'Trix\Core\Config',
    '/src/Core/Schema.php' => 'Trix\Core\Schema',
    '/src/Core/Db.php' => 'Trix\Core\Db',
    '/src/Core/Auth.php' => 'Trix\Core\Auth',
    '/src/Core/Users.php' => 'Trix\Core\Users',
    '/src/Core/Rooms.php' => 'Trix\Core\Rooms',
    '/src/Game/Engine.php' => 'Trix\Game\Engine',
    '/src/Api/AuthApi.php' => 'Trix\Api\AuthApi',
    '/src/Api/LobbyApi.php' => 'Trix\Api\LobbyApi',
    '/src/Api/RoomApi.php' => 'Trix\Api\RoomApi',
    '/src/Api/Router.php' => 'Trix\Api\Router',
];
foreach ($preload as $file => $class) {
    if (!class_exists($class) && is_file($file)) {
        require $file;
    }
}

// تصفير الحالة الثابتة لأن نفس العملية تُستخدم لكل الطلبات في بيئة التطوير
if (class_exists('Trix\Core\Http') && method_exists('Trix\Core\Http', 'resetRequestState')) {
    \Trix\Core\Http::resetRequestState();
}
if (class_exists('Trix\Core\Auth') && method_exists('Trix\Core\Auth', 'resetRequestState')) {
    \Trix\Core\Auth::resetRequestState();
}

@mkdir('/dev', 0777, true);
$request = json_decode((string) file_get_contents('/request.json'), true);
if (!is_array($request)) {
    file_put_contents('/response.json', json_encode(['code' => 500, 'data' => ['ok' => false, 'error' => 'bad request']]));
    return;
}

$_SERVER['REQUEST_METHOD'] = (string) ($request['method'] ?? 'GET');
$_SERVER['REQUEST_URI'] = (string) ($request['uri'] ?? '/');
$_SERVER['QUERY_STRING'] = (string) ($request['query'] ?? '');
$_SERVER['SCRIPT_NAME'] = '/index.php';
$_SERVER['SCRIPT_FILENAME'] = '/index.php';
$_SERVER['DOCUMENT_ROOT'] = '/';
$_SERVER['REQUEST_SCHEME'] = 'http';
$_SERVER['SERVER_PROTOCOL'] = 'HTTP/1.1';
$_SERVER['HTTP_HOST'] = (string) ($request['headers']['host'] ?? 'localhost');
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
foreach ((array) ($request['headers'] ?? []) as $key => $value) {
    $_SERVER['HTTP_' . strtoupper(str_replace('-', '_', (string) $key))] = $value;
}
$_GET = (array) ($request['get'] ?? []);
$_POST = (array) ($request['post'] ?? []);
$GLOBALS['TRIX_RAW_BODY'] = (string) ($request['body'] ?? '');

// سجل الطلبات للتطوير فقط
$logLine = '[' . date('H:i:s') . '] ' . $_SERVER['REQUEST_METHOD'] . ' ' . ($_GET['r'] ?? '-')
    . ' | ' . mb_substr((string) $GLOBALS['TRIX_RAW_BODY'], 0, 400) . "\n";
@file_put_contents('/dev/requests.log', $logLine, FILE_APPEND);

ob_start();
try {
    require '/index.php';
    $output = ob_get_clean();
    $response = $GLOBALS['__trix_response'] ?? ['code' => 200, 'data' => ['ok' => true, 'output' => $output]];
} catch (\Trix\Core\HttpExit $e) {
    ob_end_clean();
    $response = $GLOBALS['__trix_response'] ?? ['code' => 500, 'data' => ['ok' => false, 'error' => 'empty response']];
} catch (\Throwable $e) {
    if (ob_get_level() > 0) {
        ob_end_clean();
    }
    $response = ['code' => 500, 'data' => [
        'ok' => false,
        'error' => $e->getMessage(),
        'file' => $e->getFile() . ':' . $e->getLine(),
        'trace' => array_slice(explode("\n", $e->getTraceAsString()), 0, 8),
    ]];
}

file_put_contents('/response.json', json_encode($response, JSON_UNESCAPED_UNICODE));
echo 'BRIDGE_OK';
