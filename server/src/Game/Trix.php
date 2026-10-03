<?php
declare(strict_types=1);

namespace Trix\Game;

use Trix\Core\Config;

/**
 * محرّك لعبة التركس (Trix) — أربعة لاعبين، فردية، ٤ ممالك × ٥ تسميات = ٢٠ توزيعة
 * --------------------------------------------------------------------------
 * التسميات الخمس:
 *   kbeh      ختيار الكبة  : من يأخذ K♥ يخسر 75 نقطة (150 إن كان مدبلاً)
 *   queens    البنات       : كل بنت (Q) يأخذها اللاعب يخسر 25 نقطة
 *   diamonds  الديناري     : كل ورقة ديناري يخسر 10 نقاط
 *   tricks    اللطوش       : كل أكلة (لمة) يخسر 15 نقطة
 *   trix      التركس       : اللعبة الموجبة — ترتيب الأوراق على مجموعات تبدأ بالشاب،
 *                            الأول 200 والثاني 150 والثالث 100 والرابع 50
 *
 * صاحب المملكة يختار التسميات الخمس واحدة بعد الأخرى (بالترتيب الذي يريد)،
 * ثم تنتقل المملكة للاعب الذي يليه. الأقل نقاطاً... لا: الفائز صاحب أعلى مجموع.
 */
final class Trix
{
    /** التسميات الخمس بترتيب العرض */
    public const CONTRACTS = ['kbeh', 'queens', 'diamonds', 'tricks', 'trix'];

    public const CONTRACT_AR = [
        'kbeh' => 'ختيار الكبة',
        'queens' => 'البنات',
        'diamonds' => 'الديناري',
        'tricks' => 'اللطوش',
        'trix' => 'التركس',
    ];

    public const CONTRACT_ICON = [
        'kbeh' => '👑',
        'queens' => '👸',
        'diamonds' => '💎',
        'tricks' => '🎴',
        'trix' => '🧩',
    ];

    /** قيم العقوبات */
    public const PEN_KBEH = 75;
    public const PEN_QUEEN = 25;
    public const PEN_DIAMOND = 10;
    public const PEN_TRICK = 15;
    /** مكافآت التركس حسب ترتيب إنهاء الأوراق */
    public const TRIX_BONUS = [200, 150, 100, 50];

    /** مهلة الكشف (التدبيل) بالثواني */
    private const REVEAL_SECONDS = 5.0;
    /** مهلة عرض ملخص التسمية قبل الانتقال للتالية */
    private const SUMMARY_SECONDS = 3.0;

    public static function now(): float
    {
        return Engine::now();
    }

    public static function isTrix(array $state): bool
    {
        return (($state['settings']['game'] ?? ($state['game'] ?? 'tarnib')) === 'trix');
    }

    /* ============================ بدء المباراة ============================ */

    public static function newMatch(array $seats, array $settings, int $king = 0, string $roomCode = '', string $roomName = ''): array
    {
        $s = [
            'game' => 'trix',
            'phase' => 'choosing',
            'seats' => $seats,
            'hands' => [[], [], [], []],
            'settings' => $settings,
            'king' => $king % 4,
            'kingdom' => 1,
            'dealNo' => 1,
            'contract' => null,
            'used' => [],
            'turn' => $king % 4,
            'trick' => [],
            'trickLeader' => $king % 4,
            'lastTrick' => null,
            'lastPlay' => null,
            'trickCounts' => [0, 0, 0, 0],
            'taken' => [],
            'roundScores' => [0, 0, 0, 0],
            'scores' => [0, 0, 0, 0],
            'finished' => [],
            'piles' => new \stdClass(),
            'revealed' => [],
            'revealReady' => [],
            'continue' => [],
            'winner' => null,
            'summary' => null,
            'log' => [],
            'chat' => [],
            'version' => 1,
            'eventId' => 0,
            'chatId' => 0,
            'recorded' => false,
            'turnStartedAt' => self::now(),
            'createdAt' => time(),
            'updatedAt' => time(),
            'roomCode' => $roomCode,
            'roomName' => $roomName,
            'lastActivity' => time(),
        ];
        self::startDeal($s, true);
        return $s;
    }

    /** توزيع جديد + عودة الملك لاختيار تسمية */
    public static function startDeal(array &$s, bool $first = false): void
    {
        $seed = random_int(1000, 2000000000);
        $deck = Engine::shuffle(Engine::deck(), $seed);
        for ($i = 0; $i < 4; $i++) {
            $hand = array_slice($deck, $i * 13, 13);
            sort($hand, SORT_STRING);
            $s['hands'][$i] = $hand;
        }
        $s['phase'] = 'choosing';
        $s['contract'] = null;
        $s['turn'] = (int) $s['king'];
        $s['trick'] = [];
        $s['trickLeader'] = (int) $s['king'];
        $s['lastTrick'] = null;
        $s['lastPlay'] = null;
        $s['trickCounts'] = [0, 0, 0, 0];
        $s['taken'] = [0 => [], 1 => [], 2 => [], 3 => []];
        $s['roundScores'] = [0, 0, 0, 0];
        $s['finished'] = [];
        $s['piles'] = new \stdClass();
        $s['revealed'] = [];
        $s['revealReady'] = [];
        $s['continue'] = [];
        $s['summary'] = null;
        $s['turnStartedAt'] = self::now();
        $s['updatedAt'] = time();
        $s['lastActivity'] = time();
        self::log($s, 'deal', [
            'dealNo' => (int) $s['dealNo'],
            'kingdom' => (int) $s['kingdom'],
            'king' => (int) $s['king'],
            'first' => $first,
        ]);
    }

    /* ============================ اختيار التسمية ============================ */

    public static function legalContracts(array $s): array
    {
        $used = (array) ($s['used'] ?? []);
        $out = [];
        foreach (self::CONTRACTS as $c) {
            if (empty($used[$c])) {
                $out[] = $c;
            }
        }
        return $out;
    }

    public static function chooseContract(array &$s, int $seat, string $contract): void
    {
        if (($s['phase'] ?? '') !== 'choosing') {
            \Trix\Core\Http::fail('لا يمكن اختيار التسمية الآن', 409, 'bad_phase');
        }
        if ((int) $s['king'] !== $seat) {
            \Trix\Core\Http::fail('دور صاحب المملكة في اختيار التسمية', 403, 'not_king');
        }
        if (!in_array($contract, self::CONTRACTS, true) || !in_array($contract, self::legalContracts($s), true)) {
            \Trix\Core\Http::fail('تسمية غير صالحة أو مستخدمة', 422, 'bad_contract');
        }
        $s['used'][$contract] = true;
        $s['contract'] = $contract;
        $s['trick'] = [];
        $s['turn'] = $seat;
        $s['trickLeader'] = $seat;
        $s['lastTrick'] = null;
        $s['roundScores'] = [0, 0, 0, 0];
        $s['trickCounts'] = [0, 0, 0, 0];
        $s['taken'] = [0 => [], 1 => [], 2 => [], 3 => []];
        $s['revealed'] = [];
        $s['revealReady'] = [];
        $s['piles'] = new \stdClass();
        $s['finished'] = [];
        $s['summary'] = null;
        $s['turnStartedAt'] = self::now();
        self::log($s, 'contract', ['seat' => $seat, 'contract' => $contract]);

        $allowDouble = !empty($s['settings']['allowDouble']);
        $anyRevealable = false;
        if ($allowDouble) {
            for ($i = 0; $i < 4; $i++) {
                if (count(self::revealable($s, $i)) > 0) {
                    $anyRevealable = true;
                    break;
                }
            }
        }
        if ($allowDouble && $anyRevealable && in_array($contract, ['kbeh', 'queens'], true)) {
            $s['phase'] = 'reveal';
        } else {
            self::beginPlay($s);
        }
    }

    /** الأوراق القابلة للتدبيل (كشف) في التسمية الحالية */
    public static function revealable(array $s, int $seat): array
    {
        $contract = (string) ($s['contract'] ?? '');
        $hand = (array) ($s['hands'][$seat] ?? []);
        $out = [];
        foreach ($hand as $code) {
            if ($contract === 'kbeh' && $code === 'H13') {
                $out[] = $code;
            }
            if ($contract === 'queens' && Engine::rank($code) === 12) {
                $out[] = $code;
            }
        }
        return $out;
    }

    /** تدبيل ورقة معاقِبة: يخسر من يأخذها ضعف النقاط، ويأخذ المُدبِّل قيمة الورقة الأساسية */
    public static function reveal(array &$s, int $seat, string $code): void
    {
        if (($s['phase'] ?? '') !== 'reveal') {
            \Trix\Core\Http::fail('انتهى وقت التدبيل', 409, 'bad_phase');
        }
        if (!in_array($code, self::revealable($s, $seat), true)) {
            \Trix\Core\Http::fail('لا يمكن تدبيل هذه الورقة', 422, 'bad_reveal');
        }
        if (isset($s['revealed'][$code])) {
            return;
        }
        $s['revealed'][$code] = $seat;
        self::log($s, 'reveal', ['seat' => $seat, 'card' => $code]);
    }

    public static function revealDone(array &$s, int $seat): void
    {
        if (($s['phase'] ?? '') !== 'reveal') {
            return;
        }
        $ready = (array) ($s['revealReady'] ?? []);
        if (!in_array($seat, $ready, true)) {
            $ready[] = $seat;
        }
        $s['revealReady'] = $ready;
        if (self::allHumansReady($s, $ready)) {
            self::beginPlay($s);
        }
    }

    private static function allHumansReady(array $s, array $done): bool
    {
        $need = 0;
        foreach ((array) $s['seats'] as $i => $pl) {
            if ($pl !== null && empty($pl['isBot'])) {
                $need++;
                if (!in_array((int) $i, $done, true)) {
                    return false;
                }
            }
        }
        return true;
    }

    public static function beginPlay(array &$s): void
    {
        $s['phase'] = 'playing';
        $s['turn'] = (int) $s['king'];
        $s['trickLeader'] = (int) $s['king'];
        $s['trick'] = [];
        $s['turnStartedAt'] = self::now();
        self::log($s, 'play_start', ['contract' => (string) $s['contract'], 'leader' => (int) $s['turn']]);
        self::skipStuckPlayers($s);
    }

    /* ============================ الأوراق القانونية ============================ */

    public static function legalPlays(array $s, int $seat): array
    {
        $hand = (array) ($s['hands'][$seat] ?? []);
        if (empty($hand)) {
            return [];
        }
        if (($s['contract'] ?? '') === 'trix') {
            return self::legalTrixPlays($s, $seat);
        }
        $trick = (array) ($s['trick'] ?? []);
        return Engine::legalPlays($hand, $trick);
    }

    /** قوانين تسمية التركس: الترتيب على مجموعات تبدأ بالشاب وتمتد تصاعدياً/تنازلياً */
    private static function legalTrixPlays(array $s, int $seat): array
    {
        $hand = (array) ($s['hands'][$seat] ?? []);
        $piles = (array) ($s['piles'] ?? []);
        $out = [];
        foreach ($hand as $code) {
            $suit = Engine::suit($code);
            $rank = Engine::rank($code);
            if (!isset($piles[$suit])) {
                // مجموعة جديدة تبدأ دائماً بالشاب
                if ($rank === 11) {
                    $out[] = $code;
                }
                continue;
            }
            $pile = (array) $piles[$suit];
            if ($rank === (int) $pile['low'] - 1 || $rank === (int) $pile['high'] + 1) {
                $out[] = $code;
            }
        }
        return $out;
    }

    /* ============================ اللعب ============================ */

    public static function applyPlay(array &$s, int $seat, string $code): void
    {
        if (($s['phase'] ?? '') !== 'playing') {
            \Trix\Core\Http::fail('لا يمكن اللعب الآن', 409, 'bad_phase');
        }
        if ((int) $s['turn'] !== $seat) {
            \Trix\Core\Http::fail('ليس دورك', 409, 'not_your_turn');
        }
        $hand = (array) ($s['hands'][$seat] ?? []);
        if (!in_array($code, $hand, true)) {
            \Trix\Core\Http::fail('هذه الورقة ليست في يدك', 422, 'not_in_hand');
        }
        $legal = self::legalPlays($s, $seat);
        if (!in_array($code, $legal, true)) {
            \Trix\Core\Http::fail('هذه الورقة غير مسموحة الآن', 422, 'illegal_card');
        }

        $s['hands'][$seat] = array_values(array_diff($hand, [$code]));
        $s['lastActivity'] = time();

        if (($s['contract'] ?? '') === 'trix') {
            self::playTrixCard($s, $seat, $code);
            return;
        }

        $s['trick'][] = ['seat' => $seat, 'card' => $code];
        self::log($s, 'play', ['seat' => $seat, 'card' => $code]);
        if (count($s['trick']) >= 4) {
            $s['phase'] = 'resolving';
            $s['turnStartedAt'] = self::now();
            return;
        }
        $s['turn'] = self::nextWithCards($s, $seat);
        $s['turnStartedAt'] = self::now();
        self::skipStuckPlayers($s);
    }

    /** لعب ورقة في تسمية التركس: تمديد المجموعة أو بدء مجموعة جديدة */
    private static function playTrixCard(array &$s, int $seat, string $code): void
    {
        $suit = Engine::suit($code);
        $rank = Engine::rank($code);
        $piles = (array) $s['piles'];
        if (!isset($piles[$suit])) {
            $piles[$suit] = ['low' => $rank, 'high' => $rank];
            self::log($s, 'pile_start', ['seat' => $seat, 'card' => $code]);
        } else {
            $pile = (array) $piles[$suit];
            $piles[$suit] = ['low' => min((int) $pile['low'], $rank), 'high' => max((int) $pile['high'], $rank)];
            self::log($s, 'play', ['seat' => $seat, 'card' => $code]);
        }
        $s['piles'] = $piles;
        $s['lastPlay'] = ['seat' => $seat, 'card' => $code];

        if (count($s['hands'][$seat]) === 0 && !in_array($seat, (array) $s['finished'], true)) {
            $s['finished'][] = $seat;
            self::log($s, 'finished', ['seat' => $seat, 'place' => count($s['finished'])]);
        }

        if (count((array) $s['finished']) >= 4) {
            self::endDeal($s);
            return;
        }
        $s['turn'] = self::nextWithCards($s, $seat);
        $s['turnStartedAt'] = self::now();
        self::skipStuckPlayers($s);
    }

    /** اللاعب التالي الذي ما زال يملك أوراقاً */
    private static function nextWithCards(array $s, int $from): int
    {
        for ($i = 1; $i <= 4; $i++) {
            $seat = ($from + $i) % 4;
            if (count((array) ($s['hands'][$seat] ?? [])) > 0) {
                return $seat;
            }
        }
        return $from;
    }

    /** تخطّي اللاعبين الذين لا يملكون ورقة قانونية (تسمية التركس) */
    private static function skipStuckPlayers(array &$s): void
    {
        if (($s['contract'] ?? '') !== 'trix' || ($s['phase'] ?? '') !== 'playing') {
            return;
        }
        for ($i = 0; $i < 4; $i++) {
            $seat = (int) $s['turn'];
            if (count((array) ($s['hands'][$seat] ?? [])) === 0) {
                $s['turn'] = self::nextWithCards($s, $seat);
                continue;
            }
            if (count(self::legalTrixPlays($s, $seat)) > 0) {
                return;
            }
            // لا يملك ورقة صالحة → يمرّر دوره
            self::log($s, 'pass', ['seat' => $seat]);
            $s['turn'] = self::nextWithCards($s, $seat);
        }
    }

    /**
     * التسمية تنتهي فور استنفاد الأوراق المعاقِبة، تماماً كما في التركس المعروفة:
     *   - ختيار الكبة: بمجرد أكل K♥ تنتهي التسمية.
     *   - البنات: عند أكل كل البنات الأربع تنتهي التسمية.
     *   - الديناري: عند أكل كل الديناري (١٣ ورقة) تنتهي التسمية.
     * باقي التسميات (اللطوش والتركس) تُكمل كل الأوراق.
     */
    private static function penaltyExhausted(array $s): bool
    {
        $contract = (string) ($s['contract'] ?? '');
        if ($contract === 'kbeh') {
            foreach ((array) ($s['taken'] ?? []) as $list) {
                if (in_array('kbeh', (array) $list, true)) {
                    return true;
                }
            }
            return false;
        }
        if ($contract === 'queens') {
            return self::countTaken($s, 'queen') >= 4;
        }
        if ($contract === 'diamonds') {
            return self::countTaken($s, 'diamond') >= 13;
        }
        return false;
    }

    /** كم ورقة معاقِبة من نوع معيّن أُكلت حتى الآن */
    // (تُستخدم أعلاه في countTaken)
    private static function countTaken(array $s, string $kind): int
    {
        $n = 0;
        foreach ((array) ($s['taken'] ?? []) as $list) {
            foreach ((array) $list as $t) {
                if ((string) $t === $kind) {
                    $n++;
                }
            }
        }
        return $n;
    }

    /* ============================ حسم الأكلة ============================ */

    public static function resolveTrick(array &$s): void
    {
        $trick = (array) ($s['trick'] ?? []);
        if (count($trick) < 4) {
            return;
        }
        $led = Engine::suit((string) $trick[0]['card']);
        $winner = (int) $trick[0]['seat'];
        $bestRank = Engine::rank((string) $trick[0]['card']);
        foreach (array_slice($trick, 1) as $tc) {
            $card = (string) $tc['card'];
            if (Engine::suit($card) === $led && Engine::rank($card) > $bestRank) {
                $bestRank = Engine::rank($card);
                $winner = (int) $tc['seat'];
            }
        }

        $contract = (string) ($s['contract'] ?? '');
        $penalty = 0;
        $notes = [];
        $revealed = (array) ($s['revealed'] ?? []);
        $taken = (array) ($s['taken'][$winner] ?? []);

        foreach ($trick as $tc) {
            $card = (string) $tc['card'];
            $rank = Engine::rank($card);
            $suit = Engine::suit($card);
            $isDoubled = isset($revealed[$card]);
            if ($contract === 'kbeh' && $card === 'H13') {
                $penalty += self::PEN_KBEH * ($isDoubled ? 2 : 1);
                $taken[] = 'kbeh';
                $notes[] = ['type' => 'kbeh', 'doubled' => $isDoubled];
                if ($isDoubled) {
                    self::rewardDoubler($s, (int) $revealed[$card], self::PEN_KBEH);
                }
            }
            if ($contract === 'queens' && $rank === 12) {
                $penalty += self::PEN_QUEEN * ($isDoubled ? 2 : 1);
                $taken[] = 'queen';
                $notes[] = ['type' => 'queen', 'card' => $card, 'doubled' => $isDoubled];
                if ($isDoubled) {
                    self::rewardDoubler($s, (int) $revealed[$card], self::PEN_QUEEN);
                }
            }
            if ($contract === 'diamonds' && $suit === 'D') {
                $penalty += self::PEN_DIAMOND;
                $taken[] = 'diamond';
                $notes[] = ['type' => 'diamond', 'card' => $card];
            }
        }
        if ($contract === 'tricks') {
            $penalty += self::PEN_TRICK;
            $taken[] = 'trick';
            $notes[] = ['type' => 'trick'];
        }

        $s['taken'][$winner] = $taken;
        $s['roundScores'][$winner] = (int) $s['roundScores'][$winner] - $penalty;
        $s['trickCounts'][$winner] = (int) $s['trickCounts'][$winner] + 1;
        $s['lastTrick'] = [
            'leader' => (int) ($trick[0]['seat'] ?? 0),
            'cards' => $trick,
            'winner' => $winner,
            'penalty' => $penalty,
            'notes' => $notes,
        ];
        self::log($s, 'trick', ['winner' => $winner, 'penalty' => $penalty, 'contract' => $contract]);
        $s['trick'] = [];
        $s['turn'] = $winner;
        $s['trickLeader'] = $winner;
        $s['turnStartedAt'] = self::now();

        $cardsLeft = 0;
        foreach ((array) $s['hands'] as $h) {
            $cardsLeft += count((array) $h);
        }
        if ($cardsLeft === 0) {
            self::endDeal($s);
            return;
        }
        // استُنفدت الأوراق المعاقِبة (الكبة/كل البنات/كل الديناري) → تنتهي التسمية فوراً
        if (self::penaltyExhausted($s)) {
            self::log($s, 'penalty_exhausted', ['contract' => $contract]);
            self::endDeal($s);
            return;
        }
        $s['phase'] = 'playing';
        self::skipStuckPlayers($s);
    }

    /** من دبّل ورقة وأخذها غيره → يحصل على قيمتها الأساسية كمكافأة */
    private static function rewardDoubler(array &$s, int $seat, int $amount): void
    {
        $s['roundScores'][$seat] = (int) $s['roundScores'][$seat] + $amount;
        self::log($s, 'double_bonus', ['seat' => $seat, 'amount' => $amount]);
    }

    /* ============================ نهاية التسمية ============================ */

    public static function endDeal(array &$s): void
    {
        $contract = (string) ($s['contract'] ?? '');
        if ($contract === 'trix') {
            $order = array_values((array) $s['finished']);
            foreach ($order as $i => $seat) {
                $bonus = self::TRIX_BONUS[$i] ?? 50;
                $s['roundScores'][(int) $seat] = (int) $s['roundScores'][(int) $seat] + $bonus;
            }
        }
        for ($i = 0; $i < 4; $i++) {
            $s['scores'][$i] = (int) $s['scores'][$i] + (int) $s['roundScores'][$i];
        }
        $dealNo = (int) $s['dealNo'];
        $kingdom = (int) $s['kingdom'];
        $king = (int) $s['king'];
        $remaining = 0;
        foreach ((array) $s['hands'] as $h) {
            $remaining += count((array) $h);
        }
        $exhausted = self::penaltyExhausted($s);
        $s['summary'] = [
            'dealNo' => $dealNo,
            'kingdom' => $kingdom,
            'king' => $king,
            'contract' => $contract,
            'contractAr' => self::CONTRACT_AR[$contract] ?? $contract,
            'endReason' => $exhausted ? 'penalties' : 'cards',
            'remaining' => $remaining,
            'penaltyCounts' => [
                'kbeh' => self::countTaken($s, 'kbeh'),
                'queen' => self::countTaken($s, 'queen'),
                'diamond' => self::countTaken($s, 'diamond'),
            ],
            'roundScores' => array_map('intval', (array) $s['roundScores']),
            'scores' => array_map('intval', (array) $s['scores']),
            'trickCounts' => array_map('intval', (array) $s['trickCounts']),
            'revealed' => (array) $s['revealed'],
            'finished' => array_map('intval', (array) $s['finished']),
        ];
        $s['revealed'] = self::allHands($s);
        $s['phase'] = 'round_end';
        $s['continue'] = [];
        $s['turnStartedAt'] = self::now();
        $s['updatedAt'] = time();
        self::log($s, 'deal_end', ['dealNo' => $dealNo, 'contract' => $contract, 'scores' => (array) $s['scores']]);
    }

    /** كل الأيدي (لعرضها عند نهاية التسمية) */
    private static function allHands(array $s): array
    {
        $out = [];
        for ($i = 0; $i < 4; $i++) {
            $hand = (array) ($s['hands'][$i] ?? []);
            sort($hand, SORT_STRING);
            $out[] = array_values($hand);
        }
        return $out;
    }

    /** الانتقال للتوزيعة التالية أو للمملكة التالية أو لنهاية المباراة */
    public static function nextDeal(array &$s): void
    {
        $used = (array) ($s['used'] ?? []);
        $remaining = self::legalContracts($s);
        if (count($remaining) > 0) {
            $s['dealNo'] = (int) $s['dealNo'] + 1;
            self::startDeal($s);
            return;
        }
        // انتهت تسميات هذه المملكة
        $nextKingdom = (int) $s['kingdom'] + 1;
        $kingdomsTotal = max(1, min(4, (int) ($s['settings']['kingdoms'] ?? 4)));
        if ($nextKingdom > $kingdomsTotal) {
            self::endMatch($s);
            return;
        }
        $s['kingdom'] = $nextKingdom;
        $s['king'] = ((int) $s['king'] + 1) % 4;
        $s['used'] = [];
        $s['dealNo'] = (int) $s['dealNo'] + 1;
        self::log($s, 'kingdom', ['kingdom' => $nextKingdom, 'king' => (int) $s['king']]);
        self::startDeal($s);
    }

    private static function endMatch(array &$s): void
    {
        $best = null;
        $bestSeat = 0;
        for ($i = 0; $i < 4; $i++) {
            $score = (int) $s['scores'][$i];
            if ($best === null || $score > $best) {
                $best = $score;
                $bestSeat = $i;
            }
        }
        $s['winner'] = $bestSeat;
        $s['phase'] = 'game_end';
        $s['turnStartedAt'] = self::now();
        self::log($s, 'game_end', ['winner' => $bestSeat, 'scores' => (array) $s['scores']]);
    }

    public static function continueDeal(array &$s, int $seat): void
    {
        if (($s['phase'] ?? '') !== 'round_end') {
            return;
        }
        $ready = (array) ($s['continue'] ?? []);
        if (!in_array($seat, $ready, true)) {
            $ready[] = $seat;
        }
        $s['continue'] = $ready;
        if (self::allHumansReady($s, $ready)) {
            self::nextDeal($s);
        }
    }

    /* ============================ الدوران والوقت ============================ */

    /** يُستدعى مع كل قراءة للحالة: يشغّل البوتات ويحسم المؤقتات */
    public static function tick(array &$s): void
    {
        $phase = (string) ($s['phase'] ?? 'waiting');
        $now = self::now();
        $elapsed = $now - (float) ($s['turnStartedAt'] ?? $now);

        if ($phase === 'resolving') {
            if ($elapsed >= 0.45) {
                self::resolveTrick($s);
            }
            return;
        }

        if ($phase === 'reveal') {
            // انتهت مهلة الكشف → ابدأ اللعب
            if ($elapsed >= self::REVEAL_SECONDS) {
                self::beginPlay($s);
                return;
            }
            $players = (array) ($s['seats'] ?? []);
            $ready = (array) ($s['revealReady'] ?? []);
            // من لا يملك ورقة قابلة للتدبيل لا داعي لانتظاره
            foreach ($players as $i => $pl) {
                if ($pl === null || in_array((int) $i, $ready, true)) {
                    continue;
                }
                if (count(self::revealable($s, (int) $i)) === 0) {
                    $ready[] = (int) $i;
                }
            }
            $s['revealReady'] = $ready;
            if (self::allHumansReady($s, $ready)) {
                self::beginPlay($s);
                return;
            }
            // كل بوت يقرر التدبيل عن نفسه ثم يؤكد الجاهزية
            foreach ($players as $i => $pl) {
                if ($pl === null || empty($pl['isBot']) || in_array((int) $i, $ready, true)) {
                    continue;
                }
                if ($elapsed >= (float) Config::get('bot_delay', 0.35)) {
                    self::botReveal($s, (int) $i);
                    return;
                }
            }
            return;
        }

        if ($phase === 'round_end') {
            if ($elapsed >= self::SUMMARY_SECONDS) {
                self::nextDeal($s);
            }
            return;
        }

        if ($phase === 'game_end') {
            return;
        }

        if (!in_array($phase, ['choosing', 'playing'], true)) {
            return;
        }

        $seat = (int) $s['turn'];
        $player = (array) ($s['seats'][$seat] ?? []);
        if ($player !== null && !empty($player['isBot'])) {
            if ($elapsed >= (float) Config::get('bot_delay', 0.35)) {
                if (!self::botAct($s)) {
                    self::autoAct($s);
                }
            }
            return;
        }

        // انتهاء وقت اللاعب الحقيقي
        $limit = (int) ($s['settings']['turnTime'] ?? 30);
        if ($phase === 'choosing') {
            $limit = (int) ($s['settings']['turnTime'] ?? 30);
        }
        if ($limit > 0 && $elapsed >= (float) $limit) {
            self::autoAct($s);
        }
    }

    /** تنفيذ تلقائي عند انتهاء الوقت (أو كاحتياط) */
    public static function autoAct(array &$s): bool
    {
        $phase = (string) ($s['phase'] ?? '');
        $seat = (int) $s['turn'];
        if ($phase === 'choosing') {
            $options = self::legalContracts($s);
            $contract = self::bestContract($s, $seat, $options);
            if ($contract === null) {
                return false;
            }
            self::chooseContract($s, $seat, $contract);
            return true;
        }
        if ($phase === 'playing') {
            $legal = self::legalPlays($s, $seat);
            if (empty($legal)) {
                self::skipStuckPlayers($s);
                return true;
            }
            $card = self::botChooseCard($s, $seat);
            self::applyPlay($s, $seat, $card);
            return true;
        }
        if ($phase === 'reveal') {
            self::beginPlay($s);
            return true;
        }
        return false;
    }

    /* ============================ البوتات ============================ */

    /** هل يخطئ البوت هذه المرة؟ (بمستوى اللاعب الذي أضافه — لا أقوى منه) */
    private static function shouldBlunder(array $s, int $seat): bool
    {
        $pl = $s['seats'][$seat] ?? null;
        $skill = isset($pl['botSkills'])
            ? max(0.05, min(1.0, (float) $pl['botSkills']))
            : max(0.05, min(1.0, ((int) ($pl['level'] ?? 1)) / 40));
        $chance = (int) round(max(0.0, (1.0 - $skill) * 40));
        return $chance > 0 && random_int(1, 100) <= $chance;
    }

    public static function botAct(array &$s): bool
    {
        $phase = (string) ($s['phase'] ?? '');
        $seat = (int) $s['turn'];
        if ($phase === 'choosing') {
            $options = self::legalContracts($s);
            $contract = self::bestContract($s, $seat, $options);
            if ($contract === null) {
                return false;
            }
            if (count($options) > 1 && self::shouldBlunder($s, $seat)) {
                $contract = $options[random_int(0, count($options) - 1)];
            }
            self::chooseContract($s, $seat, $contract);
            return true;
        }
        if ($phase === 'playing') {
            $legal = self::legalPlays($s, $seat);
            if (empty($legal)) {
                self::skipStuckPlayers($s);
                return true;
            }
            $card = self::botChooseCard($s, $seat);
            if (count($legal) > 1 && self::shouldBlunder($s, $seat)) {
                $card = $legal[random_int(0, count($legal) - 1)];
            }
            self::applyPlay($s, $seat, $card);
            return true;
        }
        return false;
    }

    private static function botReveal(array &$s, int $seat): void
    {
        foreach (self::revealable($s, $seat) as $card) {
            if (random_int(1, 100) <= 35) {
                self::reveal($s, $seat, $card);
            }
        }
        self::revealDone($s, $seat);
    }

    /** اختيار التسمية الأقل خطراً على البوت */
    private static function bestContract(array $s, int $seat, array $options): ?string
    {
        if (empty($options)) {
            return null;
        }
        $hand = (array) ($s['hands'][$seat] ?? []);
        $costs = [];
        $queens = 0;
        $diamonds = 0;
        $hasKbeh = false;
        $jacks = 0;
        $mid = 0;
        $aces = 0;
        $kings = 0;
        foreach ($hand as $code) {
            $rank = Engine::rank($code);
            $suit = Engine::suit($code);
            if ($rank === 12) {
                $queens++;
            }
            if ($suit === 'D') {
                $diamonds++;
            }
            if ($code === 'H13') {
                $hasKbeh = true;
            }
            if ($rank === 11) {
                $jacks++;
            }
            if ($rank >= 8 && $rank <= 12) {
                $mid++;
            }
            if ($rank === 14) {
                $aces++;
            }
            if ($rank === 13) {
                $kings++;
            }
        }
        foreach ($options as $c) {
            switch ($c) {
                case 'kbeh':
                    $costs[$c] = $hasKbeh ? 78 : 10;
                    break;
                case 'queens':
                    $costs[$c] = $queens * 26 + 8;
                    break;
                case 'diamonds':
                    $costs[$c] = $diamonds * 11 + 8;
                    break;
                case 'tricks':
                    $costs[$c] = $aces * 22 + $kings * 12 + $queens * 6 + 14;
                    break;
                case 'trix':
                default:
                    // التركس موجبة: كلما كانت اليد مناسبة (شباب وأوراق وسطى) كان أفضل
                    $costs[$c] = 120 - $jacks * 26 - $mid * 4;
                    break;
            }
        }
        asort($costs);
        $keys = array_keys($costs);
        return (string) $keys[0];
    }

    /** اختيار الورقة للبوت */
    public static function botChooseCard(array $s, int $seat): string
    {
        $legal = self::legalPlays($s, $seat);
        if (empty($legal)) {
            return '';
        }
        if (($s['contract'] ?? '') === 'trix') {
            return self::botChooseTrixCard($s, $seat, $legal);
        }
        return self::botChooseAvoidCard($s, $seat, $legal);
    }

    /** في تسميات العقوبات: تفادَ الأكل قدر الإمكان وألقِ الأوراق المعاقِبة عند الأمان */
    private static function botChooseAvoidCard(array $s, int $seat, array $legal): string
    {
        $contract = (string) ($s['contract'] ?? '');
        $trick = (array) ($s['trick'] ?? []);
        $led = empty($trick) ? null : Engine::suit((string) $trick[0]['card']);

        // ترتيب الأوراق من الأقل خطورة للأعلى
        $sorted = $legal;
        usort($sorted, static function ($a, $b) {
            return Engine::rank($a) <=> Engine::rank($b);
        });

        $penaltyCard = static function (string $code) use ($contract, $s): int {
            $rank = Engine::rank($code);
            $suit = Engine::suit($code);
            if ($contract === 'kbeh' && $code === 'H13') {
                return 200;
            }
            if ($contract === 'queens' && $rank === 12) {
                return 100;
            }
            if ($contract === 'diamonds' && $suit === 'D') {
                return 20;
            }
            return 0;
        };

        if (empty($trick)) {
            // البداية: العب أقل ورقة غير معاقِبة في أطول لون
            foreach ($sorted as $code) {
                if ($penaltyCard($code) === 0) {
                    return $code;
                }
            }
            return $sorted[0];
        }

        // من يفوز حالياً؟
        $bestSeat = (int) $trick[0]['seat'];
        $bestRank = Engine::rank((string) $trick[0]['card']);
        foreach (array_slice($trick, 1) as $tc) {
            $card = (string) $tc['card'];
            if (Engine::suit($card) === $led && Engine::rank($card) > $bestRank) {
                $bestRank = Engine::rank($card);
                $bestSeat = (int) $tc['seat'];
            }
        }
        $followingSuit = [];
        $others = [];
        foreach ($sorted as $code) {
            if (Engine::suit($code) === $led) {
                $followingSuit[] = $code;
            } else {
                $others[] = $code;
            }
        }
        // 1) ورقة من اللون المطروح لا تفوز → الأفضل (الأعلى من الأقل)
        $safe = [];
        foreach ($followingSuit as $code) {
            if (Engine::rank($code) < $bestRank) {
                $safe[] = $code;
            }
        }
        if (!empty($safe)) {
            return (string) end($safe);
        }
        // 2) لا يمكن تفادي الفوز: العب أقل ورقة غير معاقِبة
        foreach ($followingSuit as $code) {
            if ($penaltyCard($code) === 0) {
                return $code;
            }
        }
        // 3) لا يملك اللون: ألقِ أخطر ورقة معاقِبة إن كان الفوز مستبعداً
        if (!empty($others)) {
            $last = count($trick) === 3; // أنا آخر من يلعب → النتيجة معروفة
            $winnerLooksSafe = $bestRank >= 13; // K أو A
            $worst = null;
            foreach ($others as $code) {
                if ($penaltyCard($code) > 0 && ($worst === null || $penaltyCard($code) > $penaltyCard($worst))) {
                    $worst = $code;
                }
            }
            if ($worst !== null) {
                $wouldWin = $last
                    ? (!(Engine::suit($worst) === $led) && Engine::rank($worst) > $bestRank && Engine::suit($worst) === $led)
                    : false;
                if ($last ? !$wouldWin : $winnerLooksSafe) {
                    return $worst;
                }
            }
            usort($others, static function ($a, $b) {
                return Engine::rank($a) <=> Engine::rank($b);
            });
            return (string) $others[0];
        }
        return (string) $sorted[0];
    }

    /** في تسمية التركس: العب الورقة التي تفتح أكبر عدد من الأوراق لاحقاً */
    private static function botChooseTrixCard(array $s, int $seat, array $legal): string
    {
        $hand = (array) ($s['hands'][$seat] ?? []);
        $piles = (array) ($s['piles'] ?? []);
        $best = $legal[0];
        $bestScore = -1;
        foreach ($legal as $code) {
            $suit = Engine::suit($code);
            $rank = Engine::rank($code);
            $pile = isset($piles[$suit]) ? (array) $piles[$suit] : null;
            $low = $pile === null ? $rank : min((int) $pile['low'], $rank);
            $high = $pile === null ? $rank : max((int) $pile['high'], $rank);
            $score = 0;
            foreach ($hand as $other) {
                if ($other === $code) {
                    continue;
                }
                $oRank = Engine::rank($other);
                if (Engine::suit($other) === $suit && ($oRank === $low - 1 || $oRank === $high + 1)) {
                    $score += 3;
                }
            }
            // فضّل إنهاء الأوراق: كلما تبقت أوراق أقل كان أفضل
            $score += max(0, 13 - count($hand)) * 0.1;
            if ($score > $bestScore) {
                $bestScore = $score;
                $best = $code;
            }
        }
        return (string) $best;
    }

    /* ============================ الأدوات ============================ */

    public static function log(array &$s, string $type, array $data = []): void
    {
        $s['eventId'] = (int) ($s['eventId'] ?? 0) + 1;
        $s['log'][] = array_merge(['id' => $s['eventId'], 't' => $type, 'at' => time()], $data);
        if (count($s['log']) > 200) {
            $s['log'] = array_slice($s['log'], -150);
        }
    }

    public static function chat(array &$s, ?int $seat, string $text, ?string $emoji = null, ?array $voice = null): void
    {
        $s['chatId'] = (int) ($s['chatId'] ?? 0) + 1;
        $name = $seat === null ? '—' : (string) ($s['seats'][$seat]['name'] ?? '');
        $msg = [
            'id' => $s['chatId'],
            'seat' => $seat,
            'name' => $name,
            'text' => $text,
            'emoji' => $emoji,
            'at' => time(),
        ];
        if ($voice !== null && $seat !== null) {
            $msg['text'] = '';
            $msg['emoji'] = null;
            $msg['voice'] = (string) ($voice['id'] ?? '');
            $msg['dur'] = (int) ($voice['dur'] ?? 0);
            $msg['mime'] = (string) ($voice['mime'] ?? 'audio/webm');
        }
        $s['chat'][] = $msg;
        if (count($s['chat']) > 80) {
            $s['chat'] = array_slice($s['chat'], -60);
        }
    }

    /* ============================ العرض للواجهة ============================ */

    public static function publicView(array $s, int $seat): array
    {
        $phase = (string) ($s['phase'] ?? 'waiting');
        $contract = $s['contract'] ?? null;
        $myTurn = (int) ($s['turn'] ?? -1) === $seat && in_array($phase, ['choosing', 'playing'], true);
        $legal = ($phase === 'playing' && $myTurn) ? self::legalPlays($s, $seat) : [];

        $seats = [];
        foreach ((array) $s['seats'] as $pl) {
            if ($pl === null) {
                $seats[] = null;
                continue;
            }
            $seats[] = [
                'userId' => (int) $pl['userId'],
                'name' => (string) $pl['name'],
                'avatar' => (string) $pl['avatar'],
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
            $handCounts[] = count((array) ($s['hands'][$i] ?? []));
        }
        $myHand = (array) ($s['hands'][$seat] ?? []);
        sort($myHand, SORT_STRING);

        $settings = (array) ($s['settings'] ?? []);
        $deadline = null;
        if (in_array($phase, ['choosing', 'playing', 'reveal'], true)) {
            $limit = $phase === 'reveal' ? (int) self::REVEAL_SECONDS : (int) ($settings['turnTime'] ?? 30);
            if ($limit > 0) {
                $deadline = max(0, (int) round(((float) $s['turnStartedAt'] + $limit - self::now()) * 1000));
            }
        }

        $tricks = array_map('intval', (array) ($s['trickCounts'] ?? [0, 0, 0, 0]));

        return [
            'version' => (int) $s['version'],
            'game' => 'trix',
            'roomCode' => (string) ($s['roomCode'] ?? ''),
            'roomName' => (string) ($s['roomName'] ?? ''),
            'phase' => $phase === 'resolving' ? 'playing' : $phase,
            'seats' => $seats,
            'mySeat' => $seat,
            'dealer' => (int) ($s['king'] ?? 0),
            'turn' => (int) ($s['turn'] ?? -1),
            'myHand' => array_values($myHand),
            'revealed' => in_array($phase, ['round_end'], true) ? ($s['revealed'] ?? null) : null,
            'handCounts' => $handCounts,
            'trick' => array_values((array) ($s['trick'] ?? [])),
            'trickLeader' => (int) ($s['trickLeader'] ?? 0),
            'lastTrick' => $s['lastTrick'] ?? null,
            'tricksWon' => [(int) ($tricks[0] ?? 0), (int) ($tricks[1] ?? 0)],
            'bid' => ['value' => null, 'seat' => null, 'doubled' => false, 'doubledBy' => null, 'passed' => [], 'eligible' => []],
            'trump' => null,
            'scores' => array_map('intval', (array) ($s['scores'] ?? [0, 0, 0, 0])),
            'round' => (int) ($s['dealNo'] ?? 1),
            'roundBids' => new \stdClass(),
            'target' => 0,
            'settings' => $settings,
            'deadline' => $deadline,
            'log' => array_slice((array) $s['log'], -60),
            'chat' => array_slice((array) $s['chat'], -60),
            'myTeam' => $seat % 2,
            'isMyTurn' => $myTurn,
            'legalCards' => array_values($legal),
            'legalBids' => [],
            'canPass' => false,
            'canDouble' => false,
            'mustChooseTrump' => false,
            'wonTrick' => false,
            'winnerTeam' => null,
            'lastRoundSummary' => $s['summary'] ?? null,
            // ===== خصائص التركس =====
            'trix' => [
                'contract' => $contract,
                'contractAr' => $contract === null ? null : (self::CONTRACT_AR[$contract] ?? $contract),
                'contractIcon' => $contract === null ? null : (self::CONTRACT_ICON[$contract] ?? ''),
                'used' => array_keys(array_filter((array) ($s['used'] ?? []))),
                'legalContracts' => self::legalContracts($s),
                'mustChooseContract' => $phase === 'choosing' && (int) $s['king'] === $seat,
                'kingSeat' => (int) ($s['king'] ?? 0),
                'kingdom' => (int) ($s['kingdom'] ?? 1),
                'kingdoms' => max(1, min(4, (int) ($s['settings']['kingdoms'] ?? 4))),
                'dealNo' => (int) ($s['dealNo'] ?? 1),
                'piles' => (array) ($s['piles'] ?? []),
                'trickCounts' => $tricks,
                'roundScores' => array_map('intval', (array) ($s['roundScores'] ?? [0, 0, 0, 0])),
                'finished' => array_map('intval', (array) ($s['finished'] ?? [])),
                'revealed' => (array) ($s['revealed'] ?? []),
                'canReveal' => $phase === 'reveal' ? self::revealable($s, $seat) : [],
                'revealReady' => in_array($seat, (array) ($s['revealReady'] ?? []), true),
                'revealPhase' => $phase === 'reveal',
                'lastPlay' => $s['lastPlay'] ?? null,
                'passes' => (int) ($s['passed'] ?? 0),
                'taken' => (array) ($s['taken'][$seat] ?? []),
                'winnerSeat' => $s['winner'],
                'isIndividual' => true,
            ],
        ];
    }

    /** ملخص للردهة */
    public static function lobbyInfo(array $s): array
    {
        $players = 0;
        foreach ((array) $s['seats'] as $pl) {
            if ($pl !== null) {
                $players++;
            }
        }
        return [
            'game' => 'trix',
            'players' => $players,
            'phase' => (string) ($s['phase'] ?? 'waiting'),
            'dealNo' => (int) ($s['dealNo'] ?? 0),
            'kingdom' => (int) ($s['kingdom'] ?? 1),
            'contract' => $s['contract'] ?? null,
        ];
    }
}
