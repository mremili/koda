-- ============================================================
-- KODA — SETUP COMPLET (à exécuter dans Supabase SQL Editor)
-- Copier-coller TOUT ce bloc d'un coup
-- ============================================================

-- 0. Ajouter la colonne telephone dans jeunes si elle n'existe pas
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'jeunes' AND column_name = 'telephone'
  ) THEN
    ALTER TABLE jeunes ADD COLUMN telephone TEXT;
  END IF;
END $$;

-- 1. Tables agent core (si pas déjà créées)
CREATE TABLE IF NOT EXISTS koda_memory_stream (
  id              BIGSERIAL PRIMARY KEY,
  jeune_id        TEXT NOT NULL REFERENCES jeunes(airtable_id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  source          TEXT,
  content         TEXT,
  metadata        JSONB,
  importance      INT DEFAULT 5,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_memory_stream_jeune_id ON koda_memory_stream(jeune_id);
CREATE INDEX IF NOT EXISTS idx_memory_stream_event_type ON koda_memory_stream(event_type);
CREATE INDEX IF NOT EXISTS idx_memory_stream_created_at ON koda_memory_stream(created_at DESC);

CREATE TABLE IF NOT EXISTS koda_agent_state (
  jeune_id            TEXT PRIMARY KEY REFERENCES jeunes(airtable_id) ON DELETE CASCADE,
  current_stage       TEXT NOT NULL DEFAULT 'idle',
  last_match_run      TIMESTAMPTZ,
  last_message_at     TIMESTAMPTZ,
  last_reply_at       TIMESTAMPTZ,
  pending_matches     JSONB,
  wa_phone            TEXT,
  mentor_notified_at  TIMESTAMPTZ,
  nb_matches_sent     INT DEFAULT 0,
  nb_candidatures     INT DEFAULT 0,
  nb_entretiens       INT DEFAULT 0,
  notes               TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS koda_conversations (
  id              BIGSERIAL PRIMARY KEY,
  jeune_id        TEXT NOT NULL REFERENCES jeunes(airtable_id) ON DELETE CASCADE,
  direction       TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  sender          TEXT NOT NULL,
  message_text    TEXT,
  message_type    TEXT DEFAULT 'text',
  wa_message_id   TEXT,
  metadata        JSONB,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_conversations_jeune_id ON koda_conversations(jeune_id);
CREATE INDEX IF NOT EXISTS idx_conversations_sent_at ON koda_conversations(sent_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_wa_id ON koda_conversations(wa_message_id)
  WHERE wa_message_id IS NOT NULL;

-- 2. Tables employeur + candidatures
CREATE TABLE IF NOT EXISTS koda_employers (
  id              BIGSERIAL PRIMARY KEY,
  siret           TEXT,
  company_name    TEXT NOT NULL,
  sector          TEXT,
  rome_codes      TEXT[],
  city            TEXT,
  department      TEXT,
  contact_email   TEXT,
  contact_name    TEXT,
  contact_phone   TEXT,
  source          TEXT,
  size_category   TEXT,
  opco            TEXT,
  is_alternance   BOOLEAN DEFAULT false,
  receptivity     INT DEFAULT 5,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employers_department ON koda_employers(department);
CREATE INDEX IF NOT EXISTS idx_employers_siret ON koda_employers(siret) WHERE siret IS NOT NULL;

CREATE TABLE IF NOT EXISTS koda_candidatures (
  id              BIGSERIAL PRIMARY KEY,
  jeune_id        TEXT NOT NULL REFERENCES jeunes(airtable_id) ON DELETE CASCADE,
  employer_id     BIGINT REFERENCES koda_employers(id),
  offre_id        TEXT,
  offre_titre     TEXT,
  offre_entreprise TEXT,
  offre_url       TEXT,
  status          TEXT NOT NULL DEFAULT 'proposed',
  sent_at         TIMESTAMPTZ,
  accepted_at     TIMESTAMPTZ,
  applied_at      TIMESTAMPTZ,
  interview_at    TIMESTAMPTZ,
  outcome_at      TIMESTAMPTZ,
  outcome         TEXT,
  cv_generated    BOOLEAN DEFAULT false,
  cover_letter    BOOLEAN DEFAULT false,
  match_score     INT,
  notes           TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_candidatures_jeune ON koda_candidatures(jeune_id);
CREATE INDEX IF NOT EXISTS idx_candidatures_status ON koda_candidatures(status);

CREATE TABLE IF NOT EXISTS koda_employer_outreach (
  id              BIGSERIAL PRIMARY KEY,
  employer_id     BIGINT NOT NULL REFERENCES koda_employers(id) ON DELETE CASCADE,
  jeune_ids       TEXT[],
  email_subject   TEXT,
  email_body      TEXT,
  email_sent_at   TIMESTAMPTZ,
  email_opened_at TIMESTAMPTZ,
  email_clicked_at TIMESTAMPTZ,
  reply_received  BOOLEAN DEFAULT false,
  reply_text      TEXT,
  reply_sentiment TEXT,
  followup_sent   BOOLEAN DEFAULT false,
  followup_at     TIMESTAMPTZ,
  status          TEXT DEFAULT 'draft',
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outreach_employer ON koda_employer_outreach(employer_id);

-- 3. Onboarding + réflexions
CREATE TABLE IF NOT EXISTS koda_onboarding_state (
  jeune_id        TEXT PRIMARY KEY REFERENCES jeunes(airtable_id) ON DELETE CASCADE,
  step            TEXT NOT NULL DEFAULT 'not_started',
  data_collected  JSONB DEFAULT '{}',
  attempts        INT DEFAULT 0,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS koda_reflections (
  id              BIGSERIAL PRIMARY KEY,
  jeune_id        TEXT REFERENCES jeunes(airtable_id) ON DELETE CASCADE,
  scope           TEXT NOT NULL DEFAULT 'individual',
  reflection_text TEXT NOT NULL,
  insights        JSONB,
  actions         JSONB,
  applied         BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reflections_jeune ON koda_reflections(jeune_id);

-- 4. Trigger auto-update
CREATE OR REPLACE FUNCTION update_agent_state_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_state_updated ON koda_agent_state;
CREATE TRIGGER trg_agent_state_updated
  BEFORE UPDATE ON koda_agent_state
  FOR EACH ROW EXECUTE FUNCTION update_agent_state_timestamp();

-- 5. Initialiser les jeunes éligibles
INSERT INTO koda_agent_state (jeune_id, current_stage)
SELECT airtable_id, 'idle'
FROM jeunes
WHERE enrichi_par_ia = true
  AND pret_a_postuler = true
ON CONFLICT (jeune_id) DO NOTHING;

INSERT INTO koda_onboarding_state (jeune_id, step)
SELECT airtable_id, 'not_started'
FROM jeunes
WHERE enrichi_par_ia = true
  AND pret_a_postuler = true
ON CONFLICT (jeune_id) DO NOTHING;

-- 6. Vérification
SELECT 'koda_memory_stream' AS table_name, COUNT(*) AS rows FROM koda_memory_stream
UNION ALL SELECT 'koda_agent_state', COUNT(*) FROM koda_agent_state
UNION ALL SELECT 'koda_conversations', COUNT(*) FROM koda_conversations
UNION ALL SELECT 'koda_employers', COUNT(*) FROM koda_employers
UNION ALL SELECT 'koda_candidatures', COUNT(*) FROM koda_candidatures
UNION ALL SELECT 'koda_employer_outreach', COUNT(*) FROM koda_employer_outreach
UNION ALL SELECT 'koda_onboarding_state', COUNT(*) FROM koda_onboarding_state
UNION ALL SELECT 'koda_reflections', COUNT(*) FROM koda_reflections;
