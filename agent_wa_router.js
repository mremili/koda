// ============================================================================
// 🤖 KODA AGENT — Routeur WhatsApp entrant
// n8n Code node v2 — placé après le webhook WhatsApp
// ============================================================================
//
// Flux :
//   Webhook WA → Ce noeud → Switch sur intent → Réponse
//
// Ce noeud :
//   1. Parse le message entrant WhatsApp
//   2. Récupère l'état agent du jeune depuis koda_agent_state
//   3. Détecte l'intention (oui/non/question/hors sujet)
//   4. Retourne un objet { intent, jeune_id, reply, next_stage, memory_event }
//
// Le noeud Switch suivant route selon intent :
//   - 'accept'   → marquer match accepté + notifier mentor
//   - 'reject'   → marquer match rejeté + proposer autre
//   - 'question' → passer à Claude pour réponse contextuelle
//   - 'unknown'  → réponse générique
// ============================================================================

// === 1. Parser le payload WhatsApp Business API ===
// Format standard Cloud API (Meta)
const body = $input.first().json;

// Extraire le message du payload webhook
const entry = body.entry?.[0];
const changes = entry?.changes?.[0];
const value = changes?.value;
const message = value?.messages?.[0];
const contact = value?.contacts?.[0];

if (!message) {
  return [{ json: { intent: 'no_message', reply: null } }];
}

const waPhone = message.from;           // ex: "33612345678"
const waMessageId = message.id;
const messageText = (message.text?.body || '').trim().toLowerCase();
const jeuneName = contact?.profile?.name || 'le jeune';

// === 2. Charger l'état agent depuis Postgres ===
// Note : ce noeud doit être précédé d'un noeud Postgres qui fait :
// SELECT * FROM koda_agent_state WHERE wa_phone = '{{$json.from}}'
const agentStateRaw = $('📊 Charger état agent').first().json;
const agentState = agentStateRaw || {};
const jeuneId = agentState.jeune_id || null;
const currentStage = agentState.current_stage || 'idle';
const pendingMatches = agentState.pending_matches || [];

// === 3. Détecter l'intention ===
const OUI_PATTERNS = [
  /^(oui|yes|ok|ouais|yep|yop|go|allons-y|c'est bon|parfait|super|génial|cool|top|yes!|oui!|👍|✅|💪)/i,
  /^(je suis intéressé|ça m'intéresse|je veux postuler|je postule|intéressé)/i,
  /^[1-3]$/ // Le jeune répond par le numéro de l'offre
];

const NON_PATTERNS = [
  /^(non|no|nope|pas intéressé|pas pour moi|bof|mouais|nan|nope|❌|👎)/i,
  /^(ça ne m'intéresse pas|c'est pas pour moi|pas vraiment|je sais pas)/i
];

const QUESTION_PATTERNS = [
  /\?$/,
  /^(comment|qu'est-ce|pourquoi|c'est quoi|dis-moi|explique|j'ai une question|aide)/i,
  /^(c'est quoi|ça veut dire|c'est où|combien|quand)/i
];

const STOP_PATTERNS = [
  /^(stop|arrêt|arrête|désabonner|désinscription|unsubscribe)/i
];

let intent = 'unknown';
let selectedMatchIndex = null;

if (STOP_PATTERNS.some(p => p.test(messageText))) {
  intent = 'stop';
} else if (OUI_PATTERNS.some(p => p.test(messageText))) {
  intent = 'accept';
  // Si le jeune répond avec un numéro, on sait quel match
  const numMatch = messageText.match(/^([1-3])$/);
  if (numMatch) selectedMatchIndex = parseInt(numMatch[1]) - 1;
} else if (NON_PATTERNS.some(p => p.test(messageText))) {
  intent = 'reject';
} else if (QUESTION_PATTERNS.some(p => p.test(messageText))) {
  intent = 'question';
} else if (currentStage === 'idle' || currentStage === 'matching_pending') {
  intent = 'greeting';
} else {
  intent = 'unknown';
}

// === 4. Construire la réponse selon intent + stage ===
let reply = null;
let nextStage = currentStage;

if (intent === 'stop') {
  reply = `OK, je mets Koda en pause pour toi. Tu peux revenir quand tu veux en m'envoyant "Reprendre". Bonne continuation ! 🤝`;
  nextStage = 'paused';

} else if (intent === 'accept' && pendingMatches.length > 0) {
  const match = selectedMatchIndex !== null ? pendingMatches[selectedMatchIndex] : pendingMatches[0];
  if (match) {
    reply = `Super ! 🎉 Je note que tu es intéressé(e) par "${match.titre}" chez ${match.entreprise}.\n\nTon mentor va être notifié pour t'aider à préparer ta candidature. Tu peux aussi postuler directement ici : ${match.url_offre || '(lien à venir)'}`;
    nextStage = 'candidature_in_progress';
  } else {
    reply = `Super motivation ! Dis-moi pour quelle offre tu es intéressé(e) ? Réponds avec le numéro (1, 2 ou 3).`;
  }

} else if (intent === 'reject') {
  reply = `Pas de problème ! Je cherche d'autres opportunités pour toi. Je reviendrai vers toi dès que j'ai de nouveaux matchs 🔍`;
  nextStage = 'idle';

} else if (intent === 'question') {
  // Passer à Claude pour réponse contextuelle — le Switch routera vers le noeud Claude
  reply = null; // Géré par le noeud suivant

} else if (intent === 'greeting' || intent === 'unknown') {
  if (pendingMatches.length > 0) {
    reply = `Salut ! 👋 Tu as ${pendingMatches.length} opportunité(s) qui t'attendent. Tu veux les voir ? Réponds *oui* pour les recevoir !`;
  } else {
    reply = `Salut ! Je suis Koda, ton assistant pour trouver un job ou une alternance. Je suis en train de chercher des opportunités pour toi — je te recontacte très vite ! 💪`;
  }
}

// === 5. Construire l'événement memory_stream ===
const memoryEvent = {
  jeune_id: jeuneId,
  event_type: 'message_in',
  source: 'jeune',
  content: message.text?.body || '',
  metadata: {
    wa_phone: waPhone,
    wa_message_id: waMessageId,
    intent: intent,
    stage_before: currentStage,
    stage_after: nextStage
  },
  importance: intent === 'accept' ? 8 : intent === 'reject' ? 5 : 3
};

return [{
  json: {
    intent,
    jeune_id: jeuneId,
    jeune_name: jeuneName,
    wa_phone: waPhone,
    wa_message_id: waMessageId,
    message_text: message.text?.body || '',
    reply,
    next_stage: nextStage,
    selected_match: selectedMatchIndex !== null ? pendingMatches[selectedMatchIndex] : (pendingMatches[0] || null),
    pending_matches: pendingMatches,
    memory_event: memoryEvent,
    // Pour le noeud Claude (si intent = 'question')
    context_for_ai: {
      jeune_id: jeuneId,
      current_stage: currentStage,
      message: message.text?.body || '',
      pending_matches: pendingMatches
    }
  }
}];
