# Visualiseur de workflows GitHub Actions

VMark affiche le YAML des workflows GitHub Actions sous forme de graphe orienté acyclique (DAG) interactif et vous permet de modifier les jobs, les étapes et les déclencheurs via des formulaires structurés — sans jamais perdre les commentaires, les ancres ou la mise en forme du fichier sous-jacent.

La fonctionnalité opère sur deux surfaces&nbsp;:

1. **Fichiers `.yml` autonomes** sous `.github/workflows/` (ou tout fichier dont la structure de premier niveau correspond à celle d'un workflow)&nbsp;: vue partagée avec la source à gauche et le canevas interactif + l'éditeur de formulaires à droite.
2. **Blocs de code Markdown**&nbsp;: lorsqu'un bloc avec triple accent grave en `yaml` ou `yml` contient un workflow reconnu, VMark le rend en ligne sous forme de DAG façon Mermaid, comme les blocs `mermaid`.

## Fichiers de workflow autonomes

Ouvrez n'importe quel fichier `.github/workflows/*.yml` dans VMark. Le panneau latéral droit s'ouvre automatiquement et affiche&nbsp;:

- L'intégralité du workflow sous forme de canevas React Flow interactif (les jobs comme nœuds, les dépendances `needs:` comme arêtes).
- Un panneau d'éditeur structuré sous le canevas.
- Des commandes Enregistrer / Annuler dans l'en-tête de l'éditeur.

Cliquez sur un job dans le canevas pour le modifier. Cliquez sur une étape à l'intérieur du job pour modifier cette étape.

### Modification des jobs

Champs modifiables&nbsp;:

| Champ | Type de patch |
|-------|---------------|
| `name` | `job.set` |
| `runs-on` | `job.set` |
| `if` | `job.set` |

Résumé en lecture seule&nbsp;: nombre d'étapes, `needs:` et `uses:` (pour les jobs de workflows réutilisables).

### Modification des étapes

Champs modifiables&nbsp;:

| Champ | Type de patch |
|-------|---------------|
| `name` | `step.set` |
| `run` (pour les étapes run) | `step.set` |
| `working-directory` | `step.set` |
| `if` | `step.set` |
| Clés `with:` | `with.set` / `with.remove` |

Le bloc `with:` se présente sous forme de lignes clé/valeur ajoutables, modifiables et supprimables. Renommer une clé émet un `with.remove` pour l'ancienne clé suivi d'un `with.set` pour la nouvelle.

Pour les étapes `uses:`, la référence d'action elle-même est en lecture seule — modifiez-la dans la source si vous avez besoin d'une autre action.

### Déclencheurs

Le résumé des déclencheurs (événement, branches, tags, chemins, cron, types) est en lecture seule dans cette version. Modifier la structure dense des déclencheurs via des champs sur une seule ligne serait trop dégradant&nbsp;; éditez les déclencheurs dans la source jusqu'à la livraison d'un sélecteur dédié.

## Enregistrement des modifications

Les modifications s'accumulent dans une liste de patchs en mémoire à mesure que vous changez les champs. Le bouton Enregistrer affiche le compteur courant (par ex. **3 non enregistrés**).

Lorsque vous cliquez sur Enregistrer, VMark&nbsp;:

1. Lit le YAML actuel depuis l'éditeur.
2. Applique tous les patchs en file d'attente sur l'arbre syntaxique concret (CST) du YAML — préservant les commentaires, les ancres et la mise en forme existante.
3. Réécrit le résultat dans l'éditeur comme si vous l'aviez tapé.

Le fichier devient modifié au sens habituel&nbsp;; appuyez sur **Cmd+S** pour écrire sur le disque.

### Préservation de la mise en forme

Le chemin d'enregistrement par défaut fait passer chaque patch par l'API CST du paquet `yaml` — les commentaires, les nœuds d'ancre, l'indentation personnalisée et les choix de style flow vs bloc existants sont préservés.

Désactivez **Préserver la mise en forme YAML à l'enregistrement** dans Paramètres → Avancé si vous préférez une sortie reformatée canonique. Le chemin de reformatage supprime les commentaires&nbsp;; il s'agit donc d'un choix explicite.

## Blocs de code en Markdown

Saisissez un workflow dans un bloc de code YAML&nbsp;:

````markdown
```yaml
name: ci
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test
```
````

VMark détecte la structure du workflow (`jobs:` au plus haut niveau avec `runs-on` par job) et rend le diagramme en ligne. Le diagramme est en lecture seule — modifiez la source pour changer le workflow.

## Diagnostics

VMark fait apparaître les diagnostics d'analyse et de lint à côté de la source&nbsp;:

| Préfixe de code | Signification |
|-----------------|---------------|
| `GHA-PARSE-*` | YAML mal formé ou clés requises manquantes |
| `GHA-JOB-*` | Problèmes au niveau du job (id en double, conflit `uses:` + `steps:`) |
| `GHA-NEEDS-*` | Problèmes de dépendances (référence inconnue, cycle) |
| `GHA-STEP-*` | Problèmes au niveau de l'étape |
| `GHA-EXPR-*` | Références de contexte inconnues |
| `GHA-MATRIX-*` | Problèmes d'expansion de matrice |
| `GHA-SEC-*` | Avertissements de sécurité (par ex. schémas de checkout `pull_request_target`) |
| `GHA-ACTIONLINT-*` | Diagnostic relayé depuis `actionlint` s'il est installé |

Installez `actionlint` et activez **Utiliser actionlint si disponible** dans Paramètres → Avancé pour des diagnostics d'expressions plus riches.

## Métadonnées d'action

Pour les étapes `uses:` qui référencent des GitHub Actions publiques, VMark peut récupérer le `action.yml` de chaque action pour alimenter les descriptions des entrées dans l'éditeur structuré. Cette option est facultative et mise en cache sur disque pendant 24 heures.

Activez **Récupérer les métadonnées d'action** dans Paramètres → Avancé. Désactivez-la pour conserver toutes les références d'action en texte pur — aucune requête réseau n'est effectuée.

## Exports

Le panneau latéral du workflow inclut trois options d'export accessibles depuis le menu de son en-tête&nbsp;:

| Format | Utilisation |
|--------|-------------|
| **Mermaid** | Intégration dans des README et autres documents markdown. Avec perte&nbsp;: omet le statut d'exécution, les icônes d'action, les badges personnalisés et les détails d'expansion de matrice. |
| **SVG** | Intégration dans des documents nécessitant des graphiques vectoriels. Utilise `foreignObject` pour le contenu HTML. |
| **PNG** | Partage en messagerie ou partout où le SVG n'est pas pris en charge. Rendu au niveau de zoom courant du canevas. |

## Ce que ce n'est pas

VMark n'exécute pas les workflows GitHub Actions. C'est un visualiseur et un éditeur — l'exécution reste l'affaire de GitHub. La fonctionnalité sert uniquement à lire, relire et créer du YAML de workflow.
