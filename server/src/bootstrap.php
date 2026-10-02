<?php
/**
 * تهيئة الخادم: تحميل الإعدادات + التسجيل التلقائي للكلاسات + معالجة الأخطاء
 */
declare(strict_types=1);

if (!defined('TRIX')) {
    define('TRIX', true);
}

if (!defined('TRIX_ROOT')) {
    define('TRIX_ROOT', dirname(__DIR__));
}
if (!defined('TRIX_START')) {
    define('TRIX_START', microtime(true));
}

/*
 * مُحمِّل تلقائي لكل كلاسات الخادم (Trix\Foo\Bar  →  src/Foo/Bar.php)
 * مهم جداً على الاستضافة الحقيقية: لا نعتمد على تحميل مسبق من أي مكان،
 * فأي كلاس يُستخدم يُحمَّل من ملفه مباشرة (مع مراعاة حساسية حالة الأحرف في Linux).
 */
spl_autoload_register(static function (string $class): void {
    $prefix = 'Trix\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $relative = str_replace('\\', '/', substr($class, strlen($prefix)));
    if ($relative === '' || strpos($relative, '..') !== false) {
        return;
    }
    $file = __DIR__ . '/' . $relative . '.php';
    if (is_file($file)) {
        require_once $file;
    }
});

// ملاحظة: نستخدم require_once عادةً، وجسر التطوير المحلي يتكفّل بتحميل الكلاسات عند الحاجة
require_once __DIR__ . '/Core/Config.php';
require_once __DIR__ . '/Core/Http.php';
require_once __DIR__ . '/Core/Db.php';
require_once __DIR__ . '/Core/Auth.php';
require_once __DIR__ . '/Core/Schema.php';
require_once __DIR__ . '/Game/Engine.php';
require_once __DIR__ . '/Core/Rooms.php';
require_once __DIR__ . '/Core/Users.php';
require_once __DIR__ . '/Core/Tournaments.php';
require_once __DIR__ . '/Api/AdminApi.php';
require_once __DIR__ . '/Api/Router.php';

// تحميل الإعدادات
$configFile = TRIX_ROOT . '/config.php';
if (!is_file($configFile)) {
    $configFile = TRIX_ROOT . '/config.sample.php';
}
$config = require $configFile;
if (!is_array($config)) {
    $config = [];
}
$defaults = require TRIX_ROOT . '/config.sample.php';
$config = array_merge($defaults, $config);

\Trix\Core\Config::init($config);

// إظهار الأخطاء حسب الإعداد
if (\Trix\Core\Config::get('debug')) {
    error_reporting(E_ALL);
    ini_set('display_errors', '1');
} else {
    error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE);
    ini_set('display_errors', '0');
}

// منطقة زمنية موحّدة
date_default_timezone_set('UTC');

// منع انتهاء الوقت أثناء الانتظار الطويل
@set_time_limit(45);
@ini_set('max_execution_time', '45');
