# Formats pris en charge

VMark ouvre directement tous les formats de fichier listés ci-dessous. La particularité est l'**aperçu adapté au schéma** : lorsqu'un fichier est un artefact reconnu, VMark affiche la *bonne* vue plutôt qu'un arbre JSON générique.

[[toc]]

## Activer les formats

Markdown, texte brut et YAML/YML s'ouvrent toujours dans leurs éditeurs complets — ce sont les valeurs par défaut tranquilles. Chaque autre format ci-dessous est **désactivé par défaut** et subordonné à un basculement de catégorie dans **Paramètres → Formats** :

| Basculement | Active |
|---|---|
| **Formats de données** | `.json`, `.jsonl`, `.toml` (volet source + arbre avec rendus de schéma Cargo / package.json / pyproject) |
| **Diagrammes & SVG** | `.mmd`, `.svg` (volet source + rendu en direct désinfecté) |
| **Aperçu HTML** | `.html`, `.htm` (iframe isolée — voir [Modèle de sécurité pour HTML](#modèle-de-sécurité-pour-html)) |
| **Visionneuses de code** | 12 visionneuses de code en lecture seule (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua`) |

Lorsqu'une catégorie est désactivée, les extensions correspondantes basculent vers le mode texte brut — le fichier s'ouvre quand même, simplement sans l'aperçu ni la vue schéma. Activez un basculement et le registre se reconstruit à la volée ; les onglets ouverts se remontent avec l'adaptateur approprié.

Au premier lancement après une mise à niveau vers la prise en charge multi-format, VMark affiche une notification ponctuelle vous invitant à aller dans **Paramètres → Formats**. Si vous l'avez ignorée (ou si vous avez effectué une installation fraîche), le panneau est accessible à tout moment via **Paramètres → Formats**.

## Vue d'ensemble

| Famille | Extensions | Par défaut | Éditeur | Aperçu |
|---|---|---|---|---|
| Markdown | `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx` | toujours actif | modes WYSIWYG + Source | prose rendue |
| Texte brut | `.txt` | toujours actif | source | — |
| Données — YAML | `.yaml`, `.yml` | toujours actif | source + arbre | arbre navigable, adapté au schéma (GitHub Actions) |
| Données — JSON | `.json`, `.jsonl` | nécessite le basculement **Formats de données** | source + arbre | arbre JSON navigable, adapté au schéma (`package.json`) |
| Données — TOML | `.toml` | nécessite le basculement **Formats de données** | source + arbre | arbre navigable, adapté au schéma (`Cargo.toml`, `pyproject.toml`) |
| Diagrammes | `.mmd` | nécessite le basculement **Diagrammes & SVG** | source + rendu | diagramme Mermaid en direct |
| Vecteur | `.svg` | nécessite le basculement **Diagrammes & SVG** | source + rendu | rendu intégré désinfecté |
| Web | `.html`, `.htm` | nécessite le basculement **Aperçu HTML** | source + rendu | iframe isolée (attribut `sandbox=""` vide, DOMPurify, CSP) |
| Code (lecture seule) | `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua` | nécessite le basculement **Visionneuses de code** | visionneuse (basculer pour modifier) | — |

Les fichiers de code s'ouvrent en lecture seule avec une bannière proposant **Activer l'édition** ou **Ouvrir dans l'éditeur externe**.

## Aperçus adaptés au schéma

Lorsque le chemin ou le contenu correspond à un schéma connu, VMark substitue la vue appropriée à l'arbre générique.

### Workflow GitHub Actions (`.github/workflows/*.yml`)

S'ouvre avec la visualisation du workflow (DAG des jobs, déclencheurs, permissions).

- Détection par chemin : un fichier `.yml` / `.yaml` sous `.github/workflows/` est dirigé vers le moteur de rendu de workflow — même avec du YAML malformé, de sorte que vous voyez la vue dégradée avec des diagnostics plutôt qu'un arbre vide. (Le fichier doit d'abord atteindre l'adaptateur YAML ; cela nécessite l'extension `.yml`/`.yaml`.)
- Détection par contenu : clés de premier niveau `on:` et `jobs:`.

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
- **Formats de données** (JSON, YAML, TOML) s'affichent dans le volet source avec des marqueurs d'erreur de parsing dans la marge ; l'aperçu en arbre se met à jour à la frappe. Les actions de menu propres au Markdown sont désactivées (formatage CJK, insertion de bloc, formatage de paragraphe) ; les contrôles pertinents au mode restent actifs.
- **Formats visuels** (Mermaid, SVG, HTML) s'affichent dans le volet source avec la vue rendue dans le volet droit (avec rebond).
- **Formats de code** s'ouvrent comme des visionneuses à coloration syntaxique ; basculez pour modifier sur place ou ouvrir dans votre éditeur externe (voir ci-dessous).

## Recherche, sauvegarde, recherche dans le contenu

- **Cmd+O** filtre : une seule préférence « Tous les formats pris en charge » couvrant chaque format enregistré. Les filtres Enregistrer sous et l'extension de sauvegarde par défaut sont dérivés de l'adaptateur de format de l'onglet actif, donc sauvegarder un fichier `.toml` propose `.toml` comme extension.
- **Glisser-déposer** accepte toute extension enregistrée.
- **Enregistrer sous** les filtres et l'extension par défaut à l'enregistrement sont dérivés de l'adaptateur de format de l'onglet actif.
- **Cmd+Shift+H** recherche dans le contenu (« Rechercher dans les fichiers ») indexe chaque format textuel (markdown, txt, json, yaml, toml, html, svg, mermaid). Les fichiers de code sont exclus par défaut — ils sont en mode visionneuse.

## Modèle de sécurité pour HTML

Conformément à l'ADR-4 du plan multi-format, l'aperçu HTML repose sur trois couches de défense indépendantes :

1. **`<iframe sandbox="">`** avec une liste d'autorisation vide — aucun script, pas de même origine, pas de formulaires, pas de popups. L'isolation est appliquée par l'attribut iframe seul (la CSP via `<meta>` n'est pas un sandbox selon MDN).
2. **Désinfection DOMPurify** en premier — supprime les `<script>`, les URLs `javascript:`, les gestionnaires d'événements en ligne, les astuces base-href.
3. **Injection de `<meta>` CSP** — `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none';` — limite le chargement des ressources dans l'iframe.

Le validateur signale les balises script, les URLs `javascript:` et les gestionnaires d'événements en ligne comme avertissements afin que vous puissiez voir ce qui est bloqué.

## Ouvrir dans l'éditeur externe

Pour les fichiers de code, le bouton **Ouvrir dans l'éditeur externe** de la bannière en lecture seule lance l'éditeur de votre choix. Ordre de résolution :

1. **Paramètres → Formats → Éditeur externe** (le champ GUI — voir [Paramètres](/fr/guide/settings#formats)). Choisissez un bundle `.app` sur macOS, un exécutable sur Linux/Windows, ou tout ce que votre shell résoudrait.
2. `$VMARK_EXTERNAL_EDITOR` (substitution d'env au niveau du projet)
3. `$VISUAL`
4. `$EDITOR`
5. Valeur par défaut de la plateforme (`open -t` sur macOS, `notepad.exe` sur Windows, `xdg-open` sur Linux)

Le paramètre GUI a priorité sur les variables d'environnement — l'explicite prime sur l'implicite. Laissez le champ vide pour utiliser la chaîne de substitution par variables d'env.

VMark passe par un PATH de shell de connexion afin que VS Code / Cursor / les wrappers JetBrains se résolvent correctement lorsqu'ils sont lancés depuis une application GUI macOS.

### Portail de sécurité

La commande Tauri `open_in_external_editor` rejette :

- les chemins inexistants
- les répertoires et autres fichiers non réguliers (sockets, périphériques)
- les chemins dont l'extension canonicalisée n'est pas dans l'ensemble des formats enregistrés de VMark
- les liens symboliques dont la cible canonique échoue à l'un des contrôles ci-dessus

Une webview compromise ne peut pas utiliser le bouton pour lancer l'éditeur externe sur des fichiers système arbitraires (mots de passe, clés, etc.) — uniquement sur des chemins que VMark lui-même ouvrirait.

## Ce qui n'est pas pris en charge

Conformément aux objectifs hors périmètre du plan :

- **Pas un éditeur de code.** Pas de LSP, pas d'autocomplétion, pas de refactoring, pas de débogueur, pas de gouttières git.
- **Pas « tout format texte brut ».** Périmètre délimité — voir le tableau ci-dessus.
- **Pas d'exécution de scripts HTML.** Rendu isolé uniquement.
- **Pas d'impression / export / copie en HTML pour les formats non-markdown** en v1.
- **Pas encore pris en charge comme visionneuses de code** : Zig, Swift, Kotlin, Java, Elixir, OCaml et d'autres langages hors du jeu des 12 extensions. La règle de décision est « les langages que nous utilisons nous-mêmes » — ouvrez un ticket si vous souhaitez qu'un langage soit ajouté.

Si un format que vous souhaitez n'est pas listé et n'est pas délibérément hors périmètre, ouvrez un ticket.
