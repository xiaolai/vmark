# Navigation intelligente par Tab

Les touches Tab et Shift+Tab de VMark sont sensibles au contexte — elles vous aident à naviguer efficacement dans le texte formaté, les crochets et les liens sans avoir recours aux touches fléchées.

## Aperçu rapide

| Contexte | Action de Tab | Action de Shift+Tab |
|----------|--------------|---------------------|
| À l'intérieur de crochets `()` `[]` `{}` | Sauter après le crochet fermant | Sauter avant le crochet ouvrant |
| À l'intérieur de guillemets `""` `''` | Sauter après le guillemet fermant | Sauter avant le guillemet ouvrant |
| À l'intérieur de crochets CJK `「」` `『』` | Sauter après le crochet fermant | Sauter avant le crochet ouvrant |
| À l'intérieur de **gras**, *italique*, `code`, ~~barré~~ | Sauter après le formatage | Sauter avant le formatage |
| À l'intérieur d'un lien | Sauter après le lien | Sauter avant le lien |
| Dans une cellule de tableau | Passer à la cellule suivante | Passer à la cellule précédente |
| Dans un élément de liste | Indenter l'élément | Désindenter l'élément |

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
