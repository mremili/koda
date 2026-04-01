// ============================================================================
// 📝 PREPARER PROMPT IA — n8n Code node v2
// ============================================================================

const data = $input.first().json;
const jeune = data.jeune;
const offres = data.offres;
const recruteurs = data.recruteurs;
const debug = data.debug;

if (offres.length === 0 && recruteurs.length === 0) {
  return [{ json: { skip: true, jeune_prenom: jeune.prenom, queries: [] } }];
}

const offresList = offres.map((o, i) =>
  `${i+1}. [${o.source}] ${o.titre} | ${o.entreprise} | ${o.lieu} | ${o.type_contrat} | Score: ${o.score}`
).join('\n');

const recruteursList = recruteurs.map((r, i) =>
  `${i+1}. ${r.entreprise} | ${r.lieu} | ${r.opco || 'OPCO inconnu'} | ${r.telephone || 'Pas de tel'} | Score: ${r.score}`
).join('\n');

const prompt = `Tu es un conseiller insertion spécialisé jeunes vulnérables (ASE/MNA). Analyse ce matching et sélectionne les meilleures opportunités.

PROFIL DU JEUNE :
- Prénom : ${jeune.prenom}
- Classe : ${jeune.classe || 'Non précisé'}
- Français : ${jeune.niveau_francais_declare || 'Non précisé'}
- MNA : ${jeune.mna ? 'Oui' : 'Non'}
- Secteur visé : ${jeune.secteurs_interet}
- Disponibilité : ${jeune.disponibilite}
- Besoins : ${jeune.besoins}
- Skills inférées : ${jeune.skills_inferees || 'Aucune'}
- Ce qu'il/elle dit : "${(jeune.attentes_mentor || '').substring(0, 500)}"

OFFRES D'EMPLOI (${debug.nb_ft} FT + ${debug.nb_lba_jobs} LBA, top ${offres.length} après scoring) :
${offresList || 'Aucune offre'}

RECRUTEURS MARCHÉ CACHÉ (${debug.nb_lba_recruteurs} identifiés, top ${recruteurs.length} après scoring) :
${recruteursList || 'Aucun recruteur'}

RÈGLES :
- Sélectionne max 3 offres et max 2 recruteurs (ou moins si peu pertinents)
- Élimine les incohérences (intérim 5j pour quelqu'un qui veut un CDI, offre trop en dessous du niveau, etc.)
- Pour chaque sélection, écris un message court et motivant en tutoiement pour le jeune (1 phrase)
- Pour les recruteurs, explique pourquoi une candidature spontanée a du sens

Réponds UNIQUEMENT en JSON valide, sans markdown :
{"offres":[{"rang":1,"message":"...","raison":"..."}],"recruteurs":[{"rang":1,"message":"...","raison":"..."}]}`;

return [{ json: { prompt, jeune, offres, recruteurs, debug } }];
