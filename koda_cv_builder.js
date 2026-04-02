// ============================================================================
// 📄 KODA CV BUILDER — Collecte conversationnelle + Génération
// ============================================================================
//
// PHILOSOPHIE :
//   1. Pré-remplir TOUT ce qu'on sait déjà (base + IA + notes mentor)
//   2. Extraire les expériences cachées du resume_suivi via Claude
//   3. Ne poser que les questions sur ce qui MANQUE vraiment
//   4. Poser UNE question à la fois, en mode déblocage
//   5. Générer un CV pro quand on a assez de matière
//
// ============================================================================
// ÉTAPE 1 : Analyser ce qu'on a vs ce qui manque
// ============================================================================

// Ce code est appelé quand le jeune demande un CV ou quand l'agent décide
// que c'est le moment (après onboarding, après match accepté, etc.)

// Input : le profil complet du jeune depuis Supabase
// Output : { cv_data, missing_fields, next_question, ready_to_generate }

function analyzeCVReadiness(jeune, skills, resumeSuivi, conversations) {

  const cvData = {
    // === IDENTITÉ (toujours rempli) ===
    prenom: jeune.prenom || '',
    nom: jeune.nom || '',
    ville: jeune.ville || '',
    departement: jeune.departement || '',
    telephone: jeune.telephone || '',
    email: jeune.email || '',
    genre: jeune.genre || '',

    // === TITRE DU CV (généré par IA selon le poste visé) ===
    titre: '', // sera généré

    // === PROFIL / ACCROCHE (généré par IA) ===
    profil: '', // sera généré

    // === FORMATION ===
    formations: [],
    // On sait : classe actuelle
    // Manque souvent : établissement, dates, formations passées

    // === EXPÉRIENCES ===
    experiences: [],
    // C'est LE trou à combler
    // Sources : resume_suivi, conversations WA, questions directes

    // === COMPÉTENCES ===
    competences: skills.map(s => s.skill_name || s),

    // === LANGUES ===
    langues: [],

    // === CENTRES D'INTÉRÊT ===
    centres_interet: [],

    // === DISPONIBILITÉ ===
    disponibilite: jeune.disponibilite || '',

    // === PERMIS ===
    permis: jeune.a_permis ? 'Permis B' : null
  };

  // --- Remplir les formations ---
  if (jeune.classe) {
    cvData.formations.push({
      diplome: jeune.classe,
      lieu: '', // à demander
      dates: '', // à demander
      en_cours: true
    });
  }

  // --- Remplir les langues ---
  const nf = (jeune.niveau_francais_declare || '').toLowerCase();
  if (nf.includes('courant') || nf.includes('avancé')) {
    cvData.langues.push({ langue: 'Français', niveau: 'Courant' });
  } else if (nf.includes('intermédiaire')) {
    cvData.langues.push({ langue: 'Français', niveau: 'Intermédiaire' });
  } else if (nf.includes('débutant') || nf.includes('non francophone')) {
    cvData.langues.push({ langue: 'Français', niveau: 'Notions' });
  } else {
    cvData.langues.push({ langue: 'Français', niveau: 'Courant' });
  }

  // Si MNA → langue maternelle probable
  if (jeune.mna) {
    // On ne sait pas exactement la langue mais on peut demander
    cvData.langues.push({ langue: '(langue maternelle)', niveau: 'Langue maternelle' });
  }

  // === IDENTIFIER CE QUI MANQUE ===
  const missing = [];

  if (cvData.experiences.length === 0) {
    missing.push('experiences');
  }
  if (cvData.formations[0] && !cvData.formations[0].lieu) {
    missing.push('formation_lieu');
  }
  if (cvData.centres_interet.length === 0) {
    missing.push('centres_interet');
  }
  if (jeune.mna && cvData.langues.some(l => l.langue === '(langue maternelle)')) {
    missing.push('langue_maternelle');
  }
  if (!cvData.email) {
    missing.push('email');
  }

  return { cvData, missing };
}

// ============================================================================
// ÉTAPE 2 : Le prompt "déblocage d'expériences"
// ============================================================================
//
// C'est le coeur de l'innovation. Un jeune de 18 ans pense n'avoir
// "rien à mettre". Koda sait que c'est faux. Il pose des questions
// qui débloquent les souvenirs d'expériences informelles.
//
// Le prompt est conçu pour que Claude extraise des expériences du
// resume_suivi ET guide la conversation pour en débusquer d'autres.
// ============================================================================

const CV_EXTRACTION_SYSTEM_PROMPT = `Tu es un conseiller emploi spécialisé dans l'accompagnement de jeunes de 16-25 ans qui pensent n'avoir aucune expérience.

CONTEXTE : Tu aides à construire un CV. Le jeune pense souvent n'avoir "rien à mettre" mais en réalité il a :
- Des stages (même courts, même en 3ème)
- Des jobs d'été, extras, missions ponctuelles
- Du bénévolat, de l'entraide communautaire
- Des petits boulots non déclarés (livraison, aide déménagement, babysitting)
- Des compétences acquises en structure (foyer, ASE, formation)
- Des projets personnels (sport, cuisine, musique, bricolage)
- De l'aide informelle (traduction, accompagnement de pairs, médiation)

TON RÔLE : À partir des notes du mentor (resume_suivi) et du profil du jeune,
1. EXTRAIRE les expériences déjà mentionnées (même entre les lignes)
2. IDENTIFIER les trous à creuser
3. GÉNÉRER la prochaine question à poser (UNE SEULE, en tutoiement, format WhatsApp)

La question doit être :
- Concrète (pas "as-tu des expériences ?")
- Décomplexante ("même si c'était pas un vrai travail")
- Ciblée sur un domaine probable vu le profil

Exemples de bonnes questions :
- "Tu m'as dit que tu voulais bosser dans la restauration. T'as déjà aidé en cuisine quelque part, même chez toi ou pour un repas collectif ?"
- "Pendant ton stage de 3ème, tu faisais quoi exactement ? C'était où ?"
- "Je vois que tu parles wolof et français. T'as déjà aidé à traduire pour des gens autour de toi ?"
- "Au foyer, t'avais des responsabilités ? Genre aider les plus jeunes, ranger, organiser des trucs ?"

Réponds en JSON :
{
  "experiences_extraites": [
    {
      "titre": "...",
      "lieu": "...",
      "dates": "...",
      "description": "...",
      "source": "resume_suivi" ou "inference",
      "confidence": 0.0-1.0
    }
  ],
  "next_question": "...",
  "question_target": "stage" | "job" | "benevole" | "competence" | "formation" | "interet",
  "enough_for_cv": false
}`;

// ============================================================================
// ÉTAPE 3 : Les questions de collecte (état machine)
// ============================================================================
//
// Après l'extraction IA, Koda pose des questions ciblées.
// Maximum 5-7 questions au total. Pas plus.
//
// Ordre de priorité :
// 1. Expériences pro/stages (LE plus important)
// 2. Formation(s) passée(s) si on n'a que la classe actuelle
// 3. Langues parlées (si MNA)
// 4. Centres d'intérêt (rapide, 1 question)
// 5. Email (si manquant — nécessaire sur un CV)
//
// ============================================================================

const CV_QUESTIONS_FLOW = [
  {
    id: 'experiences_1',
    target: 'experiences',
    // La question est générée dynamiquement par l'IA
    // en fonction du resume_suivi
    generated: true,
    required: true
  },
  {
    id: 'experiences_2',
    target: 'experiences',
    question: "Et sinon, t'as déjà fait un stage ? Même un stage de 3ème ça compte. Ou un petit boulot, livraison, aide quelque part ?",
    required: true,
    skip_if: (data) => data.experiences.length >= 2
  },
  {
    id: 'experiences_3',
    target: 'experiences',
    question: "Dernière question sur les expériences : au quotidien, tu fais des trucs qui montrent des compétences ? Du sport en club, de la cuisine, t'aides des gens autour de toi, tu répares des trucs ?",
    required: false,
    skip_if: (data) => data.experiences.length >= 3
  },
  {
    id: 'formation_details',
    target: 'formations',
    question: "Tu es en {classe}. C'est dans quel lycée / centre de formation ? Et t'as fait quoi avant ?",
    required: true
  },
  {
    id: 'langues',
    target: 'langues',
    question: "À part le français, tu parles d'autres langues ? Même si c'est juste à l'oral.",
    required: true,
    skip_if: (data) => data.langues.length >= 2
  },
  {
    id: 'email',
    target: 'email',
    question: "Pour le CV il me faut ton email. T'en as un ? Sinon on peut en créer un vite fait.",
    required: true,
    skip_if: (data) => !!data.email
  },
  {
    id: 'centres_interet',
    target: 'centres_interet',
    question: "Et pour finir : qu'est-ce que t'aimes faire quand t'as du temps libre ? Sport, musique, jeux, cuisine... ?",
    required: false
  }
];

// ============================================================================
// ÉTAPE 4 : Génération du CV (Claude Sonnet)
// ============================================================================

const CV_GENERATION_PROMPT = `Tu es un expert en rédaction de CV pour jeunes en insertion professionnelle.

À partir des données ci-dessous, génère un CV professionnel au format JSON.

RÈGLES ABSOLUES :
- Ne JAMAIS mentionner ASE, MNA, foyer, placement, aide sociale
- Ne JAMAIS inventer d'expérience ou de compétence
- Valoriser sans mentir : reformuler positivement les expériences réelles
- "J'ai aidé à traduire" → "Médiation linguistique et accompagnement de publics allophones"
- "J'ai fait des livraisons" → "Livraison et relation client (auto-entrepreneur)"
- "Stage de 3ème en boulangerie" → "Stage découverte — Boulangerie [Nom], [Ville]"
- Accroche personnalisée selon le poste visé
- Maximum 1 page (pas trop de contenu si peu d'expérience — mieux vaut peu et bien)
- Les dates peuvent être approximatives ("2024", "Été 2025")

Format JSON attendu :
{
  "prenom_nom": "...",
  "titre": "...",
  "contact": { "tel": "...", "email": "...", "ville": "..." },
  "profil": "... (2-3 lignes max, accroche pro)",
  "experiences": [
    { "poste": "...", "lieu": "...", "dates": "...", "description": "... (1-2 lignes)" }
  ],
  "formations": [
    { "diplome": "...", "lieu": "...", "dates": "..." }
  ],
  "competences": ["...", "..."],
  "langues": [{ "langue": "...", "niveau": "..." }],
  "centres_interet": ["..."],
  "disponibilite": "..."
}`;

module.exports = {
  analyzeCVReadiness,
  CV_EXTRACTION_SYSTEM_PROMPT,
  CV_QUESTIONS_FLOW,
  CV_GENERATION_PROMPT
};
