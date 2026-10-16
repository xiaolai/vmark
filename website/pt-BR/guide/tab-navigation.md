# Navegação Inteligente com Tab

As teclas Tab e Shift+Tab do VMark são sensíveis ao contexto — elas ajudam você a navegar eficientemente por texto formatado, parênteses e links sem precisar das teclas de seta.

> Com o [trilho de workspaces](/pt-BR/guide/workspace-rail) experimental, a alternância entre abas e a faixa de abas abrangem apenas as abas do workspace ativo.

## Visão Geral Rápida

| Contexto | Ação do Tab | Ação do Shift+Tab |
|----------|-------------|-------------------|
| Dentro de parênteses `()` `[]` `{}` | Pular após o parêntese de fechamento | Pular antes do parêntese de abertura |
| Dentro de aspas `""` `''` | Pular após a aspa de fechamento | Pular antes da aspa de abertura |
| Dentro de parênteses CJK `「」` `『』` | Pular após o parêntese de fechamento | Pular antes do parêntese de abertura |
| Dentro de **negrito**, *itálico*, `código`, ~~tachado~~ | Pular após a formatação | Pular antes da formatação |
| Dentro de um link | Pular após o link | Pular antes do link |
| Em uma célula de tabela | Mover para a próxima célula | Mover para a célula anterior |
| Em um item de lista | Indentar o item | Desindentar o item (para no nível mais externo) |

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
O modo Fonte não tem escape Shift+Tab para caracteres markdown — Shift+Tab apenas desindenta (remove espaços iniciais).
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

Desindentar remove um nível de aninhamento e **para no nível mais externo** — o
item não é tirado da lista. Para sair de uma lista por completo, use **Remover
lista** ou pressione o botão de lista novamente para desativá-la.

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

4. **Shift + Tab** — O espelho do Tab. Escapa para trás das marcas, links e parênteses de abertura. Em tabelas, move para a célula anterior. Em listas, desindenta o item.

5. **Múltiplos cursores** — O escape do Tab funciona com todos os seus cursores simultaneamente, tornando as edições em massa ainda mais rápidas.

## Alternando entre abas abertas

As abas ficam na barra de status, na parte inferior da janela. Há três formas de
se mover entre elas:

| Ação | Atalho | Observações |
|---|---|---|
| Última aba usada | `Ctrl + Tab` | Vai para a aba em que você estava antes desta. Pressione de novo para voltar direto. |
| Próxima aba / Aba anterior | `Mod + Shift + ]` / `Mod + Shift + [` | Percorre a faixa em ordem, independentemente do que você usou recentemente. |
| Abertura rápida | `Mod + O` | Digite para filtrar. As abas abertas são listadas primeiro, com as usadas mais recentemente no topo. |

**Última aba usada é uma alternância, não um ciclo.** Ela leva você ao documento
em que esteve mais recentemente, e pressioná-la uma segunda vez devolve você ao
ponto de partida — a forma rápida de trabalhar entre dois arquivos. Próxima aba e
Aba anterior percorrem a faixa por posição, que é o que você quer quando está
procurando algo, e não voltando a ele.

Ela é um item de menu além de um atalho (**Visualizar → Última aba usada**), e é
isso que permite que continue funcionando enquanto o navegador embutido está com
o foco do teclado.

### Quando há mais abas do que cabem

A faixa de abas rola. Quando há abas além de uma das bordas, a faixa esmaece
nessa borda e aparece uma pequena seta — clique nela para rolar uma tela. Trocar
de aba por qualquer meio também rola a nova aba para a área visível, então a aba
destacada nunca fica escondida fora da tela.

A própria faixa é acessível pelo teclado: chegue até ela com Tab e use as teclas
de seta.

## Dois documentos lado a lado

**Visualizar → Dividir editor — dois documentos** (`Alt + Mod + \`) coloca um
segundo documento ao lado do atual. Para escolher qual documento, clique com o
botão direito em qualquer aba e escolha **Abrir ao lado**.

| Ação | Atalho |
|---|---|
| Dividir editor — dois documentos | `Alt + Mod + \` |
| Fechar painel | `Alt + Mod + Shift + \` |
| Focar o outro painel | `Alt + Mod + Shift + O` |
| Sincronizar rolagem | *(sem padrão)* |

Como ela se comporta:

- A aba exibida no **outro** painel é marcada na faixa de abas com um sublinhado
  discreto, para que você sempre saiba quais dois documentos estão na tela e em
  qual deles sua digitação vai entrar.
- **Fechar um dos dois recolhe a divisão para o outro**, em vez de levar você a
  uma aba sem relação. O documento restante continua onde está.
- **Sincronizar rolagem** une proporcionalmente a rolagem dos dois painéis. Fica
  desativada por padrão e vale por divisão.
- **Os dois painéis compartilham um único modo de visualização.** O modo código-fonte (`F6`)
  alterna os dois painéis ao mesmo tempo, e mover-se entre os painéis mantém o modo atual.
- Dividir requer dois documentos abertos. Abas do navegador não são documentos,
  então a divisão não se aplica a elas.

## O menu de contexto da aba

Clique com o botão direito em uma aba para abrir seu menu. As teclas de seta, Home e End percorrem o menu; Enter ou Espaço executa um item; Escape o fecha.

| Item | O que faz | Disponível quando |
|---|---|---|
| Mover para nova janela | Move a aba para uma nova janela, com um **Desfazer** na confirmação. Uma janela secundária que fica vazia é fechada. | O documento está carregado e não é a única aba da janela principal |
| Fixar / Desafixar | Fixa ou desafixa a aba — veja [Abas fixadas](#abas-fixadas). | Sempre |
| Abrir ao lado | Mostra a aba no outro painel da divisão — veja [Dois documentos lado a lado](#dois-documentos-lado-a-lado). | Esta aba e a ativa são documentos, e esta não é a aba ativa (não aparece para abas do navegador) |
| Renomear | Renomeia o arquivo diretamente na aba — veja [Renomeando um arquivo](#renomeando-um-arquivo). | O documento já foi salvo |
| Copiar caminho | Copia o caminho absoluto do arquivo. | O documento já foi salvo |
| Copiar caminho relativo | Copia o caminho relativo à pasta do workspace. | Há um workspace aberto e o arquivo está dentro dele |
| Mostrar no Finder | Mostra o arquivo no Finder (**Mostrar no Explorador** no Windows, **Mostrar no gerenciador de arquivos** no Linux). | O documento já foi salvo |
| Restaurar no disco | Grava o conteúdo da aba de volta no seu caminho. | O arquivo foi excluído do disco enquanto estava aberto |
| Reverter para a versão salva | Após uma confirmação, descarta suas alterações e recarrega o arquivo do disco. | A aba tem alterações não salvas e seu arquivo ainda existe |
| Fechar | Fecha a aba (pergunta se deseja salvar antes, se houver alterações não salvas). | A aba não está fixada |
| Fechar outras | Fecha todas as outras abas não fixadas. | Existe outra aba não fixada |
| Fechar guias à direita | Fecha as abas não fixadas à sua direita. | Existe alguma |
| Fechar guias não fixadas | Fecha todas as abas não fixadas, inclusive esta. | Existe uma aba não fixada |
| Fechar todas | Fecha todas as abas, inclusive as fixadas. Se alguma aba fixada for ser fechada, primeiro pede confirmação e informa quantas são; cancelar não fecha nada. | Sempre |

Os fechamentos em massa atuam sobre as abas do workspace atual e as fecham uma de cada vez. Cada aba com alterações não salvas pergunta antes, e cancelar qualquer uma dessas perguntas interrompe o restante.

## Abas fixadas

Fixe uma aba pelo menu de contexto para mantê-la à mão:

- Ela vai para o grupo de abas fixadas à esquerda da faixa, mostra um ícone de alfinete e perde o botão de fechar. Abas não podem ser arrastadas pela fronteira entre abas fixadas e não fixadas (*"As abas fixadas permanecem à esquerda. Soltura bloqueada."*), e uma aba fixada não pode ser arrastada para fora da sua janela.
- Ela não pode ser fechada por nenhum meio — `Mod + W`, clique do meio, **Fechar** ou um fechamento em massa — até que você a desafixe; tentar mostra *"Desafixe antes de fechar"*. Dois fechamentos deliberados são a exceção: **Fechar todas** também fecha as abas fixadas depois que você confirma, e fechar um espaço de trabalho pela barra fecha as abas fixadas dele junto com as demais.
- Fechar uma janela que contém abas fixadas pede confirmação — *"Esta janela tem N abas fixadas. Fechar mesmo assim?"* — a menos que uma caixa de diálogo de salvamento já tenha sido exibida.
- A fixação sobrevive a mover a aba para outra janela ou workspace e a uma reinicialização de atualização, mas não a sair do VMark: as abas reabertas na próxima inicialização ficam desafixadas.

Não há atalho de teclado para fixar.

## Renomeando um arquivo

Escolha **Renomear** no menu de contexto de uma aba. O nome fica editável na aba, com a parte antes da extensão selecionada. Enter ou clicar fora confirma; Escape cancela. O arquivo é renomeado no disco e todas as abas abertas que apontam para ele acompanham. O VMark nunca sobrescreve: se o nome já estiver em uso, uma caixa de diálogo diz *Já existe um arquivo chamado "X".* Um nome vazio, inalterado, `.` ou `..`, ou que contenha `/` ou `\` é recusado ou ignorado. O que você digita é o nome inteiro — apague a extensão e o arquivo fica sem ela.

No **macOS**, com **Configurações → Aparência → Mostrar nome do arquivo na barra de título** ativado, você também pode dar um clique duplo no nome do arquivo na barra de título para renomeá-lo. As mesmas regras e mensagens se aplicam; depois de uma colisão ou de um erro o nome continua editável para você tentar outro. Se **Mostrar extensões de arquivo** estiver desativado, a extensão original é mantida quando você digita um nome sem extensão. Um clique duplo no título de um documento não salvo abre **Salvar** em vez disso.

## Fechando abas e janelas

Nada com alterações não salvas é fechado sem perguntar.

- **Fechar uma aba** com alterações não salvas (`Mod + W`, o × da aba ou **Fechar**) pergunta *"Deseja salvar as alterações em …?"* com **Salvar**, **Não salvar** e **Cancelar**. **Salvar** em um documento nunca salvo abre uma caixa de diálogo de salvamento na sua pasta padrão de salvamento, com o título da aba como nome sugerido. Cancelar essa caixa de diálogo, ou uma falha ao salvar, mantém a aba aberta.
- **Fechar uma janela** com um documento não salvo faz a mesma pergunta. Com dois ou mais, uma única caixa de diálogo lista todos — documentos nunca salvos são marcados como *(novo)* — com **Salvar tudo**, **Não salvar** e **Cancelar**.
- **Salvar tudo** salva todos os documentos que têm um arquivo. Para documentos nunca salvos, pede um local: uma caixa de diálogo de salvamento se houver um, ou **um seletor de pasta** para vários (*"Escolher pasta para N novos documentos"*). Cada um é então salvo nessa pasta com o seu título, e um nome que já esteja em uso recebe um número (`Untitled 2.md`), então nada é sobrescrito.
- **Sair** (`Mod + Q`) executa a mesma verificação em todas as janelas, uma janela por vez; cancelar em qualquer janela cancela a saída. Com **Configurações → Arquivos e imagens → Confirmar ao sair** ativado (o padrão), o primeiro toque apenas mostra *"Pressione ⌘Q novamente para sair"* — pressione de novo em até dois segundos. Uma saída vinda do sistema operacional (um desligamento, por exemplo) dispensa o toque duplo.
- **Salvar tudo e sair** salva os documentos não salvos de todas as janelas sem a caixa de diálogo — ainda perguntando onde colocar os nunca salvos (uma caixa de salvar, ou um seletor de pasta para vários, na janela que os contém) — e então sai. Se um documento não puder ser salvo, ou se você cancelar essa caixa de diálogo, a saída é interrompida: essa janela continua aberta e um salvamento que falhou informa o motivo.

No macOS, o VMark continua em execução depois que sua última janela é fechada; no Windows e no Linux, fechar a última janela sai do aplicativo — a menos que, no Windows, **Configurações → Arquivos e imagens → Minimizar para a bandeja ao fechar** esteja ativado: nesse caso, a última janela é ocultada na bandeja do sistema, sem fechar nada e sem pedir para salvar (veja [Configurações](/pt-BR/guide/settings)).
