# Cohérence et la vue Détail

La couche de cohérence de VMark garde honnêtes les projets d'écriture
développés récursivement&nbsp;: elle enregistre **quels documents chaque
génération IA a réellement lus**, remarque quand ces documents amont
changent par la suite, et vous montre — à la demande — exactement quels
artefacts aval pourraient désormais être obsolètes. Rien n'est jamais mis
à jour automatiquement&nbsp;; vous restez le rédacteur en chef.

## Comment ça marche (30 secondes)

- Chaque enregistrement, application de genie, suggestion IA acceptée,
  écriture MCP et étape `save-file` de workflow est consigné comme une
  **transformation** dans un registre en texte brut au sein de votre
  espace de travail (`.vmark/` — JSONL lisible par l'humain et compatible
  git&nbsp;; supprimer l'`index.db` dérivé ne perd rien).
- Quand une IA écrit un document en en lisant d'autres, ces lectures
  deviennent des **arêtes de dépendance**, épinglées à la révision exacte
  qui a été lue.
- Quand un document amont avance au-delà d'une révision épinglée, l'arête
  devient **obsolète**. Si deux révisions ont évolué en parallèle (par ex.
  sur des branches git), l'arête est **divergente** — signalée, jamais
  devinée.
- Les fichiers modifiés hors de VMark (terminal, autres éditeurs) sont
  rapprochés lors de l'analyse comme *modifications externes observées* —
  l'historique reste sans lacune, honnêtement marqué comme de provenance
  inconnue.

## La vue Détail

Ouvrez-la depuis **Fenêtre → Détail de cohérence** (ou la palette de
commandes&nbsp;: « Breakdown View »). Elle est strictement en **mode
pull**&nbsp;: elle se rafraîchit quand vous l'ouvrez ou appuyez sur
Actualiser — elle ne vous harcèle jamais en arrière-plan.

Les éléments sont groupés par artefact (le document aval) et montrent le
document amont, la révision épinglée et l'état actuel&nbsp;:

| État | Signification |
|---|---|
| `version-stale` | L'amont a avancé au-delà de ce dont cet artefact a été produit |
| `diverged` | Les révisions épinglée et actuelle sont parallèles — aucune ligne de descendance |
| `diverged-multi-head` | L'amont lui-même a des versions actuelles parallèles |
| `waived` | Vous avez accepté la divergence, avec un motif consigné |
| `unpinnable` | L'amont ne peut pas être résolu (par ex. un épinglage invalide) |

### Actions

Chaque élément offre trois actions honnêtes — aucune ne réécrit
l'historique&nbsp;:

- **Accepter la plus récente** — consigne que l'artefact est toujours
  compatible avec l'amont plus récent (une *ratification*). L'élément
  quitte la liste&nbsp;; si l'amont change à nouveau, il revient.
- **Réviser** — ouvre l'artefact pour que vous puissiez le mettre à jour.
  Enregistrer une nouvelle version retire l'ancienne arête.
- **Exempter** — consigne une divergence intentionnelle avec un **motif
  obligatoire** (les narrateurs peu fiables existent). Les éléments
  exemptés restent visibles, marqués distinctement, et se rouvrent si
  l'amont bouge à nouveau.

Accepter la plus récente et Exempter sont désactivés quand l'amont a
plusieurs versions actuelles — il n'y a pas de révision unique contre
laquelle résoudre&nbsp;; révisez (ou réconciliez les versions) d'abord.

## Identité dans le frontmatter

La première fois qu'un fichier est capturé, VMark ajoute un petit bloc
d'identité à son frontmatter&nbsp;:

```yaml
vmark:
  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7
```

Cet ID est ce qui permet à un document de conserver son historique à
travers les renommages et déplacements. Il n'affecte jamais le hachage du
contenu (l'ajouter ne crée pas de « changement »), et tout le reste de
votre frontmatter est laissé intact. Si vous copiez un fichier, l'ID
dupliqué est détecté et vous est signalé pour résolution — jamais corrigé
automatiquement.

## Interopérabilité git

- Les fichiers de registre `.vmark/` sont suivis par git et fusionnent
  proprement entre branches (append-only, `merge=union`).
- Les checkouts, changements de branche et resets sont reconnus comme de
  la **navigation** — ils ne créent jamais de révisions fantômes.
- `git revert` et les fusions qui produisent du nouveau contenu sont
  capturés comme des transformations attribuées à git.
- L'index dérivé (`index.db`) est dans le gitignore et se reconstruit à
  partir du registre en texte brut chaque fois que nécessaire.

## Pour les agents IA (MCP)

Les agents externes peuvent interroger l'état de cohérence via
[l'outil MCP `coherence`](/fr/guide/mcp-tools#coherence) (actions `status`
et `edges`), pour les espaces de travail que vous avez ouverts dans VMark.
`status` est une lecture pure&nbsp;; `edges` rapproche d'abord — il peut
ajouter des enregistrements de provenance au registre propre de l'espace
de travail, mais ne touche jamais vos documents. La résolution
(ratifier/exempter) n'est délibérément *pas* exposée via MCP dans cette
version — les décisions restent à l'humain, dans l'application.
