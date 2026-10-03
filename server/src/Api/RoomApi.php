<?php
declare(strict_types=1);

namespace Trix\Api;

use Trix\Core\Auth;
use Trix\Core\Http;
use Trix\Core\Rooms;
use Trix\Core\Voice;
use Trix\Game\Engine;
use Trix\Game\Trix;

/** مسارات الغرف واللعب */
final class RoomApi
{
    /** إضافة رسالة دردشة إلى محرّك اللعبة المناسب للغرفة */
    private static function addChat(array &$state, ?int $seat, string $text, ?string $emoji = null, ?array $voice = null): void
    {
        if (((string) ($state['settings']['game'] ?? 'tarnib')) === 'trix') {
            Trix::chat($state, $seat, $text, $emoji, $voice);
            return;
        }
        Engine::chat($state, $seat, $text, $emoji, $voice);
    }

    /** إرجاع حالة الغرفة كما يراها المستخدم الحالي */
    private static function viewOf(array $room, int $userId): array
    {
        $state = Rooms::decode($room);
        return Rooms::view($room, $state, $userId);
    }

    public static function create(): void
    {
        $user = Auth::requireUser();
        $room = Rooms::create($user, [
            'name' => Http::str('name'),
            'settings' => (array) (Http::input('settings', []) ?? []),
            'isPrivate' => Http::bool('private'),
            'password' => Http::str('password'),
            'code' => Http::str('code'),
        ]);
        Http::ok(['room' => self::viewOf($room, (int) $user['id'])]);
    }

    public static function join(): void
    {
        $user = Auth::requireUser();
        $code = Http::str('room');
        if ($code === '') {
            $code = Http::str('code');
        }
        $room = Rooms::join($user, $code, Http::str('password'));
        Http::ok(['room' => self::viewOf($room, (int) $user['id'])]);
    }

    public static function quick(): void
    {
        $user = Auth::requireUser();
        $room = Rooms::quickPlay($user, (array) (Http::input('settings', []) ?? []));
        Http::ok(['room' => self::viewOf($room, (int) $user['id'])]);
    }

    public static function leave(): void
    {
        $user = Auth::requireUser();
        Rooms::leave($user, Http::str('room'));
        Http::ok(['message' => 'تم الخروج من الطاولة']);
    }

    public static function state(): void
    {
        $user = Auth::requireUser();
        $userId = (int) $user['id'];
        // نمرّ على الدوران أيضاً حتى تتقدّم البوتات والمؤقتات مع أي قراءة للحالة
        $result = Rooms::act(
            Http::str('room'),
            static function (array &$r, array &$state) use ($userId): array {
                Rooms::heartbeat($state, $userId);
                return [];
            }
        );
        Http::ok(['room' => Rooms::view($result['_room'], $result['_state'], $userId)]);
    }

    /** الاستعلام الطويل: ينتظر حتى يتغير شيء أو تنتهي المدة */
    public static function poll(): void
    {
        $user = Auth::requireUser();
        $view = Rooms::poll(
            Http::str('room'),
            $user,
            Http::int('since', 0),
            Http::int('wait', 20)
        );
        Http::ok(['room' => $view]);
    }

    public static function seat(): void
    {
        $user = Auth::requireUser();
        $room = Rooms::moveSeat($user, Http::str('room'), Http::int('seat', -1));
        Http::ok(['room' => self::viewOf($room, (int) $user['id']), 'message' => 'تم تغيير المقعد']);
    }

    public static function swap(): void
    {
        $user = Auth::requireUser();
        $room = Rooms::requestSwap($user, Http::str('room'), Http::int('seat', -1));
        Http::ok(['room' => self::viewOf($room, (int) $user['id']), 'message' => 'تم إرسال طلب التبديل']);
    }

    public static function swapRespond(): void
    {
        $user = Auth::requireUser();
        $room = Rooms::respondSwap($user, Http::str('room'), Http::bool('accept', true));
        Http::ok(['room' => self::viewOf($room, (int) $user['id'])]);
    }

    public static function arrange(): void
    {
        $user = Auth::requireUser();
        $order = (array) (Http::input('order', []) ?? []);
        $room = Rooms::arrange($user, Http::str('room'), $order);
        Http::ok(['room' => self::viewOf($room, (int) $user['id']), 'message' => 'تم ترتيب المقاعد']);
    }

    public static function botAdd(): void
    {
        $user = Auth::requireUser();
        $seat = Http::input('seat', null);
        $room = Rooms::addBot($user, Http::str('room'), $seat === null ? null : (int) $seat);
        Http::ok(['room' => self::viewOf($room, (int) $user['id'])]);
    }

    public static function botRemove(): void
    {
        $user = Auth::requireUser();
        $room = Rooms::removeBot($user, Http::str('room'), Http::int('seat', -1));
        Http::ok(['room' => self::viewOf($room, (int) $user['id'])]);
    }

    public static function ready(): void
    {
        $user = Auth::requireUser();
        $room = Rooms::setReady($user, Http::str('room'), Http::bool('ready', true));
        Http::ok(['room' => self::viewOf($room, (int) $user['id'])]);
    }

    public static function start(): void
    {
        $user = Auth::requireUser();
        $room = Rooms::start($user, Http::str('room'));
        Http::ok(['room' => self::viewOf($room, (int) $user['id']), 'message' => 'بدأت المباراة']);
    }

    public static function settings(): void
    {
        $user = Auth::requireUser();
        $room = Rooms::updateSettings($user, Http::str('room'), (array) (Http::input('settings', []) ?? []));
        Http::ok(['room' => self::viewOf($room, (int) $user['id']), 'message' => 'تم حفظ الإعدادات']);
    }

    public static function rename(): void
    {
        $user = Auth::requireUser();
        $room = Rooms::rename($user, Http::str('room'), Http::str('name'), Http::bool('private'));
        Http::ok(['room' => self::viewOf($room, (int) $user['id'])]);
    }

    public static function kick(): void
    {
        $user = Auth::requireUser();
        $room = Rooms::kick($user, Http::str('room'), Http::int('seat', -1));
        Http::ok(['room' => self::viewOf($room, (int) $user['id'])]);
    }

    /** رسائل الشات السريع والحر */
    public static function chat(): void
    {
        $user = Auth::requireUser();
        $roomId = Http::str('room');
        $text = Http::str('text');
        $emoji = Http::str('emoji');
        if ($emoji !== '') {
            $text = $text === '' ? $emoji : $text;
        }
        if (mb_strlen($text) > 160) {
            $text = mb_substr($text, 0, 160);
        }
        if ($text === '') {
            Http::fail('الرسالة فارغة', 422);
        }
        $userId = (int) $user['id'];
        $result = Rooms::act($roomId, function (array &$r, array &$state) use ($userId, $text, $emoji) {
            $seat = Rooms::seatOf($state, $userId);
            if ($seat === null) {
                Http::fail('أنت لست في هذه الطاولة', 403);
            }
            self::addChat($state, $seat, $text, $emoji !== '' ? $emoji : null);
            return [];
        });
        Http::ok(['room' => Rooms::view($result['_room'], $result['_state'], $userId)]);
    }

    /** إرسال رسالة صوتية قصيرة (تُحفظ كملف ويُرسل معرّفها في الدردشة) */
    public static function voiceUpload(): void
    {
        $user = Auth::requireUser();
        $roomId = Http::str('room');
        $audio = Http::str('audio');
        if ($audio === '') {
            Http::fail('لم يصل أي مقطع صوتي', 422, 'no_audio');
        }
        $duration = Http::int('dur', 0);
        if ($duration <= 0 || $duration > Voice::MAX_SECONDS) {
            Http::fail('مدة المقطع غير مسموحة (الحد ' . Voice::MAX_SECONDS . ' ثانية)', 422, 'bad_duration');
        }
        $saved = Voice::save($audio, Http::str('mime', 'audio/webm'), $duration);
        $userId = (int) $user['id'];
        $result = Rooms::act($roomId, function (array &$r, array &$state) use ($userId, $saved) {
            $seat = Rooms::seatOf($state, $userId);
            if ($seat === null) {
                Http::fail('أنت لست في هذه الطاولة', 403);
            }
            self::addChat($state, $seat, '', null, $saved);
            return [];
        });
        Http::ok([
            'room' => Rooms::view($result['_room'], $result['_state'], $userId),
            'voice' => ['id' => $saved['id'], 'dur' => $saved['dur'], 'mime' => $saved['mime']],
        ]);
    }

    /** تنزيل مقطع صوتي (base64) — للمنضمّين للطاولة فقط */
    public static function voiceFile(): void
    {
        $user = Auth::requireUser();
        $id = strtolower(Http::str('id'));
        $file = Voice::path($id);
        if ($file === null) {
            Http::fail('المقطع الصوتي غير موجود', 404, 'voice_not_found');
        }
        $roomId = Http::str('room');
        if ($roomId !== '') {
            $room = Rooms::requireRoom($roomId);
            $state = Rooms::decode($room);
            if (Rooms::seatOf($state, (int) $user['id']) === null) {
                Http::fail('أنت لست في هذه الطاولة', 403);
            }
        }
        Http::ok(Voice::read($id));
    }

    /** الموافقة على بدء الجولة التالية فوراً */
    public static function continueRound(): void
    {
        $user = Auth::requireUser();
        $room = Rooms::continueRound($user, Http::str('room'));
        Http::ok(['room' => self::viewOf($room, (int) $user['id'])]);
    }

    /* ============================ اللعب ============================ */

    public static function bid(): void
    {
        $user = Auth::requireUser();
        $roomId = Http::str('room');
        $action = Http::str('action', 'bid');
        $value = Http::input('value', null);
        $userId = (int) $user['id'];
        $result = Rooms::act($roomId, function (array &$r, array &$state) use ($userId, $action, $value) {
            $seat = Rooms::seatOf($state, $userId);
            if ($seat === null) {
                Http::fail('أنت لست في هذه الطاولة', 403);
            }
            Engine::applyBid($state, $seat, $action, $value === null ? null : (int) $value);
            return [];
        });
        Http::ok(['room' => Rooms::view($result['_room'], $result['_state'], $userId)]);
    }

    public static function trump(): void
    {
        $user = Auth::requireUser();
        $roomId = Http::str('room');
        $suit = Http::str('suit');
        $userId = (int) $user['id'];
        $result = Rooms::act($roomId, function (array &$r, array &$state) use ($userId, $suit) {
            $seat = Rooms::seatOf($state, $userId);
            if ($seat === null) {
                Http::fail('أنت لست في هذه الطاولة', 403);
            }
            Engine::applyTrump($state, $seat, $suit);
            return [];
        });
        Http::ok(['room' => Rooms::view($result['_room'], $result['_state'], $userId)]);
    }

/** اختيار تسمية في لعبة التركس (صاحب المملكة فقط) */
    public static function contract(): void
    {
        $user = Auth::requireUser();
        $roomId = Http::str('room');
        $contract = Http::str('contract');
        $userId = (int) $user['id'];
        $result = Rooms::act($roomId, function (array &$r, array &$state) use ($userId, $contract) {
            $seat = Rooms::seatOf($state, $userId);
            if ($seat === null) {
                Http::fail('أنت لست في هذه الطاولة', 403);
            }
            Trix::chooseContract($state, $seat, $contract);
            return [];
        });
        Http::ok(['room' => Rooms::view($result['_room'], $result['_state'], $userId)]);
    }

    /** تدبيل ورقة معاقِبة قبل بدء اللعب، أو تأكيد الجاهزية */
    public static function reveal(): void
    {
        $user = Auth::requireUser();
        $roomId = Http::str('room');
        $card = Http::str('card');
        $done = Http::bool('done');
        $userId = (int) $user['id'];
        $result = Rooms::act($roomId, function (array &$r, array &$state) use ($userId, $card, $done) {
            $seat = Rooms::seatOf($state, $userId);
            if ($seat === null) {
                Http::fail('أنت لست في هذه الطاولة', 403);
            }
            if ($card !== '') {
                Trix::reveal($state, $seat, $card);
            }
            if ($done || $card === '') {
                Trix::revealDone($state, $seat);
            }
            return [];
        });
        Http::ok(['room' => Rooms::view($result['_room'], $result['_state'], $userId)]);
    }

    public static function play(): void
    {
        $user = Auth::requireUser();
        $roomId = Http::str('room');
        $card = Http::str('card');
        $userId = (int) $user['id'];
        $result = Rooms::act($roomId, function (array &$r, array &$state) use ($userId, $card) {
            $seat = Rooms::seatOf($state, $userId);
            if ($seat === null) {
                Http::fail('أنت لست في هذه الطاولة', 403);
            }
            if (((($state['settings']['game'] ?? 'tarnib')) === 'trix')) {
                Trix::applyPlay($state, $seat, $card);
            } else {
                Engine::applyPlay($state, $seat, $card);
            }
            return [];
        });
        Http::ok(['room' => Rooms::view($result['_room'], $result['_state'], $userId)]);
    }
}
