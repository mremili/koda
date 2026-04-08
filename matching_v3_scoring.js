// ============================================================================
// 🎯 SCORING v3 — Offres FT + Jobs LBA + Recruteurs LBA
// Compatible n8n Code node v2
// ============================================================================

const ftData = $('📡 Appel France Travail').first().json;
const lbaData = $('📡 Appel Bonne Alternance').first().json;
const jeuneData = $('🔁 Un jeune à la fois').first().json;
const jeune = jeuneData.jeune;

const freinLangue = jeuneData.frein_langue || false;
const romesOriginaux = (jeune.codes_rome_suggeres || '').split(',').map(r => r.trim());
const romesElargis = jeuneData.romes_elargis || romesOriginaux;
const deptJeune = (jeune.departement || '').trim();
const dispo = (jeune.disponibilite || '').toLowerCase();
const attentes = (jeune.attentes_mentor || '').toLowerCase();
const besoinsStr = (jeune.besoins || '').toLowerCase();

const veutCDI = besoinsStr.includes('cdd') || besoinsStr.includes('cdi') || attentes.includes('cdi');
const veutAlternance = besoinsStr.includes('alternance') || dispo.includes('alternance');
const veutStage = besoinsStr.includes('stage') || dispo.includes('stage');
const dispoImmediate = dispo.includes('immédiate') || dispo.includes('immediate');
const dispoApres = dispo.includes('après') || dispo.includes('rentrée') || dispo.includes('septembre');

const motsCles = attentes.split(/[\s,;.!?]+/).filter(m => m.length > 4);

const PETITE_COURONNE = ['75','92','93','94'];
const IDF = ['75','92','93','94','77','78','91','95'];

// ============================================================================
// SCORING OFFRES (France Travail + LBA Jobs)
// ============================================================================

function scoreOffre(offre, source) {
  let score = 0;
  const detail = {};

  // 1. ROME (25 pts)
  const romeOffre = source === 'FT' ? (offre.romeCode || '') : '';
  if (source === 'FT') {
    if (romesOriginaux.includes(romeOffre)) { score += 25; detail.rome = 25; }
    else if (romesElargis.includes(romeOffre)) { score += 15; detail.rome = 15; }
    else { detail.rome = 0; }
  } else { score += 20; detail.rome = 20; }

  // 2. Débutant (20 pts)
  if (source === 'FT') {
    const deb = offre.experienceExige === 'D' || offre.experienceExige === 'S';
    if (deb) { score += 20; detail.debutant = 20; } else { detail.debutant = 0; }
  } else { score += 20; detail.debutant = 20; }

  // 3. Géo (15 pts)
  if (source === 'FT') {
    const deptOffre = (offre.lieuTravail?.codePostal || '').substring(0, 2);
    if (deptOffre === deptJeune) { score += 15; detail.geo = 15; }
    else if (PETITE_COURONNE.includes(deptOffre) && PETITE_COURONNE.includes(deptJeune)) { score += 10; detail.geo = 10; }
    else if (IDF.includes(deptOffre) && IDF.includes(deptJeune)) { score += 5; detail.geo = 5; }
    else { detail.geo = 0; }
  } else { score += 12; detail.geo = 12; }

  // 4. Langue (10 pts)
  if (freinLangue) {
    if (source === 'FT') {
      if ((offre.langues || []).length === 0) { score += 10; detail.langue = 10; } else { detail.langue = 0; }
    } else { score += 8; detail.langue = 8; }
  } else { score += 10; detail.langue = 10; }

  // 5. Permis (5 pts)
  if (source === 'FT') {
    if ((offre.permis || []).length === 0) { score += 5; detail.permis = 5; } else { detail.permis = 0; }
  } else { score += 5; detail.permis = 5; }

  // 6. Type contrat (10 / -10)
  if (source === 'FT') {
    const contrat = (offre.typeContratLibelle || offre.typeContrat || '').toLowerCase();
    const estInterim = contrat.includes('intérim') || contrat.includes('interim');
    const estCDI = contrat.includes('cdi');
    const estCDD = contrat.includes('cdd');
    if (veutCDI && estCDI) { score += 10; detail.contrat = 10; }
    else if (veutCDI && estCDD) { score += 3; detail.contrat = 3; }
    else if (veutCDI && estInterim) { score -= 10; detail.contrat = -10; }
    else if (veutAlternance && offre.alternance) { score += 10; detail.contrat = 10; }
    else if (veutStage) { score += 5; detail.contrat = 5; }
    else { detail.contrat = 0; }
  } else {
    if (veutAlternance) { score += 10; detail.contrat = 10; }
    else { score += 3; detail.contrat = 3; }
  }

  // 7. Sémantique (10 pts)
  const titreLC = (source === 'FT' ? (offre.intitule || '') : (offre.offer?.title || '')).toLowerCase();
  const matchMots = motsCles.filter(m => titreLC.includes(m));
  if (matchMots.length >= 2) { score += 10; detail.semantique = 10; }
  else if (matchMots.length === 1) { score += 5; detail.semantique = 5; }
  else { detail.semantique = 0; }

  // 8. Entreprise nommée (3 pts)
  const entreprise = source === 'FT' ? (offre.entreprise?.nom || '') : (offre.workplace?.name || '');
  if (entreprise && entreprise !== 'Non communiqué' && entreprise.length > 2) { score += 3; detail.entreprise_nommee = 3; }
  else { detail.entreprise_nommee = 0; }

  // 9. Temporalité (malus -15)
  if (dispoApres && !dispoImmediate && source === 'FT') {
    const c = (offre.typeContratLibelle || '').toLowerCase();
    if (c.includes('jour') || (c.includes('1 mois') && !c.includes('10')) || c.includes('5 jour')) {
      score -= 15; detail.temporalite = -15;
    } else { detail.temporalite = 0; }
  } else { detail.temporalite = 0; }

  return { score: Math.max(0, score), detail };
}

// ============================================================================
// SCORING RECRUTEURS LBA (marché caché)
// ============================================================================

function scoreRecruteur(r) {
  let score = 0;
  const detail = {};

  // Géo (30 pts)
  const deptR = (r.workplace?.location?.zipCode || '').substring(0, 2);
  if (deptR && deptR === deptJeune) { score += 30; detail.geo = 30; }
  else if (PETITE_COURONNE.includes(deptR) && PETITE_COURONNE.includes(deptJeune)) { score += 20; detail.geo = 20; }
  else if (IDF.includes(deptR) && IDF.includes(deptJeune)) { score += 12; detail.geo = 12; }
  else { detail.geo = 0; }

  // Taille PME (20 pts)
  const tailleScore = {'0-0':5,'1-2':10,'3-5':15,'6-9':20,'10-19':20,'20-49':18,'50-99':15,'100-199':12,'200-249':10,'250+':8};
  const pts = tailleScore[r.workplace?.size || ''] || 8;
  score += pts; detail.taille = pts;

  // OPCO (15 pts)
  const opco = r.workplace?.domain?.opco || '';
  if (opco && opco.length > 1) { score += 15; detail.opco = 15; } else { detail.opco = 0; }

  // Contact (15 pts)
  const phone = r.apply?.phone || '';
  const url = r.apply?.url || '';
  const rid = r.apply?.recipient_id || '';
  if (phone && phone.length >= 10) { score += 15; detail.contact = 15; }
  else if (url && url.startsWith('http')) { score += 10; detail.contact = 10; }
  else if (rid) { score += 8; detail.contact = 8; }
  else { detail.contact = 0; }

  // Nom (10 pts)
  const nom = r.workplace?.name || r.workplace?.legal_name || r.workplace?.brand || '';
  if (nom && nom.length > 2 && !nom.toLowerCase().includes('non communiqu')) { score += 10; detail.nom = 10; }
  else { detail.nom = 0; }

  // NAF (5 pts)
  if ((r.workplace?.domain?.naf?.code || '').length >= 2) { score += 5; detail.naf = 5; } else { detail.naf = 0; }

  // SIRET (5 pts)
  if ((r.workplace?.siret || '').length >= 14) { score += 5; detail.siret = 5; } else { detail.siret = 0; }

  return { score: Math.min(100, Math.max(0, score)), detail };
}

// ============================================================================
// SCORER TOUT
// ============================================================================

const offresFT = (ftData.resultats || []).map(o => {
  const { score, detail } = scoreOffre(o, 'FT');
  return {
    source: 'France Travail', offre_id: o.id, titre: o.intitule,
    entreprise: o.entreprise?.nom || 'Non communiqué',
    lieu: o.lieuTravail?.libelle || '',
    departement_offre: (o.lieuTravail?.codePostal || '').substring(0, 2),
    type_contrat: o.typeContratLibelle || o.typeContrat || '',
    est_alternance: o.alternance === true,
    debutant_accepte: o.experienceExige === 'D',
    url_offre: o.origineOffre?.urlOrigine || `https://candidat.francetravail.fr/offres/recherche/detail/${o.id}`,
    score, score_detail: detail
  };
});

const jobsLBA = (lbaData.jobs || []).map(j => {
  const { score, detail } = scoreOffre(j, 'LBA');
  return {
    source: 'La Bonne Alternance', offre_id: j.identifier?.partner_job_id || j.identifier?.id || '',
    titre: j.offer?.title || '', entreprise: j.workplace?.name || 'Non communiqué',
    lieu: j.workplace?.location?.city || '', departement_offre: '',
    type_contrat: (j.contract?.type || []).join(', '),
    est_alternance: true, debutant_accepte: true,
    url_offre: j.apply?.url || '', score, score_detail: detail
  };
});

const recruteursLBA = (lbaData.recruiters || []).map(r => {
  const { score, detail } = scoreRecruteur(r);
  return {
    source: 'LBA Recruteur', offre_id: r.identifier?.id || '',
    titre: `Candidature spontanée - ${r.workplace?.domain?.naf?.label || r.workplace?.name || 'Entreprise'}`,
    entreprise: r.workplace?.name || r.workplace?.legal_name || 'Non communiqué',
    lieu: r.workplace?.location?.city || '',
    departement_offre: (r.workplace?.location?.zipCode || '').substring(0, 2),
    type_contrat: 'Alternance (spontanée)', est_alternance: true, debutant_accepte: true,
    url_offre: r.apply?.url || '', score, score_detail: detail,
    telephone: r.apply?.phone || '', opco: r.workplace?.domain?.opco || ''
  };
});

const topOffres = [...offresFT, ...jobsLBA].filter(o => o.score >= 55 && o.offre_id).sort((a, b) => b.score - a.score).slice(0, 10);
const topRecruteurs = recruteursLBA.filter(r => r.score >= 40 && r.offre_id).sort((a, b) => b.score - a.score).slice(0, 5);

return [{ json: {
  jeune, offres: topOffres, recruteurs: topRecruteurs,
  debug: { nb_ft: (ftData.resultats || []).length, nb_lba_jobs: (lbaData.jobs || []).length, nb_lba_recruteurs: (lbaData.recruiters || []).length, nb_offres_apres_score: topOffres.length, nb_recruteurs_apres_score: topRecruteurs.length }
}}];
