# Terminal intégré

VMark inclut un panneau de terminal intégré pour exécuter des commandes sans quitter l'éditeur.

Appuyez sur `` Ctrl + ` `` pour afficher ou masquer le panneau de terminal. L'ouvrir place le curseur dans le shell, et le fermer rend le curseur à l'éditeur — le panneau est donc accessible et quittable sans toucher à la souris.

Pour passer de l'éditeur à un terminal OUVERT sans le masquer, appuyez sur `` Ctrl + Shift + ` `` (**Activer le terminal ou l'éditeur** ; `` Alt + Shift + ` `` sous Windows et Linux). Ce raccourci bascule dans les deux sens et ne modifie jamais la visibilité du panneau — si le terminal est masqué, il l'ouvre au lieu de ne rien faire.

## Sessions

Le terminal prend en charge jusqu'à 5 sessions simultanées, chacune avec son propre processus shell. Une barre d'onglets verticale sur le côté droit affiche les onglets de session numérotés.

| Action | Comment |
|--------|---------|
| Nouvelle session | Cliquez sur le bouton **+** |
| Changer de session | Cliquez sur un numéro d'onglet |
| Fermer une session | Cliquez sur l'icône corbeille |
| Redémarrer le shell | Cliquez sur l'icône de redémarrage |
| Renommer une session | Double-cliquez sur un onglet, tapez un nom, appuyez sur `Enter` (`Escape` annule) |
| Permuter le côté du panneau | Cliquez sur l'icône de permutation (↕ / ↔) pour basculer le terminal à l'extrémité opposée de son axe actuel. En mode **Auto**, la bascule intelligente selon les proportions de la fenêtre est conservée (paysage → côté, portrait → bas/haut) — seule l'extrémité choisie change. |
| Agrandir le panneau | Double-cliquez sur la poignée de redimensionnement ; double-cliquez à nouveau pour restaurer |

Lorsque vous fermez la dernière session, le panneau se masque mais la session reste active — rouvrez avec `` Ctrl + ` `` et vous reprenez là où vous en étiez. Lorsque le shell se termine proprement (`exit` ou `Ctrl + D`), son onglet se ferme automatiquement — et le panneau se masque s'il s'agissait du dernier. Si le shell se termine avec une erreur, l'onglet reste ouvert et affiche le code de sortie ; appuyez sur n'importe quelle touche pour le redémarrer.

Fermer une session — avec l'icône corbeille, en fermant sa fenêtre ou en quittant VMark — met fin à tout ce qui y a été lancé, et pas seulement au shell. VMark envoie un signal de raccrochage (`SIGHUP`) à tout le groupe de processus du shell, attend jusqu'à une seconde qu'il se termine, puis tue de force (`SIGKILL`) ce qui reste. Une tâche que vous avez délibérément détachée dans son propre groupe de processus (par exemple avec `nohup` ou `setsid`) n'est pas affectée. Sous Windows, il n'y a pas d'étape de raccrochage : le shell est arrêté immédiatement.

**Notifications :** lorsqu'un terminal déclenche la cloche (par ex. Claude Code qui termine un tour) alors que sa fenêtre VMark n'a pas le focus, VMark publie une notification système qui nomme le document de la fenêtre — vous pouvez ainsi exécuter Claude Code dans plusieurs fenêtres et être averti de celle qui a besoin de vous, sans les surveiller une à une. Activez ou désactivez ce comportement avec **Paramètres → Terminal → Notifier quand non focalisée** (activé par défaut ; l'autorisation de notification est demandée à la première utilisation). Le même signal de cloche en arrière-plan signale aussi la fenêtre dans le [panneau État des fenêtres](/fr/guide/workspace-management#panneau-etat-des-fenetres), pour que vous voyiez quelle fenêtre a besoin de vous et y accédiez directement.

Chaque onglet reflète le titre du programme en cours d'exécution (défini par les outils qui émettent un titre de terminal, comme `vim` ou `ssh`), sauf si vous avez renommé la session manuellement — un renommage manuel l'emporte toujours. Pour renommer, **double-cliquez sur l'onglet** : `Enter` valide, `Escape` annule, et cliquer ailleurs conserve ce que vous avez tapé. Un nom vide est ignoré.

**Agrandir :** la taille du panneau s'arrête à 80 % de l'espace disponible pour que l'éditeur reste accessible, et un **double-clic sur la poignée de redimensionnement** l'amène directement à ce plafond. Un second double-clic le ramène à votre taille enregistrée. Il s'agit d'une bascule d'affichage — elle ne modifie jamais la taille que vous avez configurée.

**Ouvrir un terminal ici :** faites un clic droit sur n'importe quel dossier dans l'explorateur de fichiers et choisissez **Ouvrir un terminal ici** pour démarrer une session dans ce répertoire. La nouvelle session s'y ouvre, quel que soit l'emplacement de vos autres sessions. À cinq sessions, l'élément est grisé.

## Sessions de terminal et barre des espaces de travail

Lorsque la [barre des espaces de travail](/fr/guide/workspace-rail) est activée, chaque espace de travail de la barre possède son **propre ensemble** de sessions de terminal. Changer d'espace de travail permute les onglets de terminal visibles — les shells de l'espace de travail masqué restent exactement où ils étaient : actifs, dans le même répertoire de travail, sans que rien n'y soit tapé. Revenir en arrière réaffiche les mêmes shells, et la session que vous regardiez est mémorisée pour chaque espace de travail.

- Les nouvelles sessions appartiennent à l'espace de travail actif au moment de leur création, et démarrent à la racine de cet espace de travail.
- La limite de 5 sessions et la numérotation `Terminal 1…5` s'appliquent à l'ensemble **visible** — les sessions des espaces de travail masqués n'empiètent pas sur la marge de l'espace de travail actif.
- Ouvrir le panneau sur un espace de travail sans session en crée une automatiquement ; sans espace de travail (ni fichier enregistré pour ancrer un répertoire), le panneau affiche une indication à la place.
- Fermer un espace de travail depuis la barre, ou le déplacer dans sa propre fenêtre, ferme ses sessions de terminal avec lui.
- Lorsque la barre est **désactivée**, tout fonctionne comme avant : un seul ensemble de sessions pour toute la fenêtre, dont les shells inactifs suivent les changements d'espace de travail avec un `cd`.

## Raccourcis clavier

Ces raccourcis fonctionnent lorsque le panneau de terminal est mis au point :

| Action | Raccourci |
|--------|----------|
| Copier | `Mod + C` (avec sélection) |
| Coller | `Mod + V` |
| Effacer | `Mod + K` |
| Rechercher | `Mod + F` |
| Début / fin de ligne | `Cmd + ←` / `Cmd + →` (macOS) |
| Supprimer la ligne | `Cmd + ⌫` (macOS) |
| Zoom de la police du terminal | `Mod + =` / `Mod + -` / `Mod + 0` |
| Sélectionner toute la sortie du terminal | `Mod + A` |
| Passer à la session 1 … 5 | `Mod + 1` … `Mod + 5` |
| Basculer le terminal | `` Ctrl + ` `` |
| Activer le terminal ou l'éditeur | `` Ctrl + Shift + ` `` |
| Invite de commande précédente | `Mod + ↑` |
| Invite de commande suivante | `Mod + ↓` |

Lorsque le terminal a le focus, `Mod + =` / `-` / `0` agrandissent ou réduisent la police du **terminal** (réglée séparément dans les paramètres du terminal), et non celle de l'éditeur, et `Mod + F` ouvre la recherche du **terminal** plutôt que la barre de recherche de l'éditeur.

La navigation entre les invites (`Mod + ↑` / `Mod + ↓`) nécessite l'intégration du shell — voir [Intégration du shell](#integration-du-shell) ci-dessous.

**Linux :** `Ctrl` + une lettre va au shell, donc les touches readline comme `Ctrl + A`, `Ctrl + E`, `Ctrl + K`, `Ctrl + F`, `Ctrl + U` et `Ctrl + W` fonctionnent comme dans tout terminal Linux. Les raccourcis à lettre propres au terminal passent sur `Ctrl + Shift` : `Ctrl + Shift + F` recherche, `Ctrl + Shift + K` efface, `Ctrl + Shift + A` sélectionne tout, et `Ctrl + Shift + C` / `Ctrl + Shift + V` copient et collent. `Ctrl + C` copie toujours une sélection (sinon il envoie SIGINT) et `Ctrl + V` colle toujours ; `Ctrl + Insert` / `Shift + Insert` copient et collent aussi.

::: tip
`Mod + C` sans sélection de texte envoie SIGINT au processus en cours d'exécution — identique à appuyer sur Ctrl+C dans un terminal ordinaire.
:::

## Lire l’historique tout en tapant

Faites défiler vers le haut pour relire la sortie précédente et continuez à taper : la vue reste où vous êtes, et une **invite flottante** apparaît en bas du terminal avec une copie en direct des lignes dans lesquelles vous tapez — l’invite du shell, ou la zone de saisie d’une TUI comme Claude Code. Les touches vont toujours au shell : la complétion par Tab, l’historique et les méthodes de saisie fonctionnent comme d’habitude. Cliquez sur la flèche à son extrémité droite pour revenir à l’invite ; elle disparaît d’elle-même dès que l’invite est de nouveau visible. Appuyer sur Entrée ou Ctrl+C y ramène aussi, pour voir ce que fait ensuite la commande — ou l’invite envoyée à une TUI ; toute autre touche, y compris Maj+Entrée, laisse la vue en place. Les programmes plein écran (vim, less) n’ont pas d’historique, elle n’y apparaît donc jamais.

## Recherche

Appuyez sur `Mod + F` pour ouvrir la barre de recherche. Tapez pour effectuer une recherche incrémentale dans le tampon du terminal.

| Action | Raccourci |
|--------|----------|
| Occurrence suivante | `Enter` |
| Occurrence précédente | `Shift + Enter` |
| Fermer la recherche | `Escape` |

La barre indique ce qu'elle a trouvé à côté du champ de saisie :

- **`3 / 17`** — vous êtes sur la troisième des dix-sept correspondances.
- **`5000 correspondances`** — trop de correspondances pour que le terminal
  puisse suivre laquelle est active ; il indique donc le total sans position.
- **Aucun résultat** — la requête ne correspond à rien ; le texte saisi
  devient également rouge.

Trois bascules se trouvent entre le champ de saisie et les flèches :

| Bascule | Effet |
|--------|--------|
| **Aa** | Respecter la casse |
| **ab** | Mots entiers uniquement |
| **.\*** | Traiter la requête comme une expression régulière |

En mode expression régulière, un motif à moitié tapé (`[` en route vers `[a-z]`)
indique simplement qu'il n'y a aucun résultat au lieu de produire une erreur —
continuez à taper. Les bascules sont réinitialisées chaque fois que vous fermez
la barre ou changez de session.

## Menu contextuel

Clic droit à l'intérieur du terminal pour accéder :

- **Copier** — copier le texte sélectionné (désactivé lorsque rien n'est sélectionné)
- **Copier sans retours à la ligne** — copier la sélection en supprimant les retours à la ligne liés à la largeur d'affichage. Certains programmes en ligne de commande (codex et d'autres applications TUI) coupent leur sortie à la largeur du terminal en insérant de vrais sauts de ligne ; une copie normale conserve ces sauts. « Copier sans retours à la ligne » rejoint les lignes coupées en paragraphes continus (les lignes vides sont conservées comme séparateurs de paragraphes). Cette fonction tient compte du CJK — le texte chinois/japonais est rejoint sans insérer d'espaces. Sélectionnez un bloc dont vous savez qu'il forme un seul flux logique, car VMark ne peut pas distinguer un saut de ligne de retour automatique d'un saut intentionnel.
- **Coller** — coller depuis le presse-papiers dans le shell
- **Tout sélectionner** — sélectionner l'intégralité du tampon du terminal
- **Effacer** — effacer la sortie visible
- **Réinitialiser l'affichage** — repeindre le terminal et réinitialiser son cache de rendu. Utilisez ceci si les caractères commencent à se chevaucher, mélanger les casses ou s'afficher de manière brouillée après une longue session — observé le plus souvent lors de l'exécution de CLI fortement stylisés (par ex. Claude Code) pendant des heures. Les terminaux d'une même fenêtre partagent un seul cache de glyphes ; cette action repeint donc tous les terminaux de la fenêtre, et pas seulement l'onglet actif.
- **Copier la sortie de la commande** — copier tout ce qu'une commande a affiché, sans sa ligne d'invite et sans la sortie de la commande suivante. N'apparaît que lorsque vous faites un clic droit dans la sortie d'une commande et que l'[intégration du shell](#integration-du-shell) est activée, car c'est elle qui indique à VMark où chaque commande a commencé et s'est terminée.

Le menu est entièrement navigable au clavier : il s'ouvre avec la première action disponible sélectionnée, les flèches passent d'un élément à l'autre (en sautant les éléments désactivés), Début/Fin vont au premier/dernier, Entrée ou Espace active l'élément, et Échap ou Tab ferme le menu.

## Exécuter un bloc de code

Survolez n'importe quel bloc `bash`, `sh`, `zsh` ou `shell` — ou un bloc de
transcription marqué `console`, `shell-session`, `shellsession` ou `terminal` —
dans votre document, et un bouton **▶ Exécuter dans le terminal** apparaît à
côté du bouton de copie. Il colle le bloc dans le terminal — en affichant le
panneau et en démarrant une session si nécessaire — et s'arrête là.

::: warning Il colle ; il n'exécute pas
La commande est placée sur la ligne de saisie du shell et **n'est jamais
exécutée à votre place** : aucun saut de ligne n'est ajouté, donc rien ne se
passe tant que *vous* n'appuyez pas sur Entrée. Lisez d'abord ce qui a été
collé — un document peut venir de n'importe où, et un bloc de code n'est que du
texte écrit par quelqu'un.
:::

Pour un bloc de transcription (`console`, `shell-session`, `shellsession`,
`terminal`) — une session collée — les invites `$ `, `% ` et `# ` en début de
ligne sont supprimées pour que vous obteniez la commande plutôt que l'invite.
Dans un bloc `bash`, elles sont laissées telles quelles, puisqu'il s'agit alors
de code source.

## Liens cliquables

Le terminal détecte trois types de liens dans la sortie des commandes :

- **URL web** — cliquez pour ouvrir dans votre navigateur par défaut
- **Hyperliens OSC 8** — hyperliens de terminal explicites émis par des outils comme `ls --hyperlink=auto`, `gh` et les compilateurs modernes. Le texte visible et l'URL sous-jacente peuvent différer ; cliquer ouvre l'URL.
- **Chemins de fichiers** — un chemin contenant un `/` et se terminant par une extension de fichier ; cliquez pour ouvrir le fichier dans l'éditeur (prend en charge les suffixes `:ligne:col` ; un chemin relatif est résolu par rapport au répertoire courant du shell lorsque l'[intégration du shell](#integration-du-shell) le signale, sinon par rapport à la racine de l'espace de travail)

## Environnement shell

VMark définit ces variables d'environnement dans chaque session de terminal :

| Variable | Valeur |
|----------|--------|
| `TERM` | `xterm-256color` |
| `TERM_PROGRAM` | `WezTerm` |
| `TERM_PROGRAM_VERSION` | `20240203-110809-5046fc22` |
| `VMARK_WORKSPACE` | Chemin racine de l'espace de travail (lorsqu'un dossier est ouvert) |
| `PATH` | PATH complet du shell de connexion (identique à votre terminal système) |
| `COLORTERM` | `truecolor` |
| `LC_CTYPE` | `UTF-8` — **macOS uniquement** |

`TERM_PROGRAM` indique `WezTerm`, et non `vmark`, et c'est délibéré. Plusieurs
outils CLI — dont le `/terminal-setup` de Claude Code — n'activent l'encodage
des touches [CSI u](https://invisible-island.net/xterm/modified-keys.html) que
pour les terminaux figurant sur une liste d'autorisation codée en dur, et
basculent vers un mode dégradé « terminal inconnu » pour tous les autres. VMark
parle ce protocole ; il s'identifie donc comme le terminal autorisé dont le
comportement est le plus proche du sien. Remplacer cette valeur par `vmark`
casserait silencieusement Shift+Enter et d'autres séquences de touches
modifiées dans ces outils. Voir
[ADR-006](https://github.com/xiaolai/vmark/blob/main/dev-docs/decisions/ADR-006-terminal-program-identity.md).

`LC_CTYPE=UTF-8` n'est défini que sur **macOS**. Une application graphique
lancée depuis le Dock ou Spotlight n'y hérite presque d'aucun environnement ;
sans cette variable, le shell revient à la locale C et les outils affichent `?`
pour le texte CJK. Le nom seul `UTF-8` est une locale sur macOS mais *n'en est
pas une* sur Linux ; la définir là-bas remplacerait une locale héritée
parfaitement valide par une locale invalide — chaque programme qui appelle
`setlocale()` s'en plaindrait. Sur Linux et Windows, les `LANG` / `LC_*` de
votre session de bureau sont hérités sans modification.

VMark ne définit délibérément **pas** `EDITOR`. C'est votre propre `$EDITOR` —
celui qu'exporte votre configuration shell — que `git commit`, `crontab -e` et
consorts lanceront. (VMark imposait auparavant `EDITOR=vmark`, mais la commande
`vmark` est facultative et rend la main immédiatement au lieu d'attendre que
vous fermiez l'onglet, si bien que `git commit` échouait soit avec « command not
found », soit avec un message de commit vide. Pour que cela fonctionne, il
faudrait un protocole bloquant `vmark --wait`, qui n'existe pas encore.)

Le terminal intégré hérite du `PATH` de votre shell de connexion, de sorte que les outils CLI comme `node`, `claude` et d'autres binaires installés par l'utilisateur sont accessibles — tout comme dans une fenêtre de terminal ordinaire.

Sauf si vous choisissez un shell dans les paramètres du terminal, VMark lance votre shell de connexion. Un shell que vous choisissez doit être l'un de ceux que VMark propose — sur macOS et Linux, un shell listé dans `/etc/shells` (ou votre shell de connexion) qui existe et est exécutable ; sous Windows, PowerShell, `pwsh`, `cmd.exe` ou `%COMSPEC%` — indiqué par un chemin absolu. Un choix enregistré qui n'est plus disponible apparaît comme *(indisponible)* dans les paramètres, et VMark lance alors votre shell par défaut. Sur macOS et Linux, il lit d'abord le shell de connexion dans l'entrée de votre compte utilisateur, puis `$SHELL`, et revient à `/bin/sh`. Sur Windows, il utilise `%COMSPEC%`, et revient au chemin complet de `cmd.exe`. Le répertoire de travail commence à la racine de l'espace de travail, ou au répertoire parent du fichier actif, ou `$HOME`.

Les raccourcis shell standard comme `Ctrl+R` (recherche d'historique inversée dans zsh/bash) fonctionnent lorsque le terminal est mis au point — ils ne sont pas interceptés par l'éditeur.

Lorsque la racine de l'espace de travail change alors que le terminal est déjà en cours d'exécution, les sessions inactives effectuent automatiquement `cd` vers la nouvelle racine. Une session occupée par une commande (par exemple `vim` ou `less`) n'est pas interrompue : elle change de répertoire une fois la commande terminée, ce qui nécessite l'[intégration du shell](#integration-du-shell) pour être détecté. Avec la [barre des espaces de travail](/fr/guide/workspace-rail) activée, les sessions qui appartiennent à un espace de travail conservent leur propre répertoire.

## Micro, caméra et Apple Events sur macOS

Les programmes que vous lancez dans le terminal intégré peuvent demander le micro, la caméra ou l'autorisation de contrôler d'autres apps (Apple Events, utilisés par `osascript`). macOS pose la question au nom de VMark, car il considère VMark comme l'app responsable de tout ce que le terminal lance. Autorisez l'accès lorsque macOS le demande ; vous pourrez le modifier plus tard dans **Réglages Système → Confidentialité et sécurité**, sous **Microphone**, **Caméra** ou **Automatisation**. La demande a lieu lorsqu'un programme utilise la ressource pour la première fois, pas à l'ouverture du terminal.

Si un programme enregistre du silence, capture une image noire ou signale une erreur « non autorisé » sans qu'aucune demande n'apparaisse, vérifiez que VMark figure dans la page de réglages correspondante et qu'il y est autorisé. Joignez la sortie du programme lorsque vous signalez le problème.

Pour les entrées audio virtuelles comme BlackHole, l'autorisation seule n'achemine pas le son. Choisissez l'entrée voulue dans votre outil d'enregistrement, acheminez-y le son et vérifiez un court enregistrement avant une longue session : un fichier audio qui grossit ne prouve pas à lui seul que du son a été capté. VMark n'inclut ni enregistreur ni outil de transcription ; ces commandes proviennent d'outils que vous installez séparément.

## Pas encore implémenté

Ces éléments sont suivis mais ne sont **pas** disponibles aujourd'hui. Ils sont
listés ici parce que des versions antérieures de cette page présentaient
certains d'entre eux comme s'ils existaient :

- **Mettre en pause / reprendre une session.** VMark peut suspendre un
  processus shell en interne — il le fait automatiquement, comme contrôle de
  flux, lorsque la sortie arrive plus vite que le terminal ne peut l'afficher —
  mais il n'existe aucun contrôle pour l'utilisateur, ni de menu contextuel
  d'onglet de session auquel en rattacher un.
- **Un `vmark --wait` bloquant** pour que `$EDITOR` puisse pointer vers VMark
  (voir [Environnement shell](#environnement-shell) ci-dessus).
- **La persistance de l'historique de défilement entre les redémarrages** (voir
  [Persistance](#persistance)).
- **L'intégration du shell fish** (voir [Intégration du shell](#integration-du-shell)).

## Paramètres

Ouvrez **Paramètres → Terminal** pour configurer :

| Paramètre | Plage | Par défaut | Plateformes |
|-----------|-------|------------|-------------|
| Taille du panneau | 10 % – 80 % de l'espace disponible, par pas de 5 % | 40 % | Toutes |
| Taille de police | 10 – 24 px | 13 px | Toutes |
| Interligne | 1.0 – 2.0 | 1.2 | Toutes |
| Copier à la sélection | Activé / Désactivé | Désactivé | Toutes |
| Afficher automatiquement les transcriptions | Activé / Désactivé | Désactivé | Toutes |
| Option comme touche Meta | Activé / Désactivé | Activé | macOS |
| Intégration du shell | Activé / Désactivé | Activé | macOS / Linux (zsh, bash) |
| Presse-papiers distant (OSC 52) | Activé / Désactivé | Activé | Toutes |
| Historique de défilement | 1 000 / 5 000 / 10 000 / 50 000 lignes | 5 000 | Toutes |
| Mode lecteur d'écran | Activé / Désactivé | Désactivé | Toutes |

### Afficher automatiquement les transcriptions

Activez **Afficher automatiquement les transcriptions** pour afficher le Markdown de l'assistant, des tableaux sélectionnables et des diagrammes Mermaid dans une section de transcription mise en forme, à l'intérieur de la zone du terminal. Elle se place à droite de la CLI lorsque le terminal est en haut ou en bas, et en dessous lorsque le terminal est à gauche ou à droite ; la CLI interactive reste utilisable à côté.

La section est d'abord repliée. Elle s'ouvre d'elle-même lorsqu'une nouvelle réponse contient un tableau ou un diagramme Mermaid — les réponses en texte brut, que le terminal affiche déjà bien, la laissent fermée. Cliquez sur le bouton graphique dans la barre d'onglets du terminal (info-bulle **Transcription mise en forme**) pour l'afficher ou la masquer à tout moment ; le bouton est mis en surbrillance tant que la transcription est affichée, et la masquer rend toute la zone à la CLI ; après l'avoir repliée, elle reste fermée jusqu'à la prochaine réponse contenant un tableau ou un diagramme. Le contenu déjà présent dans la transcription lorsque la session est affichée pour la première fois ne l'ouvre pas. Un terminal masqué cesse de lire les transcriptions.

L'activation ajoute un hook `SessionStart` local au `settings.json` de Claude Code et au `hooks.json` de Codex, en conservant les hooks existants. Après l'activation, démarrez ou reprenez Claude/Codex dans un terminal VMark ; redémarrez les sessions déjà en cours. Codex peut vous demander de faire confiance au nouveau hook lors de sa première exécution. Node et une version de la CLI prenant en charge les hooks de cycle de vie sont requis. Les hooks explicitement désactivés ou restreints par une stratégie, les sessions SSH distantes et les répertoires de configuration CLI personnalisés qui diffèrent de l'environnement de VMark ne peuvent pas établir de liaison.

Chaque terminal suit exactement sa propre session plutôt que la transcription modifiée le plus récemment. L'aperçu conserve jusqu'à 100 messages de l'assistant issus des 2 derniers MiB de données de transcription. Le HTML brut et les images distantes restent inertes ; les diagrammes non valides restent lisibles sous forme de source. La désactivation supprime la section mise en forme et désactive les hooks installés par VMark.

### Accessibilité

| Paramètre | Options | Par défaut |
|-----------|---------|------------|
| Cloche du terminal | Désactivée / Visuelle / Sonore | Visuelle |
| Contraste minimum | Désactivé / WCAG AA (4,5:1) / WCAG AAA (7:1) / Maximum | WCAG AA (4,5:1) |

La plupart des modifications s'appliquent immédiatement à toutes les sessions ouvertes — taille et position du panneau, taille de police, interligne, curseur, Copier à la sélection, Option comme touche Meta, Historique de défilement, Mode lecteur d'écran, Cloche du terminal et Contraste minimum. **Shell**, le **Rendu WebGL** (non disponible sous Linux), le **Presse-papiers distant** et l'**Intégration du shell** sont fixés au démarrage d'une session ; ils s'appliquent donc aux sessions ouvertes ensuite. **Taille du panneau** va jusqu'à 80 % de l'espace disponible. L'éditeur conserve une taille minimale en pixels, de sorte qu'il ne disparaît jamais entièrement, quelle que soit la taille du terminal. Double-cliquez sur la poignée de redimensionnement pour passer directement au maximum et revenir, sans modifier la taille enregistrée. **Option comme touche Meta** route la touche Option de macOS comme Meta dans le terminal intégré pour qu'emacs, tmux et les outils similaires voient les raccourcis préfixés par Alt (macOS uniquement) ; ce paramètre est activé par défaut, de sorte qu'Option+Flèche déplace le curseur par mot au lieu d'insérer des caractères accentués. **Intégration du shell** est disponible sur macOS et Linux (masqué sous Windows). **Presse-papiers distant** fonctionne en écriture seule (les lectures sont toujours refusées) et est décrit ci-dessous. **Historique de défilement** détermine le nombre de lignes de sortie que chaque session conserve dans son historique — des valeurs plus élevées consomment plus de mémoire. **Mode lecteur d'écran** expose la sortie du terminal aux technologies d'assistance comme VoiceOver ; il est désactivé par défaut pour des raisons de performance. **Cloche du terminal** choisit comment une cloche (BEL) est signalée — une marque visuelle d'activité en arrière-plan sur l'onglet de session, un léger bip sonore (qui signale aussi l'onglet d'une session en arrière-plan pour que vous la retrouviez), ou rien. **Contraste minimum** rehausse le texte pâle du terminal jusqu'à un rapport de contraste lisible par rapport à son arrière-plan ; augmentez-le pour l'accessibilité ou réglez-le sur Désactivé pour supprimer ce rehaussement.

::: tip Famille de police du terminal
Le terminal utilise la **Police mono** de **Paramètres → Éditeur**, et non une
police qui lui est propre ; la modifier là-bas change donc à la fois les blocs
de code, le mode Source et le terminal. Sous Linux, l'option Défaut système
suit la police à chasse fixe de votre bureau, celle qu'utilise votre terminal
système.
:::

::: tip Taille de police et zoom
La taille de police du terminal est délibérément indépendante de la taille de
lecture de l'éditeur : un terminal est une surface de surveillance dense, et sa
valeur par défaut de 13 px correspond à celle des terminaux autonomes plutôt
qu'aux 18 px de lecture par défaut. `Mod + =` / `Mod + -` zooment par pas de
2 px, si bien que la police du terminal peut atteindre une valeur absente de la
liste déroulante (13 → 15 → 17 …). La liste déroulante affiche la taille
réellement en vigueur, en ajoutant la valeur zoomée à la liste plutôt que de
vous ramener à une valeur prédéfinie.
:::

## Presse-papiers distant (OSC 52)

Copiez dans une session `ssh`, dans `tmux` ou dans un éditeur distant, et le
texte arrive dans **votre** presse-papiers — et non dans celui de la machine
distante. Les programmes le demandent en affichant une séquence d'échappement
OSC 52 ; VMark la redirige vers le presse-papiers du système.

```bash
# From anywhere the terminal can print — including over ssh:
printf '\e]52;c;%s\a' "$(printf 'hello' | base64)"
```

::: warning Écriture uniquement — les lectures sont toujours refusées
OSC 52 définit aussi un moyen de *lire* le presse-papiers, et VMark n'y répond
**jamais**, même avec ce paramètre activé. N'importe quel processus capable
d'afficher des octets dans votre terminal pourrait le demander — y compris
`cat` sur un fichier que vous n'avez pas écrit — et la réponse arriverait comme
si vous l'aviez tapée. iTerm2 et VS Code refusent pour la même raison. Le
paramètre contrôle les écritures ; les lectures sont refusées sans condition.
:::

Désactivez **Paramètres → Terminal → Presse-papiers distant** pour fermer
entièrement ce canal. La modification s'applique aux sessions nouvellement
lancées.

## Intégration du shell

Lorsque l'**Intégration du shell** est activée, VMark injecte des marqueurs de
commande légers dans le shell pour que le terminal sache où chaque commande
commence et se termine. Cela permet :

- **La navigation entre les invites** — `Cmd + ↑` / `Cmd + ↓` passe à l'invite
  de commande précédente / suivante dans l'historique de défilement.
- **Les indicateurs de code de sortie** — une fine barre dans la marge marque
  chaque ligne de commande en vert (succès) ou en rouge (échec).
- **Le suivi en direct du répertoire de travail** — les chemins de fichiers
  relatifs dans la sortie sont résolus par rapport au répertoire courant du
  shell, et les nouveaux terminaux s'y ouvrent.

**zsh** et **bash** sont pris en charge, sur macOS et Linux. Dans les deux cas,
l'injection est non destructive — votre vraie configuration est chargée en
premier, et les hooks de VMark sont ajoutés au lieu de la remplacer, de sorte
que votre invite, votre thème et vos alias restent intacts.

| Shell | Comment VMark s'y greffe | Ce qui est préservé |
|---|---|---|
| zsh | `ZDOTDIR` pointe vers un `.zshrc` généré qui charge le vôtre, puis enregistre les hooks avec `add-zsh-hook` | Un `$ZDOTDIR` personnalisé est respecté : VMark retrouve le vôtre depuis un shell de connexion et y charge `.zshenv` et `.zshrc`, et pas seulement depuis `$HOME` |
| bash | `bash --rcfile <generated>`, qui charge d'abord `~/.bashrc` | Un `PROMPT_COMMAND` et un piège `DEBUG` existants sont tous deux **combinés**, et non remplacés — `bash-preexec`, `direnv` et `atuin` continuent donc de fonctionner |

Comme le terminal exécute un shell interactif qui n'est pas un shell de
connexion, les fichiers réservés à la connexion (`.zprofile`, `.bash_profile`,
`.profile`) sont hors du champ d'application pour les deux shells, comme dans
un onglet de terminal ordinaire.

fish n'est pas encore intégré ; il fonctionne normalement, sans ces
fonctionnalités. Désactivez le paramètre pour supprimer entièrement
l'injection. Les modifications s'appliquent aux sessions nouvellement lancées
(redémarrez le terminal pour les appliquer).

## Persistance

L'état ouvert ou fermé du panneau de terminal est sauvegardé et restauré lors des redémarrages à chaud. Sa taille correspond au paramètre **Taille du panneau** — une proportion de la fenêtre que le glissement de la poignée de redimensionnement met à jour — elle est donc conservée avec vos paramètres et survit à chaque redémarrage, quel que soit le côté où se trouve le panneau. Les processus shell eux-mêmes ne peuvent pas être préservés — un nouveau shell est lancé pour chaque session au redémarrage. L'historique de défilement n'est pas non plus préservé : le restaurer impliquerait d'écrire sur le disque tout ce qui est passé par votre terminal (clés d'API comprises) ; il est donc délibérément réservé à une conception qui traite d'abord ce problème.
