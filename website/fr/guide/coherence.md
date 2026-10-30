# Cohérence et Détail de cohérence

La couche de cohérence de VMark garde honnêtes les projets d'écriture
développés récursivement&nbsp;: elle enregistre **quels documents chaque
génération IA a réellement lus**, remarque quand ces documents amont
changent par la suite, et vous montre — à la demande — exactement quels
artefacts aval pourraient désormais être obsolètes. Rien n'est jamais mis
à jour automatiquement&nbsp;; vous restez le rédacteur en chef.

## Comment ça marche (30 secondes)

- **Le suivi de provenance est facultatif.** Activez d'abord *Paramètres
  → Fichiers et images → Enregistrement → Insérer le bloc d'identité à
  l'enregistrement*. D'ici là, aucune écriture — enregistrement,
  application de genie, suggestion IA acceptée, écriture MCP,
  rétablissement d'une version antérieure ou nouveau fichier créé depuis
  l'explorateur de fichiers — ne marque vos fichiers ni ne crée
  `.vmark/`.
- Une fois le réglage activé, chaque enregistrement, application de
  genie, suggestion IA acceptée, écriture MCP, rétablissement d'une
  version antérieure et étape `save-file` de workflow est consigné comme
  une **transformation** dans un registre en texte brut au sein de votre
  espace de travail (`.vmark/` — JSONL lisible par l'humain et
  compatible git&nbsp;; supprimer l'`index.db` dérivé ne perd rien).
- **Un espace de travail qui possède déjà un registre** — un `.vmark/`
  que vous avez créé plus tôt ou qu'un collaborateur a commité —
  continue d'enregistrer les écritures sur les documents qu'il suit,
  même réglage désactivé. Un document compte comme suivi quand le
  registre l'a déjà enregistré, ou quand le fichier porte déjà sa
  propre identité `vmark:` — un fichier suivi que vous avez déplacé,
  copié dans l'espace de travail ou récupéré par un checkout&nbsp;; le
  scan du registre lui-même adopte exactement ceux-là. Il ne marque
  rien&nbsp;: un document sans identité est laissé de côté, et une
  écriture dont les entrées sont de ce fait incomplètes est consignée
  comme `inferred` plutôt que `exact`.
- Quand une IA écrit un document en en lisant d'autres, ces lectures
  deviennent des **arêtes de dépendance**, épinglées à la révision exacte
  qui a été lue. Les chemins instrumentés dans l'application consignent
  des entrées `exact`&nbsp;; une écriture MCP consigne honnêtement un
  ensemble de lectures `inferred` — uniquement ce que ce même client a lu par
  sa propre connexion — et nomme le client qui l'a faite.
- Quand un document amont avance au-delà d'une révision épinglée, l'arête
  devient **obsolète**. Si deux révisions ont évolué en parallèle (par ex.
  sur des branches git), l'arête est **divergente** — signalée, jamais
  devinée.
- Les fichiers modifiés hors de VMark (terminal, autres éditeurs) sont
  rapprochés lors de l'analyse comme *modifications externes observées* —
  l'historique reste sans lacune, honnêtement marqué comme de provenance
  inconnue.

## Le panneau Détail de cohérence

Ouvrez-le depuis **Fenêtre → Détail de cohérence** (ou la palette de
commandes&nbsp;: « Détail de cohérence »). Il est strictement en **mode
pull**&nbsp;: il se rafraîchit quand vous l'ouvrez ou appuyez sur
Actualiser — il ne vous harcèle jamais en arrière-plan.

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
  obligatoire** (les narrateurs peu fiables existent). Dans la v0, une
  exemption est volontairement étroite&nbsp;: elle ne s'applique qu'à
  cette arête et à la révision amont précise par rapport à laquelle elle
  est résolue. Les éléments exemptés restent visibles, marqués
  distinctement, et se rouvrent si l'amont bouge à nouveau. Une exemption
  peut aussi recevoir une expiration facultative — une date (`YYYY-MM-DD`,
  c'est-à-dire la fin de ce jour en UTC) ou un horodatage complet. Une fois
  celle-ci passée, l'exemption devient caduque et l'élément se rouvre&nbsp;;
  une expiration mal formée devient caduque immédiatement, si bien que
  l'élément ne reste jamais exempté en silence.

Accepter la plus récente et Exempter sont désactivés quand l'amont a
plusieurs versions actuelles — il n'y a pas de révision unique contre
laquelle résoudre&nbsp;; révisez (ou réconciliez les versions) d'abord.

## Faire taire les signalements inutiles

Deux commandes présentes sur chaque ligne du Détail restreignent ce sur
quoi la couche vous interroge. Toutes deux sont réservées à l'humain —
aucun outil MCP ne peut les définir.

**Marquer comme terminé (cycle de vie du document).** Quand un document
aval est achevé — un chapitre publié, un rapport livré — choisissez
**Marquer comme terminé** sur n'importe laquelle de ses lignes. Cela met
en sourdine toutes les dépendances vers ce document, y compris celles qui
ne sont pas listées actuellement, et c'est pourquoi une confirmation vous
est demandée. Ses arêtes passent dans le groupe replié **Aucune question
à ce sujet**, en bas du panneau, avec la mention *document terminé*&nbsp;:
toujours suivies, toujours visibles sur demande, mais sans plus vous
interrompre. **Rouvrir** les ramène d'un seul clic et sans confirmation,
puisque rouvrir ne fait jamais que rétablir des interruptions. Le cycle
de vie est consigné dans le registre, pas dans le frontmatter&nbsp;;
marquer un document comme terminé ne crée donc pas de nouvelle révision
de celui-ci.

**Ancres de section.** Une arête non ancrée pose la question « le fichier
amont a-t-il changé ? ». **Ancrer à une section** la restreint à « la
section dont je dépends a-t-elle changé ? »&nbsp;: choisissez un titre du
document amont, et l'arête est épinglée au chemin de ce titre. Tant que
la section ancrée est inchangée, une modification de l'amont ailleurs
laisse l'arête dans le groupe mis en sourdine avec la mention *section
dont dépend l'élément inchangée*&nbsp;; une modification à l'intérieur de
la section la fait remonter avec la mention *section ancrée modifiée*.
Si le titre disparaît, l'arête est signalée *ancre perdue* au lieu de
revenir discrètement au comportement portant sur le fichier entier.
**Changer l'ancre** la réépingle et **Fichier entier** la supprime. Les
ancres sont des entrées de registre à part entière, elles-mêmes
révisables&nbsp;; elles suivent donc l'arête au fil des révisions
ultérieures.

## Le journal de cohérence et le jugement des signalements

Le **Journal de cohérence** (une section dépliable du panneau Détail) est
l'historique par arête que conserve le registre&nbsp;: chaque
vérification, ratification et exemption, le nombre de fois où chaque
arête a été résolue (*résolu 3 fois*), et le nombre d'arêtes résolues
plus d'une fois — le remous, qui est le vrai fardeau d'un graphe de
dépendances bruyant. Une vérification sémantique à laquelle le modèle a
répondu sous le seuil de confiance est affichée avec son verdict et sa
confiance conservés (*le modèle a répondu … à …, sous le seuil*), de
sorte que « aucun signal » et « une réponse, mais pas assez sûre »
restent distincts. Le journal est lu à partir de l'ensemble du registre&nbsp;;
il ne se charge donc que lorsque vous le dépliez, et se recharge à chaque
dépliage.

**Ce signalement était-il utile ?** Chaque ligne affichée propose
**Signalement utile ?** avec trois réponses — **Oui**, **Non**,
**Incertain** — et volontairement aucune valeur par défaut. Vos réponses
sont consignées comme des entrées de registre à part entière et
totalisées dans le journal (*Jugés : pertinent … · bruit … · incertain …
· non jugé …*). C'est la mesure de pertinence de l'obsolescence sur
laquelle la couche est calibrée&nbsp;: un signalement que vous jugez être
du bruit est candidat à une ancre de section ou à un marquage comme
terminé.

## Vérification sémantique, affirmations et contextes

L'obsolescence de version dit qu'un amont a *bougé*&nbsp;; la
vérification sémantique dit si ce mouvement *contredit* réellement le
document dérivé. Les vérifications sont strictement en **mode
pull**&nbsp;: appuyez sur **Vérifier** sur une arête obsolète et VMark
demande à votre fournisseur d'IA configuré de comparer la révision
amont épinglée, la révision actuelle et le texte dérivé. Le verdict
arrive sous forme de badge — *vérifiée valide*, *contredite* (toujours
avec une citation textuelle comme preuve) ou *non vérifiée* quand le
modèle a hésité, dépassé le délai ou répondu sous le seuil de
confiance. L'inconnu est honnête, jamais caché. Une vérification expire
dès que l'un des deux documents bouge à nouveau — ou que l'ensemble des
affirmations change.

Les **affirmations canoniques** sont des faits que vous avez rendus
explicites (« Elena est gauchère »). Sélectionnez du texte dans un
document et lancez *Extraire une affirmation de la sélection*&nbsp;:
l'affirmation naît en **brouillon**, avec sa provenance (quel document,
quelle révision). Pour voir et gérer vos affirmations, lancez
**Affirmations canoniques** depuis la palette de commandes — le panneau
n'a ni élément de menu ni raccourci, et *Extraire une affirmation de la
sélection* l'ouvre pour vous avec le nouveau brouillon. Promouvez une
affirmation en **établie** quand elle devient canon — seules les affirmations établies alimentent les vérifications
sémantiques. Corriger ou clore une affirmation ajoute de
l'historique&nbsp;; rien n'est jamais supprimé. Masquer une affirmation
dans un contexte est une visibilité réversible, pas une clôture.

Les **contextes** sont des vues nommées de l'espace de travail (le
contexte *default* est toujours là). Chaque contexte choisit ce que
« actuel » signifie et quelles affirmations s'appliquent&nbsp;; un
contexte enfant hérite additivement des affirmations de son parent. Les
contextes sont en mode **serre** par défaut — les verdicts de
vérification se lisent comme une tension consultative. En basculer un
en **appliqué** (un acte explicite et confirmé) marque les
contradictions comme des violations du canon. Le sélecteur de contexte
du panneau Détail choisit à travers quel contexte vous regardez&nbsp;;
les résultats de vérification sont liés au contexte et à l'instantané
d'affirmations exacts qui les ont produits et ne fuient jamais de l'un
à l'autre.

## Provenance, délégation et branches

Trois choses gardent la couche de cohérence honnête à mesure qu'un projet évolue réellement — aucune ne vous harcèle, toutes sont strictement en mode pull.

**Récupération de la provenance.** Quand vous modifiez un document dérivé à la main (dans VMark ou un éditeur externe), la modification perd à juste titre ses entrées enregistrées — les anciennes arêtes de dépendance ne décrivent plus le nouveau texte. Le groupe *Provenance inconnue* du Détail propose de les restaurer&nbsp;: appuyez sur **Suggérer des entrées** et VMark propose le jeu d'entrées antérieur le plus récent du document (rôles préservés), pré-coché et modifiable. **Confirmer la provenance** rattache les arêtes à la version actuelle sans créer de nouvelle révision, de sorte que les documents en aval du document ne voient jamais de changement fallacieux. Les documents qui n'ont jamais eu d'entrées ne sont jamais listés — il n'y a rien à récupérer et rien pour vous harceler.

**Délégation d'agent.** Par défaut, vous seul pouvez résoudre les arêtes obsolètes. Si vous voulez qu'un agent IA accepte la plus récente ou exempte en votre nom (via l'outil MCP `coherence_resolve`), accordez-lui depuis le Détail une **délégation à durée limitée**&nbsp;: nommez l'agent, choisissez la portée (accepter la plus récente et/ou exempter) et fixez une expiration (7 jours par défaut, jamais « pour toujours »). Chaque résolution déléguée est consignée au titre de la délégation, si bien que la piste d'audit montre toujours qui a agi sous l'autorité de qui. Révoquez n'importe quelle délégation d'un clic. Les affirmations canoniques et les contextes restent exclusivement humains — un agent ne peut jamais promouvoir une affirmation ni appliquer un contexte.

**Contextes de branche.** Un contexte peut être associé à une branche git. Quand vous basculez sur une branche associée, le Détail affiche une **puce candidate** proposant de changer — il ne change jamais de lui-même. Si la branche n'a pas encore de contexte, la puce propose d'en créer un à son nom. Quand une vraie fusion (non fast-forward) aboutit, une bannière que vous pouvez ignorer vous invite à examiner le Détail&nbsp;; la divergence et l'obsolescence qu'elle expose sont les états normaux du Détail — rien de nouveau ne s'exécute donc, vous êtes simplement guidé vers l'examen.

## Identité dans le frontmatter

Une fois *Insérer le bloc d'identité à l'enregistrement* activé, la
première fois qu'un fichier est capturé, VMark ajoute un petit bloc
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

Si vous préférez que VMark ne touche jamais à vos fichiers, laissez
*Insérer le bloc d'identité à l'enregistrement* désactivé — c'est le
réglage par défaut. VMark n'ajoute alors ce bloc à aucun fichier, quelle
que soit la manière dont il est écrit — pas même aux fichiers qu'une
modification par l'IA ou MCP s'est contentée de lire.

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
[l'outil MCP `coherence`](/fr/guide/mcp-tools#coherence) (actions `status`,
`edges`, `claims` et `contexts`), pour les espaces de travail que vous
avez ouverts dans VMark. `status` est une lecture pure&nbsp;; `edges`
rapproche d'abord — il peut ajouter des enregistrements de provenance au
registre propre de l'espace de travail, mais ne touche jamais vos
documents. L'outil déclare `readOnlyHint: true`, de sorte qu'un client
peut l'approuver automatiquement.

La résolution (ratifier/exempter) relève d'un outil **distinct**,
[`coherence_resolve`](/fr/guide/mcp-tools#coherence-resolve), et reste
par défaut entre les mains de l'humain&nbsp;: un agent ne peut l'appeler
qu'après que vous avez accordé à cet agent précis une délégation à durée
limitée, et chaque résolution est consignée dans le journal d'audit au
titre de cette délégation. C'est parce qu'elle est tenue hors de
`coherence` que l'outil de lecture peut être approuvé automatiquement
sans qu'un agent acquière discrètement la capacité d'écrire dans votre
registre.

Les affirmations canoniques et les contextes ne sont jamais modifiables
via MCP.
