// ============================================================================
// 📧 KODA AGENT — Prospection employeur par email
// n8n Code node v2
// ============================================================================
//
// LA FACE B DE KODA : démarcher des entreprises pour placer des jeunes.
//
// Comme un chasseur de têtes inversé :
//   "J'ai un jeune motivé en [secteur] sur [ville]. Il est accompagné
//    par l'association Les Ombres. Vous recrutez ?"
//
// Flux :
//   1. Identifier les employeurs cibles (LBA recruteurs, BMO tension)
//   2. Matcher chaque employeur avec 1-3 jeunes pertinents
//   3. Générer un email personnalisé (Claude Sonnet)
//   4. Envoyer via Brevo/SES
//   5. Tracker ouvertures/réponses
//   6. Si positif → lier le jeune à l'employeur → notifier sur WA
//
// Nodes précédents attendus :
//   - '🔍 Employeurs cibles' : liste d'employeurs à démarcher
//   - '👥 Jeunes matchés'    : pour chaque employeur, les jeunes qui collent
// ============================================================================

const employers = $('🔍 Employeurs cibles').all();
const jeunesByEmployer = $('👥 Jeunes matchés').first().json;

// ============================================================================
// System prompt pour la génération d'emails
// ============================================================================

const SYSTEM_PROMPT = `Tu es Koda, l'assistant emploi de l'association Les Ombres.
Les Ombres accompagne des jeunes de 16 à 25 ans (anciens mineurs isolés, jeunes de l'ASE)
vers l'autonomie via le mentorat bénévole.

Tu rédiges des emails de prospection pour proposer des candidat(e)s à des entreprises.

Règles :
- Ton professionnel mais chaleureux, pas corporate
- Email court (max 150 mots)
- Mentionne toujours Les Ombres et l'accompagnement bénévole
- Mets en avant 1-2 qualités concrètes du/des jeune(s)
- Ne révèle JAMAIS le statut ASE/MNA du jeune
- Propose un échange simple (appel de 10 min ou réponse par email)
- Ajoute que Les Ombres peut accompagner les démarches administratives (aide employeur)
- Si c'est de l'alternance, mentionne le coût zéro pour l'entreprise (OPCO)`;

// ============================================================================
// Générer les emails pour chaque employeur
// ============================================================================

const results = [];

for (const employerItem of employers) {
  const emp = employerItem.json;
  const jeunes = jeunesByEmployer[emp.id] || jeunesByEmployer[emp.siret] || [];

  if (jeunes.length === 0) continue;

  // Construire le profil anonymisé des jeunes
  const jeuneProfiles = jeunes.map(j => {
    const age = j.age || '18-25 ans';
    const secteur = j.secteur_vise || j.secteur || 'polyvalent';
    const competences = (j.competences_cles || []).slice(0, 3).join(', ');
    const mobilite = j.ville || j.departement || 'Île-de-France';
    const contrat = j.type_contrat_souhaite || 'ouvert à tout';

    return {
      prenom: j.prenom, // Prénom seulement, pas de nom
      age,
      secteur,
      competences: competences || 'motivé et prêt à apprendre',
      mobilite,
      contrat,
      has_cv: !!(j.cv_url || j.cv_uploaded),
      niveau_francais: j.niveau_francais_declare || 'courant'
    };
  });

  // Prompt pour Claude
  const userPrompt = `Rédige un email de prospection pour cette entreprise :

ENTREPRISE :
- Nom : ${emp.company_name}
- Secteur : ${emp.sector || 'non précisé'}
- Ville : ${emp.city || 'non précisée'}
- Taille : ${emp.size_category || 'non précisée'}
${emp.is_alternance ? '- Recrute en alternance' : ''}
${emp.opco ? `- OPCO : ${emp.opco}` : ''}

CANDIDAT(S) À PROPOSER :
${jeuneProfiles.map((j, i) => `
${i + 1}. ${j.prenom}, ${j.age}
   - Domaine : ${j.secteur}
   - Compétences : ${j.competences}
   - Mobilité : ${j.mobilite}
   - Contrat recherché : ${j.contrat}
   - CV disponible : ${j.has_cv ? 'oui' : 'en cours de préparation'}
`).join('')}

Génère :
1. Un objet de mail accrocheur (max 60 caractères)
2. Le corps de l'email (max 150 mots)

Réponds UNIQUEMENT en JSON :
{
  "subject": "...",
  "body": "..."
}`;

  // Stocker pour envoi à Claude (le noeud HTTP suivant fera l'appel)
  const outreachRecord = {
    employer_id: emp.id,
    employer_name: emp.company_name,
    employer_email: emp.contact_email,
    employer_city: emp.city,
    jeune_ids: jeunes.map(j => j.airtable_id || j.id),
    jeune_prenoms: jeuneProfiles.map(j => j.prenom),
    nb_jeunes: jeunes.length,
    // Pour l'appel Claude
    system_prompt: SYSTEM_PROMPT,
    user_prompt: userPrompt,
    // Pour le SQL après génération
    employer_sector: emp.sector,
    is_alternance: emp.is_alternance
  };

  results.push({ json: outreachRecord });
}

// Si aucun employeur à démarcher
if (results.length === 0) {
  return [{
    json: {
      skip: true,
      message: 'Aucun employeur à démarcher dans ce batch',
      count: 0
    }
  }];
}

return results;
