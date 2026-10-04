# Fenêtres contextuelles en ligne

VMark fournit des fenêtres contextuelles pour modifier les liens, images, médias, maths, notes de bas de page et plus encore. Ces fenêtres fonctionnent en modes WYSIWYG et Source avec une navigation clavier cohérente.

## Raccourcis clavier communs

Toutes les fenêtres contextuelles partagent ces comportements clavier :

| Action | Raccourci |
|--------|----------|
| Fermer/Annuler | `Escape` |
| Confirmer/Enregistrer | `Enter` |
| Naviguer entre les champs | `Tab` / `Shift + Tab` |

## Fenêtre contextuelle de lien

Cliquer sur un lien affiche sa fenêtre contextuelle d'édition. Le curseur reste là où vous avez cliqué, vous pouvez donc continuer à modifier le texte du lien — la saisie, `Backspace` et le copier/coller agissent tous sur le document. La fenêtre contextuelle se ferme dès que vous modifiez le texte ou déplacez le curseur hors du lien.

### Modifier un lien existant

**Déclencheur :** Cliquez sur un lien, ou placez le curseur dans un lien + `Mod + K`

Un clic laisse le clavier dans le document ; cliquez dans le champ URL pour modifier la destination. `Mod + K` place directement le focus dans le champ URL.

**Champs :**

- **URL** — Modifier la destination du lien
- **Ouvrir la cible** — Ouvre une URL externe dans le navigateur, accède au titre pour les liens `#bookmark`, ou ouvre un fichier local dans un nouvel onglet pour les liens entre fichiers
- **Copier** — Copier l'URL dans le presse-papiers
- **Supprimer** — Supprimer le lien, conserver le texte

**Ouvrir sans la fenêtre contextuelle :** `Cmd + Click` (`Ctrl + Click` sous Windows/Linux) sur un lien ouvre directement sa cible.

### Créer un nouveau lien

**Déclencheur :** Sélectionnez du texte + `Mod + K`

**Presse-papiers intelligent :** Si votre presse-papiers contient une URL, elle est remplie automatiquement.

**Champs :**

- **Saisie d'URL** — Entrez la destination
- **Confirmer** — Appuyez sur Entrée ou cliquez sur ✓
- **Annuler** — Appuyez sur Échap ou cliquez sur ✗

### Mode Source

- **`Cmd + Click`** (`Ctrl + Click` sous Windows/Linux) sur le lien → les URL externes s'ouvrent dans le navigateur, les liens `#bookmark` accèdent au titre, et les chemins de fichiers locaux ouvrent le fichier dans un nouvel onglet
- **Clic** sur la syntaxe `[text](url)` → affiche la fenêtre contextuelle d'édition ; le curseur reste dans le markdown pour que vous puissiez continuer à taper
- **`Mod + K`** à l'intérieur du lien → affiche la fenêtre contextuelle d'édition avec le focus dans le champ URL

::: tip Liens signet
Les liens commençant par `#` sont traités comme des signets (liens de titre internes). Ouvrir accède au titre au lieu d'ouvrir un navigateur.
:::

::: tip Liens entre fichiers
Les liens pointant vers des fichiers locaux ouvrent le fichier cible dans un nouvel onglet, en se positionnant sur le titre lorsque le lien comporte un `#fragment`. Les chemins relatifs comme `../appendix/cards.md` ou `./notes.md` sont résolus par rapport au dossier du document actuel. Les chemins absolus — `/Users/me/notes/a.md` sous macOS/Linux, `C:\notes\a.md` sous Windows — ouvrent exactement le fichier qu'ils désignent. Les chemins réseau (`\\server\share\…`) ne sont pas ouverts depuis un lien. Si le document est sans titre, seuls les chemins absolus peuvent être ouverts.
:::

## Sélecteur de titres (liens signet)

**Déclencheur :** `Alt + Mod + B` (Lien signet), **Insertion → Liens → Signet**, ou le groupe de liens de la barre d'outils universelle

Un lien signet pointe vers un titre du même document (`[text](#heading-id)`). Au lieu de taper l'ancre, le sélecteur liste tous les titres du document, indentés selon leur niveau, avec un champ de filtre en haut.

**Comportement :**

- `↑`/`↓` parcourent la liste, `Enter` insère le lien, `Escape` ferme
- Avec du texte sélectionné, la sélection devient le texte du lien ; sans sélection, le texte du titre lui-même est inséré comme lien
- La fenêtre contextuelle l'indique lorsque le document ne contient aucun titre, ou lorsque rien ne correspond au filtre

## Fenêtre contextuelle multimédia (Images, Vidéo, Audio)

Une fenêtre contextuelle unifiée pour modifier tous les types de médias — images, vidéo et audio.

### Fenêtre contextuelle d'édition

**Déclencheur :** Double-cliquez sur n'importe quel élément multimédia (image, vidéo ou audio)

**Champs communs (tous les types de médias) :**

- **Source** — Chemin du fichier ou URL

**Champs spécifiques au type :**

| Champ | Image | Vidéo | Audio |
|-------|-------|-------|-------|
| Texte alternatif | Oui | — | — |
| Titre | — | Oui | Oui |
| Couverture | — | Oui | — |
| Dimensions | Lecture seule | — | — |
| Basculer en ligne/bloc | Oui (sauf images liées) | — | — |

**Boutons :**

- **Parcourir** — Sélectionner un fichier depuis le système de fichiers
- **Copier** — Copier le chemin source dans le presse-papiers
- **Supprimer** — Supprimer l'élément multimédia

**Raccourcis :**

- `Mod + Shift + I` — Insérer une nouvelle image
- `Enter` — Enregistrer les modifications
- `Escape` — Fermer la fenêtre contextuelle

### Mode Source

En mode Source, cliquer sur la syntaxe d'image `![alt](path)` ouvre la même fenêtre contextuelle multimédia.

Le mode Source affiche aussi une **prévisualisation** flottante du média — une image, ou un lecteur vidéo ou audio avec des contrôles de lecture natifs. Elle apparaît tant que le curseur se trouve dans `![alt](path)` (sans texte sélectionné), et lorsque la souris survole la syntaxe ; la prévisualisation du curseur l'emporte sur celle du survol. Le chemin doit se terminer par une extension d'image, de vidéo ou d'audio reconnue (ou être une URL `data:image/`). La prévisualisation est masquée tant que la fenêtre contextuelle multimédia est ouverte.

## Menu contextuel d'image

Un clic droit sur une image en mode WYSIWYG ouvre un menu contextuel avec des actions rapides (séparé de la fenêtre contextuelle de modification par double-clic).

**Déclencheur :** Clic droit sur n'importe quelle image

**Actions :**

| Action | Description |
|--------|-------------|
| Changer l'image | Ouvrir un sélecteur de fichiers pour remplacer l'image |
| Supprimer l'image | Supprimer l'image du document |
| Copier le chemin | Copier le chemin source de l'image dans le presse-papiers |
| Révéler dans le Finder | Ouvrir l'emplacement du fichier image dans votre gestionnaire de fichiers (le libellé s'adapte selon la plateforme) |

Appuyez sur `Escape` pour fermer le menu contextuel sans effectuer d'action.

## Fenêtre contextuelle mathématique

Modifier les expressions mathématiques LaTeX avec une prévisualisation en direct.

**Déclencheur :**

- **WYSIWYG :** Cliquer sur les maths en ligne `$...$`
- **Source :** Placer le curseur à l'intérieur d'un `$...$` non vide, d'un bloc `$$...$$`, ou d'un bloc ` ```latex ` / ` ```math `

**Champs :**

- **Saisie LaTeX** — Modifier l'expression mathématique
- **Prévisualisation** — Aperçu rendu en temps réel
- **Affichage d'erreur** — Affiche les erreurs LaTeX avec des suggestions de syntaxe utiles

**Raccourcis :**

- `Mod + Enter` — Enregistrer et fermer
- `Click outside` — Enregistrer et fermer (valide vos modifications)
- `Escape` — Annuler et fermer (abandonne vos modifications)
- `Shift + Backspace` — Supprimer les maths en ligne (fonctionne même si non vide, WYSIWYG uniquement)
- `Alt + Mod + M` — Insérer de nouvelles maths en ligne

::: tip Suggestions d'erreur
Lorsque vous avez une erreur de syntaxe LaTeX, la fenêtre contextuelle affiche des suggestions utiles comme les accolades manquantes, les commandes inconnues ou les délimiteurs non équilibrés.
:::

::: info Mode Source
Le mode Source propose la même fenêtre contextuelle de maths modifiable que le mode WYSIWYG — une zone de texte pour la saisie LaTeX avec un aperçu KaTeX en direct en dessous. La fenêtre s'ouvre automatiquement lorsque le curseur entre dans une syntaxe mathématique (un `$...$` non vide, `$$...$$` ou ` ```latex ` / ` ```math `). Appuyez sur `Mod + Enter` pour enregistrer ou `Escape` pour annuler. Un `$$` vide tapé en fin de ligne est traité comme du texte brut — probablement un délimiteur de bloc mathématique à moitié tapé — et n'ouvre pas la fenêtre contextuelle.
:::

## Fenêtre contextuelle de note de bas de page

Modifier le contenu des notes de bas de page en ligne.

**Déclencheur :**

- **WYSIWYG :** Survoler la référence de note de bas de page `[^1]`
- **Source :** Survoler ou cliquer sur une référence ou une définition de note de bas de page

**Champs :**

- **Contenu** — Texte de note de bas de page multiligne (redimensionnement automatique)
- **Aller à la définition** — Accéder à la définition de la note de bas de page
- **Supprimer** — Supprimer la note de bas de page

**Comportement :**

- Les nouvelles notes de bas de page mettent automatiquement au point le champ de contenu
- La zone de texte se développe au fil de la saisie

## Fenêtre contextuelle de lien wiki

Modifier les liens de style wiki pour les connexions internes de documents.

**Déclencheur :**

- **WYSIWYG :** Survoler `[[target]]` (délai de 300ms)
- **Source :** Cliquer sur la syntaxe de lien wiki

**Champs :**

- **Cible** — Chemin relatif à l'espace de travail (l'extension `.md` est gérée automatiquement)
- **Parcourir** — Sélectionner un fichier depuis l'espace de travail
- **Ouvrir** — Ouvrir le document lié
- **Copier** — Copier le chemin cible
- **Supprimer** — Supprimer le lien wiki

## Menu contextuel de tableau

Actions d'édition rapides pour les tableaux.

**Déclencheur :**

- **WYSIWYG :** Clic droit sur une cellule de tableau (les mêmes actions sont aussi disponibles dans la barre d'outils et via des raccourcis clavier)
- **Source :** Clic droit sur une cellule de tableau

**Actions :**

| Action | Description |
|--------|-------------|
| Insérer une ligne au-dessus/en-dessous | Ajouter une ligne au curseur |
| Insérer une colonne à gauche/droite | Ajouter une colonne au curseur |
| Supprimer la ligne | Supprimer la ligne actuelle |
| Supprimer la colonne | Supprimer la colonne actuelle |
| Supprimer le tableau | Supprimer l'intégralité du tableau |
| Aligner la colonne à gauche/centre/droite | Définir l'alignement pour la colonne actuelle |
| Aligner tout à gauche/centre/droite | Définir l'alignement pour toutes les colonnes |
| Formater le tableau | Aligner automatiquement les colonnes du tableau (embellir le markdown) |
| Ajuster à la largeur / Largeur naturelle | WYSIWYG uniquement : fixer ce tableau à la largeur de l'éditeur avec des colonnes proportionnelles au contenu, ou lui rendre sa largeur naturelle |

## Fenêtre contextuelle de vérification orthographique

Corriger les erreurs orthographiques avec des suggestions.

**Déclencheur :**

- Clic droit sur un mot mal orthographié (souligné en rouge)

**Actions :**

- **Suggestions** — Cliquer pour remplacer par la suggestion
- **Ajouter au dictionnaire** — Arrêter de marquer comme mal orthographié

## Déplacer du texte par glisser

En mode WYSIWYG, vous pouvez déplacer une sélection à la souris : appuyez sur le texte sélectionné, faites-le glisser — un curseur de dépôt indique où il atterrira — puis relâchez. Le déplacement est une seule étape annulable (`Mod + Z` le remet en place). Appuyez sur `Escape` pendant le glissement, ou laissez la fenêtre perdre le focus, pour annuler. VMark l'implémente lui-même car l'enveloppe de bureau intercepte les événements de glisser natifs du navigateur ; c'est pourquoi il s'agit d'un geste de souris plutôt que du glisser-déposer du système.

## Comparaison des modes

| Élément | Édition WYSIWYG | Source |
|---------|-----------------|--------|
| Lien | Clic / `Mod+K` / `Cmd+Click` pour ouvrir | Clic / `Mod+K` / `Cmd+Click` pour ouvrir |
| Image | Double-clic | Clic sur `![](path)` |
| Vidéo | Double-clic | — |
| Audio | Double-clic | — |
| Maths | Clic | Curseur dans les maths → popup |
| Note de bas de page | Survol | Édition directe |
| Lien wiki | Survol | Clic |
| Tableau | Barre d'outils | Menu clic droit |
| Vérification orthographique | Clic droit | Clic droit |

## Conseils de navigation dans les fenêtres contextuelles

### Flux de focus

1. La fenêtre contextuelle s'ouvre avec la première entrée mise au point
2. `Tab` se déplace vers l'avant dans les champs et boutons
3. `Shift + Tab` se déplace vers l'arrière
4. Le focus se boucle à l'intérieur de la fenêtre contextuelle

### Édition rapide

- Pour les modifications d'URL simples : modifiez et appuyez sur `Enter`
- Pour annuler : appuyez sur `Escape` depuis n'importe quel champ
- Pour le contenu multiligne (notes de bas de page, maths) : utilisez `Mod + Enter` pour enregistrer

### Comportement de la souris

- Cliquer en dehors de la fenêtre contextuelle pour la fermer. Le comportement par défaut est d'**abandonner** les
  modifications non enregistrées ; la fenêtre contextuelle mathématique fait exception et **valide** la modification
  lors d'un clic à l'extérieur (voir la section [Fenêtre contextuelle mathématique](#fenetre-contextuelle-mathematique)).
- Les fenêtres contextuelles au survol (note de bas de page, wiki) ont un délai de 300ms avant l'affichage
- Ramener la souris vers la fenêtre contextuelle la maintient ouverte

<!-- Styles in style.css -->
