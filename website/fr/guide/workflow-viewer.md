# Visualiseur de workflows GitHub Actions

VMark affiche le YAML des workflows GitHub Actions sous forme de graphe orienté acyclique (DAG) interactif et vous permet de modifier les jobs, les étapes, les déclencheurs, les permissions et la concurrence via des formulaires structurés — sans jamais perdre les commentaires, les ancres ou la mise en forme du fichier sous-jacent.

La fonctionnalité opère sur deux surfaces&nbsp;:

1. **Fichiers `.yml` autonomes** sous `.github/workflows/` (ou tout fichier YAML comportant les clés de premier niveau `on:` et `jobs:`)&nbsp;: vue divisée avec la source à gauche et le canevas interactif + l'éditeur de formulaires à droite.
2. **Blocs de code Markdown**&nbsp;: lorsqu'un bloc avec triple accent grave en `yaml` ou `yml` contient un workflow reconnu, VMark le rend en ligne sous forme d'image du même graphe de jobs, comme les blocs `mermaid`.

::: tip À ne pas confondre avec les workflows propres à VMark
Un fichier YAML dont les `steps:` de premier niveau utilisent `genie/…` ou `action/…` est un [Workflow Genie](/fr/guide/workflows) — le format de pipeline propre à VMark, que VMark sait exécuter. Un workflow GitHub Actions est seulement visualisé et modifié ici&nbsp;; voir [Ce que ce n'est pas](#ce-que-ce-n-est-pas).
:::

## Fichiers de workflow autonomes

Ouvrez n'importe quel fichier `.github/workflows/*.yml` dans VMark. Le fichier s'ouvre en vue divisée — la source YAML à gauche, l'atelier de workflow à droite (le sélecteur Source / Divisé / Aperçu change de disposition). L'atelier affiche&nbsp;:

- L'intégralité du workflow sous forme de canevas React Flow interactif (les jobs comme nœuds, les dépendances `needs:` comme arêtes). Sa barre de commandes permet de zoomer, d'ajuster le graphe au panneau et de basculer la disposition entre haut-bas et gauche-droite — pratique pour une longue chaîne `needs:` dans un panneau large.
- La commande d'export dans le coin supérieur droit du canevas (voir [Exports](#exports)).
- Un panneau d'éditeur structuré sous le canevas&nbsp;: le bandeau [Diagnostics](#diagnostics), les commandes Enregistrer / Abandonner, les formulaires de niveau workflow et le formulaire du job ou de l'étape sélectionné.

Cliquez sur un job dans le canevas pour le modifier. Cliquez sur une étape à l'intérieur du job pour modifier cette étape. Échap efface la sélection et rend le focus à la source.

Pendant que vous modifiez la source, VMark garde les deux panneaux synchronisés&nbsp;: placer le curseur dans les lignes d'un job met en évidence son nœud sur le canevas, les expressions `${{ }}` sont complétées d'après les contextes du workflow analysé, et un Cmd-clic sur une référence `uses:` locale ouvre le fichier cible.

### Modification des jobs

Champs modifiables&nbsp;:

| Champ | Type de patch |
|-------|---------------|
| `name` | `job.set` |
| `runs-on` | `job.set` |
| `if` | `job.set` |

Résumé en lecture seule&nbsp;: nombre d'étapes, `needs:` et `uses:` (pour les jobs de workflows réutilisables).

**Ajouter un job** (au-dessus des formulaires) crée un job à partir d'un identifiant que vous saisissez — il doit commencer par une lettre ou un trait de soulignement et ne pas exister déjà — exécuté sur `ubuntu-latest` jusqu'à ce que vous le changiez. Le bouton de suppression du formulaire de job supprime le job sélectionné après confirmation.

Le formulaire de job liste aussi les étapes du job. Chaque ligne peut être déplacée vers le haut ou vers le bas, ou supprimée (après confirmation), et **Ajouter une étape** ajoute à la fin une nouvelle étape `run: echo TODO`, prête à être modifiée.

### Modification des étapes

Champs modifiables&nbsp;:

| Champ | Type de patch |
|-------|---------------|
| `name` | `step.set` |
| `run` (pour les étapes run) | `step.set` |
| `working-directory` | `step.set` |
| `if` | `step.set` |
| Clés `with:` | `with.set` / `with.remove` |

Le bloc `with:` se présente sous forme de lignes clé/valeur ajoutables, modifiables et supprimables. Renommer une clé émet un `with.remove` pour l'ancienne clé suivi d'un `with.set` pour la nouvelle. Une clé déjà utilisée par une autre ligne est refusée directement dans le formulaire.

Pour les étapes `uses:`, la référence d'action elle-même est en lecture seule — modifiez-la dans la source si vous avez besoin d'une autre action.

Dans le formulaire d'étape, **Alt + Gauche** / **Alt + Droite** passent à l'étape précédente / suivante. Le raccourci fonctionne partout dans la fenêtre, sauf dans un champ de texte, une liste déroulante ou un éditeur de code, où Alt + Flèche garde son sens habituel de navigation par mot.

### Déclencheurs

Un déclencheur écrit sous forme de mapping (`on: { push: { branches: [main] } }`) dispose de champs de filtre modifiables — branches, branches-ignore, tags, tags-ignore, paths, paths-ignore et types — chacun étant une liste séparée par des virgules. Un cron `schedule` est affiché sous forme de phrase dans la langue de l'interface — les noms de jours et de mois restent des abréviations anglaises de trois lettres (`Mon`, `Jan`) —, avec un avertissement lorsqu'il s'exécute plus souvent que toutes les 5 minutes (GitHub bride ces exécutions), et reste en lecture seule. Il en va de même pour un déclencheur écrit sous forme de simple nom d'événement ou de liste de noms&nbsp;; modifiez-les dans la source.

### Permissions et concurrence

Deux formulaires de niveau workflow se trouvent au-dessus du formulaire de job&nbsp;:

- **Permissions** — la valeur par défaut de GitHub (aucune clé `permissions:`), `read-all`, `write-all`, `none`, ou un tableau par portée (`contents`, `pull-requests`, …) avec read / write / none pour chacune.
- **Concurrence** — le `group` et le choix d'activer ou non `cancel-in-progress`. Un `cancel-in-progress` écrit sous forme d'expression est affiché mais n'est pas modifiable ici.

## Enregistrement des modifications

Les modifications s'accumulent dans une liste de patchs en mémoire à mesure que vous changez les champs. Le bouton Enregistrer affiche le compteur courant (par ex. **3 non enregistrés**), et les nouveaux jobs et étapes apparaissent déjà dans le canevas et les formulaires avant l'enregistrement.

Lorsque vous cliquez sur Enregistrer, VMark&nbsp;:

1. Lit le YAML actuel depuis l'éditeur.
2. Applique tous les patchs en file d'attente sur l'arbre syntaxique concret (CST) du YAML — préservant les commentaires, les ancres et la mise en forme existante.
3. Pour un fichier sur disque, écrit le résultat dans le fichier, puis met l'éditeur à jour en conséquence — sauf si vous avez tapé dans la source entre-temps, auquel cas votre saisie est conservée.

Si l'écriture échoue, rien n'est perdu&nbsp;: les modifications restent en file d'attente et vous pouvez enregistrer de nouveau. Un document sans titre n'a pas de fichier où écrire, donc Enregistrer met seulement l'éditeur à jour&nbsp;; appuyez sur **Cmd+Shift+S** pour l'enregistrer. **Abandonner** supprime les modifications en file d'attente.

### Préservation de la mise en forme

Le chemin d'enregistrement par défaut fait passer chaque patch par l'API CST du paquet `yaml` — les commentaires, les nœuds d'ancre, l'indentation personnalisée et les choix de style flow vs bloc existants sont préservés.

Désactivez **Conserver la mise en forme YAML à l'enregistrement** dans Paramètres → Avancé si vous préférez une sortie reformatée canonique. Le chemin de reformatage supprime les commentaires&nbsp;; il s'agit donc d'un choix explicite.

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

VMark détecte la structure du workflow (clés de premier niveau `on:` et `jobs:`) et rend en ligne une image de son graphe de jobs — le même canevas que dans la vue autonome, capturé sous forme d'image. L'image est en lecture seule&nbsp;; double-cliquez dessus pour modifier la source.

## Diagnostics

VMark fait apparaître les diagnostics d'analyse et de lint dans un bandeau en haut du panneau de formulaires. Cliquer sur une ligne amène la source à la ligne fautive, ou sélectionne le job fautif lorsque la ligne n'est pas disponible (par exemple en mode Aperçu)&nbsp;:

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

Installez `actionlint` pour des diagnostics d'expressions plus riches. Lorsque **Utiliser actionlint si disponible** est activé — dans Paramètres → Avancé (Fichiers de workflow), activé par défaut — VMark exécute le binaire depuis le PATH de votre shell de connexion chaque fois que la source d'un fichier de workflow change, et ajoute ses résultats au bandeau Diagnostics de l'atelier, étiquetés `GHA-ACTIONLINT-<rule>`&nbsp;; les vérifications intégrées ci-dessus ne l'attendent jamais. Si l'option est activée mais que le binaire n'est pas installé, VMark vous le signale une fois par session et reste silencieux le reste du temps&nbsp;; si le binaire est présent mais ne parvient pas à s'exécuter, l'échec est signalé une fois avec le message d'actionlint lui-même. Désactivez l'option pour ignorer complètement actionlint. L'opération MCP `workflow.validate` exécute la même vérification à la demande.

## Métadonnées d'action

Pour les étapes `uses:` qui référencent des GitHub Actions publiques, VMark récupère le `action.yml` de chaque action pour alimenter les descriptions des entrées dans l'éditeur structuré. Les résultats sont mis en cache sur disque pendant 24 heures. Les actions locales à l'espace de travail (`./…`) sont lues depuis le disque, jamais depuis le réseau.

Pour garder l'éditeur de workflow entièrement hors ligne, désactivez **Récupérer les métadonnées des actions** dans Paramètres → Avancé (Fichiers de workflow) — l'option désactivée, aucune requête réseau n'est effectuée et le formulaire `with:` se rabat sur des lignes clé/valeur libres.

## Exports

La commande d'export dans le coin supérieur droit du canevas propose trois formats&nbsp;:

| Format | Utilisation |
|--------|-------------|
| **Mermaid** | Intégration dans des README et autres documents markdown. Copié dans le presse-papiers. Avec perte&nbsp;: omet le statut d'exécution, les icônes d'action, les badges personnalisés et les détails d'expansion de matrice. |
| **SVG** | Intégration dans des documents nécessitant des graphiques vectoriels. Utilise `foreignObject` pour le contenu HTML. |
| **PNG** | Partage en messagerie ou partout où le SVG n'est pas pris en charge. Rendu au niveau de zoom courant du canevas. |

## Ce que ce n'est pas

VMark n'exécute pas les workflows GitHub Actions. C'est un visualiseur et un éditeur — l'exécution reste l'affaire de GitHub. La fonctionnalité sert uniquement à lire, relire et créer du YAML de workflow. Les pipelines exécutables propres à VMark relèvent d'un autre format&nbsp;: voir [Workflows Genie](/fr/guide/workflows).
