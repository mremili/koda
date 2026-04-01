# Bloc 8 -- Scoring des recruteurs LBA (marche cache)

> Documentation technique pour le projet Koda
> Date : 2026-04-01

---

## 1. Contexte

L'API La Bonne Alternance (`/api/job/v1/search`) retourne deux arrays dans sa reponse :

- **`jobs`** : offres d'alternance publiees (deja scorees par le moteur Koda v2)
- **`recruiters`** : entreprises identifiees par LBA comme ayant un **fort potentiel d'embauche** en alternance, mais **sans offre publiee** -- c'est le "marche cache"

Ces entreprises sont identifiees par analyse de donnees publiques :
- Donnees de recrutement (DPAE / ACOSS)
- Donnees financieres
- Historique d'embauche en alternance

Le moteur Koda v2 actuel (noeud "Scorer les offres v2") ne traite que les `jobs` et ignore completement les `recruiters`. Le code du Bloc 8 corrige cela.

---

## 2. Structure d'un objet recruiter (API LBA)

```
recruiter
  |-- identifier
  |     |-- id: string              // ID unique dans LBA
  |     |-- partner_label: string   // "recruteurs_lba"
  |
  |-- workplace
  |     |-- name: string|null           // Nom commercial
  |     |-- description: string|null    // Description employeur
  |     |-- website: string|null        // Site web
  |     |-- siret: string|null          // SIRET (14 chiffres)
  |     |-- location
  |     |     |-- city: string|null
  |     |     |-- zipCode: string|null
  |     |     |-- latitude: number|null
  |     |     |-- longitude: number|null
  |     |     |-- address: string|null
  |     |-- brand: string|null          // Enseigne commerciale
  |     |-- legal_name: string|null     // Raison sociale
  |     |-- size: string|null           // Tranche effectif
  |     |-- domain
  |           |-- naf
  |           |     |-- code: string|null   // Code NAF (ex: "43.22A")
  |           |     |-- label: string|null  // Libelle NAF
  |           |-- idcc: string|null         // Convention collective
  |           |-- opco: string|null         // Nom OPCO
  |
  |-- apply
        |-- phone: string|null          // Telephone contact
        |-- url: string|null            // URL candidature spontanee
        |-- recipient_id: string|null   // ID pour API apply LBA
```

### Differences cles avec un objet `job` :

| Aspect | `job` (offre publiee) | `recruiter` (marche cache) |
|--------|----------------------|---------------------------|
| Titre d'offre | Oui (`offer.title`) | Non (pas d'offre) |
| Contrat/duree | Oui (`contract`) | Non |
| Competences | Oui (`offer.desired_skills`) | Non |
| Diplome vise | Oui (`offer.target_diploma`) | Non |
| Codes ROME | Oui (`offer.rome_codes`) | Non |
| Entreprise | Oui | Oui (meme structure `workplace`) |
| Contact | Oui | Oui (meme structure `apply`) |

---

## 3. Grille de scoring recruteurs (0-100 points)

### Philosophie

Les recruteurs du marche cache sont par definition moins qualifies qu'une offre publiee (pas de titre, pas de description, pas de contrat). Le scoring se concentre donc sur :
- La **faisabilite** (le jeune peut-il y aller physiquement ?)
- La **fiabilite** (l'entreprise est-elle identifiable et contactable ?)
- L'**adequation** (PME accueillante, OPCO en place)

### Bareme

| # | Critere | Points | Justification pedagogique |
|---|---------|--------|--------------------------|
| 1 | **Correspondance geographique** | 0-30 | Un jeune ASE/MNA a souvent une mobilite limitee. Le departement est le critere geographique le plus determinant. |
| 2 | **Taille entreprise (PME)** | 0-20 | Les PME de 6-49 salaries offrent un encadrement de proximite crucial pour un jeune vulnerable. Les tres grandes entreprises ont parfois de bons programmes, mais l'integration est plus impersonnelle. |
| 3 | **OPCO identifie** | 0-15 | Si l'OPCO est renseigne, l'entreprise a deja une structure administrative d'alternance. Le financement et les demarches seront simplifies. |
| 4 | **Entreprise nommee** | 0-10 | Transparence = confiance. Un educateur ne proposera pas a un jeune de contacter une entreprise sans nom. |
| 5 | **Contact disponible** | 0-15 | Telephone direct = 15 pts (ideal pour un educateur qui accompagne). URL = 10 pts. recipient_id LBA seul = 8 pts. |
| 6 | **NAF/secteur renseigne** | 0-5 | Permet de verifier la coherence avec le metier vise. |
| 7 | **SIRET renseigne** | 0-5 | Entreprise verifiable sur societe.com ou pappers.fr. |

**Total maximum** : 100 points
**Seuil de retention** : 40 points (inferieur aux 55 pts des offres classiques, car les recruteurs sont deja pre-qualifies par LBA)

### Detail du scoring geographique

| Situation | Points |
|-----------|--------|
| Meme departement | 30 |
| Tous deux en petite couronne (75/92/93/94) | 20 |
| Tous deux en IDF (75-78, 91-95) | 12 |
| Departements differents hors IDF | 0 |

### Detail du scoring par taille

| Tranche effectif | Points | Raison |
|-----------------|--------|--------|
| 6-9 salaries | 20 | Ideal : humain + stable |
| 10-19 salaries | 20 | Ideal : humain + stable |
| 20-49 salaries | 18 | Bonne PME |
| 3-5 salaries | 15 | Petit mais possible |
| 50-99 salaries | 15 | Moyen, correct |
| 100-199 salaries | 12 | Un peu grande |
| 1-2 salaries | 10 | Risque faible encadrement |
| 200-249 salaries | 10 | Grande |
| 250+ salaries | 8 | Tres grande, impersonnel |
| 0-0 / non renseigne | 5-8 | Incertain |

---

## 4. Integration dans le workflow Koda

### 4.1 Ou inserer le code

Le code `bloc8_scoring_recruteurs_lba.js` doit etre integre **apres** le noeud "Appel Bonne Alternance" et **en parallele** du scoring existant, ou bien fusionne dans le noeud "Scorer les offres v2".

**Option A -- Noeud separe (recommandee) :**
```
Appel Bonne Alternance
    |
    +---> Scorer les offres v2  (existant, jobs uniquement)
    |
    +---> Scorer les recruteurs (NOUVEAU, bloc8)
    |
    +---> Merge ---> Preparer prompt IA ---> ...
```

**Option B -- Fusion dans le scorer existant :**
Ajouter le code du bloc 8 a la fin du noeud "Scorer les offres v2", en ajoutant les recruteurs scores a l'array `top10`.

### 4.2 Statut dans koda_matchs

Les recruteurs sont inseres avec `statut = 'a_valider'` (et non `'validee_ia'` comme les offres).
Cela permet a l'educateur ou au conseiller de valider manuellement avant de proposer au jeune.

### 4.3 Adaptation des noms de noeuds

Dans le code JS, les references aux noeuds n8n doivent correspondre aux noms exacts du workflow :
```javascript
// Adapter selon les noms de vos noeuds :
const lbaData = $('📡 Appel Bonne Alternance').first().json;
const jeune = $('🔁 Un jeune à la fois').first().json.jeune;
```

---

## 5. Candidature spontanee via API LBA

L'API LBA offre un endpoint pour transmettre des candidatures directement aux recruteurs.
Chaque recruteur possede un `apply.recipient_id` utilisable pour poster une candidature.

**Endpoint** :
```
POST https://api.apprentissage.beta.gouv.fr/api/application/v1/apply
Authorization: Bearer {token_lba}
Content-Type: application/json

{
  "recipient_id": "{apply.recipient_id}",
  "applicant_first_name": "Prénom",
  "applicant_last_name": "Nom",
  "applicant_email": "email@exemple.com",
  "applicant_phone": "0612345678",
  "message": "Motivation...",
  "applicant_file_content": "base64_du_CV"
}
```

Cela pourrait etre une evolution future de Koda : **automatiser l'envoi de candidatures spontanees** pour les recruteurs les mieux scores.

---

## 6. Limites et ameliorations futures

### Limites actuelles

1. **Pas de matching ROME** : Les recruteurs n'ont pas de `rome_codes` dans leur structure. LBA les retourne deja filtres par ROME via la requete de recherche, mais on ne peut pas verifier le match ROME cote scoring.
2. **Pas de description de poste** : Impossible de faire du matching semantique (attentes du jeune vs contenu du poste).
3. **Donnees de taille parfois absentes** : Le champ `size` n'est pas toujours renseigne.

### Ameliorations possibles

1. **Enrichissement SIRET** : Appeler l'API Entreprises (api.gouv.fr) pour enrichir les donnees (effectif reel, date de creation, CA).
2. **Historique d'alternance** : Verifier via les donnees DARES si l'entreprise a deja eu des alternants.
3. **Scoring geographique fin** : Utiliser les coordonnees lat/lon pour calculer la distance reelle (et non juste le departement).
4. **Bonus tension metier** : Croiser avec les donnees BMO (bloc 5) pour booster les recruteurs dans des secteurs en tension.
5. **Feedback loop** : Ajuster les poids du scoring en fonction du taux de reponse reel des recruteurs contactes.

---

## 7. Sources

- API La Bonne Alternance : https://api.apprentissage.beta.gouv.fr/fr/explorer/recherche-offre
- Documentation API LBA : https://aide.cfas.apprentissage.beta.gouv.fr/fr/article/documentation-de-lapi-s75km7/
- Page LBA data.gouv.fr : https://www.data.gouv.fr/dataservices/api-la-bonne-alternance
- Swagger JSON LBA : https://labonnealternance.apprentissage.beta.gouv.fr/api-docs/swagger.json
- Code existant Koda (moteur scoring v2) : /home/user/koda/Koda - Moteur de Matching v1.json
- Code existant Koda (formateur LBA) : /home/user/koda/France Travail - Offres + Bonne Boite v4.json
