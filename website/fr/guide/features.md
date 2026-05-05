# Fonctionnalités

VMark est un éditeur Markdown riche en fonctionnalités conçu pour les flux de travail d'écriture modernes. Voici ce qui est inclus.

[[toc]]

## Modes d'édition

### Mode texte enrichi (WYSIWYG)

Le mode d'édition par défaut offre une véritable expérience « ce que vous voyez est ce que vous obtenez » :

- Aperçu de la mise en forme en direct pendant la frappe
- Révélation de la syntaxe en ligne au survol du curseur
- Barre d'outils intuitive et menus contextuels
- Saisie transparente de la syntaxe Markdown

### Mode Source

Passez à l'édition Markdown brute avec une coloration syntaxique complète :

- Éditeur propulsé par CodeMirror 6
- Coloration syntaxique complète
- Fenêtres contextuelles interactives pour les maths, liens, images, liens wiki et médias — la même expérience d'édition qu'en WYSIWYG
- Collage intelligent — le HTML provenant de pages web et de documents Word est automatiquement converti en Markdown propre
- Collage d'images depuis le presse-papiers — les captures d'écran et images copiées sont enregistrées dans le dossier des ressources et insérées sous la forme `![](chemin)`
- Multi-curseur adapté aux blocs de code avec prise en charge des limites de mots CJK
- Idéal pour les utilisateurs avancés

Basculez entre les modes avec `F6`.

### Aperçu source

Modifiez le Markdown brut d'un seul bloc sans quitter le mode WYSIWYG. Appuyez sur `F5` pour ouvrir l'Aperçu source pour le bloc au niveau du curseur.

**Disposition :**
- Barre d'en-tête avec l'étiquette du type de bloc et les boutons d'action
- Éditeur CodeMirror affichant la source Markdown du bloc
- Bloc original affiché en aperçu atténué (quand l'aperçu en direct est ACTIVÉ)

**Contrôles :**
| Action | Raccourci |
|--------|----------|
| Enregistrer les modifications | `Cmd/Ctrl + Entrée` |
| Annuler (rétablir) | `Échap` |
| Basculer l'aperçu en direct | Cliquer sur l'icône œil |

**Aperçu en direct :**
- **DÉSACTIVÉ (par défaut) :** Modifiez librement, les modifications sont appliquées uniquement lors de l'enregistrement
- **ACTIVÉ :** Les modifications sont appliquées immédiatement pendant la frappe, l'aperçu est affiché en dessous

**Blocs exclus :**
Certains blocs ont leurs propres mécanismes d'édition et ignorent l'Aperçu source :
- Blocs de code (y compris Mermaid, LaTeX) — utilisez le double-clic pour modifier
- Images en bloc — utilisez le popup d'image
- En-têtes, blocs HTML, règles horizontales

L'Aperçu source est utile pour l'édition précise de Markdown (correction de la syntaxe des tableaux, ajustement de l'indentation des listes) tout en restant dans l'éditeur visuel.

## Édition multi-curseur

Modifiez plusieurs emplacements simultanément — VMark prend en charge le multi-curseur complet en mode WYSIWYG et Source.

| Action | Raccourci |
|--------|----------|
| Ajouter un curseur à la prochaine occurrence | `Mod + D` |
| Ignorer l'occurrence, passer à la suivante | `Mod + Shift + D` |
| Sélectionner toutes les occurrences | `Mod + Shift + L` |
| Ajouter un curseur au-dessus/en-dessous | `Mod + Alt + Haut/Bas` |
| Ajouter un curseur au clic | `Alt + Clic` |
| Annuler le dernier curseur | `Alt + Mod + Z` |
| Réduire à un seul curseur | `Échap` |

Toutes les éditions standard (frappe, suppression, presse-papiers, navigation) fonctionnent à chaque curseur indépendamment. Limité par défaut aux blocs pour éviter les modifications non intentionnelles entre les sections.

[En savoir plus →](/fr/guide/multi-cursor)

## Auto-paire et échappement par Tab

Quand vous tapez un crochet ouvrant, une guillemet ou un accent grave, VMark insère automatiquement le caractère fermant correspondant. Appuyez sur **Tab** pour sauter après le caractère fermant au lieu d'utiliser la touche flèche.

- Crochets : `()` `[]` `{}`
- Guillemets : `""` `''` `` ` ` ``
- CJK : `「」` `『』` `（）` `【】` `《》` `〈〉`
- Guillemets courbés : `""` `''`
- Marques de mise en forme en WYSIWYG : **gras**, *italique*, `code`, ~~barré~~, liens

La touche Retour arrière supprime les deux caractères quand la paire est vide. L'auto-paire et le saut de crochet par Tab sont tous deux **désactivés à l'intérieur des blocs de code et du code en ligne** — les crochets dans le code restent littéraux. Configurable dans **Paramètres → Éditeur**.

[En savoir plus →](/fr/guide/tab-navigation)

## Mise en forme du texte

### Styles de base

- **Gras**, *Italique*, <u>Souligné</u>, ~~Barré~~
- `Code en ligne`, ==Surligné==
- Exposant et indice
- Liens, liens Wiki et liens de favoris avec popups d'aperçu
- Notes de bas de page avec édition en ligne
- Basculement de commentaire HTML (`Mod + /`)
- Commande de suppression de la mise en forme

### Transformations de texte

Changez rapidement la casse via Format → Transformer :

| Transformation | Raccourci |
|---------------|----------|
| MAJUSCULES | `Ctrl + Shift + U` (macOS) / `Alt + Shift + U` (Win/Linux) |
| minuscules | `Ctrl + Shift + L` (macOS) / `Alt + Shift + L` (Win/Linux) |
| Titre | `Ctrl + Shift + T` (macOS) / `Alt + Shift + T` (Win/Linux) |
| Basculer la casse | — |

### Éléments de bloc

- Titres 1-6 avec des raccourcis faciles (augmenter/diminuer le niveau avec `Mod + Alt + ]`/`[`)
- Citations (imbrication prise en charge)
- Blocs de code avec coloration syntaxique
- Listes ordonnées, non ordonnées et de tâches
- Changer le type de liste : convertir un paragraphe en liste à puces, numérotée ou de tâches successivement
- Règles horizontales
- Tableaux avec prise en charge d'édition complète

### Sauts de ligne forcés

Appuyez sur `Shift + Entrée` pour insérer un saut de ligne forcé dans un paragraphe.
VMark utilise le style deux espaces par défaut pour une compatibilité maximale.
Configurez dans **Paramètres > Éditeur > Espaces**.

### Opérations sur les lignes

Manipulation puissante des lignes via Édition → Lignes :

| Action | Raccourci |
|--------|----------|
| Monter la ligne | `Alt + Haut` |
| Descendre la ligne | `Alt + Bas` |
| Dupliquer la ligne | `Shift + Alt + Bas` |
| Supprimer la ligne | `Mod + Shift + K` |
| Joindre les lignes | `Mod + J` |
| Supprimer les lignes vides | — |
| Trier les lignes croissant | `F4` |
| Trier les lignes décroissant | `Shift + F4` |

## Tableaux

Édition complète des tableaux :

- Insérez des tableaux via le menu ou le raccourci
- Ajoutez/supprimez des lignes et des colonnes
- Alignement des cellules (gauche, centre, droite)
- Redimensionnez les colonnes par glisser-déposer
- Barre d'outils contextuelle pour les actions rapides
- Navigation au clavier (Tab, flèches, Entrée)

## Images

Prise en charge complète des images :

- Insertion via boîte de dialogue de fichier
- Glisser-déposer depuis le système de fichiers
- Coller depuis le presse-papiers
- Copie automatique dans le dossier des ressources du projet
- Redimensionnement via le menu contextuel
- Double-clic pour modifier le chemin source, le texte alternatif et les dimensions
- Basculer entre l'affichage en ligne et en bloc

## Vidéo et audio

Prise en charge complète des médias avec les balises HTML5 :

- Insérez des vidéos et des audios via le sélecteur de fichiers de la barre d'outils
- Glissez-déposez des fichiers multimédias dans l'éditeur
- Copie automatique vers le dossier `.assets/` du projet
- Cliquez pour modifier le chemin source, le titre et l'affiche (vidéo)
- Prise en charge des intégrations YouTube avec des iframes renforcées en confidentialité
- Repli syntaxique des images : `![](fichier.mp4)` est automatiquement promu en vidéo
- Décoration en mode Source avec des bordures colorées par type
- [En savoir plus →](/fr/guide/media-support)

## Panneau Frontmatter

Modifiez le frontmatter YAML directement en mode WYSIWYG sans basculer vers le mode Source.

- **Replié par défaut** — un petit libellé « Frontmatter » apparaît en haut du document lorsque du frontmatter est présent
- **Cliquer pour déplier** — ouvre un éditeur en texte brut pour le contenu YAML
- **`Mod + Entrée`** — enregistrer les modifications et replier le panneau
- **`Échap`** — revenir à la dernière valeur enregistrée et replier
- **Sauvegarde automatique au défocus** — si vous cliquez ailleurs, les modifications sont enregistrées automatiquement après un bref délai

Le panneau crée un point d'annulation dans l'historique de l'éditeur, vous pouvez donc toujours utiliser `Mod + Z` pour annuler les modifications du frontmatter.

## Contenu spécial

### Boîtes d'information

Alertes Markdown au style GitHub :

- NOTE - Informations générales
- TIP - Suggestions utiles
- IMPORTANT - Informations clés
- WARNING - Problèmes potentiels
- CAUTION - Actions dangereuses

### Sections réductibles

Créez des blocs de contenu extensibles en utilisant l'élément HTML `<details>`.

### Équations mathématiques

Rendu LaTeX propulsé par KaTeX :

- Mathématiques en ligne : `$E = mc^2$`
- Mathématiques en bloc : blocs `$$...$$`
- Prise en charge complète de la syntaxe LaTeX
- Messages d'erreur utiles avec des indications de syntaxe

### Diagrammes

Prise en charge des diagrammes Mermaid avec aperçu en direct :

- Organigrammes, diagrammes de séquence, diagrammes de Gantt
- Diagrammes de classes, diagrammes d'état, diagrammes ER
- Panneau d'aperçu en direct en mode Source (glisser, redimensionner, zoomer)
- [En savoir plus →](/fr/guide/mermaid)

### Graphiques SVG

Rendez du SVG brut en ligne via des blocs de code ` ```svg ` :

- Rendu instantané avec panoramique, zoom et export PNG
- Aperçu en direct en mode WYSIWYG et Source
- Idéal pour les graphiques générés par IA et les illustrations personnalisées
- [En savoir plus →](/fr/guide/svg)

## Génies IA

Assistance à l'écriture par IA intégrée propulsée par votre fournisseur préféré :

- 13 génies répartis en quatre catégories — édition, créativité, structure et outils
- Sélecteur de style Spotlight avec recherche et invites libres (`Mod + Y`)
- Rendu de suggestion en ligne — acceptez ou refusez avec des raccourcis clavier
- Prend en charge les fournisseurs CLI (Claude, Codex, Gemini) et les API REST (Anthropic, OpenAI, Google AI, Ollama)

[En savoir plus →](/fr/guide/ai-genies) | [Configurer les fournisseurs →](/fr/guide/ai-providers)

## Rechercher et remplacer

Ouvrez la barre de recherche avec `Mod + F`. Elle apparaît en ligne en haut de la zone d'édition et fonctionne en mode WYSIWYG et Source.

**Navigation :**

| Action | Raccourci |
|--------|----------|
| Trouver la prochaine occurrence | `Entrée` ou `Mod + G` |
| Trouver l'occurrence précédente | `Shift + Entrée` ou `Mod + Shift + G` |
| Utiliser la sélection pour la recherche | `Mod + E` |
| Fermer la barre de recherche | `Échap` |

**Options de recherche** — basculez via les boutons dans la barre de recherche :

- **Sensible à la casse** — correspondre à la casse exacte des lettres
- **Mot entier** — ne faire correspondre que les mots complets, pas les sous-chaînes
- **Expression régulière** — utiliser des motifs regex (activez d'abord dans les Paramètres)

**Remplacer :**

Cliquez sur le chevron d'expansion de la barre de recherche pour révéler la ligne de remplacement. Saisissez le texte de remplacement, puis utilisez **Remplacer** (une seule occurrence) ou **Tout remplacer** (chaque occurrence en même temps). Le compteur d'occurrences affiche la position actuelle et le total (par ex. « 3 sur 12 ») pour que vous sachiez toujours où vous en êtes.

## Lint Markdown

VMark intègre un linter Markdown qui vérifie votre document pour détecter les erreurs de syntaxe courantes et les problèmes d'accessibilité. Activez-le dans **Paramètres > Markdown > Lint**.

**Utilisation :**

| Action | Raccourci |
|--------|----------|
| Exécuter la vérification lint | `Alt + Mod + V` |
| Aller au problème suivant | `F2` |
| Aller au problème précédent | `Shift + F2` |

Lorsque vous lancez une vérification lint, les diagnostics apparaissent sous forme de surlignages en ligne et de marqueurs dans la marge. Si aucun problème n'est trouvé, une notification confirme que le document est propre. Les problèmes sont classés en erreurs ou avertissements.

**Règles vérifiées (13 au total) :**

- Liens de référence non définis
- Nombre de colonnes de tableau non concordant
- Syntaxe de lien inversée `(texte)[url]` au lieu de `[texte](url)`
- Espace manquant après `#` dans les titres
- Espaces à l'intérieur des marqueurs d'emphase
- Texte de lien vide ou URL de lien vides
- Définitions de liens/images en double
- Définitions de liens/images inutilisées
- Niveaux de titre qui sautent des niveaux (par ex. H1 à H3)
- Images sans texte alternatif (accessibilité)
- Blocs de code clôturés non fermés
- Liens de fragment brisés (`#ancre` ne correspondant à aucun titre)

Les résultats du lint sont éphémères et effacés lorsque vous modifiez le document. Relancez la vérification à tout moment avec `Alt + Mod + V`.

## Barre d'outils universelle

Une barre d'outils de mise en forme ancrée en bas de l'éditeur, offrant un accès rapide à toutes les actions de mise en forme en mode WYSIWYG et Source.

- **Basculer :** `Mod + Shift + P` ouvre la barre d'outils et lui donne le focus. Appuyez à nouveau pour redonner le focus à l'éditeur tout en gardant la barre visible.
- **Navigation au clavier :** Utilisez les flèches `Gauche`/`Droite` pour naviguer entre les groupes. `Entrée` ou `Espace` ouvre un menu déroulant. Les flèches naviguent à l'intérieur des menus.
- **Échappement en deux temps :** Si un menu déroulant est ouvert, `Échap` ferme d'abord le menu. Appuyez à nouveau sur `Échap` pour fermer toute la barre d'outils.
- **Mémoire de session :** La barre d'outils se souvient du dernier bouton focalisé pendant la session en cours, la refocalisation reprend là où vous en étiez.
- **Raccourci Génies IA :** La barre d'outils inclut un bouton Génies IA qui ouvre le sélecteur de génies (`Mod + Y`).

## Options d'exportation

VMark offre des options d'exportation flexibles pour partager vos documents.

### Export HTML

Exportez vers du HTML autonome avec deux modes d'empaquetage :

- **Mode dossier** (par défaut) : Crée `Document/index.html` avec les ressources dans un sous-dossier
- **Mode fichier unique** : Crée un fichier `.html` autonome avec des images intégrées

L'HTML exporté inclut le [**Lecteur VMark**](/fr/guide/export#vmark-reader) — des contrôles interactifs pour les paramètres, la table des matières, la visionneuse d'images et plus encore.

[En savoir plus sur l'exportation →](/fr/guide/export)

### Export PDF

Imprimez en PDF avec la boîte de dialogue système native (`Cmd/Ctrl + P`).

### Copier en HTML

Copiez le contenu mis en forme pour le coller dans d'autres applications (`Cmd/Ctrl + Shift + C`).

### Format de copie

Par défaut, la copie depuis WYSIWYG place du texte brut (sans mise en forme) dans le presse-papiers. Activez le format de copie **Markdown** dans **Paramètres > Éditeur > Comportement** pour placer la syntaxe Markdown dans `text/plain` à la place — les titres gardent leur `#`, les liens gardent leurs URL, etc. Utile lors du collage dans des terminaux, des éditeurs de code ou des applications de messagerie.

## Mise en forme CJK

Outils de mise en forme de texte chinois/japonais/coréen intégrés :

- Plus de 20 règles de mise en forme configurables
- Espacement CJK-anglais
- Conversion de caractères pleine largeur
- Normalisation de la ponctuation
- Association intelligente des guillemets avec détection des apostrophes/primes
- Protection des constructions techniques (URL, versions, heures, décimales)
- Conversion contextuelle des guillemets (courbés pour le CJK, droits pour le latin)
- Basculement du style de guillemets au curseur (`Shift + Mod + '`)
- [En savoir plus →](/fr/guide/cjk-formatting)

## Historique du document

VMark sauvegarde automatiquement des instantanés de vos documents afin que vous puissiez récupérer des versions antérieures.

- **Sauvegarde automatique** avec intervalle configurable capture des instantanés en arrière-plan
- **Historique par document** stocké localement au format JSONL
- Ouvrez la barre latérale Historique avec `Ctrl + Shift + 3` pour parcourir les versions passées
- Les instantanés sont **regroupés par jour** avec des horodatages indiquant l'heure exacte de chaque version sauvegardée
- **Restaurez** une version précédente en cliquant sur le bouton de restauration à côté de n'importe quel instantané (un dialogue de confirmation empêche les retours accidentels)
- **Supprimez** les instantanés individuels dont vous n'avez plus besoin avec le bouton corbeille
- Le contenu actuel est sauvegardé comme nouvel instantané avant toute restauration, vous ne perdez donc jamais votre travail
- L'historique nécessite que le document soit enregistré dans un fichier (les documents sans titre n'ont pas d'historique)
- Activez ou désactivez le suivi de l'historique dans **Paramètres > Général**

## Récupération de session (Hot Exit)

Lorsque vous quittez VMark ou qu'il se ferme de manière inattendue, votre session est préservée et restaurée au prochain lancement.

**Ce qui est sauvegardé :**
- Tous les onglets ouverts et leur contenu (y compris les modifications non enregistrées)
- Positions du curseur et historique d'annulation/rétablissement
- Disposition de l'interface : état de la barre latérale, visibilité du plan, mode source/focus/machine à écrire, état du terminal
- Position et taille de la fenêtre
- Espace de travail actif et paramètres de l'explorateur de fichiers

**Fonctionnement :**
- À la fermeture, VMark capture l'état complet de la session de toutes les fenêtres
- Au relancement, les onglets sont restaurés exactement comme vous les avez laissés, les documents modifiés (non enregistrés) étant marqués en conséquence
- La récupération après plantage s'exécute automatiquement après une fermeture inattendue, restaurant les documents à partir d'instantanés de récupération périodiques
- Les instantanés de récupération de plus de 7 jours sont nettoyés automatiquement

Aucune configuration nécessaire. La récupération de session est toujours active.

## Affichage et focus

### Mode focus (`F8`)

Le mode focus atténue tous les blocs sauf celui que vous modifiez actuellement, réduisant le bruit visuel pour que vous puissiez vous concentrer sur un seul paragraphe. Le bloc actif est mis en évidence à pleine opacité tandis que le contenu environnant s'estompe vers une couleur atténuée. Basculez-le avec `F8` — il fonctionne en mode WYSIWYG et Source et persiste jusqu'à ce que vous le désactiviez.

### Mode machine à écrire (`F9`)

Le mode machine à écrire garde la ligne active centrée verticalement dans la fenêtre, afin que vos yeux restent à une position fixe pendant que le document défile en dessous — comme si vous tapiez sur une vraie machine à écrire. Basculez-le avec `F9`. Il fonctionne dans les deux modes d'édition et utilise un défilement fluide avec un petit seuil pour éviter les ajustements saccadés lors des déplacements mineurs du curseur.

### Combiner focus + machine à écrire

Le mode focus et le mode machine à écrire peuvent être activés simultanément. Ensemble, ils offrent un environnement d'écriture sans distraction complète : les blocs environnants sont atténués *et* la ligne actuelle reste centrée à l'écran.

### Retour à la ligne (`Alt + Z`)

Basculez le retour à la ligne automatique avec `Alt + Z`. Quand il est activé, les longues lignes se replient à la largeur de l'éditeur au lieu de défiler horizontalement. Le paramètre persiste entre les sessions.

### Mode lecture seule (`F10`)

Verrouillez un document pour empêcher les modifications accidentelles. Basculez avec `F10`. Lorsqu'il est actif, toute saisie au clavier et les commandes de mise en forme sont bloquées — vous pouvez toujours défiler, sélectionner du texte et copier. Utile pour relire des documents terminés ou consulter du contenu tout en écrivant dans un autre onglet.

### Panneau de plan (`Ctrl + Shift + 1`)

Le panneau de plan affiche la structure des titres de votre document sous forme d'arborescence réductible dans la barre latérale. Ouvrez-le avec `Ctrl + Shift + 1`.

- Cliquez sur n'importe quel titre pour faire défiler l'éditeur jusqu'à cette section
- Réduisez et développez les groupes de titres pour vous concentrer sur des parties spécifiques de votre document
- Le titre actuellement actif est mis en évidence lorsque vous défilez ou tapez
- Mis à jour en temps réel lorsque vous ajoutez, supprimez ou renommez des titres

### Zoom

Ajustez la taille de police de l'éditeur sans ouvrir les Paramètres :

| Action | Raccourci |
|--------|----------|
| Zoomer | `Mod + =` |
| Dézoomer | `Mod + -` |
| Réinitialiser la taille par défaut | `Mod + 0` |

Le zoom modifie la taille de police de l'éditeur par incréments de 2px (plage : 12px à 32px). Il modifie la même valeur de taille de police que celle dans **Paramètres > Apparence**, de sorte que le zoom au clavier et le curseur des paramètres restent toujours synchronisés.

## Utilitaires de texte

VMark inclut des utilitaires pour le nettoyage et la mise en forme du texte, disponibles dans le menu Format :

### Nettoyage du texte (Format → Nettoyage du texte)

- **Supprimer les espaces de fin** : Enlever les espaces en fin de ligne
- **Réduire les lignes vides** : Réduire plusieurs lignes vides consécutives à une seule

### Mise en forme CJK (Format → CJK)

Outils de mise en forme de texte chinois/japonais/coréen intégrés. [En savoir plus →](/fr/guide/cjk-formatting)

### Nettoyage des images (Fichier → Nettoyer les images inutilisées)

Trouvez et supprimez les images orphelines de votre dossier de ressources.

## Terminal intégré

Panneau terminal intégré avec plusieurs sessions, copier/coller, recherche, chemins de fichiers et URL cliquables, menu contextuel, synchronisation des thèmes et paramètres de police configurables. Basculez avec `` Ctrl + ` ``. [En savoir plus →](/fr/guide/terminal)

## Mise à jour automatique

VMark vérifie automatiquement les mises à jour et peut les télécharger et les installer dans l'application :

- Vérification automatique des mises à jour au lancement
- Installation des mises à jour en un clic
- Aperçu des notes de version avant la mise à jour

## Support des espaces de travail

- Ouvrez des dossiers comme espaces de travail
- Navigation dans l'arborescence des fichiers dans la barre latérale
- Changement rapide de fichier
- Suivi des fichiers récents
- Taille et position de la fenêtre mémorisées entre les sessions

[En savoir plus →](/fr/guide/workspace-management)

## Personnalisation

### Thèmes

Cinq thèmes de couleurs intégrés :

- Blanc (propre, minimal)
- Papier (blanc cassé chaud)
- Menthe (teinte verte douce)
- Sépia (look vintage)
- Nuit (mode sombre)

### Polices

Configurez des polices séparées pour :

- Texte latin
- Texte CJK (chinois/japonais/coréen)
- Monospace (code)

### Disposition

Ajustez :

- Taille de police
- Interligne
- Espacement des blocs (écart entre les paragraphes et les blocs)
- Espacement des lettres CJK (espacement subtil pour la lisibilité CJK)
- Largeur de l'éditeur
- Taille de police des éléments de bloc (listes, citations, tableaux, alertes)
- Alignement des titres (gauche ou centre)
- Alignement des images et tableaux (gauche ou centre)

### Raccourcis clavier

Tous les raccourcis sont personnalisables dans Paramètres → Raccourcis.

## Détails techniques

VMark est construit avec des technologies modernes :

| Composant | Technologie |
|-----------|------------|
| Framework de bureau | Tauri v2 (Rust) |
| Frontend | React 19, TypeScript |
| Gestion d'état | Zustand v5 |
| Éditeur de texte enrichi | Tiptap (ProseMirror) |
| Éditeur source | CodeMirror 6 |
| Style | Tailwind CSS v4 |

Tout le traitement se fait localement sur votre machine — pas de services cloud, pas de compte requis.
