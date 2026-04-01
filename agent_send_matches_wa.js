// ============================================================================
// 📤 KODA AGENT — Envoi des matchs par WhatsApp
// n8n Code node v2 — déclenché après le moteur de matching
// ============================================================================
//
// Ce noeud :
//   1. Récupère les matchs validés par IA pour un jeune
//   2. Formate un message WhatsApp lisible (max 3 offres + 2 recruteurs)
//   3. Met à jour koda_agent_state (pending_matches, stage → 'matches_sent')
//   4. Logue dans koda_memory_stream
//   5. Retourne les requêtes SQL + le message WA à envoyer
//
// Nodes précédents attendus :
//   - '🤖 Review IA (Haiku)' : sélections IA
//   - '📝 Préparer prompt IA' : données jeune + offres
// ============================================================================

const aiResponse = $('🤖 Review IA (Haiku)').first().json;
const data = $('📝 Préparer prompt IA').first().json;
const jeune = data.jeune;
const offres = data.offres;
const recruteurs = data.recruteurs;

// Parser la réponse IA
let selectionsOffres = [];
let selectionsRecruteurs = [];
try {
  const aiText = aiResponse.content?.[0]?.text || '{"offres":[],"recruteurs":[]}';
  const cleaned = aiText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(cleaned);
  selectionsOffres = parsed.offres || [];
  selectionsRecruteurs = parsed.recruteurs || [];
} catch(e) {
  selectionsOffres = offres.slice(0, 3).map((o, i) => ({ rang: i + 1, message: 'Une opportunité pour toi !', raison: 'Scoring automatique' }));
  selectionsRecruteurs = recruteurs.slice(0, 2).map((r, i) => ({ rang: i + 1, message: 'Entreprise intéressante !', raison: 'Scoring automatique' }));
}

// ============================================================================
// Construire les objets "match" enrichis avec le message IA
// ============================================================================

const matchsOffres = selectionsOffres
  .map(sel => {
    const o = offres[sel.rang - 1];
    if (!o) return null;
    return {
      type: 'offre',
      offre_id: o.offre_id,
      titre: o.titre,
      entreprise: o.entreprise,
      lieu: o.lieu,
      type_contrat: o.type_contrat,
      score: o.score,
      url_offre: o.url_offre,
      ai_message: sel.message || '',
      ai_raison: sel.raison || ''
    };
  })
  .filter(Boolean);

const matchsRecruteurs = selectionsRecruteurs
  .map(sel => {
    const r = recruteurs[sel.rang - 1];
    if (!r) return null;
    return {
      type: 'recruteur',
      offre_id: r.offre_id,
      titre: r.titre,
      entreprise: r.entreprise,
      lieu: r.lieu,
      type_contrat: r.type_contrat,
      score: r.score,
      url_offre: r.url_offre,
      telephone: r.telephone || '',
      opco: r.opco || '',
      ai_message: sel.message || '',
      ai_raison: sel.raison || ''
    };
  })
  .filter(Boolean);

const tousLesMatchs = [...matchsOffres, ...matchsRecruteurs];

// ============================================================================
// Formater le message WhatsApp
// ============================================================================

const prenom = jeune.prenom || 'toi';
let waMessage = `Salut ${prenom} ! 🎯 Koda a trouvé des opportunités pour toi :\n\n`;

matchsOffres.forEach((m, i) => {
  waMessage += `*${i + 1}. ${m.titre}*\n`;
  waMessage += `🏢 ${m.entreprise} — 📍 ${m.lieu}\n`;
  waMessage += `📄 ${m.type_contrat}\n`;
  if (m.ai_message) waMessage += `💬 "${m.ai_message}"\n`;
  waMessage += `\n`;
});

if (matchsRecruteurs.length > 0) {
  waMessage += `*💡 Entreprises où postuler en direct :*\n`;
  matchsRecruteurs.forEach((r, i) => {
    waMessage += `• *${r.entreprise}* (${r.lieu})`;
    if (r.telephone) waMessage += ` — 📞 ${r.telephone}`;
    waMessage += `\n`;
    if (r.ai_message) waMessage += `  "${r.ai_message}"\n`;
  });
  waMessage += `\n`;
}

if (matchsOffres.length > 0) {
  waMessage += `Tu es intéressé(e) ? Réponds avec le *numéro* de l'offre (1, 2 ou 3) ou dis *oui* pour la première.\nDis *non* si rien ne te convient.\n\nJe suis là pour t'aider ! 💪`;
} else {
  waMessage += `Ces entreprises cherchent des alternants dans ton secteur. Réponds *oui* pour qu'on t'aide à les contacter. 💪`;
}

// ============================================================================
// SQL : mettre à jour koda_agent_state
// ============================================================================

const esc = (v) => {
  if (v === null || v === undefined) return 'NULL';
  return "'" + String(v).replace(/'/g, "''").substring(0, 2000) + "'";
};

const pendingMatchesJson = JSON.stringify(tousLesMatchs).replace(/'/g, "''");
const now = new Date().toISOString();

const sqlUpdateState = `
  INSERT INTO koda_agent_state (jeune_id, current_stage, last_match_run, pending_matches, nb_matches_sent, updated_at)
  VALUES (
    ${esc(jeune.airtable_id)},
    'matches_sent',
    '${now}',
    '${pendingMatchesJson}'::jsonb,
    ${tousLesMatchs.length},
    '${now}'
  )
  ON CONFLICT (jeune_id) DO UPDATE SET
    current_stage = 'matches_sent',
    last_match_run = '${now}',
    pending_matches = '${pendingMatchesJson}'::jsonb,
    nb_matches_sent = koda_agent_state.nb_matches_sent + ${tousLesMatchs.length},
    updated_at = '${now}';
`;

// SQL : log memory_stream
const memoryContent = `${tousLesMatchs.length} match(s) envoyé(s) : ${matchsOffres.map(m => m.titre).join(', ')}`;
const memoryMetadata = JSON.stringify({
  nb_offres: matchsOffres.length,
  nb_recruteurs: matchsRecruteurs.length,
  offres: matchsOffres.map(m => ({ titre: m.titre, entreprise: m.entreprise, score: m.score }))
}).replace(/'/g, "''");

const sqlMemory = `
  INSERT INTO koda_memory_stream (jeune_id, event_type, source, content, metadata, importance)
  VALUES (
    ${esc(jeune.airtable_id)},
    'match_sent',
    'koda',
    ${esc(memoryContent)},
    '${memoryMetadata}'::jsonb,
    7
  );
`;

// SQL : log conversation
const waMessageEscaped = waMessage.replace(/'/g, "''");
const sqlConversation = `
  INSERT INTO koda_conversations (jeune_id, direction, sender, message_text, message_type, metadata)
  VALUES (
    ${esc(jeune.airtable_id)},
    'out',
    'koda',
    '${waMessageEscaped}',
    'text',
    '{"trigger":"matching_v3"}'::jsonb
  );
`;

// ============================================================================
// Résultat
// ============================================================================

if (tousLesMatchs.length === 0) {
  return [{
    json: {
      query: null,
      wa_message: null,
      jeune_prenom: jeune.prenom,
      jeune_id: jeune.airtable_id,
      nb_matchs: 0,
      skip: true
    }
  }];
}

return [{
  json: {
    // Messages WhatsApp à envoyer
    wa_message: waMessage,
    wa_phone: jeune.wa_phone || null,  // À alimenter depuis jeunes.tel_referent ou colonne dédiée
    jeune_id: jeune.airtable_id,
    jeune_prenom: jeune.prenom,
    nb_matchs: tousLesMatchs.length,
    nb_offres: matchsOffres.length,
    nb_recruteurs: matchsRecruteurs.length,
    // Requêtes SQL à exécuter (3 noeuds Postgres séquentiels)
    sql_update_state: sqlUpdateState,
    sql_memory: sqlMemory,
    sql_conversation: sqlConversation,
    // Données brutes pour les noeuds suivants
    matchs: tousLesMatchs,
    skip: false
  }
}];
