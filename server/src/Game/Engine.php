<?php
declare(strict_types=1);

namespace Trix\Game;

/**
 * محرك لعبة الطرنيب — القوانين الكاملة (نسخة الخادم المرجعية)
 * -----------------------------------------------------------------
 * - 52 ورقة، 4 لاعبين في فريقين، الشركاء متقابلان.
 * - الهدف: الوصول إلى النقاط المحددة (31 / 41 / 61).
 * - المزايدة: تبدأ من يمين الموزع وتدور بعكس عقارب الساعة، أقل طلب 7 وأعلى 13،
 *   كل طلب أعلى من السابق، والتمرير يخرج اللاعب من المزاد، ومن يمرّر لا يعود.
 * - من يفوز بالمزاد يحدد الطرنيب ويلعب أول ورقة.
 * - اللعب: إلزام اتباع اللون إن أمكن، والطرنيب غير إلزامي، والفائز بالأكلة
 *   هو صاحب أعلى ورقة من الطرنيب، أو أعلى ورقة من اللون المطروح إن خلت الأكلة من الطرنيب.
 * - النقاط: نجاح الطلب → نقاط الفريق = عدد أكلاته (أو 16 عند الكبوت، 26 عند طلب 13 وكسبها).
 *   فشل الطلب → خصم قيمة الطلب من الفريق، والخصم يسجل أكلاته (تُضاعف عند فشل طلب الـ13).
 *   المضاعفة (اختيارية) تضاعف مكسب/خسارة الفريق الطالب فقط.
 */
final class Engine
{
    public const SUITS = ['C', 'D', 'H', 'S'];
    public const SUIT_NAMES = ['C' => 'كبة', 'D' => 'ديناري', 'H' => 'كوبا', 'S' => 'بستوني'];
    public const MIN_BID = 7;
    public const MAX_BID = 13;
    public const TRICKS_PER_ROUND = 13;

    /* ============================ الورق ============================ */

    /** بناء طقم الورق كاملاً */
    public static function deck(): array
    {
        $deck = [];
        foreach (self::SUITS as $s) {
            for ($r = 2; $r <= 14; $r++) {
                $deck[] = $s . $r;
            }
        }
        return $deck;
    }

    /**
     * الوقت الحالي بالثواني (مع الكسور) — عدد عشري لتفادي تجاوز الأعداد الصحيحة
     * على الاستضافات ذات 32-بت، وبدقة كافية لمؤقتات اللعب.
     */
    public static function now(): float
    {
        return microtime(true);
    }

    /** خلط قابل للتكرار عبر بذرة عشوائية ( للتأكد من نزاهة التوزيع ) */
    public static function shuffle(array $deck, int $seed): array
    {
        mt_srand($seed);
        for ($i = count($deck) - 1; $i > 0; $i--) {
            $j = mt_rand(0, $i);
            $tmp = $deck[$i];
            $deck[$i] = $deck[$j];
            $deck[$j] = $tmp;
        }
        mt_srand();
        return $deck;
    }

    public static function suit(string $code): string { return $code[0]; }
    public static function rank(string $code): int { return (int) substr($code, 1); }

    /* ============================ الحالة ============================ */

    /**
     * إنشاء مباراة جديدة
     * @param array $seats مصفوفة من 4 عناصر: ['userId'=>int,'name'=>string,'avatar'=>string,'level'=>int,'isBot'=>bool] أو null
     */
    public static function newMatch(array $seats, array $settings, int $dealer = 0, string $roomCode = '', string $roomName = ''): array
    {
        $state = [
            'phase' => 'bidding',
            'seats' => $seats,
            'hands' => [[], [], [], []],
            'dealer' => $dealer,
            'turn' => ($dealer + 1) % 4,
            'bid' => ['value' => null, 'seat' => null, 'doubled' => false, 'doubledBy' => null, 'passed' => [], 'history' => []],
            'trump' => null,
            'trick' => [],
            'trickLeader' => 0,
            'lastTrick' => null,
            'tricks' => [0, 0],
            'scores' => [0, 0],
            'round' => 1,
            'roundBids' => new \stdClass(),
            'target' => (int) ($settings['target'] ?? 31),
            'settings' => $settings,
            'winner' => null,
            'summary' => null,
            'revealed' => null,
            'log' => [],
            'chat' => [],
            'version' => 1,
            'eventId' => 0,
            'chatId' => 0,
            'seed' => 0,
            'turnStartedAt' => self::now(),
            'createdAt' => time(),
            'updatedAt' => time(),
            'roomCode' => $roomCode,
            'roomName' => $roomName,
            'lastActivity' => time(),
        ];
        self::startRound($state);
        return $state;
    }

    /** توزيع جولة جديدة */
    public static function startRound(array &$s): void
    {
        $seed = random_int(1000, 2000000000); // بذرة آمنة على 32-بت و64-بت
        $s['seed'] = $seed;
        $deck = self::shuffle(self::deck(), $seed);
        for ($i = 0; $i < 4; $i++) {
            $hand = array_slice($deck, $i * 13, 13);
            sort($hand, SORT_STRING);
            $s['hands'][$i] = $hand;
        }
        $s['phase'] = 'bidding';
        $s['trump'] = null;
        $s['trick'] = [];
        $s['played'] = [];
        $s['lastTrick'] = null;
        $s['tricks'] = [0, 0];
        $s['roundBids'] = new \stdClass();
        $s['summary'] = null;
        $s['revealed'] = null;
        $s['bid'] = ['value' => null, 'seat' => null, 'doubled' => false, 'doubledBy' => null, 'passed' => [], 'history' => []];
        $s['turn'] = ($s['dealer'] + 1) % 4;
        $s['turnStartedAt'] = self::now();
        $s['updatedAt'] = time();
        $s['lastActivity'] = time();
        self::log($s, 'deal', ['round' => $s['round'], 'dealer' => $s['dealer']]);
        self::turnEvent($s);
    }

    public static function log(array &$s, string $type, array $data = []): void
    {
        $s['eventId'] = (int) ($s['eventId'] ?? 0) + 1;
        $s['log'][] = array_merge(['id' => $s['eventId'], 't' => $type, 'at' => time()], $data);
        if (count($s['log']) > 120) {
            $s['log'] = array_slice($s['log'], -120);
        }
        $s['version'] = (int) ($s['version'] ?? 0) + 1;
    }

    private static function turnEvent(array &$s): void
    {
        self::log($s, 'turn', ['seat' => (int) $s['turn']]);
    }

    public static function chat(array &$s, ?int $seat, string $text, ?string $emoji = null): void
    {
        $s['chatId'] = (int) ($s['chatId'] ?? 0) + 1;
        $name = $seat === null ? 'النظام' : (string) ($s['seats'][$seat]['name'] ?? '—');
        $s['chat'][] = ['id' => $s['chatId'], 'seat' => $seat, 'name' => $name, 'text' => mb_substr($text, 0, 200), 'emoji' => $emoji, 'at' => time()];
        if (count($s['chat']) > 80) {
            $s['chat'] = array_slice($s['chat'], -80);
        }
        $s['version'] = (int) $s['version'] + 1;
        $s['lastActivity'] = time();
    }

    /* =========================== المزايدة =========================== */

    public static function legalBids(?int $current): array
    {
        $start = $current === null ? self::MIN_BID : $current + 1;
        $out = [];
        for ($v = $start; $v <= self::MAX_BID; $v++) {
            $out[] = $v;
        }
        return $out;
    }

    /** تنفيذ عملية مزايدة: action = bid|pass|double */
    public static function applyBid(array &$s, int $seat, string $action, ?int $value = null): void
    {
        if ($s['phase'] !== 'bidding') {
            throw new \RuntimeException('المزايدة انتهت');
        }
        if ((int) $s['turn'] !== $seat) {
            throw new \RuntimeException('ليس دورك');
        }
        if (in_array($seat, $s['bid']['passed'], true)) {
            throw new \RuntimeException('لقد مرّرت سابقاً');
        }
        if ($action === 'bid') {
            $allowed = self::legalBids($s['bid']['value']);
            if ($value === null || !in_array($value, $allowed, true)) {
                throw new \RuntimeException('قيمة الطلب غير مسموحة');
            }
            $s['bid']['value'] = $value;
            $s['bid']['seat'] = $seat;
            $s['bid']['doubled'] = false;
            $s['bid']['doubledBy'] = null;
            $bids = (array) $s['roundBids'];
            $bids[$seat] = $value;
            $s['roundBids'] = $bids;
            $s['bid']['history'][] = ['seat' => $seat, 'action' => 'bid', 'value' => $value];
            self::log($s, 'bid', ['seat' => $seat, 'value' => $value]);
        } elseif ($action === 'pass') {
            $s['bid']['passed'][] = $seat;
            $s['bid']['history'][] = ['seat' => $seat, 'action' => 'pass'];
            self::log($s, 'pass', ['seat' => $seat]);
        } elseif ($action === 'double') {
            $settings = $s['settings'];
            if (empty($settings['allowDouble'])) {
                throw new \RuntimeException('المضاعفة غير مسموحة في هذه الغرفة');
            }
            if ($s['bid']['value'] === null || $s['bid']['seat'] === null) {
                throw new \RuntimeException('لا يوجد طلب لمضاعفته');
            }
            if (($s['bid']['seat'] % 2) === ($seat % 2)) {
                throw new \RuntimeException('لا يمكنك مضاعفة طلب شريكك');
            }
            if (!empty($s['bid']['doubled'])) {
                throw new \RuntimeException('الطلب مضاعف مسبقاً');
            }
            $s['bid']['doubled'] = true;
            $s['bid']['doubledBy'] = $seat;
            $s['bid']['history'][] = ['seat' => $seat, 'action' => 'double'];
            self::log($s, 'double', ['seat' => $seat, 'value' => $s['bid']['value']]);
        } else {
            throw new \RuntimeException('إجراء غير معروف');
        }
        self::advanceBidding($s);
        $s['turnStartedAt'] = self::now();
        $s['updatedAt'] = time();
        $s['lastActivity'] = time();
    }

    private static function advanceBidding(array &$s): void
    {
        $passed = $s['bid']['passed'];
        $active = array_values(array_diff([0, 1, 2, 3], $passed));
        if ($s['bid']['value'] === null && count($passed) >= 4) {
            self::log($s, 'redeal', ['text' => 'الجميع مرّر — إعادة توزيع الورق']);
            self::startRound($s);
            return;
        }
        if ($s['bid']['value'] !== null && $s['bid']['seat'] !== null && count($active) <= 1) {
            $s['turn'] = (int) $s['bid']['seat'];
            self::log($s, 'auction_end', ['seat' => $s['bid']['seat'], 'value' => $s['bid']['value'], 'doubled' => $s['bid']['doubled']]);
            return;
        }
        $next = ((int) $s['turn'] + 1) % 4;
        $guard = 0;
        while (in_array($next, $passed, true) && $guard++ < 4) {
            $next = ($next + 1) % 4;
        }
        $s['turn'] = $next;
        self::turnEvent($s);
    }

    /** اختيار لون الطرنيب من الفائز بالمزاد */
    public static function applyTrump(array &$s, int $seat, string $suit): void
    {
        if ($s['phase'] !== 'bidding') {
            throw new \RuntimeException('لا يمكن اختيار الطرنيب الآن');
        }
        if ($s['bid']['value'] === null || (int) $s['bid']['seat'] !== $seat) {
            throw new \RuntimeException('أنت لست صاحب المزاد');
        }
        if ($suit === 'NT' && empty($s['settings']['allowNoTrump'])) {
            throw new \RuntimeException('الطلب بدون طرنيب غير مسموح');
        }
        if ($suit !== 'NT' && !in_array($suit, self::SUITS, true)) {
            throw new \RuntimeException('لون غير صحيح');
        }
        if ($suit !== 'NT' && !empty($s['settings']['requireTrumpInHand']) && !self::handHasSuit($s['hands'][$seat], $suit)) {
            throw new \RuntimeException('يجب أن تملك ورقة من لون الطرنيب');
        }
        $s['trump'] = $suit;
        $s['phase'] = 'playing';
        $s['turn'] = $seat;
        $s['trickLeader'] = $seat;
        self::log($s, 'trump', ['seat' => $seat, 'suit' => $suit]);
        self::turnEvent($s);
        $s['turnStartedAt'] = self::now();
        $s['lastActivity'] = time();
    }

    private static function handHasSuit(array $hand, string $suit): bool
    {
        foreach ($hand as $c) {
            if ($c[0] === $suit) {
                return true;
            }
        }
        return false;
    }

    /* ============================ اللعب ============================ */

    /** الأوراق المسموح لعبها */
    public static function legalPlays(array $hand, array $trick): array
    {
        if (empty($trick)) {
            return array_values($hand);
        }
        $led = $trick[0]['card'][0];
        $same = [];
        foreach ($hand as $c) {
            if ($c[0] === $led) {
                $same[] = $c;
            }
        }
        return $same ?: array_values($hand);
    }

    /** الفائز بالأكلة */
    public static function trickWinner(array $trick, ?string $trump): int
    {
        $best = $trick[0];
        $led = $trick[0]['card'][0];
        for ($i = 1; $i < count($trick); $i++) {
            if (self::beats($trick[$i]['card'], $best['card'], $led, $trump)) {
                $best = $trick[$i];
            }
        }
        return (int) $best['seat'];
    }

    public static function beats(string $challenger, string $current, string $led, ?string $trump): bool
    {
        $cTrump = $trump !== null && $trump !== 'NT' && $challenger[0] === $trump;
        $wTrump = $trump !== null && $trump !== 'NT' && $current[0] === $trump;
        if ($cTrump && !$wTrump) return true;
        if (!$cTrump && $wTrump) return false;
        if ($cTrump && $wTrump) return self::rank($challenger) > self::rank($current);
        $cLed = $challenger[0] === $led;
        $wLed = $current[0] === $led;
        if ($cLed && !$wLed) return true;
        if (!$cLed && $wLed) return false;
        if (!$cLed && !$wLed) return false;
        return self::rank($challenger) > self::rank($current);
    }

    public static function applyPlay(array &$s, int $seat, string $code): void
    {
        if ($s['phase'] !== 'playing') {
            throw new \RuntimeException('اللعب غير جارٍ');
        }
        if ((int) $s['turn'] !== $seat) {
            throw new \RuntimeException('ليس دورك');
        }
        $hand = $s['hands'][$seat];
        if (!in_array($code, $hand, true)) {
            throw new \RuntimeException('هذه الورقة ليست في يدك');
        }
        $legal = self::legalPlays($hand, $s['trick']);
        if (!in_array($code, $legal, true)) {
            throw new \RuntimeException('يجب اتباع اللون المطروح');
        }
        $s['hands'][$seat] = array_values(array_diff($hand, [$code]));
        $s['trick'][] = ['seat' => $seat, 'card' => $code];
        $s['played'][] = $code;
        self::log($s, 'play', ['seat' => $seat, 'card' => $code]);
        if (count($s['trick']) === 4) {
            $s['phase'] = 'resolving';
            $s['turnStartedAt'] = self::now();
            $s['lastActivity'] = time();
            return;
        }
        $s['turn'] = ($seat + 1) % 4;
        self::turnEvent($s);
        $s['turnStartedAt'] = self::now();
        $s['updatedAt'] = time();
        $s['lastActivity'] = time();
    }

    /** حسم الأكلة بعد اكتمال 4 أوراق */
    public static function resolveTrick(array &$s): void
    {
        if ($s['phase'] !== 'resolving' || count($s['trick']) < 4) {
            return;
        }
        $winner = self::trickWinner($s['trick'], $s['trump']);
        $team = $winner % 2;
        $s['tricks'][$team] = (int) $s['tricks'][$team] + 1;
        $s['lastTrick'] = ['leader' => (int) $s['trick'][0]['seat'], 'cards' => $s['trick'], 'winner' => $winner];
        $s['trick'] = [];
        $s['turn'] = $winner;
        $s['trickLeader'] = $winner;
        $s['phase'] = 'playing';
        self::log($s, 'trick', ['seat' => $winner, 'team' => $team, 'tricks' => $s['tricks'][$team]]);
        if ((int) $s['tricks'][0] + (int) $s['tricks'][1] >= self::TRICKS_PER_ROUND) {
            self::endRound($s);
            return;
        }
        self::turnEvent($s);
        $s['turnStartedAt'] = self::now();
        $s['updatedAt'] = time();
        $s['lastActivity'] = time();
    }

    /* =========================== حساب النقاط =========================== */

    public static function endRound(array &$s): void
    {
        $bid = (int) $s['bid']['value'];
        $bidder = (int) $s['bid']['seat'];
        $bidTeam = $bidder % 2;
        $trickA = (int) $s['tricks'][0];
        $trickB = (int) $s['tricks'][1];
        $bidTricks = $bidTeam === 0 ? $trickA : $trickB;
        $defTricks = $bidTeam === 0 ? $trickB : $trickA;
        $doubled = !empty($s['bid']['doubled']);
        $made = $bidTricks >= $bid;
        $kaboot = $bidTricks === self::TRICKS_PER_ROUND;
        $delta = [0, 0];
        $defFactor = 1;

        if ($made) {
            if ($bid === 13) {
                $delta[$bidTeam] = 26;
            } elseif ($kaboot) {
                $delta[$bidTeam] = 16;
            } else {
                $delta[$bidTeam] = $bidTricks;
            }
            if ($doubled) {
                $delta[$bidTeam] = $bid === 13 ? 52 : $delta[$bidTeam] * 2;
            }
        } else {
            if ($bid === 13) {
                $delta[$bidTeam] = -16;
                $defFactor = 2;
            } else {
                $delta[$bidTeam] = $doubled ? -2 * $bid : -$bid;
            }
            $delta[$bidTeam === 0 ? 1 : 0] = $defTricks * $defFactor;
        }

        $s['scores'][0] = (int) $s['scores'][0] + $delta[0];
        $s['scores'][1] = (int) $s['scores'][1] + $delta[1];
        $s['summary'] = [
            'round' => (int) $s['round'],
            'bid' => $bid,
            'bidder' => $bidder,
            'team' => $bidTeam,
            'made' => $made,
            'teamTricks' => $bidTricks,
            'trump' => $s['trump'],
            'delta' => $delta,
            'scores' => $s['scores'],
            'kaboot' => $kaboot,
            'doubled' => $doubled,
        ];
        $s['revealed'] = $s['hands'];
        $s['phase'] = 'round_end';
        self::log($s, 'round_end', [
            'round' => (int) $s['round'],
            'made' => $made,
            'delta' => $delta,
            'scores' => $s['scores'],
            'kaboot' => $kaboot,
        ]);
        $target = (int) $s['target'];
        if ((int) $s['scores'][0] >= $target || (int) $s['scores'][1] >= $target) {
            $s['winner'] = (int) $s['scores'][0] >= $target ? 0 : 1;
            $s['phase'] = 'game_end';
            self::log($s, 'game_end', ['team' => $s['winner'], 'scores' => $s['scores']]);
        }
        $s['updatedAt'] = time();
        $s['lastActivity'] = time();
    }

    /* ====================== الأحداث التلقائية (المؤقت) ====================== */

    /**
     * تنفيذ الخطوة التلقائية عند انتهاء وقت الدور أو انقطاع اللاعب
     * @return bool هل حدث تغيير؟
     */
    public static function autoAct(array &$s, int $timeoutSeconds): bool
    {
        if (!in_array($s['phase'], ['bidding', 'playing', 'resolving'], true)) {
            return false;
        }
        if ($s['phase'] === 'resolving') {
            self::resolveTrick($s);
            return true;
        }
        if ($timeoutSeconds <= 0) {
            return false;
        }
        if (self::now() - (float) $s['turnStartedAt'] < $timeoutSeconds) {
            return false;
        }
        $seat = (int) $s['turn'];
        if ($s['phase'] === 'bidding') {
            if ($s['bid']['seat'] === $seat && $s['bid']['value'] !== null) {
                // عليه اختيار الطرنيب → يختار أطول لون
                $suit = self::bestSuitFor($s['hands'][$seat]);
                self::applyTrump($s, $seat, $suit);
                self::log($s, 'timeout', ['seat' => $seat, 'action' => 'trump_auto']);
                return true;
            }
            self::applyBid($s, $seat, 'pass');
            self::log($s, 'timeout', ['seat' => $seat, 'action' => 'pass']);
            return true;
        }
        // اللعب: أقل ورقة قانونية
        $legal = self::legalPlays($s['hands'][$seat], $s['trick']);
        usort($legal, static fn($a, $b) => self::rank($a) <=> self::rank($b));
        self::applyPlay($s, $seat, $legal[0]);
        self::log($s, 'timeout', ['seat' => $seat, 'action' => 'play']);
        return true;
    }

    public static function bestSuitFor(array $hand): string
    {
        $counts = ['C' => 0, 'D' => 0, 'H' => 0, 'S' => 0];
        $power = ['C' => 0, 'D' => 0, 'H' => 0, 'S' => 0];
        foreach ($hand as $c) {
            $counts[$c[0]]++;
            $r = self::rank($c);
            $power[$c[0]] += [14 => 3.0, 13 => 2.0, 12 => 1.1, 11 => 0.6, 10 => 0.4, 9 => 0.2][$r] ?? 0.05;
        }
        $best = 'S';
        $bestScore = -1;
        foreach (self::SUITS as $suit) {
            $score = $power[$suit] + $counts[$suit] * 0.45;
            if ($score > $bestScore) {
                $bestScore = $score;
                $best = $suit;
            }
        }
        return $best;
    }

    /** بدء الجولة التالية */
    public static function nextRound(array &$s): void
    {
        if ($s['phase'] !== 'round_end') {
            return;
        }
        $s['dealer'] = ((int) $s['dealer'] + 1) % 4;
        $s['round'] = (int) $s['round'] + 1;
        self::startRound($s);
    }

    /* ============================= العرض ============================= */

    /** حالة الطاولة الخاصة بلاعب معيّن (لا تكشف أوراق الآخرين) */
    public static function publicView(array $s, int $seat): array
    {
        $myTurn = (int) $s['turn'] === $seat
            && in_array($s['phase'], ['bidding', 'playing'], true);
        $legal = [];
        if ($s['phase'] === 'playing' && $myTurn && count($s['trick']) < 4) {
            $legal = self::legalPlays($s['hands'][$seat], $s['trick']);
        }
        $canBidNow = $s['phase'] === 'bidding' && $myTurn && !in_array($seat, $s['bid']['passed'], true);
        $isDeclarerChoosingTrump = $s['phase'] === 'bidding'
            && $s['bid']['seat'] === $seat
            && $s['bid']['value'] !== null
            && $myTurn;

        $seats = [];
        foreach ($s['seats'] as $pl) {
            if ($pl === null) {
                $seats[] = null;
                continue;
            }
            $seats[] = [
                'userId' => (int) $pl['userId'],
                'name' => $pl['name'],
                'avatar' => $pl['avatar'],
                'level' => (int) ($pl['level'] ?? 1),
                'isBot' => !empty($pl['isBot']),
                'connected' => !empty($pl['connected']),
                'ready' => !empty($pl['ready']),
                'seat' => (int) $pl['seat'],
                'team' => ((int) $pl['seat']) % 2,
            ];
        }
        $handCounts = [];
        for ($i = 0; $i < 4; $i++) {
            $handCounts[] = count($s['hands'][$i] ?? []);
        }
        $myHand = $s['hands'][$seat] ?? [];
        sort($myHand, SORT_STRING);
        $settings = $s['settings'];
        $deadline = null;
        if (in_array($s['phase'], ['bidding', 'playing'], true)) {
            $limit = $s['phase'] === 'bidding' ? (int) ($settings['bidTime'] ?? 30) : (int) ($settings['turnTime'] ?? 30);
            if ($limit > 0) {
                // نرسل الوقت المتبقي بالمللي ثانية (رقم صغير آمن على كل الاستضافات)
                $deadline = max(0, (int) round(((float) $s['turnStartedAt'] + $limit - self::now()) * 1000));
            }
        }

        return [
            'version' => (int) $s['version'],
            'roomCode' => (string) ($s['roomCode'] ?? ''),
            'roomName' => (string) ($s['roomName'] ?? ''),
            'phase' => $s['phase'] === 'resolving' ? 'playing' : $s['phase'],
            'seats' => $seats,
            'mySeat' => $seat,
            'dealer' => (int) $s['dealer'],
            'turn' => (int) $s['turn'],
            'myHand' => array_values($myHand),
            'revealed' => in_array($s['phase'], ['round_end', 'game_end'], true) ? ($s['revealed'] ?? null) : null,
            'handCounts' => $handCounts,
            'trick' => $s['trick'],
            'trickLeader' => (int) $s['trickLeader'],
            'lastTrick' => $s['lastTrick'],
            'tricksWon' => [(int) $s['tricks'][0], (int) $s['tricks'][1]],
            'bid' => [
                'value' => $s['bid']['value'],
                'seat' => $s['bid']['seat'],
                'doubled' => (bool) $s['bid']['doubled'],
                'doubledBy' => $s['bid']['doubledBy'],
                'passed' => $s['bid']['passed'],
                'eligible' => $s['bid']['passed'],
            ],
            'trump' => $s['trump'],
            'scores' => [(int) $s['scores'][0], (int) $s['scores'][1]],
            'round' => (int) $s['round'],
            'roundBids' => (object) (array) $s['roundBids'],
            'target' => (int) $s['target'],
            'settings' => $settings,
            'deadline' => $deadline,
            'log' => array_slice($s['log'], -60),
            'chat' => array_slice($s['chat'], -60),
            'myTeam' => $seat % 2,
            'isMyTurn' => $myTurn,
            'legalCards' => array_values($legal),
            'legalBids' => $canBidNow && !$isDeclarerChoosingTrump ? self::legalBids($s['bid']['value']) : [],
            'canPass' => $canBidNow && $s['bid']['value'] !== null && !$isDeclarerChoosingTrump,
            'canDouble' => $canBidNow && !empty($settings['allowDouble']) && !$s['bid']['doubled']
                && $s['bid']['seat'] !== null && ((int) $s['bid']['seat'] % 2) !== ($seat % 2),
            'mustChooseTrump' => $isDeclarerChoosingTrump,
            'wonTrick' => in_array($s['phase'], ['playing', 'resolving'], true) && count($s['trick']) === 4,
            'winnerTeam' => $s['winner'],
            'lastRoundSummary' => $s['summary'],
        ];
    }

    /** ملخص الغرفة لعرضها في قائمة الغرف */
    public static function lobbyInfo(array $s): array
    {
        $players = 0;
        foreach ($s['seats'] as $pl) {
            if ($pl !== null) {
                $players++;
            }
        }
        return [
            'players' => $players,
            'phase' => $s['phase'],
            'scores' => [(int) $s['scores'][0], (int) $s['scores'][1]],
            'round' => (int) $s['round'],
            'target' => (int) $s['target'],
        ];
    }

    /* ============================ البوتات ============================ */

    /**
     * قوة اليد المتوقعة (بالأكلات) — مُعايرة بمحاكاة كاملة (انظر client/src/game/bots.ts)
     * تعتمد على رؤوس اللون الطرنيبي وطول الألوان الجانبية والقطع المحتمل.
     */
    public static function estimateTricks(array $hand, ?string $trump): float
    {
        $trumpPower = [14 => 1.15, 13 => 0.95, 12 => 0.75, 11 => 0.5, 10 => 0.3, 9 => 0.15];
        $sidePower = [14 => 0.95, 13 => 0.6, 12 => 0.32, 11 => 0.16, 10 => 0.08];
        $tricks = 0.0;
        foreach (self::SUITS as $suit) {
            $cards = [];
            foreach ($hand as $c) {
                if ($c[0] === $suit) {
                    $cards[] = self::rank($c);
                }
            }
            rsort($cards);
            if (!$cards) {
                continue;
            }
            if ($suit === $trump) {
                $tricks += $trumpPower[$cards[0]] ?? 0.05;
                if (isset($cards[1])) {
                    $tricks += ($trumpPower[$cards[1]] ?? 0.05) * 0.55;
                }
                if (isset($cards[2])) {
                    $tricks += ($trumpPower[$cards[2]] ?? 0.05) * 0.3;
                }
                if (count($cards) >= 4) {
                    $tricks += (count($cards) - 3) * 0.3;
                }
            } else {
                $tricks += $sidePower[$cards[0]] ?? 0.05;
                if (isset($cards[1])) {
                    $tricks += ($sidePower[$cards[1]] ?? 0.05) * 0.45;
                }
                $n = count($cards);
                if ($n === 1) {
                    $tricks += 0.35;
                } elseif ($n === 2) {
                    $tricks += 0.16;
                } elseif ($n >= 5) {
                    $tricks += ($n - 4) * 0.1;
                }
            }
        }
        return $tricks;
    }

    /** أعلى قوة ممكنة لليد عبر الألوان الأربعة (والبدون طرنيب) */
    public static function handStrength(array $hand, bool $allowNoTrump = false): float
    {
        $best = 0.0;
        foreach (self::SUITS as $suit) {
            $best = max($best, self::estimateTricks($hand, $suit));
        }
        if ($allowNoTrump) {
            $best = max($best, self::estimateTricks($hand, 'NT'));
        }
        return $best;
    }

    /**
     * جدول المزايدة المُعاير: قوة اليد → الطلب الذي ينجح باحتمال 60–75%
     * الأزواج مرتبة تنازلياً (أول قيمة تتحقق تفوز).
     */
    public static function bidFromStrength(float $strength): int
    {
        $table = [
            [6.45, 13],
            [5.95, 12],
            [5.45, 11],
            [4.95, 10],
            [4.35, 9],
            [3.85, 8],
            [2.95, 7],
        ];
        foreach ($table as [$need, $bid]) {
            if ($strength >= $need) {
                return $bid;
            }
        }
        return 0;
    }

    /** تنفيذ حركة بوت واحد إن كان الدور عليه */
    /** مهارة البوت من مستواه: 0.05 مبتدئ … 1 محترف */
    public static function botSkill(array $s, int $seat): float
    {
        $pl = $s['seats'][$seat] ?? null;
        if ($pl === null) {
            return 0.5;
        }
        if (isset($pl['botSkills'])) {
            return max(0.05, min(1.0, (float) $pl['botSkills']));
        }
        return max(0.05, min(1.0, ((int) ($pl['level'] ?? 1)) / 40));
    }

    /** هل يخطئ البوت هذه المرة؟ (البوت الضعيف يخطئ أكثر — كي لا يكون أقوى من اللاعب) */
    public static function shouldBlunder(array $s, int $seat): bool
    {
        $skill = self::botSkill($s, $seat);
        // مستوى 1 → نحو 45% اختيارات عشوائية، مستوى 40 → صفر
        $chance = (int) round(max(0.0, (1.0 - $skill) * 50));
        return $chance > 0 && random_int(1, 100) <= $chance;
    }

    public static function botAct(array &$s): bool
    {
        if (!in_array($s['phase'], ['bidding', 'playing'], true)) {
            return false;
        }
        $seat = (int) $s['turn'];
        $player = $s['seats'][$seat] ?? null;
        if ($player === null || empty($player['isBot'])) {
            return false;
        }
        $hand = $s['hands'][$seat];
        if ($s['phase'] === 'bidding') {
            if ($s['bid']['seat'] === $seat && $s['bid']['value'] !== null) {
                self::applyTrump($s, $seat, self::bestSuitFor($hand));
                return true;
            }
            $allowNoTrump = !empty($s['settings']['allowNoTrump']);
            $strength = self::handStrength($hand, $allowNoTrump);
            $target = self::bidFromStrength($strength);
            $current = $s['bid']['value'];
            $currentSeat = $s['bid']['seat'];
            $partner = ($seat + 2) % 4;
            $partnerBidding = $current !== null && $currentSeat !== null && (int) $currentSeat === $partner;
            $opponentBidding = $current !== null && $currentSeat !== null && ((int) $currentSeat % 2) !== ($seat % 2);
            $min = $current === null ? self::MIN_BID : $current + 1;

            // المضاعفة: الخصم يطلب طلباً عالياً ويدنا ضعيفة
            if (!empty($s['settings']['allowDouble']) && $opponentBidding && $current !== null
                && $current >= 10 && $strength <= 2.2 && empty($s['bid']['doubled'])
                && random_int(1, 100) <= 35) {
                self::applyBid($s, $seat, 'double');
                return true;
            }

            if ($target === 0) {
                // الجميع مرّر: نفتح بطلب 7 حتى لا تتكرر إعادة التوزيع
                if ($current === null && count($s['bid']['passed']) >= 3 && $strength >= 2.35) {
                    self::applyBid($s, $seat, 'bid', 7);
                    return true;
                }
                self::applyBid($s, $seat, 'pass');
                return true;
            }

            if ($target < $min || $min > self::MAX_BID) {
                self::applyBid($s, $seat, 'pass');
                return true;
            }
            if ($partnerBidding && $strength < 4.2) {
                self::applyBid($s, $seat, 'pass');
                return true;
            }
            self::applyBid($s, $seat, 'bid', $min);
            return true;
        }
        // مرحلة اللعب
        $card = self::botChooseCard($s, $seat);
        // بوت بمستوى منخفض: قد يلعب ورقة قانونية لكن غير مثالية
        if (self::shouldBlunder($s, $seat)) {
            $legal = self::legalPlays($s['hands'][$seat], $s['trick']);
            if (count($legal) > 1) {
                $card = $legal[random_int(0, count($legal) - 1)];
            }
        }
        self::applyPlay($s, $seat, $card);
        return true;
    }

    /** اختيار ورقة البوت */
    public static function botChooseCard(array $s, int $seat): string
    {
        $hand = $s['hands'][$seat];
        $trick = $s['trick'];
        $trump = $s['trump'];
        $legal = self::legalPlays($hand, $trick);
        $partner = ($seat + 2) % 4;
        if (count($trick) === 0) {
            return self::botLead($s, $seat, $legal);
        }
        $winner = self::trickWinner($trick, $trump);
        $winners = [];
        foreach ($legal as $c) {
            $test = $trick;
            $test[] = ['seat' => $seat, 'card' => $c];
            if (self::trickWinner($test, $trump) === $seat) {
                $winners[] = $c;
            }
        }
        if ($winner === $partner) {
            return self::cheapest($legal, $trump);
        }
        if ($winners) {
            usort($winners, static function ($a, $b) use ($trump) {
                return self::cost($a, $trump) <=> self::cost($b, $trump);
            });
            return $winners[0];
        }
        return self::cheapest($legal, $trump);
    }

    private static function cost(string $c, ?string $trump): int
    {
        return self::rank($c) + (($trump !== null && $trump !== 'NT' && $c[0] === $trump) ? 25 : 0);
    }

    private static function cheapest(array $cards, ?string $trump): string
    {
        $nonTrump = [];
        foreach ($cards as $c) {
            if ($trump === null || $trump === 'NT' || $c[0] !== $trump) {
                $nonTrump[] = $c;
            }
        }
        $pool = $nonTrump ?: $cards;
        usort($pool, static fn($a, $b) => self::rank($a) <=> self::rank($b));
        return $pool[0];
    }

    /** بداية الأكلة: آس في لون نظيف، أو سحب طرنيب، أو أعلى ورقة من أطول لون */
    private static function botLead(array $s, int $seat, array $legal): string
    {
        $hand = $s['hands'][$seat];
        $trump = $s['trump'];
        $played = $s['played'] ?? [];
        $playedBySuit = [];
        foreach ($played as $code) {
            $playedBySuit[$code[0]] = true;
        }
        foreach (self::SUITS as $suit) {
            if ($suit === $trump || isset($playedBySuit[$suit])) {
                continue;
            }
            foreach ($hand as $c) {
                if ($c[0] === $suit && self::rank($c) === 14 && in_array($c, $legal, true)) {
                    return $c;
                }
            }
        }
        // سحب الطرنيب
        if ($trump !== null && $trump !== 'NT') {
            $trumps = array_values(array_filter($legal, static fn($c) => $c[0] === $trump));
            if (count($trumps) >= 4) {
                usort($trumps, static fn($a, $b) => self::rank($b) <=> self::rank($a));
                return $trumps[0];
            }
        }
        $bySuit = [];
        foreach ($legal as $c) {
            $bySuit[$c[0]][] = $c;
        }
        $bestSuit = null;
        $bestScore = -1;
        foreach ($bySuit as $suit => $cards) {
            $score = count($cards) - (($trump !== null && $suit === $trump) ? 2.5 : 0);
            if ($score > $bestScore) {
                $bestScore = $score;
                $bestSuit = $suit;
            }
        }
        $pool = $bestSuit === null ? $legal : $bySuit[$bestSuit];
        usort($pool, static fn($a, $b) => self::rank($b) <=> self::rank($a));
        return $pool[0];
    }
}
