<?php
declare(strict_types=1);

namespace Trix\Game;

use Trix\Core\Config;

/**
 * لعبة المور (MOR) — رامي عربي بالشراكة، ٤ لاعبين، فريقان متقابلان
 * ==================================================================
 * • ورق: مجموعتان (١٠٤ ورقة) + جوكرين — ١١ ورقة لكل لاعب، ولاعب واحد يأخذ ١٢ ويبدأ.
 * • كومتا «مور» جانبيتان كل واحدة ١١ ورقة (تُمنح لمن ينهي أوراقه أولاً).
 * • الـ ٢ والجوكر مبدّلان (wildcards)، وبحد أقصى جوكر واحد + ٢ واحد في النزول.
 * • النزول: سلسلة (٣+ متتالية بنفس اللون) أو طقم (٣ات فقط أو أصوص فقط).
 * • المشروع: نزول من ٧ أوراق أو أكثر — ٣٠٠ (٧ ثلاثات/أصوص نظيفة) أو ٢٠٠ (سلسلة نظيفة)
 *   أو ١٥٠/١٠٠ (بمبدّل). الإغلاق يشترط ٣٠٠ مشاريع (٣٠٠ كاملة أو ٢٠٠+١٠٠).
 * • طريقتا حساب يختارهما صاحب الغرفة: «جواكر» الموثّقة أو «الشعبية» الشامية.
 */
final class Mor
{
    public const HAND = 11;
    public const MOR_PILE = 11;
    /** أهداف المباراة — طريقة جواكر */
    public const TARGETS = [101, 151, 201];
    /** أهداف المباراة — الطريقة الشعبية (النقاط أكبر) */
    public const TARGETS_POPULAR = [501, 1001, 1501];
    public const MODES = ['jawaker', 'popular'];

    /* ============================ أدوات الورق ============================ */

    /** رتبة الورقة (٢..١٤) — الجوكر ١٥ */
    public static function rank(string $code): int
    {
        if ($code === '' || $code[0] === 'X') {
            return 15;
        }
        return (int) substr($code, 1);
    }

    /** لون الورقة (S/H/D/C) — الجوكر X */
    public static function suit(string $code): string
    {
        return $code === '' ? '' : $code[0];
    }

    /** هل الورقة مبدّل (٢ أو جوكر)؟ */
    public static function isWild(string $code): bool
    {
        return self::rank($code) === 15 || self::rank($code) === 2;
    }

    public static function isJoker(string $code): bool
    {
        return $code !== '' && $code[0] === 'X';
    }

    /** رزمة المور: مجموعتان + جوكران */
    public static function deck(): array
    {
        $one = Engine::deck();
        return array_merge($one, $one, ['X1', 'X2']);
    }

    public static function now(): float
    {
        return Engine::now();
    }

    public static function isMor(array $state): bool
    {
        return (($state['settings']['game'] ?? ($state['game'] ?? 'tarnib')) === 'mor');
    }

    public static function mode(array $s): string
    {
        $m = (string) ($s['settings']['morMode'] ?? 'jawaker');
        return in_array($m, self::MODES, true) ? $m : 'jawaker';
    }

    /** الهدف المسموح حسب الطريقة */
    public static function allowedTargets(string $mode): array
    {
        return $mode === 'popular' ? self::TARGETS_POPULAR : self::TARGETS;
    }

    public static function target(array $s): int
    {
        $mode = self::mode($s);
        $t = (int) ($s['settings']['target'] ?? 0);
        if (!in_array($t, self::allowedTargets($mode), true)) {
            $t = $mode === 'popular' ? 1001 : 201;
        }
        return $t;
    }

    /* ============================ بدء المباراة ============================ */

    public static function newMatch(array $seats, array $settings, int $dealer = 0, string $roomCode = '', string $roomName = ''): array
    {
        $s = [
            'game' => 'mor',
            'phase' => 'playing',
            'seats' => $seats,
            'settings' => $settings,
            'dealer' => $dealer % 4,
            'roundNo' => 1,
            'hands' => [[], [], [], []],
            'deck' => [],
            'discard' => [],
            'melds' => [[], []],
            'mor' => [[], []],
            'morTaken' => [false, false],
            'meldId' => 0,
            'turn' => $dealer % 4,
            'needDraw' => true,
            'pilePending' => false,
            'scores' => [0, 0],
            'roundDeltas' => [0, 0],
            'summary' => null,
            'winnerTeam' => null,
            'continue' => [],
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
        self::startRound($s, true);
        return $s;
    }

    /** توزيع دور جديد */
    public static function startRound(array &$s, bool $first = false): void
    {
        $seed = random_int(1000, 2000000000);
        $deck = Engine::shuffle(self::deck(), $seed);

        $hands = [[], [], [], []];
        $pos = 0;
        for ($i = 0; $i < 4; $i++) {
            $hands[$i] = array_slice($deck, $pos, self::HAND);
            $pos += self::HAND;
        }
        // اللاعب الذي يبدأ يأخذ ورقة إضافية (١٢) ثم يرميها في دوره
        $starter = (int) ($s['dealer'] ?? 0) % 4;
        $hands[$starter][] = $deck[$pos];
        $pos++;

        // كومتا المور
        $mor = [];
        for ($i = 0; $i < 2; $i++) {
            $mor[] = array_slice($deck, $pos, self::MOR_PILE);
            $pos += self::MOR_PILE;
        }

        // ورقة مكشوفة لبدء كومة الرمي
        $firstDiscard = $deck[$pos] ?? null;
        $pos++;
        $discard = $firstDiscard === null ? [] : [$firstDiscard];

        $rest = array_slice($deck, $pos);

        for ($i = 0; $i < 4; $i++) {
            sort($hands[$i], SORT_STRING);
        }

        $s['hands'] = $hands;
        $s['deck'] = array_values($rest);
        $s['discard'] = $discard;
        $s['melds'] = [[], []];
        $s['mor'] = $mor;
        $s['morTaken'] = [false, false];
        $s['meldId'] = 0;
        $s['turn'] = $starter;
        $s['needDraw'] = true;
        $s['pilePending'] = false;
        $s['pileCards'] = [];
        $s['roundDeltas'] = [0, 0];
        $s['summary'] = null;
        $s['winnerTeam'] = null;
        $s['continue'] = [];
        $s['phase'] = 'playing';
        $s['turnStartedAt'] = self::now();
        $s['updatedAt'] = time();
        $s['lastActivity'] = time();
        self::log($s, 'deal', ['round' => (int) $s['roundNo'], 'starter' => $starter, 'first' => $first]);
    }

    /* ============================ التحقق من النزولات ============================ */

    /**
     * التحقق من صحة نزول (سلسلة أو طقم)
     * @return array{ok:bool,kind:?string,reason:string}
     */
    public static function validateMeld(array $cards): array
    {
        $cards = array_values($cards);
        $n = count($cards);
        if ($n < 3) {
            return ['ok' => false, 'kind' => null, 'reason' => 'النزول يحتاج ٣ أوراق على الأقل'];
        }
        $wilds = [];
        $naturals = [];
        foreach ($cards as $c) {
            if (!is_string($c) || $c === '') {
                return ['ok' => false, 'kind' => null, 'reason' => 'ورقة غير صالحة'];
            }
            if (self::isWild($c)) {
                $wilds[] = $c;
            } else {
                $naturals[] = $c;
            }
        }
        if (count($wilds) > 2) {
            return ['ok' => false, 'kind' => null, 'reason' => 'لا يُسمح بأكثر من مبدّلين (جوكر + ٢)'];
        }
        $jokers = count(array_filter($wilds, static fn($c) => self::isJoker($c)));
        $twos = count($wilds) - $jokers;
        if ($jokers > 1 || $twos > 1) {
            return ['ok' => false, 'kind' => null, 'reason' => 'الحد الأقصى جوكر واحد + ٢ واحد'];
        }
        if (count($naturals) < 1) {
            return ['ok' => false, 'kind' => null, 'reason' => 'النزول لا يمكن أن يكون مبدّلات فقط'];
        }

        $set = self::validateSet($naturals, count($wilds), $n);
        if ($set['ok']) {
            return ['ok' => true, 'kind' => 'set', 'reason' => ''];
        }
        $seq = self::validateSequence($naturals, count($wilds), $n);
        if ($seq['ok']) {
            return ['ok' => true, 'kind' => 'seq', 'reason' => ''];
        }
        return ['ok' => false, 'kind' => null, 'reason' => $seq['reason'] !== '' ? $seq['reason'] : $set['reason']];
    }

    private static function validateSet(array $naturals, int $wilds, int $total): array
    {
        $rank = self::rank($naturals[0]);
        foreach ($naturals as $c) {
            if (self::rank($c) !== $rank) {
                return ['ok' => false, 'reason' => 'أوراق الطقم يجب أن تكون بنفس الرقم'];
            }
        }
        if ($rank !== 3 && $rank !== 14) {
            return ['ok' => false, 'reason' => 'الأطقم مسموحة للثلاثات والأصوص فقط'];
        }
        if ($total - count($naturals) !== $wilds) {
            return ['ok' => false, 'reason' => 'عدد الأوراق غير متوازن'];
        }
        return ['ok' => true, 'reason' => ''];
    }

    private static function validateSequence(array $naturals, int $wilds, int $total): array
    {
        $suit = self::suit($naturals[0]);
        foreach ($naturals as $c) {
            if (self::suit($c) !== $suit) {
                return ['ok' => false, 'reason' => 'السلسلة تحتاج أوراقاً بنفس اللون'];
            }
        }
        // سلالم ممكنة: الآس منخفضاً (A=1) أو عالياً (A=14)
        $ladders = [[1, 13], [3, 14]];
        $bestReason = '';
        foreach ($ladders as [$min, $max]) {
            $positions = [];
            $dup = false;
            foreach ($naturals as $c) {
                $r = self::rank($c);
                $pos = $r === 14 ? ($min === 1 ? 1 : 14) : $r;
                if ($pos < $min || $pos > $max) {
                    $dup = true;
                    break;
                }
                if (isset($positions[$pos])) {
                    $dup = true;
                    break;
                }
                $positions[$pos] = true;
            }
            if ($dup) {
                $bestReason = 'ترتيب الأوراق غير صالح (تكرار أو خارج نطاق السلسلة)';
                continue;
            }
            $keys = array_keys($positions);
            sort($keys);
            $p1 = (int) $keys[0];
            $pk = (int) $keys[count($keys) - 1];
            $n = $total;
            // نحتاج مجالاً بطول n يبدأ من s، يضم كل الأوراق الطبيعية، ويقع داخل السلم
            $sMin = max($min, $pk - $n + 1);
            $sMax = min($p1, $max - $n + 1);
            if ($sMin <= $sMax) {
                return ['ok' => true, 'reason' => ''];
            }
            $bestReason = 'الأوراق ليست متتالية بما يكفي لهذا العدد';
        }
        return ['ok' => false, 'reason' => $bestReason];
    }

    /** نقاط النزول كمشروع (٠ إن كان أقل من ٧ أوراق) */
    public static function meldPoints(array $meld): int
    {
        $cards = (array) ($meld['cards'] ?? []);
        $n = count($cards);
        if ($n < 7) {
            return 0;
        }
        $wilds = 0;
        foreach ($cards as $c) {
            if (self::isWild((string) $c)) {
                $wilds++;
            }
        }
        if (($meld['kind'] ?? 'seq') === 'set') {
            return $wilds === 0 ? 300 : 150;
        }
        return $wilds === 0 ? 200 : 100;
    }

    public static function isClean(array $meld): bool
    {
        foreach ((array) ($meld['cards'] ?? []) as $c) {
            if (self::isWild((string) $c)) {
                return false;
            }
        }
        return true;
    }

    /** مجموع مشاريع الفريق */
    public static function teamProjects(array $s, int $team): int
    {
        $total = 0;
        foreach ((array) ($s['melds'][$team] ?? []) as $meld) {
            $total += self::meldPoints($meld);
        }
        return $total;
    }

    /** هل يمكن للفريق إغلاق الدور؟ (٣٠٠ كاملة أو ٢٠٠+١٠٠) */
    public static function canClose(array $s, int $team): bool
    {
        $has300 = false;
        $has200 = false;
        $has100 = false;
        foreach ((array) ($s['melds'][$team] ?? []) as $meld) {
            $p = self::meldPoints($meld);
            if ($p === 300) {
                $has300 = true;
            } elseif ($p === 200) {
                $has200 = true;
            } elseif ($p === 100) {
                $has100 = true;
            }
        }
        return $has300 || ($has200 && $has100);
    }

    /* ============================ قيم الأوراق والحساب ============================ */

    /** قيمة الورقة — طريقة جواكر المبسّطة */
    public static function cardValueJawaker(string $code): float
    {
        $r = self::rank($code);
        if ($r === 15 || $r === 14) {
            return 1.5;
        }
        if ($r === 7) {
            return 1.0;
        }
        if ($r === 3) {
            return 0.5;
        }
        return 0.0;
    }

    /** قيمة الورقة — الطريقة الشعبية (جوكر ١٥، آس ١١، ١٠–شاه ١٠، والباقي بقيمته) */
    public static function cardValuePopular(string $code): float
    {
        $r = self::rank($code);
        if ($r === 15) {
            return 15.0;
        }
        if ($r === 14) {
            return 11.0;
        }
        if ($r >= 10) {
            return 10.0;
        }
        return (float) $r;
    }

    public static function cardValue(array $s, string $code): float
    {
        return self::mode($s) === 'popular' ? self::cardValuePopular($code) : self::cardValueJawaker($code);
    }

    /** قيمة أوراق نزولات الفريق */
    public static function meldsValue(array $s, int $team): float
    {
        $sum = 0.0;
        foreach ((array) ($s['melds'][$team] ?? []) as $meld) {
            foreach ((array) ($meld['cards'] ?? []) as $c) {
                $sum += self::cardValue($s, (string) $c);
            }
        }
        return $sum;
    }

    /** قيمة أوراق يد لاعب */
    public static function handValue(array $s, int $seat): float
    {
        $sum = 0.0;
        foreach ((array) ($s['hands'][$seat] ?? []) as $c) {
            $sum += self::cardValue($s, (string) $c);
        }
        return $sum;
    }

    /* ============================ الأفعال ============================ */

    private static function requireTurn(array $s, int $seat): void
    {
        if (($s['phase'] ?? '') !== 'playing') {
            throw new \RuntimeException('الدور لم يبدأ بعد');
        }
        if ((int) $s['turn'] !== $seat) {
            throw new \RuntimeException('ليس دورك الآن');
        }
    }

    private static function handIndex(array $hand, string $code): int
    {
        foreach ($hand as $i => $c) {
            if ($c === $code) {
                return (int) $i;
            }
        }
        return -1;
    }

    /** إزالة ورقة من يد اللاعب */
    private static function removeFromHand(array &$s, int $seat, string $code): bool
    {
        $i = self::handIndex((array) $s['hands'][$seat], $code);
        if ($i < 0) {
            return false;
        }
        array_splice($s['hands'][$seat], $i, 1);
        return true;
    }

    /** سحب ورقة من الرزمة (أو نهاية الدور إن نفدت) */
    public static function applyDraw(array &$s, int $seat, string $source = 'deck'): void
    {
        self::requireTurn($s, $seat);
        if (empty($s['needDraw'])) {
            throw new \RuntimeException('سحبت ورقة هذا الدور — العب أو ارمِ');
        }
        if ($source === 'pile') {
            $pile = (array) ($s['discard'] ?? []);
            if (empty($pile)) {
                throw new \RuntimeException('كومة الرمي فارغة');
            }
            if (empty($s['melds'][$seat % 2])) {
                throw new \RuntimeException('لا يمكنك أخذ كومة الرمي قبل النزول (نزّل مرة واحدة على الأقل)');
            }
            if (!self::pileUseful($s, $seat)) {
                throw new \RuntimeException('لا يمكنك أخذ كومة الرمي — لا ورقة فيها تنزل أو تُضاف الآن');
            }
            foreach ($pile as $c) {
                $s['hands'][$seat][] = $c;
            }
            $s['discard'] = [];
            $s['pilePending'] = true;
            $s['pileCards'] = array_values($pile);
            self::log($s, 'take_pile', ['seat' => $seat, 'count' => count($pile)]);
        } else {
            if (empty($s['deck'])) {
                self::endRound($s, null, 'deck_out');
                return;
            }
            $card = array_shift($s['deck']);
            $s['hands'][$seat][] = $card;
            self::log($s, 'draw', ['seat' => $seat]);
        }
        sort($s['hands'][$seat], SORT_STRING);
        $s['needDraw'] = false;
        $s['turnStartedAt'] = self::now();
    }

    /** نزول مجموعة أوراق جديدة من يد اللاعب */
    public static function applyMeld(array &$s, int $seat, array $codes): int
    {
        self::requireTurn($s, $seat);
        if (!empty($s['needDraw'])) {
            throw new \RuntimeException('اسحب ورقة أولاً');
        }
        $codes = array_values(array_filter(array_map('strval', $codes)));
        if (count($codes) < 3) {
            throw new \RuntimeException('النزول يحتاج ٣ أوراق على الأقل');
        }
        $check = self::validateMeld($codes);
        if (!$check['ok']) {
            throw new \RuntimeException((string) $check['reason']);
        }
        $hand = (array) $s['hands'][$seat];
        if (count($hand) - count($codes) < 1) {
            throw new \RuntimeException('أبقِ ورقة واحدة على الأقل لترميها');
        }
        foreach ($codes as $c) {
            if (!self::removeFromHand($s, $seat, $c)) {
                throw new \RuntimeException('ورقة غير موجودة في يدك: ' . $c);
            }
        }
        $s['meldId'] = (int) $s['meldId'] + 1;
        $team = $seat % 2;
        $s['melds'][$team][] = [
            'id' => (int) $s['meldId'],
            'kind' => (string) $check['kind'],
            'cards' => $codes,
            'by' => $seat,
            'at' => time(),
        ];
        // أوراق المبدّل لا تنتقل بين النزولات — ويجب استخدام ورقة من كومة الرمي إن أخذتها
        self::markPileUsed($s, $codes);
        self::log($s, 'meld', ['seat' => $seat, 'kind' => $check['kind'], 'n' => count($codes)]);
        return (int) $s['meldId'];
    }

    /** إضافة أوراق إلى نزول قائم لفريق اللاعب */
    public static function applyAdd(array &$s, int $seat, int $meldId, array $codes): void
    {
        self::requireTurn($s, $seat);
        if (!empty($s['needDraw'])) {
            throw new \RuntimeException('اسحب ورقة أولاً');
        }
        $codes = array_values(array_filter(array_map('strval', $codes)));
        if (empty($codes)) {
            throw new \RuntimeException('لم تختر أوراقاً');
        }
        $team = $seat % 2;
        $index = -1;
        foreach ((array) $s['melds'][$team] as $i => $meld) {
            if ((int) ($meld['id'] ?? 0) === $meldId) {
                $index = (int) $i;
                break;
            }
        }
        if ($index < 0) {
            throw new \RuntimeException('النزول غير موجود لفريقك');
        }
        $cards = array_merge((array) $s['melds'][$team][$index]['cards'], $codes);
        $check = self::validateMeld($cards);
        if (!$check['ok']) {
            throw new \RuntimeException((string) $check['reason']);
        }
        if ((string) $check['kind'] !== (string) ($s['melds'][$team][$index]['kind'] ?? 'seq')) {
            throw new \RuntimeException('لا يمكن تحويل نوع النزول');
        }
        $hand = (array) $s['hands'][$seat];
        if (count($hand) - count($codes) < 1) {
            throw new \RuntimeException('أبقِ ورقة واحدة على الأقل لترميها');
        }
        foreach ($codes as $c) {
            if (!self::removeFromHand($s, $seat, $c)) {
                throw new \RuntimeException('ورقة غير موجودة في يدك: ' . $c);
            }
        }
        sort($cards, SORT_STRING);
        $s['melds'][$team][$index]['cards'] = array_values($cards);
        self::markPileUsed($s, $codes);
        self::log($s, 'add', ['seat' => $seat, 'meld' => $meldId, 'n' => count($codes)]);
    }

    /** رمي ورقة (وإن كانت الأخيرة ينتهي الدور أو يُسحب مور) */
    public static function applyDiscard(array &$s, int $seat, string $code): void
    {
        self::requireTurn($s, $seat);
        if (!empty($s['needDraw'])) {
            throw new \RuntimeException('اسحب ورقة أولاً');
        }
        if (!empty($s['pilePending'])) {
            throw new \RuntimeException('أخذت كومة الرمي — انزل بورقة منها على الأقل قبل أن ترمي');
        }
        if (!self::removeFromHand($s, $seat, $code)) {
            throw new \RuntimeException('ورقة غير موجودة في يدك');
        }
        $s['discard'][] = $code;
        self::log($s, 'discard', ['seat' => $seat]);

        $team = $seat % 2;
        $handLeft = count((array) $s['hands'][$seat]);

        if ($handLeft === 0) {
            // أنهى أوراقه: إغلاق إن كان لديه ٣٠٠ مشاريع، وإلا يأخذ المور ويكمل
            if (self::canClose($s, $team)) {
                self::endRound($s, $team, 'closed');
                return;
            }
            $pile = (array) ($s['mor'][$team] ?? []);
            if (!empty($pile) && empty($s['morTaken'][$team])) {
                $s['hands'][$seat] = array_values($pile);
                sort($s['hands'][$seat], SORT_STRING);
                $s['mor'][$team] = [];
                $s['morTaken'][$team] = true;
                $s['pileCards'] = [];
                $s['pilePending'] = false;
                self::log($s, 'take_mor', ['seat' => $seat, 'team' => $team, 'auto' => true]);
            }
            // بلا مور وبلا مشاريع كافية: نُعيد الورقة (لا يحدث عملياً لأن الرمي ممنوع عندها)
        }

        // الدور التالي
        $s['turn'] = self::nextSeat($s, $seat);
        $s['needDraw'] = true;
        $s['pilePending'] = false;
        $s['pileCards'] = [];
        $s['turnStartedAt'] = self::now();
    }

    /** إن استُخدمت ورقة من كومة الرمي انتهى شرط الاستخدام */
    private static function markPileUsed(array &$s, array $codes): void
    {
        if (empty($s['pilePending'])) {
            return;
        }
        foreach ($codes as $c) {
            if (in_array((string) $c, (array) ($s['pileCards'] ?? []), true)) {
                $s['pilePending'] = false;
                $s['pileCards'] = [];
                return;
            }
        }
    }

    /** أخذ كومة المور يدوياً (عندما تصبح أوراقك ورقة واحدة) */
    public static function takeMor(array &$s, int $seat): void
    {
        self::requireTurn($s, $seat);
        $team = $seat % 2;
        if (!empty($s['morTaken'][$team])) {
            throw new \RuntimeException('فريقك أخذ المور من قبل');
        }
        if (empty($s['mor'][$team])) {
            throw new \RuntimeException('لا يوجد مور متبقٍ لفريقك');
        }
        if (count((array) $s['hands'][$seat]) > 1) {
            throw new \RuntimeException('تأخذ المور عندما تنهي أوراقك (ورقة واحدة أو أقل)');
        }
        $pile = (array) $s['mor'][$team];
        $s['hands'][$seat] = array_values(array_merge((array) $s['hands'][$seat], $pile));
        sort($s['hands'][$seat], SORT_STRING);
        $s['mor'][$team] = [];
        $s['morTaken'][$team] = true;
        self::log($s, 'take_mor', ['seat' => $seat, 'team' => $team, 'auto' => false]);
    }

    private static function nextSeat(array $s, int $from): int
    {
        return ($from + 1) % 4;
    }

    /** الدور التالي للاعب مبني على الجلوس (عكس عقارب الساعة) */
    public static function turnSeat(array $s): int
    {
        return (int) ($s['turn'] ?? 0);
    }

    /* ============================ نهاية الدور ============================ */

    public static function endRound(array &$s, ?int $winnerTeam, string $reason): void
    {
        $mode = self::mode($s);
        $projects = [self::teamProjects($s, 0), self::teamProjects($s, 1)];
        $deltas = [0, 0];
        $meldsValue = [self::meldsValue($s, 0), self::meldsValue($s, 1)];

        if ($reason === 'closed' && $winnerTeam !== null) {
            $loser = 1 - $winnerTeam;
            if ($mode === 'popular') {
                // ١٠٠ للإغلاق + ١٠٠ لكل مشروع (نظيف = ضعف) + قيمة أوراق الطاولة − ١٠٠ إن لم يأخذ موراً
                $projectsBonus = 0;
                foreach ((array) $s['melds'][$winnerTeam] as $meld) {
                    $p = self::meldPoints($meld);
                    if ($p <= 0) {
                        continue;
                    }
                    $projectsBonus += $p;
                    if (self::isClean($meld)) {
                        $projectsBonus += 100;
                    }
                }
                $win = 100 + $projectsBonus + (int) round($meldsValue[$winnerTeam]);
                if (empty($s['morTaken'][$winnerTeam])) {
                    $win -= 100;
                }
                $deltas[$winnerTeam] = $win;
                $deltas[$loser] = empty($s['morTaken'][$loser]) ? -100 : 0;
            } else {
                // طريقة جواكر: +١٠ للفوز + قيم الأوراق (٣ = ٠٫٥، ٧ = ١، آس/جوكر = ١٫٥)
                $win = 10.0 + $meldsValue[$winnerTeam];
                if (empty($s['morTaken'][$winnerTeam])) {
                    $win -= 10.0;
                }
                $deltas[$winnerTeam] = (int) round($win);
                $deltas[$loser] = empty($s['morTaken'][$loser]) ? -10 : 0;
            }
        } else {
            // نفدت الرزمة: تُحسب الأوراق الملعوبة ناقص الأوراق في اليد
            for ($t = 0; $t < 2; $t++) {
                $hand = 0.0;
                for ($seat = 0; $seat < 4; $seat++) {
                    if ($seat % 2 === $t) {
                        $hand += self::handValue($s, $seat);
                    }
                }
                $deltas[$t] = (int) round($meldsValue[$t] - $hand);
            }
        }

        $s['roundDeltas'] = $deltas;
        $s['scores'][0] = (int) $s['scores'][0] + $deltas[0];
        $s['scores'][1] = (int) $s['scores'][1] + $deltas[1];
        $s['winnerTeam'] = $winnerTeam;
        $s['summary'] = [
            'reason' => $reason,
            'winnerTeam' => $winnerTeam,
            'deltas' => $deltas,
            'projects' => $projects,
            'meldsValue' => array_map(static fn($v) => (int) round((float) $v), $meldsValue),
            'morTaken' => [(bool) $s['morTaken'][0], (bool) $s['morTaken'][1]],
            'cardsLeft' => [count((array) $s['hands'][0]), count((array) $s['hands'][1]), count((array) $s['hands'][2]), count((array) $s['hands'][3])],
            'hands' => [array_values((array) $s['hands'][0]), array_values((array) $s['hands'][1]), array_values((array) $s['hands'][2]), array_values((array) $s['hands'][3])],
            'mode' => $mode,
            'scores' => [(int) $s['scores'][0], (int) $s['scores'][1]],
            'round' => (int) $s['roundNo'],
        ];
        self::log($s, 'round_end', ['winner' => $winnerTeam, 'reason' => $reason]);

        // نهاية المباراة؟
        $target = self::target($s);
        $t0 = (int) $s['scores'][0];
        $t1 = (int) $s['scores'][1];
        if ($t0 >= $target || $t1 >= $target) {
            if ($t0 === $t1) {
                $s['phase'] = 'round_end'; // تعادل: دور إضافي
                return;
            }
            $s['phase'] = 'game_end';
            $s['winnerTeam'] = $t0 > $t1 ? 0 : 1;
            return;
        }
        $s['phase'] = 'round_end';
    }

    /** الانتقال إلى الدور التالي (بتصويت اللاعبين) */
    public static function continueRound(array &$s, int $seat): void
    {
        if (($s['phase'] ?? '') === 'game_end') {
            return;
        }
        if (($s['phase'] ?? '') !== 'round_end') {
            return;
        }
        $s['continue'] = array_values(array_unique(array_merge((array) ($s['continue'] ?? []), [$seat])));
        $need = [];
        foreach ((array) $s['seats'] as $i => $pl) {
            if ($pl !== null && empty($pl['isBot'])) {
                $need[] = (int) $i;
            }
        }
        $ready = array_values(array_filter($need, static fn($i) => in_array($i, (array) $s['continue'], true)));
        if (count($ready) >= count($need) && count($need) > 0) {
            self::nextRound($s);
        }
    }

    public static function nextRound(array &$s): void
    {
        $s['roundNo'] = (int) $s['roundNo'] + 1;
        $s['dealer'] = ((int) $s['dealer'] + 1) % 4;
        $s['continue'] = [];
        self::startRound($s, false);
        self::log($s, 'next_round', ['round' => (int) $s['roundNo']]);
    }

    /* ============================ العرض للواجهة ============================ */

    private static function meldsView(array $s, int $team): array
    {
        $out = [];
        foreach ((array) ($s['melds'][$team] ?? []) as $meld) {
            $cards = array_values((array) ($meld['cards'] ?? []));
            $points = self::meldPoints($meld);
            $out[] = [
                'id' => (int) ($meld['id'] ?? 0),
                'kind' => (string) ($meld['kind'] ?? 'seq'),
                'cards' => $cards,
                'by' => (int) ($meld['by'] ?? 0),
                'points' => $points,
                'project' => $points > 0,
                'clean' => self::isClean($meld),
                'count' => count($cards),
            ];
        }
        return $out;
    }

    public static function publicView(array $s, int $seat): array
    {
        $phase = (string) ($s['phase'] ?? 'playing');
        $myTurn = (int) ($s['turn'] ?? -1) === $seat && $phase === 'playing';
        $team = $seat % 2;
        $settings = (array) ($s['settings'] ?? []);
        $deadline = null;
        if ($phase === 'playing') {
            $limit = (int) ($settings['turnTime'] ?? 30);
            if ($limit > 0) {
                $deadline = max(0, (int) round(((float) $s['turnStartedAt'] + $limit - self::now()) * 1000));
            }
        }

        $seats = [];
        $handCounts = [];
        foreach ((array) $s['seats'] as $i => $pl) {
            $handCounts[] = count((array) ($s['hands'][$i] ?? []));
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
                'seat' => (int) $i,
                'team' => (int) $i % 2,
            ];
        }

        $myHand = array_values((array) ($s['hands'][$seat] ?? []));
        sort($myHand, SORT_STRING);

        $discard = array_values((array) ($s['discard'] ?? []));
        $canTakePile = $myTurn && !empty($s['needDraw']) && !empty($discard) && !empty($s['melds'][$team])
            && self::pileUseful($s, $seat);
        $handLeft = count((array) ($s['hands'][$seat] ?? []));

        return [
            'version' => (int) $s['version'],
            'game' => 'mor',
            'roomCode' => (string) ($s['roomCode'] ?? ''),
            'roomName' => (string) ($s['roomName'] ?? ''),
            'phase' => $phase,
            'seats' => $seats,
            'mySeat' => $seat,
            'dealer' => (int) ($s['dealer'] ?? 0),
            'turn' => (int) ($s['turn'] ?? -1),
            'myHand' => $myHand,
            'handCounts' => $handCounts,
            'trick' => [],
            'scores' => [(int) ($s['scores'][0] ?? 0), (int) ($s['scores'][1] ?? 0)],
            'round' => (int) ($s['roundNo'] ?? 1),
            'target' => self::target($s),
            'settings' => $settings,
            'deadline' => $deadline,
            'log' => array_slice((array) $s['log'], -60),
            'chat' => array_slice((array) $s['chat'], -60),
            'myTeam' => $team,
            'isMyTurn' => $myTurn,
            'legalCards' => [],
            'legalBids' => [],
            'canPass' => false,
            'canDouble' => false,
            'mustChooseTrump' => false,
            'wonTrick' => false,
            'winnerTeam' => $phase === 'game_end' ? $s['winnerTeam'] : null,
            'lastRoundSummary' => $s['summary'] ?? null,
            'mor' => [
                'mode' => self::mode($s),
                'roundNo' => (int) ($s['roundNo'] ?? 1),
                'deckCount' => count((array) ($s['deck'] ?? [])),
                'discard' => array_slice($discard, -8),
                'discardCount' => count($discard),
                'discardTop' => empty($discard) ? null : $discard[count($discard) - 1],
                'morCounts' => [count((array) ($s['mor'][0] ?? [])), count((array) ($s['mor'][1] ?? []))],
                'morTaken' => [(bool) $s['morTaken'][0], (bool) $s['morTaken'][1]],
                'melds' => [self::meldsView($s, 0), self::meldsView($s, 1)],
                'teamProjects' => [self::teamProjects($s, 0), self::teamProjects($s, 1)],
                'canClose' => [self::canClose($s, 0), self::canClose($s, 1)],
                'needDraw' => (bool) ($s['needDraw'] ?? true),
                'pilePending' => (bool) ($s['pilePending'] ?? false),
                // أوراق كومة الرمي التي بيدك الآن — تُميَّز في الواجهة حتى تعرف ما يجب أن تنزّله
                'pileCards' => array_values((array) ($s['pileCards'] ?? [])),
                'canTakePile' => $canTakePile,
                'canTakeMor' => $myTurn && $handLeft === 1 && empty($s['morTaken'][$team]) && !empty($s['mor'][$team]),
                'canCloseNow' => $myTurn && $handLeft === 1 && !empty($s['melds'][$team]) && self::canClose($s, $team),
                'continue' => array_map('intval', (array) ($s['continue'] ?? [])),
            ],
        ];
    }
    /* ============================ البوتات والمهل ============================ */

    /** هل يخطئ البوت هذه المرة؟ (بمستوى من أضافه — لا أقوى منه) */
    private static function shouldBlunder(array $s, int $seat): bool
    {
        $pl = $s['seats'][$seat] ?? null;
        $skill = isset($pl['botSkills'])
            ? max(0.05, min(1.0, (float) $pl['botSkills']))
            : max(0.05, min(1.0, ((int) ($pl['level'] ?? 1)) / 40));
        $chance = (int) round(max(0.0, (1.0 - $skill) * 45));
        return $chance > 0 && random_int(1, 100) <= $chance;
    }

    /**
     * خطة استخدام كومة الرمي: نزول أو إضافة تستخدم ورقة من الكومة فعلاً
     * @return array{type:string,meld:int,cards:array}|null
     */
    public static function botPileMeld(array $s, int $seat): ?array
    {
        $team = $seat % 2;
        $hand = array_values((array) $s['hands'][$seat]);
        $pile = array_values((array) $s['discard']);
        if (empty($pile)) {
            return null;
        }
        // ١) ورقة تكمل نزولاً قائماً
        foreach ($pile as $card) {
            foreach ((array) $s['melds'][$team] as $meld) {
                $try = array_merge((array) $meld['cards'], [(string) $card]);
                $check = self::validateMeld($try);
                if ($check['ok'] && (string) $check['kind'] === (string) $meld['kind']) {
                    return ['type' => 'add', 'meld' => (int) $meld['id'], 'cards' => [(string) $card]];
                }
            }
        }
        // ٢) ورقة + ورقتان من اليد = نزول صالح (مع إبقاء ورقة للرمي)
        $n = count($hand);
        for ($i = 0; $i < $n; $i++) {
            for ($j = $i + 1; $j < $n; $j++) {
                foreach ($pile as $card) {
                    $try = [(string) $card, (string) $hand[$i], (string) $hand[$j]];
                    $check = self::validateMeld($try);
                    if ($check['ok'] && $n - 3 >= 1) {
                        return ['type' => 'meld', 'meld' => 0, 'cards' => $try];
                    }
                }
            }
        }
        return null;
    }

    /** هل تحوي كومة الرمي ورقةً يمكن استخدامها فوراً؟ */
    public static function pileUseful(array $s, int $seat): bool
    {
        return self::botPileMeld($s, $seat) !== null;
    }

    /** إكمال دور البوت كاملاً: سحب → نزول/إضافة → رمي */
    public static function botAct(array &$s): bool
    {
        if (($s['phase'] ?? '') !== 'playing') {
            return false;
        }
        $seat = (int) $s['turn'];
        $pl = $s['seats'][$seat] ?? null;
        if ($pl === null || empty($pl['isBot'])) {
            return false;
        }
        $blunder = self::shouldBlunder($s, $seat);
        $team = $seat % 2;

        // ١) السحب: يفضّل كومة الرمي إن كانت مفيدة
        if (!empty($s['needDraw'])) {
            if (!$blunder && !empty($s['melds'][$team]) && !empty($s['discard']) && self::pileUseful($s, $seat)) {
                self::applyDraw($s, $seat, 'pile');
            } else {
                self::applyDraw($s, $seat, 'deck');
            }
            if (($s['phase'] ?? '') !== 'playing') {
                return true; // نفدت الرزمة وانتهى الدور
            }
        }

        // ٢) أخذ المور إن بقي ورقة واحدة بلا إمكانية إغلاق
        if (count((array) $s['hands'][$seat]) === 1 && empty($s['morTaken'][$team]) && !empty($s['mor'][$team]) && !self::canClose($s, $team)) {
            self::takeMor($s, $seat);
        }

        // ٣) النزول والإضافة
        if (!$blunder || random_int(1, 100) <= 55) {
            self::botLayCards($s, $seat);
        }
        // إن أخذ كومة الرمي ولم يستخدم منها شيئاً: نفّذ الخطة أو أعِد الأوراق
        if (!empty($s['pilePending'])) {
            $plan = self::botPileMeld($s, $seat);
            if ($plan !== null) {
                try {
                    if ($plan['type'] === 'add') {
                        self::applyAdd($s, $seat, (int) $plan['meld'], (array) $plan['cards']);
                    } else {
                        self::applyMeld($s, $seat, (array) $plan['cards']);
                    }
                } catch (\Throwable $e) {
                    // نكمل إلى إعادة الأوراق
                }
            }
            if (!empty($s['pilePending'])) {
                self::returnPileToDiscard($s, $seat);
            }
        }

        // ٤) الرمي
        $card = self::botChooseDiscard($s, $seat);
        if ($card !== null) {
            self::applyDiscard($s, $seat, $card);
        }
        return true;
    }

    /** انتهاء المهلة: نفّذ حركة آلية معقولة */
    public static function autoAct(array &$s): bool
    {
        if (($s['phase'] ?? '') !== 'playing') {
            return false;
        }
        $seat = (int) $s['turn'];
        if (!empty($s['needDraw'])) {
            self::applyDraw($s, $seat, 'deck');
            if (($s['phase'] ?? '') !== 'playing') {
                return true;
            }
        }
        $team = $seat % 2;
        if (count((array) $s['hands'][$seat]) === 1 && empty($s['morTaken'][$team]) && !empty($s['mor'][$team]) && !self::canClose($s, $team)) {
            self::takeMor($s, $seat);
        }
        self::botLayCards($s, $seat);
        $card = self::botChooseDiscard($s, $seat);
        if ($card !== null) {
            self::applyDiscard($s, $seat, $card);
        }
        return true;
    }

    /** إعادة أوراق كومة الرمي (حالة نادرة: تعذّر استخدامها) */
    private static function returnPileToDiscard(array &$s, int $seat): void
    {
        foreach (array_values((array) ($s['pileCards'] ?? [])) as $c) {
            $i = self::handIndex((array) $s['hands'][$seat], (string) $c);
            if ($i >= 0) {
                array_splice($s['hands'][$seat], $i, 1);
                $s['discard'][] = (string) $c;
            }
        }
        $s['pilePending'] = false;
        $s['pileCards'] = [];
    }

    /** يبحث عن أفضل نزول/إضافة متاحة ويلعبها (حتى ٤ حركات) */
    private static function botLayCards(array &$s, int $seat): void
    {
        $team = $seat % 2;
        for ($round = 0; $round < 4; $round++) {
            if (self::botAddOne($s, $seat)) {
                continue;
            }
            $meld = self::botFindMeld($s, $seat);
            if ($meld === null) {
                return;
            }
            try {
                self::applyMeld($s, $seat, $meld);
            } catch (\Throwable $e) {
                return;
            }
        }
    }

    /** إضافة أي ورقة من اليد إلى نزولات الفريق */
    private static function botAddOne(array &$s, int $seat): bool
    {
        $team = $seat % 2;
        $hand = (array) $s['hands'][$seat];
        if (count($hand) <= 1) {
            return false;
        }
        foreach ((array) $s['melds'][$team] as $meld) {
            foreach ($hand as $card) {
                $try = array_merge((array) $meld['cards'], [(string) $card]);
                $check = self::validateMeld($try);
                if ($check['ok'] && (string) $check['kind'] === (string) $meld['kind']) {
                    try {
                        self::applyAdd($s, $seat, (int) $meld['id'], [(string) $card]);
                        return true;
                    } catch (\Throwable $e) {
                        continue;
                    }
                }
            }
        }
        return false;
    }

    /** البحث عن أفضل نزول جديد من أوراق اليد */
    private static function botFindMeld(array $s, int $seat): ?array
    {
        $hand = array_values((array) $s['hands'][$seat]);
        if (count($hand) < 3) {
            return null;
        }
        $wilds = array_values(array_filter($hand, static fn($c) => self::isWild((string) $c)));
        $naturals = array_values(array_filter($hand, static fn($c) => !self::isWild((string) $c)));
        $best = null;
        $bestScore = 0;

        // أطقم الثلاثات والأصوص
        $byRank = [];
        foreach ($naturals as $c) {
            $r = self::rank((string) $c);
            if ($r === 3 || $r === 14) {
                $byRank[$r][] = (string) $c;
            }
        }
        foreach ($byRank as $cards) {
            $n = count($cards);
            if ($n >= 3 && $n > $bestScore) {
                $best = array_slice($cards, 0, min($n, 7));
                $bestScore = $n;
            }
        }

        // سلاسل لكل لون
        $bySuit = [];
        foreach ($naturals as $c) {
            $bySuit[self::suit((string) $c)][] = (string) $c;
        }
        foreach ($bySuit as $cards) {
            $ranks = [];
            foreach ($cards as $c) {
                $ranks[] = self::rank($c);
            }
            sort($ranks);
            $ranks = array_values(array_unique($ranks));
            $n = count($ranks);
            for ($i = 0; $i < $n; $i++) {
                for ($len = $n - $i; $len >= 3; $len--) {
                    $slice = array_slice($ranks, $i, $len);
                    $span = $slice[count($slice) - 1] - $slice[0] + 1;
                    $gaps = $span - $len;
                    $needWilds = $gaps;
                    if ($needWilds > count($wilds) || $needWilds > 2) {
                        continue;
                    }
                    // لا نُهدر المبدّلات إلا على مشروع (٧+)
                    if ($needWilds > 0 && $len + $needWilds < 7) {
                        continue;
                    }
                    $chosen = [];
                    foreach ($slice as $r) {
                        foreach ($cards as $c) {
                            if (self::rank($c) === $r && !in_array($c, $chosen, true)) {
                                $chosen[] = $c;
                                break;
                            }
                        }
                    }
                    for ($w = 0; $w < $needWilds; $w++) {
                        if (!isset($wilds[$w])) {
                            break 2;
                        }
                        $chosen[] = $wilds[$w];
                    }
                    if (count($chosen) < 3) {
                        continue;
                    }
                    if (!self::validateMeld($chosen)['ok']) {
                        continue;
                    }
                    $score = count($chosen) + ($needWilds === 0 ? 2 : 0);
                    if ($score > $bestScore) {
                        $best = $chosen;
                        $bestScore = $score;
                    }
                    break;
                }
            }
        }
        return $best;
    }

    /** اختيار ورقة الرمي: الأقل فائدة */
    private static function botChooseDiscard(array $s, int $seat): ?string
    {
        $hand = array_values((array) $s['hands'][$seat]);
        if (empty($hand)) {
            return null;
        }
        $counts = [];
        foreach ($hand as $c) {
            $r = self::rank((string) $c);
            $counts[$r] = ($counts[$r] ?? 0) + 1;
        }
        $worst = null;
        $worstScore = PHP_FLOAT_MAX;
        foreach ($hand as $c) {
            $code = (string) $c;
            $r = self::rank($code);
            if ($r === 15) {
                $score = 100.0; // الجوكر ثمين
            } else {
                $score = self::cardValue($s, $code) * 10.0;
                if ($r === 3 || $r === 14) {
                    $score += 12.0; // أوراق الأطقم
                }
                if (($counts[$r] ?? 0) > 1) {
                    $score += 8.0 * (($counts[$r] ?? 1) - 1);
                }
                if ($r === 2) {
                    $score += 20.0; // مبدّل
                }
                // سلاسل قريبة
                foreach ([$r - 1, $r + 1] as $near) {
                    if (isset($counts[$near])) {
                        $score += 5.0;
                    }
                }
            }
            if ($score < $worstScore) {
                $worstScore = $score;
                $worst = $code;
            }
        }
        return $worst;
    }

    /* ============================ التحديث الدوري ============================ */

    public static function tick(array &$s): void
    {
        $phase = (string) ($s['phase'] ?? '');
        if ($phase === 'round_end') {
            // إن كان كل الموجودين بوتات ننتقل تلقائياً
            $humans = 0;
            foreach ((array) $s['seats'] as $pl) {
                if ($pl !== null && empty($pl['isBot'])) {
                    $humans++;
                }
            }
            if ($humans === 0 && self::now() - (float) $s['turnStartedAt'] >= 2.0) {
                self::nextRound($s);
            }
            return;
        }
        if ($phase !== 'playing') {
            return;
        }
        $seat = (int) $s['turn'];
        $pl = $s['seats'][$seat] ?? null;
        if ($pl === null) {
            return;
        }
        $elapsed = self::now() - (float) $s['turnStartedAt'];
        if (!empty($pl['isBot'])) {
            if ($elapsed >= (float) Config::get('bot_delay', 0.35)) {
                if (!self::botAct($s)) {
                    self::autoAct($s);
                }
            }
            return;
        }
        $limit = (int) ($s['settings']['turnTime'] ?? 30);
        if ($limit > 0 && $elapsed >= (float) $limit) {
            self::autoAct($s);
        }
    }

    /** تسجيل حركة في السجل */
    private static function log(array &$s, string $t, array $data = []): void
    {
        Engine::log($s, $t, $data);
    }
}
