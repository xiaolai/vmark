# Paramètres

Le panneau de paramètres de VMark vous permet de personnaliser chaque aspect de l'éditeur. Ouvrez-le avec `Mod + ,` ou via **VMark > Paramètres** dans la barre de menus.

La fenêtre de paramètres comporte une barre latérale qui liste les sections par ordre alphabétique (selon leur nom anglais), avec À propos en bas et Avancé en dessous lorsqu'il est affiché. Les modifications prennent effet immédiatement — il n'y a pas de bouton d'enregistrement.

Utilisez le **champ de recherche** en haut de la barre latérale pour filtrer les paramètres de tous les panneaux par nom ou par description — les lignes correspondantes sont regroupées, vous n'avez donc pas besoin de savoir dans quelle catégorie se trouve un paramètre. Pour tout restaurer aux valeurs d'usine, utilisez **Rétablir les valeurs par défaut** dans la section À propos.

## Apparence

Contrôle le thème visuel et le comportement des fenêtres.

### Thème

Choisissez parmi six thèmes de couleurs. Le thème actif est indiqué par un anneau autour de son échantillon.

| Thème | Arrière-plan | Style |
|-------|-------------|-------|
| Blanc | `#FFFFFF` | Blanc net, contraste le plus élevé |
| Papier | `#EEEDED` | Papier journal chaud, par défaut |
| Menthe | `#CCE6D0` | Vert doux, agréable pour les yeux |
| Sépia | `#F9F0DB` | Papier de livre, pour les longues lectures |
| Nuit | `#23262B` | Ardoise sombre pour une faible luminosité |
| Solarized | `#002B36` | Solarized Dark, la palette classique |

::: info Windows 10 et Linux ne proposent que Blanc et Nuit
Sous Windows 10 et Linux, c'est le système qui dessine la barre de titre, et elle ne peut être que claire ou sombre. Ces plateformes ne proposent donc que **Blanc** et **Nuit**, et un thème qui ne peut pas s'accorder avec le cadre du système est affiché comme le plus proche des deux : Papier, Menthe et Sépia s'affichent en Blanc, Solarized en Nuit. Votre choix enregistré n'est pas modifié — sous macOS et Windows 11, le catalogue complet est disponible. Sous Windows 11, la barre de titre prend les couleurs du thème lui-même ; la barre de menus reste dessinée en clair ou en sombre.
:::

#### Suivre l'apparence du système

| Paramètre | Description | Par défaut |
|-----------|-------------|------------|
| Suivre l'apparence du système | Basculer automatiquement entre vos thèmes clair et sombre en même temps que le système | Désactivé |

Lorsqu'il est activé, la ligne de thème unique est remplacée par deux lignes — **Thème clair** (utilisé lorsque le système est en mode clair, Papier par défaut) et **Thème sombre** (utilisé en mode sombre, Nuit par défaut). VMark bascule de l'un à l'autre dès que l'apparence du système change ; votre choix de thème manuel est conservé et restauré lorsque vous désactivez l'option.

### Barre latérale

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Style de la barre latérale | Le cadre de la barre latérale et du rail des espaces de travail. **Pleine hauteur** les place le long du bord de la fenêtre avec un fin séparateur, comme les barres latérales de macOS ; **Carte** les fait flotter dans la fenêtre avec des coins arrondis et une ombre. S'applique aussi à la fenêtre des réglages | Pleine hauteur | Pleine hauteur, Carte |

### Fenêtre

| Paramètre | Description | Par défaut |
|-----------|-------------|------------|
| Afficher le nom de fichier dans la barre de titre | Afficher le nom du fichier courant dans la barre de titre de la fenêtre macOS. **macOS uniquement** — ce paramètre est masqué ailleurs, car Windows et Linux affichent toujours le nom du fichier dans la barre de titre du système | Désactivé |

Sur macOS, VMark dessine sa propre barre de titre par-dessus celle du système ; le
nom du fichier y est donc un élément facultatif. Sous Windows et Linux, le système
dessine une véritable barre de titre au-dessus de la fenêtre : le nom du fichier
(avec un `•` tant qu'il reste des modifications non enregistrées) y apparaît
toujours, et VMark n'ajoute aucune bande de titre propre.

### Mode focus

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Niveau d'atténuation | Intensité de l'atténuation du contenu non focalisé en mode focus. **Standard** conserve l'atténuation par défaut, uniquement par la couleur ; **Forte** et **Plus forte** y ajoutent une opacité de plus en plus réduite | Standard | Standard, Forte, Plus forte |

## Éditeur

Typographie, affichage, comportement d'édition, espacement et fichiers volumineux.

### Typographie

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Police latine | Famille de polices pour le texte latin (anglais) | Système par défaut | Système par défaut, Athelas, Palatino, Georgia, Charter, Literata — ainsi que toute police installée |
| Police CJK | Famille de polices pour le texte chinois, japonais, coréen | Système par défaut | Système par défaut, PingFang SC, Songti SC, Kaiti SC, Noto Serif CJK, Source Han Sans — ainsi que toute police installée |
| Police mono | Famille de polices pour le code et le texte à espacement fixe — également utilisée par le terminal intégré | Système par défaut | Système par défaut, SF Mono, Monaco, Menlo, Consolas, DejaVu Sans Mono, Liberation Mono, Ubuntu Mono, Noto Sans Mono, Noto Sans Mono CJK SC, JetBrains Mono, Fira Code, SauceCodePro NFM, IBM Plex Mono, Hack, Inconsolata — ainsi que toute police installée |
| Taille de police | Taille de police de base pour le contenu de l'éditeur | 18px | 14px, 16px, 18px, 20px, 22px |
| Interligne | Espacement vertical entre les lignes | 1.8 (Détendu) | 1.4 (Compact), 1.6 (Normal), 1.8 (Détendu), 2.0 (Spacieux), 2.2 (Extra) |
| Espacement des blocs | Écart visuel entre les éléments de bloc (titres, paragraphes, listes) mesuré en multiples de l'interligne | 1x (Normal) | 0.5x (Serré), 1x (Normal), 1.5x (Détendu), 2x (Spacieux) |
| Espacement des lettres CJK | Espacement supplémentaire entre les caractères CJK, en unités em | Désactivé | Désactivé, 0.02em (Subtil), 0.03em (Léger), 0.05em (Normal), 0.08em (Large), 0.10em (Plus large), 0.12em (Extra) |

#### Utiliser une police que vous avez installée

Les noms listés ci-dessus sont une présélection, pas une limite. Chacun des trois
sélecteurs de police comporte aussi une section **Polices installées** qui liste
toutes les familles de polices de la machine ; une police que vous avez
installée — LXGW WenKai, Iosevka, Source Han Serif — se choisit donc de la même
façon que les polices intégrées.

Choisissez **Personnalisée…** en fin de liste pour saisir plutôt un nom de
famille. Utilisez le nom exactement tel que le système le rapporte (macOS : Livre
des polices ; Windows : Paramètres → Personnalisation → Polices) — pour LXGW
WenKai / 霞鹜文楷, c'est `LXGW WenKai`. La police s'applique dès que le nom est
complet ; si rien ne change, le nom ne correspond à aucune famille installée. Un
nom contenant des guillemets, des virgules, des points-virgules ou des
parenthèses est refusé, et la ligne l'indique.

::: tip Polices installées est réservé à macOS
macOS liste pour vous toutes les familles installées. Sous Windows et Linux, la
section est vide et **Personnalisée…** est le moyen d'y accéder — saisir le nom
de la famille fonctionne de la même façon sur les trois plateformes.
:::

Ce choix s'applique aussi à l'exportation PDF, dont le rendu passe par le même
moteur avec les mêmes polices. L'exportation HTML ne peut pas embarquer une
police de votre machine ; une page exportée se rabat donc sur les polices du
lecteur, à moins qu'il n'ait la même famille installée.

### Affichage

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Largeur de l'éditeur | Largeur maximale du contenu. Des valeurs plus larges conviennent aux grands moniteurs ; des valeurs plus étroites améliorent la lisibilité | 50em (Moyen) | 36em (Compact), 42em (Étroit), 50em (Moyen), 60em (Large), 80em (Extra large), Illimité |

::: tip La même largeur ne se lit pas de la même façon en latin et en CJK
La largeur de l'éditeur est mesurée en `em` ; la longueur de ligne en *caractères* dépend donc de l'écriture : à 50em, une ligne latine contient environ 90 à 100 caractères (environ 2× la justification typographique de 45 à 75 caractères, ce qui convient à un éditeur à deux volets), tandis qu'une ligne CJK contient environ 50 caractères pleine largeur — pile dans la fourchette traditionnelle de 40 à 60 pour le texte chinois. Si vous écrivez surtout de la prose latine et voulez une justification de livre, choisissez 36 à 42em ; pour les documents surtout CJK, la valeur par défaut est déjà la justification classique.
:::

::: tip
50em à 18px de taille de police correspond à environ 900px — une largeur de lecture confortable pour la plupart des écrans.
:::

### Comportement

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Taille de tabulation | Nombre d'espaces insérés lors de l'appui sur Tab | 2 espaces | 2 espaces, 4 espaces |
| Ouvrir les fichiers dans un nouvel onglet | Ouvrir les fichiers existants dans un nouvel onglet au lieu de réutiliser l'onglet vide courant | Désactivé | Activé / Désactivé |
| Activer l'appariement automatique | Insérer automatiquement les crochets fermants et guillemets correspondants lorsque vous tapez un ouvrant | Activé | Activé / Désactivé |
| Crochets CJK | Apparier automatiquement les crochets spécifiques au CJK comme `「」` `【】` `《》`. Disponible uniquement lorsque l'appariement automatique est activé | Auto | Désactivé, Auto |
| Inclure les guillemets courbes | Apparier automatiquement `“”` et `‘’`, et transformer un `"` ou un `'` droit tapé en paire courbe. Peut entrer en conflit avec certaines fonctionnalités de guillemets intelligents d'IME. Apparaît lorsque les crochets CJK sont en Auto | Activé | Activé / Désactivé |
| Aussi apparier `"` | Taper le guillemet double droit fermant `"` insère également une paire `""`. Utile lorsque votre IME alterne entre guillemets ouvrants et fermants. Apparaît lorsque les guillemets courbes sont activés | Désactivé | Activé / Désactivé |
| Format de copie | Format à utiliser pour l'emplacement presse-papiers texte brut lors de la copie en mode WYSIWYG | Texte brut | Texte brut, Markdown |
| Copier à la sélection | Copier automatiquement le texte dans le presse-papiers à chaque fois que vous le sélectionnez | Désactivé | Activé / Désactivé |

### Espacement

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Fins de ligne à l'enregistrement | Contrôler comment les fins de ligne sont gérées lors de l'enregistrement des fichiers | Conserver l'existant | Conserver l'existant, LF (`\n`), CRLF (`\r\n`) |
| Les retours à la ligne deviennent des sauts forcés | Traiter les retours à la ligne simples à l'intérieur d'un paragraphe comme des sauts de ligne forcés (n'affecte pas les lignes vides entre les blocs) | Désactivé | Activé / Désactivé |
| Conserver les sauts de ligne consécutifs | Garder plusieurs lignes vides telles quelles au lieu de les réduire | Activé | Activé / Désactivé |
| Style de saut de ligne dur à l'enregistrement | Comment les sauts de ligne durs sont représentés dans le fichier Markdown enregistré | Conserver l'existant | Deux espaces (Recommandé), Conserver l'existant, Barre oblique inverse (`\`) |
| Afficher les balises `<br>` | Afficher les balises de saut de ligne HTML visiblement dans l'éditeur | Désactivé | Activé / Désactivé |
| Afficher les invisibles | Visualiser les espaces blancs : espaces en `·`, tabulations en `→` (Source uniquement), sauts de ligne souples en `↓` (Source uniquement), sauts de ligne forcés en `⏎`. Masqué à l'impression. Bascule : `F3` ou Affichage → Afficher les invisibles. | Désactivé | Activé / Désactivé |

::: tip
Deux espaces est le style de saut de ligne dur le plus compatible — il fonctionne sur GitHub, GitLab et tous les principaux rendus Markdown. Le style barre oblique inverse peut échouer sur Reddit, Jekyll et certains analyseurs plus anciens.
:::

### Fichiers volumineux

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Mode Source automatique | Ouvrir les fichiers volumineux en mode Source — fichiers de plus de 1 Mo ou markdown avec 1 200+ blocs estimés (saute le WYSIWYG pour préserver la fluidité des performances). Vous pouvez passer en WYSIWYG depuis la barre d'état à tout moment | Activé | Activé / Désactivé |
| Avertir au-dessus de la taille | Afficher une invite de confirmation avant d'ouvrir des fichiers de plus de 5 Mo. Les fichiers de 50 Mo ou plus sont toujours refusés | Activé | Activé / Désactivé |

Voir [Fichiers volumineux](/fr/guide/large-files) pour la ventilation complète de la façon dont les fichiers volumineux sont gérés.

## Markdown

Comportement de collage, mise en page et paramètres de rendu HTML.

### Coller & Saisir

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Activer les expressions régulières dans la recherche | Afficher un bouton de basculement regex dans la barre Rechercher & Remplacer | Activé | Activé / Désactivé |
| Mode collage | Façon dont le contenu du presse-papiers est traité lors du collage. **Intelligent** convertit le HTML en Markdown et détecte la syntaxe Markdown ; **Texte brut** colle toujours du texte brut ; **Enrichi** conserve la mise en forme HTML d'origine | Intelligent | Intelligent, Texte brut, Enrichi |
| Coller intelligemment le Markdown | Lors du collage de texte ressemblant à du Markdown dans l'éditeur WYSIWYG, le convertir automatiquement en contenu enrichi | Auto | Auto, Désactivé |

### Mise en page

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Diviser source/aperçu par défaut | Ouvrir les fichiers Markdown en vue divisée, avec la source et un aperçu en direct côte à côte (sinon en WYSIWYG). Basculez pour la session avec `Shift + F6` ou **Affichage → Vue divisée Markdown** | Désactivé | Activé / Désactivé |
| Taille de police des éléments de bloc | Taille de police relative pour les listes, citations, tableaux, alertes et blocs de détails | 100% | 100%, 95%, 90%, 85% |
| Alignement des titres | Alignement du texte pour les titres. Éditeur uniquement — non appliqué à l'export ni à l'impression | Gauche | Gauche, Centre |
| Bordures d'images et diagrammes | Afficher ou non une bordure autour des images, diagrammes Mermaid et blocs mathématiques. Éditeur uniquement — non appliqué à l'export ni à l'impression | Aucune | Aucune, Toujours, Au survol |
| Alignement des images et tableaux | Alignement horizontal pour les images et tableaux en bloc. Éditeur uniquement — non appliqué à l'export ni à l'impression | Centre | Centre, Gauche |
| Ajuster les tableaux à la largeur | Contraindre tous les tableaux à la largeur de l'éditeur au lieu d'autoriser le défilement horizontal | Désactivé | Activé / Désactivé |
| Numéros de ligne des blocs de code | Afficher les numéros de ligne dans les blocs de code de l'éditeur WYSIWYG. Indépendant de **Numéros de ligne** du menu Affichage, qui contrôle la marge de l'éditeur Source/vue divisée | Désactivé | Activé / Désactivé |

### Lint

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Activer le lint markdown | Vérifier les problèmes markdown courants (liens cassés, texte alt manquant, niveaux de titre, blocs de code non fermés, etc.) | Activé | Activé / Désactivé |

Voir [Lint Markdown](/fr/guide/lint) pour la liste complète des règles et les niveaux de gravité.

### Rendu HTML

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| HTML brut en texte enrichi | Contrôler si les blocs HTML bruts sont rendus en mode WYSIWYG | Assaini | Masqué, Assaini, Assaini + styles |
| Balises HTML autorisées | Étendue de l'ensemble des balises rendues | Stricte | Stricte, Étendu |
| Autoriser aussi ces balises | Noms de balises supplémentaires à autoriser, séparés par des virgules | _(vide)_ | ex. `kbd, samp, var` |

::: tip
**Masqué** réduit le HTML brut et n'affiche rien. **Assaini** rend le HTML en supprimant les balises dangereuses. **Assaini + styles** préserve en plus un sous-ensemble sûr des attributs `style` en ligne.

**Stricte** autorise un petit ensemble de balises prudent. **Étendu** rend en plus `<svg>` (et ses éléments enfants sûrs), `<figure>`/`<figcaption>`, `<details>`/`<summary>` et d'autres balises sémantiques/structurelles — toutes toujours assainies. Utilisez **Autoriser aussi ces balises** pour ajouter des balises précises en plus (par ex. `kbd, samp, var`).
:::

::: warning
Quels que soient ces paramètres, les balises dangereuses (`<script>`, `<style>`, `<iframe>`, `<form>`, gestionnaires d'événements, …) sont **toujours** supprimées — le champ des balises personnalisées ne peut pas les réactiver. L'étendue de la liste d'autorisation n'affecte que l'aperçu WYSIWYG ; le HTML brut de votre fichier n'est jamais modifié.
:::

## Fichiers & Images

Explorateur de fichiers, enregistrement, historique du document, gestion des images et outils de document.

### Espace de travail

| Paramètre | Description | Par défaut |
|-----------|-------------|------------|
| Barre d'espaces de travail | Afficher la barre d'espaces de travail à gauche et regrouper plusieurs espaces de travail et fichiers isolés dans une seule fenêtre | Désactivé |

Voir [Barre des espaces de travail](/fr/guide/workspace-rail) pour ce que la barre apporte.

### Explorateur de fichiers

Les deux premiers paramètres ne s'appliquent que lorsqu'un espace de travail (dossier) est ouvert, et sont
enregistrés par espace de travail.

| Paramètre | Description | Par défaut |
|-----------|-------------|------------|
| Afficher les fichiers cachés | Inclure les fichiers points et les éléments système cachés dans l'explorateur de fichiers | Désactivé |
| Afficher tous les fichiers | Afficher les fichiers non-markdown dans l'explorateur de fichiers. Les fichiers non-markdown s'ouvrent avec l'application par défaut de votre système | Désactivé |
| Afficher les extensions de fichier | Afficher le nom de fichier complet — `notes.md`, et non `notes` — dans la barre latérale, la barre d'onglets et la barre de titre. S'applique partout, avec ou sans espace de travail | Activé |

Désactiver **Afficher les extensions de fichier** ne masque que les extensions que VMark
reconnaît. Un fichier qu'il ne peut pas ouvrir conserve son suffixe dans tous les cas ;
le nom affiché existe donc toujours sur le disque.

### Comportement à la fermeture

| Paramètre | Description | Par défaut |
|-----------|-------------|------------|
| Confirmer la fermeture | Exiger d'appuyer deux fois sur `Cmd+Q` (ou `Ctrl+Q`) pour quitter, évitant les sorties accidentelles | Activé |
| Réduire dans la zone de notification à la fermeture | **Windows uniquement.** Fermer la dernière fenêtre laisse VMark s'exécuter dans la zone de notification au lieu de quitter | Désactivé |

**Réduire dans la zone de notification à la fermeture** ne modifie que la *dernière* fenêtre. Lorsque plusieurs fenêtres sont ouvertes, fermer l'une d'elles la ferme toujours ; c'est la fermeture finale — celle qui quittait VMark — qui le range désormais dans la zone de notification. Rien n'est fermé, et le travail non enregistré reste donc exactement là où vous l'avez laissé.

- **Clic gauche** sur l'icône de la zone de notification pour faire revenir VMark.
- **Clic droit** pour **Afficher VMark** et **Quitter VMark**. Quitter depuis la zone de notification fait d'abord revenir la fenêtre, pour que toute invite concernant des modifications non enregistrées apparaisse là où vous pouvez y répondre.
- `Ctrl+Q` quitte toujours comme d'habitude.
- Désactiver le paramètre pendant que VMark est dans la zone de notification fait revenir la fenêtre avant que l'icône ne disparaisse ; VMark ne peut donc jamais rester en cours d'exécution sans fenêtre ni icône.

Le paramètre n'apparaît pas sur macOS ni sur Linux.

### Enregistrement

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Activer la sauvegarde automatique | Enregistrer automatiquement les fichiers après modification | Activé | Activé / Désactivé |
| Insérer le bloc d'identité à l'enregistrement | Permet à VMark d'insérer un bloc d'identité `vmark:` dans le frontmatter d'un fichier et de créer un dossier `.vmark` dans l'espace de travail, pour que la couche de cohérence puisse suivre le document. Cela vaut pour toute écriture : enregistrements, modifications par l'IA et MCP, rétablissements de versions antérieures et nouveaux fichiers. Désactivé, rien n'est inséré et aucun dossier `.vmark` n'est créé ; un espace de travail qui en possède déjà un continue d'enregistrer les modifications des documents qu'il suit — un document qu'il a déjà enregistré, ou un document qui porte déjà sa propre identité `vmark:`, comme un fichier suivi que vous avez déplacé ou récupéré par un checkout. Voir [Cohérence](/fr/guide/coherence#comment-ca-marche-30-secondes) | Désactivé | Activé / Désactivé |
| Intervalle d'enregistrement | Temps entre les sauvegardes automatiques. Disponible uniquement lorsque la sauvegarde automatique est activée | 30 secondes | 10s, 30s, 1 min, 2 min, 5 min |
| Conserver l'historique du document | Suivre les versions du document pour l'annulation et la récupération | Activé | Activé / Désactivé |
| Versions maximum | Nombre d'instantanés d'historique à conserver par document | 50 versions | 10, 25, 50, 100 |
| Conserver les versions pendant | Âge maximum des instantanés d'historique avant leur suppression | 7 jours | 1 jour, 7 jours, 14 jours, 30 jours |
| Fenêtre de fusion | Les sauvegardes automatiques consécutives dans cette fenêtre se consolident en un seul instantané, réduisant le bruit de stockage | 30 secondes | Désactivé, 10s, 30s, 1 min, 2 min |
| Taille max de fichier pour l'historique | Ne pas prendre d'instantanés d'historique lors de l'enregistrement automatique pour les fichiers dépassant ce seuil. Les enregistrements manuels, les enregistrements MCP et la copie de sécurité prise avant de restaurer une version sont toujours conservés | 512 Ko | 256 Ko, 512 Ko, 1 Mo, 5 Mo, Illimité |

### Images

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Redimensionner automatiquement au collage | Redimensionner automatiquement les grandes images avant de les enregistrer dans le dossier assets. La valeur est la dimension maximale en pixels | Désactivé | Désactivé, 800px, 1200px, 1920px (Full HD), 2560px (2K) |
| Copier dans le dossier assets | Copier les images collées ou déposées dans le dossier assets du document au lieu de les incorporer | Activé | Activé / Désactivé |
| Nettoyer les images inutilisées à la fermeture | Supprimer automatiquement les images du dossier assets que le document ne référence plus. S'exécute à la fermeture du document, de la fenêtre ou de l'application. Les images encore référencées par un autre document du même dossier sont conservées, et les images supprimées vont dans la corbeille du système | Désactivé | Activé / Désactivé |

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
| Approuver automatiquement les enregistrements vers un nouvel emplacement et les résultats des génies | Permettre à un client MCP d'enregistrer un document vers un nouvel emplacement sans demander, et permettre à un génie d'appliquer directement son résultat au lieu d'afficher un aperçu. Désactivé, une requête MCP d'enregistrement vers un nouveau chemin est refusée et une notification vous en informe. Les écritures MCP dans un document ne sont jamais soumises à ce paramètre — chacune est consignée dans l'historique des modifications d'agents et peut être restaurée depuis l'historique des écritures MCP de la barre d'état | Désactivé |

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

**Fournisseurs API REST** — Connectez-vous directement à une API : Anthropic, OpenAI, un service **compatible OpenAI** (DeepSeek, Groq, OpenRouter, …), Google AI ou un serveur Ollama local (Ollama API). Chacun nécessite un nom de modèle et une clé API — sauf Ollama, pour qui la clé est facultative. Tous sauf Google AI prennent aussi un endpoint, prérempli lorsque le fournisseur en a un standard (l'emplacement compatible OpenAI n'en a pas : vous le saisissez vous-même).

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
| **Aperçu HTML** | Désactivé | `.html` et `.htm` — aperçu en iframe isolée (`sandbox=""` liste d'autorisation vide, DOMPurify, CSP `<meta>`). Sa validation de sécurité est toujours en attente, et l'aperçu l'indique — voir [Modèle de sécurité pour HTML](/fr/guide/formats#modele-de-securite-pour-html). |
| **Visionneuses de code** | Désactivé | 12 visionneuses en lecture seule (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua`). S'ouvre dans une visionneuse à coloration syntaxique avec les boutons **Activer l'édition** et **Ouvrir dans l'éditeur externe**. |

Lorsqu'une catégorie est désactivée, les extensions correspondantes basculent vers le mode texte brut — le fichier s'ouvre quand même, simplement sans la vue schéma.

### Mode d'affichage par défaut

Les fichiers avec aperçu (HTML, SVG, Mermaid, JSON, YAML, TOML) s'ouvrent dans l'un
des trois [modes d'affichage](/fr/guide/formats#modes-d-affichage-source-divise-apercu) :

| Option | Résultat |
|---|---|
| **Source** | Volet source modifiable, pleine largeur. |
| **Divisé** (par défaut) | Source et aperçu côte à côte. |
| **Aperçu** | Rendu en lecture seule, pleine largeur. |

C'est la valeur par défaut pour les onglets nouvellement ouverts ; chaque onglet
mémorise son propre choix, et vous pouvez changer le mode de n'importe quel onglet
avec le sélecteur à l'écran ou `F6` / `Shift + F6`.

### Éditeur externe

Pour le bouton **Ouvrir dans l'éditeur externe** sur les onglets de code en lecture seule, choisissez l'éditeur qui doit se lancer : le nom d'un éditeur connu (`code`, `zed`, `subl`, `vim`, …) ou le chemin complet d'un bundle d'application (ex. `/Applications/Visual Studio Code.app`) ou d'un exécutable. Les shells, les interpréteurs et les émulateurs de terminal sont refusés, de même qu'un chemin qui n'existe pas.

Le paramètre GUI a priorité sur les variables d'environnement — l'explicite prime sur l'implicite. Laissez-le vide pour utiliser la chaîne de substitution `$VMARK_EXTERNAL_EDITOR → $VISUAL → $EDITOR → valeur par défaut de la plateforme`. Voir [Ouvrir dans l'éditeur externe](/fr/guide/formats#ouvrir-dans-l-editeur-externe) pour l'ordre de résolution complet et le portail de sécurité.

### Notification ponctuelle de mise à niveau

Au premier lancement après une mise à niveau vers la prise en charge multi-format, VMark affiche une notification non bloquante pointant vers **Paramètres → Formats**. La notification se déclenche une seule fois par installation — une fois affichée (ou ignorée), elle ne réapparaît plus jamais.

### Remplacements par type de fichier

Au-delà des bascules par catégorie, vous pouvez modifier la façon dont s'ouvre une famille de fichiers donnée via la palette de commandes — **Définir le type de fichier : Texte brut / Markdown / Réinitialiser**. Les remplacements sont enregistrés par famille de fichiers (par extension, ou par radical de fichier point pour des fichiers comme `.env`) et persistent d'une session à l'autre. Voir [Comment VMark détermine le type d'un fichier](/fr/guide/formats#comment-vmark-determine-le-type-d-un-fichier).

Le panneau **Formats** liste chaque remplacement que vous avez défini, sous la forme `clé → format`. Supprimez une entrée avec son bouton `×`, ou utilisez **Tout effacer** pour les retirer toutes d'un coup — les entrées supprimées reviennent à la règle intégrée.

## Langue

La langue de l'interface et les règles de mise en forme CJK (chinois, japonais, coréen).

### Langue de l'interface

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Langue de l'interface | Change la langue de l'interface pour les menus, libellés et messages. Prend effet immédiatement | Langue du système | English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Italiano, Português (Brasil) |

Au premier lancement, VMark choisit la première langue de la liste des langues préférées de votre système qu'il fournit, et se rabat sur l'anglais si aucune ne correspond. Dès que vous choisissez une langue ici, votre choix est conservé.

### Mise en forme CJK

Les règles ci-dessous sont appliquées lorsque vous exécutez **Format → CJK → Mettre en forme la sélection** (`Cmd+Shift+F`) sur une sélection, ou **Format → CJK → Mettre en forme le fichier entier** (`Alt+Cmd+Shift+F`) sur l'intégralité du fichier.

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
| Guillemets contextuels | Utiliser des guillemets courbes autour du texte CJK mais conserver les guillemets droits dans le texte purement latin. Disponible uniquement lorsque Convertir les guillemets droits est activé | Activé |
| Comportement du basculement des guillemets | Façon dont la commande de basculement du style de guillemets alterne entre les styles — **Simple** échange droits ↔ votre style préféré ; **Cycle complet** passe par tous les styles | Simple |
| Corriger l'espacement des guillemets doubles | Normaliser l'espacement autour des guillemets doubles | Activé |
| Corriger l'espacement des guillemets simples | Normaliser l'espacement autour des guillemets simples | Activé |
| Crochets d'angle CJK | Convertir les guillemets courbes en crochets d'angle `「」` pour le chinois traditionnel et le texte japonais. Disponible uniquement lorsque le style de guillemets est Courbes | Désactivé |
| Crochets d'angle imbriqués | Convertir les guillemets simples imbriqués en `『』` à l'intérieur de `「」` | Désactivé |

### Traitement des sections

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Ignorer les sections de références | Laisser les sections `## References` et `## Further Reading` non mises en forme lors de la mise en forme CJK — utile pour les documents universitaires dont les citations doivent rester textuelles | Désactivé | Activé / Désactivé |

### Nettoyage

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Limiter la ponctuation consécutive | Limiter les signes de ponctuation répétés comme `!!!` | Désactivé | Désactivé, Simple (`!!` → `!`), Double (`!!!` → `!!`) |
| Supprimer les espaces de fin de ligne | Supprimer les espaces à la fin des lignes | Activé | Activé / Désactivé |
| Normaliser les points de suspension | Convertir les points espacés (`. . .`) en points de suspension appropriés (`...`) | Activé | Activé / Désactivé |
| Réduire les sauts de ligne | Réduire trois sauts de ligne consécutifs ou plus à deux | Désactivé | Activé / Désactivé |

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
| Shell | Quel shell utiliser. Nécessite un redémarrage du terminal pour prendre effet. Un shell enregistré qui n'est plus disponible s'affiche comme *(indisponible)* et le shell par défaut est utilisé | Système par défaut | Shells détectés automatiquement sur votre système (ex. zsh, bash, fish) |
| Position du panneau | Où placer le panneau de terminal | Auto | Auto (basé sur le rapport d'aspect de la fenêtre), Haut, Bas, Gauche, Droite |
| Taille du panneau | Proportion d'espace disponible occupée par le terminal. Le redimensionnement par glissement du panneau met également à jour cette valeur | 40% | 10% à 80% |
| Taille de police | Taille du texte dans le terminal | 13px | 10px à 24px |
| Interligne | Espacement vertical entre les lignes du terminal | 1.2 (Compact) | 1.0 (Serré) à 2.0 (Extra) |
| Style du curseur | Forme du curseur du terminal | Barre | Barre, Bloc, Souligné |
| Clignotement du curseur | Si le curseur du terminal clignote | Activé | Activé / Désactivé |
| Copier à la sélection | Copier automatiquement le texte du terminal sélectionné dans le presse-papiers | Désactivé | Activé / Désactivé |
| Afficher automatiquement les transcriptions | Afficher le Markdown, les tableaux et les diagrammes Mermaid Claude/Codex à côté de la CLI du terminal. Ajoute un hook SessionStart local à la configuration de Claude Code et de Codex ; redémarrez les sessions CLI en cours après activation | Désactivé | Activé / Désactivé |
| Rendu WebGL | Utiliser le rendu accéléré GPU pour le terminal. Désactiver en cas de problèmes de saisie IME. Nécessite un redémarrage du terminal. macOS et Windows uniquement — Linux utilise toujours le rendu DOM | Activé | Activé / Désactivé |
| Presse-papiers distant (OSC 52) | Permettre aux programmes exécutés dans le terminal — via ssh, dans tmux — de copier vers le presse-papiers du système. Le canal fonctionne en écriture seule : la lecture du presse-papiers est toujours refusée, car n'importe quelle sortie affichée dans le terminal pourrait la demander | Activé | Activé / Désactivé |
| Historique de défilement | Nombre de lignes de sortie que chaque session conserve dans son historique de défilement. Des valeurs plus élevées consomment plus de mémoire | 5 000 | 1 000 / 5 000 / 10 000 / 50 000 |
| Mode lecteur d'écran | Exposer la sortie du terminal aux technologies d'assistance (VoiceOver). Désactivé par défaut pour des raisons de performance | Désactivé | Activé / Désactivé |

Deux interrupteurs propres à certaines plateformes apparaissent aussi ici, tous deux activés par défaut : **Option comme touche Meta** (macOS uniquement — traite la touche Option comme Meta, ce qu'attendent des outils comme emacs et tmux pour les raccourcis préfixés par `Alt` et la navigation par mot ; désactivez-le si vous avez besoin des touches mortes d'Option pour les accents, comme `Option + E`) et **Intégration du shell** (masqué sous Windows — injecte des marqueurs de commande dans zsh et bash pour la navigation entre invites, les indicateurs de statut de sortie et le suivi du répertoire courant ; s'applique aux nouvelles sessions de terminal).

### Accessibilité

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Cloche du terminal | Façon de signaler une cloche du terminal (BEL). **Visuelle** marque l'activité en arrière-plan sur l'onglet de session ; **Sonore** émet un léger bip et (pour une session en arrière-plan) signale aussi l'onglet pour que vous le retrouviez ; **Désactivée** l'ignore. S'applique en direct aux sessions en cours | Visuelle | Désactivée, Visuelle, Sonore |
| Notifier quand non focalisée | Afficher une notification système (nommant le document de la fenêtre) lorsqu'un terminal déclenche la cloche alors que sa fenêtre VMark n'a pas le focus — par ex. Claude Code qui termine un tour. Permet de suivre Claude Code dans plusieurs fenêtres sans les surveiller une à une. L'autorisation de notification doit être accordée à la première utilisation | Activé | Activé / Désactivé |
| Contraste minimum | Rehausser le texte pâle du terminal jusqu'à un rapport de contraste minimum par rapport à son arrière-plan. Augmentez-le pour la lisibilité ; **Désactivé** supprime ce rehaussement. S'applique en direct aux sessions en cours | WCAG AA (4,5:1) | Désactivé, WCAG AA (4,5:1), WCAG AAA (7:1), Maximum |

Voir [Terminal intégré](/fr/guide/terminal) pour plus d'informations sur les sessions, les raccourcis clavier et l'environnement shell.

## À propos

Affiche la version de l'application, les liens vers le site web et le dépôt GitHub, et la gestion des mises à jour. Le lien **Mentions de tiers** ouvre les textes de licence des logiciels open source fournis avec VMark dans l'application par défaut du système pour les fichiers texte.

### Mises à jour

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Mises à jour automatiques | Vérifier périodiquement les nouvelles versions | Activé | Activé / Désactivé |
| Fréquence de vérification | Fréquence de vérification des mises à jour. Disponible uniquement lorsque les mises à jour automatiques sont activées | Au démarrage | Au démarrage, Quotidienne, Hebdomadaire, Manuelle uniquement |
| Télécharger les mises à jour automatiquement | Télécharger les nouvelles versions en arrière-plan lorsqu'elles sont disponibles | Désactivé | Activé / Désactivé |
| Vérifier maintenant | Déclencher manuellement une vérification des mises à jour | — | — |

Lorsqu'une mise à jour est disponible, une carte apparaît affichant le nouveau numéro de version, la date de publication et les notes de version. Vous pouvez **Télécharger** la mise à jour, **Ignorer** cette version ou — une fois téléchargée — **Redémarrer pour mettre à jour**.

#### La mise à jour correspond à la façon dont vous avez installé VMark

Le programme de mise à jour télécharge le même format de paquet que celui que vous avez installé, et non un format fixe par plateforme :

| Vous avez installé | Le programme de mise à jour récupère |
|---|---|
| macOS `.dmg` | le paquet d'application signé |
| Windows `.exe` (NSIS) | l'installateur `.exe` |
| Windows `.msi` | le paquet `.msi` |
| Linux `.deb` | le paquet `.deb` |
| Linux `.rpm` | le paquet `.rpm` |
| Linux AppImage | l'AppImage |

Sous Linux, mettre à jour une installation `.deb` ou `.rpm` passe par le gestionnaire de paquets du système ; il vous est donc demandé de vous authentifier — installer un paquet système nécessite les droits root. Les mises à jour AppImage remplacent le fichier sur place et ne demandent rien.

#### Si une mise à jour reste bloquée

La vérification et le téléchargement passent tous deux par le réseau, et une connexion qui se fige au lieu d'échouer franchement pourrait sinon laisser la mise à jour en cours indéfiniment. Si une vérification ne progresse pas pendant une minute, ou un téléchargement ou une installation pendant trois minutes, VMark affiche une notification persistante **Mise à jour bloquée** dans la fenêtre du document. Son bouton **Réessayer** remet le programme de mise à jour au repos pour que vous puissiez réessayer — **Vérifier maintenant** dans cette section, ou la prochaine vérification automatique, repart d'une nouvelle vérification.

L'activité de mise à jour est écrite dans le fichier journal ; si le problème se répète, le journal mérite d'être joint à un rapport de bug :

| Plateforme | Emplacement du journal |
|---|---|
| macOS | `~/Library/Logs/app.vmark/` |
| Windows | `%LOCALAPPDATA%\app.vmark\logs\` |
| Linux | `~/.local/share/app.vmark/logs/` |

### Réinitialisation

| Paramètre | Description |
|-----------|-------------|
| Rétablir les valeurs par défaut | Restaurer les paramètres de ces panneaux à leurs valeurs par défaut. Une invite de confirmation apparaît d'abord — cette action est irréversible |

Trois éléments sont stockés séparément et ne sont **pas** réinitialisés : les personnalisations des raccourcis clavier (utilisez **Tout réinitialiser** dans le panneau [Raccourcis](#raccourcis)), la configuration de votre fournisseur IA et les paramètres du navigateur de fichiers propres à chaque espace de travail (**Afficher les fichiers cachés**, **Afficher tous les fichiers**). La langue de l'interface revient à la langue de votre système.

## Avancé

::: tip
La section Avancé est visible par défaut — elle héberge l'interrupteur du navigateur intégré, activé d'origine. Appuyez sur `Ctrl + Option + Cmd + D` dans la fenêtre Paramètres pour la masquer, et de nouveau pour la faire réapparaître.
:::

Configuration au niveau développeur et système.

### Protocoles de liens

| Paramètre | Description | Par défaut |
|-----------|-------------|------------|
| Protocoles de liens personnalisés | Protocoles URL supplémentaires que VMark traite comme des liens. Entrez chaque protocole comme une balise | `obsidian`, `vscode`, `dict`, `x-dictionary` |

La liste a deux effets. Lorsque vous insérez un lien, une URL du presse-papiers utilisant l'un de ces protocoles est reconnue comme un lien, tout comme `https://`. Et lorsque vous ouvrez un lien, VMark ne le transmet à votre système que si son protocole est `http`, `https`, `mailto` ou figure dans cette liste — les liens `obsidian://open?vault=...` et `vscode://file/...` s'ouvrent ainsi dans leurs applications, tandis que tout autre protocole est refusé. Certains protocoles ne peuvent jamais être activés de cette façon, quoi que contienne la liste : `javascript:`, `data:`, `file:` et similaires.

Une valeur par défaut que vous retirez reste retirée. Un protocole par défaut ajouté dans une version ultérieure de VMark est ajouté à votre liste une seule fois, au premier lancement de cette version.

### Performance

| Paramètre | Description | Par défaut |
|-----------|-------------|------------|
| Garder les deux éditeurs actifs | Monter simultanément les éditeurs WYSIWYG et mode Source pour un changement de mode plus rapide. Augmente la consommation mémoire | Désactivé |

### Cohérence

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Confiance de la vérification sémantique | Degré de certitude requis pour qu'une vérification soit enregistrée comme verdict. En dessous, la réponse est conservée mais marquée inconnue | 0.9 | 0.7, 0.8, 0.9, 0.95 |

Voir [Cohérence](/fr/guide/coherence) pour ce qu'est une vérification et la façon dont les verdicts sont enregistrés.

### Fichiers de workflow

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Récupérer les métadonnées des actions | Permettre à VMark de récupérer le `action.yml` des GitHub Actions référencées pour remplir le formulaire `with:` de l'éditeur structuré. Désactivez-le pour garder l'éditeur de workflow entièrement hors ligne | Activé | Activé / Désactivé |
| Utiliser actionlint lorsqu'il est disponible | Si le binaire `actionlint` est dans votre PATH, l'exécuter sur les fichiers de workflow pour obtenir des diagnostics plus riches. Sans effet si le binaire n'est pas installé | Activé | Activé / Désactivé |

### Workflow

Le visualiseur GitHub Actions n'a pas d'interrupteur : ouvrir un fichier sous
`.github/workflows/` affiche le graphe et l'éditeur de formulaires, et les aides
du volet source (complétion des expressions, synchronisation curseur-canevas,
aller à la définition sur `uses:`) se chargent avec lui. Il ne reste ici que
l'unique préférence du visualiseur et le moteur d'exécution, qui est distinct.

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Conserver la mise en forme YAML à l'enregistrement | Lors de l'enregistrement des modifications de workflow effectuées via le panneau de formulaire, préserver les commentaires, ancres, ordre des clés et lignes vides du YAML d'origine via le pipeline d'aller-retour CST. Lorsqu'il est désactivé, l'enregistrement utilise un sérialiseur compact (plus rapide mais avec perte) | Activé | Activé / Désactivé |
| Moteur de workflow | Exécuter les fichiers de workflow YAML propres à VMark : un fichier de workflow s'ouvre avec son graphe d'étapes et une barre d'outils Exécuter / Annuler à côté de la source, et les génies de workflow peuvent s'exécuter. Les étapes peuvent appeler des fournisseurs IA et écrire des fichiers ; le moteur reste donc désactivé tant que vous ne le demandez pas | Désactivé | Activé / Désactivé |

Le moteur ne change pas ce qu'affiche le visualiseur : les fichiers GitHub Actions
s'ouvrent dans le visualiseur dans tous les cas, et, moteur désactivé, un fichier
de workflow VMark s'affiche comme un simple arbre YAML. Moteur désactivé, VMark
refuse en outre catégoriquement les demandes d'exécution de workflow au lieu de
se contenter de masquer le bouton — y compris les demandes qui arrivent via MCP —
et répond « Le moteur de workflow est désactivé dans les préférences ».

Les deux lignes se trouvent sous **Outils de développement** (voir plus bas) —
activez les outils de développement pour les faire apparaître. Voir
[Visualiseur de workflows](/fr/guide/workflow-viewer) pour le visualiseur et
[Workflows Genie](/fr/guide/workflows) pour le moteur.

### Navigateur intégré

| Paramètre | Description | Par défaut | Options |
|-----------|-------------|------------|---------|
| Navigateur intégré | Le navigateur web intégré à l'application (macOS uniquement). Tant qu'il est activé, **Nouvel onglet de navigateur** figure dans le menu Fichier et la palette de commandes, et les outils MCP `browser` sont disponibles. Le désactiver ferme les onglets de navigateur ouverts et retire la surface d'automatisation par l'IA | Activé | Activé / Désactivé |
| Session de navigateur de l'IA | Choisir **Bac à sable** (recommandé, cookies d'IA isolés et non persistants) ou **Profil partagé** (profil humain avec approbation des destinations) | Bac à sable | Bac à sable / Partagé |
| Autoriser l'accès en bouclage pour l'IA | Autoriser l'IA à naviguer vers localhost et les adresses de bouclage. Les plages LAN privées, de métadonnées et link-local restent bloquées | Désactivé | Activé / Désactivé |

Ces paramètres se trouvent sous **Avancé → macOS** et n'apparaissent que sur macOS.
Les deux lignes de posture de l'IA n'apparaissent que lorsque le navigateur est
activé, et ne sont pas modifiées par son activation — elles restent sur Bac à sable /
bouclage bloqué tant que vous ne les changez pas. Voir
[Navigateur intégré](/fr/guide/browser) pour la surface complète des fonctionnalités.

### Spécifique à la plateforme

| Paramètre | Description | Par défaut | Plateformes |
|-----------|-------------|------------|-------------|
| Effacer la quarantaine macOS à l'ouverture | À l'ouverture d'un espace de travail, retire l'attribut de quarantaine de téléchargement de macOS (`com.apple.quarantine`) du dossier de l'espace de travail et des fichiers situés directement dedans que VMark sait ouvrir (les sous-dossiers ne sont pas touchés). Sans cela, macOS peut ignorer silencieusement un double-clic dans le Finder sur un fichier téléchargé pendant que VMark est ouvert. Affiché dans l'interface sous le nom **Retirer la quarantaine de téléchargement à l'ouverture de l'espace de travail**, dans **Avancé → macOS** | Activé | macOS |

Le réglage **Option comme touche Meta** du terminal se trouve dans le panneau [Terminal](#terminal).

### Outils développeur

**Outils de développement** est un interrupteur principal persistant pour les
paramètres expérimentaux et réservés au développement. L'activer fait apparaître
la ligne **Conserver la mise en forme YAML à l'enregistrement**, la bascule
**Moteur de workflow** et un panneau **Outils dev Hot Exit** (des boutons pour
tester la capture de session, l'inspection, la restauration, la suppression et le
redémarrage). Comme l'interrupteur est persistant, une fonctionnalité en cours de
développement que vous activez reste accessible d'une session à l'autre et dans
les versions publiées — vous n'avez pas besoin de réactiver les outils de
développement à chaque ouverture des Paramètres.

Il fait aussi apparaître la [Base de connaissances](/fr/guide/knowledge-base) en
dehors des Paramètres : l'élément de menu **Affichage → Afficher/masquer la base
de connaissances**, la commande de la palette et le raccourci `Ctrl + Shift + 4`
restent masqués tant que les outils de développement ne sont pas activés, car
aucune version publiée, sur aucune plateforme, n'embarque l'environnement
d'exécution du serveur de contenu dont cette fonctionnalité a besoin.

| Paramètre | Description | Par défaut |
|-----------|-------------|------------|
| Outils de développement | Activer le mode développeur et faire apparaître les paramètres expérimentaux et réservés au développement ci-dessous | Désactivé |

## Voir aussi

- [Fonctionnalités](/fr/guide/features) — Aperçu des capacités de VMark
- [Raccourcis clavier](/fr/guide/shortcuts) — Référence complète des raccourcis
- [Mise en forme CJK](/fr/guide/cjk-formatting) — Règles de mise en forme CJK détaillées
- [Terminal intégré](/fr/guide/terminal) — Sessions de terminal et utilisation
- [Fournisseurs IA](/fr/guide/ai-providers) — Guide de configuration des fournisseurs IA
- [Configuration MCP](/fr/guide/mcp-setup) — Configuration du serveur MCP pour les assistants IA
