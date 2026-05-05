# Guia de Formatação CJK

O VMark inclui um conjunto abrangente de regras de formatação para texto em Chinês, Japonês e Coreano. Essas ferramentas ajudam a manter uma tipografia consistente ao misturar caracteres CJK e latinos.

## Início Rápido

Use **Formatar → Formatar Documento CJK** ou pressione `Alt + Mod + Shift + F` para formatar todo o documento.

Para formatar apenas uma seleção, use `Mod + Shift + F`.

---

## Regras de Formatação

### 1. Espaçamento CJK-Latino

Adiciona automaticamente espaços entre caracteres/números CJK e latinos.

| Antes | Depois |
|-------|--------|
| 学习Python编程 | 学习 Python 编程 |
| 共100个 | 共 100 个 |
| 使用macOS系统 | 使用 macOS 系统 |

### 2. Pontuação de Largura Total

Converte pontuação de meia largura para largura total em contexto CJK.

| Antes | Depois |
|-------|--------|
| 你好,世界 | 你好，世界 |
| 什么? | 什么？ |
| 注意:重要 | 注意：重要 |

### 3. Conversão de Caracteres de Largura Total

Converte letras e números de largura total para meia largura.

| Antes | Depois |
|-------|--------|
| １２３４ | 1234 |
| ＡＢＣ | ABC |

### 4. Conversão de Parênteses

Converte parênteses de meia largura para largura total quando cercam conteúdo CJK.

| Antes | Depois |
|-------|--------|
| (注意) | （注意） |
| [重点] | 【重点】 |
| (English) | (English) |

### 5. Conversão de Travessão

Converte hífens duplos em travessões CJK adequados.

| Antes | Depois |
|-------|--------|
| 原因--结果 | 原因 —— 结果 |
| 说明--这是 | 说明 —— 这是 |

### 6. Conversão de Aspas Inteligentes

O VMark usa um **algoritmo de emparelhamento de aspas baseado em pilha** que trata corretamente:

- **Apóstrofos**: Contrações como `don't`, `it's`, `l'amour` são preservadas
- **Possessivos**: `Xiaolai's` permanece inalterado
- **Primas**: Medidas como `5'10"` (pés/polegadas) são preservadas
- **Décadas**: Abreviações como `'90s` são reconhecidas
- **Detecção de contexto CJK**: Aspas ao redor de conteúdo CJK recebem aspas curvas/de canto

| Antes | Depois |
|-------|--------|
| 他说"hello" | 他说 "hello" |
| "don't worry" | "don't worry" |
| 5'10" tall | 5'10" tall |

Com a opção de colchetes de canto habilitada:

| Antes | Depois |
|-------|--------|
| "中文内容" | 「中文内容」 |
| 「包含'嵌套'」 | 「包含『嵌套』」 |

### 7. Normalização de Reticências

Padroniza a formatação de reticências.

| Antes | Depois |
|-------|--------|
| 等等. . . | 等等... |
| 然后. . .继续 | 然后... 继续 |

### 8. Pontuação Repetida

Limita sinais de pontuação consecutivos (limite configurável).

| Antes | Depois (limite=1) |
|-------|-------------------|
| 太棒了！！！ | 太棒了！ |
| 真的吗？？？ | 真的吗？ |

### 9. Outras Limpezas

- Múltiplos espaços comprimidos: `多个   空格` → `多个 空格`
- Espaços em branco no final removidos
- Espaçamento de barra: `A / B` → `A/B`
- Espaçamento de moeda: `$ 100` → `$100`

---

## Conteúdo Protegido

O seguinte conteúdo **não** é afetado pela formatação:

- Blocos de código (```)
- Código inline (`)
- URLs de links
- Caminhos de imagem
- Tags HTML
- Frontmatter YAML
- Pontuação escapada com barra invertida (ex: `\,` permanece como `,`)

### Construtos Técnicos

O **Verificador de Abrangência Latina** do VMark detecta e protege automaticamente construtos técnicos da conversão de pontuação:

| Tipo | Exemplos | Proteção |
|------|----------|----------|
| URLs | `https://example.com` | Toda pontuação preservada |
| E-mails | `user@example.com` | @ e . preservados |
| Versões | `v1.2.3`, `1.2.3.4` | Pontos preservados |
| Decimais | `3.14`, `0.5` | Ponto preservado |
| Horas | `12:30`, `1:30:00` | Dois-pontos preservados |
| Milhares | `1,000`, `1,000,000` | Vírgulas preservadas |
| Domínios | `example.com` | Ponto preservado |

Exemplo:

| Antes | Depois |
|-------|--------|
| 版本v1.2.3发布 | 版本 v1.2.3 发布 |
| 访问https://example.com获取 | 访问 https://example.com 获取 |
| 温度是3.14度 | 温度是 3.14 度 |

### Escapes com Barra Invertida

Prefixe qualquer pontuação com `\` para evitar a conversão:

| Entrada | Saída |
|---------|-------|
| `价格\,很贵` | 价格,很贵 (vírgula permanece de meia largura) |
| `测试\.内容` | 测试.内容 (ponto permanece de meia largura) |

---

## Formatação assistida por IA

Quando o [servidor MCP](/pt-BR/guide/mcp-setup) está conectado, assistentes de IA podem aplicar a formatação CJK programaticamente via a ferramenta `document.transform` com um destes três valores de `kind`:

- `"cjk-format"` — normalização CJK completa (espaçamento + pontuação + aspas inteligentes conforme suas configurações)
- `"cjk-spacing"` — ajusta apenas o espaço em branco nos limites CJK ↔ Latim/dígito
- `"cjk-punctuation"` — converte a pontuação entre largura total e meia largura segundo as regras

Cada transformação executa um ciclo de serialização-formatação-análise no documento ativo para preservar as marcas inline (negrito, links, matemática, etc.) e respeitar suas regras de formatação configuradas.

Consulte a [Referência de Ferramentas MCP](/pt-BR/guide/mcp-tools#document-tool) para o formato completo da requisição — `document.transform` recebe `tabId`, `kind` e um `expected_revision` para concorrência otimista.

## Configuração

As opções de formatação CJK podem ser configuradas em Configurações → Idioma:

- Habilitar/desabilitar regras específicas
- Definir limite de repetição de pontuação
- Escolher estilo de aspas (padrão ou colchetes de canto)

### Aspas contextuais

Quando **Aspas Contextuais** está habilitado (padrão):

- Aspas ao redor de conteúdo CJK → aspas curvas `""`
- Aspas ao redor de conteúdo puramente latino → aspas retas `""`

Isso preserva a aparência natural do texto em inglês enquanto formata adequadamente o conteúdo CJK.

### Colchetes de canto CJK *(desligado por padrão)*

Quando **Aspas de Canto CJK** está habilitado, as aspas curvas ao redor de conteúdo CJK são convertidas em colchetes de canto (`「」` para o nível primário, `『』` para o aninhado) — a forma de citação tradicional na composição vertical de textos CJK. O conteúdo latino mantém aspas curvas padrão, independentemente desta opção.

### Pular seção de referências

O formatador CJK detecta cabeçalhos "References" / "参考文献" / "参考资料" / "Bibliography" e pula a reformatação dessas seções — texto formatado como citação muitas vezes depende de pontuação específica que as regras CJK normalizariam.

### Verificação de integridade

Após cada passada de formatação CJK, o formatador executa uma verificação de integridade que compara o conteúdo de texto visível (ignorando as transformações de espaço em branco e pontuação) antes e depois. Se a verificação falhar, a operação é revertida e um diagnóstico aparece — garantindo que a formatação CJK nunca perca conteúdo silenciosamente.

---

## Espaçamento entre Letras CJK

O VMark inclui um recurso dedicado de espaçamento entre letras para texto CJK que melhora a legibilidade adicionando espaçamento sutil entre caracteres.

### Configurações

Configure em **Configurações → Editor → Tipografia → Espaçamento entre Letras CJK**:

| Opção | Valor | Descrição |
|-------|-------|-----------|
| Desligado | 0 | Sem espaçamento entre letras (padrão) |
| Sutil | 0.02em | Espaçamento quase imperceptível |
| Leve | 0.03em | Espaçamento leve |
| Normal | 0.05em | Recomendado para a maioria dos casos |
| Amplo | 0.08em | Espaçamento mais pronunciado |

### Como Funciona

- Aplica CSS de letter-spacing a sequências de caracteres CJK
- Exclui blocos de código e código inline
- Funciona tanto no modo WYSIWYG quanto no HTML exportado
- Sem efeito em texto latino ou números

### Exemplo

Sem espaçamento entre letras:
> 这是一段中文文字，没有任何字间距。

Com espaçamento de 0.05em entre letras:
> 这 是 一 段 中 文 文 字 ， 有 轻 微 的 字 间 距 。

A diferença é sutil, mas melhora a legibilidade, especialmente em trechos mais longos.

---

## Estilos de Aspas Inteligentes

O VMark pode converter automaticamente aspas retas em aspas tipograficamente corretas. Esse recurso funciona durante a formatação CJK e suporta múltiplos estilos de aspas.

### Estilos de Aspas

| Estilo | Aspas Duplas | Aspas Simples |
|--------|--------------|---------------|
| Curvas | "texto" | 'texto' |
| Colchetes de Canto | 「texto」 | 『texto』 |
| Guillemets | «texto» | ‹texto› |

### Algoritmo de Emparelhamento Baseado em Pilha

O VMark usa um algoritmo sofisticado baseado em pilha para emparelhamento de aspas:

1. **Tokenização**: Identifica todos os caracteres de aspas no texto
2. **Classificação**: Determina se cada aspa é de abertura ou fechamento com base no contexto
3. **Detecção de Apóstrofo**: Reconhece contrações (don't, it's) e as preserva
4. **Detecção de Prima**: Reconhece medidas (5'10") e as preserva
5. **Detecção de Contexto CJK**: Verifica se o conteúdo entre aspas envolve caracteres CJK
6. **Limpeza de Órfãos**: Trata aspas sem par de forma elegante

### Exemplos

| Antes | Depois (Curvas) |
|-------|-----------------|
| "hello" | "hello" |
| 'world' | 'world' |
| it's | it's |
| don't | don't |
| 5'10" | 5'10" |
| '90s | '90s |

Apóstrofos em contrações (como "it's" ou "don't") são preservados corretamente.

### Alternar Estilo de Aspas no Cursor

Você pode alternar rapidamente o estilo de aspas existentes sem reformatar todo o documento. Posicione o cursor dentro de qualquer par de aspas e pressione `Shift + Mod + '` para alternar.

**Modo simples** (padrão): Alterna entre aspas retas e seu estilo preferido.

| Antes | Depois | Depois novamente |
|-------|--------|------------------|
| "hello" | "hello" | "hello" |
| 'world' | 'world' | 'world' |

**Modo de ciclo completo**: Percorre todos os quatro estilos.

| Etapa | Duplas | Simples |
|-------|--------|---------|
| 1 | "texto" | 'texto' |
| 2 | "texto" | 'texto' |
| 3 | 「texto」 | 『texto』 |
| 4 | «texto» | ‹texto› |
| 5 | "texto" (volta ao início) | 'texto' |

**Aspas aninhadas**: Quando as aspas estão aninhadas, o comando alterna o par **mais interno** que envolve o cursor.

**Detecção inteligente**: Apóstrofos (`don't`), primas (`5'10"`) e abreviações de décadas (`'90s`) nunca são tratados como pares de aspas.

::: tip
Alterne entre o modo simples e o modo de ciclo completo em Configurações → Idioma → Formatação CJK → Modo de Alternância de Aspas.
:::

### Configuração

Habilite a Conversão de Aspas Inteligentes em Configurações → Idioma → Formatação CJK. Você também pode selecionar seu estilo de aspas preferido no menu suspenso.

---

## Conversão de Colchetes de Canto CJK

Quando **Aspas de Canto CJK** está habilitado, aspas curvas ao redor de conteúdo CJK são automaticamente convertidas em colchetes de canto.

### Caracteres Suportados

A conversão de colchetes de canto é acionada quando o conteúdo entre aspas contém **caracteres chineses** (Ideogramas CJK Unificados U+4E00–U+9FFF):

| Tipo de Conteúdo | Exemplo | Converte? |
|------------------|---------|-----------|
| Chinês | `"中文"` | ✓ `「中文」` |
| Japonês com Kanji | `"日本語"` | ✓ `「日本語」` |
| Apenas Hiragana | `"ひらがな"` | ✗ permanece como `"ひらがな"` |
| Apenas Katakana | `"カタカナ"` | ✗ permanece como `"カタカナ"` |
| Coreano | `"한글"` | ✗ permanece como `"한글"` |
| Inglês | `"hello"` | ✗ permanece como `"hello"` |

**Dica:** Para texto japonês com apenas Kana, use manualmente colchetes de canto `「」` ou inclua pelo menos um caractere Kanji.

---

## Parágrafo de Teste

Copie este texto não formatado no VMark e pressione `Alt + Mod + Shift + F` para formatar:

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

### Resultado Esperado

Após a formatação, o texto ficará assim:

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

**Alterações aplicadas:**
- Espaçamento CJK-Latino adicionado (学习 TypeScript)
- Pontuação de largura total convertida (，。！)
- Números de largura total normalizados (３→3, １０００→1000, ２００→200)
- Hífens duplos convertidos em travessões (-- → ——)
- Reticências normalizadas (. . . → ...)
- Aspas inteligentes aplicadas, apóstrofo preservado (don't)
- Construtos técnicos protegidos (https://example.com/docs, v2.0.0, $99.99, 12:30)
