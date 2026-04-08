// ============================================================================
// 🌙 KODA AGENT — Réflexion nocturne
// n8n Code node v2 — déclenché par cron à 23h
// ============================================================================
//
// Inspiré du pattern Stanford Generative Agents : chaque nuit, Koda
// analyse les événements de la journée pour chaque jeune actif et en tire
// des insights + actions correctives.
//
// Flux :
//   Cron 23h → Charger jeunes actifs → Pour chaque jeune :
//     1. Récupérer les events du jour (memory_stream)
//     2. Récupérer le contexte (état agent, onboarding, candidatures)
//     3. Claude Haiku analyse et génère une réflexion
//     4. Stocker dans koda_reflections
//     5. Appliquer les actions auto (ajuster ROME, changer fréquence, etc.)
//   → Réflexion cohort (tendances globales)
//
// Nodes précédents attendus :
//   - '📊 Events du jour' : résultat SQL memory_stream WHERE created_at > today
//   - '📋 État agent' : koda_agent_state du jeune
//   - '📈 Candidatures' : koda_candidatures du jeune
// ============================================================================

// === Charger les données ===
const eventsAll = $('📊 Events du jour').all();
const agentStates = $('📋 États agents').all();

// Grouper les events par jeune
const eventsByJeune = {};
for (const item of eventsAll) {
  const e = item.json;
  if (!eventsByJeune[e.jeune_id]) eventsByJeune[e.jeune_id] = [];
  eventsByJeune[e.jeune_id].push(e);
}

// Grouper les états par jeune
const stateByJeune = {};
for (const item of agentStates) {
  stateByJeune[item.json.jeune_id] = item.json;
}

// ============================================================================
// System prompt pour la réflexion
// ============================================================================

const REFLECTION_SYSTEM = `Tu es le module de réflexion de Koda, un agent de placement pour jeunes vulnérables.

Chaque nuit, tu analyses les événements de la journée pour un jeune et tu produis :
1. Un RÉSUMÉ de la journée (2-3 phrases)
2. Des INSIGHTS (qu'est-ce qui a marché / pas marché)
3. Des ACTIONS concrètes à prendre

Actions possibles (JSON) :
- widen_rome: bool — élargir les codes ROME si pas assez de matchs
- narrow_rome: bool — resserrer si trop de matchs non pertinents
- new_rome_suggestion: string — nouveau code ROME à ajouter
- adjust_frequency: "increase" | "decrease" | "keep" — fréquence d'envoi des offres
- alert_mentor: bool + reason — signaler qqch au mentor
- change_tone: string — "more_casual", "more_supportive", "more_direct"
- suggest_cv_help: bool — proposer aide CV si le jeune n'avance pas
- pause_outreach: bool — mettre en pause si le jeune ne répond plus
- flag_for_review: bool + reason — signaler un cas complexe à Mourad

Réponds UNIQUEMENT en JSON :
{
  "summary": "...",
  "insights": ["...", "..."],
  "actions": { ... },
  "priority": "low" | "medium" | "high"
}`;

// ============================================================================
// Générer les prompts de réflexion pour chaque jeune actif
// ============================================================================

const results = [];
const jeuneIds = Object.keys(eventsByJeune);

// === Réflexions individuelles ===
for (const jeuneId of jeuneIds) {
  const events = eventsByJeune[jeuneId];
  const state = stateByJeune[jeuneId] || {};

  // Résumé des events
  const eventsSummary = events.map(e => {
    const time = new Date(e.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `[${time}] ${e.event_type}: ${e.content || '(pas de contenu)'}`;
  }).join('\n');

  // Statistiques
  const nbMessages = events.filter(e => e.event_type === 'message_in').length;
  const nbMatchesSent = events.filter(e => e.event_type === 'match_sent').length;
  const nbAccepted = events.filter(e => e.event_type === 'match_accepted').length;
  const nbRejected = events.filter(e => e.event_type === 'match_rejected').length;
  const nbNoResponse = nbMatchesSent - nbAccepted - nbRejected;

  const userPrompt = `JEUNE : ${jeuneId}
ÉTAT ACTUEL : ${state.current_stage || 'inconnu'}
MATCHS ENVOYÉS (total) : ${state.nb_matches_sent || 0}
CANDIDATURES (total) : ${state.nb_candidatures || 0}
DERNIER MESSAGE DU JEUNE : ${state.last_reply_at || 'jamais'}

ÉVÉNEMENTS AUJOURD'HUI (${events.length}) :
${eventsSummary}

STATS DU JOUR :
- Messages reçus du jeune : ${nbMessages}
- Matchs envoyés : ${nbMatchesSent}
- Acceptés : ${nbAccepted}
- Rejetés : ${nbRejected}
- Sans réponse : ${nbNoResponse}

Analyse cette journée et donne tes insights + actions.`;

  results.push({
    json: {
      type: 'individual',
      jeune_id: jeuneId,
      system_prompt: REFLECTION_SYSTEM,
      user_prompt: userPrompt,
      events_count: events.length,
      stats: { nbMessages, nbMatchesSent, nbAccepted, nbRejected, nbNoResponse }
    }
  });
}

// === Réflexion cohort (tendances globales) ===
const totalEvents = eventsAll.length;
const totalJeunes = jeuneIds.length;
const allMatchesSent = eventsAll.filter(i => i.json.event_type === 'match_sent').length;
const allAccepted = eventsAll.filter(i => i.json.event_type === 'match_accepted').length;
const allRejected = eventsAll.filter(i => i.json.event_type === 'match_rejected').length;
const allMessages = eventsAll.filter(i => i.json.event_type === 'message_in').length;
const inactiveJeunes = Object.keys(stateByJeune).filter(id => !eventsByJeune[id]).length;

const cohortPrompt = `RÉFLEXION GLOBALE — COHORTE KODA

${totalJeunes} jeunes actifs aujourd'hui (sur ${Object.keys(stateByJeune).length} total).
${inactiveJeunes} jeunes inactifs (aucun événement).

STATS GLOBALES DU JOUR :
- Total événements : ${totalEvents}
- Matchs envoyés : ${allMatchesSent}
- Acceptés : ${allAccepted} (${allMatchesSent > 0 ? Math.round(allAccepted/allMatchesSent*100) : 0}%)
- Rejetés : ${allRejected}
- Messages reçus : ${allMessages}

Analyse les tendances globales. Y a-t-il des patterns ?
Des secteurs qui marchent mieux que d'autres ?
Des signaux d'alerte (trop de jeunes inactifs, taux d'acceptation faible, etc.) ?

Réponds en JSON :
{
  "summary": "...",
  "insights": ["...", "..."],
  "actions": { ... },
  "alerts": ["..."]
}`;

results.push({
  json: {
    type: 'cohort',
    jeune_id: null,
    system_prompt: REFLECTION_SYSTEM,
    user_prompt: cohortPrompt,
    stats: { totalEvents, totalJeunes, allMatchesSent, allAccepted, allRejected, allMessages, inactiveJeunes }
  }
});

// ============================================================================
// Si aucun event aujourd'hui, ne rien faire
// ============================================================================

if (totalEvents === 0) {
  return [{
    json: {
      skip: true,
      message: 'Aucun événement aujourd\'hui, pas de réflexion nécessaire',
      date: new Date().toISOString().split('T')[0]
    }
  }];
}

return results;
