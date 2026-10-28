# Intégration IA (MCP)

VMark inclut un serveur MCP (Model Context Protocol) intégré qui permet aux assistants IA comme Claude d'interagir directement avec votre éditeur.

## Qu'est-ce que MCP ?

Le [Model Context Protocol](https://modelcontextprotocol.io/) est un standard ouvert qui permet aux assistants IA d'interagir avec des outils et applications externes. Le serveur MCP de VMark expose ses capacités d'éditeur comme outils que les assistants IA peuvent utiliser pour :

- Lire et écrire du contenu de document
- Appliquer du formatage et créer des structures
- Naviguer et gérer des documents
- Insérer du contenu spécial (maths, diagrammes, liens wiki)

## Configuration rapide

VMark facilite la connexion des assistants IA avec une installation en un clic.

### 1. Activer le serveur MCP

Ouvrez **Paramètres → Intégrations** et activez le serveur MCP :

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-server.png" alt="Paramètres du serveur MCP VMark" />
</div>

- **Activer le serveur MCP** - Activer pour autoriser les connexions IA
- **Démarrer au lancement** - Démarrage automatique à l'ouverture de VMark
- **Approuver automatiquement les enregistrements vers un nouvel emplacement et les résultats des génies** - Désactivé par défaut. Permet à une IA d'enregistrer un document vers un *nouveau* chemin sans demander, et permet à un génie d'appliquer son résultat directement plutôt que sous forme de suggestion. Les écritures ordinaires de l'IA ne sont jamais soumises à ce réglage — leur filet de sécurité est l'[historique des points de contrôle d'édition](#points-de-controle-d-edition) (voir [Fonctionnement des modifications](#fonctionnement-des-modifications))

### 2. Installer la configuration

Cliquez sur **Installer** pour votre assistant IA :

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-install.png" alt="Installation de la configuration MCP VMark" />
</div>

Assistants IA pris en charge :
- **Claude Desktop** - Application bureau d'Anthropic
- **Claude Code** - CLI pour développeurs
- **Codex CLI** - Assistant de codage d'OpenAI
- **Antigravity CLI** - `agy` de Google, le successeur de Gemini CLI
- **Grok CLI** - L'agent de codage de xAI
- **opencode** - l'agent de terminal open source, indépendant du fournisseur

**L'installation écrit un identifiant propre à chaque client.** En plus du chemin vers le serveur MCP de VMark, l'installation place un jeton secret dans le propre fichier de configuration du client, sous `env.VMARK_MCP_TOKEN` (`environment.VMARK_MCP_TOKEN` pour opencode). Chaque client reçoit son propre jeton, qui n'est stocké nulle part ailleurs. Il indique à VMark quel client se connecte, au lieu de se fier au nom que le client annonce. Aujourd'hui, seules les actions déléguées en ont besoin — répondre à une question de cohérence en votre nom avec `coherence_resolve` ; tous les autres outils fonctionnent sans lui. L'installation et **Réparer** conservent un jeton encore valide ; pour en émettre un nouveau, désinstallez puis installez à nouveau. Redémarrez le client IA après l'une ou l'autre opération. Traitez le jeton comme un mot de passe : ne collez pas le fichier de configuration dans un ticket ou une discussion.

::: info Gemini CLI est abandonné
Google a remplacé Gemini CLI par Antigravity. Si une installation antérieure de VMark a
laissé une entrée `vmark` dans `~/.gemini/settings.json`, le panneau Intégrations affiche
pour elle une ligne **Abandonné** avec un bouton **Supprimer** ; les nouvelles installations
ciblent Antigravity à la place.
:::

::: info Autres clients compatibles MCP
D'autres clients compatibles MCP tels que Cursor, Windsurf et des outils similaires peuvent également se connecter au serveur MCP de VMark. Configurez-les manuellement en pointant vers le chemin du binaire du serveur MCP (voir [Configuration manuelle](#configuration-manuelle) ci-dessous).
:::

#### CC-Switch

Si vous gérez vos CLI d'IA avec CC-Switch, le programme d'installation affiche aussi une ligne **CC-Switch**. **Ajouter à CC-Switch** ouvre un lien `ccswitch://v1/import` qui transmet le serveur MCP de VMark — le chemin de son binaire — à CC-Switch, lequel écrit ensuite l'entrée `vmark` dans toutes les CLI que vous y gérez ; un bouton de copie vous donne le lien lui-même si vous préférez le coller. La ligne reste désactivée tant que VMark n'a pas résolu son propre binaire MCP.

#### Icônes de statut

Chaque fournisseur affiche un indicateur de statut :

| Icône | Statut | Signification |
|-------|--------|---------------|
| ✓ Vert | Valide | La configuration est correcte et fonctionnelle |
| ⚠ Ambre | Incompatibilité de chemin | VMark a été déplacé — cliquez sur **Réparer** |
| ✗ Rouge | Binaire manquant | Binaire MCP introuvable — réinstallez VMark |
| 🗎 Rouge | Configuration illisible | VMark ne peut pas lire ou analyser le fichier de configuration ; on ne sait donc pas s'il contient une entrée VMark. Le message nomme le fichier et la raison. Corrigez-le ou déplacez-le, puis cliquez sur **Revérifier** — l'installation et la réparation sont suspendues tant qu'il ne s'analyse pas, car écrire dans un fichier que VMark ne peut pas lire risquerait d'en détruire le contenu |
| ○ Gris | Non configuré | Non installé — cliquez sur **Installer** |

::: tip VMark déplacé ?
Si vous déplacez VMark.app vers un autre emplacement, le statut affichera en ambre « Incompatibilité de chemin ». Cliquez simplement sur le bouton **Réparer** pour mettre à jour la configuration avec le nouveau chemin.
:::

### 3. Redémarrer votre assistant IA

Après l'installation ou la réparation, **redémarrez complètement votre assistant IA** (quittez et rouvrez) pour charger la nouvelle configuration. VMark affichera un rappel après chaque changement de configuration.

### 4. Essayer

Dans votre assistant IA, essayez des commandes comme :
- *« Qu'est-ce qu'il y a dans mon document VMark ? »*
- *« Écris un résumé sur l'informatique quantique dans VMark »*
- *« Ajoute une table des matières à mon document »*

## Le voir en action

Posez une question à Claude et faites-lui écrire la réponse directement dans votre document VMark :

<div class="screenshot-container">
  <img src="/screenshots/mcp-claude.png" alt="Claude Desktop utilisant VMark MCP" />
  <p class="screenshot-caption">Claude Desktop appelle <code>document</code> → <code>set_content</code> pour écrire dans VMark</p>
</div>

<div class="screenshot-container">
  <img src="/screenshots/mcp-result.png" alt="Contenu rendu dans VMark" />
  <p class="screenshot-caption">Le contenu apparaît instantanément dans VMark, entièrement formaté</p>
</div>

<!-- Styles in style.css -->

## Configuration manuelle

Si vous préférez configurer manuellement, voici les emplacements des fichiers de configuration :

### Claude Desktop

Modifiez `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) ou `%APPDATA%\Claude\claude_desktop_config.json` (Windows) :

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Claude Code

Modifiez `~/.claude.json` ou le fichier `.mcp.json` du projet :

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Codex CLI

Modifiez `~/.codex/config.toml` :

```toml
[mcp_servers.vmark]
command = "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
```

### Antigravity CLI

Modifiez `~/.gemini/config/mcp_config.json` :

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Grok CLI

Modifiez `~/.grok/config.toml` :

```toml
[mcp_servers.vmark]
command = "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
```

### opencode

Modifiez `~/.config/opencode/opencode.json`. Le schéma d'opencode diffère du schéma
`mcpServers` : la clé est `mcp`, et `command` est un tableau unique contenant
le programme et ses arguments :

```json
{
  "mcp": {
    "vmark": {
      "type": "local",
      "command": ["/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"],
      "enabled": true
    }
  }
}
```

Si vos propres réglages se trouvent dans `opencode.jsonc`, laissez-les là — opencode
fusionne les deux fichiers, donc l'entrée de VMark dans `opencode.json` s'ajoute aux vôtres. VMark écrit
le fichier JSON simple parce qu'il ne peut pas conserver les commentaires d'un fichier `.jsonc` à la réécriture.

::: warning Une entrée `vmark` existante dans `opencode.jsonc` l'emporte
opencode fusionne `config.json`, puis `opencode.json`, puis `opencode.jsonc`, et
le dernier lu a priorité. Si vous avez auparavant ajouté à la main une entrée `vmark`
dans `opencode.jsonc`, elle remplace donc celle que gère VMark — VMark signalera
le fournisseur comme valide alors qu'opencode continue d'utiliser votre ancienne entrée (et
son chemin de binaire obsolète). Supprimez le bloc `mcp.vmark` écrit à la main dans
`opencode.jsonc` et laissez le panneau Intégrations le gérer.
:::

::: tip Trouver le chemin du binaire
Sur macOS, le binaire du serveur MCP est à l'intérieur de VMark.app :
- `VMark.app/Contents/MacOS/vmark-mcp-server`

Sur Windows :
- `C:\Program Files\VMark\vmark-mcp-server.exe`

Sur Linux :
- `/usr/bin/vmark-mcp-server` (ou là où vous l'avez installé)

Le port est découvert automatiquement — pas d'argument `args` nécessaire.
:::

### Options CLI (avancé)

Le binaire du serveur MCP prend en charge un petit ensemble d'options pour les diagnostics et les configurations legacy :

| Option | Ce qu'elle fait |
|---|---|
| `--version` (ou `-v`) | Affiche la version (doit correspondre à la VMark en cours d'exécution) et quitte. |
| `--health-check` | Exécute un auto-test du binaire et quitte : il démarre le serveur MCP face à un pont simulé intégré, affiche sa version et son nombre d'outils en JSON, et quitte avec un code non nul si le nombre d'outils n'est pas celui qu'attend cette version. Il ne contacte **pas** une VMark en cours d'exécution — utilisez-le pour confirmer que le binaire fonctionne ; utilisez **Paramètres → Intégrations** pour vérifier le pont actif. |
| `--port <nombre>` | Substitution manuelle du port. Ignore la procédure de découverte automatique et se connecte sur le port indiqué. Utile uniquement pour les configurations legacy où le port du pont est fixé en externe ; la découverte automatique est préférable. |

Exemple :

```bash
vmark-mcp-server --health-check
vmark-mcp-server --version
vmark-mcp-server --port 9223   # legacy / manuel
```

Tout autre argument — une option mal orthographiée, `--port=9223` ou un mot isolé — est refusé : le programme affiche une erreur d’utilisation et se termine avec le code 64 au lieu de revenir à la détection automatique.

## Fonctionnement

```text
Assistant IA <--stdio--> Serveur MCP <--WebSocket--> Éditeur VMark
```

1. **VMark démarre un pont WebSocket** sur un port disponible au lancement
2. **Le serveur MCP** lit le port et le jeton d'authentification depuis le répertoire de données de l'application VMark
3. **Le serveur MCP** se connecte et s'authentifie via le pont WebSocket
4. **L'assistant IA** communique avec le serveur MCP via stdio
5. **Les commandes sont relayées** vers l'éditeur de VMark via le pont

## Capacités disponibles

Une fois connecté, votre assistant IA dispose de dix outils :

| Outil | Ce qu'il couvre |
|-------|-----------------|
| `session` | Fenêtres, onglets, document actif et onglets du navigateur (lecture seule) |
| `workspace` | Nouveau, ouvrir, enregistrer, enregistrer sous, fermer, changer d'onglet, mettre une fenêtre au premier plan, ouvrir un espace de travail |
| `document` | Lire et écrire l'ensemble du document en Markdown ; transformations de formatage CJK |
| `selection` | Lire et remplacer le texte sélectionné |
| `comments` | Lister les commentaires de relecture du document, y répondre et les marquer comme traités (un assistant ne peut pas les résoudre) |
| `workflow` | Correctifs sûrs pour le CST et validation du YAML GitHub Actions |
| `browser` / `browser_read` | Automatisation du navigateur intégré sur macOS — les moitiés modifiante et en lecture seule |
| `coherence` / `coherence_resolve` | Lire la couche de cohérence ; résoudre les liens obsolètes dans le cadre d'une délégation que vous avez accordée |

Le formatage n'est pas un outil distinct : l'assistant écrit du Markdown, donc les titres, tableaux, maths et diagrammes sont simplement ce qu'il écrit.

Consultez la [Référence des outils MCP](/fr/guide/mcp-tools) pour la documentation complète.

## Vérifier le statut MCP

VMark fournit plusieurs façons de vérifier le statut du serveur MCP :

### Indicateur dans la barre d'état

La barre d'état affiche un indicateur **MCP** sur le côté droit. Lorsque quelque chose
requiert votre attention, un petit mot d'état apparaît à côté de l'icône satellite ;
une connexion saine se résume à l'icône verte. Le survol de l'indicateur liste les clients IA
actuellement connectés, par nom et version :

| Couleur | Mot | Statut |
|---------|-----|--------|
| Vert | — | Connecté et en cours d'exécution |
| Gris | `off` | Déconnecté ou arrêté |
| Pulsation (animé) | `…` | Démarrage en cours |
| Rouge | `error` | Échec du serveur — survolez pour en voir la raison |

Le démarrage se termine généralement en 1 à 2 secondes.

Cliquez sur l'indicateur pour ouvrir **Paramètres → Intégrations**.

### Panneau de paramètres

**Paramètres → Intégrations** est l'autre surface de statut — il n'existe pas de boîte de dialogue de statut distincte. Tant que le pont fonctionne, le panneau affiche l'adresse sur laquelle il écoute (`localhost:<port>`, avec un bouton de copie) et le nombre de clients IA connectés, actualisé toutes les quelques secondes. Le bouton **Tester la connexion** (intitulé **Vérifier le sidecar** lorsque le pont est arrêté) exécute le propre `--health-check` du sidecar et indique la version du sidecar, son nombre d'outils et l'heure de la dernière vérification — il confirme que le binaire installé fonctionne, pas qu'un client est connecté.

## Dépannage

### « Connexion refusée » ou « Aucun éditeur actif »

- Assurez-vous que VMark est en cours d'exécution et qu'un document est ouvert
- Vérifiez que le serveur MCP est activé dans Paramètres → Intégrations
- Vérifiez que le pont MCP affiche l'état « En cours d'exécution »
- Redémarrez VMark si la connexion a été interrompue

### Incompatibilité de chemin après le déplacement de VMark

Si vous avez déplacé VMark.app vers un autre emplacement (ex. de Téléchargements vers Applications), la configuration pointera vers l'ancien chemin :

1. Ouvrez **Paramètres → Intégrations**
2. Recherchez l'icône d'avertissement ambre ⚠ à côté des fournisseurs concernés
3. Cliquez sur **Réparer** pour mettre à jour le chemin
4. Redémarrez votre assistant IA

### Les outils n'apparaissent pas dans l'assistant IA

- Redémarrez votre assistant IA après l'installation de la configuration
- Vérifiez que la configuration a été installée (vérifiez la coche verte dans les Paramètres)
- Vérifiez les journaux de votre assistant IA pour les erreurs de connexion MCP

### Les commandes échouent avec « Aucun éditeur actif »

- Assurez-vous qu'un onglet de document est actif dans VMark
- Cliquez dans la zone de l'éditeur pour la mettre au point
- Certaines commandes nécessitent d'abord que du texte soit sélectionné

## Fonctionnement des modifications

La surface MCP réduite suit l'axe lecture-écriture : les assistants IA appellent `document.read` pour obtenir le contenu actuel + un jeton de révision, raisonnent dessus, puis appellent `document.write` avec le nouveau contenu complet. Le jeton de révision protège contre les écrasements silencieux : si vous avez tapé dans VMark pendant que l'IA réfléchissait, l'écriture renvoie `STALE` et l'IA relit le document.

Pour les fichiers YAML de workflow GitHub Actions, l'IA utilise plutôt `workflow.apply_patch` — les mutateurs de VMark, conscients du CST, préservent les commentaires, les ancres et l'ordre des clés qu'une réécriture du texte brut perdrait.

Il n'y a pas d'étape d'aperçu pour `document.write`, `selection.set` ou `workflow.apply_patch` — la modification arrive dans l'éditeur dès que la vérification de révision réussit. Le filet de sécurité est l'[historique des points de contrôle d'édition](#points-de-controle-d-edition) ci-dessous ; si vous souhaitez relire avant que quoi que ce soit n'arrive, gardez le document sous git et relisez le diff. Le seul point d'approbation est **Approuver automatiquement les enregistrements vers un nouvel emplacement et les résultats des génies** : réglage désactivé (par défaut), une IA ne peut pas enregistrer un document vers un nouveau chemin — `workspace.save_as` renvoie `APPROVAL_REQUIRED` et VMark affiche une notification nommant le fichier. Même réglage activé, `save_as` refuse d'écraser un autre fichier existant.

## Points de contrôle d'édition

Chaque modification d’un document par l’IA — `document.write`, `document.transform`, `selection.set` et `workflow.apply_patch` — est enregistrée dans l’historique des modifications de VMark avant de changer quoi que ce soit. Le bouton **historique** de la barre d’état ouvre un panneau pour le document actif. Son badge compte les versions du document faites par l’IA, et le bouton prend une couleur d’avertissement quand les modifications ne sont pas enregistrées. Le panneau se met à jour en direct, dans chaque fenêtre, à mesure que des versions sont enregistrées.

Le panneau liste les versions du document, la plus récente d’abord. Chaque ligne indique quand elle a eu lieu, le type de modification, l’outil et son auteur : le fournisseur du client d’IA (par exemple `claude` ou `codex`), sa connexion et son libellé de session. Un client sans jeton apparaît comme **Client non identifié**, un jeton inconnu comme **Identifiant non reconnu** et un jeton partagé par plusieurs clients comme **Identifiant partagé par plusieurs fournisseurs** — jamais comme un fournisseur, quel que soit le nom que le client se donne. **Restaurer cette version** remet le texte de cette version ; **Restaurer l’état d’avant cette modification** remet le texte d’avant. Une restauration incrémente la révision du document : un client d’IA qui détient encore l’ancienne révision reçoit `STALE` à sa prochaine écriture au lieu d’écraser votre restauration. Une restauration est elle-même enregistrée : le texte qu’elle remplace est conservé d’abord, et un document modifié pendant la restauration n’est pas touché. Lorsque VMark ne peut pas confirmer que l’enregistrement d’une restauration a atteint le disque, il vous en avertit à côté du résultat.

Au-dessus des versions, **Vérifier les modifications de l’IA** liste les modifications de l’IA que vous n’avez pas encore vérifiées, groupées par client et par session ; les versions dont toutes les modifications sont vérifiées sont résumées par un nombre. Chaque modification propose **Conserver** ou **Annuler la modification** (puis **Annuler la conservation** ou **Rétablir la modification**). Une annulation qui écraserait du texte que vous avez modifié depuis n’est pas appliquée : la modification est marquée en conflit et, une fois le conflit résolu à la main, **Marquer comme traitée** l’enregistre. Une modification dont l’emplacement ne peut plus être certifié en donne la raison et ne propose pas d’annulation automatique. **Clore les vérifiées** clôt définitivement toutes les modifications vérifiées, après confirmation, car c’est irréversible. Un document contient au plus 500 modifications de l’IA non vérifiées : à cette limite, un bandeau l’indique et les modifications de l’IA sont refusées avec `REVIEW_BACKLOG_FULL` jusqu’à ce que vous vérifiiez et clôturiez. Un enregistrement parti d’une autre version que celle qui le précède — le document a été modifié dans deux fenêtres — est signalé comme tel, avec les deux restaurations pour annuler la fusion. **Afficher les deux modifications** ouvre deux comparaisons de cet enregistrement : *Par rapport à la version dont cet enregistrement est parti*, et *Par rapport à la version précédente*, par rapport à la version qui le précède dans l’historique.

Ensuite, **Commentaires** réunit les fils de commentaires du document. **Commenter la sélection** cite le texte sélectionné dans l’éditeur (avec un simple curseur, le paragraphe où il se trouve) et ajoute votre commentaire ; le texte non enregistré est d’abord consigné, si bien qu’un commentaire ne désigne jamais une version plus ancienne. Chaque fil indique son état — ouvert, traité, résolu ou rouvert —, qui l’a écrit, le texte cité et les réponses. Les commentaires s’affichent en texte brut : le HTML d’un commentaire est affiché, jamais exécuté. Quand le texte cité apparaît désormais plusieurs fois, le fil indique combien ; quand il a disparu, le fil le signale. Vous pouvez **Répondre** dans tout état, **Marquer comme traité** un fil ouvert ou rouvert, le **Résoudre**, et **Rouvrir** ou **Supprimer** un fil résolu ; la suppression demande confirmation et est irréversible. Tant qu’un commentaire ou une réponse est en cours d’envoi, il ne peut être ni modifié ni annulé, même si vous fermez puis rouvrez le panneau ; s’il est refusé, il est conservé pour que vous puissiez le modifier et l’envoyer à nouveau. Vous seul pouvez résoudre, rouvrir ou supprimer un fil. Un fil rouvert après que sa révision d’origine a été retirée de l’historique affiche *Révision de création plus conservée* et est comparé au texte actuel.

Le haut du panneau signale quand les modifications ne sont pas enregistrées : l’historique n’a pas pu démarrer ou est en lecture seule, il a du retard (enregistrements en attente, pas encore sur le disque), le dernier enregistrement de ce document a été refusé ou l’historique n’a pas répondu à temps, des modifications d’IA ont été refusées dans une fenêtre comportant trop de pages ouvertes, ou certaines modifications de l’IA ne peuvent plus être annulées automatiquement. Le panneau compte aussi les modifications d’IA enregistrées comme des changements du document entier, faute d’avoir pu confirmer la plage modifiée. Une modification qui ne peut plus être annulée automatiquement se lit **Bloqué : raison (origine)** sous la dernière version où son emplacement était certifié, qui est mise en évidence ; s’il n’y en a pas, le panneau indique que l’emplacement est indisponible. Les écritures appliquées mais jamais enregistrées figurent sous **Écritures non enregistrées**, chacune avec une restauration et un abandon.

Pour distinguer plusieurs sessions d’un même client, définissez `VMARK_SESSION_LABEL` dans la configuration MCP du client, à côté de `VMARK_MCP_TOKEN` :

```json
"env": { "VMARK_MCP_TOKEN": "…", "VMARK_SESSION_LABEL": "docs refactor" }
```

Le libellé fait au plus 128 octets UTF-8, sans caractère de contrôle ; un libellé qui enfreint la règle est ignoré avec un avertissement et le client se connecte sans lui. Il est choisi par la configuration du client : il sert uniquement à l’affichage et ne décide de rien.

L’historique est conservé dans le dossier `agent-journal` du répertoire de données de VMark, il survit donc à un redémarrage. Le dossier contient le texte précédent complet de chaque modification enregistrée et n’est accessible qu’à son propriétaire (`0700` sous macOS et Linux). Les points de contrôle d’une version antérieure de VMark (un `mcp-checkpoints.jsonl`, importé au premier démarrage puis renommé) figurent sous **Points de contrôle antérieurs**, une seule liste pour tous les documents et fenêtres. En restaurer un ouvre son fichier ; un point sans titre, ou dont le fichier ne peut plus être ouvert, est restauré dans un nouveau document. La section indique la quantité de texte conservée et efface tout — chaque fichier et chaque fenêtre — en une seule action, en supprimant les textes du disque.

## Notes de sécurité

- Le serveur MCP n'accepte que les connexions locales (localhost)
- Aucune donnée n'est envoyée à des serveurs externes
- Les opérations de fichiers de l'IA sont confinées à la racine de l'espace de travail ouvert et aux dossiers des documents ouverts — voir [Confidentialité](/fr/guide/privacy#ce-qu-un-assistant-ia-peut-atteindre)
- Tout le traitement se fait sur votre machine
- Le pont WebSocket n'est accessible que localement
- Chaque client installé porte son propre `VMARK_MCP_TOKEN`. Un client sans jeton, avec un jeton inconnu ou avec un jeton partagé avec un autre client se connecte quand même, mais ses actions déléguées sont refusées avec un message vous invitant à exécuter Installer pour lui dans **Paramètres → Intégrations** puis à le redémarrer

## Prochaines étapes

- Explorez tous les [Outils MCP](/fr/guide/mcp-tools) disponibles
- Apprenez les [raccourcis clavier](/fr/guide/shortcuts)
- Découvrez d'autres [fonctionnalités](/fr/guide/features)
