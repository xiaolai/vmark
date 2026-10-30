# Base de connaissances et Slidev

VMark peut servir l'ensemble de votre espace de travail sous la forme d'une base
de connaissances navigable et interconnectée, et prévisualiser/exporter des
présentations [Slidev](https://sli.dev) — le tout grâce à un unique serveur de
contenu local que VMark démarre à la demande.

::: warning État
Cette fonctionnalité est déployée par étapes, et **aucune version publiée, sur
aucune plateforme, n'inclut l'environnement d'exécution du serveur de contenu**
dont elle dépend — voir [Prérequis](#prerequis). C'est pourquoi elle est
**masquée tant que le mode développeur n'est pas activé** : l'élément du menu
Affichage, l'entrée de la palette de commandes et le raccourci `Ctrl + Shift + 4`
n'apparaissent qu'une fois **Paramètres → Avancé → Outils de développement**
activé. Activez-le, puis ouvrez le panneau **Base de connaissances** pour voir ce
dont dispose votre machine et ce qui lui manque.
:::

## Prérequis

La base de connaissances, son graphe de relations, la recherche, le
rechargement en direct et l'aperçu Slidev reposent tous sur un même serveur de
contenu local — un programme Node.js distinct que VMark démarre à la demande.
Deux éléments doivent être présents pour qu'il puisse démarrer :

- **Node.js.** VMark résout `node` via le `PATH` de votre shell de connexion,
  comme le ferait un terminal ; un Node.js visible uniquement par un outil
  propre à un projet ne compte donc pas. Installez-le de sorte que `node` figure
  dans le `PATH` de votre shell de connexion.
- **Le serveur de contenu lui-même** (`server/content` dans le dépôt VMark,
  compilé en un fichier `cli.js`). **Aucune version empaquetée de VMark ne
  l'inclut encore — sur aucune plateforme.** Il ne s'agit pas d'une lacune
  propre à Linux ou Windows : le DMG macOS n'embarque pas non plus
  d'environnement d'exécution pour le serveur de contenu, et les vérifications
  de publication de VMark le confirment à chaque version. Tant qu'aucune
  solution de distribution n'existe, la fonctionnalité nécessite un
  environnement de développement — une copie de travail de VMark avec le
  serveur de contenu compilé, rendue accessible via la variable d'environnement
  `VMARK_CONTENT_SERVER_CLI` (ou un environnement `base-kb` que vous placez à la main dans
  les données d'application de VMark ; VMark n'en télécharge jamais).

Le panneau vérifie ces deux éléments à son ouverture. Lorsque l'un d'eux
manque, il indique lequel, et ce qui permettrait de le fournir, au lieu de
tenter un démarrage voué à l'échec.

## Ouvrir le panneau

La base de connaissances est **masquée par défaut**, car une version publiée ne
peut pas la démarrer. Pour l'afficher, activez **Paramètres → Avancé → Outils de
développement**. L'élément de menu **Affichage → Afficher/masquer la base de
connaissances**, l'entrée de la palette de commandes (« Afficher/masquer la base
de connaissances ») et le raccourci `Ctrl + Shift + 4` apparaissent alors tous
ensemble, et disparaissent de nouveau lorsque vous le désactivez.

Une fois les outils de développement activés, ouvrez le panneau depuis
**Affichage → Afficher/masquer la base de connaissances**, la palette de
commandes ou `Ctrl + Shift + 4`. Le panneau s'ancre à droite ; basculez-le de
nouveau pour le masquer.

Désactiver les outils de développement masque de nouveau les points d'accès, et
ferme le panneau avec eux : le panneau n'a pas de bouton de fermeture propre,
et le laisser ouvert laisserait un volet que rien ne pourrait fermer. Un serveur
déjà **en cours d'exécution** n'est pas touché — réactivez les outils de
développement pour atteindre son bouton Arrêter ; de toute façon, VMark arrête
ses serveurs de contenu lorsqu'il quitte.

## Base de connaissances

Ouvrez un espace de travail et démarrez le panneau **Base de connaissances**.
VMark lance un serveur local lié à `127.0.0.1` (boucle locale uniquement) et
affiche chaque fichier markdown en HTML avec la même sémantique markdown que
l'éditeur — liens wiki, alertes, mathématiques, tableaux, listes de tâches et
blocs details s'affichent à l'identique.

Fonctionnalités :

- **Navigation par liens wiki** — `[[Page]]`, `[[dir/Page]]`, `[[Page#Heading]]`
  et `[[Page|Alias]]` sont résolus dans tout l'espace de travail. Les liens non
  résolus s'affichent comme « manquants » afin que les lacunes soient visibles.
- **Graphe de relations** — les notes, les étiquettes (`#tag` et `tags:` dans le
  frontmatter) et les relations typées du frontmatter (`up`, `related`,
  `links`, …) forment un graphe interactif avec rétroliens.
- **Recherche plein texte** dans tout l'espace de travail.
- **Rechargement en direct** — les modifications enregistrées actualisent
  automatiquement les pages servies.

Vous pouvez consulter la base de connaissances dans VMark (panneau intégré) ou
**l'ouvrir dans votre navigateur** — l'action « Ouvrir dans le navigateur »
effectue une poignée de main authentifiée à usage unique afin que votre
navigateur reçoive un cookie de session. Le serveur n'écoute que sur la boucle
locale et est protégé par cookie ; il n'expose jamais votre espace de travail
au-delà de votre machine.

## Présentations Slidev

Lorsque vous ouvrez un fichier markdown dont le frontmatter l'identifie comme
une présentation Slidev (par ex. `theme:`, `layout:` + diapositives, ou un
`format: slidev` explicite), VMark peut exécuter la véritable chaîne d'outils
Slidev pour la prévisualiser en direct — le même moteur de rendu que Slidev, de
sorte que les mises en page, les animations au clic et les composants sont
fidèlement restitués.

Avec la présentation ouverte et le panneau Base de connaissances en cours
d'exécution, utilisez **Aperçu des diapositives** pour ouvrir la présentation en
direct dans votre navigateur et **Exporter les diapositives** pour en produire
le rendu. Slidev surveille la présentation sur le disque : enregistrer des
modifications dans VMark recharge à chaud l'aperçu ouvert.

### Exportation

Les présentations Slidev s'exportent en **PDF**, **PNG** ou **PPTX**. Le
serveur de contenu exécute la commande `slidev export` de Slidev, qui produit
le rendu des diapositives dans Chromium via le paquet `playwright-chromium`.
VMark ne télécharge ni ne localise de navigateur pour cela : si
`playwright-chromium` n'est pas installé à côté de Slidev dans l'environnement
d'exécution du serveur de contenu, l'exportation échoue et affiche le message
d'erreur de Slidev. Une exportation qui dure plus de trois minutes est
interrompue.

**Exporter les diapositives** demande où enregistrer via le panneau
d'enregistrement natif de VMark, et l'exportation n'écrit qu'au chemin choisi
là ; l'extension du fichier doit correspondre au format (`.pdf`, `.png`, `.pptx`).

## Confidentialité et sécurité

- Le serveur écoute uniquement sur `127.0.0.1` et exige un jeton par session
  (transmis sous forme de cookie HttpOnly, SameSite=Strict).
- L'accès aux fichiers est limité à la racine de l'espace de travail ; la
  traversée de chemins est rejetée et les liens symboliques ne sont pas suivis.
- Le HTML rendu est assaini et servi avec une politique de sécurité du contenu.
  **La confiance accordée à l'espace de travail ne change ici qu'une seule
  chose : l'affichage ou non des images distantes.** VMark transmet le niveau
  de confiance de l'espace de travail au serveur lorsqu'il le démarre ; pour un
  espace de travail approuvé, la politique assouplit `img-src` afin que les
  images `https:` se chargent, tandis que pour un espace de travail non approuvé
  seules les images locales et intégrées s'affichent. La confiance ne détermine
  pas si un espace de travail est servi — n'importe quel espace de travail
  ouvert peut l'être. Modifier la confiance d'un espace de travail pendant que
  sa base de connaissances est en cours d'exécution redémarre le serveur, afin
  que la politique suive le changement.
