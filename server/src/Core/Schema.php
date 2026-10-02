<?php
declare(strict_types=1);

namespace Trix\Core;

/**
 * مخطط قاعدة البيانات (SQLite) — كل الجمل قابلة للتنفيذ أكثر من مرة
 */
final class Schema
{
    public const VERSION = 1;

    public static function statements(): array
    {
        return [
            // المستخدمون
            "CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                pass_hash TEXT NOT NULL DEFAULT '',
                avatar TEXT NOT NULL DEFAULT '😎',
                table_theme TEXT NOT NULL DEFAULT 'classic',
                card_back TEXT NOT NULL DEFAULT 'red',
                coins INTEGER NOT NULL DEFAULT 500,
                xp INTEGER NOT NULL DEFAULT 0,
                level INTEGER NOT NULL DEFAULT 1,
                games_played INTEGER NOT NULL DEFAULT 0,
                games_won INTEGER NOT NULL DEFAULT 0,
                rounds_played INTEGER NOT NULL DEFAULT 0,
                kaboot_count INTEGER NOT NULL DEFAULT 0,
                is_guest INTEGER NOT NULL DEFAULT 0,
                is_admin INTEGER NOT NULL DEFAULT 0,
                max_streak INTEGER NOT NULL DEFAULT 0,
                streak INTEGER NOT NULL DEFAULT 0,
                last_daily INTEGER NOT NULL DEFAULT 0,
                inventory TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL,
                last_seen INTEGER NOT NULL
            )",
            "CREATE INDEX IF NOT EXISTS idx_users_xp ON users(xp DESC)",
            "CREATE INDEX IF NOT EXISTS idx_users_wins ON users(games_won DESC)",

            // جلسات الدخول
            "CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                device TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )",
            "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)",

            // الغرف
            "CREATE TABLE IF NOT EXISTS rooms (
                id TEXT PRIMARY KEY,
                code TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                host_id INTEGER NOT NULL,
                is_private INTEGER NOT NULL DEFAULT 0,
                password TEXT NOT NULL DEFAULT '',
                settings TEXT NOT NULL DEFAULT '{}',
                state TEXT NOT NULL DEFAULT '{}',
                version INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'waiting',
                seat0 INTEGER NOT NULL DEFAULT 0,
                seat1 INTEGER NOT NULL DEFAULT 0,
                seat2 INTEGER NOT NULL DEFAULT 0,
                seat3 INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                last_activity INTEGER NOT NULL
            )",
            "CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status, last_activity DESC)",

            // المباريات المنتهية
            "CREATE TABLE IF NOT EXISTS matches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_code TEXT NOT NULL,
                target INTEGER NOT NULL DEFAULT 31,
                score_a INTEGER NOT NULL DEFAULT 0,
                score_b INTEGER NOT NULL DEFAULT 0,
                winner_team INTEGER NOT NULL DEFAULT 0,
                rounds INTEGER NOT NULL DEFAULT 0,
                player_ids TEXT NOT NULL DEFAULT '[]',
                names TEXT NOT NULL DEFAULT '[]',
                duration INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            )",
            "CREATE INDEX IF NOT EXISTS idx_matches_created ON matches(created_at DESC)",

            // سجل العملات
            "CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                amount INTEGER NOT NULL,
                kind TEXT NOT NULL,
                ref TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL
            )",
            "CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at DESC)",

            // أسئلة الشات السريع (يمكن تعديلها من لوحة التحكم)
            "CREATE TABLE IF NOT EXISTS meta (
                k TEXT PRIMARY KEY,
                v TEXT NOT NULL
            )",
        ];
    }
}
