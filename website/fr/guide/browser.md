# Navigateur intégré

VMark peut héberger un véritable navigateur web **à l'intérieur** d'une fenêtre de document — une page web devient un onglet de premier plan aux côtés de vos documents markdown. Il s'agit d'une véritable webview native (`WKWebView` sur macOS), pas d'une fenêtre Chrome externe ni d'un cadre intégré.

::: info macOS uniquement
Le navigateur intégré est disponible sur **macOS**, où il est activé par défaut. Il n'est pas disponible sur Windows ni sur Linux : sur ces plateformes, les paramètres ci-dessous et la commande **Nouvel onglet de navigateur** n'apparaissent pas du tout.
:::


::: info Rail des espaces de travail
Avec le [rail des espaces de travail](/fr/guide/workspace-rail) expérimental activé, les pages du navigateur sont **globales à la fenêtre** : elles restent accessibles depuis chaque espace de travail de la fenêtre et ne sont jamais rattachées aux onglets d'un seul espace de travail.
:::

## Le désactiver

Le navigateur est **activé par défaut** sur macOS. **Nouvel onglet de navigateur** se trouve dans le menu
**Fichier** (`Alt + Mod + Shift + B`) et dans la palette de commandes — rien n'a besoin
d'être activé au préalable.

Pour le désactiver, allez dans **Paramètres → Avancé** et désactivez
**Navigateur intégré**. Cela ferme tous les onglets de navigateur ouverts, révoque toutes les autorisations de site que l'IA
avait accumulées et retire la surface d'automatisation par l'IA décrite ci-dessous.

Deux paramètres de posture de l'IA se trouvent directement sous le commutateur et n'apparaissent que
lorsqu'il est activé. Tous deux sont prudents par défaut et ne changent pas du fait que le navigateur
est activé :

| Paramètre | Par défaut | Signification |
|---|---|---|
| **Session IA** | Sandbox | Les pages pilotées par l'IA obtiennent une session isolée plutôt que de partager celle où vous êtes connecté |
| **Autoriser le loopback** | Désactivé | La navigation de l'IA vers `localhost` / des adresses de réseau privé est refusée |

Les autorisations de site ne se trouvent pas dans les Paramètres — elles vivent dans la barre latérale du
navigateur, dans la fenêtre à laquelle elles appartiennent.

## L'utiliser

Un onglet de navigateur s'ouvre dans la zone d'édition, aux côtés de vos documents — la barre latérale, la bande d'onglets, le terminal et la barre d'état restent tous à leur place. Ses commandes se trouvent **au-dessus de la page** et partagent la barre de titre de la fenêtre, que VMark dessine lui-même.

| Commande | Action |
|---------|--------|
| ‹ / › | Précédent / suivant. Grisé lorsqu'il n'y a nulle part où aller |
| ⟳ / ✕ | Recharger, ou arrêter un chargement en cours |
| Barre d'adresse | Un **omnibox** : tapez une URL pour vous y rendre, ou n'importe quoi d'autre pour rechercher |
| ☆ / ★ | Ajouter cette page aux favoris |

Un nouvel onglet de navigateur s'ouvre sur DuckDuckGo (`https://duckduckgo.com`), et l'omnibox effectue ses recherches avec DuckDuckGo. Une saisie commençant par `http://` ou `https://` est ouverte telle quelle ; un nom d'hôte seul sans espace (`example.com`, `localhost:3000`, une adresse IPv4) est ouvert comme adresse web — en `http` pour les adresses locales, en `https` pour tout le reste ; tout le reste est recherché. Ni la page de démarrage ni le moteur de recherche ne peuvent encore être modifiés.

La barre d'adresse suit la page automatiquement : si un site redirige, ou si un lien vous emmène ailleurs, la barre se met à jour pour indiquer où vous vous trouvez réellement.

**Un onglet conserve sa page lorsque vous le quittez.** Consulter un document puis revenir ne recharge pas la page et ne perd pas ce que vous y aviez saisi — la page est seulement masquée, et elle n'est détruite que lorsque vous fermez son onglet. C'est aussi ce qui permet à une IA de continuer à travailler dans un onglet de navigateur pendant que vous écrivez (voir *Copilotage* ci-dessous).

Si une page tente d'ouvrir une fenêtre pop-up (`window.open`, un lien `target="_blank"`), VMark la bloque et affiche l'adresse bloquée en haut de la page avec un bouton **Ouvrir dans un nouvel onglet**, de sorte qu'une connexion qui exige une pop-up est à un clic de distance au lieu d'un clic qui ne fait rien.

## La barre latérale suit l'onglet

Lorsqu'un onglet de navigateur est actif, la barre latérale affiche l'**historique de navigation** et les **favoris**. Lorsque vous revenez à un document, elle affiche à nouveau l'explorateur de fichiers, le plan et l'historique du fichier — automatiquement. Il n'y a pas de second mode à maintenir synchronisé, et chaque côté se souvient de ce que vous aviez ouvert en dernier, de sorte qu'un coup d'œil à un onglet de navigateur ne vous coûte pas l'arborescence de fichiers que vous utilisiez.

L'**historique** est propre à chaque fenêtre et ne vit que le temps de la session : il n'est jamais écrit sur le disque. (Il existe tout de même un bouton **Effacer** — « il disparaît quand vous quittez » n'est pas la même chose que « vous pouvez vous en débarrasser maintenant ».) Un rechargement n'ajoute pas d'entrée en double, et un site qui vous redirige enregistre la page que vous *vouliez* visiter plutôt que chaque étape du parcours.

Les **favoris**, eux, persistent. Ils sont stockés sous l'URL exacte que vous avez mise en favori — même page, section différente (`#install` vs `#usage`) font deux favoris, et VMark ne va pas discrètement « nettoyer » les paramètres de requête d'une URL, car une URL réécrite pourrait ne pas vous ramener à ce que vous aviez vu.

## La fenêtre devient neutre autour d'une page

Les thèmes de VMark sont délibérément teintés — Paper est un gris chaud, Mint et Sepia le sont davantage. C'est agréable pour écrire, et inapproprié pour encadrer la page web de quelqu'un d'autre : un cadre coloré modifie la façon dont vous percevez chaque couleur à l'intérieur, ce qui explique pourquoi aucun vrai navigateur ne teinte sa propre interface.

Ainsi, lorsqu'un onglet de navigateur est au premier plan, la fenêtre environnante passe à un neutre uni — **blanc dans un thème clair, sombre dans un thème sombre** — et revient en arrière dès que vous retournez à un document. Votre thème est inchangé ; seul ce qui entoure une page web l'est.

**Le terminal suit la même règle.** Si un terminal est ouvert à côté d'un onglet de navigateur, il adopte le neutre correspondant plutôt que de conserver la couleur de votre thème, de sorte que les deux moitiés de la fenêtre s'accordent au lieu de se rencontrer sur une couture visible. Un thème sombre reçoit un terminal sombre, pas un terminal blanc — les couleurs d'un terminal sont réglées en fonction de son arrière-plan, et forcer le blanc rendrait la sortie d'un thème sombre difficile à lire.

### Si une page plante

Si le processus de contenu web d'une page meurt, l'onglet affiche une surcouche **« Cette page a planté. »** avec un bouton **Recharger** au lieu d'une vue blanche ou figée. VMark recharge automatiquement quelques fois en cas de plantages passagers ; si une page continue de planter au chargement, il s'arrête et attend que vous rechargiez manuellement, de sorte que vous ne restez jamais coincé dans une boucle de rechargement.

## Comment il est construit (et pourquoi il est privé par conception)

VMark crée lui-même la webview de la plateforme et l'ajoute comme enfant natif de la fenêtre — il n'en **demande pas** une au framework de l'application. C'est important pour la confidentialité : une webview créée par le framework injecterait un pont de messagerie interne dans chaque page, offrant à n'importe quel site un canal vers l'application. Comme VMark possède une webview fraîchement construite dépourvue d'un tel pont, **une page consultée n'a aucun canal vers VMark**. La page est pilotée de manière strictement unidirectionnelle (l'application peut lire et agir sur la page ; la page ne peut pas répondre en retour).

Les sessions (connexions, cookies) persistent par profil dans le magasin de données propre à la webview du système, de sorte que vous vous connectez à chaque site une seule fois. Sous macOS 14 et versions ultérieures, votre propre navigation utilise un magasin persistant réservé à VMark, distinct des webviews des autres applications. Sous macOS 13 et versions antérieures, macOS ne propose pas de magasin par application : votre navigation (et une IA qui partage votre session) utilise donc le magasin de webview par défaut du système. Un profil d'IA nommé y dispose toujours de son propre magasin non persistant, ce qui le garde séparé de vos connexions, mais ses sessions ne sont pas conservées. VMark ne tient aucun magasin de mots de passe ni de cookies qui lui soit propre ; la seule exception est une session dont vous approuvez explicitement l'enregistrement pour une IA (voir *Enregistrer / restaurer une session* ci-dessous), dont les cookies et le `localStorage` vont dans le **keychain du système**, jamais dans un fichier.

## Piloter le navigateur avec l'IA

Un assistant IA connecté via [MCP](./mcp-tools) peut opérer l'onglet de navigateur :

- **Lire** — obtenir un instantané d'accessibilité structuré de la page (chaque élément interactif ou structurel sous forme de rôle + nom accessible, plus un identifiant **ref** stable comme `e5`). L'instantané parcourt les shadow roots ouvertes et indique honnêtement ce qu'il n'a pas pu atteindre (shadow roots fermées, frames) et s'il a été tronqué par ses limites de taille.
- **Agir** — cliquer sur une cible ou y saisir du texte, soit par son **ref** précis issu d'une lecture antérieure, soit par son **rôle + nom accessible** ARIA (par exemple, cliquer sur le lien nommé « Learn more »). Un ref n'est honoré que pour une action déjà accordée ; tout ce qui nécessite votre autorisation utilise le rôle + le nom, afin que l'invite puisse vous présenter un élément lisible. Un clic **vérifie qu'il a réellement abouti** : il fait défiler la cible jusqu'à la vue, exige qu'elle soit rendue visiblement — un bouton en double à l'intérieur d'une section repliée est ignoré, pas cliqué — et teste par collision le point de clic, de sorte qu'une cible recouverte par une surcouche est signalée comme « recouverte par… » plutôt que cliquée à travers. Lorsque plusieurs éléments visibles partagent le même rôle et le même nom, le clic est **refusé comme ambigu** plutôt que résolu par celui qui apparaît en premier dans la page — une page ne peut pas glisser son propre lien « Learn more » devant celui du site. L'IA est informée de ce qui s'est *passé*, et pas seulement qu'elle a essayé, de sorte qu'elle ne peut pas agir discrètement sur le mauvais élément et signaler un succès. Les champs de fichier ne sont jamais cliqués.
- **Défiler** — amener un élément (par ref) dans la vue, ou faire défiler d'un nombre de pixels. Classe Action (soumise à autorisation comme Cliquer) ; l'autorisation lie exactement le défilement demandé.
- **Touche** — envoyer une frappe de touche (`Enter`, `Escape`, `Tab`, les flèches, avec Ctrl/Shift/Alt/Meta en option) à un élément ayant le focus ou à un ref — par exemple, soumettre un formulaire ou fermer une boîte de dialogue. Classe Action, et l'autorisation lie exactement la touche et les modificateurs. Enter dans un formulaire le soumet et Tab déplace le focus, comme le ferait une vraie saisie ; les autres touches sont des événements DOM **synthétiques**, de sorte qu'un site qui ne fait confiance qu'à une véritable entrée matérielle peut les ignorer.
- **Interroger** — détection structurée du DOM que l'instantané d'accessibilité ne peut pas nommer (tableaux, valeurs calculées, attributs) par sélecteur CSS. Classe Lecture.
- **Extraire** — la page en Markdown mode lecture (titre, signature, prose de l'article, éléments superflus retirés), pour les pages que l'IA souhaite *lire* plutôt qu'opérer. Des plugins de site affinent l'extraction selon l'origine — le plugin Wikipedia intégré retire l'habillage wiki par son nom — avec un lecteur générique comme solution de repli. La page n'exporte que des octets ; l'extraction s'exécute dans VMark. Classe Lecture.
- **Style** — manipulation CSS (écarter une surcouche bloquante, mettre une cible en évidence) en définissant des styles en ligne, en basculant des classes ou en injectant un bloc `<style>` (à l'échelle de la page, non limité à un sélecteur). Classe Action, et l'autorisation lie le style exact — il ne peut pas être remplacé par un autre CSS une fois que vous l'avez autorisé.
- **Exécuter du JS** — la trappe de secours : exécuter un script pour ce que les verbes structurés ne peuvent pas exprimer. Il s'exécute dans le **monde de contenu isolé** (DOM + CSS, **jamais** le JavaScript propre à la page), est autorisé **par appel** (jamais mémorisé — il n'y a pas d'« Autoriser sur ce site » pour lui), et son résultat est considéré comme **non fiable**. L'invite d'autorisation vous montre le **script exact**, et c'est ce script qui s'exécute — l'IA ne peut pas vous faire autoriser un script puis en exécuter un autre. Préférez Interroger/Style ; ne recourez à ceci que lorsqu'ils sont insuffisants.
- **Enregistrer / restaurer une session** — enregistrer la session actuelle de l'onglet sous un **handle** (un nom que vous approuvez), puis la restaurer plus tard afin qu'un flux démarre déjà connecté — *sans que l'IA ne voie jamais vos cookies ni vos jetons*. Les valeurs sont stockées dans le **keychain du système** (chiffrées au repos), et l'IA ne reçoit que le handle et un décompte récapitulatif. L'enregistrement et la restauration sont tous deux **autorisés par appel**, et une autorisation pour un handle ne peut pas être utilisée pour un autre. Une restauration ne s'applique qu'à une page de la **même origine** que celle où elle a été enregistrée. Il s'agit d'un identifiant **par référence** : l'IA nomme une session, VMark détient le secret.
- **Console** — lire la sortie `console.*` capturée de la page (log/warn/error…), **ainsi que les erreurs non interceptées et les rejets de promesses non gérés** — le signal qu'une page émet lorsque son propre script se casse, que la journalisation `console` ordinaire ne montre jamais — afin que l'IA puisse déboguer une page qu'elle pilote. En lecture seule, uniquement sur les onglets appartenant à l'IA (vos propres onglets ne portent aucun shim de capture), et la sortie est traitée comme des données de page **non fiables**. Cela est conçu pour préserver la garantie de confidentialité par conception : la capture écrit dans le DOM propre de la page et VMark la lit depuis là, de sorte qu'aucun canal de messagerie n'est ouvert en retour vers l'application.

::: tip Enregistrer/restaurer une session — portée
Une session enregistrée couvre **`localStorage` et les cookies**, tous deux limités à l'origine à laquelle la
page était rattachée lorsque vous l'avez enregistrée. Les cookies sont lus et rejoués via le
magasin de cookies natif et sont **limités au domaine dans les deux sens** — l'enregistrement ne copie jamais
l'intégralité de votre pot de cookies, et la restauration ne dépose jamais de cookie sous un site sans rapport.
:::
- **Ouvrir** — créer un onglet appartenant à l'IA, l'amener au premier plan et charger une URL HTTP(S). Au plus huit onglets appartenant à l'IA peuvent être ouverts à la fois, et l'IA **ferme** ses propres onglets lorsqu'elle a terminé (la fermeture n'est jamais soumise à autorisation — s'arrêter est toujours permis). L'onglet peut éventuellement s'ouvrir sur un **profil nommé**, un contexte persistant permettant de réutiliser une connexion par son nom ; en ouvrir un vous redemande à chaque fois, et l'IA ne voit jamais les identifiants.
- **Naviguer** — naviguer avec un onglet appartenant à l'IA (en l'amenant au premier plan) et attendre son ticket de navigation. Lorsque la page qui se charge se lit comme une **barrière** plutôt que comme le contenu demandé — un mur de connexion, une page de consentement intercalée, un défi de vérification humaine (reCAPTCHA/Turnstile) ou un avis de limitation de débit — le résultat l'indique, et l'IA reçoit l'instruction de **vous impliquer** plutôt que de tenter de le contourner. La détection privilégie la précision : un prix qui mentionne « 429 $ » ou un pied de page qui dit « Cloudflare » ne la déclenche pas.
- **Attendre** — attendre un ticket de navigation spécifique sans démarrer un autre chargement.
- **Attendre une condition** — interroger de façon répétée jusqu'à ce qu'une condition soit remplie (un élément par ref ou rôle + nom, un fragment de texte visible, ou l'**URL de l'onglet contenant** une sous-chaîne — cette dernière confirme qu'une navigation déclenchée par un clic a abouti ; la chaîne de requête et le fragment ne sont jamais comparés, car un jeton qu'une redirection y aurait placé ne doit pas pouvoir être sondé) ou qu'un délai s'écoule, en indiquant si elle a correspondu. Rend un flux à plusieurs étapes déterministe — agir, puis attendre le résultat, puis lire — au lieu de deviner. Ni *Attendre* ni *Attendre une condition* ne change l'onglet que vous regardez.
- **Capture d'écran** — obtenir une image JPEG du rendu actuel de la page, afin que l'IA puisse voir la mise en page et l'état rendu que l'instantané d'accessibilité ne nomme pas. Comme *Lire*, elle ne modifie rien : autorisée sur un onglet appartenant à l'IA, et sur un onglet humain uniquement tant que vous l'y avez rattachée. Un onglet qui n'est pas la page visible peut s'afficher vide.
- **Exécuter un workflow** — rejouer une courte séquence d'étapes enregistrée (click / type / navigate / extract, écrite dans une petite grammaire textuelle et transmise via `source`) comme une seule **exécution asynchrone** : elle renvoie immédiatement un identifiant d'exécution et vous en interrogez l'état, car une exécution à plusieurs étapes survit à une seule requête. Chaque étape qu'elle contient est **soumise individuellement à autorisation**, exactement comme une action émise à la main — un workflow n'est pas un moyen de contourner les invites — et les étapes que l'IA ne peut pas exécuter de façon déterministe (un « goal » en prose libre, un « confirm ») mettent l'exécution en pause pour que l'IA les traite à la main. Pour continuer après une pause, l'étape en pause est effectuée à la main et une nouvelle exécution **reprend** à partir de celle mise en pause : elle hérite des étapes terminées et considère l'étape en pause comme faite, de sorte que rien n'est soumis deux fois ; une réexécution du même workflow avec les mêmes entrées ignore aussi les étapes d'écriture déjà réussies. Les exécutions sont bornées (seul le temps d'exécution compte — le temps passé à vous attendre n'est pas décompté), se déroulent une à la fois par onglet, et peuvent être annulées — l'annulation est toujours autorisée, même pendant qu'une étape attend votre autorisation, et reprendre vous-même le contrôle du navigateur arrête l'exécution.
- **Enregistrer un workflow** — au lieu d'écrire la grammaire à la main, vous pouvez en **enregistrer** un : avec votre autorisation (redemandée à chaque fois — l'enregistrement n'est jamais une permission permanente), VMark capture les **clics et saisies de champ** que vous effectuez sur l'onglet et vous renvoie un texte de workflow prêt à exécuter. Il est **sans valeurs par construction** : rien de ce que vous saisissez n'est enregistré — chaque champ devient un `{input}` nommé que vous renseignez au moment de la relecture, un champ de mot de passe devient une étape manuelle `confirm:`, et les URL sont réduites à l'origine + le chemin. Il enregistre *quels* contrôles vous avez touchés, jamais *ce que* vous avez saisi.

La posture de l'IA pour le navigateur se configure sous **Paramètres → Avancé** :

- **Sandbox** (recommandé) utilise un seul magasin de webview IA partagé et non persistant. Il partage
  les cookies avec les autres onglets sandbox, mais pas avec les onglets humains.
- **Profil partagé** utilise le magasin de webview humain et demande l'autorisation de destination avant
  chaque navigation de l'IA, sauf si cette origine dispose d'une autorisation `navigate` correspondante.

Les onglets créés par l'IA sont transitoires et ne sont pas restaurés après un redémarrage. Leurs URL, mode, titre,
génération et état de chargement apparaissent dans `session.get_state` ; les identifiants sont expurgés des
réponses MCP.

Les actions sont **soumises à autorisation** : une opération que vous n'avez pas autorisée n'est pas effectuée — l'IA est informée qu'une autorisation est requise et attend. Les téléversements de fichiers ne sont **jamais** permis à l'IA (un téléversement de fichier choisi par l'IA serait une voie d'exfiltration de données) ; ceux-ci restent strictement pilotés par l'humain.

### Autoriser une action

Lorsque l'IA demande à agir, VMark affiche une invite et met la page en pause. Elle vous indique le **site**, l'**action** et l'**élément** (son rôle et son nom accessible, par ex. `button "Publish"`) — et, pour une action qui transporte du contenu, ce contenu lui-même : le texte qu'un *Saisir* entrera, la touche qu'un *Touche* pressera, le script exact qu'un *Exécuter un script* ou un *Style* exécutera. C'est ce que l'autorisation lie ; une nouvelle tentative avec un contenu différent redemande.

- **Autoriser une fois** — autorise exactement cette action, sur cet élément, sur cette page. Elle est consommée immédiatement et ne devient pas une autorisation permanente.
- **Autoriser sur ce site** — l'IA peut effectuer *cette opération* sur *ce site* sans redemander. Cela ne s'étend pas à d'autres opérations ni à d'autres sites.
- **Refuser** — rien ne se passe. Appuyer sur `Escape`, ou simplement sur `Enter`, refuse également : l'invite est délibérément biaisée en faveur du refus. Un **Autoriser** dans la première demi-seconde après l'apparition d'une invite est ignoré, et un appui doit commencer et se terminer sur la même invite — ainsi, une invite retirée sous votre doigt ne peut pas transmettre votre clic à la suivante.

L'invite vous montre une **description de l'action, pas une image de la page** — et c'est intentionnel. Une page web contrôle ses propres pixels, de sorte qu'une page hostile pourrait styliser un bouton « Tout supprimer » pour qu'il ressemble à « Publier ». Ce que VMark vous montre, c'est exactement ce que la barrière de sécurité applique, tiré du moteur du navigateur plutôt que des affirmations que la page fait sur elle-même.

L'autorisation **expire également lorsque la page navigue**. Une invite décrit une action sur une page *spécifique* ; si la page change pendant que vous décidez, la demande est abandonnée plutôt qu'appliquée à ce qui s'est chargé à la place. Une « Autoriser une fois » non consommée est écartée de la même manière.

Cela inclut la navigation *à l'intérieur* d'une page. La plupart des sites modernes passent d'une vue à l'autre sans jamais charger de nouvelle page — l'adresse change, le contenu est réécrit, mais le site ne quitte jamais. Cela compte ici, car le site et l'origine restent les mêmes tandis que le `button "Publish"` que vous avez autorisé n'est peut-être plus le bouton portant ce nom. VMark traite donc une navigation intra-page exactement comme n'importe quelle autre : l'autorisation expire avec la **vue** pour laquelle elle a été accordée, et pas seulement avec la page.

Ce qui porte le poids, cependant, c'est le descripteur lui-même. Un site peut réécrire son propre contenu à tout moment sans naviguer du tout, et aucun moteur de navigateur ne le signale. Ainsi, ce qu'une « Autoriser une fois » autorise, c'est précisément une opération, sur un élément identifié par son rôle et son nom accessible, sur un site — et elle est consommée immédiatement. C'est « Autoriser sur ce site » qui mérite qu'on y réfléchisse à deux fois : c'est une autorisation permanente pour cette opération sur ce site, et un site auquel vous l'accordez est un site auquel vous faites confiance pour cela.

### Examiner et révoquer les autorisations

La **barre latérale du navigateur** (dans la fenêtre à laquelle elles appartiennent) répertorie chaque site auquel vous avez accordé une autorisation, et ce qu'il peut faire. **Révoquer** la reprend immédiatement — la prochaine action de l'IA sur ce site redemandera. Les autorisations appartiennent à la fenêtre dans laquelle elles ont été accordées.

Les autorisations de site ne sont conservées qu'en mémoire : elles ne sont **jamais écrites sur le disque**, elles expirent lorsque VMark se ferme, et désactiver le navigateur les révoque toutes. Laisser une IA conserver la capacité de cliquer sur un site d'un redémarrage à l'autre est une promesse plus grande qu'il n'y paraît, alors VMark ne la fait pas en silence.

Lorsqu'une IA cible un onglet créé par un humain, VMark demande d'abord s'il faut y attacher l'accès de l'IA.
L'attachement est lié à la génération de navigation actuelle. **Autoriser une fois** est
consommée par la première lecture ou action que le moteur du navigateur autorise (un clic qui s'avère ensuite
recouvert ou masqué la consomme quand même) ; **Autoriser jusqu'à la navigation** expire à la prochaine
navigation complète ou intra-page, fermeture, désactivation ou redémarrage. Tant que vous n'avez pas attaché un onglet, l'IA
n'en voit que l'origine — ni son titre ni son chemin. Si l'attachement échoue (le pilote a refusé, ou la page a changé
pendant que vous décidiez), l'invite reste ouverte et l'indique ; vous pouvez réessayer ou refuser.

La navigation de l'IA rejette par défaut les cibles loopback, réseau local privé, lien-local, métadonnées, malformées et
à schéma non pris en charge, et sur les onglets appartenant à l'IA une liste de règles de contenu applique
le même refus à ce qu'une page intègre — frames, images, scripts, requêtes fetch — de sorte qu'une page publique
ne peut pas utiliser l'onglet de l'IA pour atteindre votre réseau. Avant qu'un `open` ou un `navigate` initié par l'IA
ne soit émis, VMark résout aussi le nom d'hôte de la destination et refuse la navigation
(`SSRF_BLOCKED`, `reason: resolves-private`) lorsqu'une des réponses est l'une de ces adresses bloquées, ou
(`reason: unresolved`) lorsque le nom ne se résout pas dans un délai borné — un nom d'apparence publique qui pointe
vers votre réseau local ou un service de métadonnées cloud est intercepté avant que WebKit n'envoie de requête. Deux limites
subsistent, énoncées clairement : la vérification préalable couvre les navigations émises par l'IA, pas les cibles de redirection,
les clics sur des liens dans la page ni ce qu'une page intègre (ceux-ci restent des vérifications du texte de l'URL, plus la liste
de règles de contenu pour les adresses privées littérales), et une réponse DNS qui change après la vérification préalable
(rebinding) n'est pas revérifiée, car WKWebView n'expose aucun point d'accroche par requête pour l'adresse
qu'une connexion utilise réellement.

## Copilotage : observer une IA piloter le navigateur depuis le terminal

Le navigateur est un panneau, pas un mode. Cela rend un workflow particulier possible : ouvrez un **terminal** (`Ctrl + \``) à côté d'un onglet de navigateur, exécutez-y un agent IA, et observez la page réagir au fur et à mesure qu'il travaille.

Le terminal et le navigateur sont **côte à côte** — le navigateur se redimensionne pour faire de la place plutôt que d'être recouvert. Vous voyez donc la page pendant tout le temps où l'agent opère dessus, et chaque action qu'il entreprend doit toujours passer par vous (voir *Autoriser une action* ci-dessus).

C'est la forme voulue de l'utilisation du navigateur par l'IA dans VMark : l'agent propose, la page est visible, et vous approuvez. Ce n'est pas l'agent travaillant dans une fenêtre que vous ne pouvez pas voir.

**Reprendre le contrôle tient en un seul geste.** Pendant qu'une exécution de workflow IA pilote un onglet, sa barre d'outils affiche un indicateur **« L'IA contrôle — cliquez pour reprendre la main »**. Cliquer dessus — ou simplement interagir vous-même avec la page ou sa barre d'adresse — reprend l'onglet immédiatement et arrête l'exécution. Vous n'avez jamais à chercher un bouton d'arrêt dans le terminal de l'agent ; toucher le navigateur, c'est le bouton d'arrêt.

## Lorsqu'une page ne parvient pas à se charger

Un réseau hors ligne, un nom d'hôte incorrect, un certificat rejeté ou une connexion refusée
produisent tous un message dans le panneau du navigateur indiquant ce qui n'a pas fonctionné, avec un bouton **Réessayer**, de sorte qu'un chargement échoué ne ressemble jamais à une
page simplement lente.

## Limitations actuelles

- macOS uniquement dans cette version.
- Les boîtes de dialogue JavaScript `alert()` et `confirm()` sont affichées et c'est vous qui y répondez ; `prompt()` est supprimé pour l'instant. Les pop-ups (`window.open`) sont bloquées, et l'adresse bloquée vous est proposée dans un nouvel onglet.
- Une page protégée par l'authentification HTTP basique ne se charge pas — il n'y a pas encore d'invite de nom d'utilisateur et de mot de passe.
- La recherche dans la page et le zoom de la page ne sont pas implémentés.
- VMark ne décide pas encore lui-même des demandes d'accès à la caméra, au microphone, à la localisation ou aux notifications ; c'est le traitement par défaut de la webview du système qui s'applique.
- Les téléchargements, l'impression et la politique réseau par requête ne sont pas encore implémentés. Le survol et le glisser-déposer n'ont pas encore de verbe pour l'IA.

Ces éléments sont ajoutés progressivement ; la page ci-dessus décrit ce qui fonctionne aujourd'hui.
