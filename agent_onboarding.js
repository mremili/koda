// ============================================================================
// 🎯 KODA AGENT — Onboarding conversationnel WhatsApp
// n8n Code node v2
// ============================================================================
//
// Quand un jeune écrit à Koda pour la première fois, cet onboarding
// se déclenche pour compléter son profil de manière conversationnelle.
//
// State machine :
//   not_started → welcome → job_type → location → cv_check → ready
//
// À chaque message entrant, Koda :
//   1. Charge le step actuel depuis koda_onboarding_state
//   2. Parse la réponse du jeune
//   3. Stocke la donnée collectée
//   4. Avance au step suivant (ou relance si réponse pas claire)
//   5. Retourne le message WA de réponse + les SQL de mise à jour
//
// Nodes précédents attendus :
//   - '📊 Charger état agent' : koda_agent_state du jeune
//   - '📋 Charger onboarding' : koda_onboarding_state du jeune
//   - '👤 Charger profil jeune' : profil depuis table jeunes
//   - Le message entrant WA (parsé par agent_wa_router.js)
// ============================================================================

const routerData = $('🧠 Routeur WA').first().json;
const agentState = $('📊 Charger état agent').first().json;
const onboarding = $('📋 Charger onboarding').first().json;
const jeune = $('👤 Charger profil jeune').first().json;

const messageText = (routerData.message_text || '').trim();
const jeuneId = routerData.jeune_id;
const prenom = jeune.prenom || 'toi';

// État onboarding actuel
let step = onboarding?.step || 'not_started';
let dataCollected = {};
try {
  dataCollected = typeof onboarding?.data_collected === 'string'
    ? JSON.parse(onboarding.data_collected)
    : (onboarding?.data_collected || {});
} catch(e) {
  dataCollected = {};
}

// ============================================================================
// Helpers
// ============================================================================

const esc = (v) => {
  if (v === null || v === undefined) return 'NULL';
  return "'" + String(v).replace(/'/g, "''").substring(0, 2000) + "'";
};

const now = new Date().toISOString();

// Ce qu'on sait déjà du jeune (depuis Airtable/IA)
const knownData = {
  secteur: jeune.secteur_vise || jeune.secteur || null,
  rome_codes: jeune.rome_codes || null,
  ville: jeune.ville || jeune.departement || null,
  has_cv: !!(jeune.cv_url || jeune.cv_uploaded),
  classe: jeune.classe || null,
  niveau_francais: jeune.niveau_francais_declare || null,
  type_contrat_souhaite: jeune.type_contrat_souhaite || null,
};

// ============================================================================
// State machine
// ============================================================================

let reply = '';
let nextStep = step;
let newData = { ...dataCollected };

switch (step) {

  // ── NOT_STARTED / WELCOME ──────────────────────────────────────────────
  case 'not_started':
  case 'welcome': {
    // Premier contact. On se présente et on lance.
    reply = `Salut ${prenom} ! 👋\n\n`;
    reply += `Je suis *Koda*, ton assistant pour trouver du boulot ou une alternance. `;
    reply += `Je suis là 24h/24 pour t'aider.\n\n`;

    // Si on connaît déjà le secteur, on saute direct
    if (knownData.secteur) {
      reply += `D'après ton profil, tu t'intéresses à *${knownData.secteur}*. C'est toujours le cas ?\n\n`;
      reply += `Réponds *oui* ou dis-moi ce que tu cherches maintenant.`;
      nextStep = 'job_type_confirm';
    } else {
      reply += `Pour commencer, dis-moi : *tu cherches quoi comme travail ?*\n\n`;
      reply += `Par exemple : "vendeur", "aide-soignant", "mécanique", "un peu tout"...`;
      nextStep = 'job_type';
    }
    break;
  }

  // ── JOB_TYPE_CONFIRM (on connaît déjà le secteur) ─────────────────────
  case 'job_type_confirm': {
    const msgLow = messageText.toLowerCase();
    if (/^(oui|yes|ouais|yep|ok|c'est bon|exact|toujours)/.test(msgLow)) {
      newData.secteur_confirmed = knownData.secteur;
      newData.source_secteur = 'profile_confirmed';
      reply = `Top ! 👍 Je garde *${knownData.secteur}* comme secteur de recherche.\n\n`;
      // Passer à la localisation
      if (knownData.ville) {
        reply += `Tu es toujours sur *${knownData.ville}* ?`;
        nextStep = 'location_confirm';
      } else {
        reply += `Tu cherches dans quelle ville ou quel département ?`;
        nextStep = 'location';
      }
    } else {
      // Le jeune veut changer
      newData.secteur_stated = messageText;
      newData.source_secteur = 'onboarding_change';
      reply = `OK, noté ! Je cherche dans le domaine de *${messageText}*. 📝\n\n`;
      if (knownData.ville) {
        reply += `Tu es toujours sur *${knownData.ville}* ?`;
        nextStep = 'location_confirm';
      } else {
        reply += `Tu cherches dans quelle ville ou quel département ?`;
        nextStep = 'location';
      }
    }
    break;
  }

  // ── JOB_TYPE (on ne connaît pas le secteur) ───────────────────────────
  case 'job_type': {
    if (messageText.length < 2) {
      reply = `Dis-moi juste en un ou deux mots ce qui t'intéresse comme boulot. Même "je sais pas" c'est OK, je peux t'aider à trouver 😊`;
      nextStep = 'job_type'; // reste sur le même step
    } else {
      newData.secteur_stated = messageText;
      newData.source_secteur = 'onboarding';
      reply = `OK ! *${messageText}*, c'est noté 📝\n\n`;
      if (knownData.ville) {
        reply += `Tu es toujours sur *${knownData.ville}* ?`;
        nextStep = 'location_confirm';
      } else {
        reply += `Et tu cherches où ? Donne-moi une ville ou un département.`;
        nextStep = 'location';
      }
    }
    break;
  }

  // ── LOCATION_CONFIRM ──────────────────────────────────────────────────
  case 'location_confirm': {
    const msgLow = messageText.toLowerCase();
    if (/^(oui|yes|ouais|yep|ok|c'est bon|exact|toujours)/.test(msgLow)) {
      newData.location_confirmed = knownData.ville;
      reply = `Parfait, on reste sur *${knownData.ville}* 📍\n\n`;
    } else {
      newData.location_stated = messageText;
      reply = `OK, je note *${messageText}* 📍\n\n`;
    }
    // Passer au contrat
    reply += `Tu cherches quoi comme type de contrat ?\n`;
    reply += `1️⃣ CDI / CDD\n`;
    reply += `2️⃣ Alternance / Apprentissage\n`;
    reply += `3️⃣ Stage\n`;
    reply += `4️⃣ Tout me va\n\n`;
    reply += `Réponds avec le numéro ou en texte.`;
    nextStep = 'contract_type';
    break;
  }

  // ── LOCATION (on ne connaît pas la ville) ─────────────────────────────
  case 'location': {
    if (messageText.length < 2) {
      reply = `Dis-moi juste une ville ou un département. Même "Paris" ou "93" ça marche !`;
      nextStep = 'location';
    } else {
      newData.location_stated = messageText;
      reply = `Noté : *${messageText}* 📍\n\n`;
      reply += `Tu cherches quoi comme type de contrat ?\n`;
      reply += `1️⃣ CDI / CDD\n`;
      reply += `2️⃣ Alternance / Apprentissage\n`;
      reply += `3️⃣ Stage\n`;
      reply += `4️⃣ Tout me va\n\n`;
      reply += `Réponds avec le numéro ou en texte.`;
      nextStep = 'contract_type';
    }
    break;
  }

  // ── CONTRACT_TYPE ─────────────────────────────────────────────────────
  case 'contract_type': {
    const msgLow = messageText.toLowerCase();
    let contractType = 'all';
    if (/^1|cdi|cdd/.test(msgLow)) contractType = 'cdi_cdd';
    else if (/^2|alternance|apprentissage/.test(msgLow)) contractType = 'alternance';
    else if (/^3|stage/.test(msgLow)) contractType = 'stage';
    else if (/^4|tout|all|n'importe/.test(msgLow)) contractType = 'all';
    else contractType = messageText; // On garde tel quel

    newData.contract_type = contractType;

    // Passer au CV
    if (knownData.has_cv) {
      reply = `Super ! Dernière question : tu as un *CV à jour* ? Le tien date un peu, tu veux que je t'aide à le refaire ? 📄`;
    } else {
      reply = `Dernière question : est-ce que tu as un *CV* ? 📄\n\n`;
      reply += `Réponds *oui* si tu en as un, ou *non* — je peux t'aider à en créer un !`;
    }
    nextStep = 'cv_check';
    break;
  }

  // ── CV_CHECK ──────────────────────────────────────────────────────────
  case 'cv_check': {
    const msgLow = messageText.toLowerCase();
    if (/^(oui|yes|j'en ai|j'ai un)/.test(msgLow)) {
      newData.has_cv = true;
      newData.cv_needs_help = false;
    } else if (/^(non|no|j'en ai pas|pas encore|nan)/.test(msgLow)) {
      newData.has_cv = false;
      newData.cv_needs_help = true;
    } else {
      newData.cv_stated = messageText;
      newData.cv_needs_help = true;
    }

    // ── ONBOARDING TERMINÉ ──
    reply = `C'est bon, j'ai tout ce qu'il faut ! 🎉\n\n`;
    reply += `*Récap :*\n`;

    const secteur = newData.secteur_confirmed || newData.secteur_stated || knownData.secteur || '?';
    const location = newData.location_confirmed || newData.location_stated || knownData.ville || '?';
    const contract = newData.contract_type || 'tout';
    const contractLabels = {
      'cdi_cdd': 'CDI/CDD',
      'alternance': 'Alternance',
      'stage': 'Stage',
      'all': 'Tous types'
    };

    reply += `📌 Secteur : ${secteur}\n`;
    reply += `📍 Lieu : ${location}\n`;
    reply += `📄 Contrat : ${contractLabels[contract] || contract}\n`;
    reply += `📋 CV : ${newData.has_cv ? 'Oui' : 'À créer'}\n\n`;

    reply += `Je lance mes recherches et je te reviens avec des offres qui collent à ton profil. `;
    reply += `Ça peut prendre quelques heures. 🔍\n\n`;

    if (newData.cv_needs_help) {
      reply += `Et je te prépare un CV aussi. J'aurai besoin de quelques infos, mais on voit ça après les premières offres. 💪`;
    } else {
      reply += `En attendant, si tu as des questions, écris-moi ! 💪`;
    }

    nextStep = 'ready';
    break;
  }

  // ── READY (onboarding terminé, ne devrait pas passer par ici) ─────────
  case 'ready': {
    // Le jeune revient mais l'onboarding est fini → renvoyer vers le routeur principal
    return [{
      json: {
        action: 'route_to_main',
        message: 'Onboarding already complete, route to main agent router',
        jeune_id: jeuneId
      }
    }];
  }

  default: {
    reply = `Hmm, je me suis un peu perdu 😅 On reprend : tu cherches quoi comme travail ?`;
    nextStep = 'job_type';
    newData = {};
    break;
  }
}

// ============================================================================
// Générer les SQL de mise à jour
// ============================================================================

const dataJson = JSON.stringify(newData).replace(/'/g, "''");

const sqlUpdateOnboarding = `
  INSERT INTO koda_onboarding_state (jeune_id, step, data_collected, attempts, started_at, updated_at)
  VALUES (
    ${esc(jeuneId)},
    '${nextStep}',
    '${dataJson}'::jsonb,
    ${(onboarding?.attempts || 0) + 1},
    ${step === 'not_started' ? `'${now}'` : `'${onboarding?.started_at || now}'`},
    '${now}'
  )
  ON CONFLICT (jeune_id) DO UPDATE SET
    step = '${nextStep}',
    data_collected = '${dataJson}'::jsonb,
    attempts = koda_onboarding_state.attempts + 1,
    ${nextStep === 'ready' ? `completed_at = '${now}',` : ''}
    updated_at = '${now}';
`;

// Si onboarding terminé → mettre à jour koda_agent_state
const sqlUpdateAgentState = nextStep === 'ready' ? `
  UPDATE koda_agent_state SET
    current_stage = 'idle',
    updated_at = '${now}'
  WHERE jeune_id = ${esc(jeuneId)};
` : null;

// Log memory_stream
const sqlMemory = `
  INSERT INTO koda_memory_stream (jeune_id, event_type, source, content, metadata, importance)
  VALUES (
    ${esc(jeuneId)},
    'onboarding_step',
    'koda',
    ${esc(`Onboarding: ${step} → ${nextStep}`)},
    '${JSON.stringify({ step_from: step, step_to: nextStep, data: newData }).replace(/'/g, "''")}'::jsonb,
    ${nextStep === 'ready' ? 8 : 4}
  );
`;

// Log conversation sortante
const replyEscaped = reply.replace(/'/g, "''");
const sqlConversation = `
  INSERT INTO koda_conversations (jeune_id, direction, sender, message_text, message_type, metadata)
  VALUES (
    ${esc(jeuneId)},
    'out',
    'koda',
    '${replyEscaped}',
    'text',
    '{"trigger":"onboarding","step":"${nextStep}"}'::jsonb
  );
`;

// ============================================================================
// Résultat
// ============================================================================

return [{
  json: {
    reply,
    current_step: step,
    next_step: nextStep,
    data_collected: newData,
    jeune_id: jeuneId,
    jeune_prenom: prenom,
    onboarding_complete: nextStep === 'ready',
    needs_cv_help: newData.cv_needs_help || false,
    // SQL à exécuter
    sql_update_onboarding: sqlUpdateOnboarding,
    sql_update_agent_state: sqlUpdateAgentState,
    sql_memory: sqlMemory,
    sql_conversation: sqlConversation,
    // Pour le noeud WhatsApp
    wa_phone: routerData.wa_phone,
    wa_reply: reply
  }
}];
