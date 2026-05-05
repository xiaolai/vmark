# Référence des outils MCP

VMark expose **quatre outils MCP composites** aux assistants IA&nbsp;: `session`, `workspace`, `document` et `workflow`. Ensemble, ils couvrent **14 actions** — la colonne vertébrale lecture/écriture plus le cycle de vie fichier/fenêtre plus les modifications sûres au CST pour le YAML GitHub Actions.

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
    "mcpProtocol": "0.1.0"
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
