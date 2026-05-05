# Premiers pas avec VMark

VMark est un éditeur Markdown local avec deux modes d'édition, des outils de mise en forme avancés et un excellent support CJK (chinois/japonais/coréen).

## Démarrage rapide

1. **Téléchargez et installez** VMark depuis la [page de téléchargement](/fr/download)
2. **Lancez l'application** et commencez à écrire immédiatement
3. **Ouvrez un fichier** avec `Cmd/Ctrl + O` ou glissez-déposez un fichier `.md`
4. **Ouvrez un dossier** avec `Cmd/Ctrl + Shift + O` pour le mode espace de travail

## Vue d'ensemble de l'interface

### Zones principales

- **Éditeur** : La zone d'écriture principale où vous composez vos documents
- **Barre latérale** : Navigation dans l'arborescence des fichiers (basculer avec `Ctrl + Shift + 2`)
- **Plan** : Vue de la structure du document (basculer avec `Ctrl + Shift + 1`)
- **Barre d'état** : Nombre de mots, de caractères et état de la sauvegarde automatique (basculer avec `F7`)
- **Terminal** : Panneau shell intégré (basculer avec `` Ctrl + ` ``)

### Barre de menus

- **Fichier** : Opérations de création, ouverture, sauvegarde et exportation
- **Édition** : Annuler/rétablir, presse-papiers, rechercher/remplacer, historique du document
- **Bloc** : Titres, listes, citations, opérations sur les lignes
- **Format** : Styles de texte, liens, transformations de texte
- **Affichage** : Modes d'édition, barre latérale, modes focus/machine à écrire
- **Outils** : Nettoyage du texte, mise en forme CJK, gestion des images

### Modes d'édition

VMark prend en charge deux modes d'édition entre lesquels vous pouvez basculer :

| Mode | Description | Raccourci |
|------|-------------|----------|
| Texte enrichi | Édition WYSIWYG avec mise en forme en direct | Par défaut |
| Source | Markdown brut avec coloration syntaxique | `F6` |

### Modes d'affichage

Améliorez votre concentration avec ces modes d'affichage :

| Mode | Description | Raccourci |
|------|-------------|----------|
| Focus | Mettre en évidence le paragraphe actuel | `F8` |
| Machine à écrire | Garder le curseur centré | `F9` |
| Retour à la ligne | Basculer le retour à la ligne | `Alt + Z` |

## Mise en forme de base

### Styles de texte

| Style | Syntaxe | Raccourci |
|-------|---------|----------|
| **Gras** | `**texte**` | `Cmd/Ctrl + B` |
| *Italique* | `*texte*` | `Cmd/Ctrl + I` |
| ~~Barré~~ | `~~texte~~` | `Cmd/Ctrl + Shift + X` |
| `Code` | `` `code` `` | `Cmd/Ctrl + Shift + `` ` `` |

### Éléments de bloc

- **Titres** : Utilisez les symboles `#` ou `Cmd/Ctrl + 1-6`
- **Listes** : Commencez les lignes par `-`, `*`, `1.` ou `- [ ]` pour les listes de tâches
- **Citations** : Commencez par `>` ou utilisez `Alt/Option + Cmd + Q`
- **Blocs de code** : Utilisez trois accents graves avec un langage optionnel
- **Tableaux** : Utilisez le menu Format ou `Cmd/Ctrl + Shift + T`

## Travailler avec les fichiers

### Créer et ouvrir

- **Nouveau fichier** : `Cmd/Ctrl + N`
- **Ouvrir un fichier** : `Cmd/Ctrl + O`
- **Ouvrir un dossier** : `Cmd/Ctrl + Shift + O` (mode espace de travail)

### Sauvegarder

- **Enregistrer** : `Cmd/Ctrl + S`
- **Enregistrer sous** : `Cmd/Ctrl + Shift + S`
- **Sauvegarde automatique** : Activée par défaut, configurable dans les paramètres

### Exporter

- **Exporter en HTML** : Utilisez **Fichier → Exporter en HTML** — inclut le lecteur VMark interactif
- **Exporter en PDF** : Utilisez l'impression (`Cmd/Ctrl + P`) et enregistrez en PDF
- **Copier en HTML** : `Cmd/Ctrl + Shift + C`

L'HTML exporté inclut le lecteur VMark avec une table des matières, un panneau de paramètres et plus encore. [En savoir plus →](/fr/guide/export)

## Paramètres

Ouvrez les paramètres avec `Cmd/Ctrl + ,` pour personnaliser :

- **Apparence** : Thème, polices, taille de police, interligne
- **Éditeur** : Intervalle de sauvegarde automatique, comportements par défaut
- **Fichiers et images** : Gestion des ressources, outils de document
- **Intégrations** : Fournisseurs d'IA, serveur MCP
- **Langue** : Règles de mise en forme CJK
- **Markdown** : Options d'exportation, préférences de mise en forme
- **Raccourcis** : Personnaliser les raccourcis clavier
- **Terminal** : Taille de police et interligne du terminal

## Assistance à l'écriture par IA

VMark inclut des Génies IA intégrés — sélectionnez du texte et appuyez sur `Mod + Y` pour peaufiner, développer, traduire ou transformer votre écriture avec l'IA. Configurez votre fournisseur préféré dans **Paramètres > Intégrations**.

[En savoir plus sur les Génies IA →](/fr/guide/ai-genies) | [Configurer les fournisseurs →](/fr/guide/ai-providers)

## Conseils pour commencer

1. **Naviguez avec le plan** : cliquez sur les éléments du plan pour passer d'une section à l'autre
2. **Essayez le mode focus** : `F8` atténue tout sauf le paragraphe actuel
3. **Validez pendant que vous écrivez** : `Cmd + Shift + L` lance le moteur de lint markdown et la vérification des liens cassés
4. **Apprenez les raccourcis** : la référence complète se trouve dans le [guide des raccourcis](/fr/guide/shortcuts)

## Prochaines étapes

- Découvrez toutes les [fonctionnalités](/fr/guide/features)
- Maîtrisez les [raccourcis clavier](/fr/guide/shortcuts)
- Explorez les outils de [mise en forme CJK](/fr/guide/cjk-formatting)
