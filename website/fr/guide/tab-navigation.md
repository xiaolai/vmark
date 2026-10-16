# Navigation intelligente par Tab

Les touches Tab et Shift+Tab de VMark sont sensibles au contexte — elles vous aident à naviguer efficacement dans le texte formaté, les crochets et les liens sans avoir recours aux touches fléchées.

> Avec le [rail des espaces de travail](/fr/guide/workspace-rail) expérimental, le passage d'un onglet à l'autre et la barre d'onglets ne couvrent que les onglets de l'espace de travail actif.

## Aperçu rapide

| Contexte | Action de Tab | Action de Shift+Tab |
|----------|--------------|---------------------|
| À l'intérieur de crochets `()` `[]` `{}` | Sauter après le crochet fermant | Sauter avant le crochet ouvrant |
| À l'intérieur de guillemets `""` `''` | Sauter après le guillemet fermant | Sauter avant le guillemet ouvrant |
| À l'intérieur de crochets CJK `「」` `『』` | Sauter après le crochet fermant | Sauter avant le crochet ouvrant |
| À l'intérieur de **gras**, *italique*, `code`, ~~barré~~ | Sauter après le formatage | Sauter avant le formatage |
| À l'intérieur d'un lien | Sauter après le lien | Sauter avant le lien |
| Dans une cellule de tableau | Passer à la cellule suivante | Passer à la cellule précédente |
| Dans un élément de liste | Indenter l'élément | Désindenter l'élément (s'arrête au niveau le plus extérieur) |

## Échappement de crochet & guillemet

Lorsque votre curseur est juste avant un crochet ou guillemet fermant, appuyer sur Tab saute par-dessus. Lorsque votre curseur est juste après un crochet ou guillemet ouvrant, appuyer sur Shift+Tab revient avant lui.

### Caractères pris en charge

**Crochets et guillemets standard :**
- Parenthèses : `( )`
- Crochets droits : `[ ]`
- Accolades : `{ }`
- Guillemets doubles : `" "`
- Guillemets simples : `' '`
- Accents graves : `` ` ``

**Crochets CJK :**
- Parenthèses pleine largeur : `（ ）`
- Crochets lenticulaires : `【 】`
- Crochets d'angle : `「 」`
- Crochets d'angle blancs : `『 』`
- Guillemets en chevrons doubles : `《 》`
- Chevrons : `〈 〉`

**Guillemets courbes :**
- Guillemets courbes doubles : `" "`
- Guillemets courbes simples : `' '`

### Fonctionnement

```text
function hello(world|)
                    ↑ curseur avant )
```

Appuyez sur **Tab** :

```text
function hello(world)|
                     ↑ curseur après )
```

Cela fonctionne également avec les crochets imbriqués — Tab saute par-dessus le caractère fermant immédiatement adjacent.

Appuyez sur **Shift+Tab** inverse l'action — si le curseur est juste après un caractère ouvrant :

```text
function hello(|world)
               ↑ curseur après (
```

Appuyez sur **Shift+Tab** :

```text
function hello|(world)
              ↑ curseur avant (
```

### Exemple CJK

```text
这是「测试|」文字
         ↑ curseur avant 」
```

Appuyez sur **Tab** :

```text
这是「测试」|文字
          ↑ curseur après 」
```

## Échappement de formatage (mode WYSIWYG)

En mode WYSIWYG, Tab et Shift+Tab peuvent s'échapper des marques de formatage en ligne.

### Formats pris en charge

- Texte **gras**
- Texte *italique*
- `Code en ligne`
- ~~Barré~~
- Liens

### Fonctionnement

Lorsque votre curseur est n'importe où à l'intérieur du texte formaté :

```text
This is **bold te|xt** here
                 ↑ curseur à l'intérieur du gras
```

Appuyez sur **Tab** :

```text
This is **bold text**| here
                     ↑ curseur après le gras
```

Shift+Tab fonctionne en sens inverse — il saute au début du formatage :

```text
This is **bold te|xt** here
                 ↑ curseur à l'intérieur du gras
```

Appuyez sur **Shift+Tab** :

```text
This is |**bold text** here
        ↑ curseur avant le gras
```

### Échappement de lien

Tab et Shift+Tab s'échappent également des liens :

```text
Check out [VMark|](https://vmark.app)
               ↑ curseur à l'intérieur du texte du lien
```

Appuyez sur **Tab** :

```text
Check out [VMark](https://vmark.app)| and...
                                    ↑ curseur après le lien
```

Appuyez sur **Shift+Tab** à l'intérieur d'un lien déplace vers le début :

```text
Check out |[VMark](https://vmark.app) and...
          ↑ curseur avant le lien
```

## Navigation dans les liens (mode Source)

En mode Source, Tab fournit une navigation intelligente dans la syntaxe de lien Markdown.

### Crochets imbriqués et échappés

VMark gère correctement la syntaxe de lien complexe :

```markdown
[texte [avec crochets imbriqués] brackets](url)     ✓ Fonctionne
[texte \[échappé\] brackets](url)                   ✓ Fonctionne
[lien](https://example.com/page(1))                 ✓ Fonctionne
```

La navigation par Tab identifie correctement les frontières du lien même avec des crochets imbriqués ou échappés.

### Liens standard

```markdown
[texte du lien|](url)
              ↑ curseur dans le texte
```

Appuyez sur **Tab** → le curseur se déplace vers l'URL :

```markdown
[texte du lien](|url)
                ↑ curseur dans l'URL
```

Appuyez à nouveau sur **Tab** → le curseur sort du lien :

```markdown
[texte du lien](url)|
                    ↑ curseur après le lien
```

### Liens wiki

```markdown
[[nom de page|]]
             ↑ curseur dans le lien
```

Appuyez sur **Tab** :

```markdown
[[nom de page]]|
               ↑ curseur après le lien
```

## Mode Source : Échappement des caractères Markdown

En mode Source, Tab saute également par-dessus les caractères de formatage Markdown :

| Caractères | Utilisés pour |
|------------|--------------|
| `*` | Gras/italique |
| `_` | Gras/italique |
| `^` | Exposant |
| `~~` | Barré (sauté comme une unité) |
| `==` | Surligné (sauté comme une unité) |

### Exemple

```markdown
This is **gras|** text
              ↑ curseur avant **
```

Appuyez sur **Tab** :

```markdown
This is **gras**| text
                ↑ curseur après **
```

::: info
Le mode Source n'a pas d'échappement Shift+Tab pour les caractères Markdown — Shift+Tab désindente uniquement (supprime les espaces de début).
:::

## Mode Source : Appariement automatique

En mode Source, taper un caractère de formatage insère automatiquement sa paire fermante :

| Caractère | Appariement | Comportement |
|-----------|-------------|-------------|
| `*` | `*\|*` ou `**\|**` | Basé sur délai — attend 150ms pour détecter simple vs double |
| `~` | `~\|~` ou `~~\|~~` | Basé sur délai |
| `_` | `_\|_` ou `__\|__` | Basé sur délai |
| `=` | `==\|==` | Toujours apparié en double |
| `` ` `` | `` `\|` `` | Accent grave simple apparié après délai |
| ` ``` ` | Délimiteur de code | Triple accent grave en début de ligne crée un bloc de code délimité |

L'appariement automatique est **désactivé à l'intérieur des blocs de code délimités** — taper `*` dans un bloc de code insère un `*` littéral sans appariement.

Retour arrière entre une paire supprime les deux moitiés : `*\|*` → Retour arrière → vide.

## Navigation dans les tableaux

Lorsque le curseur est à l'intérieur d'un tableau :

| Action | Touche |
|--------|--------|
| Cellule suivante | Tab |
| Cellule précédente | Shift + Tab |
| Ajouter une ligne (à la dernière cellule) | Tab |

Tab à la dernière cellule de la dernière ligne ajoute automatiquement une nouvelle ligne.

## Indentation des listes

Lorsque le curseur est dans un élément de liste :

| Action | Touche |
|--------|--------|
| Indenter l'élément | Tab |
| Désindenter l'élément | Shift + Tab |

La désindentation retire un niveau d'imbrication et **s'arrête au niveau le plus extérieur** — elle
ne fait pas sortir un élément de la liste. Pour quitter entièrement une liste, utilisez **Supprimer
la liste**, ou appuyez à nouveau sur le bouton de liste pour la désactiver.

## Paramètres

Le comportement d'échappement Tab peut être personnalisé dans **Paramètres → Éditeur** :

| Paramètre | Effet |
|-----------|-------|
| **Appariement automatique de crochets** | Activer/désactiver l'appariement de crochets et l'échappement Tab |
| **Crochets CJK** | Inclure les paires de crochets CJK |
| **Guillemets courbes** | Inclure les paires de guillemets courbes (`""` `''`) |

::: tip
Si l'échappement Tab entre en conflit avec votre flux de travail, vous pouvez désactiver entièrement l'appariement automatique des crochets. Tab insérera alors des espaces (ou indentera dans les listes/tableaux) normalement.
:::

## Comparaison : Mode WYSIWYG vs Source

| Fonctionnalité | Tab (WYSIWYG) | Shift+Tab (WYSIWYG) | Tab (Source) | Shift+Tab (Source) |
|---------------|---------------|---------------------|--------------|-------------------|
| Échappement de crochets | ✓ | ✓ | ✓ | — |
| Échappement de crochets CJK | ✓ | ✓ | ✓ | — |
| Échappement de guillemets courbes | ✓ | ✓ | ✓ | — |
| Échappement de marques (gras, etc.) | ✓ | ✓ | N/A | N/A |
| Échappement de lien | ✓ | ✓ | ✓ (navigation dans les champs) | — |
| Échappement de caractères Markdown (`*`, `_`, `~~`, `==`) | N/A | N/A | ✓ | — |
| Appariement auto Markdown (`*`, `~`, `_`, `=`) | N/A | N/A | ✓ (basé sur délai) | N/A |
| Navigation dans les tableaux | Cellule suivante | Cellule précédente | N/A | N/A |
| Indentation des listes | Indenter | Désindenter | Indenter | Désindenter |
| Prise en charge multi-curseur | ✓ | ✓ | ✓ | — |
| Ignoré à l'intérieur des blocs de code | ✓ | ✓ | ✓ | N/A |

## Prise en charge multi-curseur

L'échappement Tab fonctionne avec plusieurs curseurs — chaque curseur est traité indépendamment.

### Fonctionnement

Lorsque vous avez plusieurs curseurs et appuyez sur Tab ou Shift+Tab :
- **Tab** : Les curseurs à l'intérieur du formatage s'échappent vers la fin ; les curseurs avant les crochets fermants sautent par-dessus
- **Shift+Tab** : Les curseurs à l'intérieur du formatage s'échappent vers le début ; les curseurs après les crochets ouvrants sautent avant
- Les curseurs dans le texte brut restent en place

### Exemple

```text
**gras|** and [lien|](url) and brut|
     ^1         ^2             ^3
```

Appuyez sur **Tab** :

```text
**gras**| and [lien](url)| and brut|
        ^1               ^2        ^3
```

Chaque curseur s'échappe indépendamment selon son contexte.

::: tip
C'est particulièrement puissant pour les modifications en masse — sélectionnez plusieurs occurrences avec `Mod + D`, puis utilisez Tab pour vous échapper de toutes en même temps.
:::

## Priorité & Comportement dans les blocs de code

### Priorité d'échappement

Lorsque plusieurs cibles d'échappement se chevauchent, Tab les traite **du plus intérieur vers l'extérieur** :

```text
**texte gras(|)** ici
               ↑ Tab saute ) en premier (le crochet est le plus intérieur)
```

Appuyez à nouveau sur **Tab** :

```text
**texte gras()**| ici
                ↑ Tab s'échappe de la marque gras
```

Cela signifie que le saut de crochet se déclenche toujours avant l'échappement de marque — vous pouvez compter sur Tab pour sortir d'abord des crochets, puis du formatage.

### Protection des blocs de code

Les sauts de crochets Tab et Shift+Tab sont **désactivés à l'intérieur des blocs de code** — à la fois les nœuds `code_block` et les spans de code en ligne. Cela empêche Tab de sauter par-dessus les crochets dans le code, où les crochets sont une syntaxe littérale :

```text
`tableau[index|]`
               ↑ Tab ne saute PAS ] dans le code en ligne — insère des espaces à la place
```

L'insertion d'appariement automatique est également désactivée à l'intérieur des blocs de code pour les modes WYSIWYG et Source.

## Conseils

1. **Mémoire musculaire** — Une fois habitué à l'échappement Tab, vous naviguerez beaucoup plus vite sans les touches fléchées.

2. **Fonctionne avec l'appariement automatique** — Lorsque vous tapez `(`, VMark insère automatiquement `)`. Après avoir tapé à l'intérieur, appuyez simplement sur Tab pour sortir.

3. **Structures imbriquées** — Tab s'échappe d'un niveau à la fois. Pour `((imbriqué))`, vous avez besoin de deux Tab pour sortir complètement.

4. **Shift + Tab** — Le miroir de Tab. S'échappe en arrière des marques, liens et crochets ouvrants. Dans les tableaux, passe à la cellule précédente. Dans les listes, désindente l'élément.

5. **Multi-curseur** — L'échappement Tab fonctionne avec tous vos curseurs simultanément, rendant les modifications en masse encore plus rapides.

## Passer d'un onglet ouvert à l'autre

Les onglets se trouvent dans la barre d'état en bas de la fenêtre. Trois façons de passer
de l'un à l'autre :

| Action | Raccourci | Remarques |
|---|---|---|
| Dernier onglet utilisé | `Ctrl + Tab` | Revient à l'onglet dans lequel vous étiez avant celui-ci. Appuyez à nouveau pour revenir aussitôt. |
| Onglet suivant / précédent | `Mod + Shift + ]` / `Mod + Shift + [` | Se déplace dans la barre dans l'ordre, indépendamment de ce que vous avez utilisé récemment. |
| Ouverture rapide | `Mod + O` | Tapez pour filtrer. Les onglets ouverts sont listés en premier, le plus récemment utilisé en haut. |

**Dernier onglet utilisé est une bascule, pas un cycle.** Il vous emmène au document dans
lequel vous étiez le plus récemment, et un second appui vous ramène là où vous aviez
commencé — la façon rapide de travailler entre deux fichiers. Onglet suivant et Onglet
précédent parcourent plutôt la barre par position, ce qu'il vous faut quand vous cherchez
quelque chose plutôt que d'y revenir.

C'est un élément de menu autant qu'un raccourci (**Affichage → Dernier onglet utilisé**), ce
qui lui permet de continuer à fonctionner lorsque le navigateur intégré a le focus clavier.

### Quand vous avez plus d'onglets que de place

La barre d'onglets défile. Lorsque des onglets dépassent d'un bord, la barre s'estompe de
ce côté et une petite flèche apparaît — cliquez dessus pour faire défiler d'un écran. Changer
d'onglet par quelque moyen que ce soit fait aussi défiler le nouvel onglet dans la vue, de sorte
que l'onglet mis en évidence n'est jamais caché hors de l'écran.

La barre elle-même est accessible au clavier : atteignez-la avec Tab et utilisez les touches fléchées.

## Deux documents côte à côte

**Affichage → Diviser l'éditeur — deux documents** (`Alt + Mod + \`) place un second
document à côté du document actuel. Pour choisir lequel, faites un clic droit sur n'importe quel onglet
et choisissez **Ouvrir sur le côté**.

| Action | Raccourci |
|---|---|
| Diviser l'éditeur — deux documents | `Alt + Mod + \` |
| Fermer le volet | `Alt + Mod + Shift + \` |
| Activer l'autre volet | `Alt + Mod + Shift + O` |
| Synchroniser le défilement | *(aucun par défaut)* |

Remarques sur son comportement :

- L'onglet affiché dans l'**autre** volet est marqué dans la barre d'onglets d'un léger
  soulignement, ce qui vous permet de toujours savoir quels deux documents sont à l'écran et dans
  lequel votre saisie ira.
- **Fermer l'un des deux replie la vue sur l'autre**, au lieu de vous envoyer vers un
  onglet sans rapport. Le document restant reste en place.
- **Synchroniser le défilement** lie proportionnellement le défilement des deux volets.
  Il est désactivé par défaut et propre à chaque division.
- **Les deux volets partagent un même mode d'affichage.** Le mode source (`F6`)
  bascule les deux volets à la fois, et passer d'un volet à l'autre conserve le mode en cours.
- La division nécessite deux documents ouverts. Les onglets du navigateur ne sont pas des documents, la
  division ne s'applique donc pas à eux.

## Le menu contextuel des onglets

Faites un clic droit sur un onglet pour ouvrir son menu. Les touches fléchées, Début et Fin s'y déplacent ; Entrée ou Espace exécute un élément ; Échap le ferme.

| Élément | Ce qu'il fait | Disponible lorsque |
|---|---|---|
| Déplacer vers une nouvelle fenêtre | Déplace l'onglet dans une nouvelle fenêtre, avec **Annuler** dans la confirmation. Une fenêtre secondaire laissée vide se ferme. | Le document est chargé, et ce n'est pas le seul onglet de la fenêtre principale |
| Épingler / Désépingler | Épingle ou désépingle l'onglet — voir [Onglets épinglés](#onglets-epingles). | Toujours |
| Ouvrir sur le côté | Affiche l'onglet dans l'autre volet de la division — voir [Deux documents côte à côte](#deux-documents-cote-a-cote). | Cet onglet et l'onglet actif sont tous deux des documents, et celui-ci n'est pas l'onglet actif (non affiché pour les onglets du navigateur) |
| Renommer | Renomme le fichier directement dans l'onglet — voir [Renommer un fichier](#renommer-un-fichier). | Le document a été enregistré |
| Copier le chemin | Copie le chemin absolu du fichier. | Le document a été enregistré |
| Copier le chemin relatif | Copie le chemin relatif au dossier de l'espace de travail. | Un espace de travail est ouvert et le fichier s'y trouve |
| Afficher dans le Finder | Montre le fichier dans le Finder (**Afficher dans l'Explorateur** sous Windows, **Afficher dans le gestionnaire de fichiers** sous Linux). | Le document a été enregistré |
| Restaurer sur le disque | Réécrit le contenu de l'onglet à son chemin. | Le fichier a été supprimé du disque alors qu'il était ouvert |
| Revenir à la version enregistrée | Après une confirmation, abandonne vos modifications et recharge le fichier depuis le disque. | L'onglet a des modifications non enregistrées et son fichier existe toujours |
| Fermer | Ferme l'onglet (propose d'abord d'enregistrer s'il a des modifications non enregistrées). | L'onglet n'est pas épinglé |
| Fermer les autres | Ferme tous les autres onglets non épinglés. | Un autre onglet non épinglé existe |
| Fermer les onglets à droite | Ferme les onglets non épinglés situés à sa droite. | Il en existe un |
| Fermer les onglets non épinglés | Ferme tous les onglets non épinglés, celui-ci compris. | Un onglet non épinglé existe |
| Tout fermer | Ferme tous les onglets, y compris les onglets épinglés. Si un onglet épinglé doit être fermé, une confirmation indiquant leur nombre est d'abord demandée ; l'annuler ne ferme rien. | Toujours |

Les fermetures groupées agissent sur les onglets de l'espace de travail actuel et les ferment un par un. Chaque onglet ayant des modifications non enregistrées demande d'abord, et annuler l'une de ces demandes arrête les suivantes.

## Onglets épinglés

Épinglez un onglet depuis son menu contextuel pour le garder à portée de main :

- Il rejoint le groupe épinglé à gauche de la barre, affiche une icône d'épingle et perd son bouton de fermeture. Les onglets ne peuvent pas être glissés au-delà de la frontière entre onglets épinglés et non épinglés (*« Les onglets épinglés restent à gauche. Dépose bloquée. »*), et un onglet épinglé ne peut pas être glissé hors de sa fenêtre.
- Il ne peut être fermé par aucun moyen — `Mod + W`, clic du milieu, **Fermer** ou une fermeture groupée — tant que vous ne l'avez pas désépinglé ; toute tentative affiche *« Détacher l'onglet avant de fermer »*. Deux fermetures délibérées font exception : **Tout fermer** ferme aussi les onglets épinglés une fois que vous avez confirmé, et fermer un espace de travail depuis la barre ferme ses onglets épinglés avec les autres.
- Fermer une fenêtre contenant des onglets épinglés demande une confirmation — *« Cette fenêtre a N onglets épinglés. Fermer quand même ? »* — sauf si une boîte de dialogue d'enregistrement a déjà été affichée.
- Un épinglage survit au déplacement de l'onglet vers une autre fenêtre ou un autre espace de travail et à un redémarrage de mise à jour, mais pas à la fermeture de VMark : les onglets rouverts au lancement suivant ne sont pas épinglés.

Il n'existe pas de raccourci clavier pour épingler.

## Renommer un fichier

Choisissez **Renommer** dans le menu contextuel d'un onglet. Le nom devient modifiable dans l'onglet, avec la partie située avant l'extension sélectionnée. Entrée ou un clic ailleurs valide ; Échap annule. Le fichier est renommé sur le disque et chaque onglet ouvert qui pointe vers lui suit. VMark n'écrase jamais rien : si le nom est déjà pris, une boîte de dialogue indique *Un fichier nommé « X » existe déjà.* Un nom vide, inchangé, `.` ou `..`, ou contenant `/` ou `\`, est refusé ou ignoré. Ce que vous tapez est le nom complet — supprimez l'extension et le fichier la perd.

Sur **macOS**, avec **Paramètres → Apparence → Afficher le nom du fichier dans la barre de titre** activé, vous pouvez aussi double-cliquer sur le nom du fichier dans la barre de titre pour le renommer. Les mêmes règles et les mêmes messages s'appliquent ; après une collision ou une erreur, le nom reste modifiable pour que vous puissiez en essayer un autre. Si **Afficher les extensions de fichier** est désactivé, l'extension d'origine est conservée lorsque vous tapez un nom sans extension. Double-cliquer sur le titre d'un document non enregistré ouvre plutôt **Enregistrer**.

## Fermer des onglets et des fenêtres

Rien qui contient des modifications non enregistrées n'est fermé sans demander.

- **Fermer un onglet** ayant des modifications non enregistrées (`Mod + W`, le × de l'onglet ou **Fermer**) demande *« Voulez-vous enregistrer les modifications apportées à « … » ? »* avec **Enregistrer**, **Ne pas enregistrer** et **Annuler**. **Enregistrer** sur un document jamais enregistré ouvre une boîte de dialogue d'enregistrement dans votre dossier d'enregistrement par défaut, avec le titre de l'onglet comme nom suggéré. Annuler cette boîte de dialogue, ou un enregistrement qui échoue, laisse l'onglet ouvert.
- **Fermer une fenêtre** contenant un document non enregistré pose la même question. Avec deux documents ou plus, une seule boîte de dialogue les liste tous — les documents jamais enregistrés sont marqués *(nouveau)* — avec **Tout enregistrer**, **Ne pas enregistrer** et **Annuler**.
- **Tout enregistrer** enregistre chaque document qui a un fichier. Pour les documents jamais enregistrés, il demande un emplacement : une boîte de dialogue d'enregistrement s'il n'y en a qu'un, ou **un seul sélecteur de dossier** pour plusieurs (*« Choisir un dossier pour N nouveaux documents »*). Chacun est ensuite enregistré dans ce dossier sous son titre, et un nom déjà pris reçoit un numéro (`Untitled 2.md`), de sorte que rien n'est écrasé.
- **Quitter** (`Mod + Q`) effectue la même vérification dans chaque fenêtre, une fenêtre à la fois ; annuler dans n'importe quelle fenêtre annule la fermeture de l'application. Avec **Paramètres → Fichiers et images → Confirmer la fermeture** activé (par défaut), le premier appui affiche seulement *« Appuyez à nouveau sur ⌘Q pour quitter »* — appuyez à nouveau dans les deux secondes. Une fermeture demandée par le système d'exploitation (lors d'un arrêt, par exemple) se passe du double appui.
- **Tout enregistrer et quitter** enregistre les documents non enregistrés de chaque fenêtre sans la boîte de dialogue — en demandant toujours où placer ceux qui n'ont jamais été enregistrés (une boîte d'enregistrement, ou un sélecteur de dossier pour plusieurs, dans la fenêtre qui les contient) — puis quitte. Si un document ne peut pas être enregistré, ou si vous annulez cette boîte de dialogue, la fermeture s'arrête : cette fenêtre reste ouverte, et un enregistrement échoué en indique la raison.

Sur macOS, VMark continue de fonctionner après la fermeture de sa dernière fenêtre ; sous Windows et Linux, fermer la dernière fenêtre quitte l'application — sauf si, sous Windows, **Paramètres → Fichiers et images → Réduire dans la zone de notification à la fermeture** est activé : la dernière fenêtre est alors masquée dans la zone de notification, sans rien fermer et sans demande d'enregistrement (voir [Paramètres](/fr/guide/settings)).
