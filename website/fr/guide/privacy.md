# Confidentialité

VMark est un éditeur local d'abord : vos documents sont des fichiers sur votre disque, le rendu se fait sur votre machine, et il n'y a ni compte, ni télémétrie, ni rapport de plantage. Cette page liste chacune des façons dont VMark accède au réseau, ce que chacune envoie et comment la désactiver — ainsi que ce que VMark est autorisé à lire sur votre disque.

## Chaque connexion réseau établie par VMark

| Quand | Destination | Ce qui est envoyé | Comment l'arrêter |
|-------|-------------|-------------------|-------------------|
| Vérification des mises à jour — au lancement par défaut | `log.vmark.app`, puis GitHub Releases en solution de repli | Plateforme, architecture, version de l'app et un hash de machine anonyme — [détails ci-dessous](#la-verification-des-mises-a-jour-en-detail) | **Paramètres → À propos → Fréquence de vérification → Manuelle uniquement**, ou bloquer `log.vmark.app` |
| Exécution d'un génie IA avec un **fournisseur REST** | L'endpoint que vous avez configuré — Anthropic, OpenAI, un hôte compatible OpenAI, Google AI ou votre hôte Ollama | L'invite remplie : le texte, le bloc ou le document sélectionné, plus tout contexte environnant demandé par le génie, et votre clé API. Les boutons **Tester** et d'actualisation des modèles contactent aussi l'endpoint | Ne configurer aucun fournisseur, ou utiliser un Ollama local |
| Exécution d'un génie IA avec un **fournisseur CLI** | Rien de la part de VMark lui-même — le CLI `claude`, `codex` ou `gemini` que vous avez installé communique avec son propre éditeur, sous son propre compte | VMark transmet l'invite au CLI sur votre machine | Comme ci-dessus |
| Export HTML | jsDelivr (cdnjs en solution de repli) et Google Fonts | Rien — téléchargements uniquement : les polices mathématiques KaTeX lorsque le document contient des maths, et toute police web choisie dans les Paramètres, afin de pouvoir les intégrer | Exporter sans connexion ; l'export se rabat sur les polices système |
| Ouverture d'un `index.html` exporté | jsDelivr | Rien — télécharge la feuille de style KaTeX pour les documents contenant des maths | Utiliser `standalone.html`, qui l'intègre |
| Édition d'un workflow GitHub Actions | `raw.githubusercontent.com` | Le `owner/repo@ref` de chaque étape `uses:`, pour récupérer son `action.yml` (mis en cache 24 h) | Désactiver **Paramètres → Avancé → Récupérer les métadonnées des actions** |
| Le navigateur intégré | Le site que vous ouvrez — ou qu'un assistant IA ouvre avec votre autorisation | C'est un navigateur web ; voir le [guide du navigateur](/fr/guide/browser) pour la posture de l'IA, les sessions isolées et la politique de destination | Désactiver **Paramètres → Avancé → Navigateur intégré** |
| Documents qui référencent le web | Les hôtes nommés dans votre document | Les images distantes et les embeds YouTube / Vimeo / Bilibili se chargent depuis leurs hôtes lors du rendu dans l'éditeur ou dans le HTML exporté | Garder les images en local |

Deux éléments qui ressemblent à des services réseau sont limités au loopback et ne quittent jamais votre machine :

- **Le serveur MCP** — les assistants IA se connectent via un pont WebSocket lié à `127.0.0.1`, authentifié par un jeton que VMark conserve dans son répertoire de données d'application. L'assistant lui-même (Claude Desktop, Claude Code, Codex CLI…) communique avec son propre éditeur ; VMark se contente de répondre à ses appels d'outils. Voir [Intégration IA](/fr/guide/mcp-setup).
- **La base de connaissances et l'aperçu Slidev** — un serveur local lié à `127.0.0.1` avec un jeton par session ; le [guide de la base de connaissances](/fr/guide/knowledge-base#confidentialite-et-securite) décrit son confinement.

Le terminal intégré exécute votre propre shell — tout ce à quoi il se connecte relève de votre commande, pas de VMark.

## Ce que VMark N'envoie PAS

- Vos documents ou leur contenu (sauf à un fournisseur IA que vous avez configuré, lorsque vous exécutez un génie)
- Noms de fichiers ou chemins
- Modèles d'utilisation ou analyses de fonctionnalités
- Informations personnelles de quelque nature que ce soit
- Rapports de plantage
- Données de frappe ou d'édition
- Identifiants matériels réversibles ou empreintes

## La vérification des mises à jour en détail

Le **vérificateur de mises à jour automatique** de VMark contacte notre serveur pour voir si une nouvelle version est disponible. Chaque vérification envoie exactement ces champs — rien de plus :

| Données | Exemple | Objectif |
|---------|---------|---------|
| Adresse IP | `203.0.113.42` | Inhérent à toute requête HTTP — nous ne pouvons pas ne pas la recevoir |
| OS | `darwin`, `windows`, `linux` | Pour fournir le bon paquet de mise à jour |
| Architecture | `aarch64`, `x86_64` | Pour fournir le bon paquet de mise à jour |
| Version de l'app | `0.5.10` | Pour déterminer si une mise à jour est disponible |
| Hash de machine | `a3f8c2...` (hex de 64 caractères) | Compteur d'appareils anonyme — SHA-256 du nom d'hôte + OS + arch ; non réversible |

L'URL complète ressemble à :

```text
GET https://log.vmark.app/update/latest.json?target=darwin&arch=aarch64&version=0.5.10
X-Machine-Id: a3f8c2b1d4e5f6078a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1
```

Si ce serveur est injoignable, le programme de mise à jour essaie le même manifeste depuis GitHub Releases (`github.com/xiaolai/vmark/releases/latest/download/latest.json`). Les mises à jour elles-mêmes sont vérifiées par une signature minisign avant leur installation.

Vous pouvez vérifier cela vous-même — les endpoints sont dans [`tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json) (cherchez `"endpoints"`), et le hash est dans [`app_setup.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/app_setup.rs) (cherchez `machine_id_hash`).

### Comment nous utilisons les données

Nous agrégeons les journaux de vérification des mises à jour pour produire les statistiques en direct affichées sur notre [page d'accueil](/fr/) :

| Métrique | Comment elle est calculée |
|----------|--------------------------|
| **Appareils uniques** | Nombre de hashes de machine distincts par jour/semaine/mois |
| **IPs uniques** | Nombre d'adresses IP distinctes par jour/semaine/mois |
| **Pings** | Nombre total de requêtes de vérification des mises à jour |
| **Plateformes** | Nombre de pings par combinaison OS + architecture |
| **Versions** | Nombre de pings par version de l'application |

Ces chiffres sont publiés ouvertement sur [`log.vmark.app/api/stats`](https://log.vmark.app/api/stats). Rien n'est caché.

**Mises en garde importantes :**

- Les IPs uniques sous-comptent les vrais utilisateurs — plusieurs personnes derrière le même routeur/VPN comptent comme une
- Les appareils uniques fournissent des comptes plus précis, mais un changement de nom d'hôte ou une nouvelle installation OS génère un nouveau hash
- Les pings sur-comptent les vrais utilisateurs — une même personne peut vérifier plusieurs fois par jour

### Conservation des données

- Les journaux sont stockés sur notre serveur au format de journal d'accès standard
- Les fichiers journaux sont renouvelés à 1 Mo et seuls les 3 fichiers les plus récents sont conservés
- Les journaux ne sont pas partagés avec qui que ce soit
- Il n'y a pas de système de compte — VMark ne sait pas qui vous êtes
- Le hash de machine n'est lié à aucun compte, e-mail ou adresse IP — c'est uniquement un compteur d'appareils pseudonyme
- Nous n'utilisons pas de cookies de suivi, de prise d'empreintes ou de SDK d'analyse

### Désactiver les vérifications de mises à jour

Réglez **Paramètres → À propos → Fréquence de vérification** sur **Manuelle uniquement** et VMark ne contacte plus jamais le serveur de mises à jour de lui-même ; **Vérifier maintenant** fonctionne toujours quand vous le souhaitez. Pour en être certain au niveau réseau, bloquez `log.vmark.app` (pare-feu, `/etc/hosts` ou DNS) — VMark continue à fonctionner normalement sans lui ; vous ne recevrez simplement pas les notifications de mise à jour.

## Où sont stockées les clés API

Les clés API des fournisseurs IA REST résident dans le magasin d'identifiants du système d'exploitation — Trousseau macOS, Gestionnaire d'identifiants Windows ou Secret Service sous Linux — sous le nom de service `app.vmark.secrets`. Elles ne sont jamais écrites dans les fichiers de paramètres de VMark ni dans `localStorage`, et les paramètres de fournisseur enregistrés par l'application le sont sans la clé. Les clés ne sont envoyées qu'à l'endpoint du fournisseur que vous avez configuré, lorsque vous exécutez un génie ou appuyez sur **Tester**. Détails dans [Fournisseurs IA](/fr/guide/ai-providers#ou-sont-stockees-les-cles-api).

## Ce qu'un assistant IA peut atteindre

Un assistant connecté via MCP n'agit que dans ce que vous avez déjà ouvert : ses opérations sur les fichiers sont confinées à la racine de l'espace de travail ouvert et aux dossiers des documents ouverts dans VMark, et une requête hors de ce périmètre est refusée. Enregistrer un document vers un **nouveau** chemin nécessite le paramètre **Approuver automatiquement les enregistrements vers un nouvel emplacement et les résultats des génies** (désactivé par défaut) — sinon l'appel est refusé et VMark affiche une notification nommant le fichier ; même avec ce paramètre activé, un assistant ne peut jamais écraser de cette façon un autre fichier existant. Ouvrir un espace de travail qu'il désigne vous demande d'abord votre accord. Chaque écriture de l'IA dans un document est d'abord consignée dans l'historique des modifications, afin que vous puissiez restaurer ce qui s'y trouvait ([points de contrôle d'édition](/fr/guide/mcp-setup#points-de-controle-d-edition)). Le navigateur intégré a son propre modèle d'autorisation, décrit dans le [guide du navigateur](/fr/guide/browser).

## Ce que VMark peut lire sur le disque

L'accès de VMark aux fichiers est un périmètre de permissions restreint, pas le disque entier :

- **Périmètre statique** : votre dossier personnel (`$HOME/**`) ainsi que les volumes montés — `/Volumes/**` sur macOS, `/mnt/**` et `/media/**` sur Linux. Sous Windows, il couvre aussi les lecteurs `C:\` à `F:\` : seuls `G:\` et les lecteurs suivants, ainsi que les partages réseau, nécessitent une autorisation à l'exécution. Sur macOS et Linux, tout ce qui se trouve dans un dossier masqué (dont le nom commence par `.`) est hors du périmètre statique.
- **Autorisations à l'exécution** : un fichier que vous ouvrez explicitement — depuis le Finder ou l'Explorateur, la ligne de commande `vmark` ou une boîte de dialogue de fichiers — reçoit une autorisation pour ce seul fichier. Un **dossier** n'est autorisé que si VMark peut établir que vous l'avez choisi : vous l'avez sélectionné dans la boîte de dialogue de dossier de VMark, ou ouvert depuis le Finder. VMark conserve la liste de ces dossiers (`workspace-grants.json` dans son dossier de données d'application) et les autorise de nouveau à chaque lancement, afin que votre session restaurée et **Espace de travail récent** continuent de fonctionner. Un espace de travail récent qui ne figure pas dans cette liste, et que le périmètre statique ne couvre pas, ouvre la boîte de dialogue de dossier sur ce dossier — choisissez-le pour confirmer. Lorsqu'un assistant IA demande à ouvrir un tel dossier, VMark fait de même après que vous avez approuvé la demande.
- **Images et médias** : les images, vidéos et fichiers audio locaux sont affichés via le protocole de ressources de VMark, qui atteint les mêmes emplacements — le périmètre statique plus les autorisations à l'exécution ci-dessus. La visionneuse de médias ajoute une autorisation pour le seul fichier qu'elle affiche, et uniquement pour un fichier doté d'une extension de média ; une demande portant sur tout autre chemin est refusée au lieu d'élargir le périmètre. Une image située hors de ces emplacements, par exemple à côté d'un document ouvert seul depuis l'extérieur du périmètre statique, n'est affichée qu'une fois son dossier ouvert comme espace de travail.

Rien de tout cela n'est envoyé nulle part ; le périmètre décide de ce que l'application elle-même peut lire.

## Transparence open source

VMark est entièrement open source. Vous pouvez vérifier tout ce qui est décrit ici :

- Configuration de l'endpoint de mise à jour : [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)
- Génération du hash de machine : [`src-tauri/src/app_setup.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/app_setup.rs) — cherchez `machine_id_hash`
- Périmètre du système de fichiers et des ressources : [`src-tauri/capabilities/default.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/capabilities/default.json), l'entrée `assetProtocol` de [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json), [`src-tauri/src/fs_scope.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/fs_scope.rs) et [`src-tauri/src/workspace/grants/`](https://github.com/xiaolai/vmark/tree/main/src-tauri/src/workspace/grants)
- Stockage dans le trousseau : [`src-tauri/src/secure_store.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/secure_store.rs)
- Agrégation des statistiques côté serveur : [`scripts/vmark-stats-json`](https://github.com/xiaolai/vmark/blob/main/scripts/vmark-stats-json) — le script exact qui s'exécute sur notre serveur pour produire les [statistiques publiques](https://log.vmark.app/api/stats)
- Les appels réseau sont ceux listés ci-dessus — cherchez `reqwest` (Rust) et `fetch(` (TypeScript) dans le dépôt pour le vérifier vous-même

## Signaler un problème de sécurité

Si vous découvrez une vulnérabilité dans VMark, par exemple dans le pont MCP, le navigateur intégré, le programme de mise à jour ou la gestion des fichiers, signalez-la en privé via [le signalement privé de vulnérabilités de GitHub](https://github.com/xiaolai/vmark/security/advisories/new) plutôt que dans un ticket public. La [politique de sécurité](https://github.com/xiaolai/vmark/blob/main/SECURITY.md) précise ce qui est couvert et ce à quoi vous pouvez vous attendre.
