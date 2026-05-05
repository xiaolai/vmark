# Guide de mise en forme CJK

VMark inclut un ensemble complet de règles de mise en forme pour les textes chinois, japonais et coréen. Ces outils aident à maintenir une typographie cohérente lors du mélange de caractères CJK et latins.

## Démarrage rapide

Utilisez **Format → Formater le document CJK** ou appuyez sur `Alt + Mod + Shift + F` pour formater l'intégralité du document.

Pour formater uniquement une sélection, utilisez `Mod + Shift + F`.

---

## Règles de mise en forme

### 1. Espacement CJK-Latin

Ajoute automatiquement des espaces entre les caractères CJK et les caractères/chiffres latins.

| Avant | Après |
|-------|-------|
| 学习Python编程 | 学习 Python 编程 |
| 共100个 | 共 100 个 |
| 使用macOS系统 | 使用 macOS 系统 |

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

Convertit les crochets demi-largeur en pleine largeur lorsqu'ils entourent du contenu CJK.

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
| 他说"hello" | 他说 "hello" |
| "don't worry" | "don't worry" |
| 5'10" tall | 5'10" tall |

Avec l'option de crochets d'angle activée :

| Avant | Après |
|-------|-------|
| "中文内容" | 「中文内容」 |
| 「包含'嵌套'」 | 「包含『嵌套』」 |

### 7. Normalisation des points de suspension

Standardise la mise en forme des points de suspension.

| Avant | Après |
|-------|-------|
| 等等. . . | 等等... |
| 然后. . .继续 | 然后... 继续 |

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
- Espacement des devises : `$ 100` → `$100`

---

## Contenu protégé

Le contenu suivant **n'est pas** affecté par la mise en forme :

- Blocs de code (```)
- Code en ligne (`)
- URL des liens
- Chemins d'images
- Balises HTML
- Frontmatter YAML
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

- `"cjk-format"` — normalisation CJK complète (espacement + ponctuation + guillemets intelligents selon vos paramètres)
- `"cjk-spacing"` — ajuste uniquement les espaces autour des frontières CJK ↔ Latin/chiffres
- `"cjk-punctuation"` — convertit la ponctuation entre pleine largeur et demi-largeur selon les règles

Chaque transformation fait passer le document actif par un aller-retour sérialisation-formatage-analyse afin de préserver les marques en ligne (gras, liens, maths, etc.) et de respecter vos règles de mise en forme configurées.

Consultez la [Référence des outils MCP](/fr/guide/mcp-tools#document-tool) pour la forme complète de la requête — `document.transform` prend `tabId`, `kind` et un `expected_revision` pour la concurrence optimiste.

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

Le formateur CJK détecte les titres «&nbsp;References&nbsp;» / «&nbsp;参考文献&nbsp;» / «&nbsp;参考资料&nbsp;» / «&nbsp;Bibliography&nbsp;» et saute la reformulation dans ces sections — le texte au format de citation s'appuie souvent sur une ponctuation spécifique que les règles CJK normaliseraient autrement.

### Vérification d'intégrité

Après chaque passage de mise en forme CJK, le formateur exécute une vérification d'intégrité qui compare le contenu textuel visible (en ignorant les transformations d'espaces/de ponctuation) avant et après. Si la vérification échoue, l'opération est annulée et un diagnostic apparaît — garantit que la mise en forme CJK ne perd jamais silencieusement de contenu.

---

## Espacement des lettres CJK

VMark inclut une fonctionnalité d'espacement des lettres dédiée au texte CJK qui améliore la lisibilité en ajoutant un espacement subtil entre les caractères.

### Paramètres

Configurez dans **Paramètres → Éditeur → Typographie → Espacement des lettres CJK** :

| Option | Valeur | Description |
|--------|--------|-------------|
| Désactivé | 0 | Aucun espacement des lettres (par défaut) |
| Subtil | 0.02em | Espacement à peine perceptible |
| Léger | 0.03em | Espacement léger |
| Normal | 0.05em | Recommandé pour la plupart des usages |
| Large | 0.08em | Espacement plus prononcé |

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
6. **Nettoyage des orphelins** : Gère gracieusement les guillemets non appariés

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

Vous pouvez rapidement basculer le style de guillemets des guillemets existants sans reformater l'intégralité du document. Placez votre curseur à l'intérieur d'une paire de guillemets et appuyez sur `Shift + Mod + '` pour basculer.

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

La conversion en crochets d'angle se déclenche lorsque le contenu entre guillemets contient des **caractères chinois** (idéographes unifiés CJK U+4E00–U+9FFF) :

| Type de contenu | Exemple | Conversion ? |
|-----------------|---------|--------------|
| Chinois | `"中文"` | ✓ `「中文」` |
| Japonais avec kanji | `"日本語"` | ✓ `「日本語」` |
| Hiragana uniquement | `"ひらがな"` | ✗ reste `"ひらがな"` |
| Katakana uniquement | `"カタカナ"` | ✗ reste `"カタカナ"` |
| Coréen | `"한글"` | ✗ reste `"한글"` |
| Anglais | `"hello"` | ✗ reste `"hello"` |

**Conseil :** Pour le texte japonais avec seulement des kana, utilisez manuellement les crochets d'angle `「」` ou incluez au moins un kanji.

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

学习过程中遇到的最大挑战是 —— 状态管理。Redux 的概念... 说实话有点难理解。后来换成了 Zustand，简单多了！

老师说 "don't give up" 然后继续讲 "写代码要注重可读性"，我觉得很有道理。

访问 https://example.com/docs 获取 v2.0.0 版本文档，价格 $99.99，时间 12:30 开始。

项目使用的技术栈如下：

- **Frontend** —— React + TypeScript
- **Backend** —— Node.js + Express
- **Database** —— PostgreSQL

总共花费大约 $200 美元购买了学习资源，包括书籍和 online courses。虽然价格不便宜，但非常值得。

---

**Modifications appliquées :**
- Espacement CJK-Latin ajouté (学习 TypeScript)
- Ponctuation pleine largeur convertie (，。！)
- Chiffres pleine largeur normalisés (３→3, １０００→1000, ２００→200)
- Doubles tirets convertis en tirets cadratin (-- → ——)
- Points de suspension normalisés (. . . → ...)
- Guillemets intelligents appliqués, apostrophe préservée (don't)
- Constructions techniques protégées (https://example.com/docs, v2.0.0, $99.99, 12:30)
