# Bloc 5 -- API BMO / Tension Metier (France Travail)

> Recherche technique pour le projet Koda
> Date : 2026-04-01

---

## 1. Vue d'ensemble : quelles APIs disponibles ?

France Travail expose deux systemes complementaires pour acceder aux donnees de tension metier :

| API | URL Page | Base URL | Statut |
|-----|----------|----------|--------|
| **API Infotravail v1** (legacy, ex-Pole Emploi) | https://francetravail.io/data/api/infotravail | `https://api.francetravail.io/partenaire/infotravail/v1/` | Active, donnees CKAN |
| **API Marche du Travail** (nouvelle) | https://francetravail.io/data/api/marche-travail | `https://api.francetravail.io/partenaire/marche-travail/v1/` | Active, donnees croisees |

En complement, les **donnees BMO brutes** sont disponibles en open data sur data.gouv.fr (format XLSX, pas d'API directe).

---

## 2. API Infotravail v1 -- Documentation technique

### 2.1 Authentification

Meme mecanisme OAuth2 que l'API Offres d'emploi deja utilisee dans Koda :

```
POST https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=PAR_1jeuneconfie1emploi_...
&client_secret=4483b167...
&scope=api_infotravail
```

**Scope requis** : `api_infotravail`
(a ajouter dans les parametres de l'application sur francetravail.io, en plus du scope `api_offresdemploiv2 o2dsoffre` deja configure)

### 2.2 Architecture de l'API

L'API Infotravail repose sur le systeme CKAN. Elle expose 6 jeux de donnees :

1. **Referentiel ROME** (mise a jour trimestrielle)
2. **Statistiques du Marche du Travail** (mise a jour mensuelle)
3. **Informations sur le Marche du Travail (IMT)** (mise a jour hebdomadaire) -- contient les indicateurs de tension
4. **Enquete BMO** (mise a jour annuelle) -- besoins en main-d'oeuvre
5. **Offres d'emploi anonymisees** (mise a jour quotidienne)
6. **Referentiel des Agences** (mise a jour hebdomadaire)

### 2.3 Endpoints principaux

**Lister les ressources d'un dataset :**
```
GET https://api.francetravail.io/partenaire/infotravail/v1/resource_show?id={resource_id}
Authorization: Bearer {token}
```

**Recherche dans un datastore (parametres) :**
```
GET https://api.francetravail.io/partenaire/infotravail/v1/datastore_search?id={resource_id}&limit=100
Authorization: Bearer {token}
```

**Recherche SQL (plus flexible) :**
```
GET https://api.francetravail.io/partenaire/infotravail/v1/datastore_search_sql?sql={requete_sql}
Authorization: Bearer {token}
```

### 2.4 Endpoint BMO -- Enquete Besoins en Main-d'Oeuvre

**Resource ID BMO** : `6c74b2b7-8ec5-474a-8706-1069670c2035`

**Exemple de requete :**
```
GET https://api.francetravail.io/partenaire/infotravail/v1/datastore_search_sql?sql=SELECT * FROM "6c74b2b7-8ec5-474a-8706-1069670c2035" WHERE "ROME_PROFESSION_CARD_CODE" LIKE 'F1603' AND "CATCHMENT_AREA_CODE" LIKE '1101'
Authorization: Bearer {token}
```

**Champs retournes (dataset BMO) :**

| Champ | Description |
|-------|-------------|
| `ROME_PROFESSION_CARD_CODE` | Code FAP2021 du metier (attention : PAS un code ROME direct, c'est un code FAP) |
| `ROME_PROFESSION_CARD_LABEL` | Libelle du metier (ex: "Ouvriers qualifies de la plomberie, du chauffage") |
| `CATCHMENT_AREA_CODE` | Code du bassin d'emploi |
| `CATCHMENT_AREA_LABEL` | Libelle du bassin d'emploi |
| `DEPARTMENT_CODE` | Code departement (ex: "75") |
| `REGION_CODE` | Code region |
| `YEAR` | Annee de l'enquete |
| `TOTAL_HIRING_PROJECTS` | Nombre total de projets d'embauche |
| `DIFFICULT_HIRING_PROJECTS` | Nombre de projets juges difficiles |
| `DIFFICULTY_RATIO` | Ratio de difficulte (0 a 100) -- **c'est l'indicateur de tension BMO** |
| `SEASONAL_HIRING_PROJECTS` | Projets d'embauche saisonniers |

### 2.5 Endpoint IMT -- Informations sur le Marche du Travail

Le dataset IMT contient des sous-ressources :

| Sous-ressource | Description |
|----------------|-------------|
| **Statistiques offres/demandes** | Ratio offres vs demandeurs par ROME et zone |
| **Salaires pratiques** | Fourchettes de salaire par metier et region |
| **Difficultes de recrutement** | Indicateur de tension par metier |
| **Canaux de reprise d'emploi** | Statistiques sur les modes de retour a l'emploi |

**Exemple pour les statistiques offres/demandes :**
```
GET https://api.francetravail.io/partenaire/infotravail/v1/datastore_search_sql?sql=SELECT * FROM "{resource_id_imt}" WHERE "ROME_CODE" = 'F1603' AND "DEPARTMENT_CODE" = '75'
Authorization: Bearer {token}
```

> **Note** : Les resource_id pour les sous-datasets IMT changent avec les mises a jour. 
> Il faut d'abord lister les ressources disponibles via `resource_show` ou `package_show`.

---

## 3. API Marche du Travail (nouvelle API)

### 3.1 Description

L'API "Offre et demande Marche du travail" est la version modernisee. Elle croise des donnees de :
- **France Travail** (offres, demandeurs)
- **ACOSS** (declarations d'embauche)
- **CCMSA** (secteur agricole)
- **DARES** (etudes statistiques)

### 3.2 Indicateurs disponibles

| Indicateur | Description | Frequence |
|-----------|-------------|-----------|
| **Indicateur composite de tension** | 1 score global combinant 6 sous-indicateurs | Trimestriel |
| **Difficultes de recrutement** | Perspective des metiers, secteurs et competences en tension | Trimestriel |
| **Dynamisme du territoire** | IA prospective mesurant le dynamisme anticipe des effectifs salaries | Trimestriel |
| **Salaires proposes** | Fourchettes de remuneration par metier | Trimestriel |

### 3.3 Les 6 sous-indicateurs de tension (DARES / France Travail)

1. **Intensite de l'embauche** : Rapport entre les flux d'embauche et le stock d'emploi
2. **Conditions de travail contraignantes** : Part des emplois a horaires decales, penibilite
3. **Manque de main-d'oeuvre disponible** : Ratio demandeurs / offres
4. **Inadequation geographique** : Desequilibre localisation offres vs demandeurs
5. **Lien formation-emploi** : Adequation entre les formations et les besoins
6. **Non-durabilite de l'emploi** : Part des contrats courts

### 3.4 Authentification

Meme systeme OAuth2, scope probablement `api_marche-travail` ou similar (a confirmer lors de la souscription sur francetravail.io).

### 3.5 Swagger

Documentation Swagger accessible (apres authentification) a :
```
https://francetravail.io/data/api/259/swagger
```

---

## 4. Donnees BMO en Open Data (alternative sans API)

### 4.1 Dataset data.gouv.fr

**URL** : https://www.data.gouv.fr/datasets/enquete-besoins-en-main-doeuvre-bmo

- **Format** : XLSX (11 ressources, de 2015 a 2025)
- **Couverture** : Par bassin d'emploi, departement et region
- **Nomenclature** : FAP2021 (Familles Professionnelles), PAS directement en code ROME
- **Frequence** : Annuelle

### 4.2 Correspondance FAP -> ROME

Les donnees BMO utilisent la nomenclature FAP2021, pas le ROME directement.
Il existe une table de correspondance FAP <-> PCS <-> ROME publiee par la DARES.

Exemple :
- FAP `B2Z40` (Ouvriers qualifies de la plomberie) correspond au ROME `F1603` (Installation d'equipements sanitaires et thermiques)
- Il faut une table de mapping pour convertir

### 4.3 Statistiques BMO en ligne

Le site https://statistiques.francetravail.org/bmo propose une interface de visualisation directe des donnees BMO par departement et metier, sans passer par l'API.

---

## 5. Exemple concret : Tension pour F1603 (Plomberie) dans le 75

### 5.1 Via API Infotravail (BMO)

```javascript
// Dans un n8n Code node
// Prerequis : token OAuth2 avec scope api_infotravail

const token = $('Token France Travail').first().json.access_token;

// Le code FAP pour la plomberie est B2Z40 (pas le ROME F1603 directement)
const sql = `SELECT * FROM "6c74b2b7-8ec5-474a-8706-1069670c2035" WHERE "ROME_PROFESSION_CARD_CODE" LIKE 'B2Z40' AND "DEPARTMENT_CODE" = '75'`;

const response = await fetch(
  `https://api.francetravail.io/partenaire/infotravail/v1/datastore_search_sql?sql=${encodeURIComponent(sql)}`,
  {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  }
);

const data = await response.json();
// data.result.records contient les resultats

// Exemple de reponse attendue :
// {
//   "ROME_PROFESSION_CARD_CODE": "B2Z40",
//   "ROME_PROFESSION_CARD_LABEL": "Ouvriers qualifies de la plomberie, du chauffage",
//   "DEPARTMENT_CODE": "75",
//   "YEAR": "2025",
//   "TOTAL_HIRING_PROJECTS": 850,
//   "DIFFICULT_HIRING_PROJECTS": 680,
//   "DIFFICULTY_RATIO": 80.0,       // <-- 80% de difficulte = forte tension
//   "SEASONAL_HIRING_PROJECTS": 45
// }
```

### 5.2 Interpretation du DIFFICULTY_RATIO

| Plage | Interpretation | Impact Koda |
|-------|---------------|-------------|
| 0 - 30% | Faible tension (recrutement facile) | Score normal |
| 30 - 60% | Tension moderee | Bonus +5 points |
| 60 - 80% | Forte tension (difficile a recruter) | Bonus +10 points |
| 80 - 100% | Tres forte tension | Bonus +15 points |

La plomberie (F1603) dans le 75 est typiquement a ~80% de difficulte, ce qui en fait un metier en forte tension -- tres favorable pour un jeune en recherche d'emploi/alternance.

### 5.3 Integration dans le scoring Koda

Le bonus de tension pourrait etre ajoute au scoring existant :

```javascript
// Ajouter au scoring v2 existant
function getBonusTension(difficultyRatio) {
  if (difficultyRatio >= 80) return 15;
  if (difficultyRatio >= 60) return 10;
  if (difficultyRatio >= 30) return 5;
  return 0;
}
```

---

## 6. Recommandations pour Koda

### 6.1 Approche recommandee (court terme)

1. **Souscrire a l'API Infotravail** sur francetravail.io (ajouter le scope `api_infotravail`)
2. Utiliser le endpoint `datastore_search_sql` avec le dataset BMO
3. Construire une table de mapping FAP -> ROME pour les 17 codes ROME deja utilises par Koda
4. Stocker les ratios de tension en cache (mise a jour annuelle)

### 6.2 Approche alternative (si API Infotravail indisponible)

1. Telecharger le fichier XLSX BMO 2025 depuis data.gouv.fr
2. Le convertir en CSV/JSON
3. L'importer dans Supabase comme table `bmo_tension`
4. Requeter directement par departement et code FAP

### 6.3 Approche complementaire (moyen terme)

1. Souscrire aussi a l'**API Marche du Travail** pour les indicateurs prospectifs
2. Combiner BMO (annuel, retrospectif) + Marche du Travail (trimestriel, prospectif)
3. Enrichir le scoring avec un indicateur de dynamisme territorial

### 6.4 Table de mapping FAP -> ROME pour les metiers Koda

| Code ROME | Metier Koda | Code FAP approximatif |
|-----------|-------------|----------------------|
| G1602 | Cuisine | S0Z20 |
| G1603 | Service en restauration | S0Z40 |
| G1605 | Plonge en restauration | S0Z60 |
| N1103 | Magasinage | J3Z43 |
| N1105 | Manutention | J6Z60 |
| F1702 | Maconnerie | B2Z41 |
| F1603 | Plomberie | B2Z40 |
| F1613 | Etancheite | B2Z42 |
| K2204 | Nettoyage | T2A60 |
| D1507 | Mise en rayon | R1Z80 |
| D1106 | Vente | R1Z40 |
| D1102 | Boulangerie | S1Z80 |
| A1203 | Paysagisme | A0Z40 |
| I1606 | Carrosserie | C1Z41 |
| K1303 | Petite enfance | V5Z82 |
| H2301 | Production industrielle | C0Z62 |
| I1304 | Maintenance industrielle | C2Z41 |

> **Attention** : ces correspondances FAP sont approximatives. 
> La table officielle FAP-ROME est publiee par la DARES et doit etre verifiee.

---

## 7. Sources

- API Marche du Travail : https://francetravail.io/data/api/marche-travail
- API Infotravail : https://francetravail.io/data/api/infotravail
- Documentation Swagger : https://francetravail.io/data/api/259/swagger
- Documentation API (requeter) : https://francetravail.io/data/documentation/utilisation-api-pole-emploi/requeter-api
- Dataset BMO data.gouv.fr : https://www.data.gouv.fr/datasets/enquete-besoins-en-main-doeuvre-bmo
- Statistiques BMO : https://statistiques.francetravail.org/bmo
- Documentation BMO endpoint : https://www.emploi-store-dev.fr/portail-developpeur-cms/home/catalogue-des-api/documentation-des-api/api/api-infotravail-v1/api-infotravail-enquete-bmo.html
- Documentation IMT endpoint : https://www.emploi-store-dev.fr/portail-developpeur-cms/home/catalogue-des-api/documentation-des-api/api/api-infotravail-v1/api-infotravail-imt.html
- Projet Mobiville (reference tension) : https://github.com/France-Travail/mobiville
- API data.gouv.fr Marche du Travail : https://www.data.gouv.fr/dataservices/api-marche-du-travail
- Catalogue API France Travail : https://francetravail.io/data/api
