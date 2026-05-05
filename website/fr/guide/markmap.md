# Cartes mentales Markmap

VMark prend en charge [Markmap](https://markmap.js.org/) pour créer des arbres de cartes mentales interactifs directement dans vos documents Markdown. Contrairement au type de diagramme mindmap statique de Mermaid, Markmap utilise des titres Markdown standard comme entrée et fournit un panoramique/zoom/réduction interactifs.

## Insérer une carte mentale

### Utiliser le menu

**Menu :** Insérer > Carte mentale

**Raccourci clavier :** `Alt + Shift + Cmd + K` (macOS) / `Alt + Shift + Ctrl + K` (Windows/Linux)

### Utiliser un bloc de code

Tapez un bloc de code délimité avec l'identifiant de langage `markmap` :

````markdown
```markmap
# Mindmap

## Branche A
### Sujet 1
### Sujet 2

## Branche B
### Sujet 3
### Sujet 4
```text
````

### Utiliser l'outil MCP

Utilisez l'outil MCP `media` avec `action: "markmap"` et le paramètre `code` contenant des titres Markdown.

## Modes d'édition

### Mode Texte enrichi (WYSIWYG)

En mode WYSIWYG, les cartes mentales Markmap sont rendues comme des arbres SVG interactifs. Vous pouvez :

- **Panoramique** en défilant ou en cliquant et glissant
- **Zoom** en maintenant `Cmd`/`Ctrl` et en défilant
- **Réduire/développer** les nœuds en cliquant sur le cercle à chaque branche
- **Ajuster** la vue en utilisant le bouton d'ajustement (coin supérieur droit au survol)
- **Double-cliquer** sur la carte mentale pour modifier le source

### Mode Source avec prévisualisation en direct

En mode Source, un panneau de prévisualisation flottant apparaît lorsque votre curseur est à l'intérieur d'un bloc de code markmap, se mettant à jour au fil de la saisie.

## Format d'entrée

Markmap utilise du Markdown standard comme entrée. Les titres définissent la hiérarchie de l'arbre :

| Markdown | Rôle |
|----------|------|
| `# Titre 1` | Nœud racine |
| `## Titre 2` | Branche de premier niveau |
| `### Titre 3` | Branche de deuxième niveau |
| `#### Titre 4+` | Branches plus profondes |

### Contenu enrichi dans les nœuds

Les nœuds peuvent contenir du Markdown en ligne :

````markdown
```markmap
# Plan de projet

## Recherche
### Lire des articles **importants**
### Examiner les [outils existants](https://example.com)

## Implémentation
### Écrire le module `core`
### Ajouter des tests
- Tests unitaires
- Tests d'intégration

## Documentation
### Référence API
### Guide utilisateur
```text
````

Les éléments de liste sous un titre deviennent des nœuds enfants de ce titre.

### Démonstration en direct

Voici un markmap interactif rendu directement sur cette page — essayez de faire un panoramique, un zoom et de replier les nœuds :

```markmap
# VMark Features

## Editor
### WYSIWYG Mode
### Source Mode
### Focus Mode
### Typewriter Mode

## AI Integration
### MCP Server
### AI Genies
### Smart Paste

## Markdown
### Mermaid Diagrams
### Markmap Mindmaps
### LaTeX Math
### Code Blocks
- Syntax highlighting
- Line numbers

## Platform
### macOS
### Windows
### Linux
```

## Fonctionnalités interactives

| Action | Comment |
|--------|---------|
| **Panoramique** | Défiler ou cliquer et glisser |
| **Zoom** | `Cmd`/`Ctrl` + défilement |
| **Réduire le nœud** | Cliquer sur le cercle à un point de branche |
| **Développer le nœud** | Cliquer à nouveau sur le cercle |
| **Ajuster à la vue** | Cliquer sur le bouton d'ajustement (en haut à droite au survol) |

## Intégration du thème

Les cartes mentales Markmap s'adaptent automatiquement au thème actuel de VMark (White, Paper, Mint, Sepia ou Night). Les couleurs des branches s'ajustent pour la lisibilité dans tous les thèmes.

## Exporter en PNG

Survolez une carte mentale rendue en mode WYSIWYG pour révéler un bouton d'**exportation**. Cliquez dessus pour choisir un thème :

| Thème | Arrière-plan |
|-------|-------------|
| **Clair** | Fond blanc |
| **Sombre** | Fond sombre |

La carte mentale est exportée en PNG 2x via la boîte de dialogue d'enregistrement du système.

## Conseils

### Markmap vs diagramme Mermaid mindmap

VMark prend en charge à la fois Markmap et le type de diagramme `mindmap` de Mermaid :

| Fonctionnalité | Markmap | Mermaid Mindmap |
|---------------|---------|-----------------|
| Format d'entrée | Markdown standard | DSL Mermaid |
| Interactivité | Panoramique, zoom, réduction | Image statique |
| Contenu enrichi | Liens, gras, code, listes | Texte uniquement |
| Idéal pour | Grands arbres interactifs | Diagrammes statiques simples |

Utilisez **Markmap** lorsque vous souhaitez de l'interactivité ou que vous avez déjà du contenu Markdown. Utilisez **Mermaid mindmap** lorsque vous en avez besoin avec d'autres diagrammes Mermaid.

### En savoir plus

- **[Documentation Markmap](https://markmap.js.org/)** — Référence officielle
- **[Terrain de jeu Markmap](https://markmap.js.org/repl)** — Terrain de jeu interactif pour tester les cartes mentales
