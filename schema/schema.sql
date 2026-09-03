-- ============================================================
-- D1 数据库表结构（第一阶段：账号系统 + 学习进度）
-- 部署方式：
--   npx wrangler d1 create tcm-db          # 首次创建数据库，记下返回的 database_id
--   npx wrangler d1 execute tcm-db --file=./schema/schema.sql --remote
-- 并在 wrangler.toml 里加上：
--   [[d1_databases]]
--   binding = "DB"
--   database_name = "tcm-db"
--   database_id = "上一步返回的id"
-- ============================================================

-- 用户表
-- 用户名唯一且不可修改：靠 UNIQUE 约束在插入时最终裁决，代码里不做"先查后插"。
CREATE TABLE IF NOT EXISTS users (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    username              TEXT NOT NULL UNIQUE,
    password_hash         TEXT NOT NULL,   -- PBKDF2 派生结果（base64）
    password_salt         TEXT NOT NULL,   -- 本次密码使用的随机盐（base64）
    recovery_code_hash    TEXT NOT NULL,   -- 一次性恢复码的哈希（从不存明文）
    recovery_code_salt    TEXT NOT NULL,
    created_at            INTEGER NOT NULL -- unix 秒
);

-- 学习进度表：一个 (用户, 病例) 组合只有一行，靠 PRIMARY KEY 天然支持 upsert。
-- is_completed：是否点击过"显示答案"（对应旧版 tcm_completed_cases）
-- is_wrong    ：当前是否处于错题状态，订正为正确后会被置回 0（对应旧版 tcm_wrong_cases）
CREATE TABLE IF NOT EXISTS user_progress (
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    case_id             TEXT NOT NULL,
    is_completed        INTEGER NOT NULL DEFAULT 0,
    is_wrong            INTEGER NOT NULL DEFAULT 0,
    submitted_syndrome  TEXT,
    submitted_disease   TEXT,
    submitted_basis     TEXT,
    updated_at          INTEGER NOT NULL,
    PRIMARY KEY (user_id, case_id)
);

CREATE INDEX IF NOT EXISTS idx_progress_user ON user_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_progress_wrong ON user_progress(user_id, is_wrong);
