<?php
declare(strict_types=1);

namespace Trix\Api;

use Trix\Core\Auth;
use Trix\Core\Config;
use Trix\Core\Db;
use Trix\Core\Http;
use Trix\Core\HttpExit;
use Trix\Core\Rooms;

/** موجه الطلبات الرئيسي */
final class Router
{
    public static function handle(): void
    {
        Http::cors();
        if (Http::method() === 'OPTIONS') {
            http_response_code(204);
            exit;
        }

        $route = strtolower(Http::route());
        $route = (string) preg_replace('#^api/#', '', $route);
        $route = trim($route, '/');

        try {
            Db::migrate();
            self::maybeMaintenanceCleanup();
            switch ($route) {
                // ============ صحة الخادم ============
                case '':
                case 'health':
                    Http::ok([
                        'app' => (string) Config::get('app_name', 'طرنيب أونلاين'),
                        'version' => '1.0.0',
                        'php' => PHP_VERSION,
                        'sqlite' => extension_loaded('pdo_sqlite') ? 'yes' : 'no',
                        'time' => time(),
                        'serverTime' => time(),
                        'guestEnabled' => (bool) Config::get('guest_enabled', true),
                        'maintenance' => (bool) Config::get('maintenance', false),
                        'online' => \Trix\Core\Users::onlineCount(),
                    ]);
                    return;

                // ============ الحسابات ============
                case 'auth/register': AuthApi::register(); return;
                case 'auth/login': AuthApi::login(); return;
                case 'auth/guest': AuthApi::guest(); return;
                case 'auth/logout': AuthApi::logout(); return;
                case 'me': AuthApi::me(); return;

                // ============ الردهة والملف الشخصي ============
                case 'lobby': LobbyApi::lobby(); return;
                case 'lobby/leaderboard':
                case 'leaderboard': LobbyApi::leaderboard(); return;
                case 'profile': LobbyApi::profile(); return;
                case 'profile/update': LobbyApi::updateProfile(); return;
                case 'profile/daily': LobbyApi::daily(); return;
                case 'shop': LobbyApi::shop(); return;
                case 'shop/buy': LobbyApi::buy(); return;
                case 'shop/equip': LobbyApi::equip(); return;

                // ============ الغرف ============
                case 'room/create': RoomApi::create(); return;
                case 'room/join': RoomApi::join(); return;
                case 'room/quick': RoomApi::quick(); return;
                case 'room/leave': RoomApi::leave(); return;
                case 'room/state': RoomApi::state(); return;
                case 'room/poll': RoomApi::poll(); return;
                case 'room/seat': RoomApi::seat(); return;
                case 'room/swap': RoomApi::swap(); return;
                case 'room/swap/respond': RoomApi::swapRespond(); return;
                case 'room/arrange': RoomApi::arrange(); return;
                case 'room/bot/add': RoomApi::botAdd(); return;
                case 'room/bot/remove': RoomApi::botRemove(); return;
                case 'room/ready': RoomApi::ready(); return;
                case 'room/start': RoomApi::start(); return;
                case 'room/settings': RoomApi::settings(); return;
                case 'room/rename': RoomApi::rename(); return;
                case 'room/kick': RoomApi::kick(); return;
                case 'room/chat': RoomApi::chat(); return;
                case 'room/voice': RoomApi::voiceUpload(); return;
                case 'voice/get': RoomApi::voiceFile(); return;
                case 'room/continue': RoomApi::continueRound(); return;

                // ============ اللعب ============
                case 'game/bid': RoomApi::bid(); return;
                case 'game/trump': RoomApi::trump(); return;
                case 'game/play': RoomApi::play(); return;
                case 'game/contract': RoomApi::contract(); return;
                case 'game/reveal': RoomApi::reveal(); return;

                // ============ لوحة المدير ============
                case 'admin/stats': AdminApi::stats(); return;
                case 'admin/today': AdminApi::today(); return;
                case 'admin/users': AdminApi::users(); return;
                case 'admin/user/action': AdminApi::userAction(); return;
                case 'admin/tournaments': AdminApi::tournaments(); return;
                case 'admin/tournament/create': AdminApi::createTournament(); return;
                case 'admin/tournament/update': AdminApi::updateTournament(); return;
                case 'admin/tournament/status': AdminApi::tournamentStatus(); return;
                case 'admin/tournament/start': AdminApi::tournamentStart(); return;
                case 'admin/tournament/advance': AdminApi::tournamentAdvance(); return;

                // ============ البطولات (لللاعبين) ============
                case 'tournaments': AdminApi::myTournaments(); return;
                case 'tournament/join': AdminApi::tournamentJoin(); return;
                case 'tournament/leave': AdminApi::tournamentLeave(); return;

                default:
                    Http::fail('مسار غير معروف: ' . $route, 404, 'not_found');
            }
        } catch (HttpExit $e) {
            // تُرمى فقط في جسر التطوير المحلي (PHP-WASM) لتسليم الاستجابة
            throw $e;
        } catch (\Throwable $e) {
            self::handleError($e);
        }
    }

    private static function handleError(\Throwable $e): void
    {
        if (Config::get('debug')) {
            Http::json([
                'ok' => false,
                'error' => $e->getMessage(),
                'code' => 'exception',
                'file' => $e->getFile(),
                'line' => $e->getLine(),
                'trace' => explode("\n", $e->getTraceAsString()),
            ], 500);
        }
        // تسجيل الخطأ للمشرف بدون كشف التفاصيل
        $dir = (string) Config::get('data_dir');
        if (is_dir($dir) && is_writable($dir)) {
            @file_put_contents(
                $dir . '/errors.log',
                '[' . date('Y-m-d H:i:s') . '] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine() . PHP_EOL,
                FILE_APPEND
            );
        }
        Http::fail('حدث خطأ في الخادم، حاول مرة أخرى', 500, 'server_error');
    }

    /** تنظيف دوري خفيف (يعمل مع 5% من الطلبات فقط) */
    private static function maybeMaintenanceCleanup(): void
    {
        try {
            if (random_int(1, 20) === 1) {
                Auth::prune();
                Rooms::cleanup();
                \Trix\Core\Voice::prune(86400);
            }
        } catch (\Throwable) {
            // نتجاهل أخطاء التنظيف
        }
    }
}
