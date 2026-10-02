<?php
/**
 * خادم طرنيب أونلاين — ملف التوجيه الرئيسي (Front Controller)
 * جميع طلبات الـ API تمر من هنا:  https://example.com/index.php?r=room/create
 * (يمكن أيضاً استخدام الروابط الجميلة /api/room/create إذا كان mod_rewrite مفعّلاً)
 */
declare(strict_types=1);

if (!defined('TRIX')) {
    define('TRIX', true);
}

require __DIR__ . '/src/bootstrap.php';

Trix\Api\Router::handle();
