# Gestion de l'espace de travail

Un espace de travail dans VMark est un dossier ouvert comme racine de votre projet. Lorsque vous ouvrez un espace de travail, la barre latérale affiche une arborescence de fichiers, l'Ouverture rapide peut trouver chaque fichier affiché par l'arborescence, le terminal démarre dans la racine du projet et vos onglets ouverts sont mémorisés pour la prochaine fois.

Sans espace de travail, vous pouvez quand même ouvrir des fichiers individuels, mais vous perdez l'explorateur de fichiers, la recherche dans le projet et la restauration de session.

::: tip Plusieurs espaces de travail dans une seule fenêtre
La [barre des espaces de travail](/fr/guide/workspace-rail), expérimentale, permet à une seule fenêtre de contenir plusieurs espaces de travail et de passer de l'un à l'autre — chacun avec ses propres onglets, son arborescence de fichiers et sa disposition.
:::

## Ouvrir un espace de travail

| Méthode | Comment |
|---------|---------|
| Menu | **Fichier > Ouvrir l'espace de travail** |
| Ouverture rapide | `Mod + O`, puis sélectionnez **Parcourir...** en bas |
| Glisser-déposer | Glissez un fichier markdown depuis le Finder dans la fenêtre — VMark détecte sa racine de projet et ouvre l'espace de travail automatiquement |
| Espaces de travail récents | **Fichier > Espaces de travail récents** et choisissez un projet précédent |

Lorsque vous ouvrez un espace de travail, VMark affiche la barre latérale avec l'explorateur de fichiers. Si l'espace de travail a déjà été ouvert, les onglets précédemment ouverts sont restaurés.

Sous Windows et Linux, un dossier passé en ligne de commande (`vmark C:\notes` ou `vmark ~/notes`) s'ouvre comme espace de travail dans sa propre fenêtre, comme le fait le dépôt d'un dossier sur l'icône du Dock sous macOS. Cela fonctionne aussi lorsque VMark est déjà en cours d'exécution.

::: tip
Si la fenêtre actuelle a des modifications non enregistrées, VMark propose d'ouvrir l'espace de travail dans une nouvelle fenêtre au lieu de remplacer votre travail.
:::

## Explorateur de fichiers

L'explorateur de fichiers apparaît dans la barre latérale chaque fois qu'un espace de travail est ouvert. Il affiche une arborescence de fichiers markdown enracinée dans le dossier de l'espace de travail.

### Navigation

- **Clic simple** sur un dossier pour le développer ou le réduire
- **Clic simple** sur un fichier pour l'ouvrir dans un onglet
- **Entrée** (ou `F2`) sur un élément sélectionné lance son renommage en ligne
- Les fichiers que VMark n'édite pas lui-même (visibles avec **Afficher tous les fichiers**) s'ouvrent avec l'application par défaut de votre système
- Les dossiers démarrent réduits lors de la première ouverture d'un espace de travail&nbsp;; leur état d'ouverture est préservé lorsque vous basculez entre les vues Fichiers, Plan et Historique

### Coup d'œil

Sélectionnez un fichier dans l'arborescence et appuyez sur `Espace` pour le prévisualiser dans une surimpression occupant toute la fenêtre, sans ouvrir d'onglet — les images, la vidéo et l'audio s'affichent avec leurs contrôles natifs&nbsp;; tout autre fichier affiche un panneau « Impossible de prévisualiser ce format » avec un bouton pour l'ouvrir dans une application externe. `←`/`↑` et `→`/`↓` parcourent dans l'ordre les fichiers visibles de l'arborescence (sans reboucler), et `Espace`, `Échap` ou un clic sur l'arrière-plan ferme l'aperçu. Taper une espace dans le champ de renommage en ligne ne le déclenche jamais.

### Boutons de l'en-tête

L'en-tête de la vue Fichiers regroupe les commandes qui agissent sur toute l'arborescence&nbsp;:

- **Développer tous les dossiers** — ouvre chaque dossier de l'arborescence
- **Réduire tous les dossiers** — ferme chaque dossier jusqu'à la racine
- **Afficher tous les fichiers** — une bascule&nbsp;; lorsqu'elle est activée (mise en
  évidence), l'arborescence liste tous les fichiers plutôt que seulement ceux que VMark
  peut ouvrir
- **Nouveau fichier** / **Nouveau dossier** — crée l'élément dans le dossier sélectionné, ou
  à la racine de l'espace de travail lorsque rien n'est sélectionné

### Opérations sur les fichiers

Cliquez avec le bouton droit sur un fichier, un dossier ou l'espace vide sous l'arborescence pour accéder au menu contextuel :

| Action | Affichée pour | Description |
|--------|---------------|-------------|
| Ouvrir | Fichiers | Ouvrir le fichier dans un nouvel onglet |
| Renommer | Fichiers, dossiers | Modifier le nom du fichier ou dossier en ligne (aussi `F2`) |
| Dupliquer | Fichiers | Créer une copie du fichier |
| Déplacer vers… | Fichiers | Déplacer le fichier vers un autre dossier via une boîte de dialogue |
| Supprimer | Fichiers, dossiers | Déplacer le fichier ou dossier vers la corbeille système |
| Copier le chemin | Fichiers, dossiers | Copier le chemin absolu dans le presse-papiers |
| Afficher dans le Finder | Fichiers, dossiers | Afficher l'élément dans votre gestionnaire de fichiers — intitulé **Afficher dans l'Explorateur** sous Windows et **Afficher dans le gestionnaire de fichiers** sous Linux |
| Nouveau fichier | Dossiers, espace vide | Créer un nouveau fichier markdown à cet emplacement |
| Nouveau dossier | Dossiers, espace vide | Créer un nouveau dossier à cet emplacement |
| Ouvrir un terminal ici | Dossiers | Démarrer une nouvelle session de terminal dans ce dossier (désactivé dès que 5 sessions sont ouvertes) — voir [Terminal](/fr/guide/terminal) |

Vous pouvez également **glisser-déposer** des fichiers entre des dossiers directement dans l'arborescence.

### Bascules de visibilité

Par défaut, l'explorateur affiche uniquement les types de fichiers que VMark peut ouvrir, et masque les fichiers points.
**Les dossiers sont listés qu'ils contiennent ou non quelque chose de visible**, de sorte qu'un projet
composé de types de fichiers non pris en charge ressemble à une arborescence de dossiers vides — c'est le filtre qui agit,
pas un échec de lecture du répertoire. Deux bascules modifient cela :

| Bascule | Raccourci | Ce qu'elle fait |
|---------|-----------|----------------|
| Afficher les fichiers cachés | `Mod + Shift + .` (macOS) / `Ctrl + H` (Win/Linux) | Révèle les fichiers points et dossiers cachés |
| Afficher tous les fichiers | `Mod + Shift + A` | Affiche les fichiers non-markdown aux côtés de vos documents |

Les deux paramètres sont sauvegardés par espace de travail et persistent entre les sessions.

### Dossiers exclus

Certains répertoires ne sont jamais parcourus, quels que soient les paramètres de l'espace de travail — le
même plancher que celui qu'applique la recherche dans l'espace de travail&nbsp;: `.git`, `node_modules`, `.obsidian`,
`.svn`, `__pycache__`, `.DS_Store`, `.vscode`, `.idea`, `target`, `.next`,
`dist`, `.superpowers`. Ils apparaissent tout de même comme dossiers pour que vous sachiez qu'ils existent&nbsp;; leur
contenu n'est pas lu. Ajoutez vos propres noms dans **Dossiers exclus** des paramètres de
l'espace de travail (un nouvel espace de travail y commence avec `.git` et `node_modules`).

L'arborescence est listée en une seule passe et rafraîchie lorsque des fichiers changent. Une rafale de
modifications la rafraîchit une seule fois, peu après la fin de la rafale&nbsp;; un dossier qui ne
cesse jamais de changer (un téléchargement en cours, une compilation, une synchronisation) est rafraîchi à un
intervalle croissant plutôt qu'en continu, de sorte que l'explorateur ne monopolise jamais un cœur de processeur
à relire un espace de travail très actif.

## Ouverture rapide

Appuyez sur `Mod + O` pour ouvrir l'overlay d'Ouverture rapide. Il fournit une recherche floue sur trois sources, listées dans cet ordre :

1. **Onglets ouverts** dans la fenêtre actuelle (marqués d'un indicateur point), les plus récemment utilisés en premier
2. **Fichiers récents** que vous avez ouverts auparavant
3. **Tous les fichiers actuellement affichés par l'explorateur de fichiers** dans l'espace de travail

Avant que vous ne tapiez, la liste n'affiche que les onglets ouverts et les fichiers récents. Dès que vous tapez, les résultats des trois sources apparaissent, regroupés dans cet ordre et classés par qualité de correspondance au sein de chaque groupe.

Tapez quelques caractères pour filtrer — la correspondance est floue, donc `rme` trouve `README.md`. Utilisez les touches fléchées pour naviguer et **Entrée** pour ouvrir. Une ligne **Parcourir...** épinglée en bas ouvre une boîte de dialogue de fichier.

La troisième source suit exactement l'explorateur de fichiers, de sorte que les deux ne sont jamais en désaccord
sur ce qui existe. Activez **Afficher les fichiers cachés** et l'Ouverture rapide trouve les documents
sous `.claude/`, `.github/workflows/` et tout autre dossier point&nbsp;; activez
**Afficher tous les fichiers** et elle trouve aussi les fichiers non-markdown, en ouvrant chacun de la même
façon qu'un clic dans la barre latérale — les formats propres à VMark dans un onglet, tout le reste
dans l'application par défaut de votre système. Les dossiers de la liste toujours ignorée
(`.git`, `node_modules`, `.vscode` et les autres) restent exclus des deux.

| Action | Raccourci |
|--------|----------|
| Ouvrir l'Ouverture rapide | `Mod + O` |
| Naviguer dans les résultats | `Haut / Bas` |
| Ouvrir le fichier sélectionné | `Entrée` |
| Fermer | `Échap` |

::: tip
Sans espace de travail, l'Ouverture rapide fonctionne quand même — elle affiche les fichiers récents et les onglets ouverts mais ne peut pas rechercher dans l'arborescence de fichiers.
:::

## Recherche dans le contenu de l'espace de travail

Lorsqu'un espace de travail est ouvert, VMark peut rechercher dans le **contenu des fichiers** (et pas seulement dans les noms de fichiers). Par défaut, il cherche dans les types de fichiers que VMark ouvre (Markdown, texte brut, YAML, ainsi que JSON/TOML/Mermaid/SVG/HTML lorsque leur prise en charge est activée). Désactivez le bouton **.md** (**Types de fichiers pris en charge uniquement**) pour chercher dans tous les fichiers texte (les fichiers binaires sont toujours ignorés).

| Action | Raccourci |
|---|---|
| Ouvrir le panneau de recherche dans le contenu | `Mod + Shift + H` (aussi **Édition → Rechercher → Rechercher dans les fichiers…**) |
| Aller au résultat suivant | `Entrée` (ou touches fléchées pour naviguer) |
| Ouvrir le résultat dans un nouvel onglet | Cliquer sur l'aperçu de la correspondance |

Chaque résultat affiche le chemin du fichier, le numéro de ligne et un extrait avec le texte correspondant mis en évidence. Les résultats ne sont pas classés&nbsp;: les fichiers sont listés dans l'ordre où la recherche les atteint en parcourant les dossiers de l'espace de travail. Une recherche s'arrête après 50 fichiers correspondants, 1&nbsp;000 correspondances ou 5 secondes, et affiche ce qu'elle a trouvé jusque-là.

**Exclus par défaut**&nbsp;: les dossiers dans lesquels VMark ne descend jamais — `.git`, `node_modules`, `.obsidian`, `.svn`, `__pycache__`, `.DS_Store`, `.vscode`, `.idea`, `target`, `.next`, `dist`, `.superpowers` — ainsi que tous les noms figurant dans **Dossiers exclus** des Paramètres de l'espace de travail (un nouvel espace de travail y commence avec `.git` et `node_modules`).

**Fichiers cachés**&nbsp;: les fichiers points sont toujours ignorés par la recherche dans le contenu, quel que soit l'état de la bascule **Afficher les fichiers cachés** de l'explorateur de fichiers.

Cela se distingue de l'[Ouverture rapide](#ouverture-rapide) qui recherche uniquement dans les *noms de fichiers* — la recherche dans le contenu ouvre le fichier correspondant avec le curseur placé sur la ligne correspondante.

## Espaces de travail récents

VMark mémorise jusqu'à 10 espaces de travail récemment ouverts. Accédez-y depuis **Fichier > Espaces de travail récents** dans la barre de menus.

- Les espaces de travail sont triés par heure de dernière ouverture (les plus récents en premier)
- La liste se synchronise avec le menu natif à chaque changement
- Choisissez **Effacer les espaces de travail récents** pour réinitialiser la liste

## Paramètres de l'espace de travail

Chaque espace de travail a sa propre configuration qui persiste entre les sessions. Les paramètres sont stockés dans le répertoire de données de l'application VMark — pas dans le dossier du projet — afin que votre espace de travail reste propre.

Les paramètres suivants sont sauvegardés par espace de travail :

| Paramètre | Description |
|-----------|-------------|
| Dossiers exclus | Dossiers masqués de l'explorateur de fichiers |
| Afficher les fichiers cachés | Si les fichiers points sont visibles |
| Afficher tous les fichiers | Si les fichiers non-markdown sont visibles |
| Derniers onglets ouverts | Chemins de fichiers pour la restauration de session à la prochaine ouverture |

::: tip
La configuration de l'espace de travail est liée au chemin du dossier. Ouvrir le même dossier sur la même machine restaure toujours vos paramètres, même depuis une fenêtre différente.
:::

## Fenêtre d'espace de travail vide

Fermer le dernier document ouvert ne ferme plus la fenêtre. Celle-ci reste ouverte sur un **écran d'accueil** et — si un espace de travail est ouvert — sa barre latérale et son arborescence de fichiers restent visibles. Cela fonctionne de la même façon sur macOS, Windows et Linux.

L'écran d'accueil propose des actions rapides pour reprendre le travail&nbsp;:

- Les boutons **Nouveau fichier**, **Ouvrir un fichier** et **Ouvrir un espace de travail…**
- Une liste **Fichiers récents** et une liste **Espaces de travail récents** — cliquez sur une entrée pour
  la rouvrir. Chaque liste n'apparaît que lorsqu'elle contient des entrées.

**Ouvrir un fichier** et les listes récentes réutilisent la fenêtre dans laquelle vous êtes déjà. Une
fenêtre affichant l'écran d'accueil n'a aucun onglet à remplacer, donc rien ne s'ouvre dans une seconde
fenêtre — sauf si la fenêtre a encore un espace de travail ouvert&nbsp;: dans ce cas, un fichier situé
hors de cet espace de travail obtient sa propre fenêtre plutôt que de remplacer l'arborescence de fichiers
que vous voyez encore dans la barre latérale.

La barre de titre d'une fenêtre affichant l'écran d'accueil indique **VMark**&nbsp;: aucun document n'est
ouvert, il n'y a donc aucun nom de fichier à afficher.

Pour fermer la fenêtre elle-même, utilisez le bouton rouge des feux de signalisation, `Cmd/Ctrl + Q` (quitter), ou appuyez de nouveau sur `Cmd/Ctrl + W` pendant que l'écran d'accueil est affiché.

## Documents côte à côte

Ouvrez deux documents **différents** à la fois — divisez l'éditeur en deux volets, chacun
avec son propre document. Pratique pour la lecture ou la traduction bilingue (l'original d'un
côté, la traduction de l'autre) ou pour garder une référence ouverte pendant que vous écrivez.
Cela se distingue de la **Vue divisée Markdown** (`Shift + F6`), qui montre la
source et l'aperçu du *même* fichier.

- Activez ou désactivez la division avec **`Alt + Mod + \`** ou la palette de commandes
  (**Diviser l'éditeur — deux documents**). Le document actuel reste dans un volet
  et le document que vous avez utilisé le plus récemment avant lui (ou, à défaut, un autre document ouvert) s'ouvre dans l'autre — le
  même document n'est jamais affiché deux fois, la division nécessite donc deux documents ouverts.
  Cliquez sur un onglet pendant qu'un volet a le focus pour changer le document de ce volet, ou
  faites un clic droit sur un onglet et choisissez **Ouvrir sur le côté**.
- Faites glisser le séparateur (ou donnez-lui le focus et utilisez les touches fléchées) pour redimensionner les volets.
- Le volet que vous éditez est le volet **actif** — la barre d'outils, la barre de recherche et
  les commandes de menu agissent sur lui.
- Activez **Synchroniser le défilement entre les volets** (palette de commandes) pour faire défiler les deux
  côtés ensemble, proportionnellement — pratique pour aligner une traduction.

## Restauration de session

Lorsque vous fermez une fenêtre qui a un espace de travail ouvert, VMark sauvegarde la liste des onglets ouverts dans la configuration de l'espace de travail. La prochaine fois que vous ouvrez le même espace de travail, ces onglets sont restaurés automatiquement.

- Seuls les onglets avec un chemin de fichier sauvegardé sont restaurés (les onglets sans titre ne sont pas persistés)
- Si un fichier a été déplacé ou supprimé depuis la dernière session, il est ignoré silencieusement
- Les données de session sont sauvegardées à la fermeture de la fenêtre et à la fermeture de l'espace de travail (`Fichier > Fermer l'espace de travail`)

## Multi-fenêtres

Chaque fenêtre VMark peut avoir son propre espace de travail indépendant. Cela vous permet de travailler sur plusieurs projets simultanément.

- **Fichier > Nouvelle fenêtre** ouvre une nouvelle fenêtre
- Ouvrir un espace de travail dans une nouvelle fenêtre n'affecte pas les autres fenêtres
- La taille et la position des fenêtres sont mémorisées par fenêtre

Lorsque vous glissez un fichier markdown depuis le Finder et que la fenêtre actuelle a déjà du travail non enregistré, VMark ouvre automatiquement le projet du fichier dans une nouvelle fenêtre.

### Ouvrir un fichier situé hors de l'espace de travail actuel

Une fenêtre dans laquelle un espace de travail est ouvert conserve cet espace de travail. Ouvrir un fichier situé
ailleurs — depuis le Finder ou l'Explorateur, depuis `Fichier > Ouvrir` ou depuis les Fichiers
récents — l'ouvre dans une **nouvelle fenêtre** enracinée dans son propre dossier, de sorte que l'arborescence de
fichiers dans laquelle vous travailliez reste en place. Seule une fenêtre sans espace de travail propre
accueille le fichier sur place.

Sous Windows et Linux, double-cliquer sur un fichier dont le type est associé à
VMark le transmet désormais au VMark déjà en cours d'exécution au lieu de lancer une
seconde instance. macOS a toujours fonctionné ainsi.

### Détacher des onglets dans de nouvelles fenêtres

Vous pouvez extraire un onglet de sa fenêtre pour en créer une nouvelle :

- **Glissez un onglet hors de la barre d'onglets** — à plus d'environ 40 px au-dessus ou en dessous — pour le détacher. Relâchez-le au-dessus d'une autre fenêtre VMark pour y déplacer l'onglet ; relâchez-le ailleurs pour l'ouvrir dans une nouvelle fenêtre à la position du pointeur
- **Glissez un onglet horizontalement** dans la barre d'onglets pour le réordonner parmi les autres onglets
- Les onglets épinglés ne peuvent pas être glissés

Une notification toast confirme le déplacement et propose **Annuler**, qui ramène l'onglet. Les onglets de navigateur et le dernier onglet de la fenêtre principale ne peuvent pas être sortis de la barre ; ils reviennent à leur place.

Le geste est verrouillé par direction : le mouvement horizontal lance un réordonnancement, tandis que le mouvement vertical déclenche un détachement. Vous pouvez passer du réordonnancement au détachement en cours de glissement en déplaçant le pointeur en dehors de la barre d'onglets.

### Panneau État des fenêtres

Lorsque vous exécutez Claude Code dans plusieurs fenêtres, **Affichage > Afficher/masquer l'état des fenêtres** (aussi dans la palette de commandes, ou appuyez sur `Ctrl + Shift + 5`) ouvre un panneau qui liste toutes les autres fenêtres ouvertes avec leur état en direct et vous permet d'y accéder directement.

Chaque ligne affiche le nom du document de la fenêtre et son état actuel&nbsp;:

| État | Signification |
|------|---------------|
| **Nécessite votre attention** | Un terminal de cette fenêtre (sans focus) a déclenché la cloche — Claude Code la fait sonner lorsqu'un tour se termine ou qu'il vous attend |
| **En cours** | Un génie IA de VMark est en cours d'exécution dans cette fenêtre |
| **Erreur** | La dernière exécution d'un génie IA a échoué |
| **Inactive** | Rien n'est en cours |

Les lignes sont classées en donnant la priorité à l'attention, de sorte que la fenêtre qui a besoin de vous se trouve en haut. Cliquez sur une ligne pour donner le focus à cette fenêtre et la mettre au premier plan&nbsp;; donner le focus à une fenêtre efface son indicateur « nécessite votre attention ». L'état provient de deux signaux fiables — l'état d'invocation des génies IA de VMark et la cloche du terminal — et non de l'analyse de la sortie du terminal.

**Épinglez le panneau** pour l'utiliser comme « centre de contrôle » permanent&nbsp;: tant qu'il est épinglé, cliquer sur une ligne donne le focus à la fenêtre cible mais laisse le panneau ouvert, de sorte que vous pouvez passer d'une fenêtre à l'autre sans le rouvrir. Le bouton d'épinglage dans l'en-tête ouvre un petit menu avec deux portées&nbsp;:

- **Épingler cette fenêtre** — épingle le panneau dans la fenêtre actuelle uniquement. Son état ouvert et épinglé est mémorisé par fenêtre d'un redémarrage à l'autre, de sorte qu'une fenêtre que vous avez configurée comme tableau de bord le reste.
- **Épingler toutes les fenêtres** — un épinglage global&nbsp;: chaque fenêtre ouvre automatiquement le panneau et se comporte comme épinglée, *y compris les fenêtres que vous ouvrirez plus tard*, de sorte que vous adoptez la disposition « centre de contrôle » une seule fois au lieu de configurer chaque fenêtre à la main. Le désactiver ramène chaque fenêtre à son propre état d'épinglage par fenêtre.

## Modifications externes

VMark surveille votre espace de travail pour les modifications effectuées par d'autres programmes (Git, éditeurs externes, outils de build, etc.) et maintient les documents ouverts synchronisés.

- **Les fichiers non modifiés** sont rechargés automatiquement lorsque leur contenu change sur le disque. Une brève notification toast confirme le rechargement.
- **Les fichiers avec des modifications non enregistrées** déclenchent une boîte de dialogue avec trois options : **Enregistrer sous** (enregistrer votre version à un nouvel emplacement), **Recharger** (abandonner vos modifications et charger depuis le disque) ou **Conserver** (préserver vos modifications et marquer le fichier comme divergent).
- **Les fichiers supprimés** sont marqués comme manquants dans leur onglet mais ne sont pas fermés — vous pouvez toujours enregistrer le contenu à un nouvel emplacement.
- Lorsque plusieurs fichiers modifiés changent en même temps (par exemple après un `git checkout`), VMark les regroupe dans une seule boîte de dialogue pour que vous puissiez tout recharger, tout conserver ou examiner chaque fichier individuellement.
- Si le contenu sur disque d'un fichier divergent correspond par la suite à ce que vous avez dans l'éditeur (par exemple un `git checkout` restaure le même texte), VMark efface automatiquement l'état divergent pour que la sauvegarde automatique reprenne.

VMark filtre ses propres sauvegardes pour que vous ne soyez jamais sollicité par des modifications que vous avez faites dans l'application.

## Documents récents du Dock macOS

Les documents que vous ouvrez dans VMark sont enregistrés auprès de macOS, ils apparaissent donc dans le sous-menu **Ouvrir les éléments récents** lorsque vous faites un clic droit sur l'icône VMark dans le Dock.

## Intégration du terminal

Le terminal intégré utilise automatiquement la racine de l'espace de travail comme répertoire de travail. Lorsque vous ouvrez ou changez d'espace de travail, les sessions de terminal inactives effectuent `cd` vers la nouvelle racine. Une session occupée à exécuter une commande n'est pas interrompue et change de répertoire une fois la commande terminée (il faut l'intégration shell pour savoir quand elle est occupée). Avec la [barre des espaces de travail](/fr/guide/workspace-rail) activée, une session qui appartient à un espace de travail conserve son propre répertoire.

La variable d'environnement `VMARK_WORKSPACE` est définie sur le chemin de l'espace de travail dans chaque session de terminal, de sorte que vos scripts peuvent référencer la racine du projet.

[En savoir plus sur le terminal →](/fr/guide/terminal)

## Commande CLI Shell

VMark peut installer une commande shell `vmark` pour que vous puissiez ouvrir des fichiers et des dossiers depuis le terminal.

### Installation et suppression

**Aide → Commande shell : installer 'vmark' dans le PATH…** est un élément unique qui bascule. Lorsqu'aucune commande `vmark` n'est installée, il écrit un petit script lanceur dans `/usr/local/bin/vmark` et demande votre mot de passe administrateur (la même approche que VS Code utilise pour sa commande `code`). Lorsque le script propre à VMark s'y trouve déjà, le même élément le supprime. Une boîte de dialogue indique le résultat dans les deux cas. macOS uniquement.

### Utilisation

```bash
# Ouvrir un fichier
vmark README.md

# Ouvrir un dossier comme espace de travail
vmark ~/projects/my-blog

# Ouvrir plusieurs fichiers
vmark chapter1.md chapter2.md
```

La commande délègue à `open -b app.vmark`, donc macOS gère le comportement d'instance unique — les fichiers s'ouvrent dans votre fenêtre VMark existante au lieu de lancer un nouveau processus.

Si le fichier situé à `/usr/local/bin/vmark` n'a pas été écrit par VMark, l'élément ne touche à rien et vous invite à le supprimer manuellement.
