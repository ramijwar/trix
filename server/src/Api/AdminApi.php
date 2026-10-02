<?php
declare(strict_types=1);

namespace Trix\Api;

use Trix\Core\Config;
use Trix\Core\Db;
use Trix\Core\Http;
use Trix\Core\Auth;
use Trix\Core\Tournaments;
use Trix\Core\Users;

/** لوحة تحكم المدير: المستخدمون، سجل اليوم، البطولات */
final class AdminApi
{
    /** المدير = is_admin في القاعدة أو اسم مستخدم مذكور في config.php */
    public static function requireAdmin(): array
    {
        $user = Auth::requireUser();
        if (self::isAdmin($user)) {
            return $user;
        }
        Http::fail('هذه الصفحة للمدير فقط', 403, 'not_admin');
    }

    public static function isAdmin(array $user): bool
    {
        if (!empty($user['is_admin'])) {
            return true;
        }
        $names = (array) Config::get('admin_users', ['admin']);
        foreach ($names as $n) {
            if (strcasecmp(trim((string) $n), (string) $user['username']) === 0) {
                // نثبّت الصلاحية في القاعدة
                Db::exec('UPDATE users SET is_admin = 1 WHERE id = ?', [(int) $user['id']]);
                return true;
            }
        }
        return false;
    }

    /* ============================ نظرة عامة ============================ */

    public static function stats(): void
    {
        self::requireAdmin();
        $today = strtotime('today 00:00:00') ?: (time() - 86400);
        Http::ok([
            'totals' => [
                'users' => (int) Db::value('SELECT COUNT(*) FROM users'),
                'online' => (int) Db::value('SELECT COUNT(*) FROM users WHERE last_seen >= ?', [time() - 300]),
                'todayUsers' => (int) Db::value('SELECT COUNT(*) FROM users WHERE last_seen >= ?', [$today]),
                'newUsersToday' => (int) Db::value('SELECT COUNT(*) FROM users WHERE created_at >= ?', [$today]),
                'rooms' => (int) Db::value('SELECT COUNT(*) FROM rooms'),
                'roomsToday' => (int) Db::value('SELECT COUNT(*) FROM rooms WHERE created_at >= ?', [$today]),
                'activeRooms' => (int) Db::value("SELECT COUNT(*) FROM rooms WHERE status != 'closed'"),
                'matches' => (int) Db::value('SELECT COUNT(*) FROM matches'),
                'matchesToday' => (int) Db::value('SELECT COUNT(*) FROM matches WHERE created_at >= ?', [$today]),
                'tournaments' => (int) Db::value('SELECT COUNT(*) FROM tournaments'),
                'openTournaments' => (int) Db::value("SELECT COUNT(*) FROM tournaments WHERE status IN ('registration','running')"),
            ],
            'dayStart' => $today,
        ]);
    }

    /** سجل اليوم: اللاعبون والطاولات */
    public static function today(): void
    {
        self::requireAdmin();
        Http::ok(['log' => Tournaments::todayLog()]);
    }

    /* ============================ المستخدمون ============================ */

    public static function users(): void
    {
        self::requireAdmin();
        $q = trim(Http::str('q'));
        $limit = max(1, min(200, Http::int('limit', 60)));
        if ($q !== '') {
            $like = '%' . $q . '%';
            $rows = Db::all(
                'SELECT * FROM users WHERE username LIKE ? OR display_name LIKE ? ORDER BY last_seen DESC LIMIT ' . $limit,
                [$like, $like]
            );
        } else {
            $rows = Db::all('SELECT * FROM users ORDER BY last_seen DESC LIMIT ' . $limit);
        }
        $out = [];
        foreach ($rows as $u) {
            $out[] = [
                'id' => (int) $u['id'],
                'username' => (string) $u['username'],
                'name' => (string) $u['display_name'],
                'avatar' => (string) $u['avatar'],
                'level' => (int) $u['level'],
                'coins' => (int) $u['coins'],
                'gamesPlayed' => (int) $u['games_played'],
                'gamesWon' => (int) $u['games_won'],
                'isGuest' => (bool) $u['is_guest'],
                'isAdmin' => (bool) $u['is_admin'],
                'banned' => (bool) (($u['is_banned'] ?? 0)),
                'createdAt' => (int) $u['created_at'],
                'lastSeen' => (int) $u['last_seen'],
            ];
        }
        Http::ok(['users' => $out]);
    }

    public static function userAction(): void
    {
        $admin = self::requireAdmin();
        $id = Http::int('id', 0);
        $action = Http::str('action');
        $target = Users::find($id);
        if ($target === null) {
            Http::fail('المستخدم غير موجود', 404, 'not_found');
        }
        switch ($action) {
            case 'coins':
                $amount = Http::int('amount', 0);
                Users::addCoins($id, $amount, 'admin', 'admin:' . (int) $admin['id']);
                break;
            case 'make_admin':
                Db::exec('UPDATE users SET is_admin = 1 WHERE id = ?', [$id]);
                break;
            case 'remove_admin':
                Db::exec('UPDATE users SET is_admin = 0 WHERE id = ?', [$id]);
                break;
            case 'ban':
                self::column('is_banned');
                Db::exec('UPDATE users SET is_banned = 1 WHERE id = ?', [$id]);
                break;
            case 'unban':
                self::column('is_banned');
                Db::exec('UPDATE users SET is_banned = 0 WHERE id = ?', [$id]);
                break;
            case 'delete':
                Db::exec('DELETE FROM sessions WHERE user_id = ?', [$id]);
                Db::exec('DELETE FROM users WHERE id = ?', [$id]);
                break;
            default:
                Http::fail('إجراء غير معروف', 422, 'bad_action');
        }
        Http::ok(['message' => 'تم التنفيذ']);
    }

    /** يضيف عموداً ناقصاً في جدول المستخدمين عند الحاجة */
    private static function column(string $name): void
    {
        static $done = [];
        if (isset($done[$name])) {
            return;
        }
        try {
            Db::exec("ALTER TABLE users ADD COLUMN $name INTEGER NOT NULL DEFAULT 0");
        } catch (\Throwable) {
            // موجود مسبقاً
        }
        $done[$name] = true;
    }

    /* ============================ البطولات ============================ */

    public static function tournaments(): void
    {
        $user = Auth::requireUser();
        if (self::isAdmin($user)) {
            Tournaments::sync();
        }
        $rows = Db::all('SELECT * FROM tournaments ORDER BY id DESC LIMIT 40');
        $out = [];
        foreach ($rows as $t) {
            $out[] = Tournaments::publicView($t, (int) $user['id']);
        }
        Http::ok(['tournaments' => $out, 'isAdmin' => self::isAdmin($user)]);
    }

    /** بطولات اللاعب (القائمة العامة + بطولاتي) */
    public static function myTournaments(): void
    {
        $user = Auth::requireUser();
        Http::ok([
            'tournaments' => Tournaments::listFor($user),
            'mine' => array_values(array_map(
                static fn(array $t): array => Tournaments::publicView($t, (int) $user['id']),
                Db::all(
                    'SELECT t.* FROM tournaments t JOIN tournament_players p ON p.tournament_id = t.id
                     WHERE p.user_id = ? ORDER BY t.id DESC LIMIT 20',
                    [(int) $user['id']]
                )
            )),
        ]);
    }

    public static function createTournament(): void
    {
        $admin = self::requireAdmin();
        $t = Tournaments::create($admin, (array) (Http::input('tournament', []) ?? []));
        Http::ok(['tournament' => Tournaments::publicView($t, (int) $admin['id']), 'message' => 'أُضيفت البطولة']);
    }

    public static function updateTournament(): void
    {
        self::requireAdmin();
        $id = Http::int('id', 0);
        $t = Tournaments::update($id, (array) (Http::input('tournament', []) ?? []));
        Http::ok(['tournament' => Tournaments::publicView($t), 'message' => 'تم التحديث']);
    }

    public static function tournamentStatus(): void
    {
        self::requireAdmin();
        $id = Http::int('id', 0);
        $status = Http::str('status');
        Tournaments::setStatus($id, $status);
        Http::ok(['message' => 'تم التحديث']);
    }

    public static function tournamentStart(): void
    {
        self::requireAdmin();
        $id = Http::int('id', 0);
        Tournaments::start($id);
        Http::ok(['message' => 'انطلقت التصفيات']);
    }

    public static function tournamentAdvance(): void
    {
        self::requireAdmin();
        $id = Http::int('id', 0);
        Tournaments::sync();
        $t = Tournaments::advance($id);
        Http::ok(['tournament' => Tournaments::publicView($t), 'message' => 'تم تحديث التصفيات']);
    }

    public static function tournamentJoin(): void
    {
        $user = Auth::requireUser();
        $code = Http::str('code');
        $t = $code !== '' ? Tournaments::byCode($code) : Tournaments::row(Http::int('id', 0));
        if ($t === null) {
            Http::fail('البطولة غير موجودة', 404, 'not_found');
        }
        $t = Tournaments::join((int) $t['id'], $user);
        Http::ok(['tournament' => Tournaments::publicView($t, (int) $user['id']), 'message' => 'تم التسجيل في البطولة']);
    }

    public static function tournamentLeave(): void
    {
        $user = Auth::requireUser();
        $id = Http::int('id', 0);
        Tournaments::leave($id, $user);
        Http::ok(['message' => 'تم الانسحاب']);
    }
}
