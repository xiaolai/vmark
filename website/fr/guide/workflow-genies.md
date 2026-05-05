<script setup>
// Skip Vue template processing for the whole page so ${{ }} expressions
// in code spans and fenced YAML blocks don't get interpreted.
</script>

<div v-pre>

# Genies de workflow

Les Genies de VMark se déclinent en deux variantes :

- **Genies Markdown** (`.md`) — modèles d’invites à un seul tir. Le format Genie d’origine. Voir [AI Genies](/fr/guide/ai-genies).
- **Genies de workflow** (`.yml` / `.yaml`) — pipelines à plusieurs étapes qui enchaînent des Genies Markdown avec un flux de données explicite.

Les deux formats résident dans le même répertoire global de Genies et apparaissent dans le même sélecteur (`Cmd+Y`). Un Genie de workflow s’affiche comme une ligne Genie ordinaire ; le sélectionner lance l’exécuteur de workflow au lieu de l’appel IA à un seul tir.

## Quand utiliser quoi

| Besoin | Format |
|--------|--------|
| Transformation unique (réécrire, traduire, résumer) | Markdown |
| Pipeline plan → brouillon → polissage | Workflow |
| Différents modèles d’IA pour différentes étapes | Workflow |
| Étapes nécessitant des points d’approbation | Workflow |
| La sortie d’une étape alimente la suivante | Workflow |

Si une seule invite suffit, utilisez un Genie Markdown. Si vous avez besoin de composer des étapes, d’un flux de données structuré ou d’une approbation humaine en boucle, utilisez un workflow.

## Format de fichier

Un Genie de workflow est un fichier YAML. Champs de premier niveau :

| Champ | Requis | Rôle |
|-------|--------|------|
| `name` | Oui | Libellé lisible. Le sélecteur utilise le **nom de fichier** comme nom d’affichage ; ce champ apparaît comme description si aucun `description:` n’est défini. |
| `description` | Non | Résumé d’une ligne affiché dans le sélecteur. |
| `defaults` | Non | Modèle / approbation / limites par défaut appliqués à chaque étape. |
| `env` | Non | Variables d’environnement disponibles via `${VAR}` ou `${{ env.NAME }}`. |
| `steps` | Oui | Liste ordonnée d’étapes. |

### Forme d’une étape

```yaml
- id: my-step
  uses: genie/<name>     # or action/<name>
  with:
    input: "text or expression"
  needs: prior-step      # optional; can also be a list
  approval: ask          # optional; "auto" (default) or "ask"
  model: claude-sonnet   # optional; overrides defaults
  limits:
    timeout: 120s        # default 300s
    max_tokens: 4096     # REST providers only
```

### Types d’étapes

| Préfixe `uses:` | Comportement |
|-----------------|--------------|
| `genie/<name>` | Charge le Genie Markdown correspondant, remplit son modèle avec la map `with:` de l’étape, appelle le fournisseur d’IA actif. Les substituts `{{content}}` / `{{input}}` du Genie Markdown récupèrent automatiquement `with.input`. |
| `action/read-file` | Lit un chemin relatif à l’espace de travail. La sortie est le contenu du fichier. |
| `action/save-file` | Écrit `with.input` dans `with.path`. |
| `action/notify` | Journalise `with.message`. |
| `action/copy` | Renvoie `with.input` inchangé (utile pour le chaînage). |

### Expressions

À l’intérieur de toute valeur `with:` :

| Syntaxe | Se résout en |
|---------|--------------|
| `${{ steps.ID.outputs.FIELD }}` | Un champ de sortie spécifique d’une étape antérieure. |
| `${{ steps.ID.output }}` | Sucre syntaxique pour `outputs.text` d’une étape antérieure. |
| `${{ env.NAME }}` | Une valeur de `env:` du workflow. |
| `${VAR}` | Idem ci-dessus, forme héritée. |
| `stepId.output` (chaîne entière) | Alias hérité de `${{ steps.stepId.output }}`. |

Les références à une étape ou à un champ inconnus font échouer l’étape au moment de la résolution des paramètres, avant tout appel IA.

### Liaison de modèle

Quand une étape `genie/<name>` s’exécute, le modèle d’invite de son Genie Markdown est rempli selon ces règles :

- `{{input}}` → `with.input`
- `{{content}}` → `with.content` si présent, sinon `with.input` (fatal si aucun des deux)
- `{{context}}` → `with.context` si présent, sinon chaîne vide (jamais fatal)
- `{{any-other-key}}` → `with.<key>` (fatal si manquant)

Cela signifie que **les Genies Markdown existants fonctionnent sans modification** dans les workflows — appelez-les avec `with: { input: "..." }` et le substitut `{{content}}` le récupère via la chaîne d’alias.

### Point d’approbation

Quand une étape porte `approval: ask` (ou `defaults.approval: ask` au niveau du workflow), l’exécuteur fait une pause, ouvre une boîte de dialogue affichant l’aperçu de l’invite résolue et le modèle, puis attend le verdict de l’utilisateur avant d’appeler le fournisseur. Échap refuse. Le délai est le plus petit entre `limits.timeout` de l’étape et 10 minutes.

## Exemple

VMark est livré avec un workflow d’exemple `outline-and-polish.yml` dans vos Genies fournis. Copiez-le dans votre répertoire utilisateur de Genies pour le personnaliser :

```yaml
name: Outline and Polish
description: Generate an outline, then polish the output for clarity.

defaults:
  approval: auto

steps:
  - id: outline
    uses: genie/outline
    with:
      input: "Replace this seed with your topic."

  - id: polish
    uses: genie/polish
    needs: outline
    with:
      input: ${{ steps.outline.outputs.text }}
```

`genie/outline` produit un plan structuré ; l’étape `polish` réécrit ensuite cette sortie pour plus de clarté. Les deux références `genie/*` se résolvent vers les Genies Markdown fournis dans `structure/outline.md` et `editing/polish.md`.

## Annulation, délais, limites

- **Annuler** — Cliquez sur Stop dans le panneau latéral du workflow. L’exécuteur tue tout processus enfant CLI du fournisseur en cours en un tick et abandonne les requêtes REST en cours.
- **Délai par étape** — Encapsulé dans `tokio::time::timeout(step.limits.timeout)`. À l’expiration, l’étape échoue avec «&nbsp;Timed out after Xs&nbsp;» et les étapes en aval sont sautées.
- **Plafond de sortie** — La sortie d’une seule étape est plafonnée à 5 Mo. Un fournisseur emballé déclenche annulation + «&nbsp;Provider output exceeded 5 MB cap&nbsp;».

## Voir aussi

- [AI Genies](/fr/guide/ai-genies) — format et création des Genies Markdown.
- [Visualiseur de workflows](/fr/guide/workflow-viewer) — le même panneau latéral React Flow utilisé ici, conçu à l’origine pour les workflows GitHub Actions.

</div>
