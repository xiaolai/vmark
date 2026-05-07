# Paramètres

Le panneau de paramètres de VMark vous permet de personnaliser chaque aspect de l'éditeur. Ouvrez-le avec `Mod + ,` ou via **VMark > Paramètres** dans la barre de menus.

La fenêtre de paramètres comporte une barre latérale avec des sections regroupées par sujet — les sections les plus utilisées apparaissent en premier, avec À propos et Avancé en bas. Les modifications prennent effet immédiatement — il n'y a pas de bouton d'enregistrement.

## Apparence

Contrôle le thème visuel et le comportement des fenêtres.

### Thème

Choisissez parmi cinq thèmes de couleurs. Le thème actif est indiqué par un anneau autour de son échantillon.

| Thème | Arrière-plan | Style |
|-------|-------------|-------|
| Blanc | `#FFFFFF` | Propre, contraste élevé |
| Papier | `#EEEDED` | Neutre chaud (par défaut) |
| Menthe | `#CCE6D0` | Vert doux, agréable pour les yeux |
| Sépia | `#F9F0DB` | Jaunâtre chaud, aspect livre |
| Nuit | `#23262B` | Mode sombre |

### Langue

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Langue | Change la langue de l'interface pour les menus, libellés et messages. Prend effet immédiatement | Anglais | English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Italiano, Português (Brasil) |

### Fenêtre

| Paramètre | Description | Par défaut |
|-----------|-------------|------------|
| Afficher le nom de fichier dans la barre de titre | Afficher le nom du fichier courant dans la barre de titre de la fenêtre macOS | Désactivé |
| Masquer automatiquement la barre d'état | Masquer automatiquement la barre d'état lorsque vous n'interagissez pas avec elle | Désactivé |

## Éditeur

Typographie, affichage, comportement d'édition et paramètres d'espacement.

### Typographie

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Police latine | Famille de polices pour le texte latin (anglais) | Système par défaut | Système par défaut, Athelas, Palatino, Georgia, Charter, Literata |
| Police CJK | Famille de polices pour le texte chinois, japonais, coréen | Système par défaut | Système par défaut, PingFang SC, Songti SC, Kaiti SC, Noto Serif CJK, Source Han Sans |
| Police mono | Famille de polices pour le code et le texte à espacement fixe | Système par défaut | Système par défaut, SF Mono, Monaco, Menlo, Consolas, JetBrains Mono, Fira Code, SauceCodePro NFM, IBM Plex Mono, Hack, Inconsolata |
| Taille de police | Taille de police de base pour le contenu de l'éditeur | 18px | 14px, 16px, 18px, 20px, 22px |
| Interligne | Espacement vertical entre les lignes | 1.8 (Détendu) | 1.4 (Compact), 1.6 (Normal), 1.8 (Détendu), 2.0 (Spacieux), 2.2 (Extra) |
| Espacement des blocs | Écart visuel entre les éléments de bloc (titres, paragraphes, listes) mesuré en multiples de l'interligne | 1x (Normal) | 0.5x (Serré), 1x (Normal), 1.5x (Détendu), 2x (Spacieux) |
| Espacement des lettres CJK | Espacement supplémentaire entre les caractères CJK, en unités em | Désactivé | Désactivé, 0.02em (Subtil), 0.03em (Léger), 0.05em (Normal), 0.08em (Large), 0.10em (Plus large), 0.12em (Extra) |

### Affichage

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Largeur de l'éditeur | Largeur maximale du contenu. Des valeurs plus larges conviennent aux grands moniteurs ; des valeurs plus étroites améliorent la lisibilité | 50em (Moyen) | 36em (Compact), 42em (Étroit), 50em (Moyen), 60em (Large), 80em (Extra large), Illimité |

::: tip
50em à 18px de taille de police correspond à environ 900px — une largeur de lecture confortable pour la plupart des écrans.
:::

### Comportement

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Taille de tabulation | Nombre d'espaces insérés lors de l'appui sur Tab | 2 espaces | 2 espaces, 4 espaces |
| Activer l'appariement automatique | Insérer automatiquement les crochets fermants et guillemets correspondants lorsque vous tapez un ouvrant | Activé | Activé / Désactivé |
| Crochets CJK | Apparier automatiquement les crochets spécifiques au CJK comme `「」` `【】` `《》`. Disponible uniquement lorsque l'appariement automatique est activé | Auto | Désactivé, Auto |
| Inclure les guillemets courbes | Apparier automatiquement les caractères `""` et `''`. Peut entrer en conflit avec certaines fonctionnalités de guillemets intelligents d'IME. Apparaît lorsque les crochets CJK sont en Auto | Activé | Activé / Désactivé |
| Aussi apparier `"` | Taper le guillemet double droit fermant `"` insère également une paire `""`. Utile lorsque votre IME alterne entre guillemets ouvrants et fermants. Apparaît lorsque les guillemets courbes sont activés | Désactivé | Activé / Désactivé |
| Format de copie | Format à utiliser pour l'emplacement presse-papiers texte brut lors de la copie en mode WYSIWYG | Texte brut | Texte brut, Markdown |
| Copier à la sélection | Copier automatiquement le texte dans le presse-papiers à chaque fois que vous le sélectionnez | Désactivé | Activé / Désactivé |

### Espacement

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Fins de ligne à l'enregistrement | Contrôler comment les fins de ligne sont gérées lors de l'enregistrement des fichiers | Conserver l'existant | Conserver l'existant, LF (`\n`), CRLF (`\r\n`) |
| Conserver les sauts de ligne consécutifs | Garder plusieurs lignes vides telles quelles au lieu de les réduire | Désactivé | Activé / Désactivé |
| Style de saut de ligne dur à l'enregistrement | Comment les sauts de ligne durs sont représentés dans le fichier Markdown enregistré | Conserver l'existant | Deux espaces (Recommandé), Conserver l'existant, Barre oblique inverse (`\`) |
| Afficher les balises `<br>` | Afficher les balises de saut de ligne HTML visiblement dans l'éditeur | Désactivé | Activé / Désactivé |

::: tip
Deux espaces est le style de saut de ligne dur le plus compatible — il fonctionne sur GitHub, GitLab et tous les principaux rendus Markdown. Le style barre oblique inverse peut échouer sur Reddit, Jekyll et certains analyseurs plus anciens.
:::

## Markdown

Comportement de collage, mise en page et paramètres de rendu HTML.

### Coller & Saisir

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Activer les expressions régulières dans la recherche | Afficher un bouton de basculement regex dans la barre Rechercher & Remplacer | Activé | Activé / Désactivé |
| Mode collage | Comment VMark route le contenu depuis le presse-papiers | Intelligent | Intelligent, Brut |
| Coller intelligemment le Markdown | Lors du collage de texte ressemblant à du Markdown dans l'éditeur WYSIWYG, le convertir automatiquement en contenu enrichi | Auto | Auto, Désactivé |

### Mise en page

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Taille de police des éléments de bloc | Taille de police relative pour les listes, citations, tableaux, alertes et blocs de détails | 100% | 100%, 95%, 90%, 85% |
| Alignement des titres | Alignement du texte pour les titres | Gauche | Gauche, Centre |
| Bordures d'images et diagrammes | Afficher ou non une bordure autour des images, diagrammes Mermaid et blocs mathématiques | Aucune | Aucune, Toujours, Au survol |
| Alignement des images et tableaux | Alignement horizontal pour les images et tableaux en bloc | Centre | Centre, Gauche |

### Lint

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Activer le lint markdown | Vérifier les problèmes markdown courants (liens cassés, texte alt manquant, niveaux de titre, blocs de code non fermés, etc.) | Activé | Activé / Désactivé |

Voir [Lint Markdown](/fr/guide/lint) pour la liste complète des règles et les niveaux de gravité.

### Rendu HTML

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| HTML brut en texte enrichi | Contrôler si les blocs HTML bruts sont rendus en mode WYSIWYG | Masqué | Masqué, Désinfecté, Désinfecté + styles |

::: tip
**Masqué** est l'option la plus sûre — les blocs HTML bruts sont réduits et non rendus. **Désinfecté** rend le HTML en supprimant les balises dangereuses. **Désinfecté + styles** préserve également les attributs `style` en ligne.
:::

## Fichiers & Images

Explorateur de fichiers, enregistrement, historique du document, gestion des images et outils de document.

### Explorateur de fichiers

Ces paramètres s'appliquent uniquement lorsqu'un espace de travail (dossier) est ouvert.

| Paramètre | Description | Par défaut |
|-----------|-------------|------------|
| Afficher les fichiers cachés | Inclure les fichiers points et les éléments système cachés dans l'explorateur de fichiers | Désactivé |
| Afficher tous les fichiers | Afficher les fichiers non-markdown dans l'explorateur de fichiers. Les fichiers non-markdown s'ouvrent avec l'application par défaut de votre système | Désactivé |

### Comportement à la fermeture

| Paramètre | Description | Par défaut |
|-----------|-------------|------------|
| Confirmer la fermeture | Exiger d'appuyer deux fois sur `Cmd+Q` (ou `Ctrl+Q`) pour quitter, évitant les sorties accidentelles | Activé |

### Enregistrement

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Activer la sauvegarde automatique | Enregistrer automatiquement les fichiers après modification | Activé | Activé / Désactivé |
| Intervalle d'enregistrement | Temps entre les sauvegardes automatiques. Disponible uniquement lorsque la sauvegarde automatique est activée | 30 secondes | 10s, 30s, 1 min, 2 min, 5 min |
| Conserver l'historique du document | Suivre les versions du document pour l'annulation et la récupération | Activé | Activé / Désactivé |
| Versions maximum | Nombre d'instantanés d'historique à conserver par document | 50 versions | 10, 25, 50, 100 |
| Conserver les versions pendant | Âge maximum des instantanés d'historique avant leur suppression | 7 jours | 1 jour, 7 jours, 14 jours, 30 jours |
| Fenêtre de fusion | Les sauvegardes automatiques consécutives dans cette fenêtre se consolident en un seul instantané, réduisant le bruit de stockage | 30 secondes | Désactivé, 10s, 30s, 1 min, 2 min |
| Taille max de fichier pour l'historique | Ne pas prendre d'instantanés d'historique pour les fichiers dépassant ce seuil | 512 Ko | 256 Ko, 512 Ko, 1 Mo, 5 Mo, Illimité |

### Images

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Redimensionner automatiquement au collage | Redimensionner automatiquement les grandes images avant de les enregistrer dans le dossier assets. La valeur est la dimension maximale en pixels | Désactivé | Désactivé, 800px, 1200px, 1920px (Full HD), 2560px (2K) |
| Copier dans le dossier assets | Copier les images collées ou déposées dans le dossier assets du document au lieu de les incorporer | Activé | Activé / Désactivé |
| Nettoyer les images inutilisées à la fermeture | Supprimer automatiquement les images du dossier assets qui ne sont plus référencées dans le document à sa fermeture | Désactivé | Activé / Désactivé |
| Seuil d'image en ligne | Taille maximale (Mo) pour intégrer les images comme URL de données base64 dans l'export HTML/PDF. Les fichiers plus volumineux sont liés à la place | 1,0 Mo | 0,1 – 10 Mo |

### Fichiers volumineux

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Avertir au-dessus de la taille | Afficher une invite de confirmation lors de l'ouverture de fichiers au-dessus de cette taille | 5 Mo | Activé / Désactivé |
| Mode Source automatique | Ouvrir automatiquement les fichiers au-dessus du seuil en mode Source (saute le WYSIWYG pour préserver la fluidité des performances) | Activé | Activé / Désactivé |

Voir [Fichiers volumineux](/fr/guide/large-files) pour la ventilation complète de la façon dont les fichiers volumineux sont gérés.

### Mises à jour

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Fréquence de vérification | Quand vérifier les nouvelles versions de VMark | Au démarrage | Au démarrage, Quotidien, Hebdomadaire, Manuel |
| Téléchargement automatique des mises à jour | Télécharger les artefacts de version en arrière-plan une fois qu'une mise à jour est détectée | Désactivé | Activé / Désactivé |
| Ignorer une version | Supprime l'invite de mise à jour pour une version spécifique (défini par mise à jour depuis l'invite elle-même) | Aucune | — |

::: tip
Activez **Redimensionner automatiquement au collage** si vous collez fréquemment des captures d'écran ou des photos — cela garde votre dossier assets léger sans redimensionnement manuel.
:::

### Outils de document

VMark détecte [Pandoc](https://pandoc.org) pour permettre l'exportation vers des formats supplémentaires (DOCX, EPUB, LaTeX, et plus). Cliquez sur **Détecter** pour rechercher Pandoc sur votre système. S'il est trouvé, sa version et son chemin sont affichés.

Voir [Exportation & Impression](/fr/guide/export) pour les détails sur toutes les options d'exportation.

## Intégrations

Configuration du serveur MCP et du fournisseur IA.

### Serveur MCP

Le serveur MCP (Model Context Protocol) permet aux assistants IA externes comme Claude Code et Cursor de contrôler VMark par programmation.

| Paramètre | Description | Par défaut |
|-----------|-------------|------------|
| Activer le serveur MCP | Démarrer ou arrêter le serveur MCP. Lorsqu'il est en cours d'exécution, un badge de statut affiche le port et les clients connectés | Activé (basculer) |
| Démarrer au lancement | Démarrer automatiquement le serveur MCP à l'ouverture de VMark | Activé |
| Approuver automatiquement les modifications | Appliquer les changements de document initiés par IA sans afficher d'aperçu pour approbation. Utilisez avec prudence | Désactivé |

Lorsque le serveur est en cours d'exécution, le panneau affiche également&nbsp;:
- **Port** — assigné automatiquement&nbsp;; les clients IA le découvrent via le fichier de configuration
- **Version** — version du sidecar du serveur MCP
- **Outils / Ressources** — nombre d'outils et de ressources MCP disponibles
- **Clients connectés** — nombre de clients IA actuellement connectés

En dessous de la section Serveur MCP, vous pouvez installer la configuration MCP de VMark dans les clients IA pris en charge (Claude Desktop, Claude Code, Codex CLI, Gemini CLI) en un seul clic.

Voir [Configuration MCP](/fr/guide/mcp-setup) et [Référence des outils MCP](/fr/guide/mcp-tools) pour tous les détails.

### Fournisseurs IA

Configurez quel fournisseur IA alimente les [Génies IA](/fr/guide/ai-genies). Un seul fournisseur peut être actif à la fois.

**Fournisseurs CLI** — Utilisez des outils CLI IA installés localement (Claude, Codex, Gemini). Cliquez sur **Détecter** pour rechercher les CLIs disponibles dans votre `$PATH`. Les fournisseurs CLI utilisent votre abonnement et ne nécessitent pas de clé API.

**Fournisseurs API REST** — Connectez-vous directement aux API cloud (Anthropic, OpenAI, Google AI, Ollama API). Chacun nécessite un endpoint, une clé API et un nom de modèle.

Voir [Fournisseurs IA](/fr/guide/ai-providers) pour les instructions de configuration détaillées pour chaque fournisseur.

## Formats

Basculements optionnels pour les adaptateurs de format non-défaut, ainsi que la commande d'éditeur externe explicite pour les onglets de code en lecture seule.

Markdown, texte brut et YAML/YML sont **toujours** enregistrés — les valeurs par défaut tranquilles. Chaque autre adaptateur est **désactivé par défaut** afin que les utilisateurs existants ne soient pas surpris lors d'une mise à niveau. Activez un basculement et le registre se reconstruit à la volée ; les onglets ouverts se remontent avec l'adaptateur approprié, sans redémarrage.

Pour la liste complète des formats et leurs aperçus, voir [Formats pris en charge](/fr/guide/formats).

### Prise en charge des formats

| Basculement | Par défaut | Active |
|---|---|---|
| **Formats de données** | Désactivé | `.json`, `.jsonl`, `.toml` — volet source + arbre navigable. Aperçus adaptés au schéma pour `Cargo.toml`, `package.json`, `pyproject.toml`. |
| **Diagrammes & SVG** | Désactivé | `.mmd` (Mermaid) et `.svg` — volet source + rendu en direct désinfecté. |
| **Aperçu HTML** | Désactivé | `.html` et `.htm` — aperçu en iframe isolée (`sandbox=""` liste d'autorisation vide, DOMPurify, CSP `<meta>`). OWASP top-20 vérifié — voir [Modèle de sécurité pour HTML](/fr/guide/formats#modèle-de-sécurité-pour-html). |
| **Visionneuses de code** | Désactivé | 12 visionneuses en lecture seule (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua`). S'ouvre dans une visionneuse à coloration syntaxique avec les boutons **Activer l'édition** et **Ouvrir dans l'éditeur externe**. |

Lorsqu'une catégorie est désactivée, les extensions correspondantes basculent vers le mode texte brut — le fichier s'ouvre quand même, simplement sans la vue schéma.

### Éditeur externe

Pour le bouton **Ouvrir dans l'éditeur externe** sur les onglets de code en lecture seule, choisissez l'éditeur qui doit se lancer. Un bundle d'application (ex. `/Applications/Visual Studio Code.app`) ou un exécutable.

Le paramètre GUI a priorité sur les variables d'environnement — l'explicite prime sur l'implicite. Laissez-le vide pour utiliser la chaîne de substitution `$VMARK_EXTERNAL_EDITOR → $VISUAL → $EDITOR → valeur par défaut de la plateforme`. Voir [Ouvrir dans l'éditeur externe](/fr/guide/formats#ouvrir-dans-léditeur-externe) pour l'ordre de résolution complet et le portail de sécurité.

### Notification ponctuelle de mise à niveau

Au premier lancement après une mise à niveau vers la prise en charge multi-format, VMark affiche une notification non bloquante pointant vers **Paramètres → Formats**. La notification se déclenche une seule fois par installation — une fois affichée (ou ignorée), elle ne réapparaît plus jamais.

## Langue

Règles de mise en forme CJK (chinois, japonais, coréen). Ces règles sont appliquées lorsque vous exécutez **Format → Formater la sélection CJK** (`Cmd+Shift+F`) sur une sélection, ou **Format → Formater le document CJK** (`Alt+Cmd+Shift+F`) sur l'intégralité du fichier.

::: tip
La section Langue contient plus de 20 contrôles de mise en forme précis. Pour une explication complète de chaque règle avec des exemples, voir [Mise en forme CJK](/fr/guide/cjk-formatting).
:::

### Normalisation pleine largeur

| Paramètre | Description | Par défaut |
|-----------|-------------|------------|
| Convertir les lettres/chiffres pleine largeur | Convertir les caractères alphanumériques pleine largeur en demi-largeur (ex. `ＡＢＣ` en `ABC`) | Activé |
| Normaliser la largeur de la ponctuation | Convertir les virgules et points pleine largeur en demi-largeur entre les caractères CJK | Activé |
| Convertir les parenthèses | Convertir les parenthèses pleine largeur en demi-largeur lorsque le contenu est CJK | Activé |
| Convertir les crochets | Convertir les crochets demi-largeur en pleine largeur `【】` lorsque le contenu est CJK | Désactivé |

### Espacement

| Paramètre | Description | Par défaut |
|-----------|-------------|------------|
| Ajouter l'espacement CJK-anglais | Insérer un espace entre les caractères CJK et latins | Activé |
| Ajouter l'espacement CJK-parenthèse | Insérer un espace entre les caractères CJK et les parenthèses | Activé |
| Supprimer l'espacement des devises | Supprimer l'espace supplémentaire après les symboles de devise (ex. `$ 100` devient `$100`) | Activé |
| Supprimer l'espacement des barres obliques | Supprimer les espaces autour des barres obliques (ex. `A / B` devient `A/B`), en préservant les URLs | Activé |
| Réduire les espaces multiples | Réduire plusieurs espaces consécutifs à un seul espace | Activé |

### Tirets & Guillemets

| Paramètre | Description | Par défaut |
|-----------|-------------|------------|
| Convertir les tirets | Convertir les doubles tirets (`--`) en tirets cadratins (`——`) entre les caractères CJK | Activé |
| Corriger l'espacement des tirets cadratins | Assurer un espacement approprié autour des tirets cadratins | Activé |
| Convertir les guillemets droits | Convertir les guillemets droits `"` et `'` en guillemets intelligents (courbes) | Activé |
| Style de guillemets | Style cible pour la conversion des guillemets intelligents | Courbes `""` `''` |
| Corriger l'espacement des guillemets doubles | Normaliser l'espacement autour des guillemets doubles | Activé |
| Corriger l'espacement des guillemets simples | Normaliser l'espacement autour des guillemets simples | Activé |
| Crochets d'angle CJK | Convertir les guillemets courbes en crochets d'angle `「」` pour le chinois traditionnel et le texte japonais. Disponible uniquement lorsque le style de guillemets est Courbes | Désactivé |
| Crochets d'angle imbriqués | Convertir les guillemets simples imbriqués en `『』` à l'intérieur de `「」` | Désactivé |

### Nettoyage

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Limiter la ponctuation consécutive | Limiter les signes de ponctuation répétés comme `!!!` | Désactivé | Désactivé, Simple (`!!` → `!`), Double (`!!!` → `!!`) |
| Supprimer les espaces de fin de ligne | Supprimer les espaces à la fin des lignes | Activé | Activé / Désactivé |
| Normaliser les points de suspension | Convertir les points espacés (`. . .`) en points de suspension appropriés (`...`) | Activé | Activé / Désactivé |
| Réduire les sauts de ligne | Réduire trois sauts de ligne consécutifs ou plus à deux | Activé | Activé / Désactivé |

## Raccourcis

Afficher et personnaliser tous les raccourcis clavier. Les raccourcis sont regroupés par catégorie (Fichier, Éditer, Affichage, Format, etc.).

- **Rechercher** — Filtrer les raccourcis par nom, catégorie ou combinaison de touches
- **Cliquer sur un raccourci** pour modifier sa liaison de touche. Appuyez sur la nouvelle combinaison, puis confirmez
- **Réinitialiser** — Restaurer un raccourci individuel à sa valeur par défaut, ou réinitialiser tous à la fois
- **Exporter / Importer** — Enregistrer vos liaisons personnalisées dans un fichier JSON et les importer sur une autre machine

Voir [Raccourcis clavier](/fr/guide/shortcuts) pour la référence complète des raccourcis par défaut.

## Terminal

Configurer le panneau de terminal intégré. Ouvrez le terminal avec `` Ctrl + ` ``.

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Shell | Quel shell utiliser. Nécessite un redémarrage du terminal pour prendre effet | Système par défaut | Shells détectés automatiquement sur votre système (ex. zsh, bash, fish) |
| Position du panneau | Où placer le panneau de terminal | Auto | Auto (basé sur le rapport d'aspect de la fenêtre), Bas, Droite |
| Taille du panneau | Proportion d'espace disponible occupée par le terminal. Le redimensionnement par glissement du panneau met également à jour cette valeur | 40% | 10% à 80% |
| Taille de police | Taille du texte dans le terminal | 13px | 10px à 24px |
| Interligne | Espacement vertical entre les lignes du terminal | 1.2 (Compact) | 1.0 (Serré) à 2.0 (Extra) |
| Style du curseur | Forme du curseur du terminal | Barre | Barre, Bloc, Souligné |
| Clignotement du curseur | Si le curseur du terminal clignote | Activé | Activé / Désactivé |
| Copier à la sélection | Copier automatiquement le texte du terminal sélectionné dans le presse-papiers | Désactivé | Activé / Désactivé |
| Rendu WebGL | Utiliser le rendu accéléré GPU pour le terminal. Désactiver en cas de problèmes de saisie IME. Nécessite un redémarrage du terminal | Activé | Activé / Désactivé |

Voir [Terminal intégré](/fr/guide/terminal) pour plus d'informations sur les sessions, les raccourcis clavier et l'environnement shell.

## À propos

Affiche la version de l'application, les liens vers le site web et le dépôt GitHub, et la gestion des mises à jour.

### Mises à jour

| Paramètre | Description | Par défaut |
|-----------|-------------|------------|
| Mises à jour automatiques | Vérifier les mises à jour automatiquement au démarrage | Activé |
| Vérifier maintenant | Déclencher manuellement une vérification des mises à jour | — |

Lorsqu'une mise à jour est disponible, une carte apparaît affichant le nouveau numéro de version, la date de publication et les notes de version. Vous pouvez **Télécharger** la mise à jour, **Ignorer** cette version ou — une fois téléchargée — **Redémarrer pour mettre à jour**.

## Avancé

::: tip
La section Avancé est masquée par défaut. Appuyez sur `Ctrl + Option + Cmd + D` dans la fenêtre Paramètres pour la révéler.
:::

Configuration au niveau développeur et système.

### Protocoles de liens

| Paramètre | Description | Par défaut |
|-----------|-------------|------------|
| Protocoles de liens personnalisés | Protocoles URL supplémentaires que VMark doit reconnaître lors de l'insertion de liens. Entrez chaque protocole comme une balise | `obsidian`, `vscode`, `dict`, `x-dictionary` |

Cela vous permet de créer des liens comme `obsidian://open?vault=...` ou `vscode://file/...` que VMark traitera comme des URLs valides.

### Performance

| Paramètre | Description | Par défaut |
|-----------|-------------|------------|
| Garder les deux éditeurs actifs | Monter simultanément les éditeurs WYSIWYG et mode Source pour un changement de mode plus rapide. Augmente la consommation mémoire | Désactivé |

### Moteur de workflow

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Moteur de workflow | Activer le visualiseur/éditeur de workflow GitHub Actions pour les fichiers `.yml`/`.yaml` sous `.github/workflows/`. Lorsqu'il est désactivé, ces fichiers s'ouvrent comme du YAML brut | Désactivé | Activé / Désactivé |
| Préserver le formatage YAML | Lors de l'enregistrement des modifications de workflow effectuées via le panneau de formulaire, préserver les commentaires, ancres, ordre des clés et lignes vides du YAML d'origine via le pipeline d'aller-retour CST. Lorsqu'il est désactivé, l'enregistrement utilise un sérialiseur compact (plus rapide mais avec perte) | Activé | Activé / Désactivé |

Voir [Visualiseur de workflows](/fr/guide/workflow-viewer) pour la surface complète des fonctionnalités.

### Spécifique à la plateforme

| Paramètre | Description | Par défaut | Plateformes |
|-----------|-------------|------------|-------------|
| Effacer la quarantaine macOS à l'ouverture | Lors de l'ouverture d'un fichier portant l'attribut de quarantaine macOS (`com.apple.quarantine`), le supprimer avant la lecture. Utile pour les fichiers téléchargés du web que VMark serait sinon empêché d'ouvrir | Activé | macOS |
| Option Mac comme Meta (terminal) | Traiter la touche Option de macOS comme Meta dans le terminal intégré. Requis pour des outils comme emacs et tmux qui s'attendent à des raccourcis préfixés par Alt | Désactivé | macOS |

### Outils développeur

Lorsque les **Outils développeur** sont activés, un panneau **Hot Exit Dev Tools** apparaît avec des boutons pour tester la capture de session, l'inspection, la restauration, la suppression et le redémarrage — utile pour déboguer le comportement hot exit pendant le développement.

## Voir aussi

- [Fonctionnalités](/fr/guide/features) — Aperçu des capacités de VMark
- [Raccourcis clavier](/fr/guide/shortcuts) — Référence complète des raccourcis
- [Mise en forme CJK](/fr/guide/cjk-formatting) — Règles de mise en forme CJK détaillées
- [Terminal intégré](/fr/guide/terminal) — Sessions de terminal et utilisation
- [Fournisseurs IA](/fr/guide/ai-providers) — Guide de configuration des fournisseurs IA
- [Configuration MCP](/fr/guide/mcp-setup) — Configuration du serveur MCP pour les assistants IA
