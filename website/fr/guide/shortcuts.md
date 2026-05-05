# Raccourcis clavier

VMark est conçu pour les flux de travail axés sur le clavier. La plupart des raccourcis peuvent être personnalisés dans les Paramètres. Un petit nombre de primitives sont fixes&nbsp;: les sélecteurs multi-curseur `Mod+D` (Sélectionner l'occurrence suivante) et `Mod+Shift+L` (Sélectionner toutes les occurrences), ainsi que les liaisons globales Annuler/Rétablir. Les autres raccourcis multi-curseur (Ignorer l'occurrence, Annuler doux du curseur, Ajouter un curseur au-dessus/en-dessous) sont configurables. Les raccourcis marqués _(sensibles au contexte)_ sont gérés à l'intérieur de l'éditeur pour des structures spécifiques (par ex. basculement de la case à cocher de tâche) et ne sont pas exposés dans le registre de personnalisation.

## Notation

- **Mod** = Cmd sur macOS, Ctrl sur Windows/Linux
- **Alt** = Option sur macOS

## Touches de fonction sur macOS

VMark utilise les touches de fonction (F4–F10) pour des basculements de mode rapides. Sur macOS, ces touches sont mappées aux fonctions système (luminosité, volume, etc.) par défaut.

**Pour utiliser les touches F directement sans maintenir Fn :**

1. Ouvrez **Préférences Système** → **Clavier**
2. Activez **« Utiliser les touches F1, F2, etc. comme touches de fonction standard »**

Vous pouvez également maintenir la touche **Fn** enfoncée en appuyant sur F4–F10 pour déclencher les raccourcis VMark.

::: tip
Si vous préférez conserver les fonctions système sur les touches F, vous pouvez personnaliser les raccourcis VMark dans les Paramètres (`Mod + ,`) pour utiliser des combinaisons de touches différentes.
:::

### Référence rapide des touches F

| Touche | Action |
|--------|--------|
| `F2` | Problème suivant |
| `Shift + F2` | Problème précédent |
| `F4` | Trier les lignes croissant |
| `Shift + F4` | Trier les lignes décroissant |
| `F5` | Aperçu source |
| `F6` | Basculer le mode Source |
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
| Code en ligne | `Mod + Shift +` `` ` `` |
| Surligné | `Mod + Shift + M` |
| Indice | `Alt + Mod + =` |
| Exposant | `Alt + Mod + Shift + =` |
| Lien | `Mod + K` |
| Ouvrir le lien (mode Source) | `Cmd + Clic` |
| Supprimer le lien | `Alt + Shift + K` |
| Lien Wiki | `Alt + Mod + K` |
| Lien favori | `Alt + Mod + B` |
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
| Changer le type de liste | _(personnalisable)_ |
| Indenter | `Mod + ]` |
| Désindenter | `Mod + [` |
| Ligne horizontale | `Alt + Mod + -` |

## Opérations sur les lignes

| Action | Raccourci |
|--------|----------|
| Monter la ligne | `Alt + Haut` |
| Descendre la ligne | `Alt + Bas` |
| Dupliquer la ligne | `Shift + Alt + Bas` |
| Supprimer la ligne | `Mod + Shift + K` |
| Joindre les lignes | `Mod + J` |
| Trier les lignes croissant | `F4` |
| Trier les lignes décroissant | `Shift + F4` |

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
| Mathématiques en ligne | `Alt + Mod + M` |
| Bloc mathématique | `Alt + Mod + Shift + M` |
| Insérer une note | `Alt + Mod + N` |
| Insérer un conseil | `Alt + Mod + Shift + T` |
| Insérer un avertissement | `Mod + Shift + W` |
| Insérer un important | `Alt + Mod + Shift + I` |
| Insérer une mise en garde | `Mod + Shift + U` |
| Insérer un réductible | `Alt + Mod + D` |
| Insérer un diagramme | `Alt + Shift + Mod + D` |
| Insérer une carte mentale | `Alt + Shift + Mod + K` |
| Basculer le commentaire | `Mod + /` |

## Sélection et multi-curseur

| Action | Raccourci |
|--------|----------|
| Sélectionner la ligne | `Mod + L` |
| Étendre la sélection | `Ctrl + Shift + Haut` |
| Sélectionner l'occurrence suivante | `Mod + D` |
| Ignorer l'occurrence | `Mod + Shift + D` |
| Sélectionner toutes les occurrences | `Mod + Shift + L` |
| Annuler doux du curseur | `Alt + Mod + Z` |
| Ajouter un curseur au-dessus | `Mod + Alt + Haut` |
| Ajouter un curseur en-dessous | `Mod + Alt + Bas` |
| Réduire le multi-curseur | `Échap` |

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
| Basculer le mode Source | `F6` |
| Basculer la barre d'état | `F7` |
| Mode focus | `F8` |
| Mode machine à écrire | `F9` |
| Mode lecture seule | `F10` |
| Taille réelle | `Mod + 0` |
| Zoom avant | `Mod + =` |
| Zoom arrière | `Mod + -` |
| Retour à la ligne | `Alt + Z` |
| Basculer le plan | `Ctrl + Shift + 1` |
| Basculer l'explorateur de fichiers | `Ctrl + Shift + 2` |
| Basculer l'historique | `Ctrl + Shift + 3` |
| Basculer les numéros de ligne (blocs de code) | `Alt + Mod + L` |
| Basculer le terminal | Ctrl + `` ` `` |
| Basculer l'aperçu du diagramme | `Alt + Mod + P` |
| Ajuster les tableaux à la largeur | _(personnalisable)_ |
| Barre d'outils universelle | `Mod + Shift + P` |
| Aperçu source | `F5` |
| Vérifier le Markdown | `Alt + Mod + V` |
| Problème suivant | `F2` |
| Problème précédent | `Shift + F2` |

## Opérations sur les fichiers

| Action | Raccourci |
|--------|----------|
| Nouveau fichier | `Mod + N` |
| Ouverture rapide | `Mod + O` |
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
| Rejeter la suggestion | `Échap` |
| Suggestion suivante | `Tab` |
| Suggestion précédente | `Shift + Tab` |
| Accepter toutes les suggestions | `Mod + Shift + Enter` |
| Rejeter toutes les suggestions | `Mod + Shift + Échap` |

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
| Fermer l'onglet | `Mod + W` |
| Basculer les fichiers cachés | `Mod + Shift + .` |
| Basculer tous les fichiers | _(personnalisable)_ |

::: tip Note Windows/Linux
Basculer les fichiers cachés utilise `Ctrl + H` sur Windows et Linux.
:::

## Aide (macOS uniquement)

| Action | Raccourci |
|--------|----------|
| Rechercher dans les menus | `Cmd + Shift + /` |

::: tip
Il s'agit d'un raccourci système natif macOS qui recherche dans tous les éléments de menu. Tapez un mot-clé pour trouver et exécuter n'importe quelle action de menu.
:::

## Navigation intelligente par Tab

Tab et Shift+Tab sont sensibles au contexte — ils vous permettent d'échapper aux crochets, guillemets, marques de mise en forme et liens sans utiliser les touches fléchées.

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
| Supprimer la ligne | `Mod + Retour arrière` |
| Ajouter une colonne à gauche | `Alt + Mod + Left` |
| Ajouter une colonne à droite | `Alt + Mod + Right` |
| Supprimer la colonne | `Alt + Mod + Retour arrière` |
| Aligner la colonne à gauche | `Mod + Alt + Shift + L` |
| Aligner la colonne à droite | `Mod + Shift + R` |
| Centrer la colonne | _(personnalisable)_ |
| Formater le tableau | `Alt + Mod + T` |
| Quitter le tableau | Touches fléchées en bord de tableau |

## Navigation dans les popups

Quand un popup est ouvert (lien, image, mathématiques, etc.) :

| Action | Raccourci |
|--------|----------|
| Fermer le popup | `Échap` |
| Confirmer/Enregistrer | `Enter` |
| Naviguer entre les champs | `Tab` / `Shift + Tab` |

## Édition des blocs mathématiques

Quand vous modifiez un bloc mathématique :

| Action | Raccourci |
|--------|----------|
| Valider et quitter | `Mod + Enter` |
| Annuler et quitter | `Échap` |

## Terminal

Quand le terminal intégré est focalisé :

| Action | Raccourci |
|--------|----------|
| Basculer le terminal | `` Ctrl + ` `` |
| Copier | `Mod + C` (avec sélection) |
| Coller | `Mod + V` |
| Effacer | `Mod + K` |
| Rechercher | `Mod + F` |

Quand la barre de recherche du terminal est ouverte :

| Action | Raccourci |
|--------|----------|
| Occurrence suivante | `Enter` |
| Occurrence précédente | `Shift + Enter` |
| Fermer la recherche | `Échap` |

::: tip
`Mod + C` sans sélection envoie SIGINT au processus en cours d'exécution. Consultez le [Terminal intégré](/fr/guide/terminal) pour le guide complet.
:::

## Personnaliser les raccourcis

1. Ouvrez les Paramètres avec `Mod + ,`
2. Naviguez vers l'onglet **Raccourcis**
3. Cliquez sur n'importe quel raccourci pour le modifier
4. Appuyez sur la combinaison de touches souhaitée
5. Les modifications sont enregistrées automatiquement

::: tip
Les raccourcis se synchronisent avec les accélérateurs de menu le cas échéant, les éléments de menu afficheront donc vos raccourcis personnalisés.
:::
