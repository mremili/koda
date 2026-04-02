# 📄 Koda CV Tool — Prompt pour l'agent

## Ajout au system prompt de l'Agent Koda

Ajouter dans la section OUTILS DISPONIBLES :

```
2. build_cv : Analyse le profil du jeune et identifie ce qui manque pour son CV.
   Utilise cet outil quand :
   - Le jeune demande un CV ("fais mon CV", "j'ai besoin d'un CV", "CV")
   - Le jeune a accepté une offre et n'a pas de CV
   - L'onboarding est terminé et le jeune a dit ne pas avoir de CV
   
   L'outil retourne :
   - Ce qu'on sait déjà (pré-rempli)
   - Les expériences extraites des notes du mentor
   - La prochaine question à poser au jeune
   
   IMPORTANT : quand l'outil dit "pose cette question", tu la poses AU JEUNE
   telle quelle. Ne la reformule pas, elle est calibrée pour débloquer.
   
   Quand l'outil dit "enough_for_cv: true", tu demandes au jeune de confirmer
   le récap, puis tu appelles build_cv une dernière fois avec "generate: true"
   pour produire le PDF.
```

## Flow conversationnel type

```
Jeune : "J'ai besoin d'un CV"

Koda appelle build_cv → reçoit :
  - experiences_extraites: [
      { titre: "Candidature SNCF Agent d'Escale", source: "resume_suivi", confidence: 0.8 }
    ]
  - next_question: "T'as postulé à la SNCF en tant qu'Agent d'Escale,
    c'est cool ! Tu as aussi fait des stages ou des petits boulots avant ?"

Koda : "Je commence ton CV ! Je vois que tu as postulé à la SNCF pour
        un poste d'Agent d'Escale, c'est top.
        T'as aussi fait des stages ou des petits boulots avant ?"

Jeune : "oui j'ai fait un stage en boulangerie pendant 2 semaines"

Koda appelle build_cv (avec la nouvelle info) → reçoit :
  - experiences: [SNCF, Stage boulangerie]
  - next_question: "Et au foyer ou dans ta vie de tous les jours,
    tu fais des trucs utiles ? Cuisine, traduction, sport en club ?"

Koda : "Noté le stage boulangerie ! Et au quotidien, tu fais des trucs
        utiles ? Cuisine, traduction, sport en club ?"

Jeune : "je joue au foot et je fais la cuisine au foyer des fois"

Koda appelle build_cv → reçoit :
  - enough_for_cv: true
  - cv_preview: { ... }

Koda : "Super ! Voici le récap de ton CV :
        - Mourad, 18 ans, Blanc-Mesnil
        - En CAP Boulangerie
        - Stage découverte en boulangerie (2 semaines)
        - Candidature Agent d'Escale SNCF
        - Compétences : Rigueur, Travail d'équipe, Ponctualité
        - Langues : Français avancé, Bambara langue maternelle
        - Intérêts : Football, Cuisine
        
        C'est bon pour toi ? Je génère le PDF ?"

Jeune : "oui c'est bon"

Koda génère le PDF → envoie le lien WhatsApp
```

## Données disponibles par jeune (exemple réel)

### Mamadouba (CAP Boulangerie, 93)
- **Ce qu'on sait** : CAP boulangerie, veut se réorienter informatique, candidature SNCF Agent d'Escale en cours, rédaction autonome de sa candidature
- **Extrait du resume_suivi** : "Le binôme travaille sur la finalisation de sa candidature pour une alternance à la SNCF en tant qu'Agent d'Escale, avec rédaction autonome"
- **Skills inférées** : Travail manuel, Rigueur, Respect des consignes
- **Questions à poser** : stages passés, expériences informelles, langues (MNA probable)

### Imoran (CAP, Logistique, 75)
- **Ce qu'on sait** : 16 ans, stage juin en logistique, lycée pro, vient de RDC
- **Extrait du resume_suivi** : "Prépare son second stage de juin en logistique à travers un accompagnement structuré : entretien initial..."
- **Skills inférées** : Préparation de commandes, Utilisation de transpalette, Gestion de stock
- **Questions à poser** : premier stage (détails), activités au quotidien, langues

### Karifa (UPE2A, Informatique, 13)
- **Ce qu'on sait** : MNA, vient de Guinée Conakry, 1 an en France, entre en BAC PRO CIEL (informatique), n'a pas d'ordi
- **Extrait** : "Les rencontres étaient régulières et intensives, notamment en août et septembre 2025"
- **Skills** : Multilinguisme, Adaptabilité culturelle, Apprentissage rapide
- **Questions à poser** : tout (formation passée en Guinée?, expériences là-bas?, compétences info acquises comment?)
