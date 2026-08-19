# Référence des outils MCP

VMark expose **neuf outils MCP composites** aux assistants IA&nbsp;: `session`, `workspace`, `document`, `workflow`, `selection`, `browser`, `browser_read`, `coherence` et `coherence_resolve`. Ensemble, ils couvrent la colonne vertébrale de l'éditeur, le cycle de vie fichier/fenêtre, les modifications de workflow sûres au CST, les modifications ciblées sur la sélection, la navigation web bornée et une vue de la couche de cohérence de l'espace de travail.

Trois des neuf — `session`, `browser_read` et `coherence` — déclarent `readOnlyHint: true`, de sorte qu'un client MCP peut les approuver automatiquement. C'est précisément pour cela que `browser`/`browser_read` et `coherence`/`coherence_resolve` sont des outils distincts&nbsp;: les annotations sont **par outil**, pas par action&nbsp;; un outil qui regroupe un instantané ARIA avec `execute_js` doit donc annoncer le danger d'`execute_js`. Répartir selon «&nbsp;est-ce que ceci modifie quelque chose&nbsp;?&nbsp;» permet à chaque moitié de dire la vérité, et garde les actions véritablement destructrices de la surface bien visibles dans la liste des outils.

La précédente surface de 12 outils / 76 actions a été élaguée parce que les outils de mise en forme intra-document (gras, titres, tableaux, etc.) dupliquent un travail que les agents IA effectuent déjà trivialement via un aller-retour Markdown. `selection` a été conservé (conformément à l'ADR-7 du plan d'élagage) parce que l'aller-retour sur le document complet n'est pas économique sur les gros fichiers — chaque modification paie le document entier en jetons d'entrée, le document entier en jetons de sortie (~5× le prix de l'entrée), et une fenêtre d'écriture plus longue qui élargit la boucle de réessai sur révision obsolète. Voir [le plan d'élagage MCP](https://github.com/xiaolai/vmark/blob/main/dev-docs/plans/20260504-mcp-pruning.md) pour la justification complète.

::: tip Flux de travail recommandé
1. Appelez `session.get_state` une fois pour voir les fenêtres ouvertes, les onglets et `{filePath, dirty, revision, kind}` par onglet.
2. Pour de petites modifications Markdown ou des réécritures complètes&nbsp;: `document.read` → raisonner → `document.write` (en passant `expected_revision` pour une concurrence sûre).
3. Pour des modifications ciblées sur un gros fichier Markdown quand l'utilisateur a sélectionné la région à changer&nbsp;: `selection.get` → raisonner → `selection.set` (réduit le coût en jetons d'entrée comme de sortie à la seule sélection).
4. Pour le YAML GitHub Actions (`kind: "yaml-workflow"`)&nbsp;: `workflow.apply_patch` pour des modifications sûres au CST qui préservent les commentaires et les ancres&nbsp;; `workflow.validate` pour les diagnostics actionlint.
5. Les opérations sur fichiers (ouvrir, enregistrer, fermer, basculer d'onglet) résident sur `workspace`.
:::

::: tip Diagrammes Mermaid
Lors de l'utilisation de l'IA pour générer du Mermaid via MCP, envisagez d'installer le [serveur MCP mermaid-validator](/guide/mermaid#mermaid-validator-mcp-server-syntax-checking) — il détecte les erreurs de syntaxe en utilisant les mêmes parseurs Mermaid v11 avant que les diagrammes n'atteignent votre document.
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
      "activeWorkspaceInstanceId": "wsi-a1b2c3",
      "tabs": [
        {
          "id": "tab-1",
          "filePath": "/path/to/notes.md",
          "title": "notes",
          "dirty": false,
          "revision": "rev-x7Q3aB1F",
          "kind": "markdown",
          "active": true,
          "visible": true
        },
        {
          "id": "tab-2",
          "filePath": "/repo/.github/workflows/ci.yml",
          "title": "ci",
          "dirty": true,
          "revision": "rev-x7Q3aB1F",
          "kind": "yaml-workflow",
          "active": false,
          "visible": false
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

#### Savoir ce qui est réellement à l'écran

Un onglet peut exister, être adressable et ne toujours pas être affiché. Trois champs le disent&nbsp;:

| Champ | Signification |
|---|---|
| `tab.active` | Cet onglet est l'onglet courant de sa fenêtre. |
| `tab.visible` | Cet onglet est rendu à l'instant présent. Il vaut `false` quand l'onglet appartient à une instance d'espace de travail que la fenêtre n'affiche pas actuellement. |
| `window.activeWorkspaceInstanceId` | L'instance d'espace de travail que la fenêtre affiche, ou `null` quand le rail des espaces de travail est désactivé (tous les onglets sont alors visibles). |

`window.focused` est la fenêtre que l'**utilisateur** regarde, lue depuis le système d'exploitation. Ce n'est pas «&nbsp;la fenêtre qui a répondu à cette requête&nbsp;» — VMark achemine une requête vers la fenêtre qui possède l'espace de travail concerné, ce qui, dans une session multifenêtre, est souvent une autre fenêtre.

Considérez ces champs comme l'étape de confirmation&nbsp;: après `workspace.switch_tab`, un `get_state` de suivi vous indique si l'onglet est réellement devant l'utilisateur. `switch_tab` relit lui-même les stores avant de répondre&nbsp;; il rapporte donc `activated: false` quand une activation n'a pas abouti, au lieu de renvoyer la requête en écho.

Le discriminant `kind` vous indique s'il faut utiliser `document.write` (pour markdown) ou `workflow.apply_patch` (pour yaml-workflow) sur cet onglet.

---

## `workspace`

Cycle de vie des fichiers et fenêtres. Rien dans le document.

> **Portée des chemins.** Les opérations sur fichiers (`open`, `save`, `save_as`) sont
> confinées à la racine de l'espace de travail ouvert et aux répertoires des documents
> déjà ouverts. Une requête portant sur un chemin hors de cette portée est refusée avec
> `INVALID_PATH`. Sans espace de travail ni document ouvert, il n'y a pas de portée&nbsp;;
> les opérations sur fichiers sont alors refusées. Cela maintient un client automatisé
> dans les limites de ce que vous avez ouvert.

### `new`

Créer un nouvel onglet sans titre.

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `kind` | string | Non | `"markdown"` (par défaut) ou `"yaml-workflow"` |
| `windowLabel` | string | Non | Fenêtre cible&nbsp;; par défaut, la fenêtre focalisée |

Retourne `{tabId}`.

### `open`

Ouvrir un **fichier** depuis le disque dans un onglet **en arrière-plan** — l'onglet
visible de l'utilisateur et son espace de travail ne changent pas. Enchaînez le `tabId`
retourné dans des appels `document` / `selection`&nbsp;; n'utilisez `switch_tab` que
lorsque l'utilisateur doit *voir* l'onglet.

| Paramètre | Type | Requis |
|-----------|------|--------|
| `filePath` | string | Oui |
| `windowLabel` | string | Non |

Retourne `{tabId, workspaceInstanceId, activationChanged, workspaceSwitched}`.

### `open_workspace`

Ouvrir un **dossier** comme espace de travail actif. Contrairement à `open` (un fichier
unique à l'intérieur d'une arborescence déjà consentie), ceci accorde à l'assistant
l'accès à une toute nouvelle arborescence de fichiers&nbsp;; l'opération est donc
**encadrée par une approbation ponctuelle de l'utilisateur** et n'est pas couverte par la
portée des chemins ci-dessus.

| Paramètre | Type | Requis |
|-----------|------|--------|
| `folderPath` | string | Oui |

`windowLabel` n'est **pas** accepté ici, contrairement à `new` et `open`. Le dossier
s'ouvre toujours dans la fenêtre où la requête arrive. C'est délibéré&nbsp;: la boîte de
dialogue d'approbation et l'ouverture doivent atterrir dans la même fenêtre, et une
étiquette fournie par le client pourrait présenter l'invite devant une fenêtre tout en en
modifiant une autre — approuver une chose et en obtenir une autre. Le ciblage multifenêtre
nécessite un routage des requêtes qui n'existe pas encore.

**Flux d'approbation.** Le premier appel retourne `{needsApproval: true}` et affiche une
boîte de dialogue de consentement nommant le chemin *canonique* du dossier (liens
symboliques résolus). L'assistant devrait demander à l'utilisateur, puis **réessayer le
même appel**&nbsp;; une fois que l'utilisateur approuve, le nouvel essai ouvre le dossier.
Une requête refusée continue d'échouer jusqu'à ce qu'elle soit ré-approuvée. Il n'y a pas
d'option «&nbsp;se souvenir&nbsp;» — chaque ouverture est approuvée individuellement.

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

Enregistrer vers un chemin autre que le fichier courant de l'onglet est traité comme une
nouvelle écriture. Lorsque **Approuver automatiquement les modifications** (Paramètres →
Intégrations) est désactivé (par défaut), une telle requête est refusée avec
`APPROVAL_REQUIRED` et une notification vous indique ce qui a été bloqué. Enregistrer de
nouveau vers le chemin propre de l'onglet est toujours autorisé.

### `close`

Fermer un onglet. Refuse de jeter du travail non enregistré sans `force`.

| Paramètre | Type | Requis |
|-----------|------|--------|
| `tabId` | string | Oui |
| `force` | boolean | Non |

Retourne `{closed: true}` en cas de succès, `{closed: false, reason: "DIRTY"}` si l'onglet est modifié et `force` n'a pas été fourni.

### `switch_tab`

Activer un onglet et le rendre **visible**. Avec le [rail des espaces de travail](/guide/workspace-rail)
activé, ceci peut changer le contexte d'espace de travail actif de l'utilisateur — la
réponse rapporte `workspaceSwitched: true` lorsque c'est le cas, l'assistant devrait donc
le signaler à l'utilisateur.

| Paramètre | Type | Requis |
|-----------|------|--------|
| `tabId` | string | Oui |

Retourne `{activated, workspaceSwitched, workspaceInstanceId, activeTabId}`.

### `focus_window`

Donner le focus à une fenêtre.

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
// success
{ "revision": "rev-newAfterWrite" }

// stale
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

## `selection`

Lire ou remplacer la sélection actuelle de l'utilisateur dans l'éditeur. Utilisez ceci plutôt que `document.read`/`document.write` lorsque l'utilisateur a mis en surbrillance la région à changer — `selection.get` retourne uniquement la portion sélectionnée, et `selection.set` réécrit uniquement cette plage, de sorte que le coût en jetons croît avec la modification, non avec le document.

::: warning La sélection est un état de vue — onglet focalisé uniquement
La sélection n'existe que dans l'éditeur actuellement rendu. Si `tabId` est fourni, il doit correspondre à l'onglet focalisé&nbsp;; une non-correspondance retourne `INVALID_TAB`. Si l'onglet focalisé n'a pas d'éditeur actif (par ex. une visionneuse en lecture seule), la réponse est `NO_EDITOR`.
:::

### `get`

| Paramètre | Type | Requis |
|-----------|------|--------|
| `tabId` | string | Non |

Retourne&nbsp;:

| Champ | Type | Remarques |
|---|---|---|
| `text` | string | Sérialisation Markdown de la portion sélectionnée (mode WYSIWYG), ou texte sélectionné brut (mode source). Chaîne vide quand la sélection est réduite. |
| `isEmpty` | boolean | `true` quand la sélection est réduite (curseur seul). |
| `range` | `{from, to}` | Positions ProseMirror en mode WYSIWYG&nbsp;; décalages de caractères en mode source. |
| `mode` | `"wysiwyg"` \| `"source"` | Lève l'ambiguïté sur l'espace de positions de `range`. |
| `kind` | `"markdown"` \| `"yaml-workflow"` | Discriminant du type de document. |
| `tabId` | string | Renvoyé en écho pour confirmation. |
| `revision` | string | À repasser dans `set` pour une concurrence optimiste. |

### `set`

| Paramètre | Type | Requis |
|-----------|------|--------|
| `tabId` | string | Non |
| `content` | string | Oui |
| `expected_revision` | string | Non (recommandé) |

Remplace ce que l'éditeur signale comme la sélection actuelle. **En mode WYSIWYG**, le texte en ligne simple est inséré comme un nœud de texte littéral, de sorte que les espaces de début/fin sont préservés à l'identique&nbsp;; un contenu portant des marqueurs markdown (`**bold**`, `*italic*`, `` `code` ``, code clôturé, citations, listes, etc.) est analysé comme du markdown et inséré sous forme des nœuds correspondants. **En mode source**, `content` est toujours inséré comme du texte brut — la surface source est déjà des octets markdown. Un `content` vide supprime la sélection. Lorsque la sélection est réduite, `content` est inséré au niveau du curseur.

Retourne `{revision, replaced_chars}` en cas de succès. `replaced_chars` est la longueur du texte qui était sélectionné avant l'appel — utile pour que l'IA confirme qu'elle a bien modifié ce qu'elle attendait.

`STALE` retourne `{error: "STALE", message, current_revision}`, exactement comme `document.write`. La révision au niveau du document capte les frappes entre `get` et `set`. Le simple déplacement du curseur (sans frappe) n'est pas arbitré par le serveur — si l'utilisateur a déplacé le curseur entre `get` et `set`, la modification se produit à la nouvelle position.

---

## `browser`

La moitié **mutante** de la surface du navigateur intégré — tout ce qui change la page,
l'onglet ou une connexion enregistrée. Lisez d'abord la page avec [`browser_read`](#browser-read)&nbsp;:
chaque mode de ciblage ici renvoie à ce qu'une lecture a retourné.

Les outils du navigateur suivent **Paramètres → Avancé → macOS → Navigateur intégré**, qui
est **activé par défaut** sur macOS — ces outils sont donc disponibles pour un client IA
connecté sauf si vous le désactivez. Chaque action échoue avec `BROWSER_DISABLED` tant
qu'il est désactivé. Les URL retournées à MCP sont expurgées via la même frontière que
celle utilisée par l'état de session du navigateur de l'application.

Annoté `readOnlyHint: false, destructiveHint: true` — exact plutôt que simplement prudent,
car chaque action ici modifie quelque chose.

### `act`

Arguments&nbsp;: `tabId?`, `operation: "click" | "type" | "scroll" | "key"`, et des cibles
propres à chaque opération&nbsp;:

- **click / type** — une cible, soit `ref` (issu d'une lecture antérieure), **soit**
  `role` + `name`, et `text?` pour la saisie. Un `ref` est précis et indépendant de
  l'ordre, mais il n'est honoré que pour une opération **déjà accordée**&nbsp;; si l'action
  peut nécessiter une autorisation, utilisez `role` + `name` afin que l'invite montre à
  l'utilisateur un élément lisible.
- **scroll** — `ref` (le faire défiler jusqu'à la vue) **ou** `dy` (un delta vertical en
  pixels).
- **key** — `key` (par ex. `"Enter"`, `"Escape"`, `"Tab"`), un `ref` cible optionnel, et
  des `modifiers: {ctrl, shift, alt, meta}` optionnels.

`scroll` et `key` sont de classe Action (soumis à autorisation) et émettent des événements
DOM **synthétiques**&nbsp;; un site qui se fie à `event.isTrusted` peut donc les ignorer.
Les opérations mutantes nécessitent une autorisation à la portée de l'origine&nbsp;; les
téléversements choisis par l'IA ne sont jamais permis.

**Un clic vérifie son effet avant de signaler un succès.** La cible est amenée dans la vue,
doit être rendue visiblement (les styles calculés et les ancêtres repliés sont vérifiés, de
sorte qu'un bouton en double à l'intérieur d'une étape d'accordéon fermée est ignoré, pas
cliqué), et le point de clic est testé par collision — une cible recouverte par une
surcouche est refusée en nommant l'élément qui la masque (`covered by div.cmp-overlay`)
plutôt que cliquée au travers. Les résultats par rôle + nom portent des décomptes
`matchedTotal` / `matchedVisible` afin que toute ambiguïté soit visible, et chaque réponse
d'action inclut l'`url` et la `generation` actuelles de l'onglet. `type` gère les champs de
texte, les contrôles `<select>` (passez le libellé ou la valeur de l'option&nbsp;; une
option absente est refusée comme `no-such-option`), et les régions `contenteditable`.

### `workflow_run` / `workflow_cancel`

`workflow_run` exécute un workflow que vous fournissez sous forme de texte `source` sur un
onglet appartenant à l'IA. Arguments&nbsp;: `tabId?`, `source` (le texte du workflow — une
petite grammaire orientée lignes&nbsp;; c'est vous qui l'écrivez, l'IA qui le fait, ou
[`workflow_record`](#workflow-record) qui le capture à partir de vos propres actions),
`inputs?` (une table `{name: value}` substituée dans les références
`{name}`), `allowRepeat?`. Il retourne `{runId, steps}` **immédiatement** — l'exécution se
déroule de manière **asynchrone**, car une exécution à plusieurs étapes peut survivre à une
seule requête. Interrogez le `workflow_status` de [`browser_read`](#browser-read) pour
suivre la progression.

Les étapes déterministes — `click` / `type` / `navigate` dans cette grammaire, ainsi
qu'`extract` — s'exécutent à l'intérieur de VMark et sont **soumises individuellement à
autorisation**, exactement comme un `act` émis à la main&nbsp;: l'exécution autorise
chacune d'elles séparément, un workflow n'est donc pas un moyen de contourner les invites
d'autorisation. `goal`, `confirm`, `api` et toute étape en prose libre **mettent
l'exécution en pause** pour que l'IA les traite à la main. Une réexécution **ignore les
étapes d'écriture qui ont déjà réussi** durant cette session (le registre des écritures
terminées), sauf si `allowRepeat` est défini — ainsi, une réexécution après une pause ne
resoumet pas deux fois.

`workflow_cancel {tabId?, runId}` arrête une exécution. Elle n'est **jamais soumise à
autorisation** — arrêter est toujours autorisé — et elle retire les invites en attente de
l'exécution et vous rend l'onglet. L'exécution s'arrête également dès que vous reprenez le
contrôle du navigateur (toute interaction avec la page ou son interface reprend la main).

Les exécutions sont bornées (≤ 25 étapes, ≤ 120 s, source ≤ 64 Kio) et une à la fois par
onglet.

### `workflow_record`

Enregistre **vos propres actions** sur un onglet appartenant à l'IA sous forme de workflow
rejouable. Arguments&nbsp;: `tabId?`, `recordOp` (`"start"` ou `"stop"`) et `site?`
(l'identifiant de site du frontmatter du workflow enregistré&nbsp;; `recording` par défaut).

`start` est **soumis au consentement** via la permission `record` qui — comme `execute_js`
et `session` — n'est **jamais une autorisation permanente**&nbsp;: chaque enregistrement vous
le redemande, de sorte que l'IA ne peut jamais vous enregistrer en silence. Tant que vous ne
l'autorisez pas, `start` retourne `needsApproval`&nbsp;; une fois que vous l'avez fait, VMark
arme un shim de capture dormant du monde de la page et commence à enregistrer les **clics et
saisies de champ** que vous effectuez. `stop` retourne `{source, inputs, eventCount}` — le
`source` est un texte de workflow que vous pouvez enregistrer ou passer directement à
[`workflow_run`](#workflow-run).

L'enregistrement est **sans valeurs par construction**, et il ne s'agit pas d'un filtre qui
fait confiance à la page&nbsp;: rien de ce que vous saisissez n'est jamais capturé. Chaque
champ de texte devient une variable `{input}` nommée (la valeur est fournie au moment de la
relecture, jamais enregistrée)&nbsp;; un **champ de mot de passe ou de code à usage unique**
devient une étape `confirm:` — une barrière humaine que vous franchissez à la main lors de la
relecture — de sorte qu'un secret n'est même jamais paramétré&nbsp;; et chaque URL est
réduite à l'origine + le chemin, de sorte qu'un jeton présent dans une chaîne de requête ne
peut pas survivre. Ce qui est enregistré, ce sont les **localisateurs** que vous avez touchés
(rôle ARIA + nom accessible), jamais leurs données. L'enregistrement vous suit à travers les
navigations de page et est borné (200 événements par page, 1 000 par session).

### `open`

Arguments&nbsp;: `url` et un `timeoutMs` optionnel (1–12 000 ms). Crée un onglet appartenant
à l'IA en utilisant la posture Sandbox ou Partagée actuelle et retourne ses `tabId`,
`navigationId`, URL, titre et génération une fois le chargement terminé.

### `navigate`

Arguments&nbsp;: `tabId?`, `url`, et un `timeoutMs` optionnel. Navigue avec un onglet
appartenant à l'IA et retourne le résultat du ticket de navigation. Un délai dépassé
retourne tout de même le ticket, afin qu'un `wait` ultérieur puisse récupérer le résultat
final.

**Détection de barrière.** Un résultat `open` / `navigate` / `wait` chargé peut porter
`gate: {kind, hint}` lorsque la page atteinte se lit comme un **mur de connexion**, une
**page de consentement intercalée**, un **défi de vérification humaine** ou une
**limitation de débit** — de sorte que l'IA apprend qu'elle ne regarde pas le contenu
qu'elle a demandé, au moment même où elle lit le résultat. La détection privilégie la
précision (un widget de défi rendu, ou au moins deux signaux indépendants sur une page
laconique — un prix `$429`, un pied de page «&nbsp;Protected by Cloudflare&nbsp;» ou un
article *au sujet* des CAPTCHA ne déclenchent jamais de classement) et purement
consultative&nbsp;: elle change ce qui est dit à l'IA, jamais ce qui est autorisé, et
chaque indice invite à vous impliquer plutôt qu'à contourner la barrière.

### `style`

Arguments&nbsp;: `tabId?`, une cible (`ref` **ou** `selector`), et l'un de
`set: {prop: value}`, `addClasses`, `removeClasses` ou `injectCss`. Écarter une surcouche
bloquante, mettre une cible en évidence, etc. **Classe Action** (soumise à autorisation, op
`style`). Monde de contenu isolé.

### `execute_js`

Arguments&nbsp;: `tabId?`, `script` (doit `return` une valeur sérialisable en JSON). La
trappe de secours pour ce que les verbes structurés ne peuvent pas exprimer. Il s'exécute
dans le **monde de contenu isolé** — il partage le DOM (donc `querySelector`,
`element.style` fonctionnent) mais **ne peut pas** voir le tas/les variables globales JS
propres à la page. Il est approuvé **par appel uniquement** (jamais une autorisation
permanente, imposé dans le pilote Rust), l'approbation montre le script, et la valeur de
retour est marquée **non fiable** et n'est jamais réinjectée automatiquement dans un `act`
ultérieur. Préférez d'abord `query`/`style`.

### `session_save` / `session_load`

Arguments&nbsp;: `tabId?`, `handle` (`[A-Za-z0-9._-]`, 1–128 caractères). `session_save`
capture la session de l'onglet dans une entrée du **keychain du système** nommée par
`handle` et retourne un récapitulatif sans valeurs (des décomptes)&nbsp;; `session_load` la
restaure et retourne `{loaded: true, handle}` — une confirmation plus le handle fourni par
l'IA, jamais aucune valeur. Un `session_load` ne s'applique qu'à une page ayant la **même
origine** que celle où la session a été enregistrée. Il s'agit d'un identifiant **par
référence** (ADR-A7)&nbsp;: l'IA nomme une session enregistrée et ne reçoit jamais les
valeurs de cookies/jetons, qui ne sont jamais journalisées. Toutes deux relèvent de la
permission `session` — **jamais une autorisation permanente** (approuvée par appel), et une
autorisation pour un handle ne peut pas être dépensée sur un autre. *Aujourd'hui, cela
couvre `localStorage`&nbsp;; la capture des cookies est un suivi en cours de test réel.*

### `console_clear`

Arguments&nbsp;: `tabId?`. Retourne `{entries: [{level, text}], url}`, exactement comme le
`console` de [`browser_read`](#browser-read), **et vide le tampon** afin que la lecture
suivante ne voie que la nouvelle sortie. Elle se trouve ici plutôt qu'avec l'autre lecture
de console parce que la vidange évalue `element.textContent = "[]"` dans la page — une
écriture DOM.

La posture Partagée demande une autorisation de destination pour chaque nouvelle origine,
sauf s'il existe une autorisation `navigate` correspondante. Un onglet créé par un humain
nécessite une autorisation d'attachement éphémère avant toute lecture/action de l'IA. Les
onglets Sandbox utilisent un magasin de cookies IA distinct et non persistant.

---

## `browser_read`

La moitié **en lecture seule**&nbsp;: observer l'onglet sans le modifier. Annoté
`readOnlyHint: true`, de sorte qu'un client MCP peut l'approuver automatiquement — ce qui
est tout l'intérêt de la séparation. Ces actions résidaient auparavant sur `browser`, où
une seule annotation au niveau de l'outil devait aussi décrire `execute_js`&nbsp;; prendre
un instantané ARIA coûtait donc une autorisation humaine.

`openWorldHint` reste `true`&nbsp;: la lecture seule décrit ce que l'outil *modifie*, non si
les octets sont dignes de confiance. Tout ce qui est retourné est contrôlé par la page et
**non fiable** — ne réinjectez jamais un résultat directement comme cible d'action
`browser`.

### `read`

Retourne `{url, snapshot}` pour l'onglet de navigateur focalisé, ou pour l'onglet désigné
par `tabId`. `snapshot` est une liste orientée ARIA de `{role, name, ref}` — chaque `ref`
(par ex. `"e5"`) est un identifiant stable pour cet élément, valable le temps de la vue
actuelle.

### `screenshot`

Arguments&nbsp;: `tabId?`. Retourne un **bloc de contenu image** (JPEG en base64, qualité
bornée) du rendu actuel de l'onglet, plus une ligne de texte nommant la page — un canal
visuel sur la mise en page et l'état rendu que l'instantané ARIA ne peut pas décrire. Il est
capturé nativement (`takeSnapshot`) et ne lit aucun DOM ni JavaScript de la page. Classe
Lecture&nbsp;: autorisé exactement comme `read` (permis sur un onglet appartenant à
l'IA&nbsp;; un onglet humain nécessite un attachement, consommé lors de la capture).

### `query`

Arguments&nbsp;: `tabId?`, `selector` (CSS), et un `fields: {attributes, box, styles:[...]}`
optionnel. Retourne `{count, elements: [{ref, tag, text, …}]}` — des données DOM
structurées que l'instantané ARIA ne peut pas nommer (tableaux, valeurs calculées).
**Classe Lecture.** S'exécute dans le monde de contenu isolé.

### `extract`

Arguments&nbsp;: `tabId?`. Retourne `{title, byline, url, markdown, textLength, truncated}`
— la page en **Markdown mode lecture**, pour les pages que l'IA souhaite *lire* plutôt
qu'opérer. Une capture plafonnée exporte le HTML de la page&nbsp;; l'extraction elle-même
s'exécute dans VMark, jamais dans la page&nbsp;: un **plugin de site** enregistré pour
l'origine a la priorité (le plugin Wikipedia intégré retire l'habillage wiki — infoboxes,
navboxes, hatnotes, liens d'édition — par leur nom), et un lecteur générique fondé sur
l'heuristique de densité sert de solution de repli pour tous les autres sites.
`truncated: true` signifie que la page a dépassé le plafond de capture et que la fin n'a
pas été lue. **Classe Lecture.** Tout ce qui est retourné provient de la page et n'est pas
fiable.

### `workflow_status`

Arguments&nbsp;: `tabId?`, `runId` (issu de `workflow_run`). Retourne
`{status, completedSteps, stepCount, pausedAt?, reasonCode?, reason?, stepResults}` où
`status` vaut l'un de `running` / `paused` / `completed` / `failed` / `cancelled`. Un statut
`paused` nomme dans `pausedAt` l'étape qui a besoin de vous. **Classe Lecture** —
interrogez-le librement.

### `console`

Arguments&nbsp;: `tabId?`. Retourne `{entries: [{level, text}], url}` — la sortie `console.*`
capturée de la page, plus les **erreurs non interceptées et les rejets de promesses non
gérés** (enregistrés comme des entrées `level: "error"` préfixées `Uncaught` /
`Unhandled rejection:` — le signal que l'interception de `console.*` seule ne voit jamais).
Onglets Sandbox uniquement. La capture fonctionne via un shim du monde de la page qui écrit
dans un tampon DOM masqué que le pilote lit depuis le monde isolé — ainsi **aucun canal de
messagerie** n'est ouvert en retour vers VMark (la garantie sans pont tient). La sortie est
contrôlée par la page et **non fiable** — traitez-la comme un `read`, jamais comme une cible
d'`act`.

Le tampon est un anneau borné, de sorte que des lectures consécutives se chevauchent. Pour
le vider au fil de la lecture, utilisez le `console_clear` de [`browser`](#browser) — la
vidange écrit `[]` dans l'élément tampon de la page, ce qui est une écriture DOM et ne peut
donc pas relever de `readOnlyHint: true`.

### `wait`

Arguments&nbsp;: `tabId?`, un `navigationId` optionnel, et un `timeoutMs` optionnel. Elle ne
démarre jamais de navigation. Elle retourne un résultat de chargement/échec mis en tampon,
`NAVIGATION_SUPERSEDED`, ou `TIMEOUT` lorsque le ticket ne se termine pas dans la limite.

### `wait_for`

Arguments&nbsp;: `tabId?`, exactement l'un de `ref` (issu d'une lecture), `role` (+ un `name`
optionnel), `text` (une sous-chaîne du texte visible), ou `urlContains` (une sous-chaîne que
l'URL de l'onglet doit contenir — confirme qu'une navigation déclenchée par un clic a
abouti, répondu à partir de l'état de l'onglet sans aller-retour vers la page), et un
`timeoutMs` optionnel (1–12 000 ms). Interroge de façon répétée jusqu'à ce que la condition
soit remplie ou que le délai s'écoule, et retourne `{matched: true|false}` (plus le `ref` de
l'élément correspondant pour une condition ref/role) — vous pouvez ainsi distinguer
«&nbsp;trouvé&nbsp;» de «&nbsp;délai dépassé&nbsp;». Classe Lecture. Utilisez-la pour rendre
un flux déterministe&nbsp;: agir, `wait_for` le résultat, puis lire.

---

## `coherence`

Une vue **en lecture seule** de la couche de cohérence de l'espace de travail — quels documents dérivés sont obsolètes par rapport aux amonts dont ils ont été générés. Aucune action ne modifie les documents ni l'état de l'éditeur. `status` est en lecture seule&nbsp;; `edges` procède d'abord à un rapprochement et peut ajouter des enregistrements de provenance au registre de l'espace de travail, mais ne change jamais le contenu d'un document. Toutes sont entièrement traitées par le backend Rust à partir du noyau propre à chaque espace de travail, elles fonctionnent donc même quand aucune fenêtre d'éditeur n'est au premier plan.

Deux actions supplémentaires en lecture seule exposent la couche sémantique&nbsp;:

- `claims` — les affirmations canoniques actuelles&nbsp;: `{claim, entryId, statement, maturity, invalidAt, visible}`. Seules les affirmations `established` contraignent les vérifications sémantiques&nbsp;; `visible` reflète le contexte default.
- `contexts` — l'ensemble des contextes (le `default` implicite est toujours présent)&nbsp;: `{id, name, parent, enforcement, visibleClaims, errors}`.

Annoté `readOnlyHint: true`. L'unique action mutante, `resolve`, réside dans son propre outil — voir [`coherence_resolve`](#coherence-resolve) — ce qui permet à celui-ci d'être approuvable automatiquement. La mutation des affirmations et des contextes n'est jamais exposée&nbsp;: le canon reste sous contrôle humain.

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

Résoudre une arête (accept-newer / waive) est normalement une action humaine effectuée dans la vue Détail de VMark. Une IA ne peut le faire que via [`coherence_resolve`](#coherence-resolve), et uniquement lorsque le propriétaire de l'espace de travail le lui a explicitement délégué.

---

## `coherence_resolve`

L'**unique action mutante** de la couche de cohérence, dans son propre outil afin que
[`coherence`](#coherence) puisse rester approuvable automatiquement — et afin qu'une
opération non annulable soit bien visible dans la liste des outils plutôt qu'enfouie comme
une valeur d'énumération parmi cinq. Annoté `readOnlyHint: false, destructiveHint: true`.

### `resolve`

Arguments&nbsp;: `{workspace_root, txf, input, resolution: "accept-newer" | "waive", reason? (required for waive)}`.
`txf` et `input` proviennent d'une ligne `coherence` → `edges`.

Résoudre une arête obsolète active en tant qu'agent explicitement délégué. L'autorisation
est **fail-closed**&nbsp;: le propriétaire de l'espace de travail doit avoir accordé à
**votre identité de pont authentifiée** une délégation active et non expirée couvrant le
type de résolution (accordée dans l'application, depuis la vue Détail), et l'arête doit
toujours être active. Chaque résolution déléguée est journalisée au titre de la délégation,
et l'entrée ne peut pas être annulée.

Un refus signifie que l'autorisation est manquante ou expirée — demandez à l'utilisateur de
l'accorder plutôt que de réessayer. Extraire cela de `coherence` n'a changé aucune propriété
de sécurité&nbsp;: l'autorisation s'est toujours appuyée sur le principal de pont
authentifié, jamais sur quoi que ce soit que le client affirme.

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
| `INVALID_PATH` | enveloppe | Un `filePath` n'a pas pu être lu, ou se trouve hors de la portée de l'espace de travail ouvert / des documents |
| `APPROVAL_REQUIRED` | enveloppe | `save_as` vers un nouvel emplacement alors que **Approuver automatiquement les modifications** est désactivé |
| `NOT_WORKFLOW` | enveloppe | `workflow.*` a été appelé sur un onglet non-YAML-workflow |
| `READ_ONLY` | enveloppe | Une mutation a été tentée sur un document en lecture seule |
| `NO_EDITOR` | enveloppe | `selection.*` a été appelé mais l'onglet focalisé n'a pas d'éditeur actif |
| `INTERNAL` | enveloppe | Erreur de gestionnaire inattendue |
| (chaîne simple) | chaîne | Argument requis manquant ou type incorrect |
