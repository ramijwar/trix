<?php
/**
 * مثبّت خادم طرنيب أونلاين
 * ---------------------------------------------------------------
 * افتح هذا الملف مرة واحدة في المتصفح:  https://your-domain.com/trix/install.php
 * سيتحقق من المتطلبات، ينشئ قاعدة البيانات، ويولّد ملف config.php
 * ثم احذف الملف بعد الانتهاء (زر الحذف في الأسفل).
 */
declare(strict_types=1);

$root = __DIR__;
$dataDir = $root . '/data';
$configFile = $root . '/config.php';
$sampleFile = $root . '/config.sample.php';
$dbPath = $dataDir . '/trix.sqlite';
$logs = [];
$errors = [];
$done = false;

$phpOk = version_compare(PHP_VERSION, '8.0.0', '>=');
$sqliteOk = extension_loaded('pdo_sqlite');
$dataWritable = is_dir($dataDir) ? is_writable($dataDir) : is_writable($root);

if (!$phpOk) {
    $errors[] = 'إصدار PHP الحالي (' . PHP_VERSION . ') قديم. يحتاج الخادم إلى PHP 8.0 أو أحدث.';
}
if (!$sqliteOk) {
    $errors[] = 'إضافة pdo_sqlite غير مفعّلة. فعّلها من لوحة cPanel → Select PHP Version → Extensions.';
}
if (!$dataWritable) {
    $errors[] = 'مجلد data غير قابل للكتابة. غيّر الصلاحيات إلى 755 أو 775.';
}

// حذف الملف نفسه عند الطلب
if (isset($_GET['selfdestruct'])) {
    @unlink(__FILE__);
    header('Location: ./install.php?deleted=1');
    exit;
}

// تنفيذ التثبيت
if (($_GET['do'] ?? '') === 'install' && !$errors) {
    // 1) إنشاء مجلد البيانات
    if (!is_dir($dataDir)) {
        if (@mkdir($dataDir, 0755, true)) {
            $logs[] = 'تم إنشاء مجلد البيانات: data/';
        } else {
            $errors[] = 'تعذّر إنشاء مجلد data';
        }
    } else {
        $logs[] = 'مجلد البيانات موجود مسبقاً';
    }
    if (is_dir($dataDir)) {
        @mkdir($dataDir . '/locks', 0755, true);
        @mkdir($dataDir . '/backups', 0755, true);
    }

    // 2) توليد config.php
    if (!is_file($configFile)) {
        $sample = is_file($sampleFile) ? require $sampleFile : [];
        $sample['secret'] = bin2hex(random_bytes(24));
        $php = "<?php\n/**\n * ملف الإعدادات — تم توليده تلقائياً بواسطة install.php\n * التاريخ: " . date('Y-m-d H:i:s') . "\n */\nreturn " . var_export($sample, true) . ";\n";
        if (@file_put_contents($configFile, $php)) {
            $logs[] = 'تم توليد ملف config.php';
        } else {
            $errors[] = 'تعذّر إنشاء config.php — أنشئه يدوياً من config.sample.php';
        }
    } else {
        $logs[] = 'ملف config.php موجود مسبقاً (لم يتم تعديله)';
    }

    // 3) إنشاء الجداول
    if (!$errors) {
        try {
            require $root . '/src/bootstrap.php';
            \Trix\Core\Db::migrate();
            $version = \Trix\Core\Db::value("SELECT v FROM meta WHERE k = 'schema_version'");
            $logs[] = 'تم إنشاء قاعدة البيانات (إصدار المخطط: ' . $version . ')';
            $tables = \Trix\Core\Db::value("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'");
            $logs[] = 'عدد الجداول: ' . $tables;
            $done = true;
        } catch (\Throwable $e) {
            $errors[] = 'خطأ في إنشاء قاعدة البيانات: ' . $e->getMessage();
        }
    }
}

function h(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}
?>
<!doctype html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>تثبيت خادم طرنيب أونلاين</title>
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 24px; font-family: -apple-system, "Segoe UI", Tahoma, sans-serif; background: #0b1512; color: #e9f5ef; }
        .wrap { max-width: 760px; margin: 0 auto; }
        h1 { font-size: 26px; margin: 0 0 6px; }
        p.lead { color: #9fb8ae; margin: 0 0 22px; }
        .card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.09); border-radius: 16px; padding: 18px 20px; margin-bottom: 16px; }
        .row { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px dashed rgba(255,255,255,.08); }
        .row:last-child { border-bottom: 0; }
        .ok { color: #4ade80; font-weight: 700; }
        .bad { color: #f87171; font-weight: 700; }
        .warn { color: #fbbf24; font-weight: 700; }
        ul { margin: 10px 0 0; padding-inline-start: 20px; }
        li { margin-bottom: 6px; line-height: 1.7; }
        .btn { display: inline-block; background: linear-gradient(135deg, #d4af37, #b8860b); color: #16211d; text-decoration: none; font-weight: 800; padding: 12px 22px; border-radius: 12px; margin-top: 6px; }
        .btn2 { background: linear-gradient(135deg, #38bdf8, #0ea5e9); color: #06202b; }
        .btn3 { background: #1f2a26; color: #ffd8d8; border: 1px solid #7f1d1d; }
        code { background: rgba(255,255,255,.08); padding: 2px 6px; border-radius: 6px; direction: ltr; display: inline-block; }
        .box-err { background: rgba(248,113,113,.12); border-color: rgba(248,113,113,.4); }
        .box-ok { background: rgba(74,222,128,.1); border-color: rgba(74,222,128,.35); }
        small { color: #8aa39a; }
    </style>
</head>
<body>
<div class="wrap">
    <h1>🃏 تثبيت خادم طرنيب أونلاين</h1>
    <p class="lead">مثبّت قاعدة البيانات وملف الإعدادات على استضافة cPanel — خطوة واحدة.</p>

    <div class="card">
        <div class="row"><span>إصدار PHP</span><span class="<?= $phpOk ? 'ok' : 'bad' ?>"><?= h(PHP_VERSION) ?></span></div>
        <div class="row"><span>إضافة pdo_sqlite</span><span class="<?= $sqliteOk ? 'ok' : 'bad' ?>"><?= $sqliteOk ? 'مفعّلة' : 'غير مفعّلة' ?></span></div>
        <div class="row"><span>مجلد data قابل للكتابة</span><span class="<?= $dataWritable ? 'ok' : 'bad' ?>"><?= $dataWritable ? 'نعم' : 'لا' ?></span></div>
        <div class="row"><span>ملف config.php</span><span class="<?= is_file($configFile) ? 'ok' : 'warn' ?>"><?= is_file($configFile) ? 'موجود' : 'سيُولَّد الآن' ?></span></div>
        <div class="row"><span>قاعدة البيانات</span><span class="<?= is_file($dbPath) ? 'ok' : 'warn' ?>"><?= is_file($dbPath) ? 'موجودة' : 'ستُنشأ الآن' ?></span></div>
    </div>

    <?php if ($errors): ?>
        <div class="card box-err">
            <strong class="bad">تنبيهات يجب حلها قبل المتابعة:</strong>
            <ul><?php foreach ($errors as $e): ?><li><?= h($e) ?></li><?php endforeach; ?></ul>
        </div>
    <?php endif; ?>

    <?php if ($logs): ?>
        <div class="card box-ok">
            <strong class="ok">نتيجة التثبيت:</strong>
            <ul><?php foreach ($logs as $l): ?><li><?= h($l) ?></li><?php endforeach; ?></ul>
        </div>
    <?php endif; ?>

    <?php if ($done): ?>
        <div class="card box-ok">
            <strong class="ok">تم التثبيت بنجاح ✅</strong>
            <ul>
                <li>عنوان الـ API: <code><?= h((($_SERVER['REQUEST_SCHEME'] ?? 'https') . '://' . ($_SERVER['HTTP_HOST'] ?? 'your-domain.com') . rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/') . '/index.php')) ?></code></li>
                <li>جرّب الصحة: <a style="color:#7dd3fc" href="./index.php?r=health">index.php?r=health</a></li>
                <li>تطبيق الأندرويد مضمَّن بهذا العنوان مسبقاً — لا يحتاج أي إعداد.</li>
                <li><strong>مهم:</strong> احذف ملف install.php بعد الانتهاء.</li>
            </ul>
        </div>
        <a class="btn" href="./">🎮 افتح اللعبة</a>
        <a class="btn btn2" href="./index.php?r=health" target="_blank">اختبار الخادم</a>
        <a class="btn btn3" href="?selfdestruct=1" onclick="return confirm('حذف ملف التثبيت نهائياً؟')">حذف ملف التثبيت</a>
    <?php elseif (!$errors): ?>
        <a class="btn" href="?do=install">ابدأ التثبيت</a>
    <?php endif; ?>

    <p style="margin-top:22px"><small>ملاحظة: تأكد من أن مجلد <code>data</code> غير قابل للوصول من المتصفح (يحميه ملف .htaccess المرفق). إذا حاولت فتح <code>/data/trix.sqlite</code> مباشرة يجب أن تظهر لك صفحة ممنوعة 403.</small></p>
</div>
</body>
</html>
