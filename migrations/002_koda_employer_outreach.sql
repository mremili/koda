-- ============================================================
-- KODA AGENT — Phase 1b : Face employeur + Onboarding + Candidatures
-- À exécuter sur Supabase SQL Editor
-- ============================================================

-- 1. Entreprises prospectées par Koda
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
  source          TEXT,           -- 'lba', 'bmo', 'manual', 'web'
  size_category   TEXT,           -- 'tpe', 'pme', 'eti', 'ge'
  opco            TEXT,
  is_alternance   BOOLEAN DEFAULT false,
  receptivity     INT DEFAULT 5,  -- 1-10, apprise par Koda au fil du temps
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employers_department ON koda_employers(department);
CREATE INDEX IF NOT EXISTS idx_employers_rome ON koda_employers USING GIN(rome_codes);
CREATE INDEX IF NOT EXISTS idx_employers_siret ON koda_employers(siret) WHERE siret IS NOT NULL;

-- 2. Candidatures (lien jeune × offre/employeur)
CREATE TABLE IF NOT EXISTS koda_candidatures (
  id              BIGSERIAL PRIMARY KEY,
  jeune_id        TEXT NOT NULL REFERENCES jeunes(airtable_id) ON DELETE CASCADE,
  employer_id     BIGINT REFERENCES koda_employers(id),
  offre_id        TEXT,
  offre_titre     TEXT,
  offre_entreprise TEXT,
  offre_url       TEXT,
  status          TEXT NOT NULL DEFAULT 'proposed',
  -- Status: proposed → accepted → applied → interview → hired / rejected / ghosted
  sent_at         TIMESTAMPTZ,
  accepted_at     TIMESTAMPTZ,
  applied_at      TIMESTAMPTZ,
  interview_at    TIMESTAMPTZ,
  outcome_at      TIMESTAMPTZ,
  outcome         TEXT,           -- 'hired', 'rejected', 'ghosted', 'withdrew'
  cv_generated    BOOLEAN DEFAULT false,
  cover_letter    BOOLEAN DEFAULT false,
  match_score     INT,
  notes           TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidatures_jeune ON koda_candidatures(jeune_id);
CREATE INDEX IF NOT EXISTS idx_candidatures_status ON koda_candidatures(status);
CREATE INDEX IF NOT EXISTS idx_candidatures_employer ON koda_candidatures(employer_id);

-- 3. Outreach emails vers employeurs
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
  reply_sentiment TEXT,            -- 'positive', 'neutral', 'negative'
  followup_sent   BOOLEAN DEFAULT false,
  followup_at     TIMESTAMPTZ,
  status          TEXT DEFAULT 'draft',
  -- Status: draft → sent → opened → replied → converted / dead
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outreach_employer ON koda_employer_outreach(employer_id);
CREATE INDEX IF NOT EXISTS idx_outreach_status ON koda_employer_outreach(status);

-- 4. Onboarding state par jeune
CREATE TABLE IF NOT EXISTS koda_onboarding_state (
  jeune_id        TEXT PRIMARY KEY REFERENCES jeunes(airtable_id) ON DELETE CASCADE,
  step            TEXT NOT NULL DEFAULT 'not_started',
  -- Steps: not_started → welcome → job_type → location → cv_check → ready
  data_collected  JSONB DEFAULT '{}',
  attempts        INT DEFAULT 0,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Réflexions nocturnes
CREATE TABLE IF NOT EXISTS koda_reflections (
  id              BIGSERIAL PRIMARY KEY,
  jeune_id        TEXT REFERENCES jeunes(airtable_id) ON DELETE CASCADE,
  scope           TEXT NOT NULL DEFAULT 'individual',
  -- Scope: 'individual', 'cohort', 'employer'
  reflection_text TEXT NOT NULL,
  insights        JSONB,
  actions         JSONB,
  applied         BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reflections_jeune ON koda_reflections(jeune_id);
CREATE INDEX IF NOT EXISTS idx_reflections_scope ON koda_reflections(scope);

-- 6. Initialiser onboarding pour jeunes existants
INSERT INTO koda_onboarding_state (jeune_id, step)
SELECT airtable_id, 'not_started'
FROM jeunes
WHERE enrichi_par_ia = true
  AND pret_a_postuler = true
ON CONFLICT (jeune_id) DO NOTHING;
