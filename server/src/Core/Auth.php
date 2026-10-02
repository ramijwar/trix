<?php
declare(strict_types=1);

namespace Trix\Core;

/** إدارة الحسابات والجلسات */
final class Auth
{
    private static ?array $user = null;

    /** تصفير حالة الجلسة المحفوظة (يستخدمه جسر التطوير المحلي) */
    public static function resetRequestState(): void
    {
        self::$user = null;
    }

    /** تسجيل حساب جديد */
    public static function register(string $username, string $password, string $displayName = '', string $avatar = '😎'): array
    {
        $username = trim($username);
        if (!preg_match('/^[a-zA-Z0-9_.\-]{3,20}$/', $username)) {
            Http::fail('اسم المستخدم يجب أن يكون بين 3 و20 حرفاً إنجليزياً أو أرقاماً بدون مسافات', 422, 'bad_username');
        }
        if (mb_strlen($password) < 6) {
            Http::fail('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 422, 'weak_password');
        }
        $exists = Db::value('SELECT id FROM users WHERE username = ?', [$username]);
        if ($exists) {
            Http::fail('اسم المستخدم محجوز، جرّب اسماً آخر', 409, 'username_taken');
        }
        if ($displayName === '') {
            $displayName = $username;
        }
        $now = time();
        $id = Db::insert('users', [
            'username' => $username,
            'display_name' => mb_substr($displayName, 0, 24),
            'pass_hash' => password_hash($password, PASSWORD_BCRYPT),
            'avatar' => $avatar,
            'coins' => 500,
            'xp' => 0,
            'level' => 1,
            'is_guest' => 0,
            'created_at' => $now,
            'last_seen' => $now,
        ]);
        return self::issueToken((int) $id);
    }

    /** دخول سريع كزائر (بدون كلمة مرور) */
    public static function guest(string $deviceId = ''): array
    {
        if (!Config::get('guest_enabled', true)) {
            Http::fail('الدخول كزائر غير متاح حالياً', 403, 'guest_disabled');
        }
        $now = time();
        $suffix = strtoupper(substr(bin2hex(random_bytes(3)), 0, 5));
        $names = ['ضيف', 'لاعب', 'زائر', 'رفيق'];
        $display = $names[array_rand($names)] . ' ' . $suffix;
        $username = 'guest_' . strtolower(bin2hex(random_bytes(5)));
        $id = Db::insert('users', [
            'username' => $username,
            'display_name' => $display,
            'pass_hash' => '',
            'avatar' => ['😎', '🦊', '🐯', '🐬', '🦅', '🌸'][array_rand([0, 1, 2, 3, 4, 5])],
            'coins' => 500,
            'is_guest' => 1,
            'created_at' => $now,
            'last_seen' => $now,
        ]);
        return self::issueToken((int) $id, $deviceId);
    }

    public static function login(string $username, string $password, string $deviceId = ''): array
    {
        $user = Db::one('SELECT * FROM users WHERE username = ?', [trim($username)]);
        if (!$user || $user['pass_hash'] === '' || !password_verify($password, (string) $user['pass_hash'])) {
            Http::fail('اسم المستخدم أو كلمة المرور غير صحيحة', 401, 'bad_credentials');
        }
        Db::update('users', ['last_seen' => time()], 'id = ?', [$user['id']]);
        return self::issueToken((int) $user['id'], $deviceId);
    }

    /** إنشاء توكِن جلسة وإرجاع بيانات المستخدم */
    private static function issueToken(int $userId, string $device = ''): array
    {
        $token = bin2hex(random_bytes(32));
        $now = time();
        $ttl = (int) Config::get('token_ttl_days', 60) * 86400;
        Db::insert('sessions', [
            'token' => $token,
            'user_id' => $userId,
            'created_at' => $now,
            'expires_at' => $now + $ttl,
            'device' => mb_substr($device, 0, 60),
        ]);
        $user = Users::find($userId);
        return ['token' => $token, 'user' => Users::publicProfile($user)];
    }

    /** المستخدم الحالي من التوكِن أو null */
    public static function user(): ?array
    {
        if (self::$user !== null) {
            return self::$user;
        }
        $token = Http::bearer();
        if ($token === null || strlen($token) < 20) {
            return null;
        }
        $row = Db::one(
            'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?',
            [$token, time()]
        );
        if (!$row) {
            return null;
        }
        /*
         * ترقية تلقائية لمن اسمه ضمن أسماء المديرين في config.php
         * (مسؤول اللعبة لا يحتاج تدخلاً يدوياً في قاعدة البيانات).
         */
        if (empty($row['is_admin'])) {
            foreach ((array) Config::get('admin_users', ['admin']) as $n) {
                if (strcasecmp(trim((string) $n), (string) $row['username']) === 0) {
                    Db::exec('UPDATE users SET is_admin = 1 WHERE id = ?', [(int) $row['id']]);
                    $row['is_admin'] = 1;
                    break;
                }
            }
        }
        self::$user = $row;
        return $row;
    }

    /** يتطلب تسجيل دخول */
    public static function requireUser(): array
    {
        $u = self::user();
        if ($u === null) {
            Http::fail('الجلسة منتهية، سجّل الدخول من جديد', 401, 'unauthenticated');
        }
        if (!empty($u['is_banned'])) {
            Http::fail('تم إيقاف حسابك، راجع إدارة اللعبة', 403, 'banned');
        }
        Db::update('users', ['last_seen' => time()], 'id = ?', [$u['id']]);
        return $u;
    }

    public static function logout(): void
    {
        $token = Http::bearer();
        if ($token !== null) {
            Db::exec('DELETE FROM sessions WHERE token = ?', [$token]);
        }
        self::$user = null;
    }

    /** تنظيف الجلسات المنتهية */
    public static function prune(): void
    {
        Db::exec('DELETE FROM sessions WHERE expires_at < ?', [time()]);
    }
}
