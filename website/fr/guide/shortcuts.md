# Raccourcis clavier

VMark est conçu pour les flux de travail axés sur le clavier. La plupart des raccourcis peuvent être personnalisés dans les Paramètres. Un petit nombre de primitives sont fixes&nbsp;: les sélecteurs multi-curseur `Mod+D` (Sélectionner l'occurrence suivante) et `Mod+Shift+L` (Sélectionner toutes les occurrences), ainsi que les liaisons globales Annuler/Rétablir. Les autres raccourcis multi-curseur (Ignorer l'occurrence, Annuler doux du curseur, Ajouter un curseur au-dessus/en-dessous) sont configurables. Les raccourcis marqués _(sensibles au contexte)_ sont gérés à l'intérieur de l'éditeur pour des structures spécifiques (par ex. basculement de la case à cocher de tâche) et ne sont pas exposés dans le registre de personnalisation.

## Notation

- **Mod** = Cmd sur macOS, Ctrl sur Windows/Linux
- **Alt** = Option sur macOS

## Touches de fonction sur macOS

VMark utilise les touches de fonction (F2–F10) pour des basculements de mode rapides. Sur macOS, ces touches sont mappées aux fonctions système (luminosité, volume, etc.) par défaut.

**Pour utiliser les touches F directement sans maintenir Fn :**

1. Ouvrez **Réglages Système** → **Clavier**
2. Activez **« Utiliser les touches F1, F2, etc. comme touches de fonction standard »**

Vous pouvez également maintenir la touche **Fn** enfoncée en appuyant sur F2–F10 pour déclencher les raccourcis VMark.

::: tip
Si vous préférez conserver les fonctions système sur les touches F, vous pouvez personnaliser les raccourcis VMark dans les Paramètres (`Mod + ,`) pour utiliser des combinaisons de touches différentes.
:::

### Référence rapide des touches F

| Touche | Action |
|--------|--------|
| `F2` | Problème suivant |
| `Shift + F2` | Problème précédent |
| `F3` | Afficher/masquer les caractères invisibles |
| `F4` | Trier les lignes par ordre croissant _(mode Source uniquement ; sans effet en WYSIWYG)_ |
| `Shift + F4` | Trier les lignes par ordre décroissant _(mode Source uniquement ; sans effet en WYSIWYG)_ |
| `F5` | Aperçu source |
| `F6` | Vue source (Markdown : WYSIWYG ⇄ Source ; autres formats : Source ⇄ Divisé) |
| `Shift + F6` | Divisé / Aperçu (Markdown : vue divisée ; autres formats : Aperçu ⇄ Divisé) |
| `F7` | Basculer la barre d'état |
| `F8` | Mode focus |
| `F9` | Mode machine à écrire |
| `F10` | Mode lecture seule |

## Édition

| Action | Raccourci |
|--------|----------|
| Annuler | `Mod + Z` |
| Rétablir | `Mod + Shift + Z` |

## Mise en forme du texte

| Action | Raccourci |
|--------|----------|
| Gras | `Mod + B` |
| Italique | `Mod + I` |
| Souligné | `Mod + U` |
| Barré | `Mod + Shift + X` |
| Code en ligne | Mod + Shift + `` ` `` |
| Surligné | `Mod + Shift + M` |
| Indice | `Alt + Mod + =` |
| Exposant | `Alt + Mod + Shift + =` |
| Lien | `Mod + K` |
| Ouvrir le lien (mode Source) | `Cmd + Click` |
| Supprimer le lien | `Alt + Shift + K` |
| Lien Wiki | `Alt + Mod + K` |
| Lien signet | `Alt + Mod + B` |
| Supprimer la mise en forme | `Mod + \` |

## Mise en forme des blocs

| Action | Raccourci |
|--------|----------|
| Titre 1-6 | `Mod + 1` à `Mod + 6` |
| Paragraphe | `Mod + Shift + 0` |
| Augmenter le niveau de titre | `Alt + Mod + ]` |
| Diminuer le niveau de titre | `Alt + Mod + [` |
| Citation | `Alt + Mod + Q` |
| Bloc de code | `Alt + Mod + C` |
| Liste à puces | `Alt + Mod + U` |
| Liste ordonnée | `Alt + Mod + O` |
| Liste de tâches | `Alt + Mod + X` |
| Basculer la case à cocher de tâche | `Mod + Shift + Enter` _(sensible au contexte&nbsp;; non personnalisable)_ |
| Indenter | `Mod + ]` |
| Désindenter | `Mod + [` |
| Ligne horizontale | `Alt + Mod + -` |

## Opérations sur les lignes

| Action | Raccourci |
|--------|----------|
| Monter la ligne | `Alt + Up` |
| Descendre la ligne | `Alt + Down` |
| Dupliquer la ligne | `Shift + Alt + Down` |
| Supprimer la ligne | `Mod + Shift + K` |
| Joindre les lignes | `Mod + J` |
| Trier les lignes par ordre croissant | `F4` _(mode Source uniquement)_ |
| Trier les lignes par ordre décroissant | `Shift + F4` _(mode Source uniquement)_ |

## Transformations de texte

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| MAJUSCULES | `Ctrl + Shift + U` | `Alt + Shift + U` |
| minuscules | `Ctrl + Shift + L` | `Alt + Shift + L` |
| Titre | `Ctrl + Shift + T` | `Alt + Shift + T` |
| Basculer la casse | _(personnalisable)_ | _(personnalisable)_ |
| Supprimer les lignes vides | _(personnalisable)_ | _(personnalisable)_ |
| Basculer le style de guillemets | `Shift + Mod + '` | `Shift + Mod + '` |

## Insérer

| Action | Raccourci |
|--------|----------|
| Insérer une image | `Mod + Shift + I` |
| Insérer une vidéo | — |
| Insérer un audio | — |
| Insérer un tableau | `Mod + Shift + T` |
| Table des matières | _(personnalisable)_ |
| Mathématiques en ligne | `Alt + Mod + M` |
| Bloc mathématique | `Alt + Mod + Shift + M` |
| Insérer une note | `Alt + Mod + N` |
| Insérer un conseil | `Alt + Mod + Shift + T` |
| Insérer un avertissement | `Mod + Shift + W` |
| Insérer un important | `Alt + Mod + Shift + I` |
| Insérer une mise en garde | `Mod + Shift + U` |
| Insérer un réductible | `Alt + Mod + D` |
| Insérer un diagramme | `Alt + Mod + Shift + D` |
| Insérer un diagramme Graphviz | _(personnalisable)_ |
| Insérer une carte mentale | `Alt + Mod + Shift + K` |
| Basculer le commentaire | `Mod + /` |

## Sélection et multi-curseur

| Action | Raccourci |
|--------|----------|
| Sélectionner la ligne | `Mod + L` |
| Sélectionner toutes les occurrences du bloc | `Alt + Mod + Shift + L` |
| Étendre la sélection | `Ctrl + Shift + Up` |
| Sélectionner l'occurrence suivante | `Mod + D` |
| Ignorer l'occurrence | `Mod + Shift + D` |
| Sélectionner toutes les occurrences | `Mod + Shift + L` |
| Annuler doux du curseur | `Alt + Mod + Z` |
| Ajouter un curseur au-dessus | `Mod + Alt + Up` |
| Ajouter un curseur en-dessous | `Mod + Alt + Down` |
| Réduire le multi-curseur | `Escape` |

## Rechercher et remplacer

| Action | Raccourci |
|--------|----------|
| Rechercher et remplacer | `Mod + F` |
| Trouver le suivant | `Mod + G` |
| Trouver le précédent | `Mod + Shift + G` |
| Utiliser la sélection pour la recherche | `Mod + E` |
| Rechercher dans les fichiers | `Mod + Shift + H` |

## Affichage et mode

| Action | Raccourci |
|--------|----------|
| Vue source (Markdown ⇄ Source ; autres formats Source ⇄ Divisé) | `F6` |
| Divisé / Aperçu (Markdown divisé ; autres formats Aperçu ⇄ Divisé) | `Shift + F6` |
| Diviser l'éditeur — deux documents | `Alt + Mod + \` |
| Basculer la barre d'état | `F7` |
| Mode focus | `F8` |
| Mode machine à écrire | `F9` |
| Mode lecture seule | `F10` |
| Taille réelle | `Mod + 0` |
| Zoom avant | `Mod + =` |
| Zoom arrière | `Mod + -` |
| Retour à la ligne | `Alt + Z` |
| Dernier onglet utilisé | `Ctrl + Tab` |
| Diviser l'éditeur — deux documents | `Alt + Mod + \` |
| Fermer le volet | `Alt + Mod + Shift + \` |
| Activer l'autre volet | `Alt + Mod + Shift + O` |
| Basculer la barre latérale | `Ctrl + Shift + 0` |
| Basculer le plan | `Ctrl + Shift + 1` |
| Basculer l'explorateur de fichiers | `Ctrl + Shift + 2` |
| Basculer l'historique | `Ctrl + Shift + 3` |
| Afficher/masquer la base de connaissances | `Ctrl + Shift + 4` |
| Afficher/masquer l'état des fenêtres | `Ctrl + Shift + 5` |
| Basculer les numéros de ligne (gouttière Source/vue divisée) | `Alt + Mod + L` |
| Basculer le terminal | Ctrl + `` ` `` |
| Activer le terminal ou l'éditeur | Ctrl + Shift + `` ` `` (Alt + Shift + `` ` `` sous Windows/Linux) |
| Afficher/masquer l'aperçu des diagrammes | `Alt + Mod + P` |
| Ajuster les tableaux à la largeur | _(personnalisable)_ |
| Ouvrir la barre d'outils universelle | `Mod + Shift + B` |
| Aperçu source | `F5` |
| Vérifier le Markdown | `Alt + Mod + V` |
| Problème suivant | `F2` |
| Problème précédent | `Shift + F2` |

::: tip Afficher/masquer la base de connaissances
`Ctrl + Shift + 4` est masqué par défaut, de même que l'élément de menu **Affichage → Base de
connaissances** et la commande de la palette. Aucune version publiée, sur aucune plateforme,
n'embarque le runtime de serveur de contenu dont la fonctionnalité a besoin ; ces points d'entrée
n'apparaissent donc que lorsque **Paramètres → Avancé → Outils de développement** est activé — voir
[Base de connaissances et Slidev](/fr/guide/knowledge-base#prerequis). Le raccourci
reste listé et personnalisable dans **Paramètres → Raccourcis** dans tous les cas.
:::

## Opérations sur les fichiers

| Action | Raccourci |
|--------|----------|
| Nouveau fichier | `Mod + N` |
| Ouverture rapide | `Mod + O` _(navigateur de fichiers flou)_ |
| Ouvrir la palette de commandes | `Mod + Shift + P` |
| Ouvrir un fichier… | Menu seulement _(sélecteur de fichiers natif)_ |
| Ouvrir un espace de travail | `Mod + Shift + O` |
| Enregistrer | `Mod + S` |
| Enregistrer sous | `Mod + Shift + S` |
| Enregistrer tout et quitter | `Alt + Mod + Shift + Q` |
| Déplacer vers | Menu seulement |
| Fermer | `Mod + W` |
| Exporter en HTML | Menu seulement |
| Imprimer | `Mod + P` |
| Exporter en PDF | — |
| Paramètres | `Mod + ,` |

## Presse-papiers

| Action | Raccourci |
|--------|----------|
| Copier en HTML | `Mod + Shift + C` |
| Coller en texte brut | `Mod + Shift + V` |

## Génies IA

| Action | Raccourci |
|--------|----------|
| Ouvrir les Génies IA | `Mod + Y` |
| Accepter la suggestion | `Enter` |
| Rejeter la suggestion | `Escape` |
| Suggestion suivante | `Tab` |
| Suggestion précédente | `Shift + Tab` |
| Accepter toutes les suggestions | `Mod + Shift + Enter` |
| Rejeter toutes les suggestions | `Mod + Shift + Escape` |

## Mise en forme CJK

| Action | Raccourci |
|--------|----------|
| Formater la sélection | `Mod + Shift + F` |
| Formater le document | `Alt + Mod + Shift + F` |

## Fenêtres et onglets

| Action | Raccourci |
|--------|----------|
| Nouvelle fenêtre | `Mod + Shift + N` |
| Nouvel onglet | `Mod + T` |
| Nouvel onglet de navigateur | `Alt + Mod + Shift + B` |
| Onglet suivant | `Mod + Shift + ]` |
| Onglet précédent | `Mod + Shift + [` |
| Fermer l'onglet | `Mod + W` |
| Rouvrir l'onglet fermé | _(personnalisable)_ |
| Afficher/masquer les fichiers cachés | `Mod + Shift + .` |
| Afficher/masquer tous les fichiers | `Mod + Shift + A` |

::: tip Note Windows/Linux
Afficher/masquer les fichiers cachés utilise `Ctrl + H` sur Windows et Linux.

Basculer la barre latérale utilise `Alt + Shift + 0` sur Windows et Linux, car `Mod` y est
Ctrl — la combinaison macOS `Ctrl + Shift + 0` entrerait donc en conflit avec le
`Mod + Shift + 0` de Paragraphe.
:::

::: tip Nouvel onglet de navigateur
`Alt + Mod + Shift + B` ouvre un onglet de navigateur intégré, et apparaît aussi dans le menu
**Fichier**. Le navigateur intégré est activé par défaut sur macOS ; si vous le désactivez
dans **Paramètres → Avancé → Navigateur intégré**, l'élément de menu est masqué
(et non grisé) jusqu'à ce que vous le réactiviez. Le navigateur est réservé à macOS ;
l'élément n'apparaît donc jamais sous Windows ni sous Linux.

Il s'agit d'un véritable élément de menu et pas seulement d'un raccourci clavier, et c'est important : dès qu'une
page web a le focus clavier, le moteur du navigateur consomme les frappes avant que VMark
ne les voie, de sorte qu'un raccourci interne à l'application ne peut pas se déclencher. Un accélérateur de menu est
distribué par macOS lui-même ; il fonctionne donc toujours pendant que vous naviguez.
:::

## Aide (macOS uniquement)

| Action | Raccourci |
|--------|----------|
| Rechercher dans les menus | `Cmd + Shift + /` |

::: tip
Il s'agit d'un raccourci système natif macOS qui recherche dans tous les éléments de menu. Tapez un mot-clé pour trouver et exécuter n'importe quelle action de menu.
:::

## Navigation intelligente par Tab

Tab et Shift+Tab sont sensibles au contexte — ils permettent de sortir des crochets, guillemets, marques de mise en forme et liens.

| Contexte | Action de Tab |
|---------|--------------|
| Avant `)`, `]`, `}`, guillemets | Sauter après le caractère fermant |
| Avant les crochets CJK `」`, `』`, etc. | Sauter après le crochet fermant |
| À l'intérieur de **gras**, *italique*, `code` | Sauter après la mise en forme |
| À l'intérieur d'un lien | Sauter après le lien |

| Contexte | Action de Shift+Tab |
|---------|---------------------|
| Après `(`, `[`, `{`, guillemets | Sauter avant le caractère ouvrant |
| Après les crochets CJK `「`, `『`, etc. | Sauter avant le crochet ouvrant |
| À l'intérieur de **gras**, *italique*, `code` | Sauter avant la mise en forme |
| À l'intérieur d'un lien | Sauter avant le lien |

::: tip
Consultez la [Navigation intelligente par Tab](/fr/guide/tab-navigation) pour le guide complet incluant les crochets CJK, les guillemets courbés et les paramètres.
:::

## Édition des tableaux

Quand le curseur est à l'intérieur d'un tableau :

| Action | Raccourci |
|--------|----------|
| Cellule suivante | `Tab` |
| Cellule précédente | `Shift + Tab` |
| Ajouter une ligne en-dessous | `Mod + Enter` |
| Ajouter une ligne au-dessus | `Mod + Shift + Enter` |
| Supprimer la ligne | `Mod + Backspace` |
| Formater le tableau | `Alt + Mod + T` |
| Quitter le tableau | Touches fléchées en bord de tableau |

## Navigation dans les popups

Quand un popup est ouvert (lien, image, mathématiques, etc.) :

| Action | Raccourci |
|--------|----------|
| Fermer le popup | `Escape` |
| Confirmer/Enregistrer | `Enter` |
| Naviguer entre les champs | `Tab` / `Shift + Tab` |

## Édition des blocs mathématiques

Quand vous modifiez un bloc mathématique :

| Action | Raccourci |
|--------|----------|
| Valider et quitter | `Mod + Enter` |
| Annuler et quitter | `Escape` |

## Terminal

Quand le terminal intégré est focalisé :

| Action | Raccourci |
|--------|----------|
| Basculer le terminal | `` Ctrl + ` `` |
| Activer le terminal ou l'éditeur | `` Ctrl + Shift + ` `` (`` Alt + Shift + ` `` sous Windows/Linux) |
| Copier | `Mod + C` (avec sélection) ; sous Linux aussi `Ctrl + Shift + C` ou `Ctrl + Insert` |
| Coller | `Mod + V` ; sous Linux aussi `Ctrl + Shift + V` ou `Shift + Insert` |
| Tout sélectionner (sortie du terminal uniquement) | `Mod + A` (`Ctrl + Shift + A` sous Linux) |
| Effacer | `Mod + K` (`Ctrl + Shift + K` sous Linux) |
| Rechercher | `Mod + F` (`Ctrl + Shift + F` sous Linux) |
| Passer à la session 1–5 | `Mod + 1` à `Mod + 5` |
| Agrandir la police du terminal | `Mod + =` |
| Réduire la police du terminal | `Mod + -` |
| Taille de police par défaut du terminal | `Mod + 0` |
| Invite de commande précédente | `Mod + ↑` |
| Invite de commande suivante | `Mod + ↓` |
| Nouvelle ligne dans la ligne de saisie (Claude Code et outils similaires) | `Shift + Enter` |

Quand le terminal est focalisé, `Mod + =`, `Mod + -` et `Mod + 0` redimensionnent la police du terminal au lieu de celle de l'éditeur.

La navigation entre invites saute d'une invite de commande à l'autre dans l'historique de défilement et nécessite l'intégration shell (zsh ou bash).

Sur macOS, le terminal traduit aussi pour le shell les combinaisons habituelles d'édition de texte :

| Action | Raccourci |
|--------|----------|
| Déplacer d'un mot vers la gauche / droite | `Option + ←` / `Option + →` |
| Aller au début / à la fin de la ligne | `Cmd + ←` / `Cmd + →` |
| Supprimer la ligne de saisie (envoie `Ctrl + U`) | `Cmd + Backspace` |

Sur macOS, les combinaisons `Ctrl` comme `Ctrl + A`, `Ctrl + R` et `Ctrl + W` sont transmises directement au shell.

Sous Linux, le terminal suit la convention habituelle des terminaux Linux : les combinaisons simples `Ctrl` + lettre vont au shell, si bien que les touches readline comme `Ctrl + A`, `Ctrl + E`, `Ctrl + K`, `Ctrl + F`, `Ctrl + U` et `Ctrl + W` fonctionnent comme dans tout autre terminal Linux, et les actions propres au terminal passent sur `Ctrl + Shift` : `Ctrl + Shift + A` sélectionne tout, `Ctrl + Shift + K` efface, `Ctrl + Shift + F` recherche, et `Ctrl + Shift + C` / `Ctrl + Shift + V` copient et collent. `Ctrl + Insert` et `Shift + Insert` copient et collent aussi. Le terminal garde deux combinaisons `Ctrl` simples : `Ctrl + C` copie une sélection (et envoie SIGINT quand rien n'est sélectionné), et `Ctrl + V` colle. `Ctrl + 1` à `Ctrl + 5` changent toujours de session.

Quand la barre de recherche du terminal est ouverte :

| Action | Raccourci |
|--------|----------|
| Occurrence suivante | `Enter` |
| Occurrence précédente | `Shift + Enter` |
| Fermer la recherche | `Escape` |

::: tip
`Mod + C` sans sélection envoie SIGINT au processus en cours d'exécution. Consultez le [Terminal intégré](/fr/guide/terminal) pour le guide complet.
:::

## Personnaliser les raccourcis

1. Ouvrez les Paramètres avec `Mod + ,`
2. Naviguez vers l'onglet **Raccourcis** (tapez dans le champ de recherche pour filtrer par nom, catégorie, description ou touche)
3. Cliquez sur la touche affichée à côté d'un raccourci — ou sur **Non attribué** pour un raccourci qui n'a pas encore de touche
4. Appuyez sur la combinaison de touches souhaitée, puis cliquez sur **Assigner** (`Escape` annule)

La boîte de dialogue vous avertit avant que vous n'attribuiez une combinaison :

- **Conflit** — la combinaison est déjà utilisée par un autre raccourci, qu'elle nomme. Vous pouvez tout de même choisir **Assigner quand même**.
- **Non prise en charge** — VMark ne peut pas utiliser cette combinaison, elle ne peut donc pas être attribuée. Essayez-en une autre.

Un raccourci personnalisé est mis en évidence et reçoit un bouton **Rétablir les valeurs par défaut**. **Tout réinitialiser** restaure toutes les valeurs par défaut après confirmation. **Exporter** enregistre vos raccourcis dans un fichier JSON (`vmark-shortcuts.json`) et **Importer** en charge un ; si une entrée du fichier est invalide, rien n'est importé et les problèmes sont listés.

::: tip
Les raccourcis se synchronisent avec les accélérateurs de menu le cas échéant, les éléments de menu afficheront donc vos raccourcis personnalisés.
:::
