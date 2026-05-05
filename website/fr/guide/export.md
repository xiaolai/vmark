# Exportation et impression

VMark offre plusieurs façons d'exporter et de partager vos documents.

## Modes d'exportation

### Mode dossier (par défaut)

Crée un dossier autonome avec une structure claire :

```text
MyDocument/
├── index.html
└── assets/
    ├── image1.png
    ├── image2.jpg
    └── ...
```

**Avantages :**
- URL propres lors de l'hébergement (`/MyDocument/` au lieu de `/MyDocument.html`)
- Facile à partager comme dossier unique
- Chemins d'assets simples (`assets/image.png`)
- Fonctionne très bien avec les hébergeurs de sites statiques

### Mode fichier unique

Crée un fichier HTML autonome unique :

```text
MyDocument.html
```

Toutes les images sont intégrées en tant qu'URI de données, le rendant complètement portable mais plus lourd en taille de fichier.

## Comment exporter

### Exporter en HTML

1. Utilisez **Fichier → Exporter en HTML**
2. Choisissez l'emplacement d'exportation
3. Pour le mode dossier : entrez le nom du dossier (ex. `MyDocument`)
4. Pour le mode fichier unique : entrez le nom de fichier avec l'extension `.html`

### Imprimer / Exporter en PDF

1. Appuyez sur `Cmd/Ctrl + P` ou utilisez **Fichier → Imprimer**
2. Utilisez la boîte de dialogue d'impression système pour imprimer ou enregistrer en PDF

### Exporter vers d'autres formats

VMark s'intègre avec [Pandoc](https://pandoc.org/) — un convertisseur de documents universel — pour exporter votre markdown vers des formats supplémentaires. Choisissez un format directement depuis le menu :

**Fichier → Exporter → Autres formats →**

| Élément de menu | Extension |
|----------------|-----------|
| Word (.docx) | `.docx` |
| EPUB (.epub) | `.epub` |
| LaTeX (.tex) | `.tex` |
| OpenDocument (.odt) | `.odt` |
| Texte enrichi (.rtf) | `.rtf` |
| Texte brut (.txt) | `.txt` |

**Configuration :**

1. Installez Pandoc depuis [pandoc.org/installing](https://pandoc.org/installing.html) ou via votre gestionnaire de paquets :
   - macOS : `brew install pandoc`
   - Windows : `winget install pandoc`
   - Linux : `apt install pandoc`
2. Redémarrez VMark (ou allez dans **Paramètres → Fichiers & Images → Outils de document** et cliquez sur **Détecter**)
3. Utilisez **Fichier → Exporter → Autres formats → [format]** pour exporter

Si Pandoc n'est pas installé, le menu affiche un lien **« Nécessite Pandoc — pandoc.org »** en bas du sous-menu Autres formats.

Vous pouvez vérifier que Pandoc est détecté dans **Paramètres → Fichiers & Images → Outils de document**.

### Copier en HTML

Appuyez sur `Cmd/Ctrl + Shift + C` pour copier le HTML rendu dans le presse-papiers pour le coller dans d'autres applications.

## Lecteur VMark

Lorsque vous exportez en HTML (mode stylisé), votre document inclut le **Lecteur VMark** — une expérience de lecture interactive avec des fonctionnalités puissantes.

### Panneau de paramètres

Cliquez sur l'icône d'engrenage (en bas à droite) ou appuyez sur `Échap` pour ouvrir le panneau de paramètres :

| Paramètre | Description |
|-----------|-------------|
| Taille de police | Ajuster la taille du texte (12px – 24px) |
| Interligne | Ajuster l'espacement des lignes (1.2 – 2.0) |
| Thème | Changer de thème (White, Paper, Mint, Sepia, Night) |
| Espacement CJK-Latin | Basculer l'espacement entre les caractères CJK et latins |

### Table des matières

La barre latérale de table des matières aide à naviguer dans les longs documents :

- **Basculer** : Cliquez sur l'en-tête du panneau ou appuyez sur `T`
- **Naviguer** : Cliquez sur n'importe quel titre pour y accéder
- **Clavier** : Utilisez les flèches `↑`/`↓` pour vous déplacer, `Entrée` pour accéder
- **Mise en surbrillance** : La section actuelle est mise en évidence au fil du défilement

### Progression de la lecture

Une barre de progression subtile en haut de la page indique jusqu'où vous avez lu le document.

### Retour en haut

Un bouton flottant apparaît lorsque vous faites défiler vers le bas. Cliquez dessus ou appuyez sur `Origine` pour revenir en haut.

### Visionneuse d'images

Cliquez sur n'importe quelle image pour l'afficher dans une visionneuse plein écran :

- **Fermer** : Cliquez à l'extérieur, appuyez sur `Échap`, ou cliquez sur le bouton X
- **Naviguer** : Utilisez les flèches `←`/`→` pour les images multiples
- **Zoom** : Les images s'affichent à leur taille naturelle

### Blocs de code

Chaque bloc de code inclut des contrôles interactifs :

| Bouton | Fonction |
|--------|----------|
| Basculer les numéros de ligne | Afficher/masquer les numéros de ligne pour ce bloc |
| Bouton de copie | Copier le code dans le presse-papiers |

Le bouton de copie affiche une coche lorsqu'il réussit.

### Navigation dans les notes de bas de page

Les notes de bas de page sont entièrement interactives :

- Cliquez sur une référence de note de bas de page `[1]` pour accéder à sa définition
- Cliquez sur le renvoi `↩` pour revenir là où vous lisiez

### Raccourcis clavier

| Touche | Action |
|--------|--------|
| `Échap` | Basculer le panneau de paramètres |
| `T` | Basculer la table des matières |
| `↑` / `↓` | Naviguer dans les éléments de la table des matières |
| `Entrée` | Accéder à l'élément sélectionné de la table des matières |
| `←` / `→` | Naviguer dans les images de la visionneuse |
| `Origine` | Défiler vers le haut |

## Raccourcis d'exportation

| Action | Raccourci |
|--------|----------|
| Exporter en HTML | _(menu uniquement)_ |
| Imprimer | `Mod + P` |
| Copier en HTML | `Mod + Shift + C` |

## Conseils

### Héberger le HTML exporté

La structure d'exportation en dossier fonctionne bien avec n'importe quel serveur de fichiers statiques :

```bash
# Python
cd MyDocument && python -m http.server 8000

# Node.js (npx)
npx serve MyDocument

# Ouvrir directement
open MyDocument/index.html
```

### Visualisation hors ligne

Les deux modes d'exportation fonctionnent complètement hors ligne :

- **Mode dossier** : Ouvrez `index.html` dans n'importe quel navigateur
- **Mode fichier unique** : Ouvrez le fichier `.html` directement

Les équations mathématiques (KaTeX) nécessitent une connexion internet pour la feuille de style, mais tout le reste fonctionne hors ligne.

### Bonnes pratiques

1. **Utilisez le mode dossier** pour les documents que vous allez partager ou héberger
2. **Utilisez le mode fichier unique** pour un partage rapide par e-mail ou chat
3. **Incluez un texte alternatif descriptif pour les images** pour l'accessibilité
4. **Testez le HTML exporté** dans différents navigateurs
