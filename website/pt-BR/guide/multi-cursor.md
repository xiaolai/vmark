# Edição com Múltiplos Cursores

O VMark suporta edição poderosa com múltiplos cursores nos modos WYSIWYG e Fonte, permitindo editar múltiplos locais simultaneamente.

## Início Rápido

| Ação | Atalho |
|------|--------|
| Adicionar cursor na próxima correspondência | `Mod + D` |
| Pular correspondência, ir para a próxima | `Mod + Shift + D` |
| Adicionar cursores em todas as correspondências | `Mod + Shift + L` |
| Desfazer última adição de cursor | `Alt + Mod + Z` |
| Adicionar cursor acima | `Mod + Alt + Cima` |
| Adicionar cursor abaixo | `Mod + Alt + Baixo` |
| Adicionar/remover cursor com clique | `Alt + Clique` |
| Colapsar para cursor único | `Escape` |

::: tip
**Mod** = Cmd no macOS, Ctrl no Windows/Linux
**Alt** = Option no macOS
:::

## Adicionando Cursores

### Selecionar Próxima Ocorrência (`Mod + D`)

1. Selecione uma palavra ou posicione o cursor em uma palavra
2. Pressione `Mod + D` para adicionar um cursor na próxima ocorrência
3. Pressione novamente para adicionar mais cursores
4. Digite para editar todos os locais ao mesmo tempo

<div class="feature-box">
<strong>Exemplo:</strong> Para renomear uma variável <code>count</code> para <code>total</code>:
<ol>
<li>Dê um duplo clique em <code>count</code> para selecioná-la</li>
<li>Pressione <code>Mod + D</code> repetidamente para selecionar cada ocorrência</li>
<li>Digite <code>total</code> — todas as ocorrências são atualizadas simultaneamente</li>
</ol>
</div>

### Selecionar Todas as Ocorrências (`Mod + Shift + L`)

Selecione todas as ocorrências da palavra ou seleção atual de uma vez:

1. Selecione uma palavra ou texto
2. Pressione `Mod + Shift + L`
3. Todas as ocorrências correspondentes no bloco atual são selecionadas
4. Digite para substituir todas de uma vez

### Alt + Clique

Segure `Alt` (Option no macOS) e clique para:
- **Adicionar** um cursor nessa posição
- **Remover** um cursor se já existir um ali

Isso é útil para posicionar cursores em posições arbitrárias que não são texto correspondente.

### Pular Ocorrência (`Mod + Shift + D`)

Quando `Mod + D` seleciona uma correspondência que você não quer, pule-a:

1. Pressione `Mod + D` para começar a adicionar correspondências
2. Se a última correspondência for indesejada, pressione `Mod + Shift + D` para pulá-la
3. A correspondência pulada é removida e a próxima é selecionada

Este é o equivalente de múltiplos cursores do "Encontrar Próximo" — permite escolher quais ocorrências editar.

### Desfazer Suave (`Alt + Mod + Z`)

Desfaça a última adição de cursor sem perder todos os seus cursores:

1. Pressione `Mod + D` várias vezes para acumular cursores
2. Se você adicionou um a mais, pressione `Alt + Mod + Z`
3. O cursor adicionado por último é removido, restaurando o estado anterior

Ao contrário do `Escape` (que colapsa tudo), o desfazer suave recua um cursor por vez.

### Adicionar Cursor Acima / Abaixo (`Mod + Alt + Cima/Baixo`)

Adicione cursores verticalmente, uma linha por vez:

1. Posicione o cursor em uma linha
2. Pressione `Mod + Alt + Baixo` para adicionar um cursor na próxima linha
3. Pressione novamente para continuar adicionando cursores para baixo
4. Use `Mod + Alt + Cima` para adicionar cursores para cima

Isso é ideal para editar texto alinhado em colunas ou fazer a mesma edição em linhas consecutivas.

## Editando com Múltiplos Cursores

Uma vez que você tenha múltiplos cursores, toda a edição padrão funciona em cada cursor:

### Digitação
- Os caracteres são inseridos em todas as posições do cursor
- As seleções são substituídas em todas as posições

### Exclusão
- **Backspace** — exclui o caractere antes de cada cursor
- **Delete** — exclui o caractere após cada cursor

### Navegação
- **Teclas de seta** — movem todos os cursores juntos
- **Shift + Seta** — estendem a seleção em cada cursor
- **Mod + Seta** — saltam por palavra/linha em cada cursor

### Escape por Tab

O escape por Tab funciona independentemente para cada cursor:

- Cursores dentro de **negrito**, *itálico*, `código` ou ~~tachado~~ saltam para o final da formatação
- Cursores dentro de links escapam do link
- Cursores antes de parênteses de fechamento `)` `]` `}` saltam sobre eles
- Cursores em texto simples permanecem no lugar

Isso permite que você escape de múltiplas regiões formatadas simultaneamente. Veja [Navegação Inteligente com Tab](./tab-navigation.md#multi-cursor-support) para detalhes.

### Área de Transferência

**Copiar** (`Mod + C`):
- Copia texto de todas as seleções, unidas por novas linhas

**Colar** (`Mod + V`):
- Se a área de transferência tiver o mesmo número de linhas que cursores, cada linha vai para cada cursor
- Caso contrário, o conteúdo completo da área de transferência é colado em todos os cursores

## Escopo de Bloco

As operações de múltiplos cursores têm **escopo no bloco atual** para evitar edições não intencionais em seções não relacionadas.

### No Modo WYSIWYG
- Os cursores não podem cruzar os limites dos blocos de código
- Se o cursor principal estiver dentro de um bloco de código, os novos cursores permanecem dentro desse bloco

### No Modo Fonte
- Linhas em branco atuam como limites de bloco
- `Mod + D` e `Mod + Shift + L` só correspondem dentro do parágrafo atual

<div class="feature-box">
<strong>Por que o escopo de bloco?</strong>
<p>Isso evita editar acidentalmente um nome de variável em seções de código não relacionadas ou alterar texto em parágrafos diferentes que por acaso correspondem.</p>
</div>

## Colapsando Cursores

Pressione `Escape` para colapsar de volta para um único cursor na posição principal.

::: tip Estabilidade do cursor
Cursores colapsados permanecem estáveis quando o texto é inserido na posição do cursor. Eles não se expandirão inesperadamente em seleções após inserções mapeadas (corrigido na v0.6.x).
:::

## Feedback Visual

- **Cursor principal** — cursor piscante padrão
- **Cursores secundários** — cursores piscantes adicionais com estilo distinto
- **Seleções** — a seleção de cada cursor é destacada

No modo escuro, as cores do cursor e da seleção se ajustam automaticamente para visibilidade.

## Comparação de Modos

| Recurso | WYSIWYG | Fonte |
|---------|---------|-------|
| `Mod + D` | ✓ | ✓ |
| `Mod + Shift + D` (Pular) | ✓ | ✓ |
| `Mod + Shift + L` | ✓ | ✓ |
| `Alt + Mod + Z` (Desfazer Suave) | ✓ | ✓ |
| `Mod + Alt + Cima/Baixo` | ✓ | ✓ |
| `Alt + Clique` | ✓ | ✓ |
| Escopo de bloco | Delimitadores de código | Linhas em branco |
| Pesquisa com retorno | ✓ | ✓ |

## Dicas e Melhores Práticas

### Renomeando Variáveis
1. Dê um duplo clique no nome da variável
2. `Mod + Shift + L` para selecionar todas no bloco
3. Digite o novo nome

### Adicionando Prefixos/Sufixos
1. Posicione o cursor antes/depois do texto repetido
2. `Mod + D` para adicionar cursores em cada ocorrência
3. Digite o prefixo ou sufixo

### Editando Itens de Lista
1. Selecione o padrão comum (como `- ` no início das linhas)
2. `Mod + Shift + L` para selecionar todos
3. Edite todos os itens da lista ao mesmo tempo

### Quando Usar Cada Atalho

| Cenário | Melhor Atalho |
|---------|---------------|
| Seleção cuidadosa e incremental | `Mod + D` |
| Pular correspondência indesejada | `Mod + Shift + D` |
| Substituir todos no bloco | `Mod + Shift + L` |
| Desfazer último passo do cursor | `Alt + Mod + Z` |
| Editar linhas consecutivas | `Mod + Alt + Cima/Baixo` |
| Posições arbitrárias | `Alt + Clique` |
| Saída rápida | `Escape` |

## Limitações

- **Nós atômicos**: Não é possível posicionar cursores dentro de imagens, conteúdo embutido ou blocos matemáticos no modo WYSIWYG
- **Entrada IME**: Ao usar métodos de entrada (Chinês, Japonês, etc.), a composição afeta apenas o cursor principal
- **Em todo o documento**: As seleções têm escopo em blocos, não no documento inteiro

## Referência de Teclado

| Ação | Atalho |
|------|--------|
| Selecionar próxima ocorrência | `Mod + D` |
| Pular ocorrência | `Mod + Shift + D` |
| Selecionar todas as ocorrências | `Mod + Shift + L` |
| Desfazer cursor suave | `Alt + Mod + Z` |
| Adicionar cursor acima | `Mod + Alt + Cima` |
| Adicionar cursor abaixo | `Mod + Alt + Baixo` |
| Adicionar/remover cursor | `Alt + Clique` |
| Colapsar para cursor único | `Escape` |
| Mover todos os cursores | Teclas de seta |
| Estender todas as seleções | `Shift + Seta` |
| Saltar por palavra | `Alt + Seta` |
| Saltar por linha | `Mod + Seta` |

<!-- Styles in style.css -->
