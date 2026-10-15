# Fonctionnalités

VMark est l'espace de travail en texte brut où humains et IA collaborent. Le Markdown en est la pièce maîtresse (avec les modes WYSIWYG, Aperçu source et Source), mais l'espace de travail ouvre aussi le YAML, le JSON, le TOML, Mermaid, le SVG, le HTML et 9 formats de visionneuse de code — voir [Formats pris en charge](/fr/guide/formats) pour la liste complète.

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

### Vue divisée (Source + Aperçu)

Modifiez la source Markdown brute à gauche pendant qu'un **aperçu WYSIWYG en direct,
en lecture seule** se met à jour à droite — l'aperçu *est* le moteur de rendu WYSIWYG, il
ne s'écarte donc jamais de ce que vous verriez en mode texte enrichi. Les commandes de mise
en forme et la barre d'outils agissent sur le volet source ; faites glisser le séparateur (ou
utilisez les touches fléchées dessus) pour redimensionner.

- Basculez pour la session avec `Shift + F6`, **Affichage → Vue divisée Markdown**, ou la
  palette de commandes (« Afficher/masquer la vue divisée Markdown »)
- Faites-en la valeur par défaut pour les fichiers Markdown dans **Paramètres → Markdown → Mise en page →
  Diviser source/aperçu par défaut**

Le WYSIWYG reste la valeur par défaut ; la division est facultative. Les trois vues sont mutuellement
exclusives — `F6` bascule Source et `Shift + F6` bascule la vue divisée, chacun revenant
au WYSIWYG — de sorte que passer de l'une à l'autre ne demande toujours qu'une seule touche.

Le menu **Affichage** présente les trois modes — **Mode WYSIWYG**, **Mode code
source**, **Vue divisée Markdown** — sous forme de groupe coché, de sorte que le mode actif est
toujours visible et que l'exclusivité mutuelle est explicite. **Activer/désactiver le retour à la ligne** et
**Afficher/masquer les numéros de ligne** ne s'appliquent qu'à l'éditeur source ; ils sont donc grisés tant que
vous êtes en mode WYSIWYG.

### Position de lecture

Votre position dans un document survit à votre départ. Passer à un autre onglet puis revenir,
basculer le mode Source ou la vue divisée, ou voir le fichier rechargé depuis le disque vous
ramènent tous là où vous lisiez — et non en haut.

Chaque surface mémorise sa propre position : le texte enrichi et la source conservent donc des
positions distinctes dans le même fichier. Revenir à la même surface — en changeant d'onglet ou
lorsque le fichier est rechargé — vous ramène là où vous aviez fait défiler la vue, même si le
curseur se trouve ailleurs ; le curseur reste là où vous l'avez laissé. Passer du texte enrichi à
la source suit en revanche le curseur, s'il y en a un, car c'est lui qui garde le même paragraphe
à l'écran d'une surface à l'autre.

Les positions sont propres à chaque document et à chaque session — fermer un onglet l'oublie.

### Annulation entre les modes

L'annulation et le rétablissement franchissent la frontière WYSIWYG ⇄ Source. Chaque changement de mode enregistre un point de contrôle, et une fois l'historique propre de l'éditeur actuel épuisé, `Mod + Z` continue à travers ces points de contrôle — en restaurant le contenu antérieur sans changer la vue dans laquelle vous êtes. Le rétablissement parcourt la même chaîne en avant ; un rétablissement dont vous avez abandonné la branche en faisant une nouvelle modification est refusé plutôt qu'appliqué par-dessus votre travail. La chaîne est conservée par onglet et effacée à la fermeture de l'onglet.

### Fichiers volumineux

VMark ouvre automatiquement les fichiers de plus de 1 Mo en mode Source pour une ouverture en moins d'une seconde, avertit avant de toucher aux fichiers de plus de 5 Mo et refuse les fichiers de plus de 50 Mo. Voir le guide [Fichiers volumineux](./large-files.md) pour les seuils et les paramètres.

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
- Frontmatter, blocs HTML, règles horizontales

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

Toutes les éditions standard (frappe, suppression, presse-papiers, navigation) fonctionnent à chaque curseur indépendamment. Dans la prose, `Mod + D` et `Mod + Shift + L` recherchent dans tout le document ; à l'intérieur d'un bloc de code, ils restent dans ce bloc. `Alt + Mod + Shift + L` sélectionne toutes les occurrences du bloc courant uniquement.

[En savoir plus →](/fr/guide/multi-cursor)

## Tout sélectionner intelligent

En mode WYSIWYG, `Mod + A` agrandit la sélection un conteneur à la fois au lieu de sauter directement au document entier : dans un tableau, il sélectionne la cellule, puis la ligne, puis le tableau, puis le document. `Mod + Z` annule une étape d'agrandissement et `Échap` réduit la sélection à un curseur.

En mode Source, `Mod + A` sélectionne d'abord le bloc englobant — un bloc de code délimité, un tableau, une citation ou une liste — puis le document entier ; `Mod + Z` y annule aussi une étape d'agrandissement.

Ce raccourci appartient à l'éditeur et n'est pas personnalisable.

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
- Désactiver une liste : cliquer à nouveau sur le type de liste actif supprime la mise en forme de liste
- Convertir en code : l'action Bloc de code transforme toute la liste au niveau du curseur — ou toute sélection de plusieurs blocs (paragraphes, titres, listes) — en un seul bloc de code, une ligne par bloc ou élément de liste
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
| Trier les lignes croissant | `F4` _(mode Source uniquement)_ |
| Trier les lignes décroissant | `Shift + F4` _(mode Source uniquement)_ |

Le tri s'applique à des lignes de texte brut ; il n'est donc disponible qu'en mode Source.

## Tableaux

Édition complète des tableaux :

- Insérez des tableaux via le menu ou le raccourci
- Ajoutez/supprimez des lignes et des colonnes
- Alignement des cellules (gauche, centre, droite)
- Les colonnes s'ajustent automatiquement au contenu ; les tableaux larges défilent horizontalement
- Ajuster à la largeur — fixer un tableau à la largeur de l'éditeur avec des colonnes proportionnelles au contenu (Paramètres → Markdown, ou par tableau via le clic droit)
- Barre d'outils contextuelle pour les actions rapides
- Navigation au clavier — `Tab` / `Shift + Tab` passent d'une cellule à l'autre, les touches fléchées quittent le tableau à ses bords, et `Mod + Enter` / `Mod + Shift + Enter` ajoutent une ligne en dessous / au-dessus

## Images

Prise en charge complète des images :

- Insertion via boîte de dialogue de fichier
- Glisser-déposer depuis le système de fichiers
- Coller depuis le presse-papiers
- Copie automatique dans le dossier des ressources du projet
- Double-clic pour modifier le chemin source et le texte alternatif — les dimensions de l'image sont affichées en lecture seule
- Clic droit pour Changer l'image, Supprimer l'image, Copier le chemin et Afficher dans le Finder (Afficher dans l'Explorateur sous Windows, Afficher dans le gestionnaire de fichiers sous Linux)
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
- Les délimiteurs de style ChatGPT sont reconnus à l'ouverture et au collage et normalisés sous la
  forme `$` : `\( ... \)` devient des mathématiques en ligne, et un `\[ ... \]` isolé
  devient un bloc d'affichage
- Un bloc `$$` doit se fermer avant une ligne vide (la règle de pandoc) — un `$$` non fermé
  s'affiche comme du texte littéral au lieu d'avaler les paragraphes qui le suivent.
  Les lignes vides placées juste avant la fermeture sont acceptées (un bloc vide
  `$$` … `$$` reste un bloc mathématique)
- Prise en charge complète de la syntaxe LaTeX
- Messages d'erreur utiles avec des indications de syntaxe

### Diagrammes

Prise en charge des diagrammes Mermaid avec aperçu en direct :

- Organigrammes, diagrammes de séquence, diagrammes de Gantt
- Diagrammes de classes, diagrammes d'état, diagrammes ER
- Panneau d'aperçu en direct en mode Source (glisser, redimensionner, zoomer)
- [En savoir plus →](/fr/guide/mermaid)

Prise en charge de Graphviz DOT avec les mêmes surfaces d'aperçu :

- Les blocs délimités ` ```dot ` et ` ```graphviz ` sont rendus localement (WASM)
- Panoramique, zoom et export PNG comme pour les diagrammes Mermaid
- [En savoir plus →](/fr/guide/graphviz)

### Graphiques SVG

Rendez du SVG brut en ligne via des blocs de code ` ```svg ` :

- Rendu instantané avec panoramique, zoom et export PNG
- Aperçu en direct en mode WYSIWYG et Source
- Idéal pour les graphiques générés par IA et les illustrations personnalisées
- [En savoir plus →](/fr/guide/svg)

### Table des matières en ligne

Tapez `[TOC]` seul sur une ligne, ou choisissez **Insertion → Table des matières**, pour insérer une table des matières dynamique (l'élément de menu n'a pas de raccourci par défaut ; attribuez-en un dans Paramètres → Raccourcis) :

- Générée automatiquement à partir des titres du document, avec une imbrication correcte
- Cliquez sur un titre pour y faire défiler directement le document
- Mise à jour en temps réel pendant que vous éditez
- Rendue en WYSIWYG et à l'export (HTML/PDF), et conservée intacte lors des allers-retours en mode Source

## Génies IA

Assistance à l'écriture par IA intégrée propulsée par votre fournisseur préféré :

- 13 génies répartis en quatre catégories — édition, créativité, structure et outils
- Sélecteur de style Spotlight avec recherche et invites libres (`Mod + Y`)
- Rendu de suggestion en ligne — acceptez ou refusez avec des raccourcis clavier
- Prend en charge les fournisseurs CLI (Claude, Codex, Gemini) et les API REST (Anthropic, OpenAI, Google AI, Ollama)

[En savoir plus →](/fr/guide/ai-genies) | [Configurer les fournisseurs →](/fr/guide/ai-providers)

## Rechercher et remplacer

Ouvrez la barre de recherche avec `Mod + F`. Elle s'ouvre dans la barre située en bas de la fenêtre et fonctionne en mode WYSIWYG et Source.

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

Le champ de remplacement se trouve à côté du champ de recherche — les deux sont toujours visibles, et `Tab` passe de l'un à l'autre. Saisissez le texte de remplacement, puis utilisez **Remplacer** (une seule occurrence) ou **Tout remplacer** (chaque occurrence en même temps). Le compteur d'occurrences affiche la position actuelle et le total (par ex. « 3 sur 12 ») pour que vous sachiez toujours où vous en êtes.

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

Les résultats du lint ne sont pas mis à jour pendant la frappe. En mode Source, une modification les efface. En mode WYSIWYG, une modification supprime les surlignages, mais le nombre de problèmes dans la barre d'état et les cibles de `F2` / `Shift + F2` restent ceux de la dernière vérification jusqu'à ce que vous la relanciez ou fermiez l'onglet. Relancez la vérification à tout moment avec `Alt + Mod + V`.

## Barre d'outils universelle

Une barre d'outils de mise en forme ancrée en bas de l'éditeur, offrant un accès rapide à toutes les actions de mise en forme en mode WYSIWYG et Source.

- **Basculer :** `Mod + Shift + B` ouvre la barre d'outils et lui donne le focus. Appuyez à nouveau pour redonner le focus à l'éditeur tout en gardant la barre visible.
- **Navigation au clavier :** Utilisez les flèches `Gauche`/`Droite` pour naviguer entre les groupes. `Entrée` ou `Espace` ouvre un menu déroulant. Les flèches naviguent à l'intérieur des menus.
- **Échappement en deux temps :** Si un menu déroulant est ouvert, `Échap` ferme d'abord le menu. Appuyez à nouveau sur `Échap` pour fermer toute la barre d'outils.
- **Mémoire de session :** La barre d'outils se souvient du dernier bouton focalisé pendant la session en cours, la refocalisation reprend là où vous en étiez.
- **Raccourci Génies IA :** La barre d'outils inclut un bouton Génies IA qui ouvre le sélecteur de génies (`Mod + Y`).

## Menu contextuel de l'éditeur

Faites un clic droit n'importe où dans l'éditeur (mode WYSIWYG ou Source) pour ouvrir un menu contextuel proposant les actions courantes.

- **Presse-papiers :** Couper, Copier, Coller et Tout sélectionner. Sur macOS, ces actions utilisent le pipeline natif du presse-papiers ; coller du contenu enrichi (par ex. du HTML copié depuis un navigateur) conserve donc sa mise en forme — exactement comme `Mod + V`.
- **Mise en forme en ligne :** Gras, Italique, Barré et Code en ligne, avec des coches indiquant les marques actives au niveau du curseur.
- **Opérations sur les blocs :** sous-menus Niveau de titre et Type de liste, Citation et Bloc de code — les coches reflètent le bloc actuel.
- **Liens :** Insérer un lien sur du texte simple ; sur un lien existant, la section devient Modifier le lien, Copier le lien et Supprimer le lien.
- **Sensible au contexte :** dans les tableaux, c'est le menu dédié aux tableaux qui apparaît ; un clic droit sur une image ouvre le menu d'image ; dans les blocs de code, seules les actions du presse-papiers sont proposées. Les fichiers non Markdown (JSON, YAML, …) reçoivent un menu réduit au presse-papiers.
- **Gestion de la sélection :** un clic droit à l'intérieur d'une sélection la conserve ; un clic droit ailleurs y déplace d'abord le curseur (convention macOS).
- **Clavier :** les touches fléchées naviguent (les éléments désactivés sont ignorés), `Droite`/`Gauche` entrent dans les sous-menus et en sortent, `Échap` ferme d'abord le sous-menu, puis le menu. Les indications de raccourcis reflètent vos raccourcis personnalisés.

## Palette de commandes

Appuyez sur `Mod + Shift + P` pour ouvrir la palette de commandes. Avec une requête vide, elle liste toutes les commandes disponibles regroupées par catégorie — fichier, espace de travail, affichage, export, mise en forme, titres, listes, tableaux, lignes, sélection, transformation, CJK, lint, historique, IA et plus encore ; tapez pour filtrer et classer par correspondance. `↑`/`↓` se déplacent, `Entrée` exécute la commande, `Échap` (ou un clic sur l'arrière-plan) ferme. Seules les commandes applicables à l'instant sont affichées — une commande d'éditeur disparaît lorsqu'aucun document n'est ouvert, une commande d'espace de travail lorsqu'aucun espace de travail ne l'est — et la commande s'exécute dans la fenêtre depuis laquelle vous avez ouvert la palette. Les pages de ce guide nomment leurs commandes de palette entre guillemets (« Afficher/masquer la vue divisée Markdown », « Breakdown View », « État des fenêtres »). La palette n'a pas d'élément de menu ; son raccourci est personnalisable dans **Paramètres → Raccourcis**.

## Options d'exportation

VMark offre des options d'exportation flexibles pour partager vos documents.

### Export HTML

**Fichier → Exporter → HTML** écrit un dossier contenant à la fois `index.html` (avec un dossier `assets/` lié) et `standalone.html` (tout intégré) — il n'y a pas de mode à choisir ; utilisez le fichier qui vous convient.

L'HTML exporté inclut le [**Lecteur VMark**](/fr/guide/export#lecteur-vmark) — des contrôles interactifs pour les paramètres, la table des matières, la visionneuse d'images et plus encore.

[En savoir plus sur l'exportation →](/fr/guide/export)

### Export PDF

**Fichier → Exporter → PDF** ouvre la boîte de dialogue d'export propre à VMark — format de page (A4, Letter, A3, Legal) et orientation, préréglages de marges ou une zone de marges personnalisée réglable par glissement, taille de police, interligne, polices latines et CJK, préréglages de style et numéros de page — puis écrit le PDF sur macOS, Windows et Linux, avec un plan des titres cliquable dans la barre latérale de la visionneuse. **Imprimer** (`Cmd/Ctrl + P`) est la voie distincte passant par la boîte de dialogue d'impression du système. [En savoir plus →](/fr/guide/export#imprimer-exporter-en-pdf)

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
- **Historique par document** stocké localement dans le dossier de données de l'application VMark — un fichier d'index plus un fichier Markdown par instantané
- Ouvrez la barre latérale Historique avec `Ctrl + Shift + 3` pour parcourir les versions passées
- Les instantanés sont **regroupés par jour** avec des horodatages indiquant l'heure exacte de chaque version sauvegardée
- **Restaurez** une version précédente en cliquant sur le bouton de restauration à côté de n'importe quel instantané (un dialogue de confirmation empêche les retours accidentels)
- **Supprimez** les instantanés individuels dont vous n'avez plus besoin avec le bouton corbeille
- Le contenu actuel est sauvegardé comme nouvel instantané avant toute restauration, vous ne perdez donc jamais votre travail
- L'historique nécessite que le document soit enregistré dans un fichier (les documents sans titre n'ont pas d'historique)
- Activez ou désactivez le suivi de l'historique dans **Paramètres > Général**

## Récupération de session (Hot Exit)

Lorsque VMark redémarre pour installer une mise à jour, ou qu'il se ferme de manière inattendue, votre travail est préservé et restauré au prochain lancement.

**Ce qu'un redémarrage de mise à jour sauvegarde :**
- Tous les onglets ouverts et leur contenu (y compris les modifications non enregistrées)
- Positions du curseur et historique d'annulation/rétablissement
- Disposition de l'interface : état de la barre latérale, visibilité du plan, mode source/focus/machine à écrire, état du terminal
- Position et taille de la fenêtre
- Espace de travail actif et paramètres de l'explorateur de fichiers

**Fonctionnement :**
- Lorsque vous choisissez de redémarrer pour installer une mise à jour, VMark capture d'abord l'état complet de la session de toutes les fenêtres
- Au relancement, les onglets sont restaurés exactement comme vous les avez laissés, les documents modifiés (non enregistrés) étant marqués en conséquence
- Les modifications non enregistrées sont aussi écrites dans des instantanés de récupération toutes les 10 secondes. Après une fermeture inattendue, VMark les restaure au prochain lancement sous forme d'onglets non enregistrés
- Les instantanés de récupération de plus de 7 jours sont nettoyés automatiquement
- Quitter normalement ne capture pas la session : VMark vous demande d'abord d'enregistrer les documents non enregistrés (voir [Fermer des onglets et des fenêtres](/fr/guide/tab-navigation#fermer-des-onglets-et-des-fenetres)). Les onglets ouverts d'un espace de travail reviennent quand même la prochaine fois que vous l'ouvrez (voir [Restauration de session](/fr/guide/workspace-management#restauration-de-session))

Aucune configuration nécessaire. La récupération de session est toujours active.

## Barre d'état

La barre d'état court le long du bas de la fenêtre (`F7` la masque). Le côté gauche contient la barre d'onglets — voir [Passer d'un onglet ouvert à l'autre](/fr/guide/tab-navigation#passer-d-un-onglet-ouvert-a-l-autre) — et de courts avis comme *« Ouvert en mode Source (fichier volumineux). »* Le côté droit, de gauche à droite :

| Indicateur | Ce qu'il affiche | Clic |
|---|---|---|
| Enregistrement automatique | Une icône d'enregistrement et depuis combien de temps le document a été enregistré automatiquement ; s'estompe après quelques secondes | — |
| Compteurs | Mots et caractères (espaces non comptés) ; avec une sélection, *sélection / total* | Ouvre une fenêtre contextuelle **Nombre de mots** : mots, caractères, caractères sans espaces, caractères CJK, caractères sans ponctuation |
| Lint | ⊗ erreurs ou ⚠ avertissements trouvés par la dernière exécution du [lint](#lint-markdown) ; masqué lorsqu'il n'y en a aucun | Va au problème suivant |
| IA | Pendant l'exécution d'un génie, *Réflexion…* avec les secondes écoulées et un × pour annuler ; puis *Terminé*, ou l'erreur avec **Réessayer**, qui relance la requête en échec, et **Ignorer** ; Réessayer est absent quand il n'y a rien à relancer, par exemple sans fournisseur | — |
| MCP | Une icône satellite, teintée lorsqu'un client IA est connecté ; le mot *off*, *…* ou *error* lorsqu'il ne fonctionne pas normalement. L'infobulle nomme les clients connectés | Ouvre **Paramètres → Intégrations** |
| Historique MCP | Les écritures de l'IA dans cet onglet, de la plus récente à la plus ancienne, chacune avec **Restaurer l'état d'avant cette écriture** ; un bouton corbeille efface l'historique de l'onglet sans demander | Ouvre la liste |
| Terminal | — | Affiche ou masque le terminal |
| Mode | Le mode actuel — Source ou WYSIWYG (masqué pour les fichiers de workflow GitHub Actions) | Change de mode |
| Verrou | Si le document est en lecture seule | Active ou désactive la lecture seule |

Le côté droit est masqué tant qu'un onglet du navigateur est actif. Une barre d'état masquée réapparaît d'elle-même tant qu'un génie IA signale sa progression ou qu'un onglet du navigateur est actif.

## Détails d'édition

Quelques comportements qui fonctionnent sans aucun réglage :

- **La sélection reste visible lorsque l'éditeur perd le focus.** Cliquez dans le terminal, la barre latérale ou une fenêtre contextuelle, et le texte sélectionné garde une surbrillance atténuée, ce qui vous permet de voir sur quoi une commande ou un outil d'IA va agir. Le mode Source affiche chaque plage d'une sélection multi-curseur.
- **Taper au bord gauche du code en ligne écrit à l'intérieur.** Avec le curseur juste avant un segment de code en ligne en mode WYSIWYG — quelle que soit la façon dont vous y êtes arrivé — le caractère suivant rejoint le code au lieu d'atterrir à l'extérieur.
- **Les méthodes de saisie (IME) sont sûres.** Pendant que vous composez avec une méthode de saisie chinoise, japonaise ou coréenne, et pendant 50 ms après la fin de la composition, les raccourcis de l'éditeur et les conversions automatiques ne se déclenchent pas ; appuyer sur Entrée pour accepter un candidat ne coupe donc pas aussi le paragraphe. L'annulation et le rétablissement fonctionnent toujours. Une syllabe coréenne confirmée avec Entrée commence aussi la nouvelle ligne. Les restes de romanisation devant le texte validé sont supprimés, et un caractère validé dans une cellule de tableau vide reste tel que saisi. Les notifications informatives attendent la fin de la composition ; les erreurs et avertissements s'affichent immédiatement. Une modification d'un client IA via MCP est refusée (le client réessaie) ou retenue jusqu'à la fin de la composition, et une modification du fichier sur disque attend elle aussi : aucune n'écrase un texte que vous êtes encore en train de composer.
- **La réduction des animations est respectée.** Lorsque le réglage d'accessibilité *réduire les animations* de votre système d'exploitation est activé, VMark désactive ses animations et transitions et fait défiler instantanément plutôt que de manière fluide (mode machine à écrire compris). Il n'existe pas de réglage distinct dans VMark. Le réglage système *réduire la transparence* désactive de même le flou d'arrière-plan.

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
- Les titres longs passent sur deux lignes et s'affichent en entier au survol
- Un champ de filtre en haut du panneau réduit l'arborescence aux titres dont le texte correspond à votre requête (insensible à la casse ; les ancêtres sont conservés pour que le chemin reste visible). Appuyez sur `Échap` pour effacer.

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

### Nettoyage des images (Format → Nettoyage du texte → Nettoyer les images inutilisées…)

Trouvez et supprimez les images orphelines de votre dossier de ressources (également disponible depuis la palette de commandes). VMark montre ce qu'il a trouvé et demande confirmation avant de supprimer, et les images supprimées vont dans la corbeille du système. Une image encore utilisée par un document ouvert — y compris par des modifications non enregistrées dans une autre fenêtre VMark — est conservée. Si VMark ne peut pas confirmer qu'une image est inutilisée (par exemple, une autre fenêtre ne répond pas à temps), il ne supprime rien.

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
- Panneau État des fenêtres — voyez l'état Claude Code / IA en direct de chaque fenêtre ouverte et accédez directement à celle qui a besoin de vous ; épinglez-le dans cette fenêtre ou dans toutes les fenêtres (y compris celles que vous ouvrirez plus tard) pour le garder ouvert pendant que vous passez d'une fenêtre à l'autre

[En savoir plus →](/fr/guide/workspace-management)

## Cohérence, base de connaissances et Slidev

- **Cohérence et vue Détail** — un suivi de provenance optionnel enregistre les documents lus par chaque génération IA, signale les documents en aval lorsqu'un document en amont change, et ajoute par-dessus des vérifications sémantiques, des affirmations canoniques et des contextes. Ouvrez-la depuis **Fenêtre → Détail de cohérence**. [En savoir plus →](/fr/guide/coherence)
- **Base de connaissances** — sert un espace de travail ouvert sous forme de site interconnecté (liens wiki, rétroliens, graphe de relations, recherche plein texte) sur `127.0.0.1`, dans un panneau (`Ctrl + Shift + 4`) ou dans votre navigateur, et prévisualise et exporte des présentations Slidev. Aucune version publiée n'inclut encore l'environnement d'exécution du serveur de contenu dont elle a besoin ; le panneau, son élément de menu, sa commande de palette et son raccourci sont donc masqués tant que **Paramètres → Avancé → Outils de développement** n'est pas activé. [En savoir plus →](/fr/guide/knowledge-base)

## Personnalisation

### Thèmes

Six thèmes de couleurs intégrés :

- Blanc (propre, minimal)
- Papier (blanc cassé chaud)
- Menthe (teinte verte douce)
- Sépia (look vintage)
- Nuit (mode sombre)
- Solarized (sombre, palette Solarized)

### Polices

Configurez des polices séparées pour :

- Texte latin
- Texte CJK (chinois/japonais/coréen)
- Monospace (code)

Chaque sélecteur propose une courte liste de polices recommandées, les polices installées sur votre ordinateur et une entrée **Personnalisée…** où vous saisissez n'importe quel nom de famille de police. [Détails →](/fr/guide/settings#typographie)

La police à chasse fixe est vérifiée avant d'être utilisée, en mode Source, dans le code et dans le terminal : si la police que vous avez choisie n'est pas installée, ou s'avère ne pas être à chasse fixe, VMark se replie le long de la pile sur la suivante qui l'est. Cela compte surtout sous Linux avec une langue CJK, où un nom de police manquant peut sinon se résoudre en une police CJK proportionnelle et casser la grille du terminal.

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
