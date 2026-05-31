-- TimePulse PostgreSQL schema
-- Uitvoeren in de Supabase SQL editor (één keer bij setup)

CREATE TABLE IF NOT EXISTS heartbeats (
    id            BIGSERIAL PRIMARY KEY,
    user_id       UUID      NOT NULL,
    timestamp     BIGINT    NOT NULL,
    url           TEXT      NOT NULL,
    domain        TEXT      NOT NULL,
    title         TEXT      DEFAULT '',
    favicon       TEXT,
    activity_type TEXT      DEFAULT 'website',
    doc_name      TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hb_user_ts
    ON heartbeats(user_id, timestamp DESC);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS idle_events (
    id         BIGSERIAL PRIMARY KEY,
    user_id    UUID   NOT NULL,
    state      TEXT   NOT NULL,
    timestamp  BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS harvest_connections (
    user_id       UUID PRIMARY KEY,
    access_token  TEXT NOT NULL,
    refresh_token TEXT,
    account_id    TEXT NOT NULL,
    account_name  TEXT,
    expires_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS custom_platforms (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL,
    slug       TEXT NOT NULL,
    name       TEXT NOT NULL,
    urls       JSONB NOT NULL DEFAULT '[]',
    color      TEXT DEFAULT '#6B7280',
    categories JSONB NOT NULL DEFAULT '["custom"]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, slug)
);

-- Row Level Security (optioneel maar aanbevolen in Supabase)
ALTER TABLE heartbeats        ENABLE ROW LEVEL SECURITY;
ALTER TABLE idle_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE harvest_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_platforms  ENABLE ROW LEVEL SECURITY;

-- Server-side toegang via service role key omzeilt RLS automatisch
