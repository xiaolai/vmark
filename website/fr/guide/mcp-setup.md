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
- **Approuver automatiquement les modifications** - Appliquer les changements IA sans prévisualisation (voir ci-dessous)

### 2. Installer la configuration

Cliquez sur **Installer** pour votre assistant IA :

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-install.png" alt="Installation de la configuration MCP VMark" />
</div>

Assistants IA pris en charge :
- **Claude Desktop** - Application bureau d'Anthropic
- **Claude Code** - CLI pour développeurs
- **Codex CLI** - Assistant de codage d'OpenAI
- **Gemini CLI** - Assistant IA de Google

::: info Autres clients compatibles MCP
D'autres clients compatibles MCP tels que Cursor, Windsurf et des outils similaires peuvent également se connecter au serveur MCP de VMark. Configurez-les manuellement en pointant vers le chemin du binaire du serveur MCP (voir [Configuration manuelle](#configuration-manuelle) ci-dessous).
:::

#### Icônes de statut

Chaque fournisseur affiche un indicateur de statut :

| Icône | Statut | Signification |
|-------|--------|---------------|
| ✓ Vert | Valide | La configuration est correcte et fonctionnelle |
| ⚠ Ambre | Incompatibilité de chemin | VMark a été déplacé — cliquez sur **Réparer** |
| ✗ Rouge | Binaire manquant | Binaire MCP introuvable — réinstallez VMark |
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

### Gemini CLI

Modifiez `~/.gemini/settings.json` :

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

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
| `--health-check` | Exécute un auto-test contre le pont VMark en cours d'exécution et quitte. Utilisez ceci pour vérifier votre installation avant de connecter un assistant IA. |
| `--port <nombre>` | Substitution manuelle du port. Ignore la procédure de découverte automatique et se connecte sur le port indiqué. Utile uniquement pour les configurations legacy où le port du pont est fixé en externe ; la découverte automatique est préférable. |

Exemple :

```bash
vmark-mcp-server --health-check
vmark-mcp-server --version
vmark-mcp-server --port 9223   # legacy / manuel
```

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

Une fois connecté, votre assistant IA peut :

| Catégorie | Capacités |
|-----------|----------|
| **Document** | Lire/écrire du contenu, rechercher, remplacer |
| **Sélection** | Obtenir/définir la sélection, remplacer le texte sélectionné |
| **Formatage** | Gras, italique, code, liens, et plus |
| **Blocs** | Titres, paragraphes, blocs de code, citations |
| **Listes** | Listes à puces, ordonnées et de tâches |
| **Tableaux** | Insérer, modifier les lignes/colonnes |
| **Spécial** | Équations mathématiques, diagrammes Mermaid, liens wiki |
| **Espace de travail** | Ouvrir/enregistrer des documents, gérer les fenêtres |

Consultez la [Référence des outils MCP](/fr/guide/mcp-tools) pour la documentation complète.

## Vérifier le statut MCP

VMark fournit plusieurs façons de vérifier le statut du serveur MCP :

### Indicateur dans la barre d'état

La barre d'état affiche un indicateur **MCP** sur le côté droit :

| Couleur | Statut |
|---------|--------|
| Vert | Connecté et en cours d'exécution |
| Gris | Déconnecté ou arrêté |
| Pulsation (animé) | Démarrage en cours |

Le démarrage se termine généralement en 1 à 2 secondes.

Cliquez sur l'indicateur pour ouvrir la boîte de dialogue de statut détaillé.

### Boîte de dialogue de statut

Accessible via **Aide → Statut du serveur MCP** ou en cliquant sur l'indicateur de la barre d'état.

La boîte de dialogue affiche :
- Santé de la connexion (Sain / Erreur / Arrêté)
- État du pont et port
- Version du serveur
- Outils disponibles (12) et ressources (4)
- Heure du dernier contrôle de santé
- Liste complète des outils disponibles avec bouton de copie

### Panneau de paramètres

Dans **Paramètres → Intégrations**, lorsque le serveur est en cours d'exécution, vous verrez :
- Numéro de version
- Nombre d'outils et de ressources
- Bouton **Tester la connexion** — exécute un contrôle de santé
- Bouton **Voir les détails** — ouvre la boîte de dialogue de statut

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

## Système de suggestions et approbation automatique

Par défaut, lorsque les assistants IA modifient votre document (insérer, remplacer ou supprimer du contenu), VMark crée des **suggestions** qui nécessitent votre approbation :

- **Insertion** - Le nouveau texte apparaît comme aperçu fantôme
- **Remplacement** - Le texte original a un barré, le nouveau texte comme texte fantôme
- **Suppression** - Le texte à supprimer apparaît avec un barré

Appuyez sur **Entrée** pour accepter ou **Échap** pour rejeter. Cela préserve votre historique d'annulation/rétablissement et vous donne un contrôle total.

### Mode d'approbation automatique

::: warning Utilisez avec précaution
Activer **Approuver automatiquement les modifications** contourne l'aperçu des suggestions et applique immédiatement les changements IA. N'activez cela que si vous faites confiance à votre assistant IA et souhaitez une édition plus rapide.
:::

Lorsque l'approbation automatique est activée :
- Les modifications sont appliquées directement sans aperçu
- Annuler (Mod+Z) fonctionne toujours pour inverser les changements
- Les messages de réponse incluent « (approuvé automatiquement) » pour la transparence

Ce paramètre est utile pour :
- Les flux de travail d'écriture assistée par IA rapides
- Les assistants IA de confiance avec des tâches bien définies
- Les opérations par lots où la prévisualisation de chaque changement est peu pratique

## Notes de sécurité

- Le serveur MCP n'accepte que les connexions locales (localhost)
- Aucune donnée n'est envoyée à des serveurs externes
- Tout le traitement se fait sur votre machine
- Le pont WebSocket n'est accessible que localement
- L'approbation automatique est désactivée par défaut pour éviter les changements non intentionnels

## Prochaines étapes

- Explorez tous les [Outils MCP](/fr/guide/mcp-tools) disponibles
- Apprenez les [raccourcis clavier](/fr/guide/shortcuts)
- Découvrez d'autres [fonctionnalités](/fr/guide/features)
