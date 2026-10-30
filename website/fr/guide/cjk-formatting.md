# Guide de mise en forme CJK

VMark inclut un ensemble complet de règles de mise en forme pour les textes chinois, japonais et coréen. Ces outils aident à maintenir une typographie cohérente lors du mélange de caractères CJK et latins.

::: info Le coréen est délibérément laissé tel quel
Le coréen utilise un espacement des mots natif, et les particules s'attachent directement au mot qui les précède — `VMark에는`, jamais `VMark 에는`. Insérer une espace à cet endroit est une faute de grammaire, pas une préférence typographique ; **le hangul est donc exclu de toutes les règles d'espacement** ainsi que de la conversion en ponctuation pleine largeur. Le texte coréen passe sans modification ; seuls les caractères Han qu'il contient sont mis en forme.
:::

## Démarrage rapide

Utilisez **Format → CJK → Mettre en forme le fichier entier** ou appuyez sur `Alt + Mod + Shift + F` pour formater l'intégralité du document.

**Format → CJK → Mettre en forme la sélection** (`Mod + Shift + F`) met en forme **les blocs que votre sélection recouvre** — le paragraphe, la liste ou le tableau entier que le curseur ou la sélection touche, et non les caractères exactement sélectionnés. L'espacement CJK est une propriété de la frontière *entre* deux caractères adjacents, et une sélection à mi-mot ne contient aucune frontière de ce type ; la commande désigne donc une région à corriger plutôt qu'un texte à réécrire. Sans sélection, elle met en forme le bloc où se trouve le curseur.

Les deux commandes protègent exactement les mêmes éléments (voir [Contenu protégé](#contenu-protege)), donc tout sélectionner avant `Mod + Shift + F` est sans risque.

---

## Règles de mise en forme

### 1. Espacement CJK-Latin

Ajoute automatiquement des espaces entre les caractères CJK et les caractères/chiffres latins, y compris
les nombres signés (négatifs, positifs, plus-ou-moins) et les nombres précédés d'un symbole
monétaire.

| Avant | Après |
|-------|-------|
| 学习Python编程 | 学习 Python 编程 |
| 共100个 | 共 100 个 |
| 使用macOS系统 | 使用 macOS 系统 |
| 我有-1个 | 我有 -1 个 |
| 我有+1个 | 我有 +1 个 |
| 误差±5%范围 | 误差 ±5% 范围 |
| 中文-$100元 | 中文 -$100 元 |
| 范围-100到-200 | 范围 -100 到 -200 |

Les signes reconnus sont les ASCII `-` `+`, les pleine largeur `－` `＋`, le signe moins
Unicode `−` et le plus-ou-moins `±`. Un signe n'est rattaché au nombre que s'il est
suivi d'un chiffre (ou d'un symbole monétaire suivi d'un chiffre) ; ainsi, les identifiants
CJK-latins à trait d'union (ex. `中文-Web`) et les expressions CJK-CJK à trait d'union
(ex. `中文-我`) restent intacts, et les plages comme `5-10` sont préservées.

**Ce qui compte comme CJK et ce qui compte comme latin.** Un caractère CJK est un caractère
Han, hiragana, katakana ou bopomofo selon son écriture Unicode. Cela inclut les blocs Han
plus rares (Extension A, les extensions des plans supplémentaires et les idéogrammes de
compatibilité), la marque d'itération `々`, le zéro idéographique `〇`, les katakana
demi-largeur et la marque d'allongement `ー`. Un caractère latin est toute lettre de
l'écriture latine, lettres accentuées comprises ; les deux côtés d'un mot sont donc
espacés :

| Avant | Après |
|-------|-------|
| 中文café中文 | 中文 café 中文 |
| 中文𠀀abc | 中文𠀀 abc |
| ｶﾀｶﾅabc | ｶﾀｶﾅ abc |
| 日本・東京 | 日本・東京 |

Les lettres latines pleine largeur (`Ａ`) portent leur propre espacement et ne sont jamais
espacées. Le point médian katakana `・` est un signe de ponctuation, pas une lettre ; aucune
espace n'est donc ajoutée à côté.

**Liens.** La parenthèse fermante d'un lien n'est séparée par une espace du texte CJK qui
la suit que lorsque le texte visible du lien se termine par une lettre latine ou un chiffre —
c'est l'écart que voit le lecteur. `参见[link](https://x.com)中文` devient
`参见[link](https://x.com) 中文` ; `参见[中文](https://x.com)中文` reste inchangé.

### 2. Ponctuation pleine largeur

Convertit la ponctuation demi-largeur en pleine largeur dans le contexte CJK.

| Avant | Après |
|-------|-------|
| 你好,世界 | 你好，世界 |
| 什么? | 什么？ |
| 注意:重要 | 注意：重要 |

### 3. Conversion des caractères pleine largeur

Convertit les lettres et chiffres pleine largeur en demi-largeur.

| Avant | Après |
|-------|-------|
| １２３４ | 1234 |
| ＡＢＣ | ABC |

### 4. Conversion des crochets

Convertit les crochets demi-largeur en pleine largeur lorsqu'ils entourent du contenu CJK. Les deux crochets doivent se trouver dans le même paragraphe : séparés par une ligne vide, ils restent tels qu'ils ont été saisis.

| Avant | Après |
|-------|-------|
| (注意) | （注意） |
| [重点] | 【重点】 |
| (English) | (English) |

### 5. Conversion des tirets

Convertit les doubles tirets en tirets CJK appropriés.

| Avant | Après |
|-------|-------|
| 原因--结果 | 原因 —— 结果 |
| 说明--这是 | 说明 —— 这是 |

### 6. Conversion des guillemets intelligents

VMark utilise un **algorithme d'appariement de guillemets basé sur une pile** qui gère correctement :

- **Apostrophes** : Les contractions comme `don't`, `it's`, `l'amour` sont préservées
- **Possessifs** : `Xiaolai's` reste tel quel
- **Symboles prime** : Les mesures comme `5'10"` (pieds/pouces) sont préservées
- **Décennies** : Les abréviations comme `'90s` sont reconnues
- **Détection de contexte CJK** : Les guillemets autour du contenu CJK reçoivent des guillemets courbes/crochets d'angle

| Avant | Après |
|-------|-------|
| 他说"hello" | 他说 “hello” |
| "don't worry" | “don't worry” |
| 5'10" tall | 5'10" tall |

Les guillemets courbes prennent une espace à côté du texte CJK : `他说"hello"` devient `他说 “hello”`. Les guillemets-crochets (`「 」`, `『 』`) et la ponctuation finale n'en prennent jamais. Pour garder les guillemets courbes serrés, désactivez **Corriger l'espacement des guillemets doubles** ou **Corriger l'espacement des guillemets simples** dans Réglages → Langue → Mise en forme CJK : `“ ”` et `‘ ’` sont pleine largeur en contexte CJK, et GB/T 15834 comme JLREQ considèrent l'écart comme faisant partie du glyphe — c'est la raison d'être de ces interrupteurs.

Avec l'option de crochets d'angle activée :

| Avant | Après |
|-------|-------|
| "中文内容" | 「中文内容」 |
| 「包含'嵌套'」 | 「包含『嵌套』」 |

### 7. Normalisation des points de suspension

Standardise la mise en forme des points de suspension, sous la forme qu'utilise l'écriture environnante. Il n'y a pas de réponse unique : le chinois (GB/T 15834) et le japonais (JIS X 4051) utilisent les points de suspension à six points `……` sans **aucune** espace après, le coréen utilise `…`, et seul le texte latin utilise `...` suivi d'une espace.

| Avant | Après |
|-------|-------|
| 等等. . . | 等等…… |
| 然后...继续 | 然后……继续 |
| そして...続く | そして……続く |
| 그리고...계속 | 그리고…계속 |
| wait...ok | wait... ok |

L'écriture est déterminée à partir des caractères immédiatement voisins des points, et non à partir du document ; ainsi, des `...` dans une citation anglaise au sein d'un fichier chinois conservent leur forme latine.

### 8. Ponctuation répétée

Limite les signes de ponctuation consécutifs (limite configurable).

| Avant | Après (limite=1) |
|-------|-----------------|
| 太棒了！！！ | 太棒了！ |
| 真的吗？？？ | 真的吗？ |

### 9. Autres nettoyages

- Espaces multiples compressés : `多个   空格` → `多个 空格`
- Espaces de fin de ligne supprimés
- Espacement des barres obliques : `A / B` → `A/B`
- Liaison des devises et des unités : `$ 100` → `$100`, `100 %` → `100%`. Seuls les espaces et les tabulations sont supprimés : un nombre en fin de ligne ou de paragraphe n'est jamais joint à une unité ou une devise de la ligne suivante, et une espace insécable que vous avez tapée entre un nombre et son unité est conservée

---

## Contenu protégé

Le contenu suivant **n'est pas** affecté par la mise en forme :

- Blocs de code (```) — y compris une clôture **non fermée**, qui s'étend jusqu'à la fin du document, comme le prévoit CommonMark
- Code en ligne (`)
- URL des liens
- Chemins d'images
- Balises HTML
- Frontmatter — aussi bien YAML (`---`) que TOML (`+++`)
- Mathématiques en ligne (`$…$`), détectées selon la même règle que le moteur de rendu de VMark, de sorte qu'une paire de montants comme `价格是 $100 和 $200 元` n'est *pas* prise pour des mathématiques
- Mathématiques en bloc (`$$…$$`)
- Blocs de code indentés
- Liens wiki (`[[target]]`, `[[target|display]]`)
- Marqueurs de notes de bas de page — les références comme `[^1]` et l'étiquette `[^1]:` d'une définition (le texte de la définition elle-même est mis en forme)
- Références de caractères HTML (`&amp;`, `&#x5176;`)
- Séparateurs thématiques (`---`, `***`)
- Ponctuation échappée par barre oblique inverse (ex. `\,` reste `,`)

### Constructions techniques

Le **scanner de plage latine** de VMark détecte et protège automatiquement les constructions techniques contre la conversion de ponctuation :

| Type | Exemples | Protection |
|------|----------|------------|
| URL | `https://example.com` | Toute la ponctuation préservée |
| E-mails | `user@example.com` | @ et . préservés |
| Versions | `v1.2.3`, `1.2.3.4` | Points préservés |
| Décimaux | `3.14`, `0.5` | Point préservé |
| Heures | `12:30`, `1:30:00` | Deux-points préservés |
| Milliers | `1,000`, `1,000,000` | Virgules préservées |
| Domaines | `example.com` | Point préservé |

Exemple :

| Avant | Après |
|-------|-------|
| 版本v1.2.3发布 | 版本 v1.2.3 发布 |
| 访问https://example.com获取 | 访问 https://example.com 获取 |
| 温度是3.14度 | 温度是 3.14 度 |

### Échappements par barre oblique inverse

Préfixez n'importe quelle ponctuation avec `\` pour empêcher la conversion :

| Entrée | Sortie |
|--------|--------|
| `价格\,很贵` | 价格,很贵 (la virgule reste demi-largeur) |
| `测试\.内容` | 测试.内容 (le point reste demi-largeur) |

---

## Mise en forme assistée par l'IA

Lorsque le [serveur MCP](/fr/guide/mcp-setup) est connecté, les assistants IA peuvent appliquer la mise en forme CJK de manière programmatique via l'outil `document.transform` avec l'une des trois valeurs `kind`&nbsp;:

- `"cjk-format"` — normalisation CJK complète (espacement + ponctuation + guillemets intelligents), le même formateur que celui qu'exécute la commande de menu, selon vos paramètres dans Paramètres → Langue
- `"cjk-spacing"` — insère une espace partout où un caractère CJK rencontre une lettre latine ou un chiffre, et rien d'autre
- `"cjk-punctuation"` — convertit les caractères demi-largeur `,` `.` `!` `?` `;` `:` `(` `)` voisins d'un caractère CJK en leur forme pleine largeur ; il ne convertit jamais la pleine largeur en demi-largeur

Seul `cjk-format` lit vos paramètres de mise en forme. `cjk-spacing` et `cjk-punctuation` sont des règles fixes qui les ignorent et, contrairement au formateur, traitent aussi le hangeul coréen comme du CJK. Les trois opèrent sur la source markdown du document et laissent le [contenu protégé](#contenu-protege) intact.

Consultez la [Référence des outils MCP](/fr/guide/mcp-tools#transform) pour la forme complète de la requête — `document.transform` prend `tabId`, `kind` et un `expected_revision` pour la concurrence optimiste.

## Configuration

Les options de mise en forme CJK peuvent être configurées dans Paramètres → Langue&nbsp;:

- Activer/désactiver des règles spécifiques
- Définir la limite de répétition de ponctuation
- Choisir le style de guillemets (standard ou crochets d'angle)

### Guillemets contextuels

Lorsque les **Guillemets contextuels** sont activés (par défaut)&nbsp;:

- Les guillemets autour du contenu CJK → guillemets courbes `""`
- Les guillemets autour du contenu purement latin → guillemets droits `""`

Cela préserve l'apparence naturelle du texte anglais tout en formatant correctement le contenu CJK.

### Crochets d'angle CJK *(désactivé par défaut)*

Lorsque les **Crochets d'angle CJK** sont activés, les guillemets courbes autour du contenu CJK sont convertis en crochets d'angle (`「」` pour le primaire, `『』` pour l'imbriqué) — la forme de citation typographiquement traditionnelle pour la composition CJK verticale. Le contenu latin conserve les guillemets courbes standard quel que soit ce paramètre.

### Saut des sections de références

Lorsque **Ignorer les sections de références** est activé dans Paramètres → Langue → Traitement des sections (désactivé par défaut), le formateur CJK détecte les titres «&nbsp;References&nbsp;» / «&nbsp;Further Reading&nbsp;» / «&nbsp;参考文献&nbsp;» / «&nbsp;参考资料&nbsp;» / «&nbsp;Bibliography&nbsp;» et saute la reformulation dans ces sections — le texte au format de citation s'appuie souvent sur une ponctuation spécifique que les règles CJK normaliseraient autrement. Activez-le pour les documents académiques ; laissez-le désactivé pour mettre en forme le fichier entier.

### Vérification d'intégrité

Après chaque passage de mise en forme CJK, le formateur compare le **squelette de contenu** du document avant et après : le texte débarrassé des espaces et de la ponctuation, avec la largeur des caractères normalisée. Toutes les règles de mise en forme ne modifient que des espaces, de la ponctuation ou la largeur d'un caractère alphanumérique ; ce squelette doit donc revenir identique — et comme il s'agit d'une séquence et non d'un décompte, un contenu réordonné est également détecté. Les lettres, les chiffres, les idéogrammes, les kana, le hangul et les émoji comptent tous.

Si la vérification échoue, le document reste **totalement inchangé** et une notification vous en informe. Un refus n'est jamais silencieux, et il n'est jamais confondu avec « il n'y avait rien à changer ».

---

## Espacement des lettres CJK

VMark inclut une fonctionnalité d'espacement des lettres dédiée au texte CJK qui améliore la lisibilité en ajoutant un espacement subtil entre les caractères.

### Paramètres

Configurez dans **Paramètres → Éditeur → Typographie → Espacement des caractères CJK** :

| Option | Valeur | Description |
|--------|--------|-------------|
| Désactivé | 0 | Aucun espacement des lettres (par défaut) |
| Subtil | 0.02em | Espacement à peine perceptible |
| Léger | 0.03em | Espacement léger |
| Normal | 0.05em | Recommandé pour la plupart des usages |
| Large | 0.08em | Espacement plus prononcé |
| Plus large | 0.10em | Plus large encore, pour les grandes tailles d'affichage |
| Extra | 0.12em | Le réglage le plus large |

### Fonctionnement

- Applique le CSS letter-spacing aux séquences de caractères CJK
- Exclut les blocs de code et le code en ligne
- Fonctionne en mode WYSIWYG et en HTML exporté
- Aucun effet sur le texte latin ou les chiffres

### Exemple

Sans espacement des lettres :
> 这是一段中文文字，没有任何字间距。

Avec espacement des lettres de 0.05em :
> 这 是 一 段 中 文 文 字 ， 有 轻 微 的 字 间 距 。

La différence est subtile mais améliore la lisibilité, surtout pour les longs passages.

---

## Styles de guillemets intelligents

VMark peut automatiquement convertir les guillemets droits en guillemets typographiquement corrects. Cette fonctionnalité s'applique lors de la mise en forme CJK et prend en charge plusieurs styles de guillemets.

### Styles de guillemets

| Style | Guillemets doubles | Guillemets simples |
|-------|-------------------|-------------------|
| Courbes | "texte" | 'texte' |
| Crochets d'angle | 「texte」 | 『texte』 |
| Guillemets | «texte» | ‹texte› |

### Algorithme d'appariement basé sur une pile

VMark utilise un algorithme sophistiqué basé sur une pile pour l'appariement des guillemets :

1. **Tokenisation** : Identifie tous les caractères de guillemets dans le texte
2. **Classification** : Détermine si chaque guillemet est ouvrant ou fermant selon le contexte
3. **Détection des apostrophes** : Reconnaît les contractions (don't, it's) et les préserve
4. **Détection des primes** : Reconnaît les mesures (5'10") et les préserve
5. **Détection de contexte CJK** : Vérifie si le contenu entre guillemets contient des caractères CJK
6. **Nettoyage des orphelins** : Gère gracieusement les guillemets non appariés ; un guillemet encore ouvert à la fin d'un paragraphe reste non apparié, si bien que des guillemets ne s'apparient jamais par-dessus une ligne vide

### Exemples

| Avant | Après (Courbes) |
|-------|-----------------|
| "hello" | "hello" |
| 'world' | 'world' |
| it's | it's |
| don't | don't |
| 5'10" | 5'10" |
| '90s | '90s |

Les apostrophes dans les contractions (comme « it's » ou « don't ») sont correctement préservées.

### Basculer le style de guillemets au curseur

Vous pouvez rapidement basculer le style de guillemets des guillemets existants sans reformater l'intégralité du document. Placez votre curseur à l'intérieur d'une paire de guillemets et appuyez sur `Shift + Mod + '` pour basculer. Cela ne fonctionne qu'en mode WYSIWYG ; le mode Source n'a pas de bascule des guillemets.

**Mode simple** (par défaut) : Bascule entre les guillemets droits et votre style préféré.

| Avant | Après | Encore |
|-------|-------|--------|
| "hello" | "hello" | "hello" |
| 'world' | 'world' | 'world' |

**Mode cycle complet** : Passe en revue les quatre styles.

| Étape | Double | Simple |
|-------|--------|--------|
| 1 | "texte" | 'texte' |
| 2 | "texte" | 'texte' |
| 3 | 「texte」 | 『texte』 |
| 4 | «texte» | ‹texte› |
| 5 | "texte" (retour au début) | 'texte' |

**Guillemets imbriqués** : Lorsque les guillemets sont imbriqués, la commande bascule la paire **la plus intérieure** entourant le curseur.

**Détection intelligente** : Les apostrophes (`don't`), les primes (`5'10"`) et les abréviations de décennies (`'90s`) ne sont jamais traités comme des paires de guillemets.

::: tip
Basculez entre le mode simple et le mode cycle complet dans Paramètres → Langue → Mise en forme CJK → Mode de basculement des guillemets.
:::

### Configuration

Activez la conversion des guillemets intelligents dans Paramètres → Langue → Mise en forme CJK. Vous pouvez également sélectionner votre style de guillemets préféré dans le menu déroulant.

---

## Conversion des crochets d'angle CJK

Lorsque les **Crochets d'angle CJK** sont activés, les guillemets courbes autour du contenu CJK sont automatiquement convertis en crochets d'angle.

### Caractères pris en charge

La conversion en crochets d'angle se déclenche lorsque le contenu entre guillemets — ou le texte
immédiatement voisin — est en Han, hiragana, katakana ou bopomofo :

| Type de contenu | Exemple | Conversion ? |
|-----------------|---------|--------------|
| Chinois | `"中文"` | ✓ `「中文」` |
| Japonais avec kanji | `"日本語"` | ✓ `「日本語」` |
| Hiragana uniquement | `"ひらがな"` | ✓ `「ひらがな」` |
| Katakana uniquement | `"カタカナ"` | ✓ `「カタカナ」` |
| Coréen | `"한글"` | ✗ reste `"한글"` |
| Anglais | `"hello"` | ✗ reste `"hello"` |

Le coréen est exclu pour la même raison que pour les règles d'espacement : le coréen utilise `“ ”`,
et non les crochets d'angle.

---

## Paragraphe de test

Copiez ce texte non formaté dans VMark et appuyez sur `Alt + Mod + Shift + F` pour le formater :

```text
最近我在学习TypeScript和React,感觉收获很大.作为一个developer,掌握这些modern前端技术是必须的.

目前已经完成了３个projects,代码量超过１０００行.其中最复杂的是一个dashboard应用,包含了数据可视化,用户认证,还有API集成等功能.

学习过程中遇到的最大挑战是--状态管理.Redux的概念. . .说实话有点难理解.后来换成了Zustand,简单多了!

老师说"don't give up"然后继续讲"写代码要注重可读性",我觉得很有道理.

访问https://example.com/docs获取v2.0.0版本文档,价格$99.99,时间12:30开始.

项目使用的技术栈如下:

- **Frontend**--React + TypeScript
- **Backend**--Node.js + Express
- **Database**--PostgreSQL

总共花费大约$２００美元购买了学习资源,包括书籍和online courses.虽然价格不便宜,但非常值得.
```

### Résultat attendu

Après la mise en forme, le texte ressemblera à ceci :

---

最近我在学习 TypeScript 和 React，感觉收获很大。作为一个 developer，掌握这些 modern 前端技术是必须的。

目前已经完成了 3 个 projects，代码量超过 1000 行。其中最复杂的是一个 dashboard 应用，包含了数据可视化，用户认证，还有 API 集成等功能。

学习过程中遇到的最大挑战是 —— 状态管理。Redux 的概念……说实话有点难理解。后来换成了 Zustand，简单多了！

老师说 “don't give up” 然后继续讲 “写代码要注重可读性”，我觉得很有道理。

访问 https://example.com/docs 获取 v2.0.0 版本文档，价格 $99.99，时间 12:30 开始。

项目使用的技术栈如下：

- **Frontend**--React + TypeScript
- **Backend**--Node.js + Express
- **Database**--PostgreSQL

总共花费大约 $200 美元购买了学习资源，包括书籍和 online courses。虽然价格不便宜，但非常值得。

---

**Modifications appliquées :**

- Espacement CJK-Latin ajouté (学习 TypeScript)
- Ponctuation pleine largeur convertie (，。！)
- Chiffres pleine largeur normalisés (３→3, １０００→1000, ２００→200)
- Doubles tirets convertis en tirets cadratin (是--状态 → 是 —— 状态)
- Points de suspension normalisés sous la forme chinoise, sans espace après (. . . → ……)
- Guillemets intelligents appliqués avec une espace à côté du texte CJK, apostrophe préservée (don't)
- Constructions techniques protégées (https://example.com/docs, v2.0.0, $99.99, 12:30)

**Et ce qui ne change _pas_ :** le `--` de `**Frontend**--React` reste un double
trait d'union. La conversion des tirets exige un caractère CJK ou un caractère alphanumérique
immédiatement à côté des tirets, et `*` n'est ni l'un ni l'autre. Se déclencher sur les marqueurs
d'emphase convertirait au contraire le `--` de chaque élément de liste purement anglais d'un
document chinois, ce qui serait pire que de laisser ces trois-là tels quels.
