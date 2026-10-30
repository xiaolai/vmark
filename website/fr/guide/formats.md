# Formats pris en charge

VMark ouvre directement tous les formats de fichier listés ci-dessous. La particularité est l'**aperçu adapté au schéma** : lorsqu'un fichier est un artefact reconnu, VMark affiche la *bonne* vue plutôt qu'un arbre JSON générique.

[[toc]]

## Activer les formats

Markdown, texte brut et YAML/YML s'ouvrent toujours dans leurs éditeurs complets — ce sont les valeurs par défaut tranquilles. Chaque autre format ci-dessous est **désactivé par défaut** et subordonné à un basculement de catégorie dans **Paramètres → Formats** :

| Basculement | Active |
|---|---|
| **Formats de données** | `.json`, `.jsonl`, `.toml` (volet source + arbre avec rendus de schéma Cargo / package.json / pyproject) |
| **Diagrammes & SVG** | `.mmd`, `.svg` (volet source + rendu en direct désinfecté) |
| **Aperçu HTML** | `.html`, `.htm` (iframe isolée — voir [Modèle de sécurité pour HTML](#modele-de-securite-pour-html)) |
| **Visionneuses de code** | 12 visionneuses de code en lecture seule (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua`) |

Lorsqu'une catégorie est désactivée, les extensions correspondantes basculent vers le mode texte brut — le fichier s'ouvre quand même, simplement sans l'aperçu ni la vue schéma. Activez un basculement et le registre se reconstruit à la volée ; les onglets ouverts se remontent avec l'adaptateur approprié.

Au premier lancement après une mise à niveau vers la prise en charge multi-format, VMark affiche une notification ponctuelle vous invitant à aller dans **Paramètres → Formats**. Si vous l'avez ignorée (ou si vous avez effectué une installation fraîche), le panneau est accessible à tout moment via **Paramètres → Formats**.

## Vue d'ensemble

| Famille | Extensions | Par défaut | Éditeur | Aperçu |
|---|---|---|---|---|
| Markdown | `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx` | toujours actif | modes WYSIWYG + Source | prose rendue |
| Texte brut | `.txt` | toujours actif | source | — |
| Données — YAML | `.yaml`, `.yml` | toujours actif | source + arbre | arbre navigable, adapté au schéma (GitHub Actions, workflows VMark) |
| Données — JSON | `.json`, `.jsonl` | nécessite le basculement **Formats de données** | source + arbre | arbre JSON navigable, adapté au schéma (`package.json`) |
| Données — TOML | `.toml` | nécessite le basculement **Formats de données** | source + arbre | arbre navigable, adapté au schéma (`Cargo.toml`, `pyproject.toml`) |
| Diagrammes | `.mmd` | nécessite le basculement **Diagrammes & SVG** | source + rendu | diagramme Mermaid en direct |
| Vecteur | `.svg` | nécessite le basculement **Diagrammes & SVG** | source + rendu | rendu intégré désinfecté |
| Web | `.html`, `.htm` | nécessite le basculement **Aperçu HTML** | source + rendu | iframe isolée (attribut `sandbox=""` vide, DOMPurify, CSP) ; le [mode approuvé](#apercu-html-approuve-sur-activation) s'active fichier par fichier |
| Code (lecture seule) | `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua` | nécessite le basculement **Visionneuses de code** | visionneuse (basculer pour modifier) | — |
| Médias | images (`.png`, `.jpg`, `.gif`, `.webp`, `.heic`, `.tiff`, …), vidéo (`.mp4`, `.webm`, `.mov`, …), audio (`.mp3`, `.wav`, `.flac`, …) | toujours actif | visionneuse (lecture seule) | image native / `<video>` / `<audio>` |

Les fichiers de code s'ouvrent en lecture seule avec une bannière proposant **Activer la modification** ou **Ouvrir dans l'éditeur externe**.

## Modes d'affichage (Source / Divisé / Aperçu)

Tout format doté d'un aperçu — HTML, SVG, Mermaid, JSON, YAML, TOML — s'ouvre avec
un petit sélecteur **Source · Divisé · Aperçu** dans le coin supérieur droit :

- **Source** — le volet source modifiable, en pleine largeur.
- **Divisé** — la source et l'aperçu côte à côte (par défaut).
- **Aperçu** — le résultat rendu, en pleine largeur. L'aperçu est un rendu en
  **lecture seule** ; pour modifier, revenez à Source ou Divisé.

Vous pouvez aussi basculer au clavier : **`F6`** alterne Source ⇄ Divisé et
**`Shift + F6`** alterne Aperçu ⇄ Divisé (Divisé est l'état de base). Le choix est
mémorisé par onglet. Définissez la valeur par défaut pour les fichiers nouvellement
ouverts dans **Paramètres → Formats → Mode d'affichage par défaut**.

Les formats sans aperçu (texte brut, visionneuses de code) affichent toujours la
source seule, donc aucun sélecteur n'apparaît.

## Fichiers multimédias (images, vidéo, audio)

Ouvrez une image, une vidéo ou un fichier audio et VMark l'affiche directement — comme
Coup d'œil (Quick Look) dans le Finder. Deux façons de prévisualiser :

- **Ouvrez-le** (cliquez dessus dans l'explorateur de fichiers, utilisez **Fichier →
  Ouvrir un fichier…**, ou faites-le glisser) pour l'afficher dans un onglet.
- **Coup d'œil** : sélectionnez un fichier dans l'explorateur et appuyez sur **Espace**
  pour un aperçu en surimpression sur toute la fenêtre. Appuyez sur **Espace**, **Échap**,
  ou cliquez sur l'arrière-plan pour fermer.

Fonctionnement et ce à quoi s'attendre :

- **Jamais chargé comme texte.** Un média est binaire — VMark transmet le fichier
  directement à la visionneuse via le pipeline d'assets natif. Il n'est jamais lu en
  UTF-8, jamais conservé en mémoire comme document, et jamais modifiable ni enregistré.
  Même des vidéos de plusieurs gigaoctets s'ouvrent instantanément et se parcourent
  nativement.
- **Les modifications sur disque apparaissent.** Réexportez l'image depuis votre
  éditeur, ou laissez un script la réécrire, et l'onglet ouvert récupère la nouvelle
  version de lui-même — sans rouvrir, sans fermer puis rouvrir le fichier.
- **Large couverture de formats.** VMark confie le fichier au moteur multimédia de la
  plateforme, donc la prise en charge suit ce que la webview de votre système sait
  décoder. Sur macOS, c'est large — HEIC, TIFF, `.mov`/H.264 et FLAC sont tous lus.
  Les formats que la webview ne sait pas décoder (par ex. `.mkv`, `.avi`, `.wmv`)
  s'ouvrent quand même, avec un panneau de repli proposant **Ouvrir avec l'application
  par défaut** et **Afficher dans le Finder** (**Afficher dans l'Explorateur** sous
  Windows, **Afficher dans le gestionnaire de fichiers** sous Linux).
- **Lecture seule.** Les onglets de médias ne deviennent jamais modifiés et se ferment
  sans demande d'enregistrement.

## Aperçus adaptés au schéma

Lorsque le chemin ou le contenu correspond à un schéma connu, VMark substitue la vue appropriée à l'arbre générique.

### Workflow GitHub Actions (`.github/workflows/*.yml`)

S'ouvre avec l'atelier de workflow : le canevas interactif du DAG des jobs plus un éditeur de formulaires structuré avec Enregistrer / Abandonner (voir le [guide de la visionneuse de workflow](/fr/guide/workflow-viewer)). Le volet source connaît lui aussi les workflows — complétion des expressions `${{ }}`, mise en évidence du job sur le canevas selon la position du curseur, et Cmd-clic sur les références `uses:` locales.

- Détection par chemin : un fichier `.yml` / `.yaml` sous `.github/workflows/` est dirigé vers le moteur de rendu de workflow — même avec du YAML malformé, de sorte que vous voyez la vue dégradée avec des diagnostics plutôt qu'un arbre vide. (Le fichier doit d'abord atteindre l'adaptateur YAML ; cela nécessite l'extension `.yml`/`.yaml`.)
- Détection par contenu : clés de premier niveau `on:` et `jobs:`.

### Workflow VMark (`steps:` de premier niveau)

S'ouvre avec le panneau d'exécution de workflow : une barre d'outils **Exécuter** / **Annuler** avec une ligne d'état, le graphe d'étapes en direct (ou l'erreur d'analyse), et **Restaurer les fichiers** après une exécution qui a écrit des fichiers. Voir le [guide des workflows](/fr/guide/workflows).

- Détection par chemin : jamais sous `.github/workflows/` — ce dossier appartient à GitHub.
- Détection par contenu : le YAML s'analyse correctement, n'a pas de `jobs:` de premier niveau, et a une liste `steps:` de premier niveau dans laquelle le `uses:` d'au moins une étape commence par `genie/`, `action/` ou `webhook/`. Un YAML invalide n'est jamais un workflow VMark.
- Le panneau nécessite **Paramètres → Avancé → Moteur de workflow**. Moteur désactivé, le fichier affiche l'arbre YAML ordinaire (sauf si une exécution lancée depuis cet onglet est toujours en cours, afin que son bouton Annuler reste accessible).

### `Cargo.toml`

S'ouvre avec un arbre de dépendances Rust — dépendances d'exécution, de développement et de compilation, avec les spécifications de version et les indicateurs de fonctionnalité.

- Détection par chemin : nom de fichier `Cargo.toml` (insensible à la casse) sur les chemins POSIX ou Windows.
- Détection par contenu : en-tête `[package]` ou `[workspace]`.
- Aucun appel réseau — VMark ne résout jamais crates.io.

### `package.json`

S'ouvre avec un arbre de dépendances npm — `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`.

- Détection par chemin : nom de fichier `package.json`.
- Détection par contenu : `name` de premier niveau plus n'importe lequel de `dependencies` / `devDependencies` / `peerDependencies`.

### `pyproject.toml`

S'ouvre avec un arbre de dépendances Python — à la fois PEP 621 (`[project]` + `[project.optional-dependencies]`) et Poetry (`[tool.poetry.dependencies]`, `[tool.poetry.dev-dependencies]`, `[tool.poetry.group.<name>.dependencies]`).

- Détection par chemin : nom de fichier `pyproject.toml`.
- Détection par contenu : en-tête `[project]` ou `[tool.poetry]` (subordonné à une analyse TOML réussie).

## Règles d'édition

- **Markdown** propose la barre d'outils complète, le formatage des paragraphes, les règles CJK, les maths, mermaid, les notes de bas de page — toutes les fonctionnalités markdown existantes.
- **Formats de données** (JSON, YAML, TOML) s'affichent dans le volet source avec des marqueurs d'erreur de parsing dans la marge ; l'aperçu en arbre se met à jour à la frappe. Les actions de menu propres au Markdown sont désactivées (formatage CJK, insertion de bloc, formatage de paragraphe) ; les contrôles pertinents au mode restent actifs. Le menu contextuel du clic droit est réduit aux actions du presse-papiers (Couper/Copier/Coller/Tout sélectionner).
- **Formats visuels** (Mermaid, SVG, HTML) s'affichent dans le volet source avec la vue rendue dans le volet droit. L'aperçu est rendu avec une priorité inférieure à votre frappe : sur un document volumineux, il rattrape le curseur avec un léger décalage plutôt que de se re-rendre à chaque frappe.
- **Formats de code** s'ouvrent comme des visionneuses à coloration syntaxique ; basculez pour modifier sur place ou ouvrir dans votre éditeur externe (voir ci-dessous).

## Dialecte Markdown

VMark lit et écrit le Markdown avec remark (micromark en dessous) : CommonMark, plus GitHub Flavored Markdown (tableaux, listes de tâches, barré avec `~~`, liens automatiques, notes de bas de page), le front matter YAML, les maths `$…$` / `$$…$$`, les liens wiki (`[[target]]`), les alertes GitHub (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`), les blocs `<details>`, `[TOC]`, et quatre marques en ligne : `==highlight==`, `~subscript~`, `^superscript^` et `++underline++`. Un tilde simple donne un indice, jamais un barré.

**Limite d'imbrication.** Le WYSIWYG prend en charge les citations et les listes imbriquées jusqu'à 1000 niveaux de profondeur. Un document plus profond s'ouvre en **mode Source** avec un message indiquant sa profondeur, et la barre d'état affiche *« Ouvert en mode Source (impossible à afficher en WYSIWYG). »* Tant qu'il est dans cet état, le fichier est protégé contre l'écrasement par l'éditeur enrichi. Réduisez l'imbrication, puis utilisez **Passer au WYSIWYG**. Le code délimité, les séparateurs thématiques et l'emphase en ligne ne comptent pas dans la limite. Voir aussi [Fichiers volumineux](/fr/guide/large-files).

## Comment VMark détermine le type d'un fichier

VMark traite **le markdown comme une liste d'autorisation, pas comme une valeur par défaut**. La règle, dans l'ordre :

1. **Une extension de la famille markdown** (`.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx`) s'ouvre dans l'éditeur markdown enrichi.
2. **Une extension non-markdown enregistrée** (lorsque sa catégorie est activée — JSON, YAML, visionneuses de code, etc.) s'ouvre dans le volet source de ce format.
3. **Tout le reste** — `.env`, `.env.local`, `Dockerfile`, `Makefile`, `.gitignore`, extensions inconnues — s'ouvre dans le **volet source en texte brut**, jamais dans l'éditeur markdown.

Ainsi, un fichier de configuration n'est jamais rendu silencieusement comme du markdown. Un `.env.local` s'ouvre en texte brut, avec ses lignes `KEY=value`, ses commentaires `#` et ses tirets bas laissés exactement tels que saisis.

Les familles de fichiers point sont reconnues en groupe : un remplacement sur `.env` couvre `.env.local`, `.env.production`, et ainsi de suite.

### Ouvrir des fichiers depuis votre système

Le programme d'installation enregistre VMark auprès de votre système d'exploitation comme éditeur pour ces types de fichiers, de sorte qu'ils apparaissent dans **Ouvrir avec** et peuvent être ouverts dans VMark d'un double-clic :

| Extensions | Enregistré comme |
|---|---|
| `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx` | Document Markdown |
| `.txt` | Document texte brut |
| `.json`, `.jsonl` | Document JSON |
| `.yaml`, `.yml` | Document YAML |
| `.toml` | Document TOML |
| `.mmd` | Diagramme Mermaid |
| `.svg` | Image SVG |
| `.html`, `.htm` | Document HTML |

Sous **Windows**, le programme d'installation ne s'approprie pas un type de fichier déjà géré par autre chose : pour chaque extension qui a déjà un programme par défaut, VMark s'ajoute à **Ouvrir avec** et laisse ce programme par défaut en place. Il ne devient le programme par défaut que là où rien n'était enregistré — en pratique les extensions Markdown, et non `.txt`, `.html`, `.htm` ou `.svg`. Un programme par défaut que vous choisissez vous-même dans les paramètres de Windows l'emporte toujours. La désinstallation restaure l'entrée de menu **Nouveau → Document texte** de Windows et le gestionnaire précédent.

Un fichier enregistré ne s'ouvre dans VMark que si son format est activé (voir [Activer les formats](#activer-les-formats)) ; sinon, il s'ouvre en texte brut.

Sous Windows et Linux, un dossier passé en ligne de commande (`vmark C:\notes` ou `vmark ~/notes`) s'ouvre comme espace de travail dans sa propre fenêtre, comme le fait le dépôt d'un dossier sur l'icône du Dock sous macOS. Cela fonctionne aussi lorsque VMark est déjà en cours d'exécution.

### Coloration syntaxique des fichiers en texte brut

Même lorsqu'un fichier s'ouvre en texte brut, VMark le colore lorsqu'il en reconnaît le type — `.env`/`.ini`/`.conf` (propriétés), `.sh`/`.bash` (shell), `Dockerfile`, `.toml`, `.sql`, `.diff`, et les langages habituels. C'est purement cosmétique ; cela ne change jamais l'éditeur dans lequel le fichier s'est ouvert, et cela fonctionne que la catégorie des visionneuses de code soit activée ou non.

### Remplacement : « Définir le type de fichier »

La détection est une valeur par défaut, pas une cage. Ouvrez la palette de commandes et exécutez :

- **Définir le type de fichier : Texte brut** — force la famille du fichier courant à s'ouvrir en texte brut (par ex. empêcher le rendu d'un `.txt` que vous gardez comme notes brutes).
- **Définir le type de fichier : Markdown** — affiche un fichier non-`.md` avec l'éditeur markdown (par ex. un `.txt` dans lequel vous écrivez réellement du markdown).
- **Définir le type de fichier : Réinitialiser** — supprime le remplacement.

Les remplacements sont mémorisés par famille de fichiers (par extension, ou par radical de fichier point pour des fichiers comme `.env`) et persistent d'une session à l'autre. Ils ont priorité sur les règles intégrées ci-dessus.

## Recherche, sauvegarde, recherche dans le contenu

- **Fichier → Ouvrir un fichier…** propose deux filtres : **Tous les formats pris en charge** (chaque format enregistré) et **Markdown**. L'élément n'a pas de raccourci par défaut — `Mod + O` est **Ouverture rapide** —, mais vous pouvez lui en attribuer un dans **Paramètres → Raccourcis**. Les filtres Enregistrer sous et l'extension de sauvegarde par défaut sont dérivés de l'adaptateur de format de l'onglet actif, donc sauvegarder un fichier `.toml` propose `.toml` comme extension.
- **Glisser-déposer** accepte toute extension enregistrée.
- **Enregistrer sous** les filtres et l'extension par défaut à l'enregistrement sont dérivés de l'adaptateur de format de l'onglet actif.
- **Cmd+Shift+H** recherche dans le contenu (« Rechercher dans les fichiers ») indexe chaque format textuel (markdown, txt, json, yaml, toml, html, svg, mermaid). Les fichiers de code sont exclus par défaut — ils sont en mode visionneuse.

## Modèle de sécurité pour HTML

Conformément à l'ADR-4 du plan multi-format, l'aperçu HTML repose sur trois couches de défense indépendantes :

1. **`<iframe sandbox="">`** avec une liste d'autorisation vide — aucun script, pas de même origine, pas de formulaires, pas de popups. L'isolation est appliquée par l'attribut iframe seul (la CSP via `<meta>` n'est pas un sandbox selon MDN).
2. **Désinfection DOMPurify** en premier — supprime les `<script>`, les URLs `javascript:`, les gestionnaires d'événements en ligne, les astuces base-href.
3. **Injection de `<meta>` CSP** — `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none';` — limite le chargement des ressources dans l'iframe.

Le validateur signale les balises script, les URLs `javascript:` et les gestionnaires d'événements en ligne comme avertissements afin que vous puissiez voir ce qui est bloqué. Une fois que vous avez [approuvé le fichier](#apercu-html-approuve-sur-activation), ils s'affichent plutôt comme informations, afin que rien ne contredise la bannière d'approbation. Deux messages indiquent ce que l'aperçu n'autorise jamais, approuvé ou non : un script externe (`<script src="…">`) n'est jamais chargé, car aucun script ne provient d'un fichier ou d'une URL, et un lien `javascript:` visant une autre fenêtre ou la page de premier niveau (`target="_top"`, `_blank`, ou un `<base target>`) ne navigue jamais, car l'aperçu ne peut pas sortir de lui-même. La détection lit les balises de la page de manière approximative ; elle étiquette les constats et ne décide jamais de ce qui s'exécute — c'est le sandbox qui le fait.

La validation de sécurité formelle de cet aperçu est toujours en attente, et l'aperçu l'indique dans un avis au-dessus de la page rendue : **L'aperçu HTML est isolé. Son examen de sécurité est encore en cours.** Les trois couches ci-dessus sont en place ; l'étape restante consiste à les confirmer face aux charges XSS de l'OWASP dans la webview de l'application en cours d'exécution.

### Aperçu HTML approuvé (sur activation)

L'aperçu sécurisé ci-dessus est le comportement par défaut et ne change jamais. Pour un
document que vous avez écrit vous-même — un laboratoire interactif, un tableau de bord
local, une démo autonome — vous pouvez autoriser l'exécution de scripts pour **ce seul
fichier, pour cette session**.

Utilisez **Activer l'aperçu approuvé…** dans la barre au-dessus de l'aperçu. Un
avertissement s'affiche d'abord ; rien ne s'exécute tant que vous n'avez pas confirmé.
Tant qu'il est actif, la barre reste visible et indique **Approuvé — scripts activés**,
et **Révoquer l'approbation** est à un clic.

Ce que le mode approuvé accorde, et ce qu'il n'accorde pas :

| | Aperçu approuvé |
|---|---|
| JavaScript, DOM, événements de pointeur, `requestAnimationFrame`, Web Audio | ✅ s'exécute |
| Réseau (`fetch`, `XMLHttpRequest`, WebSocket, images/scripts distants) | ❌ bloqué par `default-src 'none'` |
| La page de VMark elle-même, les commandes Tauri, votre système de fichiers | ❌ inaccessibles — le document s'exécute dans sa propre origine opaque |
| Navigation de premier niveau, popups, envoi de formulaires, téléchargements, fenêtres modales | ❌ non accordés (`sandbox="allow-scripts"` et rien d'autre) |
| Caméra, microphone, géolocalisation, presse-papiers | ❌ aucune fonctionnalité n'est déléguée au cadre |
| `localStorage` / `sessionStorage` | ❌ indisponibles — une origine opaque n'a pas de stockage de même origine |
| `eval` / `new Function` | ❌ non autorisés |

Trois propriétés à connaître :

- **L'approbation n'est jamais déduite.** Ni de l'extension `.html`, ni de la
  provenance du fichier, ni d'un fichier voisin que vous avez déjà approuvé. Seule la
  confirmation l'accorde.
- **L'approbation n'est jamais conservée.** Fermez VMark et chaque autorisation
  disparaît. Elle est aussi indisponible pour un document non enregistré, qui n'a pas
  d'identité à laquelle rattacher une autorisation — enregistrez d'abord le fichier.
- **Un aperçu approuvé ne se relance jamais de lui-même.** Modifier la source le marque
  *Peut ne pas correspondre à la source actuelle* et attend **Recharger**, de sorte
  qu'une simulation en cours n'est pas réinitialisée à chaque frappe. Le même marqueur
  apparaît lorsque VMark ne peut pas savoir ce que le cadre exécute — après avoir quitté
  l'onglet puis y être revenu, ou l'avoir fermé puis rouvert, l'aperçu continue
  d'exécuter ce qui a été publié en dernier pour ce fichier, et il le signale donc plutôt
  que de prétendre être à jour. **Recharger** republie le fichier dans son état actuel.

::: info Windows le sert via une origine http locale
WebView2 ne prend pas en charge les schémas d'URL personnalisés : sous Windows, le
document approuvé est donc servi depuis `http://vmark-trusted.localhost` au lieu de
`vmark-trusted://` — la même autorisation, le même sandbox et la même CSP, sous la forme
d'URL que Tauri utilise pour tout protocole personnalisé sur cette plateforme. L'aperçu
sécurisé fonctionne sur toutes les plateformes.
:::

Le contenu approuvé est servi depuis une origine `vmark-trusted://`
(`http://vmark-trusted.localhost` sous Windows) avec sa propre CSP restrictive. Ce
détour est nécessaire et non décoratif : un cadre `srcdoc`, `blob:` ou `data:` hérite
de la politique `script-src 'self'` de VMark, et une CSP à l'intérieur du cadre ne peut
que resserrer une politique héritée, jamais l'assouplir — aucun attribut d'iframe ne
peut donc à lui seul faire exécuter un script en ligne.

## Ouvrir dans l'éditeur externe

Pour les fichiers de code, le bouton **Ouvrir dans l'éditeur externe** de la bannière en lecture seule lance l'éditeur de votre choix. Ordre de résolution :

1. **Paramètres → Formats → Éditeur externe** (le champ GUI — voir [Paramètres](/fr/guide/settings#formats)). Saisissez soit le **nom d'un éditeur connu** (`code`, `cursor`, `zed`, `subl`, `bbedit`, `idea`, `vim`, `nvim`, `emacs`, `notepad++`, …), soit le **chemin complet** d'un éditeur — un bundle `.app` sur macOS, un exécutable sur Linux/Windows. Le champ contient un seul programme, jamais d'arguments ; pour passer des arguments, utilisez `$VMARK_EXTERNAL_EDITOR`.
2. `$VMARK_EXTERNAL_EDITOR` (substitution d'env au niveau du projet)
3. `$VISUAL`
4. `$EDITOR`
5. Valeur par défaut de la plateforme (`open -t` sur macOS, `notepad.exe` sur Windows, `xdg-open` sur Linux)

Le paramètre GUI a priorité sur les variables d'environnement — l'explicite prime sur l'implicite. Laissez le champ vide pour utiliser la chaîne de substitution par variables d'env.

VMark passe par un PATH de shell de connexion afin que VS Code / Cursor / les wrappers JetBrains se résolvent correctement lorsqu'ils sont lancés depuis une application GUI macOS.

### Portail de sécurité

Le paramètre **Éditeur externe** lui-même est vérifié avant tout lancement. VMark refuse :

- les caractères de shell (`;`, `|`, `&`, `` ` ``, `$`, `<`, `>`, guillemets, sauts de ligne) et un `-` initial
- un nom seul qui ne correspond pas à un éditeur que VMark connaît — *« X » n’est pas un éditeur que VMark reconnaît par son nom : saisissez plutôt le chemin complet de l’éditeur*
- un chemin relatif, un chemin comportant un segment `..` ou une barre oblique finale, ou un chemin qui n'existe pas
- un programme qui exécute les fichiers qu'on lui donne au lieu de les ouvrir — un shell (`sh`, `bash`, `zsh`, `pwsh`, `cmd`, …), un interpréteur (`python`, `node`, `ruby`, `perl`, `osascript`, …), un lanceur (`env`, `sudo`, `open`, `xdg-open`, …) ou un émulateur de terminal — vérifié à la fois sous le nom que vous avez saisi et sous le nom vers lequel un lien se résout

Les variables d'environnement de la chaîne de repli ne sont pas restreintes : elles sont définies en dehors de VMark, par vous.

La commande Tauri `open_in_external_editor` rejette également :

- les chemins inexistants
- les répertoires et autres fichiers non réguliers (sockets, périphériques)
- les chemins dont l'extension canonicalisée n'est pas dans l'ensemble des formats enregistrés de VMark
- les liens symboliques dont la cible canonique échoue à l'un des contrôles ci-dessus

Une webview compromise ne peut pas utiliser le bouton pour lancer l'éditeur externe sur des fichiers système arbitraires (mots de passe, clés, etc.) — uniquement sur des chemins que VMark lui-même ouvrirait.

## Ce qui n'est pas pris en charge

Conformément aux objectifs hors périmètre du plan :

- **Pas un éditeur de code.** Pas de LSP, pas d'autocomplétion, pas de refactoring, pas de débogueur, pas de gouttières git.
- **Pas « tout format texte brut ».** Périmètre délimité — voir le tableau ci-dessus.
- **Pas d'exécution de scripts HTML par défaut.** Rendu isolé uniquement, sauf si vous
  autorisez explicitement un fichier via l'[aperçu HTML approuvé](#apercu-html-approuve-sur-activation).
- **Pas d'impression / export / copie en HTML pour les formats non-markdown** en v1.
- **Pas encore pris en charge comme visionneuses de code** : Zig, Swift, Kotlin, Java, Elixir, OCaml et d'autres langages hors du jeu des 12 extensions. La règle de décision est « les langages que nous utilisons nous-mêmes » — ouvrez un ticket si vous souhaitez qu'un langage soit ajouté.

Si un format que vous souhaitez n'est pas listé et n'est pas délibérément hors périmètre, ouvrez un ticket.
