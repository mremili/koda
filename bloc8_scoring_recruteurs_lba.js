// ============================================================================
// BLOC 8 -- Scoring des recruteurs LBA (marche cache)
// Compatible n8n Code node v2
// Projet Koda -- Moteur de matching jeunes vulnerables (ASE/MNA)
// ============================================================================
//
// CONTEXTE :
// L'API La Bonne Alternance (/api/job/v1/search) retourne deux arrays :
//   - jobs     : offres publiees (deja scorees par le moteur Koda v2)
//   - recruiters : entreprises a fort potentiel d'embauche SANS offre publiee
//
// Ce code score les "recruiters" (marche cache) et les formate pour insertion
// dans la table koda_matchs avec source = 'LBA Recruteur'.
//
// ============================================================================
// STRUCTURE D'UN OBJET RECRUITER (API LBA)
// ============================================================================
//
// {
//   identifier: {
//     id: string,            // Identifiant unique du recruteur dans LBA
//     partner_label: string  // Ex: "recruteurs_lba"
//   },
//   workplace: {
//     name: string|null,         // Nom commercial (enseigne) ou raison sociale
//     description: string|null,  // Description de l'employeur
//     website: string|null,      // Site web de l'entreprise
//     siret: string|null,        // Numero SIRET (14 chiffres)
//     location: {
//       city: string|null,       // Ville
//       zipCode: string|null,    // Code postal
//       latitude: number|null,
//       longitude: number|null,
//       address: string|null
//     },
//     brand: string|null,        // Enseigne commerciale
//     legal_name: string|null,   // Raison sociale officielle
//     size: string|null,         // Tranche d'effectif ("0-0", "3-5", "6-9",
//                                // "10-19", "20-49", "50-99", "100-199",
//                                // "200-249", "250+")
//     domain: {
//       naf: {
//         code: string|null,     // Code NAF (ex: "43.22A")
//         label: string|null     // Libelle NAF (ex: "Travaux d'installation
//                                //   d'eau et de gaz en tous locaux")
//       },
//       idcc: string|null,       // Numero IDCC convention collective
//       opco: string|null        // Nom de l'OPCO (ex: "CONSTRUCTYS",
//                                //   "OPCO EP", "AKTO", etc.)
//     }
//   },
//   apply: {
//     phone: string|null,        // Telephone de contact
//     url: string|null,          // URL de candidature spontanee LBA
//     recipient_id: string|null  // ID pour soumettre une candidature via
//                                //   l'API apply de LBA
//   }
// }
//
// ============================================================================
// GRILLE DE SCORING RECRUTEURS (0-100 points)
// ============================================================================
//
// | Critere                           | Points | Logique                          |
// |-----------------------------------|--------|----------------------------------|
// | Correspondance geographique       | 0-30   | Meme dept=30, petite couronne=20 |
// | Taille entreprise (PME)           | 0-20   | PME favorisees pour alternants   |
// | OPCO identifie                    | 0-15   | Structure alternance en place    |
// | Entreprise nommee                 | 0-10   | Pas "Non communique"             |
// | Contact disponible (tel ou URL)   | 0-15   | Candidature possible             |
// | NAF/secteur renseigne             | 0-5    | Transparence activite            |
// | SIRET renseigne                   | 0-5    | Entreprise verifiable            |
// ============================================================================

const lbaData = $('Appel Bonne Alternance').first().json;
const jeune = $('Un jeune a la fois').first().json.jeune;

const recruiters = lbaData.recruiters || [];
const deptJeune = (jeune.departement || '').trim();

// Departements de la petite couronne parisienne
const PETITE_COURONNE = ['75', '92', '93', '94'];
// Grande couronne
const GRANDE_COURONNE = ['77', '78', '91', '95'];
// IDF complet
const IDF = [...PETITE_COURONNE, ...GRANDE_COURONNE];

// ============================================================================
// FONCTION DE SCORING
// ============================================================================

function scoreRecruteur(recruiter) {
  let score = 0;
  const detail = {};

  // --- 1. Correspondance geographique (30 pts max) ---
  const cpRecruteur = recruiter.workplace?.location?.zipCode || '';
  const deptRecruteur = cpRecruteur.substring(0, 2);

  if (deptRecruteur && deptRecruteur === deptJeune) {
    // Meme departement : score maximal
    score += 30;
    detail.geo = 30;
  } else if (
    PETITE_COURONNE.includes(deptRecruteur) &&
    PETITE_COURONNE.includes(deptJeune)
  ) {
    // Les deux en petite couronne (Paris/92/93/94 = tres accessible)
    score += 20;
    detail.geo = 20;
  } else if (
    IDF.includes(deptRecruteur) &&
    IDF.includes(deptJeune)
  ) {
    // Les deux en Ile-de-France
    score += 12;
    detail.geo = 12;
  } else if (deptRecruteur) {
    // Departement different hors IDF
    score += 0;
    detail.geo = 0;
  } else {
    // Pas de code postal renseigne
    detail.geo = 0;
  }

  // --- 2. Taille de l'entreprise (20 pts max) ---
  // Les PME (< 50 salaries) sont souvent plus accueillantes pour les
  // alternants : encadrement de proximite, moins de process RH lourd,
  // integration plus facile pour un jeune vulnerable.
  const size = recruiter.workplace?.size || '';
  const tailleScore = {
    '0-0':     5,   // Auto-entrepreneur (risque faible encadrement)
    '1-2':    10,   // Tres petite, peut etre fragile
    '3-5':    15,   // Petite structure, bon encadrement
    '6-9':    20,   // Ideale : taille humaine + stabilite
    '10-19':  20,   // Ideale : taille humaine + stabilite
    '20-49':  18,   // Bonne PME
    '50-99':  15,   // Moyenne entreprise, correcte
    '100-199':12,   // Un peu grande, process plus lourds
    '200-249':10,   // Grande, moins de proximite
    '250+':    8    // Tres grande, parfois bon programme alternance
  };
  const pts_taille = tailleScore[size] || 8; // Defaut si non renseigne
  score += pts_taille;
  detail.taille = pts_taille;

  // --- 3. OPCO identifie (15 pts) ---
  // Si l'OPCO est connu, ca signifie que l'entreprise a une structure
  // d'alternance en place (financement, demarches simplifiees).
  const opco = recruiter.workplace?.domain?.opco || '';
  if (opco && opco.length > 1) {
    score += 15;
    detail.opco = 15;
  } else {
    detail.opco = 0;
  }

  // --- 4. Entreprise nommee (10 pts) ---
  // Une entreprise qui communique son nom est un signal de transparence.
  // "Non communique" ou vide = moins fiable pour un jeune vulnerable.
  const nom = recruiter.workplace?.name || '';
  const raisonSociale = recruiter.workplace?.legal_name || '';
  const enseigne = recruiter.workplace?.brand || '';
  const nomEffectif = nom || raisonSociale || enseigne;

  if (
    nomEffectif &&
    nomEffectif.length > 2 &&
    nomEffectif.toLowerCase() !== 'non communique' &&
    nomEffectif.toLowerCase() !== 'non communiqué'
  ) {
    score += 10;
    detail.nom = 10;
  } else {
    detail.nom = 0;
  }

  // --- 5. Mode de contact disponible (15 pts) ---
  // Crucial : le jeune (ou son educateur) doit pouvoir contacter l'entreprise.
  // Telephone = contact direct = +15
  // URL candidature = +10
  // recipient_id seul (candidature via LBA) = +8
  // Rien = 0
  const phone = recruiter.apply?.phone || '';
  const url = recruiter.apply?.url || '';
  const recipientId = recruiter.apply?.recipient_id || '';

  if (phone && phone.length >= 10) {
    score += 15;
    detail.contact = 15;
  } else if (url && url.startsWith('http')) {
    score += 10;
    detail.contact = 10;
  } else if (recipientId) {
    score += 8;
    detail.contact = 8;
  } else {
    detail.contact = 0;
  }

  // --- 6. NAF/secteur renseigne (5 pts) ---
  const naf = recruiter.workplace?.domain?.naf?.code || '';
  if (naf && naf.length >= 2) {
    score += 5;
    detail.naf = 5;
  } else {
    detail.naf = 0;
  }

  // --- 7. SIRET renseigne (5 pts) ---
  const siret = recruiter.workplace?.siret || '';
  if (siret && siret.length >= 14) {
    score += 5;
    detail.siret = 5;
  } else {
    detail.siret = 0;
  }

  return { score: Math.min(100, Math.max(0, score)), detail };
}

// ============================================================================
// SCORER TOUS LES RECRUTEURS
// ============================================================================

const recruteursScores = recruiters.map(r => {
  const { score, detail } = scoreRecruteur(r);

  return {
    source: 'LBA Recruteur',
    offre_id: r.identifier?.id || '',
    titre: `Candidature spontanee - ${r.workplace?.domain?.naf?.label || r.workplace?.name || 'Entreprise'}`,
    entreprise: r.workplace?.name || r.workplace?.legal_name || r.workplace?.brand || 'Non communique',
    lieu: r.workplace?.location?.city || '',
    departement_offre: (r.workplace?.location?.zipCode || '').substring(0, 2),
    type_contrat: 'Alternance (spontanee)',
    est_alternance: true,
    debutant_accepte: true,  // Marche cache = pas d'exigences publiees
    url_offre: r.apply?.url || '',
    telephone: r.apply?.phone || '',
    recipient_id: r.apply?.recipient_id || '',
    siret: r.workplace?.siret || '',
    effectif: r.workplace?.size || '',
    opco: r.workplace?.domain?.opco || '',
    naf_code: r.workplace?.domain?.naf?.code || '',
    naf_label: r.workplace?.domain?.naf?.label || '',
    score,
    score_detail: detail
  };
});

// ============================================================================
// FILTRER ET TRIER
// ============================================================================

// Seuil minimum : 40/100 (les recruteurs sont deja pre-qualifies par LBA,
// donc un seuil plus bas que pour les offres classiques est acceptable)
const SEUIL_MIN = 40;

const topRecruteurs = recruteursScores
  .filter(r => r.score >= SEUIL_MIN && r.offre_id)
  .sort((a, b) => b.score - a.score)
  .slice(0, 5); // Maximum 5 recruteurs par jeune

// ============================================================================
// FORMATER POUR INSERTION DANS koda_matchs
// ============================================================================

const esc = (v) => {
  if (v === null || v === undefined) return 'NULL';
  return "'" + String(v).replace(/'/g, "''").substring(0, 2000) + "'";
};

const queries = topRecruteurs.map(r => {
  const scoreDetailJson = JSON.stringify(r.score_detail).replace(/'/g, "''");

  const sql = `INSERT INTO koda_matchs (
    jeune_id, source, offre_id, titre, entreprise, lieu,
    departement_offre, type_contrat, est_alternance, debutant_accepte,
    score, score_detail, url_offre, statut
  ) VALUES (
    ${esc(jeune.airtable_id)},
    ${esc(r.source)},
    ${esc(r.offre_id)},
    ${esc(r.titre)},
    ${esc(r.entreprise)},
    ${esc(r.lieu)},
    ${esc(r.departement_offre)},
    ${esc(r.type_contrat)},
    ${r.est_alternance},
    ${r.debutant_accepte},
    ${r.score},
    '${scoreDetailJson}',
    ${esc(r.url_offre)},
    'a_valider'
  ) ON CONFLICT (jeune_id, offre_id) DO UPDATE SET
    score = EXCLUDED.score,
    score_detail = EXCLUDED.score_detail,
    statut = 'a_valider';`;

  return {
    json: {
      query: sql,
      jeune_prenom: jeune.prenom,
      entreprise: r.entreprise,
      ville: r.lieu,
      score: r.score,
      opco: r.opco,
      telephone: r.telephone
    }
  };
});

// ============================================================================
// STATISTIQUES DEBUG
// ============================================================================

const stats = {
  nb_recruteurs_bruts: recruiters.length,
  nb_apres_scoring: topRecruteurs.length,
  nb_filtres: recruteursScores.filter(r => r.score < SEUIL_MIN).length,
  score_moyen: recruteursScores.length > 0
    ? Math.round(recruteursScores.reduce((s, r) => s + r.score, 0) / recruteursScores.length)
    : 0,
  score_max: recruteursScores.length > 0
    ? Math.max(...recruteursScores.map(r => r.score))
    : 0,
  par_tranche_effectif: recruteursScores.reduce((acc, r) => {
    const t = r.effectif || 'Non renseigne';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {}),
  avec_opco: recruteursScores.filter(r => r.opco).length,
  avec_telephone: recruteursScores.filter(r => r.telephone).length
};

// ============================================================================
// SORTIE
// ============================================================================

if (queries.length === 0) {
  return [{
    json: {
      query: null,
      jeune_prenom: jeune.prenom,
      entreprise: 'Aucun recruteur retenu',
      score: 0,
      debug_recruteurs: stats
    }
  }];
}

// Ajouter les stats debug au premier item
if (queries.length > 0) {
  queries[0].json.debug_recruteurs = stats;
}

return queries;
