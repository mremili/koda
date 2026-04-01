// ============================================================================
// KODA MOTEUR DE MATCHING v3 — BLOCS DE CODE n8n
// ============================================================================
// Deux blocs :
//   BLOC A — Requete SQL pour le noeud Postgres '📋 Lire jeunes éligibles'
//   BLOC B — Code JS pour le noeud Code v2 '⚙️ Construire requêtes par jeune'
// ============================================================================


// ############################################################################
// BLOC A — REQUETE SQL ENRICHIE (noeud '📋 Lire jeunes éligibles')
// ############################################################################
//
// A coller dans le champ "Query" du noeud Postgres n8n.
// La requete :
//   1. Selectionne les jeunes eligibles
//   2. Joint les skills inferees depuis koda_inference_skills (classe + secteur_vise)
//   3. Pour les MNA, joint aussi les skills MNA specifiques
//   4. Agregre tout en un champ texte skills_inferees
// ############################################################################

const BLOC_A_SQL = `
SELECT
  j.airtable_id,
  j.prenom,
  j.codes_rome_suggeres,
  j.departement,
  j.ville,
  j.niveau_francais_declare,
  j.classe,
  j.disponibilite,
  j.secteurs_interet,
  j.besoins,
  j.attentes_mentor,
  j.mna,
  j.secteur_vise,
  COALESCE(
    STRING_AGG(DISTINCT sk.skill, ', ' ORDER BY sk.skill),
    ''
  ) AS skills_inferees
FROM jeunes j
LEFT JOIN koda_inference_skills sk
  ON sk.classe = j.classe
  AND sk.secteur = j.secteur_vise
  AND sk.type_skill = 'general'
LEFT JOIN koda_inference_skills sk_mna
  ON j.mna = true
  AND sk_mna.type_skill = 'mna'
  AND sk_mna.secteur = j.secteur_vise
WHERE j.enrichi_par_ia = true
  AND j.pret_a_postuler = true
  AND j.codes_rome_suggeres IS NOT NULL
  AND j.situation_actuelle NOT LIKE '%Déjà en%'
  AND j.situation_actuelle NOT LIKE '%décroché%'
  AND j.situation_actuelle NOT LIKE '%trouvé%'
GROUP BY
  j.airtable_id,
  j.prenom,
  j.codes_rome_suggeres,
  j.departement,
  j.ville,
  j.niveau_francais_declare,
  j.classe,
  j.disponibilite,
  j.secteurs_interet,
  j.besoins,
  j.attentes_mentor,
  j.mna,
  j.secteur_vise
`;

// Note : le STRING_AGG ci-dessus combine les skills generales ET les skills MNA
// (grace au LEFT JOIN sur sk_mna). Si le jeune n'est pas MNA, sk_mna ne matche
// rien et seules les skills generales sont incluses.
//
// CORRECTION : pour inclure les skills MNA dans l'agregation, il faut les unifier.
// Version corrigee avec UNION dans une sous-requete :

const BLOC_A_SQL_FINAL = `
WITH skills_jeune AS (
  -- Skills generales basees sur classe + secteur_vise
  SELECT j.airtable_id, sk.skill
  FROM jeunes j
  INNER JOIN koda_inference_skills sk
    ON sk.classe = j.classe
    AND sk.secteur = j.secteur_vise
    AND sk.type_skill = 'general'
  WHERE j.enrichi_par_ia = true
    AND j.pret_a_postuler = true
    AND j.codes_rome_suggeres IS NOT NULL
    AND j.situation_actuelle NOT LIKE '%Déjà en%'
    AND j.situation_actuelle NOT LIKE '%décroché%'
    AND j.situation_actuelle NOT LIKE '%trouvé%'

  UNION

  -- Skills MNA specifiques (uniquement pour les jeunes MNA)
  SELECT j.airtable_id, sk.skill
  FROM jeunes j
  INNER JOIN koda_inference_skills sk
    ON sk.type_skill = 'mna'
    AND sk.secteur = j.secteur_vise
  WHERE j.mna = true
    AND j.enrichi_par_ia = true
    AND j.pret_a_postuler = true
    AND j.codes_rome_suggeres IS NOT NULL
    AND j.situation_actuelle NOT LIKE '%Déjà en%'
    AND j.situation_actuelle NOT LIKE '%décroché%'
    AND j.situation_actuelle NOT LIKE '%trouvé%'
)
SELECT
  j.airtable_id,
  j.prenom,
  j.codes_rome_suggeres,
  j.departement,
  j.ville,
  j.niveau_francais_declare,
  j.classe,
  j.disponibilite,
  j.secteurs_interet,
  j.besoins,
  j.attentes_mentor,
  j.mna,
  j.secteur_vise,
  COALESCE(
    (SELECT STRING_AGG(DISTINCT s.skill, ', ' ORDER BY s.skill)
     FROM skills_jeune s
     WHERE s.airtable_id = j.airtable_id),
    ''
  ) AS skills_inferees
FROM jeunes j
WHERE j.enrichi_par_ia = true
  AND j.pret_a_postuler = true
  AND j.codes_rome_suggeres IS NOT NULL
  AND j.situation_actuelle NOT LIKE '%Déjà en%'
  AND j.situation_actuelle NOT LIKE '%décroché%'
  AND j.situation_actuelle NOT LIKE '%trouvé%'
`;


// ############################################################################
// BLOC B — CODE JS "Construire requêtes par jeune" (noeud Code v2 n8n)
// ############################################################################
//
// A coller dans le champ "JavaScript" du noeud Code v2 n8n.
// Ce code :
//   1. Lit les jeunes, le token FT, et les passerelles
//   2. Elargit les ROME via passerelles (proche / evolution)
//   3. Detecte le frein langue pour les MNA
//   4. Construit les URLs France Travail + La Bonne Alternance
//   5. Retourne un item par jeune avec toutes les infos enrichies
// ############################################################################

// ----- DEBUT DU CODE n8n Code v2 (copier a partir d'ici) -----

// === 1. Lecture des donnees d'entree ===
const jeunes = $('📋 Lire jeunes éligibles').all();
const token = $('🔐 Token France Travail').first().json.access_token;
const passerellesRaw = $('📋 Charger passerelles').all();

// === 2. Indexer les passerelles par rome_source ===
// Structure attendue de chaque passerelle :
//   { rome_source, rome_cible, type } ou type in ('proche', 'evolution', ...)
const passerellesMap = {};
for (const p of passerellesRaw) {
  const src = (p.json.rome_source || '').trim();
  const cible = (p.json.rome_cible || '').trim();
  const type = (p.json.type || '').trim().toLowerCase();
  if (!src || !cible) continue;
  if (type !== 'proche' && type !== 'evolution') continue;
  if (!passerellesMap[src]) passerellesMap[src] = [];
  passerellesMap[src].push(cible);
}

// === 3. Coordonnees par departement ===
const deptCoords = {
  '06': { lat: 43.7102, lon: 7.2620 },
  '13': { lat: 43.2965, lon: 5.3698 },
  '33': { lat: 44.8378, lon: -0.5792 },
  '34': { lat: 43.6110, lon: 3.8767 },
  '35': { lat: 48.1173, lon: -1.6778 },
  '44': { lat: 47.2184, lon: -1.5536 },
  '59': { lat: 50.6292, lon: 3.0573 },
  '69': { lat: 45.7640, lon: 4.8357 },
  '75': { lat: 48.8566, lon: 2.3522 },
  '77': { lat: 48.5272, lon: 2.6987 },
  '78': { lat: 48.8014, lon: 2.1301 },
  '89': { lat: 47.7973, lon: 3.5674 },
  '91': { lat: 48.6293, lon: 2.4396 },
  '92': { lat: 48.8283, lon: 2.2399 },
  '93': { lat: 48.9100, lon: 2.4200 },
  '94': { lat: 48.7904, lon: 2.4753 },
  '95': { lat: 49.0354, lon: 2.0733 }
};

// === 4. Limite max de ROME par jeune ===
const MAX_ROME = 6;

// === 5. Traitement de chaque jeune ===
const results = [];

for (const item of jeunes) {
  const j = item.json;
  const dept = (j.departement || '75').trim();
  const coords = deptCoords[dept] || deptCoords['75'];

  // --- 5a. Parser les codes ROME originaux ---
  const romesOriginaux = (j.codes_rome_suggeres || '')
    .split(',')
    .map(r => r.trim())
    .filter(r => r.length > 0);

  // --- 5b. Elargir avec passerelles si <= 2 ROME ---
  let romesElargis = [...romesOriginaux];

  if (romesOriginaux.length <= 2) {
    const romesPasExpanded = new Set(romesOriginaux);

    for (const rome of romesOriginaux) {
      const cibles = passerellesMap[rome] || [];
      for (const cible of cibles) {
        if (!romesPasExpanded.has(cible)) {
          romesPasExpanded.add(cible);
          romesElargis.push(cible);
        }
      }
    }
  }

  // --- 5c. Limiter a 6 ROME max (originaux prioritaires) ---
  romesElargis = romesElargis.slice(0, MAX_ROME);
  const romesStr = romesElargis.join(',');

  // --- 5d. Detecter le frein langue pour les MNA ---
  let frein_langue = false;
  if (j.mna === true) {
    const niveauFr = (j.niveau_francais_declare || '').toLowerCase();
    if (niveauFr.includes('débutant') || niveauFr.includes('debutant') || niveauFr.includes('non francophone')) {
      frein_langue = true;
    }
  }

  // --- 5e. Construire les URLs ---
  const ft_url = `https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?departement=${dept}&distance=20&codeROME=${romesStr}&range=0-49`;
  const lba_url = `https://api.apprentissage.beta.gouv.fr/api/job/v1/search?latitude=${coords.lat}&longitude=${coords.lon}&radius=25&romes=${romesStr}`;

  // --- 5f. Construire l'output enrichi ---
  results.push({
    json: {
      jeune: {
        airtable_id: j.airtable_id,
        prenom: j.prenom,
        codes_rome_suggeres: j.codes_rome_suggeres,
        departement: j.departement,
        ville: j.ville,
        niveau_francais_declare: j.niveau_francais_declare,
        classe: j.classe,
        disponibilite: j.disponibilite,
        secteurs_interet: j.secteurs_interet,
        besoins: j.besoins,
        attentes_mentor: j.attentes_mentor,
        mna: j.mna,
        secteur_vise: j.secteur_vise,
        skills_inferees: j.skills_inferees || '',
        frein_langue: frein_langue
      },
      romes_originaux: romesOriginaux,
      romes_elargis: romesElargis,
      nb_romes_originaux: romesOriginaux.length,
      nb_romes_elargis: romesElargis.length,
      elargissement_actif: romesOriginaux.length <= 2,
      token: token,
      ft_url: ft_url,
      lba_url: lba_url
    }
  });
}

return results;

// ----- FIN DU CODE n8n Code v2 -----
