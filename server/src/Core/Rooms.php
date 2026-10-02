<?php
declare(strict_types=1);

namespace Trix\Core;

use Trix\Game\Engine;
use Trix\Game\Trix;

/**
 * إدارة الغرف والطاولات: الإنشاء، الانضمام، اختيار الشركاء، المزامنة، والدوران
 */
final class Rooms
{
    private const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    /** مهلة الاتصال بالثواني: بعدها يُعتبر اللاعب منقطعاً */
    private const PRESENCE_SECONDS = 20;

    /* ============================ إعدادات ============================ */

    public static function defaultSettings(): array
    {
        return [
            'game' => 'tarnib',
            'kingdoms' => 4,
            'target' => 31,
            'allowDouble' => false,
            'allowNoTrump' => false,
            'requireTrumpInHand' => false,
            'turnTime' => 30,
            'bidTime' => 30,
            'quickPlay' => false,
            'sound' => true,
        ];
    }

    public static function sanitizeSettings(array $in, array $base = []): array
    {
        $out = array_merge(self::defaultSettings(), $base);
        if (isset($in['game'])) {
            $g = strtolower(trim((string) $in['game']));
            $out['game'] = in_array($g, ['tarnib', 'trix'], true) ? $g : 'tarnib';
        }
        if (isset($in['target'])) {
            $t = (int) $in['target'];
            $out['target'] = in_array($t, [31, 41, 61], true) ? $t : 31;
        }
        if (isset($in['kingdoms'])) {
            $k = (int) $in['kingdoms'];
            $out['kingdoms'] = in_array($k, [1, 2, 4], true) ? $k : 4;
        }
        foreach (['allowDouble', 'allowNoTrump', 'requireTrumpInHand', 'quickPlay', 'sound'] as $k) {
            if (array_key_exists($k, $in)) {
                $out[$k] = (bool) $in[$k];
            }
        }
        if (isset($in['turnTime'])) {
            $t = (int) $in['turnTime'];
            $out['turnTime'] = in_array($t, [0, 15, 20, 30, 45, 60], true) ? $t : 30;
        }
        if (isset($in['bidTime'])) {
            $t = (int) $in['bidTime'];
            $out['bidTime'] = in_array($t, [0, 10, 15, 20, 30, 45], true) ? $t : 30;
        }
        return $out;
    }

    /* ============================ الأساسيات ============================ */

    public static function generateCode(): string
    {
        for ($attempt = 0; $attempt < 20; $attempt++) {
            $code = '';
            for ($i = 0; $i < 5; $i++) {
                $code .= self::CODE_CHARS[random_int(0, strlen(self::CODE_CHARS) - 1)];
            }
            if (!Db::value('SELECT id FROM rooms WHERE code = ?', [$code])) {
                return $code;
            }
        }
        return strtoupper(bin2hex(random_bytes(3)));
    }

    public static function create(array $user, array $options = []): array
    {
        if (Config::get('maintenance')) {
            Http::fail('الخادم في وضع الصيانة حالياً', 503, 'maintenance');
        }
        $active = (int) Db::value('SELECT COUNT(*) FROM rooms WHERE status != ?', ['closed']);
        if ($active >= (int) Config::get('max_rooms', 300)) {
            Http::fail('عدد الغرف النشطة وصل الحد الأقصى، حاول لاحقاً', 503, 'too_many_rooms');
        }
        $settings = self::sanitizeSettings((array) ($options['settings'] ?? []));
        $name = trim((string) ($options['name'] ?? ''));
        if ($name === '') {
            $name = mb_substr((string) $user['display_name'], 0, 18) . ' - طاولة';
        }
        $now = time();
        $id = bin2hex(random_bytes(8));
        $password = (string) ($options['password'] ?? '');
        $requestedCode = strtoupper(trim((string) ($options['code'] ?? '')));
        $code = $requestedCode !== '' && preg_match('/^[A-Z0-9]{4,8}$/', $requestedCode) && !Db::value('SELECT id FROM rooms WHERE code = ?', [$requestedCode])
            ? $requestedCode
            : self::generateCode();

        $seatUser = [
            'userId' => (int) $user['id'],
            'name' => (string) $user['display_name'],
            'avatar' => (string) $user['avatar'],
            'level' => (int) $user['level'],
            'isBot' => false,
            'connected' => true,
            'ready' => true,
            'seat' => 0,
            'lastSeen' => Engine::now(),
        ];
        $state = [
            'phase' => 'waiting',
            'settings' => $settings,
            'target' => (int) $settings['target'],
            'seats' => [$seatUser, null, null, null],
            'hands' => [[], [], [], []],
            'play' => [],
            'trick' => [],
            'tricks' => [0, 0],
            'scores' => [0, 0],
            'round' => 0,
            'log' => [],
            'chat' => [],
            'version' => 1,
            'eventId' => 0,
            'chatId' => 0,
            'swap' => [],
            'hostId' => (int) $user['id'],
            'recorded' => false,
            'createdAt' => $now,
            'lastActivity' => $now,
            'turnStartedAt' => Engine::now(),
        ];
        $state = self::stampSeats($state);

        Db::insert('rooms', [
            'id' => $id,
            'code' => $code,
            'name' => $name,
            'host_id' => (int) $user['id'],
            'is_private' => !empty($options['isPrivate']) ? 1 : 0,
            'password' => $password === '' ? '' : password_hash($password, PASSWORD_BCRYPT),
            'settings' => json_encode($settings, JSON_UNESCAPED_UNICODE),
            'state' => json_encode($state, JSON_UNESCAPED_UNICODE),
            'version' => 1,
            'status' => 'waiting',
            'seat0' => (int) $user['id'],
            'created_at' => $now,
            'updated_at' => $now,
            'last_activity' => $now,
        ]);
        $room = self::find($id);
        if ($room === null) {
            Http::fail('تعذّر إنشاء الغرفة', 500);
        }
        return $room;
    }

    public static function find(string $idOrCode): ?array
    {
        $idOrCode = trim($idOrCode);
        if ($idOrCode === '') {
            return null;
        }
        $room = Db::one('SELECT * FROM rooms WHERE id = ?', [$idOrCode]);
        if ($room === null) {
            $room = Db::one('SELECT * FROM rooms WHERE code = ?', [strtoupper($idOrCode)]);
        }
        return $room;
    }

    public static function requireRoom(string $idOrCode): array
    {
        $room = self::find($idOrCode);
        if ($room === null) {
            Http::fail('الغرفة غير موجودة أو أُغلقت', 404, 'room_not_found');
        }
        return $room;
    }

    public static function decode(array $room): array
    {
        $state = json_decode((string) $room['state'], true);
        return is_array($state) ? $state : [];
    }

    public static function settings(array $room): array
    {
        $s = json_decode((string) $room['settings'], true);
        return self::sanitizeSettings(is_array($s) ? $s : []);
    }

    /** رقم مقعد اللاعب */
    public static function seatOf(array $state, int $userId): ?int
    {
        foreach ((array) ($state['seats'] ?? []) as $i => $pl) {
            if ($pl !== null && (int) $pl['userId'] === $userId) {
                return (int) $i;
            }
        }
        return null;
    }

    private static function stampSeats(array $state): array
    {
        $seats = [];
        foreach ((array) ($state['seats'] ?? []) as $i => $pl) {
            if ($pl === null) {
                $seats[] = null;
                continue;
            }
            $pl['seat'] = (int) $i;
            $pl['team'] = ((int) $i) % 2;
            $seats[] = $pl;
        }
        while (count($seats) < 4) {
            $seats[] = null;
        }
        $state['seats'] = $seats;
        return $state;
    }

    /* ======================= تعديل الحالة بقفل ======================= */

    /**
     * تنفيذ تعديل على حالة الغرفة بشكل ذرّي وآمن
     * @param callable $fn function(array &$room, array &$state): mixed
     */
    public static function act(string $idOrCode, callable $fn, bool $runTick = true): array
    {
        $room = self::requireRoom($idOrCode);
        $lock = Db::lock('room-' . $room['id']);
        try {
            $room = Db::one('SELECT * FROM rooms WHERE id = ?', [$room['id']]);
            if ($room === null) {
                Http::fail('الغرفة غير موجودة', 404, 'room_not_found');
            }
            $state = self::decode($room);
            /*
             * الإعدادات تعيش في الحالة أثناء اللعب، ونحفظها أيضاً في صف الغرفة.
             * إن كانت الحالة بلا إعدادات (غرف أُنشئت قبل هذا الحقل) نأخذها من الصف
             * حتى لا تُلعب المباراة بإعدادات افتراضية خاطئة.
             */
            if (empty($state['settings'])) {
                $state['settings'] = self::settings($room);
                $state['target'] = (int) $state['settings']['target'];
            }
            $result = $fn($room, $state);
            if ($runTick) {
                self::tick($room, $state);
            }
            $status = (string) $room['status'];
            if (($state['phase'] ?? 'waiting') === 'game_end' && $status !== 'finished') {
                $status = 'finished';
            }
            self::persist($room, $state, $status);
            return is_array($result) ? array_merge($result, ['_state' => $state, '_room' => $room]) : ['_state' => $state, '_room' => $room];
        } finally {
            Db::unlock($lock);
        }
    }

    /** حفظ الحالة في قاعدة البيانات */
    public static function persist(array $room, array $state, ?string $status = null): void
    {
        $state = self::stampSeats($state);
        $state['lastActivity'] = time();
        $seats = [];
        for ($i = 0; $i < 4; $i++) {
            $pl = $state['seats'][$i] ?? null;
            $seats['seat' . $i] = $pl === null ? 0 : (int) $pl['userId'];
        }
        Db::update('rooms', array_merge([
            'state' => json_encode($state, JSON_UNESCAPED_UNICODE),
            'version' => (int) ($state['version'] ?? 1),
            'settings' => json_encode((array) ($state['settings'] ?? self::settings($room)), JSON_UNESCAPED_UNICODE),
            'status' => $status ?? (string) $room['status'],
            'updated_at' => time(),
            'last_activity' => time(),
        ], $seats), 'id = ?', [$room['id']]);
    }

    /* =========================== الانضمام =========================== */

    /** ترتيب المقاعد المفضلة عند الانضمام: شريك المضيف أولاً (المقابل)، ثم بقية المقاعد */
    private static function preferredSeats(array $state): array
    {
        $order = [2, 1, 3, 0];
        $free = [];
        foreach ($order as $i) {
            if (($state['seats'][$i] ?? null) === null) {
                $free[] = $i;
            }
        }
        return $free;
    }

    public static function join(array $user, string $idOrCode, string $password = ''): array
    {
        $room = self::requireRoom($idOrCode);
        if ((string) $room['status'] === 'closed') {
            Http::fail('الغرفة مغلقة', 410, 'room_closed');
        }
        $hash = (string) $room['password'];
        if ($hash !== '' && !password_verify($password, $hash)) {
            Http::fail('كلمة مرور الغرفة غير صحيحة', 403, 'bad_room_password');
        }
        $roomId = (string) $room['id'];
        self::act($roomId, function (array &$r, array &$state) use ($user) {
            $userId = (int) $user['id'];
            $seat = self::seatOf($state, $userId);
            if ($seat !== null) {
                $state['seats'][$seat]['connected'] = true;
                $state['seats'][$seat]['lastSeen'] = Engine::now();
                $state['seats'][$seat]['name'] = (string) $user['display_name'];
                $state['seats'][$seat]['avatar'] = (string) $user['avatar'];
                return ['seat' => $seat, 'rejoined' => true];
            }
            $free = self::preferredSeats($state);
            if (!$free) {
                // الغرفة ممتلئة
                if ((string) $r['status'] === 'waiting') {
                    Http::fail('الغرفة ممتلئة', 409, 'room_full');
                }
                return ['seat' => null, 'spectator' => true];
            }
            $target = $free[0];
            $state['seats'][$target] = [
                'userId' => $userId,
                'name' => (string) $user['display_name'],
                'avatar' => (string) $user['avatar'],
                'level' => (int) $user['level'],
                'isBot' => false,
                'connected' => true,
                'ready' => false,
                'seat' => $target,
                'team' => $target % 2,
                'lastSeen' => Engine::now(),
            ];
            if (($state['phase'] ?? 'waiting') === 'waiting') {
                Engine::log($state, 'join', ['seat' => $target, 'name' => (string) $user['display_name']]);
                Engine::chat($state, null, (string) $user['display_name'] . ' انضم إلى الطاولة');
            }
            return ['seat' => $target];
        });
        return self::requireRoom($roomId);
    }

    public static function leave(array $user, string $idOrCode): void
    {
        $room = self::requireRoom($idOrCode);
        self::act((string) $room['id'], function (array &$r, array &$state) use ($user) {
            $seat = self::seatOf($state, (int) $user['id']);
            if ($seat === null) {
                return [];
            }
            $phase = (string) ($state['phase'] ?? 'waiting');
            if (in_array($phase, ['bidding', 'playing', 'resolving'], true)) {
                // لا نعيد المقعد أثناء اللعب، نحوّله إلى بوت لتستمر المباراة
                $state['seats'][$seat]['isBot'] = true;
                $state['seats'][$seat]['connected'] = false;
                $state['seats'][$seat]['name'] = (string) $state['seats'][$seat]['name'];
                Engine::chat($state, null, (string) $state['seats'][$seat]['name'] . ' خرج من المباراة — تم استكماله بالبوت');
                return [];
            }
            Engine::chat($state, null, (string) $state['seats'][$seat]['name'] . ' غادر الطاولة');
            $state['seats'][$seat] = null;
            if ((int) $r['host_id'] === (int) $user['id']) {
                $nextHost = null;
                foreach ($state['seats'] as $pl) {
                    if ($pl !== null && empty($pl['isBot'])) {
                        $nextHost = (int) $pl['userId'];
                        break;
                    }
                }
                if ($nextHost === null) {
                    $r['status'] = 'closed';
                } else {
                    $r['host_id'] = $nextHost;
                    $state['hostId'] = $nextHost;
                }
            }
            return [];
        });
    }

    /** لعب سريع: الانضمام لأي غرفة فيها مقعد فارغ أو إنشاء غرفة جديدة */
    public static function quickPlay(array $user, array $settings = []): array
    {
        $rows = Db::all(
            "SELECT * FROM rooms WHERE status IN ('waiting') AND is_private = 0 AND password = '' AND last_activity > ? ORDER BY last_activity DESC LIMIT 30",
            [time() - 1800]
        );
        foreach ($rows as $row) {
            $state = self::decode($row);
            if (self::seatOf($state, (int) $user['id']) !== null) {
                return self::requireRoom((string) $row['id']);
            }
            if (count(self::preferredSeats($state)) > 0) {
                return self::join($user, (string) $row['id']);
            }
        }
        return self::create($user, ['name' => 'لعب سريع', 'settings' => $settings]);
    }

    /* ======================= توزيع المقاعد والشركاء ======================= */

    public static function moveSeat(array $user, string $idOrCode, int $seat): array
    {
        $room = self::requireRoom($idOrCode);
        self::act((string) $room['id'], function (array &$r, array &$state) use ($user, $seat) {
            if ((string) $r['status'] !== 'waiting') {
                Http::fail('لا يمكن تغيير المقاعد بعد بدء المباراة', 409, 'game_started');
            }
            if ($seat < 0 || $seat > 3) {
                Http::fail('رقم مقعد غير صحيح', 422);
            }
            $mySeat = self::seatOf($state, (int) $user['id']);
            if ($mySeat === null) {
                Http::fail('أنت لست في هذه الطاولة', 403);
            }
            if ($mySeat === $seat) {
                return [];
            }
            if (($state['seats'][$seat] ?? null) !== null) {
                Http::fail('المقعد مشغول، أرسل طلب تبديل', 409, 'seat_taken');
            }
            $player = $state['seats'][$mySeat];
            $state['seats'][$mySeat] = null;
            $player['seat'] = $seat;
            $player['team'] = $seat % 2;
            $state['seats'][$seat] = $player;
            Engine::log($state, 'seat', ['userId' => (int) $user['id'], 'seat' => $seat]);
            return [];
        });
        return self::requireRoom((string) $room['id']);
    }

    /** طلب تبديل مقعد مع لاعب آخر (لا يتم إلا بموافقته) */
    public static function requestSwap(array $user, string $idOrCode, int $targetSeat): array
    {
        $room = self::requireRoom($idOrCode);
        self::act((string) $room['id'], function (array &$r, array &$state) use ($user, $targetSeat) {
            if ((string) $r['status'] !== 'waiting') {
                Http::fail('لا يمكن تبديل المقاعد بعد بدء المباراة', 409, 'game_started');
            }
            $mySeat = self::seatOf($state, (int) $user['id']);
            if ($mySeat === null) {
                Http::fail('أنت لست في هذه الطاولة', 403);
            }
            $target = $state['seats'][$targetSeat] ?? null;
            if ($target === null) {
                Http::fail('المقعد فارغ، يمكنك الانتقال إليه مباشرة', 409, 'seat_free');
            }
            if (!empty($target['isBot'])) {
                Http::fail('لا يمكن تبديل المقعد مع بوت، استخدم خيار إزالة البوت', 409, 'is_bot');
            }
            $state['swap'] = array_values(array_filter((array) ($state['swap'] ?? []), static fn($s) => (int) $s['from'] !== $mySeat));
            $state['swap'][] = ['from' => $mySeat, 'to' => $targetSeat, 'userId' => (int) $user['id'], 'at' => time()];
            Engine::log($state, 'swap_request', ['from' => $mySeat, 'to' => $targetSeat]);
            return [];
        });
        return self::requireRoom((string) $room['id']);
    }

    public static function respondSwap(array $user, string $idOrCode, bool $accept): array
    {
        $room = self::requireRoom($idOrCode);
        self::act((string) $room['id'], function (array &$r, array &$state) use ($user, $accept) {
            $mySeat = self::seatOf($state, (int) $user['id']);
            if ($mySeat === null) {
                Http::fail('أنت لست في هذه الطاولة', 403);
            }
            $requests = (array) ($state['swap'] ?? []);
            $mine = null;
            foreach ($requests as $req) {
                if ((int) $req['to'] === $mySeat) {
                    $mine = $req;
                    break;
                }
            }
            if ($mine === null) {
                Http::fail('لا يوجد طلب تبديل لك', 404, 'no_swap');
            }
            $state['swap'] = array_values(array_filter($requests, static fn($s) => (int) $s['to'] !== $mySeat));
            if ($accept) {
                $from = (int) $mine['from'];
                $a = $state['seats'][$from];
                $b = $state['seats'][$mySeat];
                $a['seat'] = $mySeat;
                $a['team'] = $mySeat % 2;
                $b['seat'] = $from;
                $b['team'] = $from % 2;
                $state['seats'][$mySeat] = $a;
                $state['seats'][$from] = $b;
                Engine::log($state, 'swap_done', ['a' => $from, 'b' => $mySeat]);
                Engine::chat($state, null, 'تم تبديل المقاعد');
            } else {
                Engine::log($state, 'swap_declined', ['seat' => $mySeat]);
            }
            return [];
        });
        return self::requireRoom((string) $room['id']);
    }

    /** إعادة ترتيب كل المقاعد (للمضيف فقط قبل بدء المباراة) */
    public static function arrange(array $user, string $idOrCode, array $order): array
    {
        $room = self::requireRoom($idOrCode);
        self::act((string) $room['id'], function (array &$r, array &$state) use ($user, $order) {
            if ((int) $r['host_id'] !== (int) $user['id']) {
                Http::fail('هذه الصلاحية لصاحب الغرفة فقط', 403, 'not_host');
            }
            if ((string) $r['status'] !== 'waiting') {
                Http::fail('لا يمكن الترتيب بعد بدء المباراة', 409, 'game_started');
            }
            $map = [];
            foreach ($state['seats'] as $seat => $pl) {
                if ($pl !== null) {
                    $map[(int) $pl['userId']] = $pl;
                }
            }
            $newSeats = [null, null, null, null];
            foreach ($order as $seat => $userId) {
                $seat = (int) $seat;
                if ($seat < 0 || $seat > 3) {
                    continue;
                }
                if ($userId === null || (int) $userId === 0) {
                    continue;
                }
                if (isset($map[(int) $userId])) {
                    $pl = $map[(int) $userId];
                    $pl['seat'] = $seat;
                    $pl['team'] = $seat % 2;
                    $newSeats[$seat] = $pl;
                }
            }
            foreach ($map as $userId => $pl) {
                if (!in_array($userId, array_map('intval', array_filter($order, static fn($v) => $v !== null)), true)) {
                    // لاعب غير مذكور في الترتيب → ضعه في أول مقعد فارغ
                    for ($i = 0; $i < 4; $i++) {
                        if ($newSeats[$i] === null) {
                            $pl['seat'] = $i;
                            $pl['team'] = $i % 2;
                            $newSeats[$i] = $pl;
                            break;
                        }
                    }
                }
            }
            $state['seats'] = $newSeats;
            Engine::log($state, 'arrange', []);
            return [];
        });
        return self::requireRoom((string) $room['id']);
    }

    /* ============================ البوتات ============================ */

    public static function addBot(array $user, string $idOrCode, ?int $seat = null): array
    {
        $room = self::requireRoom($idOrCode);
        self::act((string) $room['id'], function (array &$r, array &$state) use ($user, $seat) {
            if ((string) $r['status'] !== 'waiting') {
                Http::fail('لا يمكن إضافة بوتات بعد بدء المباراة', 409, 'game_started');
            }
            if (self::seatOf($state, (int) $user['id']) === null) {
                Http::fail('أنت لست في هذه الطاولة', 403);
            }
            $names = ['بوت سامي', 'بوت ليلى', 'بوت كريم', 'بوت نور', 'بوت هدى', 'بوت زياد'];
            $avatars = ['🤖', '👾', '🐯', '🦊', '🐬', '🦅'];
            $targets = $seat === null ? self::preferredSeats($state) : [$seat];
            if (!$targets) {
                Http::fail('لا يوجد مقعد فارغ', 409, 'no_free_seat');
            }
            $t = (int) $targets[0];
            $state['seats'][$t] = [
                'userId' => -1 - $t,
                'name' => $names[$t % count($names)],
                'avatar' => $avatars[$t % count($avatars)],
                'level' => random_int(3, 40),
                'isBot' => true,
                'connected' => true,
                'ready' => true,
                'seat' => $t,
                'team' => $t % 2,
                'lastSeen' => Engine::now(),
            ];
            Engine::log($state, 'bot_add', ['seat' => $t]);
            return [];
        });
        return self::requireRoom((string) $room['id']);
    }

    public static function removeBot(array $user, string $idOrCode, int $seat): array
    {
        $room = self::requireRoom($idOrCode);
        self::act((string) $room['id'], function (array &$r, array &$state) use ($user, $seat) {
            if ((string) $r['status'] !== 'waiting') {
                Http::fail('لا يمكن التعديل بعد بدء المباراة', 409);
            }
            $pl = $state['seats'][$seat] ?? null;
            if ($pl === null || empty($pl['isBot'])) {
                Http::fail('لا يوجد بوت في هذا المقعد', 404);
            }
            $state['seats'][$seat] = null;
            Engine::log($state, 'bot_remove', ['seat' => $seat]);
            return [];
        });
        return self::requireRoom((string) $room['id']);
    }

    /* ======================= الإعدادات والبدء ======================= */

    public static function updateSettings(array $user, string $idOrCode, array $settings): array
    {
        $room = self::requireRoom($idOrCode);
        self::act((string) $room['id'], function (array &$r, array &$state) use ($user, $settings) {
            if ((int) $r['host_id'] !== (int) $user['id']) {
                Http::fail('هذه الصلاحية لصاحب الغرفة فقط', 403, 'not_host');
            }
            if ((string) $r['status'] !== 'waiting') {
                Http::fail('لا يمكن تغيير الإعدادات بعد بدء المباراة', 409, 'game_started');
            }
            $state['settings'] = self::sanitizeSettings($settings, (array) ($state['settings'] ?? []));
            $state['target'] = (int) $state['settings']['target'];
            Engine::log($state, 'settings', ['settings' => $state['settings']]);
            return [];
        });
        return self::requireRoom((string) $room['id']);
    }

    public static function setReady(array $user, string $idOrCode, bool $ready): array
    {
        $room = self::requireRoom($idOrCode);
        self::act((string) $room['id'], function (array &$r, array &$state) use ($user, $ready) {
            $seat = self::seatOf($state, (int) $user['id']);
            if ($seat === null) {
                Http::fail('أنت لست في هذه الطاولة', 403);
            }
            $state['seats'][$seat]['ready'] = $ready;
            $state['seats'][$seat]['lastSeen'] = Engine::now();
            return [];
        });
        return self::requireRoom((string) $room['id']);
    }

    public static function start(array $user, string $idOrCode, bool $force = false): array
    {
        $room = self::requireRoom($idOrCode);
        $roomId = (string) $room['id'];
        self::act($roomId, function (array &$r, array &$state) use ($user, $force) {
            if ((string) $r['status'] !== 'waiting') {
                Http::fail('المباراة بدأت بالفعل', 409, 'already_started');
            }
            if ((int) $r['host_id'] !== (int) $user['id'] && !$force) {
                Http::fail('فقط صاحب الغرفة يمكنه بدء المباراة', 403, 'not_host');
            }
            $seats = (array) $state['seats'];
            $filled = 0;
            foreach ($seats as $pl) {
                if ($pl !== null) {
                    $filled++;
                }
            }
            if ($filled < 4) {
                Http::fail('يجب أن تكتمل الطاولة بأربعة لاعبين (أو أضف بوتات)', 409, 'not_enough_players');
            }
            $settings = self::sanitizeSettings((array) ($state['settings'] ?? []));
            $dealer = random_int(0, 3);
            $newState = ($settings['game'] ?? 'tarnib') === 'trix'
                ? Trix::newMatch($seats, $settings, $dealer, (string) $r['code'], (string) $r['name'])
                : Engine::newMatch($seats, $settings, $dealer, (string) $r['code'], (string) $r['name']);
            $newState['hostId'] = (int) $r['host_id'];
            $newState['swap'] = [];
            $newState['settings'] = $settings;
            $newState['recorded'] = false;
            if (($settings['game'] ?? 'tarnib') === 'trix') {
                Trix::chat($newState, null, 'بدأت مباراة التركس — ٤ ممالك × ٥ تسميات 🧩');
            } else {
                Engine::chat($newState, null, 'بدأت المباراة — الهدف ' . $settings['target'] . ' نقطة');
            }
            foreach ($newState['seats'] as $i => $pl) {
                if ($pl !== null) {
                    $newState['seats'][$i]['ready'] = true;
                }
            }
            foreach ($newState as $k => $v) {
                $state[$k] = $v;
            }
            $r['status'] = 'playing';
            return [];
        });
        return self::requireRoom($roomId);
    }

    public static function kick(array $user, string $idOrCode, int $seat): array
    {
        $room = self::requireRoom($idOrCode);
        self::act((string) $room['id'], function (array &$r, array &$state) use ($user, $seat) {
            if ((int) $r['host_id'] !== (int) $user['id']) {
                Http::fail('هذه الصلاحية لصاحب الغرفة فقط', 403, 'not_host');
            }
            if ((string) $r['status'] !== 'waiting') {
                Http::fail('لا يمكن الطرد بعد بدء المباراة', 409);
            }
            if (($state['seats'][$seat] ?? null) === null) {
                Http::fail('المقعد فارغ', 404);
            }
            if ((int) $state['seats'][$seat]['userId'] === (int) $user['id']) {
                Http::fail('لا يمكنك طرد نفسك', 422);
            }
            Engine::chat($state, null, (string) $state['seats'][$seat]['name'] . ' تم إخراجه من الطاولة');
            $state['seats'][$seat] = null;
            return [];
        });
        return self::requireRoom((string) $room['id']);
    }

    /** موافقة اللاعب على متابعة الجولة التالية فوراً */
    public static function continueRound(array $user, string $idOrCode): array
    {
        $room = self::requireRoom($idOrCode);
        self::act((string) $room['id'], function (array &$r, array &$state) use ($user) {
            $seat = self::seatOf($state, (int) $user['id']);
            if ($seat === null) {
                Http::fail('أنت لست في هذه الطاولة', 403);
            }
            // نهاية المباراة: يبدأ صاحب الغرفة مباراة جديدة بنفس الطاولة
            if (((($state['settings']['game'] ?? 'tarnib')) === 'trix')) {
                if (($state['phase'] ?? '') === 'round_end') {
                    Trix::continueDeal($state, (int) $seat);
                    return [];
                }
                if (($state['phase'] ?? '') === 'game_end') {
                    if ((int) $r['host_id'] !== (int) $user['id']) {
                        Http::fail('فقط صاحب الغرفة يبدأ مباراة جديدة', 403, 'not_host');
                    }
                    $settings = self::sanitizeSettings((array) ($state['settings'] ?? []), self::settings($r));
                    $newState = Trix::newMatch(
                        (array) $state['seats'],
                        $settings,
                        random_int(0, 3),
                        (string) $r['code'],
                        (string) $r['name']
                    );
                    $newState['hostId'] = (int) $r['host_id'];
                    $newState['swap'] = [];
                    $newState['settings'] = $settings;
                    $newState['recorded'] = false;
                    foreach ($newState['seats'] as $i => $pl) {
                        if ($pl !== null) {
                            $newState['seats'][$i]['ready'] = true;
                        }
                    }
                    foreach ($newState as $k => $v) {
                        $state[$k] = $v;
                    }
                    $r['status'] = 'playing';
                    return [];
                }
                return [];
            }
            if (($state['phase'] ?? '') === 'game_end') {
                if ((int) $r['host_id'] !== (int) $user['id']) {
                    Http::fail('فقط صاحب الغرفة يبدأ مباراة جديدة', 403, 'not_host');
                }
                $settings = self::sanitizeSettings((array) ($state['settings'] ?? []), self::settings($r));
                $newState = Engine::newMatch(
                    (array) $state['seats'],
                    $settings,
                    random_int(0, 3),
                    (string) $r['code'],
                    (string) $r['name']
                );
                $newState['hostId'] = (int) $r['host_id'];
                $newState['swap'] = [];
                $newState['settings'] = $settings;
                $newState['recorded'] = false;
                foreach ($newState['seats'] as $i => $pl) {
                    if ($pl !== null) {
                        $newState['seats'][$i]['ready'] = true;
                    }
                }
                Engine::chat($newState, null, 'مباراة جديدة — بالتوفيق للجميع! 🎉');
                foreach ($newState as $k => $v) {
                    $state[$k] = $v;
                }
                $r['status'] = 'playing';
                return [];
            }
            if (($state['phase'] ?? '') !== 'round_end') {
                return [];
            }
            $state['continue'] = array_values(array_unique(array_merge((array) ($state['continue'] ?? []), [$seat])));
            $state['version'] = (int) $state['version'] + 1;
            // انطلقت الجولة إذا وافق كل اللاعبين الحاضرين (غير البوتات)
            $need = [];
            foreach ((array) $state['seats'] as $i => $pl) {
                if ($pl !== null && empty($pl['isBot'])) {
                    $need[] = (int) $i;
                }
            }
            $ready = array_values(array_filter($need, static fn($i) => in_array($i, (array) $state['continue'], true)));
            if (count($ready) >= count($need)) {
                Engine::log($state, 'continue', []);
                Engine::nextRound($state);
                $state['continue'] = [];
            }
            return [];
        });
        return self::requireRoom((string) $room['id']);
    }

    /* ============================ دوران اللعبة ============================ */

    /** تحديث دور اللعبة: حسم الأكلة، دورات البوتات، المؤقتات، إنهاء الجولة */
    public static function tick(array &$room, array &$state): void
    {
        $phase = (string) ($state['phase'] ?? 'waiting');
        $now = Engine::now();
        $settings = self::sanitizeSettings((array) ($state['settings'] ?? self::settings($room)));
        $state['settings'] = $settings;

        if ($phase === 'waiting') {
            return;
        }

        // لعبة التركس لها منطقها الخاص
        if (($settings['game'] ?? 'tarnib') === 'trix') {
            if ($phase === 'game_end') {
                if (empty($state['recorded'])) {
                    self::recordTrixMatch($room, $state);
                    $state['recorded'] = true;
                    $room['status'] = 'finished';
                }
                return;
            }
            Trix::tick($state);
            return;
        }

        // حسم الأكلة بعد حركة العرض
        if ($phase === 'resolving') {
            if ($now - (float) $state['turnStartedAt'] >= 1.1) {
                Engine::resolveTrick($state);
            }
            return;
        }

        if ($phase === 'round_end') {
            if ($now - (float) $state['turnStartedAt'] >= 7.0 && empty($state['paused'])) {
                $state['continue'] = [];
                Engine::nextRound($state);
            }
            return;
        }

        if ($phase === 'game_end') {
            if (empty($state['recorded'])) {
                self::recordMatch($room, $state);
                $state['recorded'] = true;
                $room['status'] = 'finished';
            }
            return;
        }

        if (!in_array($phase, ['bidding', 'playing'], true)) {
            return;
        }

        $seat = (int) $state['turn'];
        $player = $state['seats'][$seat] ?? null;
        $elapsed = $now - (float) $state['turnStartedAt'];

        // دور بوت (زمن تفكير البوت قابل للضبط من config.php)
        if ($player !== null && !empty($player['isBot'])) {
            if ($elapsed >= (float) Config::get('bot_delay', 1.2)) {
                if (!Engine::botAct($state)) {
                    // احتياط: تجاوز الدور
                    Engine::autoAct($state, 1);
                }
            }
            return;
        }

        // انقطاع لاعب أو انتهاء الوقت
        $limit = $phase === 'bidding' ? (int) $settings['bidTime'] : (int) $settings['turnTime'];
        if ($limit > 0 && $elapsed >= (float) $limit) {
            Engine::autoAct($state, 1);
        }
    }

    /** تسجيل نتيجة المباراة وإحصاءات اللاعبين */
    private static function recordMatch(array $room, array $state): void
    {
        $seats = (array) $state['seats'];
        $ids = [];
        $names = [];
        $teamScore = [(int) ($state['scores'][0] ?? 0), (int) ($state['scores'][1] ?? 0)];
        $winner = (int) ($state['winner'] ?? 0);
        $kabootTeam = null;
        foreach ((array) ($state['log'] ?? []) as $ev) {
            if (($ev['t'] ?? '') === 'round_end' && !empty($ev['kaboot'])) {
                $bidder = null;
                foreach ((array) ($state['log'] ?? []) as $e2) {
                    if (($e2['t'] ?? '') === 'bid') {
                        $bidder = (int) $e2['seat'];
                    }
                }
                if ($bidder !== null) {
                    $kabootTeam = $bidder % 2;
                }
            }
        }
        foreach ($seats as $i => $pl) {
            $ids[] = $pl === null ? 0 : (int) $pl['userId'];
            $names[] = $pl === null ? '-' : (string) $pl['name'];
        }
        Db::insert('matches', [
            'room_code' => (string) $room['code'],
            'target' => (int) ($state['target'] ?? 31),
            'score_a' => $teamScore[0],
            'score_b' => $teamScore[1],
            'winner_team' => $winner,
            'rounds' => (int) ($state['round'] ?? 1) - 1,
            'player_ids' => json_encode($ids),
            'names' => json_encode($names, JSON_UNESCAPED_UNICODE),
            'duration' => max(1, time() - (int) ($state['createdAt'] ?? time())),
            'created_at' => time(),
        ]);
        foreach ($seats as $i => $pl) {
            if ($pl === null || !empty($pl['isBot']) || (int) $pl['userId'] <= 0) {
                continue;
            }
            $userId = (int) $pl['userId'];
            $isWinner = ((int) $i % 2) === $winner;
            Users::recordResult($userId, $isWinner, $kabootTeam !== null && $kabootTeam === ((int) $i % 2), max(1, (int) ($state['round'] ?? 1) - 1));
        }
        Engine::chat($state, null, $winner === 0 ? 'فاز الفريق الأول بالمباراة 🏆' : 'فاز الفريق الثاني بالمباراة 🏆');
    }

    /** تسجيل نتيجة مباراة التركس (لعبة فردية — الفائز صاحب أعلى مجموع) */
    private static function recordTrixMatch(array $room, array $state): void
    {
        $seats = (array) $state['seats'];
        $scores = array_map('intval', (array) ($state['scores'] ?? [0, 0, 0, 0]));
        $winner = (int) ($state['winner'] ?? 0);
        $ids = [];
        $names = [];
        foreach ($seats as $pl) {
            $ids[] = $pl === null ? 0 : (int) $pl['userId'];
            $names[] = $pl === null ? '-' : (string) $pl['name'];
        }
        Db::insert('matches', [
            'room_code' => (string) $room['code'],
            'target' => 0,
            'score_a' => (int) ($scores[0] ?? 0),
            'score_b' => (int) ($scores[1] ?? 0),
            'winner_team' => $winner,
            'rounds' => max(1, (int) ($state['dealNo'] ?? 1) - 1),
            'player_ids' => json_encode($ids),
            'names' => json_encode($names, JSON_UNESCAPED_UNICODE),
            'duration' => max(1, time() - (int) ($state['createdAt'] ?? time())),
            'created_at' => time(),
        ]);
        foreach ($seats as $i => $pl) {
            if ($pl === null || !empty($pl['isBot']) || (int) $pl['userId'] <= 0) {
                continue;
            }
            Users::recordResult((int) $pl['userId'], (int) $i === $winner, false, max(1, (int) ($state['dealNo'] ?? 1) - 1));
        }
        Trix::chat($state, null, 'انتهت مباراة التركس 🏆');
    }

    /* ============================ العرض ============================ */

    /** حالة الغرفة كما يراها لاعب معيّن */
    public static function view(array $room, array $state, int $userId): array
    {
        $seat = self::seatOf($state, $userId);
        $phase = (string) ($state['phase'] ?? 'waiting');

        if ($phase === 'waiting' || $seat === null) {
            $view = self::waitingView($room, $state, $userId, $seat);
        } else {
            $isTrix = ((($state['settings']['game'] ?? 'tarnib')) === 'trix');
            $view = $isTrix ? Trix::publicView($state, $seat) : Engine::publicView($state, $seat);
            $view['roomId'] = (string) $room['id'];
            $view['roomCode'] = (string) $room['code'];
            $view['roomName'] = (string) $room['name'];
            $view['hostId'] = (int) $room['host_id'];
            $view['status'] = (string) $room['status'];
            $view['isHost'] = (int) $room['host_id'] === $userId;
            $view['isSpectator'] = false;
            $view['settings'] = (array) ($state['settings'] ?? self::settings($room));
            $view['swapRequests'] = array_values(array_filter((array) ($state['swap'] ?? []), static fn($s) => (int) $s['to'] === $seat));
            $view['allReady'] = self::allReady($state);
        }
        return $view;
    }

    public static function waitingView(array $room, array $state, int $userId, ?int $seat): array
    {
        $settings = self::sanitizeSettings((array) ($state['settings'] ?? []));
        $seatsOut = [];
        foreach ($state['seats'] as $i => $pl) {
            if ($pl === null) {
                $seatsOut[] = null;
                continue;
            }
            $lastSeen = (int) ($pl['lastSeen'] ?? 0);
            $seatsOut[] = [
                'userId' => (int) $pl['userId'],
                'name' => (string) $pl['name'],
                'avatar' => (string) $pl['avatar'],
                'level' => (int) ($pl['level'] ?? 1),
                'isBot' => !empty($pl['isBot']),
                'connected' => !empty($pl['connected']) && (Engine::now() - $lastSeen < self::PRESENCE_SECONDS),
                'ready' => !empty($pl['ready']),
                'seat' => (int) $i,
                'team' => (int) $i % 2,
            ];
        }
        return [
            'version' => (int) ($state['version'] ?? 1),
            'roomId' => (string) $room['id'],
            'roomCode' => (string) $room['code'],
            'roomName' => (string) $room['name'],
            'hostId' => (int) $room['host_id'],
            'isHost' => (int) $room['host_id'] === $userId,
            'status' => (string) $room['status'],
            'phase' => 'waiting',
            'seats' => $seatsOut,
            'mySeat' => $seat,
            'isSpectator' => $seat === null,
            'settings' => $settings,
            'target' => (int) $settings['target'],
            'scores' => [(int) ($state['scores'][0] ?? 0), (int) ($state['scores'][1] ?? 0)],
            'round' => (int) ($state['round'] ?? 0),
            'log' => array_slice((array) ($state['log'] ?? []), -40),
            'chat' => array_slice((array) ($state['chat'] ?? []), -60),
            'swapRequests' => $seat === null ? [] : array_values(array_filter((array) ($state['swap'] ?? []), static fn($s) => (int) $s['to'] === $seat)),
            'allReady' => self::allReady($state),
            'myHand' => [],
            'handCounts' => [0, 0, 0, 0],
            'trick' => [],
            'tricksWon' => [0, 0],
            'bid' => ['value' => null, 'seat' => null, 'doubled' => false, 'passed' => []],
            'trump' => null,
            'deadline' => null,
            'isMyTurn' => false,
            'legalCards' => [],
            'legalBids' => [],
            'canPass' => false,
            'canDouble' => false,
            'winnerTeam' => null,
            'lastRoundSummary' => null,
            'lastTrick' => null,
            'trickLeader' => 0,
            'dealer' => 0,
            'turn' => -1,
            'myTeam' => $seat === null ? 0 : $seat % 2,
            'roundBids' => (object) [],
            'revealed' => null,
        ];
    }

    private static function allReady(array $state): bool
    {
        $count = 0;
        foreach ($state['seats'] as $pl) {
            if ($pl === null) {
                continue;
            }
            $count++;
            if (empty($pl['ready']) && empty($pl['isBot'])) {
                return false;
            }
        }
        return $count === 4;
    }

    /** تحديث آخر ظهور للاعب (بدون تغيير رقم النسخة إلا عند تغيّر حالة الاتصال) */
    public static function heartbeat(array &$state, int $userId): bool
    {
        $changed = false;
        foreach ($state['seats'] as $i => $pl) {
            if ($pl === null) {
                continue;
            }
            if ((int) $pl['userId'] === $userId && empty($pl['isBot'])) {
                $state['seats'][$i]['lastSeen'] = Engine::now();
                if (empty($state['seats'][$i]['connected'])) {
                    $state['seats'][$i]['connected'] = true;
                    Engine::log($state, 'online', ['seat' => (int) $i]);
                    $changed = true;
                }
            } elseif (empty($pl['isBot']) && !empty($pl['connected'])
                && Engine::now() - (float) ($pl['lastSeen'] ?? 0) > self::PRESENCE_SECONDS
                && in_array((string) ($state['phase'] ?? 'waiting'), ['waiting', 'bidding', 'playing', 'resolving', 'round_end'], true)) {
                $state['seats'][$i]['connected'] = false;
                Engine::log($state, 'offline', ['seat' => (int) $i]);
                $changed = true;
            }
        }
        return $changed;
    }

    /* ============================ الطلبات ============================ */

    /** قائمة الغرف العامة */
    public static function roomList(int $limit = 30): array
    {
        $rows = Db::all(
            "SELECT * FROM rooms WHERE is_private = 0 AND password = '' AND status IN ('waiting','playing') AND last_activity > ? ORDER BY (status = 'waiting') DESC, last_activity DESC LIMIT ?",
            [time() - 3600, max(1, min(60, $limit))]
        );
        $out = [];
        foreach ($rows as $row) {
            $state = self::decode($row);
            $players = 0;
            $human = 0;
            foreach ((array) ($state['seats'] ?? []) as $pl) {
                if ($pl !== null) {
                    $players++;
                    if (empty($pl['isBot'])) {
                        $human++;
                    }
                }
            }
            $out[] = [
                'id' => (string) $row['id'],
                'code' => (string) $row['code'],
                'name' => (string) $row['name'],
                'status' => (string) $row['status'],
                'players' => $players,
                'humans' => $human,
                'maxPlayers' => 4,
                'game' => (string) (($state['settings']['game'] ?? self::settings($row)['game'] ?? 'tarnib')),
                'kingdoms' => (int) (($state['settings']['kingdoms'] ?? 4)),
                'target' => (int) (($state['settings']['target'] ?? self::settings($row)['target'])),
                'round' => (int) ($state['round'] ?? 0),
                'scores' => [(int) ($state['scores'][0] ?? 0), (int) ($state['scores'][1] ?? 0)],
                'hasPassword' => $row['password'] !== '',
                'updatedAt' => (int) $row['last_activity'],
            ];
        }
        return $out;
    }

    /** الاستعلام الطويل (Long Polling) لمزامنة الطاولة */
    public static function poll(string $idOrCode, array $user, int $since, int $waitSeconds): array
    {
        $maxWait = min(max(1, $waitSeconds), (int) Config::get('poll_wait', 25));
        $deadline = microtime(true) + $maxWait;
        $room = self::requireRoom($idOrCode);
        $roomId = (string) $room['id'];
        $userId = (int) $user['id'];
        $result = null;

        do {
            $result = self::act($roomId, function (array &$r, array &$state) use ($userId, $since, &$changedOut) {
                $changed = self::heartbeat($state, $userId);
                self::tick($r, $state);
                $changed = $changed || ((int) ($state['version'] ?? 0) > $since);
                $changedOut = $changed;
                return ['changed' => $changed];
            });
            if (!empty($result['changed'])) {
                break;
            }
            usleep(400000); // 0.4 ثانية
        } while (microtime(true) < $deadline);

        $fresh = self::requireRoom($roomId);
        $state = self::decode($fresh);
        $view = self::view($fresh, $state, $userId);
        $view['changed'] = (int) ($state['version'] ?? 0) > $since;
        $view['serverTime'] = Engine::now();
        return $view;
    }

    /** تغيير الاسم/الخصوصية للغرفة */
    public static function rename(array $user, string $idOrCode, string $name, bool $isPrivate): array
    {
        $room = self::requireRoom($idOrCode);
        self::act((string) $room['id'], function (array &$r, array &$state) use ($user, $name, $isPrivate) {
            if ((int) $r['host_id'] !== (int) $user['id']) {
                Http::fail('هذه الصلاحية لصاحب الغرفة فقط', 403, 'not_host');
            }
            $fields = ['is_private' => $isPrivate ? 1 : 0];
            if ($name !== '') {
                $fields['name'] = mb_substr(trim($name), 0, 30);
                $state['roomName'] = $fields['name'];
            }
            Db::update('rooms', $fields, 'id = ?', [$r['id']]);
            Engine::log($state, 'room_update', []);
            return [];
        });
        return self::requireRoom((string) $room['id']);
    }

    /** حذف الغرف الميتة */
    public static function cleanup(): void
    {
        Db::exec('DELETE FROM rooms WHERE last_activity < ? AND status != ?', [time() - 5400, 'playing']);
        Db::exec('DELETE FROM rooms WHERE last_activity < ?', [time() - 10800]);
    }
}
