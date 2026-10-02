<?php
declare(strict_types=1);

namespace Trix\Core;

/** إدارة اللاعبين: الملف الشخصي، النقاط، العملات، المتجر، المتصدرون */
final class Users
{
    public static function find(int $id): ?array
    {
        return Db::one('SELECT * FROM users WHERE id = ?', [$id]);
    }

    public static function levelFromXp(int $xp): array
    {
        // كل مستوى يحتاج 250 نقطة خبرة إضافية تدريجياً
        $level = 1;
        $need = 250;
        $remaining = $xp;
        while ($remaining >= $need && $level < 100) {
            $remaining -= $need;
            $level++;
            $need = 250 + ($level - 1) * 120;
        }
        return ['level' => $level, 'into' => $remaining, 'need' => $need];
    }

    public static function publicProfile(array $user): array
    {
        $lvl = self::levelFromXp((int) $user['xp']);
        $played = max(1, (int) $user['games_played']);
        return [
            'id' => (int) $user['id'],
            'username' => (string) $user['username'],
            'name' => (string) $user['display_name'],
            'avatar' => (string) $user['avatar'],
            'coins' => (int) $user['coins'],
            'xp' => (int) $user['xp'],
            'level' => $lvl['level'],
            'levelInto' => $lvl['into'],
            'levelNeed' => $lvl['need'],
            'gamesPlayed' => (int) $user['games_played'],
            'gamesWon' => (int) $user['games_won'],
            'winRate' => (int) round(((int) $user['games_won'] / $played) * 100),
            'kaboot' => (int) $user['kaboot_count'],
            'streak' => (int) $user['streak'],
            'maxStreak' => (int) $user['max_streak'],
            'isGuest' => (bool) $user['is_guest'],
            'isAdmin' => (bool) $user['is_admin'],
            'avatarFrame' => self::equipped($user, 'frame'),
            'cardBack' => (string) $user['card_back'],
            'tableTheme' => (string) $user['table_theme'],
        ];
    }

    public static function inventory(array $user): array
    {
        $inv = json_decode((string) $user['inventory'], true);
        return is_array($inv) ? $inv : [];
    }

    public static function equipped(array $user, string $type): ?string
    {
        $inv = self::inventory($user);
        return isset($inv['equipped'][$type]) ? (string) $inv['equipped'][$type] : null;
    }

    public static function addCoins(int $userId, int $amount, string $kind, string $ref = ''): int
    {
        if ($amount === 0) {
            return 0;
        }
        Db::exec('UPDATE users SET coins = MAX(0, coins + ?) WHERE id = ?', [$amount, $userId]);
        Db::insert('transactions', [
            'user_id' => $userId,
            'amount' => $amount,
            'kind' => $kind,
            'ref' => $ref,
            'created_at' => time(),
        ]);
        $coins = (int) Db::value('SELECT coins FROM users WHERE id = ?', [$userId]);
        return $coins;
    }

    public static function addXp(int $userId, int $amount): void
    {
        if ($amount <= 0) {
            return;
        }
        Db::exec('UPDATE users SET xp = xp + ? WHERE id = ?', [$amount, $userId]);
        $xp = (int) Db::value('SELECT xp FROM users WHERE id = ?', [$userId]);
        $level = self::levelFromXp($xp)['level'];
        Db::exec('UPDATE users SET level = ? WHERE id = ?', [$level, $userId]);
    }

    /** تسجيل نتيجة مباراة للاعب */
    public static function recordResult(int $userId, bool $won, bool $kaboot, int $rounds): void
    {
        Db::exec(
            'UPDATE users SET games_played = games_played + 1, rounds_played = rounds_played + ?,'
            . ' games_won = games_won + ?, kaboot_count = kaboot_count + ? WHERE id = ?',
            [$rounds, $won ? 1 : 0, $kaboot ? 1 : 0, $userId]
        );
        if ($won) {
            Db::exec('UPDATE users SET streak = streak + 1, max_streak = MAX(max_streak, streak + 1) WHERE id = ?', [$userId]);
            self::addXp($userId, 120 + $rounds * 4);
            self::addCoins($userId, (int) Config::get('coins_win', 120), 'match_win');
        } else {
            Db::exec('UPDATE users SET streak = 0 WHERE id = ?', [$userId]);
            self::addXp($userId, 45 + $rounds * 2);
            self::addCoins($userId, (int) Config::get('coins_lose', 40), 'match_lose');
        }
        if ($kaboot) {
            self::addCoins($userId, 60, 'kaboot_bonus');
        }
    }

    /** أعلى اللاعبين */
    public static function leaderboard(int $limit = 50): array
    {
        $rows = Db::all(
            'SELECT id, display_name, avatar, xp, level, games_played, games_won, kaboot_count, max_streak'
            . ' FROM users WHERE is_guest = 0 ORDER BY xp DESC, games_won DESC LIMIT ?',
            [max(1, min(100, $limit))]
        );
        $out = [];
        $rank = 1;
        foreach ($rows as $r) {
            $played = max(1, (int) $r['games_played']);
            $out[] = [
                'rank' => $rank++,
                'id' => (int) $r['id'],
                'name' => (string) $r['display_name'],
                'avatar' => (string) $r['avatar'],
                'level' => (int) $r['level'],
                'xp' => (int) $r['xp'],
                'wins' => (int) $r['games_won'],
                'played' => (int) $r['games_played'],
                'winRate' => (int) round(((int) $r['games_won'] / $played) * 100),
                'kaboot' => (int) $r['kaboot_count'],
                'maxStreak' => (int) $r['max_streak'],
            ];
        }
        return $out;
    }

    public static function dailyBonus(array $user): array
    {
        $now = time();
        $last = (int) $user['last_daily'];
        if ($now - $last < 20 * 3600) {
            $remaining = 20 * 3600 - ($now - $last);
            return ['granted' => false, 'secondsLeft' => $remaining];
        }
        $amount = (int) Config::get('daily_bonus', 200);
        $coins = self::addCoins((int) $user['id'], $amount, 'daily_bonus');
        Db::update('users', ['last_daily' => $now], 'id = ?', [$user['id']]);
        return ['granted' => true, 'amount' => $amount, 'coins' => $coins];
    }

    /** عناصر المتجر */
    public static function shopItems(): array
    {
        return [
            ['id' => 'card_red', 'type' => 'cardBack', 'name' => 'ظهر أحمر كلاسيكي', 'price' => 0, 'value' => 'red', 'icon' => '🎴'],
            ['id' => 'card_blue', 'type' => 'cardBack', 'name' => 'ظهر أزرق ملكي', 'price' => 300, 'value' => 'blue', 'icon' => '🎴'],
            ['id' => 'card_gold', 'type' => 'cardBack', 'name' => 'ظهر ذهبي فاخر', 'price' => 900, 'value' => 'gold', 'icon' => '🃏'],
            ['id' => 'card_night', 'type' => 'cardBack', 'name' => 'ظهر ليلي', 'price' => 600, 'value' => 'night', 'icon' => '🌙'],
            ['id' => 'table_classic', 'type' => 'tableTheme', 'name' => 'طاولة كلاسيكية', 'price' => 0, 'value' => 'classic', 'icon' => '🟩'],
            ['id' => 'table_royal', 'type' => 'tableTheme', 'name' => 'طاولة ملكية', 'price' => 500, 'value' => 'royal', 'icon' => '🟪'],
            ['id' => 'table_night', 'type' => 'tableTheme', 'name' => 'طاولة ليلية', 'price' => 700, 'value' => 'night', 'icon' => '🌌'],
            ['id' => 'frame_gold', 'type' => 'frame', 'name' => 'إطار ذهبي', 'price' => 800, 'value' => 'gold', 'icon' => '🖼️'],
            ['id' => 'frame_fire', 'type' => 'frame', 'name' => 'إطار ناري', 'price' => 1000, 'value' => 'fire', 'icon' => '🔥'],
        ];
    }

    public static function buy(array $user, string $itemId): array
    {
        $item = null;
        foreach (self::shopItems() as $it) {
            if ($it['id'] === $itemId) {
                $item = $it;
            }
        }
        if ($item === null) {
            Http::fail('العنصر غير موجود', 404, 'item_not_found');
        }
        $inv = self::inventory($user);
        $owned = $inv['owned'] ?? [];
        if (in_array($itemId, $owned, true)) {
            Http::fail('تملك هذا العنصر مسبقاً', 409, 'already_owned');
        }
        if ((int) $user['coins'] < (int) $item['price']) {
            Http::fail('رصيدك من العملات غير كافٍ', 402, 'not_enough_coins');
        }
        if ((int) $item['price'] > 0) {
            self::addCoins((int) $user['id'], -(int) $item['price'], 'shop_buy', $itemId);
        }
        $owned[] = $itemId;
        $equipped = $inv['equipped'] ?? [];
        $equipped[$item['type']] = $item['value'];
        Db::update('users', [
            'inventory' => json_encode(['owned' => array_values(array_unique($owned)), 'equipped' => $equipped], JSON_UNESCAPED_UNICODE),
        ], 'id = ?', [$user['id']]);
        return self::find((int) $user['id']);
    }

    public static function equip(array $user, string $type, string $value): array
    {
        $allowed = ['cardBack', 'tableTheme', 'frame'];
        if (!in_array($type, $allowed, true)) {
            Http::fail('نوع غير معروف', 422, 'bad_type');
        }
        $inv = self::inventory($user);
        $equipped = $inv['equipped'] ?? [];
        $equipped[$type] = $value;
        $data = [
            'inventory' => json_encode(['owned' => $inv['owned'] ?? [], 'equipped' => $equipped], JSON_UNESCAPED_UNICODE),
        ];
        if ($type === 'cardBack') {
            $data['card_back'] = $value;
        }
        if ($type === 'tableTheme') {
            $data['table_theme'] = $value;
        }
        Db::update('users', $data, 'id = ?', [$user['id']]);
        return self::find((int) $user['id']);
    }

    public static function updateProfile(array $user, string $name, string $avatar): array
    {
        $data = [];
        if ($name !== '') {
            $data['display_name'] = mb_substr(trim($name), 0, 24);
        }
        if ($avatar !== '') {
            $data['avatar'] = mb_substr($avatar, 0, 8);
        }
        if ($data) {
            Db::update('users', $data, 'id = ?', [$user['id']]);
        }
        return self::find((int) $user['id']);
    }

    /** عدد المتصلين خلال آخر دقيقتين */
    public static function onlineCount(): int
    {
        return (int) Db::value('SELECT COUNT(*) FROM users WHERE last_seen > ?', [time() - 120]);
    }

    /** لوحة إحصائيات سريعة */
    public static function stats(array $user): array
    {
        $userId = (int) $user['id'];
        $recent = Db::all(
            'SELECT room_code, target, score_a, score_b, winner_team, rounds, names, player_ids, created_at'
            . ' FROM matches ORDER BY id DESC LIMIT 300'
        );
        $lastMatches = [];
        foreach ($recent as $m) {
            $ids = json_decode((string) $m['player_ids'], true) ?: [];
            if (in_array($userId, array_map('intval', $ids), true)) {
                $m['_ids'] = array_map('intval', $ids);
                $lastMatches[] = $m;
            }
            if (count($lastMatches) >= 10) {
                break;
            }
        }
        $history = [];
        foreach ($lastMatches as $m) {
            $ids = $m['_ids'];
            $names = json_decode((string) $m['names'], true) ?: [];
            $idx = array_search($userId, $ids, true);
            $team = $idx === false ? 0 : ((int) $idx) % 2;
            $history[] = [
                'roomCode' => (string) $m['room_code'],
                'won' => (int) $m['winner_team'] === $team,
                'score' => [(int) $m['score_a'], (int) $m['score_b']],
                'rounds' => (int) $m['rounds'],
                'at' => (int) $m['created_at'],
                'names' => $names,
            ];
        }
        return [
            'profile' => self::publicProfile($user),
            'history' => $history,
        ];
    }
}
