<?php
declare(strict_types=1);

namespace Trix\Core;

use Trix\Game\Engine;

/**
 * البطولات: إنشاء بطولة بعدد مشاركين وموعد بدء، تصفيات على أدوار،
 * ثم تحديد الفائز بالمرتبة ١ والوصيف بالمرتبة ٢.
 */
final class Tournaments
{
    public const STATUSES = ['registration', 'running', 'finished', 'cancelled'];

    /* ============================ قراءة ============================ */

    public static function row(int $id): ?array
    {
        return Db::one('SELECT * FROM tournaments WHERE id = ?', [$id]);
    }

    public static function byCode(string $code): ?array
    {
        return Db::one('SELECT * FROM tournaments WHERE code = ?', [strtoupper(trim($code))]);
    }

    /** بطولة بصيغة صالحة للإرسال للواجهة */
    public static function publicView(array $t, ?int $userId = null): array
    {
        $players = self::players((int) $t['id']);
        $matches = self::matches((int) $t['id']);
        $mine = null;
        foreach ($players as $p) {
            if ($userId !== null && (int) $p['user_id'] === $userId) {
                $mine = $p;
                break;
            }
        }
        $winners = json_decode((string) $t['winners'], true);
        return [
            'id' => (int) $t['id'],
            'code' => (string) $t['code'],
            'name' => (string) $t['name'],
            'game' => (string) $t['game'],
            'capacity' => (int) $t['capacity'],
            'startAt' => (int) $t['start_at'],
            'status' => (string) $t['status'],
            'round' => (int) $t['round'],
            'playersCount' => count($players),
            'players' => array_map(static fn(array $p): array => [
                'userId' => (int) $p['user_id'],
                'name' => (string) $p['name'],
                'avatar' => (string) $p['avatar'],
                'level' => (int) $p['level'],
                'status' => (string) $p['status'],
                'place' => (int) $p['place'],
            ], $players),
            'matches' => array_map(static fn(array $m): array => [
                'id' => (int) $m['id'],
                'round' => (int) $m['round'],
                'roomCode' => (string) $m['room_code'],
                'roomId' => (string) $m['room_id'],
                'seats' => json_decode((string) $m['seats'], true) ?: [],
                'status' => (string) $m['status'],
                'winnerSeat' => $m['winner_seat'] === null ? null : (int) $m['winner_seat'],
                'runnerSeat' => $m['runner_seat'] === null ? null : (int) $m['runner_seat'],
            ], $matches),
            'winners' => is_array($winners) ? $winners : [],
            'joined' => $mine !== null,
            'myStatus' => $mine['status'] ?? null,
        ];
    }

    /** @return array<int, array<string, mixed>> */
    public static function players(int $id): array
    {
        return Db::all('SELECT * FROM tournament_players WHERE tournament_id = ? ORDER BY place ASC, joined_at ASC', [$id]);
    }

    /** @return array<int, array<string, mixed>> */
    public static function matches(int $id): array
    {
        return Db::all('SELECT * FROM tournament_matches WHERE tournament_id = ? ORDER BY round ASC, id ASC', [$id]);
    }

    /** البطولات المفتوحة للتسجيل + بطولات اللاعب الحالية */
    public static function listFor(array $user): array
    {
        $rows = Db::all("SELECT * FROM tournaments WHERE status IN ('registration','running') ORDER BY start_at ASC, id DESC LIMIT 30");
        $out = [];
        foreach ($rows as $t) {
            $out[] = self::publicView($t, (int) $user['id']);
        }
        return $out;
    }

    /* ============================ إنشاء وإدارة ============================ */

    public static function create(array $admin, array $in): array
    {
        $name = trim((string) ($in['name'] ?? ''));
        if ($name === '') {
            Http::fail('اسم البطولة مطلوب', 422, 'name_required');
        }
        $game = (string) ($in['game'] ?? 'tarnib');
        if (!in_array($game, ['tarnib', 'trix', 'mor'], true)) {
            $game = 'tarnib';
        }
        $capacity = (int) ($in['capacity'] ?? 8);
        $capacity = max(4, min(64, $capacity));
        // العدد يجب أن يكون من مضاعفات 4 (طاولات من 4 لاعبين)
        $capacity -= $capacity % 4;
        $capacity = max(4, $capacity);
        $startAt = (int) ($in['startAt'] ?? 0);
        if ($startAt < time() - 60) {
            $startAt = time() + 300;
        }
        $id = Db::insert('tournaments', [
            'code' => self::newCode(),
            'name' => mb_substr($name, 0, 60),
            'game' => $game,
            'capacity' => $capacity,
            'start_at' => $startAt,
            'status' => 'registration',
            'round' => 0,
            'winners' => '[]',
            'created_by' => (int) $admin['id'],
            'created_at' => time(),
        ]);
        return self::row($id) ?? [];
    }

    public static function update(int $id, array $in): array
    {
        $t = self::row($id);
        if ($t === null) {
            Http::fail('البطولة غير موجودة', 404, 'not_found');
        }
        $fields = [];
        if (isset($in['name'])) {
            $fields['name'] = mb_substr(trim((string) $in['name']), 0, 60);
        }
        if (isset($in['capacity'])) {
            $cap = max(4, min(64, (int) $in['capacity']));
            $fields['capacity'] = max(4, $cap - ($cap % 4));
        }
        if (isset($in['startAt'])) {
            $fields['startAt'] = (int) $in['startAt'];
        }
        if ($fields !== []) {
            $sets = [];
            $params = [];
            foreach ($fields as $k => $v) {
                $col = $k === 'startAt' ? 'start_at' : $k;
                $sets[] = "$col = ?";
                $params[] = $v;
            }
            $params[] = $id;
            Db::exec('UPDATE tournaments SET ' . implode(', ', $sets) . ' WHERE id = ?', $params);
        }
        return self::row($id) ?? [];
    }

    public static function setStatus(int $id, string $status): void
    {
        if (!in_array($status, self::STATUSES, true)) {
            Http::fail('حالة غير صحيحة', 422, 'bad_status');
        }
        Db::exec('UPDATE tournaments SET status = ? WHERE id = ?', [$status, $id]);
    }

    public static function join(int $id, array $user): array
    {
        $t = self::row($id);
        if ($t === null) {
            Http::fail('البطولة غير موجودة', 404, 'not_found');
        }
        if ((string) $t['status'] !== 'registration') {
            Http::fail('التسجيل في هذه البطولة مغلق', 409, 'closed');
        }
        $players = self::players($id);
        foreach ($players as $p) {
            if ((int) $p['user_id'] === (int) $user['id']) {
                return $t; // منضم مسبقاً
            }
        }
        if (count($players) >= (int) $t['capacity']) {
            Http::fail('البطولة مكتملة', 409, 'full');
        }
        $lvl = Users::levelFromXp((int) $user['xp']);
        Db::insert('tournament_players', [
            'tournament_id' => $id,
            'user_id' => (int) $user['id'],
            'name' => (string) $user['display_name'],
            'avatar' => (string) $user['avatar'],
            'level' => (int) $lvl['level'],
            'status' => 'joined',
            'place' => 0,
            'joined_at' => time(),
        ]);
        return self::row($id) ?? [];
    }

    public static function kick(int $id, int $userId): void
    {
        Db::exec('DELETE FROM tournament_players WHERE tournament_id = ? AND user_id = ?', [$id, $userId]);
    }

    /** انسحاب اللاعب نفسه */
    public static function leave(int $id, array $user): void
    {
        $t = self::row($id);
        if ($t === null) {
            return;
        }
        if ((string) $t['status'] !== 'registration') {
            Http::fail('لا يمكن الانسحاب بعد بدء البطولة', 409, 'started');
        }
        self::kick($id, (int) $user['id']);
    }

    /* ============================ بدء البطولة والتصفيات ============================ */

    /**
     * بدء الجولة الأولى: توزيع المشاركين على طاولات من 4 (مع بوتات لإكمال النقص)،
     * وإنشاء غرفة لكل طاولة برمز خاص.
     */
    public static function start(int $id): array
    {
        $t = self::row($id);
        if ($t === null) {
            Http::fail('البطولة غير موجودة', 404, 'not_found');
        }
        if ((string) $t['status'] === 'finished') {
            Http::fail('البطولة منتهية', 409, 'finished');
        }
        $players = array_values(array_filter(self::players($id), static fn(array $p): bool => (string) $p['status'] === 'joined'));
        if (count($players) < 2) {
            Http::fail('تحتاج البطولة مشاركين اثنين على الأقل', 422, 'need_players');
        }
        self::createRound($id, $players);
        self::setStatus($id, 'running');
        return self::row($id) ?? [];
    }

    /**
     * إنشاء طاولات دور معيّن
     * @param array<int, array<string, mixed>> $players
     */
    private static function createRound(int $id, array $players): void
    {
        $t = self::row($id);
        if ($t === null) {
            return;
        }
        $round = (int) $t['round'] + 1;
        // ترتيب عشوائي عادل
        shuffle($players);
        $chunks = array_chunk($players, 4);
        foreach ($chunks as $table) {
            $seats = [];
            foreach ($table as $p) {
                $seats[] = [
                    'userId' => (int) $p['user_id'],
                    'name' => (string) $p['name'],
                    'avatar' => (string) $p['avatar'],
                    'level' => (int) $p['level'],
                ];
            }
            // إكمال الطاولة ببوتات بنفس مستوى الطاولة (أو أقل)
            $botNo = 1;
            while (count($seats) < 4) {
                $avg = 0;
                foreach ($seats as $s) {
                    $avg += (int) $s['level'];
                }
                $avg = $seats === [] ? 1 : (int) max(1, round($avg / count($seats)));
                $seats[] = ['userId' => -100 - $botNo, 'name' => "بوت بطولة {$botNo}", 'avatar' => '🤖', 'level' => $avg, 'isBot' => true];
                $botNo++;
            }
            $room = Rooms::createTournamentRoom($t, $seats);
            Db::insert('tournament_matches', [
                'tournament_id' => $id,
                'round' => $round,
                'room_id' => (string) $room['id'],
                'room_code' => (string) $room['code'],
                'seats' => json_encode($seats, JSON_UNESCAPED_UNICODE),
                'status' => 'waiting',
                'winner_seat' => null,
                'runner_seat' => null,
                'created_at' => time(),
            ]);
        }
        Db::exec('UPDATE tournaments SET round = ? WHERE id = ?', [$round, $id]);
    }

    /**
     * ترقية الفائزين: يقرأ نتائج طاولات الدور الحالي؛
     * إن انتهت كلها ننشئ الدور التالي، وإن بقيت طاولة واحدة نعلن المرتبة ١ و٢.
     */
    public static function advance(int $id): array
    {
        $t = self::row($id);
        if ($t === null) {
            Http::fail('البطولة غير موجودة', 404, 'not_found');
        }
        if ((string) $t['status'] !== 'running') {
            return $t;
        }
        $round = (int) $t['round'];
        $matches = self::matches($id);
        $current = array_values(array_filter($matches, static fn(array $m): bool => (int) $m['round'] === $round));
        if ($current === []) {
            return $t;
        }
        // الدور الحالي لم ينتهِ بعد
        foreach ($current as $m) {
            if ((string) $m['status'] !== 'done') {
                return $t;
            }
        }

        // ترتيب النهاية لكل طاولة (الفائز ثم الوصيف ثم البقية)
        $orderOf = static function (array $m): array {
            $order = [];
            if ($m['winner_seat'] !== null) {
                $order[] = (int) $m['winner_seat'];
            }
            if ($m['runner_seat'] !== null) {
                $order[] = (int) $m['runner_seat'];
            }
            foreach ([0, 1, 2, 3] as $i) {
                if (!in_array($i, $order, true)) {
                    $order[] = $i;
                }
            }
            return $order;
        };

        // المؤهلون للدور التالي: أفضل لاعبَين حقيقيين من كل طاولة (البوتات لا تتأهل)
        $qualified = [];
        foreach ($current as $m) {
            $seats = json_decode((string) $m['seats'], true) ?: [];
            $taken = 0;
            foreach ($orderOf($m) as $idx) {
                $s = $seats[$idx] ?? null;
                if ($s === null || !empty($s['isBot'])) {
                    continue;
                }
                $q = Db::one('SELECT * FROM tournament_players WHERE tournament_id = ? AND user_id = ?', [$id, (int) $s['userId']]);
                if ($q !== null) {
                    $qualified[] = $q;
                    $taken++;
                }
                if ($taken >= 2) {
                    break;
                }
            }
        }

        /*
         * انتهت البطولة إذا كان الدور الحالي بطاولة واحدة (لا يوجد دور تالٍ)،
         * أو لم يتبقَّ لاعبون كافيون. المرتبة ١ و٢ من نتائج آخر طاولة.
         */
        if (count($current) === 1 || count($qualified) < 2) {
            $final = $current[count($current) - 1];
            $seats = json_decode((string) $final['seats'], true) ?: [];
            $winners = [];
            foreach ([1, 2] as $place) {
                $idx = $place === 1 ? $final['winner_seat'] : $final['runner_seat'];
                if ($idx === null) {
                    continue;
                }
                $s = $seats[(int) $idx] ?? null;
                if ($s === null) {
                    continue;
                }
                $winners[] = [
                    'place' => $place,
                    'userId' => (int) $s['userId'],
                    'name' => (string) $s['name'],
                    'avatar' => (string) $s['avatar'],
                    'isBot' => !empty($s['isBot']),
                    'level' => (int) ($s['level'] ?? 1),
                ];
            }
            if ($winners !== []) {
                Db::exec('UPDATE tournaments SET status = ?, winners = ? WHERE id = ?', [
                    'finished',
                    json_encode($winners, JSON_UNESCAPED_UNICODE),
                    $id,
                ]);
                foreach ($winners as $w) {
                    if (empty($w['isBot']) && (int) $w['userId'] > 0) {
                        Db::exec('UPDATE tournament_players SET status = ?, place = ? WHERE tournament_id = ? AND user_id = ?', [
                            $w['place'] === 1 ? 'winner' : 'runner',
                            (int) $w['place'],
                            $id,
                            (int) $w['userId'],
                        ]);
                    }
                }
            }
            return self::row($id) ?? [];
        }

        // دور تصفيات جديد
        self::createRound($id, $qualified);
        return self::row($id) ?? [];
    }

    /** تحديث الطاولات من حالة الغرف الحقيقية (يُستدعى من لوحة المدير أو تلقائياً) */
    public static function sync(): void
    {
        $rows = Db::all("SELECT * FROM tournaments WHERE status = 'running' LIMIT 20");
        foreach ($rows as $t) {
            $id = (int) $t['id'];
            $matches = array_filter(self::matches($id), static fn(array $m): bool => (string) $m['status'] !== 'done');
            $changed = false;
            foreach ($matches as $m) {
                $room = Db::one('SELECT * FROM rooms WHERE id = ?', [(string) $m['room_id']]);
                if ($room === null) {
                    continue;
                }
                $state = json_decode((string) $room['state'], true);
                if (!is_array($state)) {
                    continue;
                }
                $phase = (string) ($state['phase'] ?? '');
                if ($phase !== 'game_end' && (string) $room['status'] !== 'finished') {
                    continue;
                }
                // الترتيب من النتيجة النهائية
                $scores = $state['scores'] ?? [];
                if (!is_array($scores)) {
                    continue;
                }
                $tGame = (string) ($state['settings']['game'] ?? 'tarnib');
                if ($tGame === 'mor') {
                    // المور: فريقان متقابلان (المقاعد 0/2 ثم 1/3) — الفائز بفريقه
                    if (count($scores) < 2) {
                        continue;
                    }
                    $winnerTeam = ((int) $scores[0] >= (int) $scores[1]) ? 0 : 1;
                    Db::exec('UPDATE tournament_matches SET status = ?, winner_seat = ?, runner_seat = ? WHERE id = ?', [
                        'done',
                        $winnerTeam,
                        1 - $winnerTeam,
                        (int) $m['id'],
                    ]);
                    $changed = true;
                    continue;
                }
                if (count($scores) < 4) {
                    continue;
                }
                $order = [0, 1, 2, 3];
                usort($order, static fn(int $a, int $b): int => ((int) ($scores[$b] ?? 0)) <=> ((int) ($scores[$a] ?? 0)));
                Db::exec('UPDATE tournament_matches SET status = ?, winner_seat = ?, runner_seat = ? WHERE id = ?', [
                    'done',
                    (int) $order[0],
                    (int) $order[1],
                    (int) $m['id'],
                ]);
                $changed = true;
            }
            if ($changed) {
                self::advance($id);
            }
        }
    }

    /** إنشاء رمز بطولة فريد */
    private static function newCode(): string
    {
        for ($i = 0; $i < 20; $i++) {
            $code = strtoupper(substr(str_shuffle('ABCDEFGHJKLMNPQRSTUVWXYZ23456789'), 0, 5));
            if (Db::one('SELECT id FROM tournaments WHERE code = ?', [$code]) === null) {
                return $code;
            }
        }
        return 'T' . substr((string) time(), -4);
    }

    /* ============================ سجل اليوم ============================ */

    /** كل لاعب ظهر اليوم: آخر ظهور + مبارياته وطاولاته */
    public static function todayLog(): array
    {
        $start = strtotime('today 00:00:00') ?: (time() - 86400);
        $since = max(1, $start);

        $players = Db::all(
            'SELECT id, username, display_name, avatar, coins, level, games_played, games_won, is_guest, is_admin, created_at, last_seen
             FROM users WHERE last_seen >= ? ORDER BY last_seen DESC LIMIT 300',
            [$since]
        );
        $rooms = Db::all(
            'SELECT id, code, name, host_id, status, settings, created_at, updated_at, last_activity,
                    seat0, seat1, seat2, seat3
             FROM rooms WHERE last_activity >= ? ORDER BY last_activity DESC LIMIT 200',
            [$since]
        );
        $matches = Db::all('SELECT * FROM matches WHERE created_at >= ? ORDER BY created_at DESC LIMIT 200', [$since]);

        $userIds = [];
        foreach ($rooms as $r) {
            foreach (['seat0', 'seat1', 'seat2', 'seat3'] as $s) {
                if ((int) $r[$s] > 0) {
                    $userIds[(int) $r[$s]] = true;
                }
            }
        }
        $names = [];
        if ($userIds !== []) {
            $in = implode(',', array_fill(0, count($userIds), '?'));
            $rows = Db::all("SELECT id, display_name, avatar FROM users WHERE id IN ($in)", array_keys($userIds));
            foreach ($rows as $row) {
                $names[(int) $row['id']] = ['name' => (string) $row['display_name'], 'avatar' => (string) $row['avatar']];
            }
        }

        return [
            'dayStart' => $since,
            'players' => array_map(static fn(array $p): array => [
                'id' => (int) $p['id'],
                'username' => (string) $p['username'],
                'name' => (string) $p['display_name'],
                'avatar' => (string) $p['avatar'],
                'level' => (int) $p['level'],
                'coins' => (int) $p['coins'],
                'gamesPlayed' => (int) $p['games_played'],
                'gamesWon' => (int) $p['games_won'],
                'isGuest' => (bool) $p['is_guest'],
                'isAdmin' => (bool) $p['is_admin'],
                'lastSeen' => (int) $p['last_seen'],
                'createdAt' => (int) $p['created_at'],
            ], $players),
            'rooms' => array_map(static function (array $r) use ($names): array {
                $settings = json_decode((string) $r['settings'], true);
                $state = null;
                $seats = [];
                foreach (['seat0', 'seat1', 'seat2', 'seat3'] as $i => $col) {
                    $uid = (int) $r[$col];
                    $seats[] = [
                        'seat' => $i,
                        'userId' => $uid,
                        'name' => $uid > 0 ? ($names[$uid]['name'] ?? '—') : ($uid === 0 ? 'فارغ' : 'بوت'),
                        'avatar' => $uid > 0 ? ($names[$uid]['avatar'] ?? '🃏') : ($uid === 0 ? '🪑' : '🤖'),
                    ];
                }
                return [
                    'id' => (string) $r['id'],
                    'code' => (string) $r['code'],
                    'name' => (string) $r['name'],
                    'hostId' => (int) $r['host_id'],
                    'status' => (string) $r['status'],
                    'game' => (string) (is_array($settings) ? ($settings['game'] ?? 'tarnib') : 'tarnib'),
                    'seats' => $seats,
                    'createdAt' => (int) $r['created_at'],
                    'lastActivity' => (int) $r['last_activity'],
                    'state' => $state,
                ];
            }, $rooms),
            'matches' => array_map(static fn(array $m): array => [
                'id' => (int) $m['id'],
                'roomCode' => (string) $m['room_code'],
                'scoreA' => (int) $m['score_a'],
                'scoreB' => (int) $m['score_b'],
                'winnerTeam' => (int) $m['winner_team'],
                'rounds' => (int) $m['rounds'],
                'names' => json_decode((string) $m['names'], true) ?: [],
                'duration' => (int) $m['duration'],
                'createdAt' => (int) $m['created_at'],
            ], $matches),
        ];
    }
}
