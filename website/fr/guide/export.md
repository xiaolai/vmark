# Exportation et impression

VMark offre plusieurs façons d'exporter et de partager vos documents.

## Ce que produit une exportation

**Fichier → Exporter → HTML** écrit un dossier, nommé d'après votre document, qui contient toujours **ces deux** fichiers — il n'y a pas de mode à choisir :

```text
MyDocument/
├── index.html          ← links to the files under assets/
├── standalone.html     ← everything embedded as data URIs (CSS, JS, images, fonts)
└── assets/
    ├── vmark-reader.css
    ├── vmark-reader.js
    ├── images/
    │   ├── image1.png
    │   └── ...
    └── fonts/          ← only when the document has math or you use a web font
```

Utilisez le fichier qui convient au moment :

| Fichier | Idéal pour | Contrepartie |
|---------|------------|--------------|
| `index.html` | Hébergement sur un site statique (URL propres `/MyDocument/`), modification dans un autre outil, taille réduite | Nécessite le dossier `assets/` à côté |
| `standalone.html` | Envoi par e-mail ou messagerie d'un fichier unique qui ne peut pas perdre ses images | Plus lourd — chaque ressource est intégrée |

Les deux fichiers sont rendus par le même moteur de rendu WYSIWYG et la même feuille de style que l'éditeur, et tous deux incluent le [Lecteur VMark](#lecteur-vmark).

## Comment exporter

### Exporter en HTML

1. Utilisez **Fichier → Exporter → HTML**
2. Choisissez l'emplacement d'enregistrement et saisissez un nom — il devient le nom du dossier (une extension `.html` finale est supprimée)
3. Ouvrez `index.html` ou `standalone.html` depuis le nouveau dossier

#### Réexporter dans un dossier déjà utilisé

Une exportation HTML est du tout ou rien. Tout est d'abord écrit dans un
dossier temporaire `.vmark-export-…` à l'intérieur de la destination choisie,
puis mis en place seulement une fois que chaque fichier existe — une
exportation qui échoue en cours de route laisse donc l'exportation précédente
exactement telle qu'elle était, au lieu de l'écraser à moitié.

Deux choses que vous pouvez rencontrer :

- **« Une autre exportation écrit déjà dans ce dossier. »** Une seule
  exportation à la fois peut écrire dans un dossier, toutes fenêtres
  confondues. Attendez que l'autre se termine, ou — si rien d'autre n'est en
  cours — supprimez le fichier `.vmark-export.lock` indiqué par le message et
  réessayez.
- **Un dossier `.vmark-export-…` laissé en place.** VMark le supprime une fois
  terminé. Il ne subsiste que si la remise en place de vos fichiers précédents
  a elle aussi échoué ; il contient alors ces fichiers, et le message d'erreur
  indique exactement où ils se trouvent. Rien n'est supprimé tant qu'il s'agit
  de la seule copie.

### Imprimer / Exporter en PDF

Disponible sur macOS, Windows et Linux.

**Exporter en PDF** (**Fichier → Exporter → PDF**) écrit directement un PDF,
avec le format de page, l'orientation, les marges et la typographie que vous
choisissez dans la boîte de dialogue d'exportation.

**Imprimer** (`Cmd/Ctrl + P`, ou **Fichier → Imprimer**) ouvre plutôt la boîte
de dialogue d'impression du système, pour envoyer le document à une
imprimante ou utiliser la fonction « enregistrer en PDF » de votre système
d'exploitation. Sur macOS et Linux, VMark confirme la fin d'une tâche
d'impression par un bref avis et reste silencieux si vous annulez la boîte de
dialogue ; l'interface d'impression de Windows ne renvoie pas d'information,
aucun avis n'y est donc affiché.

La boîte de dialogue d'exportation affiche les mêmes étapes de progression —
chargement, génération, finalisation, terminé — sur les trois plateformes.

::: info Format de page sur macOS
Le format de page et l'orientation choisis dans la boîte de dialogue
déterminent la page exportée sur toutes les plateformes. Sur macOS, ils
remplacent le format de papier configuré dans votre système — si votre Mac
utilise Letter par défaut et que vous choisissez A4, le PDF est en A4.
:::

**Sommaire latéral.** Les PDF exportés contiennent un sommaire des titres — la
table des matières cliquable que votre lecteur PDF affiche dans sa barre
latérale — sur les trois plateformes.

#### Numéros de page

La section **Numéros de page** de la boîte de dialogue ajoute un numéro à
chaque page. Elle est activée par défaut, centrée en bas.

| Paramètre | Options |
|-----------|---------|
| Position | En bas au centre, en bas à droite, ou aucun |
| Format | `7`, `7 / 12` ou `Page 7 sur 12` |
| Ignorer la première page | Laisse la page 1 sans numéro, le traitement habituel d'une page de titre |

Le numéro se place dans la marge inférieure que vous avez choisie et suit la
taille de police du corps du texte. La numérotation reflète toujours la page
réelle : ignorer la première page vous donne 2, 3, 4… sur les pages suivantes,
sans les renuméroter.

::: info Les numéros de page utilisent l'alphabet latin
Le numéro est dessiné avec une police PDF standard qu'aucun lecteur n'a besoin
de télécharger, ce qui garde les exportations rapides et autonomes — mais cette
police ne peut pas afficher le chinois, le japonais, le coréen ni le cyrillique.
Les deux formats numériques fonctionnent dans toutes les langues. Si la langue
de votre interface écrit `Page 7 sur 12` dans une écriture que cette police ne
peut pas dessiner, VMark imprime à la place la forme numérique `7 / 12` plutôt
que des blancs ou des caractères erronés.
:::

### Exporter via Pandoc

VMark s'intègre avec [Pandoc](https://pandoc.org/) — un convertisseur de documents universel — pour exporter votre markdown vers des formats supplémentaires. Choisissez un format directement depuis le menu :

**Fichier → Exporter → Via Pandoc →**

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
3. Utilisez **Fichier → Exporter → Via Pandoc → [format]** pour exporter

Si Pandoc n'est pas installé, le sous-menu **Via Pandoc** n'affiche qu'un seul élément — **« Installer Pandoc pour exporter vers Word, EPUB, LaTeX… »** — qui ouvre le guide d'installation de Pandoc lorsqu'on clique dessus.

Vous pouvez vérifier que Pandoc est détecté dans **Paramètres → Fichiers & Images → Outils de document**.

### Copier en HTML

Appuyez sur `Cmd/Ctrl + Shift + C` pour copier le document rendu sous forme de **code source** HTML. Le balisage est placé dans le presse-papiers en texte brut et sans style : collez-le là où du code HTML est attendu — la vue HTML d'un CMS, un modèle, un éditeur de code ; un éditeur de texte enrichi comme Word ou Mail affiche les balises telles quelles. Les images locales sont intégrées en tant qu'URI de données, elles s'affichent donc toujours une fois le HTML sorti de VMark.

## Lecteur VMark

Chaque exportation HTML inclut le **Lecteur VMark** — une expérience de lecture interactive avec ses propres paramètres, sa navigation et sa visionneuse d'images.

### Panneau de paramètres

Cliquez sur l'icône d'engrenage (en bas à droite) pour ouvrir le panneau de paramètres ; `Esc` le referme. Vos choix sont mémorisés par le navigateur (`localStorage`) et s'appliquent donc la prochaine fois que vous ouvrez le fichier.

| Paramètre | Options |
|-----------|---------|
| Taille de police | 12px – 28px |
| Interligne | 1.2 – 2.4 |
| Largeur du contenu | 30em – 80em |
| Police latine | Système, Athelas, Palatino, Georgia, Charter, Literata |
| Police CJK | Système, PingFang, Songti, Kaiti, Noto Serif, Source Han |
| Thème | White, Paper (par défaut), Mint, Sepia, Night |
| Espacement des lettres CJK | 0.02em – 0.12em |
| Espacement CJK-Latin | Basculer l'espacement automatique entre les caractères CJK et latins |
| Table des matières | Basculer la barre latérale de table des matières (comme en appuyant sur `T`) |
| Développer toutes les sections | Ouvrir chaque bloc réductible `<details>` |
| Rétablir les valeurs par défaut | Réinitialiser tous les paramètres |

### Table des matières

La barre latérale de table des matières aide à naviguer dans les longs documents :

- **Basculer** : Cliquez sur l'onglet au bord de la page ou appuyez sur `T`
- **Naviguer** : Cliquez sur n'importe quel titre pour y accéder
- **Mise en surbrillance** : La section actuelle est mise en évidence au fil du défilement

### Progression de la lecture

Une barre de progression subtile en haut de la page indique jusqu'où vous avez lu le document.

### Retour en haut

Un bouton flottant apparaît lorsque vous faites défiler vers le bas. Cliquez dessus pour revenir en haut.

### Visionneuse d'images

Cliquez sur n'importe quelle image pour l'afficher dans une visionneuse plein écran :

- **Fermer** : Cliquez à l'extérieur, appuyez sur `Esc`, ou cliquez sur le bouton X
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
| `Esc` | Fermer le panneau de paramètres ou la visionneuse |
| `T` | Basculer la table des matières |
| `+` / `=` | Augmenter la taille de police |
| `-` | Diminuer la taille de police |

## Raccourcis d'exportation

| Action | Raccourci |
|--------|----------|
| Exporter en HTML | _(menu uniquement)_ |
| Exporter en PDF | _(menu uniquement)_ |
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

Les deux fichiers s'ouvrent hors ligne, avec une différence pour les documents qui contiennent des mathématiques :

- **`standalone.html`** est entièrement autonome — la feuille de style et les polices KaTeX sont intégrées au moment de l'exportation, les mathématiques s'affichent donc sans connexion.
- **`index.html`** charge la feuille de style KaTeX depuis un CDN (jsDelivr) ; ses mathématiques nécessitent donc une connexion internet à l'ouverture de la page ; le lecteur, les images et les polices sous `assets/` sont locaux.

Les polices sont téléchargées pendant l'exportation : les polices KaTeX lorsque le document contient des mathématiques, et vos polices latine et à chasse fixe lorsqu'il s'agit de polices web que VMark connaît (Literata, JetBrains Mono, Fira Code, IBM Plex Mono). Le réglage de police CJK n'est jamais intégré, pas plus qu'une police système ou une famille de polices personnalisée — la page exportée utilise pour celles-ci la pile de polices système du lecteur. Exportez depuis une machine disposant d'un accès à internet si vous souhaitez intégrer les polices — une exportation hors ligne se rabat sur les polices système.

### Quelles images sont intégrées

Un fichier exporté contient les octets réels des images, et les exportations
sont partagées — VMark limite donc la provenance de ces octets :

| Votre document est… | Les images peuvent provenir de |
|---|---|
| dans un espace de travail ouvert | n'importe où dans cet espace de travail |
| ouvert seul | le dossier du document et ses sous-dossiers |
| non enregistré (jamais enregistré sur le disque) | nulle part — aucune image locale n'est intégrée, même avec un espace de travail ouvert ; les images distantes ne sont pas concernées |

Pour un document non enregistré, enregistrez-le d'abord, puis exportez-le à nouveau. Cela s'applique au HTML, à l'impression, au PDF et à Copier en HTML.

Les chemins relatifs sont résolus à partir du dossier du document, exactement
comme dans l'éditeur — `../images/photo.png` fonctionne donc tant que la cible
reste dans la limite ci-dessus. Tout ce qui se trouve en dehors (`~/.ssh/id_rsa`,
`/etc/passwd`, un chemin absolu ailleurs sur le disque) est refusé et exporté
sous forme d'un espace réservé « Image not found », comptabilisé dans
l'avertissement de l'exportation.

Si une image `../` est exportée sous forme d'espace réservé, ouvrez son dossier
comme espace de travail et exportez à nouveau.

### Bonnes pratiques

1. **Hébergez `index.html`** pour les documents que vous allez publier — gardez le dossier `assets/` à côté
2. **Envoyez `standalone.html`** pour un partage rapide par e-mail ou chat
3. **Incluez un texte alternatif descriptif pour les images** pour l'accessibilité
4. **Testez le HTML exporté** dans différents navigateurs
