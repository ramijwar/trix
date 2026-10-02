<?php
declare(strict_types=1);

namespace Trix\Api;

use Trix\Core\Auth;
use Trix\Core\Db;
use Trix\Core\Http;
use Trix\Core\Rooms;
use Trix\Core\Users;

/** مسارات الردهة والملف الشخصي والمتجر والمتصدرين */
final class LobbyApi
{
    /** قائمة الغرف + إحصاءات عامة */
    public static function lobby(): void
    {
        Auth::requireUser();
        $rooms = Rooms::roomList((int) (Http::input('limit', 30) ?? 30));
        $stats = [
            'online' => Users::onlineCount(),
            'rooms' => count($rooms),
            'playersInGame' => (int) Db::value("SELECT COUNT(*) FROM rooms WHERE status = 'playing'"),
            'matches' => (int) Db::value('SELECT COUNT(*) FROM matches'),
        ];
        Http::ok(['rooms' => $rooms, 'stats' => $stats]);
    }

    public static function leaderboard(): void
    {
        Auth::requireUser();
        Http::ok(['players' => Users::leaderboard((int) (Http::input('limit', 50) ?? 50))]);
    }

    public static function profile(): void
    {
        $user = Auth::requireUser();
        Http::ok(Users::stats($user) + ['shop' => Users::shopItems(), 'inventory' => Users::inventory($user)]);
    }

    public static function updateProfile(): void
    {
        $user = Auth::requireUser();
        $updated = Users::updateProfile($user, Http::str('name'), Http::str('avatar'));
        Http::ok(['user' => Users::publicProfile($updated)]);
    }

    public static function daily(): void
    {
        $user = Auth::requireUser();
        $result = Users::dailyBonus($user);
        $fresh = Users::find((int) $user['id']);
        Http::ok(['result' => $result, 'user' => Users::publicProfile($fresh ?? $user)]);
    }

    public static function shop(): void
    {
        $user = Auth::requireUser();
        Http::ok([
            'items' => Users::shopItems(),
            'inventory' => Users::inventory($user),
            'coins' => (int) $user['coins'],
        ]);
    }

    public static function buy(): void
    {
        $user = Auth::requireUser();
        $itemId = Http::str('item');
        $updated = Users::buy($user, $itemId);
        Http::ok(['user' => Users::publicProfile($updated ?? $user)]);
    }

    public static function equip(): void
    {
        $user = Auth::requireUser();
        $updated = Users::equip($user, Http::str('type'), Http::str('value'));
        Http::ok(['user' => Users::publicProfile($updated ?? $user)]);
    }
}
