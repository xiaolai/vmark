# Fournisseurs IA

Les [Génies IA](/fr/guide/ai-genies) de VMark ont besoin d'un fournisseur IA pour générer des suggestions. Vous pouvez utiliser un outil CLI installé localement ou vous connecter directement à une API REST.

## Configuration rapide

La façon la plus rapide de démarrer :

1. Ouvrez **Paramètres > Intégrations**
2. Cliquez sur **Détecter** pour rechercher les outils CLI installés
3. Si un CLI est trouvé (ex. Claude, Gemini), sélectionnez-le — vous avez terminé
4. Si aucun CLI n'est disponible, choisissez un fournisseur REST, entrez votre clé API et sélectionnez un modèle

Un seul fournisseur peut être actif à la fois.

## Fournisseurs CLI

Les fournisseurs CLI utilisent des outils IA installés localement. VMark les exécute en tant que sous-processus et diffuse leur sortie vers l'éditeur.

| Fournisseur | Commande CLI | Installation |
|-------------|-------------|------------|
| Claude | `claude` | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) |
| Codex | `codex` | [OpenAI Codex CLI](https://github.com/openai/codex) |
| Gemini | `gemini` | [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) |

### Comment fonctionne la détection CLI

Cliquez sur **Détecter** dans Paramètres > Intégrations. VMark parcourt votre `$PATH` à la recherche de chaque commande CLI et indique leur disponibilité. Si un CLI est trouvé, son bouton radio devient sélectionnable.

### Avantages

- **Aucune clé API requise** — le CLI gère l'authentification avec votre connexion existante
- **Nettement moins cher** — les outils CLI utilisent votre abonnement (ex. Claude Max, ChatGPT Plus/Pro, Google One AI Premium), qui est un forfait mensuel fixe. Les fournisseurs API REST facturent par jeton et peuvent coûter 10 à 30 fois plus pour une utilisation intensive
- **Utilise votre configuration CLI** — les préférences de modèle, les prompts système et la facturation sont gérés par le CLI lui-même

::: tip Abonnement vs API pour les développeurs
Si vous utilisez également ces outils pour le vibe-coding (Claude Code, Codex CLI, Gemini CLI), le même abonnement couvre à la fois les Génies IA de VMark et vos sessions de codage — sans coût supplémentaire.
:::

### Configuration : Claude CLI

1. Installez Claude Code : `npm install -g @anthropic-ai/claude-code`
2. Exécutez `claude` une fois dans votre terminal pour vous authentifier
3. Dans VMark, cliquez sur **Détecter**, puis sélectionnez **Claude**

### Configuration : Gemini CLI

1. Installez Gemini CLI : `npm install -g @google/gemini-cli` (ou via le [dépôt officiel](https://github.com/google-gemini/gemini-cli))
2. Exécutez `gemini` une fois pour vous authentifier avec votre compte Google
3. Dans VMark, cliquez sur **Détecter**, puis sélectionnez **Gemini**

## Fournisseurs API REST

Les fournisseurs REST se connectent directement aux API cloud. Chacun nécessite un endpoint, une clé API et un nom de modèle.

| Fournisseur | Endpoint par défaut | Variable d'environnement |
|-------------|---------------------|--------------------------|
| Anthropic | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| OpenAI | `https://api.openai.com` | `OPENAI_API_KEY` |
| Google AI | *(intégré)* | `GOOGLE_API_KEY` ou `GEMINI_API_KEY` |
| Ollama (API) | `http://localhost:11434` | — |

### Champs de configuration

Lorsque vous sélectionnez un fournisseur REST, trois champs apparaissent :

- **Endpoint API** — L'URL de base (masquée pour Google AI, qui utilise un endpoint fixe)
- **Clé API** — Votre clé secrète (stockée uniquement en mémoire — jamais écrite sur le disque)
- **Modèle** — L'identifiant du modèle (ex. `claude-sonnet-4-5-20250929`, `gpt-4o`, `gemini-2.0-flash`)

### Remplissage automatique par variable d'environnement

VMark lit les variables d'environnement standard au lancement. Si `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` ou `GEMINI_API_KEY` est défini dans votre profil shell, le champ de clé API se remplit automatiquement lorsque vous sélectionnez ce fournisseur.

Cela signifie que vous pouvez définir votre clé une fois dans `~/.zshrc` ou `~/.bashrc` :

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Puis redémarrez VMark — aucune saisie manuelle de clé n'est nécessaire.

### Configuration : Anthropic (REST)

1. Obtenez une clé API sur [console.anthropic.com](https://console.anthropic.com)
2. Dans VMark Paramètres > Intégrations, sélectionnez **Anthropic**
3. Collez votre clé API
4. Choisissez un modèle (par défaut : `claude-sonnet-4-5-20250929`)

### Configuration : OpenAI (REST)

1. Obtenez une clé API sur [platform.openai.com](https://platform.openai.com)
2. Dans VMark Paramètres > Intégrations, sélectionnez **OpenAI**
3. Collez votre clé API
4. Choisissez un modèle (par défaut : `gpt-4o`)

### Configuration : Google AI (REST)

1. Obtenez une clé API sur [aistudio.google.com](https://aistudio.google.com)
2. Dans VMark Paramètres > Intégrations, sélectionnez **Google AI**
3. Collez votre clé API
4. Choisissez un modèle (par défaut : `gemini-2.0-flash`)

### Configuration : Ollama API (REST)

Utilisez ceci lorsque vous souhaitez un accès de style REST à une instance Ollama locale, ou lorsqu'Ollama s'exécute sur une autre machine de votre réseau.

1. Assurez-vous qu'Ollama est en cours d'exécution : `ollama serve`
2. Dans VMark Paramètres > Intégrations, sélectionnez **Ollama (API)**
3. Définissez l'endpoint sur `http://localhost:11434` (ou votre hôte Ollama)
4. Laissez la clé API vide
5. Définissez le modèle sur le nom de votre modèle téléchargé (ex. `llama3.2`)

## Choisir un fournisseur

| Situation | Recommandation |
|-----------|---------------|
| Claude Code déjà installé | **Claude (CLI)** — zéro configuration, utilise votre abonnement |
| Codex ou Gemini déjà installé | **Codex / Gemini (CLI)** — utilise votre abonnement |
| Besoin de confidentialité / hors ligne | Installez Ollama → **Ollama (API)** à `http://localhost:11434` |
| Modèle personnalisé ou auto-hébergé | **Ollama (API)** avec votre endpoint |
| Option cloud la moins chère | **N'importe quel fournisseur CLI** — l'abonnement est nettement moins cher que l'API |
| Pas d'abonnement, usage léger uniquement | Définissez la variable d'env de clé API → **fournisseur REST** (paiement par jeton) |
| Besoin de la meilleure qualité de sortie | **Claude (CLI)** ou **Anthropic (REST)** avec `claude-sonnet-4-5-20250929` |

## Remplacement de modèle par génie

Les génies individuels peuvent remplacer le modèle par défaut du fournisseur en utilisant le champ frontmatter `model` :

```markdown
---
name: quick-fix
description: Quick grammar fix
scope: selection
model: claude-haiku-4-5-20251001
---
```

Cela est utile pour diriger les tâches simples vers des modèles plus rapides/moins chers tout en conservant un modèle puissant par défaut.

## Fiabilité et délais d'attente

VMark protège chaque appel au fournisseur afin qu'un CLI bloqué ou une réponse API malformée ne puisse jamais paralyser l'éditeur :

- **Délai d'attente du sous-processus CLI** : chaque invocation d'un fournisseur CLI s'exécute sous un délai d'attente d'exécution. Si le CLI ne répond pas, VMark annule l'appel, renvoie l'erreur au génie et libère le processus — le pool de threads ne peut pas être bloqué par un sous-processus incontrôlé.
- **Sécurité de parsing JSON REST** : si un fournisseur REST renvoie une réponse de forme inattendue (page d'erreur HTML, JSON tronqué, dérive de schéma après un changement en amont), VMark renvoie une erreur typée au frontend au lieu de laisser le listener IA attendre indéfiniment. Vous verrez l'erreur dans la bannière de statut du génie avec une option de réessai.
- **Jetons d'annulation** : les étapes longues de génie ou de workflow peuvent être annulées à tout moment — Annuler dans le sélecteur de génie ou fermer le panneau et la requête en cours s'interrompt proprement.
- **Client HTTP partagé** : les fournisseurs REST partagent un seul client `reqwest` avec pool de connexions, de sorte que les exécutions de génie consécutives ne payent pas à chaque fois le coût de la poignée de main TCP/TLS.
- **Découverte du PATH sur Windows** : sur Windows, VMark lit le `PATH` complet de l'utilisateur (y compris les entrées uniquement PowerShell) lors de la détection des CLIs, de sorte que les outils installés par l'utilisateur qui fonctionnent dans un terminal fonctionnent également dans VMark.

## Notes de sécurité

- **Les clés API sont éphémères** — stockées uniquement en mémoire, jamais écrites sur le disque ou dans `localStorage`
- **Les variables d'environnement** sont lues une fois au lancement et mises en cache en mémoire
- **Les fournisseurs CLI** utilisent votre authentification CLI existante — VMark ne voit jamais vos identifiants
- **Toutes les requêtes partent directement** de votre machine vers le fournisseur — aucun serveur VMark n'est intermédiaire

## Dépannage

**« Aucun fournisseur IA disponible »** — Cliquez sur **Détecter** pour rechercher des CLIs, ou configurez un fournisseur REST avec une clé API.

**Le CLI indique « Non trouvé »** — Le CLI n'est pas dans votre `$PATH`. Installez-le ou vérifiez votre profil shell. Sur macOS, les applications GUI peuvent ne pas hériter du `$PATH` du terminal — essayez d'ajouter le chemin à `/etc/paths.d/`.

**Le CLI est bloqué / pas de réponse** — Le délai d'attente d'exécution de VMark annulera l'appel automatiquement ; vous verrez une erreur dans la bannière de statut du génie. Si un CLI particulier dépasse systématiquement le délai, exécutez-le d'abord depuis un terminal pour confirmer qu'il fonctionne là, puis vérifiez s'il nécessite une authentification interactive.

**Le fournisseur REST renvoie 401** — Votre clé API est invalide ou expirée. Générez-en une nouvelle depuis la console du fournisseur.

**Le fournisseur REST renvoie 429** — Vous avez atteint une limite de débit. Attendez un moment et réessayez, ou passez à un autre fournisseur.

**Le fournisseur REST renvoie du JSON tronqué ou inattendu** — VMark renvoie une erreur de parsing typée (ex. « list_models a retourné une réponse de forme inattendue »). Vérifiez l'URL de l'endpoint et que le contrat de l'API correspond au type de fournisseur sélectionné ; certaines passerelles auto-hébergées annoncent des URLs compatibles OpenAI mais livrent un schéma différent.

**Réponses lentes** — Les fournisseurs CLI ajoutent une surcharge de sous-processus. Pour des réponses plus rapides, utilisez des fournisseurs REST qui se connectent directement. Pour l'option locale la plus rapide, utilisez Ollama avec un petit modèle.

**Erreur « Modèle non trouvé »** — L'identifiant du modèle ne correspond pas à ce que le fournisseur propose. Consultez la documentation du fournisseur pour les noms de modèles valides.

## Voir aussi

- [Génies IA](/fr/guide/ai-genies) — Comment utiliser l'assistance à l'écriture par IA
- [Configuration MCP](/fr/guide/mcp-setup) — Intégration IA externe via le protocole MCP
