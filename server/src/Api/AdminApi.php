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
                'xp' => (int) $u['xp'],
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
                // حذف كامل: الجلسات + الإحصاءات المرتبطة + المستخدم
                Db::exec('DELETE FROM sessions WHERE user_id = ?', [$id]);
                try {
                    Db::exec('DELETE FROM transactions WHERE user_id = ?', [$id]);
                } catch (\Throwable) {
                }
                Db::exec('DELETE FROM users WHERE id = ?', [$id]);
                break;
            case 'password':
                $pass = Http::str('password');
                if (strlen($pass) < 4) {
                    Http::fail('كلمة المرور قصيرة جداً (٤ أحرف على الأقل)', 422, 'weak_password');
                }
                Db::exec('UPDATE users SET pass_hash = ? WHERE id = ?', [password_hash($pass, PASSWORD_BCRYPT), $id]);
                // نُبقي جلسات المستخدم كما هي حتى لا يُطرد فجأة
                break;
            default:
                Http::fail('إجراء غير معروف', 422, 'bad_action');
        }
        Http::ok(['message' => 'تم التنفيذ']);
    }

    /** تعديل بيانات مستخدم: الاسم، الصورة، العملات، الخبرة/المستوى، الصلاحية، الحظر */
    public static function userUpdate(): void
    {
        self::requireAdmin();
        $id = Http::int('id', 0);
        if (Users::find($id) === null) {
            Http::fail('المستخدم غير موجود', 404, 'not_found');
        }
        $fields = [];
        $name = trim(Http::str('name'));
        if ($name !== '') {
            $fields['display_name'] = mb_substr($name, 0, 24);
        }
        $avatar = trim(Http::str('avatar'));
        if ($avatar !== '') {
            $fields['avatar'] = mb_substr($avatar, 0, 8);
        }
        if (Http::input('coins') !== null) {
            $fields['coins'] = max(0, min(100000000, Http::int('coins', 0)));
        }
        if (Http::input('xp') !== null) {
            $xp = max(0, min(100000000, Http::int('xp', 0)));
            $fields['xp'] = $xp;
            $fields['level'] = (int) (Users::levelFromXp($xp)['level'] ?? 1);
        }
        if (Http::input('coins') === null && Http::input('addCoins') !== null) {
            Users::addCoins($id, Http::int('addCoins', 0), 'admin', 'admin');
        }
        if (Http::input('is_admin') !== null) {
            $fields['is_admin'] = Http::bool('is_admin') ? 1 : 0;
        }
        if (Http::input('banned') !== null) {
            self::column('is_banned');
            $fields['banned'] = Http::bool('banned') ? 1 : 0;
        }
        if ($fields !== []) {
            // بعض القواعد القديمة تستخدم الاسم is_banned
            if (array_key_exists('banned', $fields)) {
                self::column('is_banned');
                $fields['is_banned'] = $fields['banned'];
                unset($fields['banned']);
            }
            Db::update('users', $fields, 'id = ?', [$id]);
        }
        Http::ok(['message' => 'تم تحديث المستخدم']);
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
        // الملغاة تختفي من عند المستخدمين فوراً
        Http::ok([
            'tournaments' => Tournaments::listFor($user),
            'mine' => array_values(array_map(
                static fn(array $t): array => Tournaments::publicView($t, (int) $user['id']),
                Db::all(
                    "SELECT t.* FROM tournaments t JOIN tournament_players p ON p.tournament_id = t.id
                     WHERE p.user_id = ? AND t.status != 'cancelled' ORDER BY t.id DESC LIMIT 20",
                    [(int) $user['id']]
                )
            )),
        ]);
    }

    /** شاشة البطولة للاعبين: تفاصيل + منضمون + موعد + طاولات الإنطلاق (شاشة انتظار) */
    public static function tournamentView(): void
    {
        $user = Auth::requireUser();
        $id = Http::int('id', 0);
        $t = $id > 0 ? Tournaments::row($id) : Tournaments::byCode(Http::str('code'));
        if ($t === null) {
            Http::fail('البطولة غير موجودة', 404, 'not_found');
        }
        // تحديث خفيف لنتائج الطاولات حتى تظهر التصفيات في الشاشة مباشرة
        Tournaments::syncThrottled();
        $t = Tournaments::row((int) $t['id']) ?? $t;
        Http::ok(['tournament' => Tournaments::publicView($t, (int) $user['id'])]);
    }

    public static function tournamentDelete(): void
    {
        self::requireAdmin();
        Tournaments::remove(Http::int('id', 0));
        Http::ok(['message' => 'تم حذف البطولة']);
    }

    /** سجل الطاولات الكامل: كل مباراة ونتيجتها ومن فاز + كل الطاولات السابقة */
    public static function history(): void
    {
        self::requireAdmin();
        $limit = max(1, min(200, Http::int('limit', 40)));
        $offset = max(0, Http::int('offset', 0));
        $game = Http::str('game');
        $q = trim(Http::str('q'));
        $where = [];
        $params = [];
        if (in_array($game, ['tarnib', 'trix'], true)) {
            $where[] = 'game = ?';
            $params[] = $game;
        }
        if ($q !== '') {
            $like = '%' . $q . '%';
            $where[] = '(room_code LIKE ? OR names LIKE ?)';
            $params[] = $like;
            $params[] = $like;
        }
        $clause = $where === [] ? '' : (' WHERE ' . implode(' AND ', $where));

        $matches = Db::all(
            'SELECT id, room_code, target, score_a, score_b, winner_team, rounds, names, duration, game, created_at
             FROM matches' . $clause . ' ORDER BY id DESC LIMIT ' . $limit . ' OFFSET ' . $offset,
            $params
        );
        $outMatches = [];
        foreach ($matches as $m) {
            $names = json_decode((string) $m['names'], true) ?: [];
            $gameKind = (string) ($m['game'] ?? 'tarnib');
            $scores = [(int) $m['score_a'], (int) $m['score_b']];
            $winner = (int) $m['winner_team'];
            $winnersList = [];
            if ($gameKind === 'trix') {
                // فردي: الفائز صاحب أعلى مجموع من المقاعد الأربعة
                if (count($names) < 4) {
                    $winnersList = [$names[0] ?? '—'];
                } else {
                    $winnersList = [$names[$winner] ?? '—'];
                }
            } else {
                foreach ($names as $i => $n) {
                    if (((int) $i % 2) === $winner) {
                        $winnersList[] = (string) $n;
                    }
                }
            }
            $outMatches[] = [
                'id' => (int) $m['id'],
                'roomCode' => (string) $m['room_code'],
                'game' => $gameKind,
                'target' => (int) $m['target'],
                'scoreA' => $scores[0],
                'scoreB' => $scores[1],
                'winnerTeam' => $winner,
                'names' => $names,
                'winners' => $winnersList,
                'rounds' => (int) $m['rounds'],
                'duration' => (int) $m['duration'],
                'createdAt' => (int) $m['created_at'],
            ];
        }

        // كل الطاولات السابقة (بما فيها التي لم تكتمل) مع نتيجة الغرفة إن وُجدت
        $rooms = Db::all(
            'SELECT id, code, name, host_id, status, settings, created_at, updated_at, last_activity
             FROM rooms ORDER BY created_at DESC LIMIT ' . $limit . ' OFFSET ' . $offset
        );
        $resultByCode = [];
        foreach (Db::all('SELECT room_code, score_a, score_b, winner_team, names, game, created_at FROM matches ORDER BY id DESC LIMIT 400') as $m) {
            $resultByCode[(string) $m['room_code']] = $m;
        }
        $outRooms = [];
        foreach ($rooms as $r) {
            $st = json_decode((string) $r['settings'], true);
            $res = $resultByCode[(string) $r['code']] ?? null;
            $names = $res ? (json_decode((string) $res['names'], true) ?: []) : [];
            $outRooms[] = [
                'code' => (string) $r['code'],
                'name' => (string) $r['name'],
                'game' => (string) (is_array($st) ? ($st['game'] ?? 'tarnib') : 'tarnib'),
                'status' => (string) $r['status'],
                'createdAt' => (int) $r['created_at'],
                'lastActivity' => (int) $r['last_activity'],
                'finished' => $res !== null,
                'scoreA' => $res ? (int) $res['score_a'] : null,
                'scoreB' => $res ? (int) $res['score_b'] : null,
                'winnerTeam' => $res ? (int) $res['winner_team'] : null,
                'players' => $names,
            ];
        }
        Http::ok([
            'matches' => $outMatches,
            'rooms' => $outRooms,
            'totals' => [
                'matches' => (int) Db::value('SELECT COUNT(*) FROM matches'),
                'rooms' => (int) Db::value('SELECT COUNT(*) FROM rooms'),
            ],
            'offset' => $offset,
            'limit' => $limit,
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
        if ($status === 'cancelled') {
            // نُغلق طاولاتها حتى لا يبقى أحد عالقاً في غرفة بطولة ملغاة
            foreach (Tournaments::matches($id) as $m) {
                $roomId = (string) $m['room_id'];
                if ($roomId !== '') {
                    try {
                        Db::exec("UPDATE rooms SET status = 'closed' WHERE id = ?", [$roomId]);
                    } catch (\Throwable) {
                    }
                }
            }
        }
        Http::ok(['message' => $status === 'cancelled' ? 'أُلغيت البطولة واختفت من اللاعبين' : 'تم التحديث']);
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
