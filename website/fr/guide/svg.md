# Graphiques SVG

VMark offre une prise en charge de premier ordre pour les SVG — Scalable Vector Graphics. Il existe deux façons d'utiliser les SVG dans vos documents, chacune adaptée à un flux de travail différent.

| Méthode | Idéale pour | Source modifiable ? |
|---------|-------------|---------------------|
| [Embed d'image](#incorporer-svg-comme-image) (`![](fichier.svg)`) | Fichiers SVG statiques sur le disque | Non |
| [Bloc de code](#blocs-de-code-svg) (` ```svg `) | SVG en ligne, graphiques générés par IA | Oui |

## Incorporer SVG comme image

Utilisez la syntaxe d'image Markdown standard pour incorporer un fichier SVG :

```markdown
![Diagramme d'architecture](./assets/architecture.svg)
```

Cela fonctionne exactement comme les images PNG ou JPEG — glisser-déposer, coller ou insérer via la barre d'outils. Les fichiers SVG sont reconnus comme images et rendus en ligne.

**Quand l'utiliser :** Vous avez un fichier `.svg` (de Figma, Illustrator, Inkscape ou un outil de conception) et souhaitez l'afficher dans votre document.

**Limitations :** Le SVG s'affiche comme une image statique. Vous ne pouvez pas modifier le source SVG en ligne, et aucun contrôle de panoramique/zoom ou d'exportation n'apparaît.

## Blocs de code SVG

Enveloppez le balisage SVG brut dans un bloc de code délimité avec l'identifiant de langage `svg` :

````markdown
```svg
<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">
  <rect width="200" height="100" rx="10" fill="#4a6fa5"/>
  <text x="100" y="55" text-anchor="middle" fill="white"
        font-size="18" font-family="system-ui">Hello SVG</text>
</svg>
```text
````

Le SVG s'affiche en ligne — tout comme les diagrammes Mermaid — avec des contrôles interactifs.

::: tip Exclusif à VMark
Ni Typora ni Obsidian ne prennent en charge les blocs de code ` ```svg `. Il s'agit d'une fonctionnalité exclusive à VMark, conçue pour les flux de travail IA où les outils génèrent des visualisations SVG (graphiques, illustrations, icônes) qui ne correspondent pas à la grammaire de Mermaid.
:::

### Quand utiliser les blocs de code

- **Graphiques générés par IA** — Claude, ChatGPT et d'autres outils IA peuvent générer des graphiques, diagrammes et illustrations SVG directement. Collez le SVG dans un bloc de code pour le rendre en ligne.
- **Création SVG en ligne** — Modifiez le source SVG directement dans votre document et voyez les résultats en direct.
- **Documents autonomes** — Le SVG vit à l'intérieur du fichier Markdown, sans dépendance de fichier externe.

## Édition en mode WYSIWYG

En mode Texte enrichi, les blocs de code SVG sont rendus en ligne automatiquement.

### Entrer en mode édition

Double-cliquez sur un SVG rendu pour ouvrir l'éditeur de source. Un en-tête d'édition apparaît avec :

| Bouton | Action |
|--------|--------|
| **Copier** | Copier le source SVG dans le presse-papiers |
| **Annuler** (X) | Annuler les modifications et quitter (aussi `Échap`) |
| **Enregistrer** (coche) | Appliquer les modifications et quitter |

Une **prévisualisation en direct** sous l'éditeur se met à jour au fil de la saisie, vous permettant de voir vos modifications en temps réel.

### Panoramique et zoom

Survolez un SVG rendu pour révéler des contrôles interactifs :

| Action | Comment |
|--------|---------|
| **Zoom** | Maintenez `Cmd` (macOS) ou `Ctrl` (Windows/Linux) et défilez |
| **Panoramique** | Cliquez et glissez le SVG |
| **Réinitialiser** | Cliquez sur le bouton de réinitialisation (coin supérieur droit) |

Ce sont les mêmes contrôles de panoramique/zoom utilisés pour les diagrammes Mermaid.

### Exporter en PNG

Survolez un SVG rendu pour révéler le bouton d'**exportation** (en haut à droite, à côté du bouton de réinitialisation). Cliquez dessus pour choisir un thème d'arrière-plan :

| Thème | Arrière-plan |
|-------|-------------|
| **Clair** | Blanc (`#ffffff`) |
| **Sombre** | Sombre (`#1e1e1e`) |

Le SVG est exporté en PNG 2x via la boîte de dialogue d'enregistrement du système.

## Prévisualisation en mode Source

En mode Source, lorsque votre curseur est à l'intérieur d'un bloc de code ` ```svg `, un panneau de prévisualisation flottant apparaît — le même panneau utilisé pour les diagrammes Mermaid.

| Fonctionnalité | Description |
|---------------|-------------|
| **Prévisualisation en direct** | Se met à jour immédiatement au fil de la saisie (sans rebond — le rendu SVG est instantané) |
| **Glisser pour déplacer** | Glissez l'en-tête pour repositionner |
| **Redimensionner** | Glissez n'importe quel bord ou coin |
| **Zoom** | Boutons `−` et `+`, ou `Cmd/Ctrl` + défilement (10% à 300%) |

::: info
La prévisualisation de diagramme en mode Source doit être activée. Basculez-la avec le bouton **Prévisualisation de diagramme** dans la barre d'état.
:::

## Validation SVG

VMark valide le contenu SVG avant le rendu :

- Le contenu doit commencer par `<svg` ou `<?xml`
- Le XML doit être bien formé (aucune erreur d'analyse)
- L'élément racine doit être `<svg>`

Si la validation échoue, un message d'erreur **SVG invalide** est affiché à la place du graphique rendu. Double-cliquez sur l'erreur pour modifier et corriger le source.

## Flux de travail IA

Les assistants de codage IA peuvent générer des SVG directement dans vos documents VMark via les outils MCP. L'IA envoie un bloc de code avec `language: "svg"` et le contenu SVG, qui s'affiche en ligne automatiquement.

**Exemple de prompt :**

> Créez un graphique à barres montrant le chiffre d'affaires trimestriel : T1 2,1 M€, T2 2,8 M€, T3 3,2 M€, T4 3,9 M€

L'IA génère un graphique à barres SVG qui s'affiche en ligne dans votre document, avec panoramique/zoom et exportation PNG disponibles immédiatement.

## Comparaison : bloc de code SVG vs Mermaid

| Fonctionnalité | ` ```svg ` | ` ```mermaid ` |
|---------------|-----------|---------------|
| Entrée | Balisage SVG brut | DSL Mermaid |
| Rendu | Instantané (synchrone) | Asynchrone (rebond 200ms) |
| Panoramique + Zoom | Oui | Oui |
| Export PNG | Oui | Oui |
| Prévisualisation en direct | Oui | Oui |
| Adaptation au thème | Non (utilise les couleurs propres du SVG) | Oui (s'adapte à tous les thèmes) |
| Idéal pour | Graphiques personnalisés, visuels générés par IA | Organigrammes, diagrammes de séquence, diagrammes structurés |

## Conseils

### Sécurité

VMark désinfecte le contenu SVG avant le rendu. Les balises de script et les attributs de gestionnaire d'événements (`onclick`, `onerror`, etc.) sont supprimés. Cela protège contre les attaques XSS lors du collage de SVG provenant de sources non fiables.

### Dimensionnement

Si votre SVG n'inclut pas d'attributs `width`/`height` explicites, ajoutez un `viewBox` pour contrôler son rapport d'aspect :

```xml
<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
  <!-- contenu -->
</svg>
```

### Qualité d'exportation

L'export PNG utilise une résolution 2x pour un affichage net sur les écrans Retina. Une couleur de fond solide est ajoutée automatiquement (le SVG lui-même peut avoir un fond transparent).
