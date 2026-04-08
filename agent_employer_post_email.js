// ============================================================================
// 📧 KODA AGENT — Post-génération email employeur
// n8n Code node v2 — après l'appel Claude Sonnet
// ============================================================================
//
// Prend la réponse Claude (subject + body) et prépare :
//   1. L'email final à envoyer via Brevo/SES
//   2. Les SQL pour koda_employer_outreach + koda_memory_stream
//   3. La signature Les Ombres
//
// Node précédent : '🤖 Claude Sonnet (email)' — appel HTTP Anthropic
// ============================================================================

const claudeResponse = $('🤖 Claude Sonnet (email)').first().json;
const outreachData = $('📧 Préparer prospection').first().json;

// Parser la réponse Claude
let subject = 'Candidature accompagnée — Les Ombres';
let body = '';

try {
  const text = claudeResponse.content?.[0]?.text || '';
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(cleaned);
  subject = parsed.subject || subject;
  body = parsed.body || '';
} catch (e) {
  // Fallback : utiliser le texte brut comme body
  body = claudeResponse.content?.[0]?.text || 'Erreur de génération';
}

// Ajouter la signature Les Ombres
const signature = `
--
Koda — Assistant emploi
Association Les Ombres
www.les-ombres.fr

Cet email vous est envoyé car votre entreprise correspond
à des métiers recherchés par nos jeunes accompagnés.
Pour ne plus recevoir ces emails : répondez "stop".`;

const fullBody = body + signature;

// ============================================================================
// SQL
// ============================================================================

const esc = (v) => {
  if (v === null || v === undefined) return 'NULL';
  return "'" + String(v).replace(/'/g, "''").substring(0, 5000) + "'";
};

const now = new Date().toISOString();
const jeuneIdsArray = `ARRAY[${(outreachData.jeune_ids || []).map(id => esc(id)).join(',')}]`;

// Insert dans koda_employer_outreach
const sqlOutreach = `
  INSERT INTO koda_employer_outreach (
    employer_id, jeune_ids, email_subject, email_body,
    email_sent_at, status, metadata
  ) VALUES (
    ${outreachData.employer_id},
    ${jeuneIdsArray},
    ${esc(subject)},
    ${esc(fullBody)},
    '${now}',
    'sent',
    '${JSON.stringify({
      employer_name: outreachData.employer_name,
      employer_email: outreachData.employer_email,
      nb_jeunes: outreachData.nb_jeunes,
      jeune_prenoms: outreachData.jeune_prenoms
    }).replace(/'/g, "''")}'::jsonb
  ) RETURNING id;
`;

// Memory stream pour chaque jeune concerné
const sqlMemoryEntries = (outreachData.jeune_ids || []).map(jId => `
  INSERT INTO koda_memory_stream (jeune_id, event_type, source, content, metadata, importance)
  VALUES (
    ${esc(jId)},
    'employer_outreach',
    'koda',
    ${esc(`Email envoyé à ${outreachData.employer_name} (${outreachData.employer_city})`)},
    '${JSON.stringify({
      employer_id: outreachData.employer_id,
      employer_name: outreachData.employer_name,
      subject: subject
    }).replace(/'/g, "''")}'::jsonb,
    6
  );
`).join('\n');

// ============================================================================
// Résultat : prêt pour le noeud Brevo/SES
// ============================================================================

return [{
  json: {
    // Pour Brevo API
    email_to: outreachData.employer_email,
    email_to_name: outreachData.employer_name,
    email_subject: subject,
    email_body_html: fullBody.replace(/\n/g, '<br>'),
    email_body_text: fullBody,
    email_from: 'koda@les-ombres.fr',
    email_from_name: 'Koda — Les Ombres',
    email_reply_to: 'emploi@les-ombres.fr',

    // Metadata
    employer_id: outreachData.employer_id,
    employer_name: outreachData.employer_name,
    jeune_ids: outreachData.jeune_ids,
    nb_jeunes: outreachData.nb_jeunes,

    // SQL
    sql_outreach: sqlOutreach,
    sql_memory: sqlMemoryEntries,

    skip: !outreachData.employer_email // Skip si pas d'email
  }
}];
