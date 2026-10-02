<?php
declare(strict_types=1);

namespace Trix\Api;

use Trix\Core\Auth;
use Trix\Core\Http;
use Trix\Core\Users;

/** مسارات الحسابات: تسجيل، دخول، زائر */
final class AuthApi
{
    public static function register(): void
    {
        if (Http::method() !== 'POST') {
            Http::fail('يجب استخدام POST', 405);
        }
        $result = Auth::register(
            Http::str('username'),
            Http::str('password'),
            Http::str('name'),
            Http::str('avatar', '😎')
        );
        Http::ok($result);
    }

    public static function login(): void
    {
        if (Http::method() !== 'POST') {
            Http::fail('يجب استخدام POST', 405);
        }
        $result = Auth::login(Http::str('username'), Http::str('password'), Http::str('device'));
        Http::ok($result);
    }

    public static function guest(): void
    {
        if (Http::method() !== 'POST') {
            Http::fail('يجب استخدام POST', 405);
        }
        $result = Auth::guest(Http::str('device'));
        Http::ok($result);
    }

    public static function logout(): void
    {
        Auth::logout();
        Http::ok(['message' => 'تم الخروج']);
    }

    public static function me(): void
    {
        $user = Auth::requireUser();
        Http::ok(['user' => Users::publicProfile($user)]);
    }
}
