// ============================================================================
// 🏗️ KODA — ARCHITECTURE AGENT DE PLACEMENT v1
// ============================================================================
//
// Koda est un agent de placement autonome pour jeunes vulnérables (ASE/MNA).
// Deux faces : côté jeune/mentor (WhatsApp) + côté employeur (email).
// Stack : Supabase + n8n + Claude + WhatsApp Business API
//
// ============================================================================
//
// ┌─────────────────────────────────────────────────────────────────────┐
// │                        KODA AGENT CORE                             │
// │                                                                    │
// │  ┌──────────┐  ┌──────────────┐  ┌────────────────┐               │
// │  │ Memory   │  │ Agent State  │  │  Reflection    │               │
// │  │ Stream   │  │ Machine      │  │  Engine        │               │
// │  │          │  │              │  │  (nightly)     │               │
// │  │ Tous les │  │ Un état par  │  │  Apprend des   │               │
// │  │ events   │  │ jeune + par  │  │  succès/échecs │               │
// │  │          │  │ employeur    │  │                │               │
// │  └──────────┘  └──────────────┘  └────────────────┘               │
// │                                                                    │
// │  ┌──────────────────────────┐  ┌──────────────────────────────┐   │
// │  │   FACE JEUNE/MENTOR     │  │   FACE EMPLOYEUR             │   │
// │  │                          │  │                              │   │
// │  │  WhatsApp ←→ Webhook     │  │  Email sortant (Brevo/SES)  │   │
// │  │                          │  │  Email entrant (webhook)     │   │
// │  │  Capabilities :          │  │                              │   │
// │  │  • Onboarding profil     │  │  Capabilities :              │   │
// │  │  • Push offres matchées  │  │  • Prospection ciblée       │   │
// │  │  • Aide CV (Sonnet)      │  │  • Suivi candidatures       │   │
// │  │  • Prépa entretien       │  │  • Relance auto             │   │
// │  │  • Relance intelligente  │  │  • Propositions de profils  │   │
// │  │  • Coordination mentor   │  │  • Feedback loop            │   │
// │  │                          │  │                              │   │
// │  └──────────────────────────┘  └──────────────────────────────┘   │
// │                                                                    │
// └─────────────────────────────────────────────────────────────────────┘
//
// ============================================================================
// DONNÉES SUPABASE
// ============================================================================
//
// Tables existantes :
//   jeunes                  - Profils synchronisés depuis Airtable
//   koda_inference_skills   - Compétences extraites par IA
//   koda_rome_passerelles   - Passerelles ROME pour élargir les recherches
//   koda_memory_stream      - Journal de tous les événements
//   koda_agent_state        - État courant par jeune
//   koda_conversations      - Log messages WhatsApp
//
// Nouvelles tables (à créer) :
//   koda_employers          - Entreprises prospectées par Koda
//   koda_candidatures       - Candidatures envoyées (jeune × offre/employeur)
//   koda_employer_outreach  - Emails envoyés aux employeurs + réponses
//   koda_reflections        - Réflexions nocturnes de l'agent
//   koda_onboarding_state   - Progression onboarding de chaque jeune
//
// ============================================================================
// FLUX PRINCIPAUX
// ============================================================================
//
// 1. ACTIVATION JEUNE (SMS Les Ombres → WhatsApp Koda)
//    ─────────────────────────────────────────────────
//    Trigger : quand un jeune est matché avec un bénévole et cherche un emploi
//    Les Ombres envoie un SMS : "Koda est ton assistant emploi. Écris-lui sur WA au 07XX"
//
//    Premier message du jeune → Koda démarre l'onboarding :
//    - "Salut ! Je suis Koda. Je vais t'aider à trouver du boulot.
//       Pour commencer, dis-moi : tu cherches quoi comme travail ?"
//    - Conversation naturelle pour compléter le profil
//    - Koda pose des questions intelligentes basées sur ce qu'il sait déjà
//      (resume_suivi, inferences IA, données Airtable)
//    - À la fin : "Ton profil est prêt. Je cherche des offres pour toi !"
//
//    Onboarding state machine :
//    ┌─────────┐  ┌───────────┐  ┌──────────┐  ┌─────────┐  ┌───────┐
//    │ welcome │→ │ job_type  │→ │ location │→ │ cv_check│→ │ ready │
//    └─────────┘  └───────────┘  └──────────┘  └─────────┘  └───────┘
//
// 2. MATCHING QUOTIDIEN
//    ──────────────────
//    Cron n8n (6h du matin) :
//    - Pour chaque jeune en état 'ready' ou 'idle' :
//      a. Scrape France Travail + La Bonne Alternance (workflow existant v5)
//      b. Score avec scoring v3
//      c. Review IA (Haiku) → top 3 offres + 2 recruteurs
//      d. Compare avec les offres déjà envoyées (éviter doublons via memory_stream)
//      e. Si nouvelles offres pertinentes → push WhatsApp
//      f. Si rien de nouveau → ne pas déranger, log 'no_new_matches'
//
// 3. PROSPECTION EMPLOYEUR (la face B)
//    ─────────────────────────────────
//    Pour les jeunes avec un bon profil mais peu d'offres :
//    a. Identifier des entreprises cibles (La Bonne Alternance "recruteurs",
//       entreprises BMO en tension sur les ROME du jeune)
//    b. Générer un email personnalisé (Sonnet) :
//       "Bonjour [nom], je suis Koda, assistant de l'association Les Ombres.
//        Nous accompagnons des jeunes motivés vers l'emploi. J'ai un(e) candidat(e)
//        en [secteur] qui pourrait correspondre à vos besoins..."
//    c. Envoyer via Brevo/SES (domaine les-ombres.fr)
//    d. Tracker les ouvertures, clics, réponses
//    e. Si réponse positive → matcher avec le/les jeune(s) pertinent(s)
//    f. Si pas de réponse → relance J+3 (une seule)
//
//    Éthique : toujours mentionner Les Ombres, pas de spam, opt-out facile
//
// 4. SUIVI CANDIDATURE
//    ─────────────────
//    Quand un jeune accepte une offre :
//    a. Koda propose d'aider à rédiger une lettre/candidature (Sonnet)
//    b. Koda vérifie si le jeune a un CV → sinon, propose de l'aider
//    c. Si entretien décroché → prépa entretien par WA
//       "Tu as un entretien chez [entreprise] le [date].
//        3 choses à retenir sur cette boîte : ..."
//    d. Après entretien → Koda demande comment ça s'est passé
//    e. Log tout dans memory_stream (importance haute)
//
// 5. COORDINATION MENTOR (notification asynchrone)
//    ─────────────────────────────────────────────
//    Le mentor reçoit des notifications (email ou WA séparé) :
//    - "Votre mentoré [prénom] a reçu 3 offres ce matin"
//    - "Il est intéressé par [offre] chez [entreprise]"
//    - "Il a un entretien le [date] — vous pouvez l'aider à préparer"
//    - Résumé hebdomadaire : avancement, offres vues, candidatures, moral
//
//    Le mentor peut répondre → son message est loggé dans koda_conversations
//    avec sender='mentor' et Koda en tient compte dans ses interactions
//
// 6. RÉFLEXION NOCTURNE (cron 23h)
//    ─────────────────────────────
//    Pour chaque jeune actif :
//    a. Récupérer les événements du jour dans memory_stream
//    b. Claude analyse : qu'est-ce qui a marché ? qu'est-ce qui a bloqué ?
//    c. Générer une "reflection" stockée dans koda_reflections
//    d. Mettre à jour la stratégie :
//       - Élargir/resserrer les ROME si trop/pas assez de matchs
//       - Ajuster le ton des messages si le jeune ne répond pas
//       - Signaler au mentor si le jeune semble décrocher
//       - Apprendre des acceptations/rejets pour affiner le scoring
//
// ============================================================================
// PERSONNALITÉ KODA
// ============================================================================
//
// Koda parle comme un grand frère/grande soeur qui s'y connaît en emploi.
// - Tutoiement naturel
// - Messages courts (max 3 phrases par bulle)
// - Pas de jargon RH
// - Encourageant mais pas niais
// - Sait quand relancer et quand laisser tranquille
// - Adapte son ton selon le profil :
//   • MNA avec français limité → phrases simples, emojis explicites
//   • Jeune ASE autonome → plus direct, plus de détails
//   • Jeune en décrochage → doux, pas de pression
//
// System prompt (injecté dans chaque appel Claude) :
//   "Tu es Koda, un assistant emploi pour jeunes de 16-25 ans accompagnés
//    par l'association Les Ombres. Tu parles en WhatsApp : court, direct,
//    bienveillant. Tu connais le marché de l'emploi, les codes, les pièges.
//    Tu es là pour aider, pas pour juger. Quand tu proposes une offre,
//    explique en une phrase pourquoi elle colle au profil du jeune."
//
// ============================================================================
// PLAN DE MISE EN OEUVRE
// ============================================================================
//
// Semaine 1 : Foundation
//   ✅ Tables koda_memory_stream, koda_agent_state, koda_conversations
//   □  Tables koda_employers, koda_candidatures, koda_employer_outreach
//   □  Table koda_onboarding_state
//   □  Activer WhatsApp Business API (Meta Cloud API)
//   □  Webhook n8n entrant WhatsApp → routeur → réponse
//
// Semaine 2 : Face jeune
//   □  Onboarding conversationnel (state machine 5 étapes)
//   □  Push matchs quotidiens via WA (adapter agent_send_matches_wa.js)
//   □  Gestion accept/reject → candidature
//   □  Aide CV avec Sonnet (générer PDF basique)
//
// Semaine 3 : Face employeur
//   □  Table koda_employers alimentée depuis LBA + BMO
//   □  Générateur d'emails de prospection (Sonnet)
//   □  Envoi via Brevo API (n8n node HTTP)
//   □  Webhook réponse email → koda_employer_outreach
//
// Semaine 4 : Intelligence
//   □  Réflexion nocturne (cron + Claude)
//   □  Anti-doublon offres (memory_stream lookup)
//   □  Relance intelligente (J+2 sans réponse)
//   □  Dashboard mentor (Supabase + mini frontend ou Airtable interface)
//
// ============================================================================
// COÛTS ESTIMÉS (pour 70 jeunes actifs)
// ============================================================================
//
// WhatsApp Business API :
//   - Conversations initiées par Koda : ~€0.07/conversation (utility template)
//   - Conversations initiées par le jeune : gratuit (24h window)
//   - Estimation : 70 jeunes × 3 convs/semaine = 210 convs → ~€15/semaine
//
// Claude API :
//   - Haiku (matching, routage) : ~€0.001/appel × 200 appels/jour = €0.20/jour
//   - Sonnet (CV, emails, réflexion) : ~€0.01/appel × 30 appels/jour = €0.30/jour
//   - Total : ~€15/mois
//
// Brevo (emails employeurs) :
//   - Plan gratuit : 300 emails/jour (largement suffisant)
//
// Supabase :
//   - Plan actuel (gratuit ou Pro à €25/mois) suffit
//
// TOTAL : ~€100/mois pour 70 jeunes → €1.40/jeune/mois
// Scale à 500 jeunes : ~€500/mois → €1/jeune/mois (économie d'échelle)
//
