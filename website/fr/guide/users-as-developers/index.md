# Utilisateurs en tant que développeurs

À l'ère des outils de codage IA, la frontière entre « utilisateur » et « développeur » disparaît. Si vous pouvez décrire un bug, vous pouvez le corriger. Si vous pouvez imaginer une fonctionnalité, vous pouvez la construire — avec un assistant IA qui comprend déjà la base de code.

VMark embrasse cette philosophie. Le dépôt est livré avec des règles de projet, des docs d'architecture et des conventions pré-chargées pour les outils de codage IA. Clonez le dépôt, ouvrez votre assistant IA, et commencez à contribuer — l'IA sait déjà comment VMark fonctionne.

## Démarrage rapide

1. **Clonez le dépôt** — La configuration IA est déjà en place.
2. **Installez votre outil IA** — [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex), ou [Gemini CLI](https://github.com/google-gemini/gemini-cli).
3. **Ouvrez une session** — L'outil lit `AGENTS.md` et les règles automatiquement.
4. **Commencez à coder** — L'IA connaît les conventions du projet, les exigences de test et les schémas d'architecture.

Aucune configuration supplémentaire nécessaire. Demandez simplement à votre IA de vous aider.

## Guide de lecture

Nouveau dans le développement assisté par IA ? Ces pages se complètent les unes les autres :

1. **[Pourquoi j'ai construit VMark](/fr/guide/users-as-developers/why-i-built-vmark)** — Le parcours d'un non-programmeur, des scripts à une application de bureau
2. **[Cinq compétences humaines fondamentales qui décuplent l'IA](/fr/guide/users-as-developers/what-are-indispensable)** — Git, TDD, maîtrise du terminal, anglais et goût — les fondations sur lesquelles tout le reste repose
3. **[Pourquoi les modèles coûteux sont moins chers](/fr/guide/users-as-developers/why-expensive-models-are-cheaper)** — Le prix par token est une métrique de vanité ; le coût par tâche est ce qui compte
4. **[Abonnement vs facturation API](/fr/guide/users-as-developers/subscription-vs-api)** — Pourquoi les abonnements à tarif fixe sont préférables au paiement par token pour les sessions de codage
5. **[Les prompts en anglais donnent de meilleurs résultats](/fr/guide/users-as-developers/prompt-refinement)** — Traduction, affinement et le hook `::`
6. **[Vérification croisée entre modèles](/fr/guide/users-as-developers/cross-model-verification)** — Utiliser Claude + Codex pour s'auditer mutuellement et produire un meilleur code
7. **[Pourquoi des issues, pas des PRs](/fr/guide/users-as-developers/why-issues-not-prs)** — Pourquoi nous acceptons les issues mais pas les pull requests dans une base de code maintenue par IA
8. **[Évaluation des coûts et efforts](/fr/guide/users-as-developers/cost-evaluation)** — Ce que VMark coûterait avec une équipe humaine vs. la réalité du développement assisté par IA

Déjà familiarisé avec les bases ? Passez directement à [Vérification croisée entre modèles](/fr/guide/users-as-developers/cross-model-verification) pour le flux de travail avancé, ou lisez la suite pour comprendre comment la configuration IA de VMark fonctionne en coulisses.

## Un fichier, tous les outils

Les outils de codage IA lisent chacun leur propre fichier de configuration :

| Outil | Fichier de configuration |
|-------|--------------------------|
| Claude Code | `CLAUDE.md` |
| Codex CLI | `AGENTS.md` |
| Gemini CLI | `GEMINI.md` |

Maintenir les mêmes instructions en trois endroits est source d'erreurs. VMark résout cela avec une source de vérité unique :

- **`AGENTS.md`** — Contient toutes les règles du projet, conventions et notes d'architecture.
- **`CLAUDE.md`** — Juste une ligne : `@AGENTS.md` (une directive Claude Code qui intègre le fichier).
- **Codex CLI** — Lit `AGENTS.md` directement.
- **Gemini CLI** — Utilise `@AGENTS.md` dans `GEMINI.md` pour intégrer le même fichier.

Mettez à jour `AGENTS.md` une fois, et chaque outil récupère le changement.

::: tip Qu'est-ce que `@AGENTS.md` ?
Le préfixe `@` est une directive Claude Code qui intègre le contenu d'un autre fichier. C'est similaire à `#include` en C — le contenu de `AGENTS.md` est inséré dans `CLAUDE.md` à cette position. En savoir plus sur [agents.md](https://agents.md/).
:::

## Utiliser Codex comme second avis

VMark utilise la vérification croisée entre modèles — Claude écrit le code, puis Codex (un modèle IA différent d'OpenAI) l'audite de manière indépendante. Cela détecte les angles morts qu'un seul modèle pourrait manquer. Pour tous les détails et les instructions de configuration, voir [Vérification croisée entre modèles](/fr/guide/users-as-developers/cross-model-verification).

## Ce que l'IA sait

Lorsqu'un outil de codage IA ouvre le dépôt VMark, il reçoit automatiquement :

### Règles du projet (`.claude/rules/`)

Ces fichiers sont chargés automatiquement dans chaque session Claude Code. Ils couvrent :

| Règle | Ce qu'elle impose |
|-------|------------------|
| Flux de travail TDD | Le test-first est obligatoire ; les seuils de couverture bloquent le build |
| Tokens de design | Ne jamais coder les couleurs en dur — référence complète des tokens CSS incluse |
| Patterns de composants | Patterns de popup, barre d'outils, menu contextuel avec exemples de code |
| Indicateurs de focus | Accessibilité : le focus clavier doit toujours être visible |
| Thème sombre | Règles du sélecteur `.dark-theme`, exigences de parité des tokens |
| Raccourcis clavier | Procédure de synchronisation en trois fichiers (Rust, TypeScript, docs) |
| Mises à jour de version | Procédure de mise à jour en cinq fichiers |
| Conventions du code | Patterns de store, hook, plugin, test et import |

### Compétences personnalisées

Les commandes slash donnent à l'IA des capacités spécialisées :

| Commande | Ce qu'elle fait |
|----------|----------------|
| `/fix` | Corriger les problèmes correctement — analyse des causes racines, TDD, pas de patches |
| `/fix-issue` | Résolveur de problème GitHub de bout en bout (fetch, branch, fix, audit, PR) |
| `/codex-audit` | Audit de code complet en 9 dimensions (sécurité, exactitude, conformité, ...) |
| `/codex-audit-mini` | Vérification rapide en 5 dimensions pour les petits changements |
| `/codex-verify` | Vérifier les corrections d'un audit précédent |
| `/codex-commit` | Messages de commit intelligents à partir de l'analyse des changements |
| `/audit-fix` | Auditer, corriger tous les résultats, vérifier — répéter jusqu'à obtenir un résultat propre |
| `/feature-workflow` | Flux de travail complet avec des agents spécialisés |
| `/merge-prs` | Examiner et fusionner les PRs ouvertes séquentiellement |
| `/bump` | Mise à jour de version dans les 5 fichiers, commit, tag, push |

### Agents spécialisés

Pour les tâches complexes, Claude Code peut déléguer à des sous-agents spécialisés :

| Agent | Rôle |
|-------|------|
| Planner | Recherche les meilleures pratiques, réfléchit aux cas limites, produit des plans modulaires |
| Implementer | Implémentation pilotée par TDD avec investigation préliminaire |
| Auditor | Examine les diffs pour la correction et les violations de règles |
| Test Runner | Exécute les contrôles, coordonne les tests E2E via Tauri MCP |
| Verifier | Liste de contrôle finale avant la sortie |

## Surcharges privées

Tout n'appartient pas à la configuration partagée. Pour les préférences personnelles :

| Fichier | Partagé ? | Objectif |
|---------|-----------|---------|
| `AGENTS.md` | Oui | Règles du projet pour tous les outils IA |
| `CLAUDE.md` | Oui | Point d'entrée Claude Code |
| `.claude/settings.json` | Oui | Permissions partagées par l'équipe |
| `CLAUDE.local.md` | **Non** | Vos instructions personnelles (gitignored) |
| `.claude/settings.local.json` | **Non** | Vos paramètres personnels (gitignored) |

Créez `CLAUDE.local.md` à la racine du projet pour les instructions qui ne s'appliquent qu'à vous — langue préférée, habitudes de flux de travail, préférences d'outils.
