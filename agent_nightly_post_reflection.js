// ============================================================================
// 🌙 KODA AGENT — Post-réflexion : stocker + appliquer les actions
// n8n Code node v2 — après l'appel Claude Haiku de réflexion
// ============================================================================

const reflectionInput = $('🌙 Préparer réflexion').first().json;
const claudeResponse = $('🤖 Claude Haiku (réflexion)').first().json;

// Parser la réponse Claude
let reflection = { summary: '', insights: [], actions: {}, priority: 'low' };
try {
  const text = claudeResponse.content?.[0]?.text || '';
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  reflection = JSON.parse(cleaned);
} catch(e) {
  reflection.summary = claudeResponse.content?.[0]?.text || 'Erreur de parsing';
}

const esc = (v) => {
  if (v === null || v === undefined) return 'NULL';
  return "'" + String(v).replace(/'/g, "''").substring(0, 5000) + "'";
};

const now = new Date().toISOString();
const jeuneId = reflectionInput.jeune_id;
const scope = reflectionInput.type || 'individual';

// ============================================================================
// 1. Stocker la réflexion
// ============================================================================

const insightsJson = JSON.stringify(reflection.insights || []).replace(/'/g, "''");
const actionsJson = JSON.stringify(reflection.actions || {}).replace(/'/g, "''");

const sqlReflection = `
  INSERT INTO koda_reflections (jeune_id, scope, reflection_text, insights, actions)
  VALUES (
    ${jeuneId ? esc(jeuneId) : 'NULL'},
    '${scope}',
    ${esc(reflection.summary)},
    '${insightsJson}'::jsonb,
    '${actionsJson}'::jsonb
  );
`;

// ============================================================================
// 2. Appliquer les actions automatiques
// ============================================================================

const actions = reflection.actions || {};
const sqlActions = [];

// Action : pause outreach (jeune ne répond plus)
if (actions.pause_outreach && jeuneId) {
  sqlActions.push(`
    UPDATE koda_agent_state SET
      current_stage = 'paused',
      notes = COALESCE(notes, '') || ' [auto-pause: ${now}]',
      updated_at = '${now}'
    WHERE jeune_id = ${esc(jeuneId)};
  `);
}

// Action : ajuster la fréquence
if (actions.adjust_frequency === 'decrease' && jeuneId) {
  sqlActions.push(`
    INSERT INTO koda_memory_stream (jeune_id, event_type, source, content, importance)
    VALUES (${esc(jeuneId)}, 'frequency_adjusted', 'system', 'Fréquence réduite suite à réflexion nocturne', 4);
  `);
}

// Action : alerter le mentor
if (actions.alert_mentor && jeuneId) {
  const reason = actions.alert_mentor_reason || actions.reason || 'Signal détecté par Koda';
  sqlActions.push(`
    INSERT INTO koda_memory_stream (jeune_id, event_type, source, content, metadata, importance)
    VALUES (
      ${esc(jeuneId)},
      'mentor_alert',
      'system',
      ${esc('Alerte mentor : ' + reason)},
      '{"auto_generated":true,"priority":"${reflection.priority || 'medium'}"}'::jsonb,
      9
    );
  `);
}

// Action : suggérer aide CV
if (actions.suggest_cv_help && jeuneId) {
  sqlActions.push(`
    INSERT INTO koda_memory_stream (jeune_id, event_type, source, content, importance)
    VALUES (${esc(jeuneId)}, 'action_planned', 'system', 'Proposer aide CV au prochain échange', 5);
  `);
}

// Log la réflexion elle-même dans memory_stream
if (jeuneId) {
  sqlActions.push(`
    INSERT INTO koda_memory_stream (jeune_id, event_type, source, content, metadata, importance)
    VALUES (
      ${esc(jeuneId)},
      'reflection',
      'system',
      ${esc(reflection.summary)},
      '${actionsJson}'::jsonb,
      ${reflection.priority === 'high' ? 8 : reflection.priority === 'medium' ? 6 : 4}
    );
  `);
}

// ============================================================================
// Résultat
// ============================================================================

return [{
  json: {
    type: scope,
    jeune_id: jeuneId,
    summary: reflection.summary,
    insights: reflection.insights,
    actions: reflection.actions,
    priority: reflection.priority,
    // SQL à exécuter
    sql_reflection: sqlReflection,
    sql_actions: sqlActions.join('\n'),
    // Pour notification si priorité haute
    needs_notification: reflection.priority === 'high',
    notification_text: reflection.priority === 'high'
      ? `⚠️ Koda alerte : ${reflection.summary}`
      : null,
    // Alertes cohort
    alerts: reflection.alerts || []
  }
}];
