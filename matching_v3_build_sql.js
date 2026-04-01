// ============================================================================
// 💾 CONSTRUIRE SQL + IA — n8n Code node v2
// ============================================================================

const aiResponse = $('🧠 Review IA (Haiku)').first().json;
const data = $('📝 Préparer prompt IA').first().json;
const jeune = data.jeune;
const offres = data.offres;
const recruteurs = data.recruteurs;

// Parser la réponse IA
let selectionsOffres = [];
let selectionsRecruteurs = [];
try {
  const aiText = aiResponse.content?.[0]?.text || '{"offres":[],"recruteurs":[]}';
  // Nettoyer le texte au cas où l'IA ajoute du markdown
  const cleaned = aiText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(cleaned);
  selectionsOffres = parsed.offres || [];
  selectionsRecruteurs = parsed.recruteurs || [];
} catch(e) {
  // Fallback : top 3 offres + top 2 recruteurs du scoring mathématique
  selectionsOffres = offres.slice(0, 3).map((o, i) => ({ rang: i + 1, message: '', raison: 'Scoring mathématique (IA indisponible)' }));
  selectionsRecruteurs = recruteurs.slice(0, 2).map((r, i) => ({ rang: i + 1, message: '', raison: 'Scoring mathématique (IA indisponible)' }));
}

const esc = (v) => {
  if (v === null || v === undefined) return 'NULL';
  return "'" + String(v).replace(/'/g, "''").substring(0, 2000) + "'";
};

const results = [];

// --- Offres validées par IA ---
for (const sel of selectionsOffres) {
  const idx = sel.rang - 1;
  if (idx < 0 || idx >= offres.length) continue;
  const o = offres[idx];
  const scoreDetailWithAI = { ...o.score_detail, ai_message: sel.message || '', ai_raison: sel.raison || '' };

  const sql = `INSERT INTO koda_matchs (jeune_id, source, offre_id, titre, entreprise, lieu, departement_offre, type_contrat, est_alternance, debutant_accepte, score, score_detail, url_offre, statut) VALUES (${esc(jeune.airtable_id)}, ${esc(o.source)}, ${esc(o.offre_id)}, ${esc(o.titre)}, ${esc(o.entreprise)}, ${esc(o.lieu)}, ${esc(o.departement_offre)}, ${esc(o.type_contrat)}, ${o.est_alternance}, ${o.debutant_accepte}, ${o.score}, '${JSON.stringify(scoreDetailWithAI).replace(/'/g, "''")}', ${esc(o.url_offre)}, 'validee_ia') ON CONFLICT (jeune_id, offre_id) DO UPDATE SET score = EXCLUDED.score, score_detail = EXCLUDED.score_detail, statut = 'validee_ia';`;
  results.push({ json: { query: sql, jeune_prenom: jeune.prenom, type: 'offre', titre: o.titre, score: o.score, ai_message: sel.message } });
}

// --- Recruteurs à valider ---
for (const sel of selectionsRecruteurs) {
  const idx = sel.rang - 1;
  if (idx < 0 || idx >= recruteurs.length) continue;
  const r = recruteurs[idx];
  const scoreDetailWithAI = { ...r.score_detail, ai_message: sel.message || '', ai_raison: sel.raison || '' };

  const sql = `INSERT INTO koda_matchs (jeune_id, source, offre_id, titre, entreprise, lieu, departement_offre, type_contrat, est_alternance, debutant_accepte, score, score_detail, url_offre, statut) VALUES (${esc(jeune.airtable_id)}, ${esc(r.source)}, ${esc(r.offre_id)}, ${esc(r.titre)}, ${esc(r.entreprise)}, ${esc(r.lieu)}, ${esc(r.departement_offre)}, ${esc(r.type_contrat)}, ${r.est_alternance}, ${r.debutant_accepte}, ${r.score}, '${JSON.stringify(scoreDetailWithAI).replace(/'/g, "''")}', ${esc(r.url_offre)}, 'a_valider') ON CONFLICT (jeune_id, offre_id) DO UPDATE SET score = EXCLUDED.score, score_detail = EXCLUDED.score_detail, statut = 'a_valider';`;
  results.push({ json: { query: sql, jeune_prenom: jeune.prenom, type: 'recruteur', titre: r.titre, score: r.score, ai_message: sel.message } });
}

if (results.length === 0) {
  results.push({ json: { query: null, jeune_prenom: jeune.prenom, type: 'aucun', titre: 'Aucun match retenu', score: 0, ai_message: '' } });
}

return results;
