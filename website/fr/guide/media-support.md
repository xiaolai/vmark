# Prise en charge des médias

VMark prend en charge la vidéo, l'audio et les embeds YouTube dans vos documents Markdown en utilisant des balises HTML5 standard.

## Formats pris en charge

### Vidéo

| Format | Extension |
|--------|-----------|
| MP4 | `.mp4` |
| WebM | `.webm` |
| MOV | `.mov` |
| AVI | `.avi` |
| MKV | `.mkv` |
| M4V | `.m4v` |
| OGV | `.ogv` |

### Audio

| Format | Extension |
|--------|-----------|
| MP3 | `.mp3` |
| M4A | `.m4a` |
| OGG | `.ogg` |
| WAV | `.wav` |
| FLAC | `.flac` |
| AAC | `.aac` |
| Opus | `.opus` |

## Syntaxe

### Vidéo

Utilisez des balises HTML5 vidéo standard :

```html
<video src="path/to/video.mp4" controls></video>
```

Avec des attributs optionnels :

```html
<video src="video.mp4" title="Demo" poster="thumbnail.jpg" controls></video>
```

### Audio

Utilisez des balises HTML5 audio standard :

```html
<audio src="path/to/audio.mp3" controls></audio>
```

### Embeds YouTube

Utilisez des iframes YouTube respectueuses de la vie privée :

```html
<iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID" width="560" height="315" frameborder="0" allowfullscreen></iframe>
```

### Embeds Vimeo

Utilisez des iframes du lecteur Vimeo :

```html
<iframe src="https://player.vimeo.com/video/VIDEO_ID" width="560" height="315" frameborder="0" allowfullscreen></iframe>
```

Vous pouvez également coller directement une URL Vimeo (par ex. `https://vimeo.com/123456789`) et VMark la convertira automatiquement en embed.

Les vidéos Vimeo non répertoriées sont également prises en charge : collez le lien de partage non répertorié (`https://vimeo.com/123456789/abcdef1234` ou une URL avec `?h=…`) et VMark conserve le hachage de confidentialité dont l'embed a besoin pour être lu.

### Embeds Bilibili

Utilisez l'iframe du lecteur Bilibili avec un identifiant BV :

```html
<iframe src="https://player.bilibili.com/player.html?bvid=BV1xxxxxxxxx" width="560" height="350" frameborder="0" allowfullscreen></iframe>
```

Collez une URL de vidéo Bilibili (par ex. `https://bilibili.com/video/BV1xxxxxxxxx`) et VMark la convertira automatiquement en embed. Notez que les URL courtes (`b23.tv`) ne sont pas prises en charge car elles nécessitent une résolution de redirection.

### Syntaxe d'image de secours

Vous pouvez également utiliser la syntaxe d'image avec des extensions de fichiers médias — VMark les promeut automatiquement vers le type de média correct :

```markdown
![](video.mp4)
![](audio.mp3)
```

## Insérer des médias

### Barre d'outils

Utilisez le menu Insérer dans la barre d'outils :

- **Vidéo** — ouvre un sélecteur de fichiers pour les fichiers vidéo, copie dans `.assets/`, insère une balise `<video>`
- **Audio** — ouvre un sélecteur de fichiers pour les fichiers audio, copie dans `.assets/`, insère une balise `<audio>`
- **YouTube** — lit une URL YouTube depuis le presse-papiers et insère un embed respectueux de la vie privée
- **Vimeo** et **Bilibili** — collez une URL de vidéo directement dans l'éditeur et VMark détecte automatiquement le fournisseur

### Glisser-déposer

Glissez des fichiers vidéo ou audio depuis votre système de fichiers directement dans l'éditeur. VMark va :

1. Copier le fichier dans le dossier `.assets/` du document
2. Insérer le nœud de média approprié avec un chemin relatif

### Mode Source

En mode Source, tapez les balises HTML directement. Les balises médias sont mises en évidence avec des bordures gauches colorées :

- **Vidéo** — bordure sarcelle
- **Audio** — bordure indigo
- **YouTube** — bordure rouge
- **Vimeo** — bordure bleue
- **Bilibili** — bordure rose

### Collage intelligent en mode Source

Coller en mode Source fait ce qui est correct en Markdown au lieu de déverser du texte brut :

- **Un chemin d'image** — ou plusieurs, issus d'une copie de plusieurs fichiers dans le Finder ou l'Explorateur — est validé, copié dans le dossier des ressources du document et inséré sous la forme `![](relative-path)`. Lorsqu'un collage est ambigu, une petite notification de confirmation vous le demande d'abord
- **Une capture d'écran ou une image copiée** (données d'image binaires dans le presse-papiers) est enregistrée dans le dossier des ressources et insérée de la même manière
- **Une URL collée sur du texte sélectionné** devient un lien : `[selected text](https://…)`
- **Du HTML ou du Markdown copié depuis une autre application** est converti et nettoyé avant d'être inséré — sauf à l'intérieur d'un bloc de code délimité, où le texte collé reste tel quel
- **Les fichiers image glissés depuis le Finder ou l'Explorateur** dans l'éditeur source sont également copiés et insérés

La conversion suit **Paramètres → Markdown → Traitement du collage depuis le presse-papiers** (`Intelligent` est la valeur par défaut ; les autres modes la désactivent), et les fichiers sont copiés dans le dossier des ressources tant que **Paramètres → Fichiers et images → Copier dans le dossier des ressources** est activé (par défaut).

## Modifier les médias

Double-cliquez sur n'importe quel élément multimédia en mode WYSIWYG pour ouvrir la fenêtre contextuelle multimédia :

- **Chemin source** — modifier le chemin du fichier ou l'URL
- **Titre** — attribut titre optionnel
- **Couverture** (vidéo uniquement) — chemin de l'image miniature
- **Supprimer** — supprimer l'élément multimédia

Appuyez sur `Échap` pour fermer la fenêtre contextuelle et revenir à l'éditeur.

## Résolution des chemins

VMark prend en charge trois types de chemins médias :

| Type de chemin | Exemple | Comportement |
|----------------|---------|-------------|
| Relatif | `./assets/video.mp4` | Résolu par rapport au répertoire du document |
| Relatif au parent | `../images/photo.png` | Résolu par rapport au répertoire du document, en remontant d'autant de niveaux que le chemin le demande |
| Absolu | `/Users/me/video.mp4` | Utilisé directement via le protocole d'assets Tauri |
| URL externe | `https://example.com/video.mp4` | Chargé directement depuis le web |

Les chemins relatifs sont recommandés — ils gardent vos documents portables entre les machines.

Un dossier de ressources partagé à côté de vos notes fonctionne tel quel — `notes/report.md`
peut référencer `../images/photo.png`. (Avant la version 0.9.79, ces chemins s'affichaient comme des
espaces réservés cassés.)

## Sécurité

- Un chemin de média ne peut pas porter de schéma d'URI (`javascript:`, `file:` ou un schéma personnalisé) ; de telles sources sont refusées au lieu d'être chargées
- Un chemin relatif qui désigne un répertoire (`.`, `..`, `assets/`) n'est pas chargé. Les blocs vidéo/audio le refusent d'emblée. Les images en ligne le renvoient inchangé, et la webview le résout par rapport à l'origine de l'application, si bien qu'il n'atteint jamais le disque. Un chemin relatif au dossier personnel (`~/…`) est traité de la même façon
- Les chemins absolus ne sont pas restreints par les règles de chemin. Tout chemin absolu situé dans le périmètre des ressources est affiché : votre dossier personnel, `/Volumes`, `/mnt` et `/media` (plus les lecteurs `C:`–`F:` sous Windows), ainsi que les dossiers accordés à l'exécution. Un document peut donc afficher n'importe quelle image lisible de ces emplacements en écrivant son chemin complet. Coller une image avec **Copier dans le dossier des ressources** désactivé écrit un tel chemin absolu. C'est aussi pourquoi un chemin relatif peut utiliser `..` : il n'atteint rien qu'un chemin absolu ne pourrait déjà atteindre
- Les embeds vidéo ne se chargent que depuis trois hôtes : `www.youtube-nocookie.com` (le lecteur à confidentialité renforcée de YouTube), `player.vimeo.com` et `player.bilibili.com`. Un lien YouTube, ou un iframe écrit avec `youtube.com`, est intégré via l'hôte à confidentialité renforcée. La politique de sécurité du contenu de VMark autorise le chargement de cadres depuis ces hôtes et depuis aucun autre site
- Les autres sources iframe sont supprimées par le désinfectant
