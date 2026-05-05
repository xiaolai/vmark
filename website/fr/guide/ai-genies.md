# Génies IA

Les Génies IA sont des modèles d'invite qui transforment votre texte à l'aide de l'IA. Sélectionnez du texte, invoquez un génie et examinez les modifications suggérées — sans jamais quitter l'éditeur.

## Démarrage rapide

1. Configurez un fournisseur d'IA dans **Paramètres > Intégrations** (voir [Fournisseurs d'IA](/fr/guide/ai-providers))
2. Sélectionnez du texte dans l'éditeur
3. Appuyez sur `Mod + Y` pour ouvrir le sélecteur de génie
4. Choisissez un génie ou tapez une invite libre
5. Examinez la suggestion en ligne — acceptez ou refusez

## Le sélecteur de génie

Appuyez sur `Mod + Y` (ou menu **Outils > Génies IA**) pour ouvrir une superposition de style Spotlight avec une seule entrée unifiée.

**Recherche et formulaire libre** — Commencez à taper pour filtrer les génies par nom, description ou catégorie. Si aucun génie ne correspond, l'entrée devient un champ d'invite libre.

**Puces rapides** — Quand la portée est « sélection » et que l'entrée est vide, des boutons en un clic apparaissent pour les actions courantes (Peaufiner, Condenser, Grammaire, Reformuler).

**Formulaire libre en deux étapes** — Quand aucun génie ne correspond, appuyez sur `Entrée` une première fois pour voir un message de confirmation, puis `Entrée` à nouveau pour soumettre comme invite IA. Cela évite les soumissions accidentelles.

**Cycle de portée** — Appuyez sur `Tab` pour parcourir les portées : sélection → bloc → document → tout.

**Historique des invites** — En mode formulaire libre (aucun génie correspondant), appuyez sur `Flèche Haut` / `Flèche Bas` pour parcourir les invites précédentes. Appuyez sur `Ctrl + R` pour ouvrir un menu déroulant d'historique consultable. Le texte fantôme affiche l'invite correspondante la plus récente sous forme d'indice grisé — appuyez sur `Tab` pour l'accepter.

### Retour de traitement

Après avoir sélectionné un génie ou soumis une invite libre, le sélecteur affiche un retour en ligne :

- **Traitement** — Un indicateur de réflexion avec un compteur de temps écoulé. Appuyez sur `Échap` pour annuler.
- **Aperçu** — La réponse de l'IA diffuse en temps réel. Utilisez `Accepter` pour appliquer ou `Rejeter` pour ignorer.
- **Erreur** — En cas de problème, le message d'erreur apparaît avec un bouton `Réessayer`.

La barre d'état affiche également la progression de l'IA — une icône tournante avec le temps écoulé pendant l'exécution, un bref flash « Terminé » en cas de succès, ou un indicateur d'erreur avec des boutons Réessayer/Ignorer. La barre d'état s'affiche automatiquement quand l'IA a un statut actif, même si vous l'avez précédemment masquée avec `F7`.

## Génies intégrés

VMark est livré avec 13 génies répartis en quatre catégories :

### Édition

| Génie | Description | Portée |
|-------|-------------|--------|
| Peaufiner | Améliorer la clarté et le flux | Sélection |
| Condenser | Rendre le texte plus concis | Sélection |
| Corriger la grammaire | Corriger la grammaire et l'orthographe | Sélection |
| Simplifier | Utiliser un langage plus simple | Sélection |

### Créatif

| Génie | Description | Portée |
|-------|-------------|--------|
| Développer | Développer l'idée en prose plus complète | Sélection |
| Reformuler | Dire la même chose différemment | Sélection |
| Vivant | Ajouter des détails sensoriels et des images | Sélection |
| Continuer | Continuer l'écriture depuis ici | Bloc |

### Structure

| Génie | Description | Portée |
|-------|-------------|--------|
| Résumer | Résumer le document | Document |
| Plan | Générer un plan | Document |
| Titre | Suggérer des options de titre | Document |

### Outils

| Génie | Description | Portée |
|-------|-------------|--------|
| Traduire | Traduire en anglais | Sélection |
| Réécrire en anglais | Réécrire le texte en anglais | Sélection |

## Portée

Chaque génie opère sur l'une des trois portées suivantes :

- **Sélection** — Le texte surligné. Si rien n'est sélectionné, utilise le bloc actuel.
- **Bloc** — Le paragraphe ou l'élément de bloc à la position du curseur.
- **Document** — Le contenu complet du document.

La portée détermine quel texte est extrait et transmis à l'IA comme `{{content}}`.

::: tip
Si la portée est **Sélection** mais que rien n'est sélectionné, le génie opère sur le paragraphe actuel.
:::

## Examiner les suggestions

Après l'exécution d'un génie, la suggestion apparaît en ligne :

- **Remplacement** — Texte original barré, nouveau texte en vert
- **Insertion** — Nouveau texte affiché en vert après le bloc source
- **Suppression** — Texte original barré

Chaque suggestion a des boutons d'acceptation (coche) et de rejet (X).

### Raccourcis clavier

| Action | Raccourci |
|--------|----------|
| Accepter la suggestion | `Entrée` |
| Rejeter la suggestion | `Échap` |
| Suggestion suivante | `Tab` |
| Suggestion précédente | `Shift + Tab` |
| Tout accepter | `Mod + Shift + Entrée` |
| Tout rejeter | `Mod + Shift + Échap` |

## Indicateur de la barre d'état

Pendant la génération par l'IA, la barre d'état affiche une icône d'éclat tournante avec un compteur de temps écoulé (« Réflexion... 3s »). Un bouton d'annulation (×) vous permet d'arrêter la requête.

Après la complétion, une brève coche « Terminé » clignote pendant 3 secondes. En cas d'erreur, la barre d'état affiche le message d'erreur avec les boutons Réessayer et Ignorer.

La barre d'état s'affiche automatiquement quand l'IA a un statut actif (en cours, erreur ou succès), même si vous l'avez masquée avec `F7`.

---

## Écrire des génies personnalisés

Vous pouvez créer vos propres génies. Chaque génie est un fichier Markdown unique avec des métadonnées YAML et un modèle d'invite.

### Où les génies sont stockés

Les génies sont stockés dans votre répertoire de données d'application :

| Plateforme | Chemin |
|------------|--------|
| macOS | `~/Library/Application Support/app.vmark/genies/` |
| Windows | `%APPDATA%\app.vmark\genies\` |
| Linux | `~/.local/share/app.vmark/genies/` |

Ouvrez ce dossier depuis le menu **Outils > Ouvrir le dossier des génies**.

### Structure du répertoire

Les sous-répertoires deviennent des **catégories** dans le sélecteur. Vous pouvez organiser les génies comme vous le souhaitez :

```
genies/
├── editing/
│   ├── polish.md
│   ├── condense.md
│   └── fix-grammar.md
├── creative/
│   ├── expand.md
│   └── rephrase.md
├── academic/          ← votre catégorie personnalisée
│   ├── cite.md
│   └── abstract.md
└── my-workflows/      ← une autre catégorie personnalisée
    └── blog-intro.md
```

### Format de fichier

Chaque fichier de génie a deux parties : **métadonnées** (frontmatter) et **modèle** (l'invite).

```markdown
---
description: Améliorer la clarté et le flux
scope: selection
category: editing
---

Vous êtes un éditeur expert. Améliorez la clarté, le flux et la concision
du texte suivant tout en préservant la voix et l'intention de l'auteur.

Retournez uniquement le texte amélioré — pas d'explications.

{{content}}
```

Le nom de fichier `polish.md` devient le nom d'affichage « Polish » dans le sélecteur.

### Champs du frontmatter

| Champ | Requis | Valeurs | Défaut |
|-------|--------|---------|--------|
| `description` | Non | Courte description affichée dans le sélecteur | Vide |
| `scope` | Non | `selection`, `block`, `document` | `selection` |
| `category` | Non | Nom de catégorie pour le regroupement | Nom du sous-répertoire |
| `action` | Non | `replace`, `insert` | `replace` |
| `context` | Non | `1`, `2` | `0` (aucun) |
| `model` | Non | Identifiant de modèle pour remplacer le modèle par défaut du fournisseur | Défaut du fournisseur |

**Nom du génie** — Le nom d'affichage est toujours dérivé du **nom de fichier** (sans `.md`). Par exemple, `fix-grammar.md` apparaît comme « Fix Grammar » dans le sélecteur. Renommez le fichier pour changer le nom d'affichage.

### L'espace réservé `{{content}}`

L'espace réservé `{{content}}` est au cœur de chaque génie. Quand un génie s'exécute, VMark :

1. **Extrait le texte** selon la portée (texte sélectionné, bloc actuel ou document complet)
2. **Remplace** chaque `{{content}}` dans votre modèle par le texte extrait
3. **Envoie** l'invite remplie au fournisseur d'IA actif
4. **Diffuse** la réponse en retour comme suggestion en ligne

Par exemple, avec ce modèle :

```markdown
Traduisez le texte suivant en français.

{{content}}
```

Si l'utilisateur sélectionne « Hello, how are you? », l'IA reçoit :

```
Traduisez le texte suivant en français.

Hello, how are you?
```

L'IA répond avec « Bonjour, comment allez-vous ? » et cela apparaît comme une suggestion en ligne remplaçant le texte sélectionné.

### L'espace réservé `{{context}}`

L'espace réservé `{{context}}` donne à l'IA le texte environnant en lecture seule — pour qu'elle puisse correspondre au ton, au style et à la structure des blocs voisins sans les modifier.

**Comment ça fonctionne :**

1. Définissez `context: 1` ou `context: 2` dans le frontmatter pour inclure ±1 ou ±2 blocs voisins
2. Utilisez `{{context}}` dans votre modèle où vous souhaitez injecter le texte environnant
3. L'IA voit le contexte mais la suggestion ne remplace que `{{content}}`

**Les blocs composés sont atomiques** — si un voisin est une liste, un tableau, une citation ou un bloc détails, toute la structure compte comme un seul bloc.

**Restrictions de portée** — Le contexte fonctionne uniquement avec les portées `selection` et `block`. Pour la portée `document`, le contenu est déjà le document complet.

**Invites libres** — Quand vous tapez une instruction libre dans le sélecteur, VMark inclut automatiquement ±1 bloc environnant comme contexte pour les portées `selection` et `block`. Aucune configuration nécessaire.

**Rétrocompatible** — Les génies sans `{{context}}` fonctionnent exactement comme avant. Si le modèle ne contient pas `{{context}}`, aucun texte environnant n'est extrait.

**Exemple — ce que l'IA reçoit :**

Avec `context: 1` et le curseur sur le deuxième paragraphe d'un document à trois paragraphes :

```
[Avant]
Contenu du premier paragraphe ici.

[Après]
Contenu du troisième paragraphe ici.
```

Les sections `[Avant]` et `[Après]` sont omises quand il n'y a pas de voisins dans cette direction (par ex. le contenu est au début ou à la fin du document).

### Le champ `action`

Par défaut, les génies **remplacent** le texte source par la sortie de l'IA. Définissez `action: insert` pour **ajouter** la sortie après le bloc source à la place.

Utilisez `replace` pour : l'édition, la reformulation, la traduction, les corrections grammaticales — tout ce qui transforme le texte original.

Utilisez `insert` pour : continuer l'écriture, générer des résumés sous le contenu, ajouter des commentaires — tout ce qui ajoute un nouveau texte sans supprimer l'original.

**Exemple — action d'insertion :**

```markdown
---
description: Continuer l'écriture depuis ici
scope: block
action: insert
---

Continuez naturellement l'écriture à partir de l'endroit où le texte suivant s'arrête.
Correspondez à la voix, au style et au ton de l'auteur. Écrivez 2-3 paragraphes.

Ne répétez pas ou ne résumez pas le texte existant — continuez-le simplement.

{{content}}
```

### Le champ `model`

Remplacez le modèle par défaut pour un génie spécifique. Utile quand vous voulez un modèle moins cher pour des tâches simples ou un modèle plus puissant pour des tâches complexes.

```markdown
---
description: Correction grammaticale rapide (utilise un modèle rapide)
scope: selection
model: claude-haiku-4-5-20251001
---

Corrigez les erreurs de grammaire et d'orthographe. Retournez uniquement le texte corrigé.

{{content}}
```

L'identifiant de modèle doit correspondre à ce que votre fournisseur actif accepte.

## Écrire des invites efficaces

### Soyez précis sur le format de sortie

Dites à l'IA exactement ce qu'il faut retourner. Sans cela, les modèles ont tendance à ajouter des explications, des en-têtes ou des commentaires.

```markdown
<!-- Bon -->
Retournez uniquement le texte amélioré — pas d'explications.

<!-- Mauvais — l'IA peut envelopper la sortie entre guillemets, ajouter « Voici la version améliorée : », etc. -->
Améliorez ce texte.
```

### Définissez un rôle

Donnez à l'IA un persona pour ancrer son comportement.

```markdown
<!-- Bon -->
Vous êtes un éditeur technique expert spécialisé dans la documentation d'API.

<!-- Correct mais moins ciblé -->
Modifiez le texte suivant.
```

### Contraignez la portée

Dites à l'IA ce qu'il ne faut PAS modifier. Cela empêche la sur-édition.

```markdown
<!-- Bon -->
Corrigez uniquement les erreurs de grammaire et d'orthographe.
Ne changez pas le sens, le style ou le ton.
Ne restructurez pas les phrases.

<!-- Mauvais — donne trop de liberté à l'IA -->
Corrigez ce texte.
```

### Utilisez Markdown dans les invites

Vous pouvez utiliser la mise en forme Markdown dans vos modèles d'invite. Cela aide quand vous voulez que l'IA produise une sortie structurée.

```markdown
---
description: Générer une analyse avantages/inconvénients
scope: selection
action: insert
---

Analysez le texte suivant et produisez une brève liste avantages/inconvénients.

Format :

**Avantages :**
- point 1
- point 2

**Inconvénients :**
- point 1
- point 2

{{content}}
```

### Gardez les invites ciblées

Un génie, un travail. Ne combinez pas plusieurs tâches dans un seul génie — créez des génies séparés à la place.

```markdown
<!-- Bon — un travail clair -->
---
description: Convertir à la voix active
scope: selection
---

Réécrivez le texte suivant en utilisant la voix active.
Ne changez pas le sens.
Retournez uniquement le texte réécrit.

{{content}}
```

## Exemples de génies personnalisés

### Académique — Écrire un résumé

```markdown
---
description: Générer un résumé académique
scope: document
action: insert
---

Lisez l'article suivant et écrivez un résumé académique concis
(150-250 mots). Suivez la structure standard : contexte, méthodes,
résultats, conclusion.

{{content}}
```

### Blog — Générer un accroche

```markdown
---
description: Écrire un paragraphe d'ouverture accrocheur
scope: document
action: insert
---

Lisez le brouillon suivant et écrivez un paragraphe d'ouverture convaincant
qui accroche le lecteur. Utilisez une question, un fait surprenant ou une scène vivante.
Gardez-le sous 3 phrases.

{{content}}
```

### Code — Expliquer un bloc de code

```markdown
---
description: Ajouter une explication en langage simple au-dessus du code
scope: selection
action: insert
---

Lisez le code suivant et écrivez une brève explication en langage simple
de ce qu'il fait. Utilisez 1-2 phrases. N'incluez pas le code lui-même
dans votre réponse.

{{content}}
```

### Email — Rendre professionnel

```markdown
---
description: Réécrire dans un ton professionnel
scope: selection
---

Réécrivez le texte suivant dans un ton professionnel et adapté aux affaires.
Gardez le même sens et les mêmes points clés. Supprimez le langage familier,
l'argot et les mots de remplissage.

Retournez uniquement le texte réécrit — pas d'explications.

{{content}}
```

### Traduction — Vers le français

```markdown
---
description: Traduire en français
scope: selection
---

Traduisez le texte suivant en français.
Préservez le sens, le ton et la mise en forme originaux.
Utilisez un français naturel et idiomatique — pas une traduction mot à mot.

Retournez uniquement le texte traduit — pas d'explications.

{{content}}
```

### Sensible au contexte — S'adapter aux alentours

```markdown
---
description: Réécrire pour correspondre au ton et style environnants
scope: selection
context: 1
---

Réécrivez le contenu suivant pour s'intégrer naturellement dans son contexte environnant.
Correspondez au ton, au style et au niveau de détail.

Retournez uniquement le texte réécrit — pas d'explications.

## Contexte environnant (ne pas inclure dans la sortie) :
{{context}}

## Contenu à réécrire :
{{content}}
```

### Révision — Vérification des faits

```markdown
---
description: Signaler les affirmations qui nécessitent une vérification
scope: selection
action: insert
---

Lisez le texte suivant et listez toutes les affirmations factuelles qui devraient être
vérifiées. Pour chaque affirmation, notez pourquoi elle pourrait nécessiter une vérification (par ex.
chiffres spécifiques, dates, statistiques ou affirmations fortes).

Formatez comme une liste à puces. Si tout semble solide, dites
« Aucune affirmation signalée pour vérification. »

{{content}}
```

## Suggestions IA

Lorsqu'un Génie renvoie un texte destiné à remplacer la sélection (plutôt qu'une réponse de chat libre), VMark le présente comme une **suggestion** avec un diff en ligne&nbsp;: barré rouge pour le texte original, soulignement vert pour le texte proposé. Vous examinez et approuvez avant qu'aucun changement ne soit appliqué de manière persistante.

| Action | Raccourci |
|---|---|
| Accepter la suggestion focalisée | `Tab` |
| Rejeter la suggestion focalisée | `Échap` |
| Accepter toutes les suggestions du document | `Mod + Shift + Entrée` _(sensible au contexte — aussi Ajouter une ligne au-dessus dans un tableau)_ |
| Passer à la suggestion suivante | `Tab` depuis une position non focalisée |

Lorsqu'un Génie réécrit plusieurs paragraphes, chaque remplacement est sa propre suggestion, navigable indépendamment. Accepter l'une n'accepte pas automatiquement les autres.

L'interface des suggestions a également une surface MCP — les agents IA externes connectés via le [serveur MCP](/fr/guide/mcp-tools) peuvent émettre les actions `suggestion.accept` / `suggestion.reject` pour manipuler le même état.

## Limitations

- Les génies fonctionnent uniquement en **mode WYSIWYG**. En mode source, une notification toast l'explique.
- Un seul génie peut s'exécuter à la fois. Si l'IA génère déjà, le sélecteur ne démarrera pas un autre.
- L'espace réservé `{{content}}` est remplacé littéralement — il ne prend pas en charge les conditions ou les boucles.
- Les très grands documents peuvent atteindre les limites de jetons du fournisseur lors de l'utilisation de `scope: document`.

## Dépannage

**« Aucun fournisseur d'IA disponible »** — Ouvrez Paramètres > Intégrations et configurez un fournisseur. Consultez [Fournisseurs d'IA](/fr/guide/ai-providers).

**Génie n'apparaissant pas dans le sélecteur** — Vérifiez que le fichier a une extension `.md`, un frontmatter valide avec des délimiteurs `---`, et qu'il est dans le répertoire des génies (pas dans un sous-répertoire plus profond qu'un niveau).

**L'IA retourne des résultats incorrects ou des erreurs** — Vérifiez que votre clé API est correcte et que le nom du modèle est valide pour votre fournisseur. Vérifiez les détails d'erreur dans le terminal/console.

**La suggestion ne correspond pas aux attentes** — Affinez votre invite. Ajoutez des contraintes (« retournez uniquement le texte », « n'expliquez pas »), définissez un rôle ou réduisez la portée.

## Voir aussi

- [Fournisseurs d'IA](/fr/guide/ai-providers) — Configurer les fournisseurs CLI ou API REST
- [Raccourcis clavier](/fr/guide/shortcuts) — Référence complète des raccourcis
- [Outils MCP](/fr/guide/mcp-tools) — Intégration IA externe via MCP
