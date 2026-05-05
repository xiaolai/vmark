# Navegação Inteligente com Tab

As teclas Tab e Shift+Tab do VMark são sensíveis ao contexto — elas ajudam você a navegar eficientemente por texto formatado, parênteses e links sem precisar das teclas de seta.

## Visão Geral Rápida

| Contexto | Ação do Tab | Ação do Shift+Tab |
|----------|-------------|-------------------|
| Dentro de parênteses `()` `[]` `{}` | Pular após o parêntese de fechamento | Pular antes do parêntese de abertura |
| Dentro de aspas `""` `''` | Pular após a aspa de fechamento | Pular antes da aspa de abertura |
| Dentro de parênteses CJK `「」` `『』` | Pular após o parêntese de fechamento | Pular antes do parêntese de abertura |
| Dentro de **negrito**, *itálico*, `código`, ~~tachado~~ | Pular após a formatação | Pular antes da formatação |
| Dentro de um link | Pular após o link | Pular antes do link |
| Em uma célula de tabela | Mover para a próxima célula | Mover para a célula anterior |
| Em um item de lista | Indentar o item | Desindentar o item |

## Escape de Parênteses e Aspas

Quando o cursor estiver logo antes de um parêntese ou aspa de fechamento, pressionar Tab pula sobre ele. Quando o cursor estiver logo após um parêntese ou aspa de abertura, pressionar Shift+Tab volta antes dele.

### Caracteres Suportados

**Parênteses e aspas padrão:**
- Parênteses: `( )`
- Colchetes: `[ ]`
- Chaves: `{ }`
- Aspas duplas: `" "`
- Aspas simples: `' '`
- Acentos graves: `` ` ``

**Parênteses CJK:**
- Parênteses de largura total: `（ ）`
- Colchetes lenticulares: `【 】`
- Colchetes de canto: `「 」`
- Colchetes de canto brancos: `『 』`
- Colchetes de ângulo duplo: `《 》`
- Colchetes de ângulo: `〈 〉`

**Aspas curvas:**
- Aspas duplas curvas: `" "`
- Aspas simples curvas: `' '`

### Como Funciona

```text
function hello(world|)
                    ↑ cursor antes de )
```

Pressione **Tab**:

```text
function hello(world)|
                     ↑ cursor após )
```

Isso também funciona com parênteses aninhados — Tab pula sobre o caractere de fechamento imediatamente adjacente.

Pressionar **Shift+Tab** reverte a ação — se o cursor estiver logo após um caractere de abertura:

```text
function hello(|world)
               ↑ cursor após (
```

Pressione **Shift+Tab**:

```text
function hello|(world)
              ↑ cursor antes de (
```

### Exemplo CJK

```text
这是「测试|」文字
         ↑ cursor antes de 」
```

Pressione **Tab**:

```text
这是「测试」|文字
          ↑ cursor após 」
```

## Escape de Formatação (Modo WYSIWYG)

No modo WYSIWYG, Tab e Shift+Tab podem escapar das marcas de formatação inline.

### Formatos Suportados

- Texto em **negrito**
- Texto em *itálico*
- `Código inline`
- ~~Tachado~~
- Links

### Como Funciona

Quando o cursor estiver em qualquer lugar dentro do texto formatado:

```text
This is **bold te|xt** here
                 ↑ cursor dentro do negrito
```

Pressione **Tab**:

```text
This is **bold text**| here
                     ↑ cursor após o negrito
```

Shift+Tab funciona ao contrário — salta para o início da formatação:

```text
This is **bold te|xt** here
                 ↑ cursor dentro do negrito
```

Pressione **Shift+Tab**:

```text
This is |**bold text** here
        ↑ cursor antes do negrito
```

### Escape de Link

Tab e Shift+Tab também escapam de links:

```text
Check out [VMark|](https://vmark.app)
               ↑ cursor dentro do texto do link
```

Pressione **Tab**:

```text
Check out [VMark](https://vmark.app)| and...
                                    ↑ cursor após o link
```

Pressionar **Shift+Tab** dentro de um link move para o início:

```text
Check out |[VMark](https://vmark.app) and...
          ↑ cursor antes do link
```

## Navegação em Links (Modo Fonte)

No modo Fonte, Tab fornece navegação inteligente dentro da sintaxe de link Markdown.

### Parênteses Aninhados e Escapados

O VMark trata corretamente a sintaxe de link complexa:

```markdown
[text [with nested] brackets](url)     ✓ Funciona
[text \[escaped\] brackets](url)       ✓ Funciona
[link](https://example.com/page(1))    ✓ Funciona
```

A navegação Tab identifica corretamente os limites do link mesmo com parênteses aninhados ou escapados.

### Links Padrão

```markdown
[link text|](url)
          ↑ cursor no texto
```

Pressione **Tab** → o cursor se move para a URL:

```markdown
[link text](|url)
            ↑ cursor na URL
```

Pressione **Tab** novamente → o cursor sai do link:

```markdown
[link text](url)|
                ↑ cursor após o link
```

### Links Wiki

```markdown
[[page name|]]
           ↑ cursor dentro do link
```

Pressione **Tab**:

```markdown
[[page name]]|
             ↑ cursor após o link
```

## Modo Fonte: Escape de Caracteres Markdown

No modo Fonte, Tab também pula sobre os caracteres de formatação Markdown:

| Caracteres | Usados Para |
|------------|-------------|
| `*` | Negrito/itálico |
| `_` | Negrito/itálico |
| `^` | Sobrescrito |
| `~~` | Tachado (pulado como unidade) |
| `==` | Destaque (pulado como unidade) |

### Exemplo

```markdown
This is **bold|** text
              ↑ cursor antes de **
```

Pressione **Tab**:

```markdown
This is **bold**| text
                ↑ cursor após **
```

::: info
O modo Fonte não tem escape Shift+Tab para caracteres markdown — Shift+Tab apenas desindentar (remove espaços iniciais).
:::

## Modo Fonte: Auto-Emparelhamento

No modo Fonte, digitar um caractere de formatação insere automaticamente seu par de fechamento:

| Caractere | Emparelhamento | Comportamento |
|-----------|----------------|---------------|
| `*` | `*\|*` ou `**\|**` | Baseado em atraso — espera 150ms para detectar simples vs duplo |
| `~` | `~\|~` ou `~~\|~~` | Baseado em atraso |
| `_` | `_\|_` ou `__\|__` | Baseado em atraso |
| `=` | `==\|==` | Sempre emparelha como duplo |
| `` ` `` | `` `\|` `` | Acento grave único emparelha após atraso |
| ` ``` ` | Delimitador de código | Acento grave triplo no início da linha cria um bloco de código delimitado |

O auto-emparelhamento é **desabilitado dentro de blocos de código delimitados** — digitar `*` em um bloco de código insere um `*` literal sem emparelhamento.

Backspace entre um par exclui ambas as metades: `*\|*` → Backspace → vazio.

## Navegação em Tabelas

Quando o cursor estiver dentro de uma tabela:

| Ação | Tecla |
|------|-------|
| Próxima célula | Tab |
| Célula anterior | Shift + Tab |
| Adicionar linha (na última célula) | Tab |

Tab na última célula da última linha adiciona automaticamente uma nova linha.

## Indentação de Lista

Quando o cursor estiver em um item de lista:

| Ação | Tecla |
|------|-------|
| Indentar item | Tab |
| Desindentar item | Shift + Tab |

## Configurações

O comportamento de escape do Tab pode ser personalizado em **Configurações → Editor**:

| Configuração | Efeito |
|-------------|--------|
| **Auto-emparelhar Parênteses** | Habilitar/desabilitar emparelhamento de parênteses e escape do Tab |
| **Parênteses CJK** | Incluir pares de parênteses CJK |
| **Aspas Curvas** | Incluir pares de aspas curvas (`""` `''`) |

::: tip
Se o escape do Tab conflitar com seu fluxo de trabalho, você pode desabilitar o auto-emparelhamento de parênteses completamente. O Tab então inserirá espaços (ou indentará em listas/tabelas) normalmente.
:::

## Comparação: Modo WYSIWYG vs Fonte

| Recurso | Tab (WYSIWYG) | Shift+Tab (WYSIWYG) | Tab (Fonte) | Shift+Tab (Fonte) |
|---------|---------------|---------------------|-------------|-------------------|
| Escape de parênteses | ✓ | ✓ | ✓ | — |
| Escape de parênteses CJK | ✓ | ✓ | ✓ | — |
| Escape de aspas curvas | ✓ | ✓ | ✓ | — |
| Escape de marca (negrito, etc.) | ✓ | ✓ | N/A | N/A |
| Escape de link | ✓ | ✓ | ✓ (navegação por campo) | — |
| Escape de caractere Markdown (`*`, `_`, `~~`, `==`) | N/A | N/A | ✓ | — |
| Auto-emparelhamento Markdown (`*`, `~`, `_`, `=`) | N/A | N/A | ✓ (baseado em atraso) | N/A |
| Navegação em tabelas | Próxima célula | Célula anterior | N/A | N/A |
| Indentação de lista | Indentar | Desindentar | Indentar | Desindentar |
| Suporte a múltiplos cursores | ✓ | ✓ | ✓ | — |
| Ignorado dentro de blocos de código | ✓ | ✓ | ✓ | N/A |

## Suporte a Múltiplos Cursores

O escape do Tab funciona com múltiplos cursores — cada cursor é processado independentemente.

### Como Funciona

Quando você tem múltiplos cursores e pressiona Tab ou Shift+Tab:
- **Tab**: Cursores dentro da formatação escapam para o final; cursores antes de parênteses de fechamento pulam sobre eles
- **Shift+Tab**: Cursores dentro da formatação escapam para o início; cursores após parênteses de abertura pulam antes deles
- Cursores em texto simples permanecem no lugar

### Exemplo

```text
**bold|** and [link|](url) and plain|
     ^1          ^2            ^3
```

Pressione **Tab**:

```text
**bold**| and [link](url)| and plain|
        ^1               ^2         ^3
```

Cada cursor escapa independentemente com base em seu contexto.

::: tip
Isso é particularmente poderoso para edições em massa — selecione múltiplas ocorrências com `Mod + D`, depois use Tab para escapar de todas ao mesmo tempo.
:::

## Prioridade e Comportamento em Blocos de Código

### Prioridade de Escape

Quando múltiplos alvos de escape se sobrepõem, o Tab os processa **do mais interno para o externo**:

```text
**bold text(|)** here
               ↑ Tab pula ) primeiro (parêntese é o mais interno)
```

Pressione **Tab** novamente:

```text
**bold text()**| here
               ↑ Tab escapa da marca de negrito
```

Isso significa que o pulo de parêntese sempre ocorre antes do escape de marca — você pode confiar que o Tab sairá dos parênteses primeiro, depois da formatação.

### Proteção de Bloco de Código

Os pulos de Tab e Shift+Tab por parênteses são **desabilitados dentro de blocos de código** — tanto nos nós `code_block` quanto nos spans de código inline. Isso evita que o Tab pule sobre parênteses em código, onde os parênteses são sintaxe literal:

```text
`array[index|]`
              ↑ Tab NÃO pula ] em código inline — insere espaços em vez disso
```

A inserção de auto-emparelhamento também é desabilitada dentro de blocos de código para os modos WYSIWYG e Fonte.

## Dicas

1. **Memória muscular** — Uma vez que você se acostuma com o escape do Tab, você se encontrará navegando muito mais rápido sem as teclas de seta.

2. **Funciona com auto-emparelhamento** — Quando você digita `(`, o VMark insere automaticamente `)`. Após digitar dentro, basta pressionar Tab para sair.

3. **Estruturas aninhadas** — Tab escapa um nível por vez. Para `((aninhado))`, você precisa de dois Tabs para sair completamente.

4. **Shift + Tab** — O espelho do Tab. Escapa para trás das marcas, links e parênteses de abertura. Em tabelas, move para a célula anterior. Em listas, desindentar o item.

5. **Múltiplos cursores** — O escape do Tab funciona com todos os seus cursores simultaneamente, tornando as edições em massa ainda mais rápidas.
