# Référence des outils MCP

VMark expose **sept outils MCP composites** aux assistants IA&nbsp;: `session`, `workspace`, `document`, `workflow`, `selection`, `browser` et `coherence`. Ensemble, ils couvrent la colonne vertébrale de l'éditeur, le cycle de vie fichier/fenêtre, les modifications de workflow sûres au CST, les modifications ciblées sur la sélection, la navigation web bornée et une vue en lecture seule de la couche de cohérence de l'espace de travail.

La précédente surface de 12 outils / 76 actions a été élaguée parce que les outils de mise en forme intra-document (gras, titres, tableaux, etc.) dupliquent un travail que les agents IA effectuent déjà trivialement via un aller-retour Markdown. Voir [le plan d'élagage MCP](https://github.com/xiaolai/vmark/blob/main/dev-docs/plans/20260504-mcp-pruning.md) pour la justification complète.

::: tip Flux de travail recommandé
1. Appelez `session.get_state` une fois pour voir les fenêtres ouvertes, les onglets et `{filePath, dirty, revision, kind}` par onglet.
2. Pour Markdown&nbsp;: `document.read` → raisonner → `document.write` (en passant `expected_revision` pour une concurrence sûre).
3. Pour YAML GitHub Actions (`kind: "yaml-workflow"`)&nbsp;: `workflow.apply_patch` pour des modifications sûres au CST qui préservent les commentaires et les ancres&nbsp;; `workflow.validate` pour les diagnostics actionlint.
4. Les opérations sur fichiers (ouvrir, enregistrer, fermer, basculer d'onglet) résident sur `workspace`.
:::

::: tip Diagrammes Mermaid
Lors de l'utilisation de l'IA pour générer du Mermaid via MCP, envisagez d'installer le [serveur MCP mermaid-validator](/fr/guide/mermaid#serveur-mcp-mermaid-validator-v%C3%A9rification-de-la-syntaxe) — il détecte les erreurs de syntaxe en utilisant les mêmes parseurs Mermaid v11 avant que les diagrammes n'atteignent votre document.
:::

---

## `session`

Orientation en un coup. Découvrez chaque fenêtre, chaque onglet et les capacités du serveur en un seul appel.

### `get_state`

Aucun argument.

**Retourne** `{windows, capabilities}`&nbsp;:

```json
{
  "windows": [
    {
      "label": "main",
      "focused": true,
      "tabs": [
        {
          "id": "tab-1",
          "filePath": "/path/to/notes.md",
          "title": "notes",
          "dirty": false,
          "revision": "rev-x7Q3aB1F",
          "kind": "markdown"
        },
        {
          "id": "tab-2",
          "filePath": "/repo/.github/workflows/ci.yml",
          "title": "ci",
          "dirty": true,
          "revision": "rev-x7Q3aB1F",
          "kind": "yaml-workflow"
        }
      ]
    }
  ],
  "capabilities": {
    "version": "<vmark-mcp-server version>",
    "supportedKinds": ["markdown", "yaml-workflow"],
    "mcpProtocol": "0.2.0"
  }
}
```

Le discriminant `kind` vous indique s'il faut utiliser `document.write` (pour markdown) ou `workflow.apply_patch` (pour yaml-workflow) sur cet onglet.

---

## `workspace`

Cycle de vie des fichiers et fenêtres. Rien dans le document.

### `new`

Créer un nouvel onglet sans titre.

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `kind` | string | Non | `"markdown"` (par défaut) ou `"yaml-workflow"` |
| `windowLabel` | string | Non | Fenêtre cible&nbsp;; par défaut, la fenêtre focalisée |

Retourne `{tabId}`.

### `open`

Ouvrir un fichier depuis le disque.

| Paramètre | Type | Requis |
|-----------|------|--------|
| `filePath` | string | Oui |
| `windowLabel` | string | Non |

Retourne `{tabId}`.

### `save`

Enregistrer un onglet vers son chemin existant.

| Paramètre | Type | Requis |
|-----------|------|--------|
| `tabId` | string | Non (par défaut, focalisé) |

Retourne `{filePath, revision}`.

### `save_as`

Enregistrer un onglet vers un nouveau chemin.

| Paramètre | Type | Requis |
|-----------|------|--------|
| `tabId` | string | Non |
| `filePath` | string | Oui |

Retourne `{revision}`.

### `close`

Fermer un onglet. Refuse de jeter du travail non enregistré sans `force`.

| Paramètre | Type | Requis |
|-----------|------|--------|
| `tabId` | string | Oui |
| `force` | boolean | Non |

Retourne `{closed: true}` en cas de succès, `{closed: false, reason: "DIRTY"}` si l'onglet est modifié et `force` n'a pas été fourni.

### `switch_tab`

Activer un onglet.

| Paramètre | Type | Requis |
|-----------|------|--------|
| `tabId` | string | Oui |

### `focus_window`

Mettre au point une fenêtre.

| Paramètre | Type | Requis |
|-----------|------|--------|
| `windowLabel` | string | Oui |

---

## `document`

Lire, écrire, transformer. La colonne vertébrale de la surface.

### `read`

| Paramètre | Type | Requis |
|-----------|------|--------|
| `tabId` | string | Non (par défaut, focalisé) |

Retourne `{content, revision, filePath, kind, dirty}`. Toujours lire avant d'écrire — le jeton `revision` doit accompagner le prochain `write`.

### `write`

Remplacer le contenu complet du document.

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `tabId` | string | Non | Onglet cible (par défaut, focalisé) |
| `content` | string | Oui | Nouveau contenu complet |
| `expected_revision` | string | Non | Jeton de révision de la lecture la plus récente |

Si `expected_revision` est fourni et que le document a changé depuis cette lecture, la réponse est une enveloppe d'erreur structurée `STALE` avec la révision actuelle&nbsp;; relire et réessayer.

```json
// succès
{ "revision": "rev-newAfterWrite" }

// obsolète
{ "error": "STALE", "message": "Document has changed since the last read", "current_revision": "rev-currentNow" }
```

### `transform`

Appliquer une réécriture déterministe. Prend actuellement en charge les transformations spécifiques au CJK (conversion ponctuation pleine largeur ↔ ASCII, espacement CJK ↔ Latin).

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `tabId` | string | Non | Onglet cible |
| `kind` | string | Oui | `"cjk-format"`, `"cjk-spacing"` ou `"cjk-punctuation"` |
| `expected_revision` | string | Non | Jeton de concurrence |

`cjk-format` applique de bout en bout les paramètres de mise en forme CJK de l'utilisateur. `cjk-spacing` insère des espaces simples entre les caractères CJK et les caractères latins/chiffres adjacents. `cjk-punctuation` convertit la ponctuation ASCII qui se trouve à côté des caractères CJK vers sa forme pleine largeur.

Retourne `{revision}`.

---

## `workflow`

Validation `actionlint` et **modifications chirurgicales sûres au CST** pour le YAML de workflow GitHub Actions. Disponible uniquement pour les onglets dont le `kind` est `"yaml-workflow"`.

::: info `document.read` / `document.write` fonctionnent sur tous les onglets — y compris le YAML de workflow
L'outil `workflow` n'est **pas** un substitut à la colonne vertébrale lecture/écriture. Pour un onglet de workflow, vous pouvez&nbsp;:

- `document.read` pour obtenir le texte YAML brut (avec tous les commentaires)
- `document.write` pour le remplacer en gros (la chaîne que vous envoyez est stockée verbatim — commentaires préservés si vous les incluez)
- `workflow.apply_patch` lorsque vous voulez **que le serveur lui-même garantisse** que les commentaires, ancres et ordre des clés survivent à une modification partielle

Utilisez `apply_patch` lors du changement d'un champ en laissant tout le reste intact (le serveur ne peut pas supprimer les commentaires qu'il ne change pas). Utilisez `document.write` quand vous réécrivez en gros ou générez un nouveau workflow à partir de zéro.
:::

### `apply_patch`

Appliquer un tableau d'objets `IRPatch`. Les patches sont distribués via les mutateurs sensibles au CST de VMark, qui préservent les commentaires, ancres et ordre des clés. Un `document.write` brut sur un fichier YAML les perdrait.

| Paramètre | Type | Requis |
|-----------|------|--------|
| `tabId` | string | Non |
| `patches` | IRPatch[] | Oui |
| `expected_revision` | string | Non |

`IRPatch` est une union discriminée (champ `kind`). Types pris en charge&nbsp;:

| `kind` | Effet |
|---|---|
| `workflow.set` | Définir des champs de premier niveau (`{path, value}`) — `name`, `env.X`, etc. |
| `job.set` | Définir un champ sur un job (`{jobId, path, value}`) |
| `step.set` | Définir un champ sur une étape (`{jobId, stepIndex, path, value}`) |
| `with.set` | Définir une clé dans le bloc `with:` d'une étape (`{jobId, stepIndex, key, value}`) |
| `with.remove` | Supprimer une clé du bloc `with:` d'une étape |
| `needs.add` / `needs.remove` | Ajouter ou supprimer un ID de job de `needs:` |
| `trigger.setFilters` | Remplacer un tableau de filtres de déclencheur — branches, paths, types, etc. (`{event, filter, value: string[]}`) |

Retourne `{revision}` en cas de succès ou une enveloppe d'erreur structurée `STALE` / `INVALID_PATCH` / `NOT_WORKFLOW`.

### `validate`

Exécuter `actionlint` sur le YAML du workflow.

| Paramètre | Type | Requis |
|-----------|------|--------|
| `tabId` | string | Non |

Retourne `{ok, diagnostics, binaryAvailable}`. Chaque diagnostic porte `{line, col, message, severity}`. `binaryAvailable: false` signifie qu'`actionlint` n'est pas installé localement&nbsp;; installez via Homebrew ou les versions amont.

---

## `coherence`

Une vue **en lecture seule** de la couche de cohérence de l'espace de travail — quels documents dérivés sont obsolètes par rapport aux amonts dont ils ont été générés. Aucune des deux actions ne modifie les documents, le registre ni aucun état de l'éditeur&nbsp;; les deux sont entièrement traitées par le backend Rust à partir du noyau propre à chaque espace de travail, elles fonctionnent donc même quand aucune fenêtre d'éditeur n'est au premier plan.

Deux actions supplémentaires en lecture seule exposent la couche sémantique&nbsp;:

- `claims` — les affirmations canoniques actuelles&nbsp;: `{claim, entryId, statement, maturity, invalidAt, visible}`. Seules les affirmations `established` contraignent les vérifications sémantiques&nbsp;; `visible` reflète le contexte default.
- `contexts` — l'ensemble des contextes (le `default` implicite est toujours présent)&nbsp;: `{id, name, parent, enforcement, visibleClaims, errors}`.

Toutes les actions exigent `workspace_root`&nbsp;: le chemin absolu de l'espace de travail à interroger. Obtenez-le via `session.get_state` (le `filePath` des onglets ouverts) ou l'outil workspace. Un chemin manquant, non absolu ou qui n'est pas un répertoire est refusé avec une erreur en chaîne simple.

### `status`

Compteurs d'état du noyau pour un espace de travail.

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `workspace_root` | string | Oui | Chemin absolu de l'espace de travail à interroger |

**Retourne&nbsp;:**

```json
{
  "initialized": true,
  "objects": 12,
  "open_items": 2,
  "quarantined": 0,
  "writer": "0198c0de-0000-7000-8000-000000000001"
}
```

| Champ | Signification |
|---|---|
| `initialized` | `false` quand l'espace de travail n'a pas encore de registre de cohérence (pas de répertoire `.vmark/`). Tous les compteurs sauf `objects` valent alors 0. |
| `objects` | Objets suivis (fichiers dotés d'une identité de cohérence). |
| `open_items` | Arêtes vivantes non à jour — la taille actuelle du détail. |
| `quarantined` | Lignes de registre malformées mises en quarantaine lors de la dernière lecture. |
| `writer` | L'identifiant writer (UUID) de cette installation. |

### `edges`

Le détail&nbsp;: chaque arête de dépendance vivante dont l'amont a bougé. Exécute d'abord une analyse-rapprochement, la réponse reflète donc les fichiers sur disque au moment de l'appel.

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `workspace_root` | string | Oui | Chemin absolu de l'espace de travail à interroger |

**Retourne** un tableau — vide quand tout est cohérent&nbsp;:

```json
[
  {
    "txf": "0198c0de-0000-7000-8000-00000000000a",
    "input": 0,
    "upstream": "0198c0de-0000-7000-8000-00000000000b",
    "upstream_path": "characters/elena.md",
    "pinned": "rev-a1b2c3",
    "downstream": "0198c0de-0000-7000-8000-00000000000c",
    "downstream_path": "scenes/chapter-3.md",
    "downstream_rev": "rev-d4e5f6",
    "state": "version-stale"
  }
]
```

| Champ | Signification |
|---|---|
| `txf` / `input` | L'entrée de transformation et l'emplacement d'entrée qui identifient cette arête (à passer aux actions de résolution dans l'application). |
| `upstream` / `upstream_path` | L'objet dont dépend l'aval, et son dernier chemin connu. |
| `pinned` | La révision amont dont l'aval a été généré. |
| `downstream` / `downstream_path` / `downstream_rev` | L'objet dérivé, son chemin et sa révision actuelle. |
| `state` | `"version-stale"`, `"stale-valid"`, `"stale-contradicted"`, `"stale-unknown"`, `"waived"`, `"diverged"`, `"diverged-multi-head"` ou `"unpinnable"`. |

Résoudre une arête (accepter la plus récente / exempter) est une action humaine effectuée dans la vue Détail de VMark — elle n'est délibérément pas exposée via MCP.

---

## Erreurs

Deux formes d'erreurs apparaissent&nbsp;:

**Erreurs de domaine** — définissent `success: false` et retournent une enveloppe encodée en JSON dans `error`&nbsp;:

```json
{ "error": "STALE", "message": "...", "current_revision": "rev-..." }
```

**Erreurs de forme d'argument** — pour les arguments requis manquants/invalides (par ex. `document.write` sans champ `content`), `error` est une simple chaîne décrivant le problème. L'enveloppe structurée est réservée aux conditions au niveau du domaine.

| Code | Apparaît comme | Signification |
|---|---|---|
| `STALE` | enveloppe | `expected_revision` ne correspondait pas&nbsp;; relire et réessayer |
| `INVALID_PATCH` | enveloppe | `workflow.apply_patch` a reçu un tableau `patches` malformé |
| `INVALID_TAB` | enveloppe | `tabId` n'a pas pu être résolu |
| `INVALID_PATH` | enveloppe | `workspace.open` a reçu un `filePath` qui n'a pas pu être lu |
| `NOT_WORKFLOW` | enveloppe | `workflow.*` a été appelé sur un onglet non-YAML-workflow |
| `READ_ONLY` | enveloppe | Une mutation a été tentée sur un document en lecture seule |
| `INTERNAL` | enveloppe | Erreur de gestionnaire inattendue |
| (chaîne simple) | chaîne | Argument requis manquant ou type incorrect |
