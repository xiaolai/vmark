# Recursos

O VMark é o espaço de trabalho em texto simples onde humanos e IA colaboram. O Markdown é a peça central (com os modos WYSIWYG, Peek de Fonte e Fonte), mas o espaço de trabalho também abre YAML, JSON, TOML, Mermaid, SVG, HTML e 9 formatos de visualizador de código — veja [Formatos Suportados](/pt-BR/guide/formats) para a lista completa.

[[toc]]

## Modos de Edição

### Modo de Texto Rico (WYSIWYG)

O modo de edição padrão oferece uma experiência verdadeira de "o que você vê é o que você obtém":

- Visualização de formatação ao vivo enquanto você digita
- Revelação de sintaxe inline ao passar o cursor
- Barra de ferramentas intuitiva e menus de contexto
- Entrada de sintaxe markdown sem interrupções

### Modo Fonte

Alterne para edição em Markdown bruto com realce de sintaxe completo:

- Editor baseado no CodeMirror 6
- Realce de sintaxe completo
- Popups interativos para matemática, links, imagens, links wiki e mídia — mesma experiência de edição do WYSIWYG
- Colagem inteligente — HTML de páginas web e documentos Word é convertido automaticamente em Markdown limpo
- Colagem de imagens da área de transferência — capturas de tela e imagens copiadas são salvas na pasta de ativos e inseridas como `![](caminho)`
- Múltiplos cursores com reconhecimento de blocos de código e suporte a limites de palavras CJK
- Perfeito para usuários avançados

Alterne entre os modos com `F6`.

### Visualização Dividida (Fonte + Prévia)

Edite a fonte Markdown bruta à esquerda enquanto uma **prévia WYSIWYG ao vivo,
somente leitura**, é atualizada à direita — a prévia *é* o renderizador WYSIWYG,
então ela nunca diverge do que você veria no Modo de Texto Rico. Os comandos de
formatação e a barra de ferramentas atuam no painel de fonte; arraste o divisor
(ou use as setas sobre ele) para redimensionar.

- Alterne por sessão com `Shift + F6`, **Visualizar → Visualização dividida do Markdown**
  ou pela paleta de comandos ("Alternar visualização dividida do Markdown")
- Torne-a o padrão para arquivos Markdown em **Configurações → Markdown → Layout →
  Dividir fonte/visualização por padrão**

O WYSIWYG continua sendo o padrão; a divisão é opcional. As três visualizações são
mutuamente exclusivas — `F6` alterna o modo Fonte e `Shift + F6` alterna a divisão,
cada um voltando ao WYSIWYG — então alternar entre elas é sempre um único atalho.

O menu **Visualizar** mostra os três modos — **Modo WYSIWYG**, **Modo de código-fonte**,
**Visualização dividida do Markdown** — como um grupo com marca de seleção, para que o
modo ativo esteja sempre visível e a exclusividade mútua fique explícita. **Quebra de
linha** e **Números de linha** se aplicam apenas ao editor de fonte, por isso ficam
esmaecidos enquanto você está no modo WYSIWYG.

### Posição de Leitura

Seu lugar em um documento sobrevive quando você o deixa. Alternar para outra aba e
voltar, alternar o modo Fonte ou a Visualização Dividida, ou ter o arquivo recarregado
do disco — tudo isso devolve você ao ponto onde estava lendo, e não ao topo.

Cada superfície lembra sua própria posição, então o Texto Rico e a Fonte mantêm lugares
separados no mesmo arquivo. Voltar à mesma superfície — ao trocar de aba ou quando o arquivo é
recarregado — leva você de volta ao ponto até onde tinha rolado, mesmo que o cursor esteja em
outro lugar; o cursor fica onde você o deixou. Ao alternar entre Texto Rico e Fonte, por outro
lado, a visualização segue o cursor, se houver um, porque é ele que mantém o mesmo parágrafo à
vista nas duas.

As posições são por documento e por sessão — fechar uma aba as esquece.

### Desfazer Entre Modos

Desfazer e refazer atravessam a fronteira WYSIWYG ⇄ Fonte. Cada troca de modo registra um ponto de verificação e, quando o histórico do próprio editor atual se esgota, `Mod + Z` continua por esses pontos — restaurando o conteúdo anterior sem trocar a visualização em que você está. Refazer percorre a mesma cadeia para frente; um refazer cujo ramo você abandonou ao fazer uma nova edição é recusado, em vez de ser aplicado por cima do seu trabalho. A cadeia é mantida por aba e apagada quando a aba é fechada.

### Arquivos Grandes

O VMark abre automaticamente arquivos grandes no modo Fonte para uma abertura em menos de um segundo — arquivos acima de 1 MB ou markdown com muitos blocos e 1.200+ blocos estimados —, avisa antes de mexer em arquivos acima de 5 MB e recusa arquivos acima de 50 MB. Veja o guia de [Arquivos Grandes](./large-files.md) para os limites e as configurações.

### Peek de Fonte

Edite o Markdown bruto de um único bloco sem sair do modo WYSIWYG. Pressione `F5` para abrir o Peek de Fonte para o bloco na posição do cursor.

**Layout:**
- Barra de cabeçalho com rótulo do tipo de bloco e botões de ação
- Editor CodeMirror mostrando a fonte Markdown do bloco
- Bloco original exibido como visualização esmaecida (quando a visualização ao vivo está ATIVADA)

**Controles:**
| Ação | Atalho |
|------|--------|
| Salvar alterações | `Cmd/Ctrl + Enter` |
| Cancelar (reverter) | `Escape` |
| Alternar visualização ao vivo | Clique no ícone de olho |

**Visualização ao Vivo:**
- **DESATIVADA (padrão):** Edite livremente, alterações aplicadas somente ao salvar
- **ATIVADA:** Alterações aplicadas imediatamente enquanto você digita, visualização exibida abaixo

**Blocos excluídos:**
Alguns blocos possuem seus próprios mecanismos de edição e ignoram o Peek de Fonte:
- Blocos de código (incluindo Mermaid, LaTeX) — use duplo clique para editar
- Imagens em bloco — use o popup de imagem
- Frontmatter, blocos HTML, linhas horizontais

O Peek de Fonte é útil para edição precisa de Markdown (corrigindo sintaxe de tabela, ajustando indentação de lista) enquanto permanece no editor visual.

## Edição com Múltiplos Cursores

Edite vários locais simultaneamente — o VMark suporta múltiplos cursores completos nos modos WYSIWYG e Fonte.

| Ação | Atalho |
|------|--------|
| Adicionar cursor na próxima correspondência | `Mod + D` |
| Pular correspondência, ir para a próxima | `Mod + Shift + D` |
| Selecionar todas as ocorrências | `Mod + Shift + L` |
| Adicionar cursor acima/abaixo | `Mod + Alt + Cima/Baixo` |
| Adicionar cursor ao clicar | `Alt + Clique` |
| Desfazer último cursor | `Alt + Mod + Z` |
| Colapsar para cursor único | `Escape` |

Toda a edição padrão (digitação, exclusão, área de transferência, navegação) funciona em cada cursor independentemente. Na prosa, `Mod + D` e `Mod + Shift + L` pesquisam o documento inteiro; dentro de um bloco de código, ficam restritos a esse bloco. `Alt + Mod + Shift + L` seleciona todas as correspondências apenas no bloco atual.

[Saiba mais →](/pt-BR/guide/multi-cursor)

## Selecionar Tudo Inteligente

No modo WYSIWYG, `Mod + A` expande a seleção um contêiner por vez em vez de saltar direto para o documento inteiro: dentro de uma tabela, seleciona a célula, depois a linha, depois a tabela e, por fim, o documento. `Mod + Z` desfaz uma expansão e `Escape` reduz a seleção a um cursor.

No modo Fonte, `Mod + A` primeiro seleciona o bloco que envolve o cursor — um bloco de código delimitado, uma tabela, uma citação ou uma lista — e depois o documento inteiro; ali também `Mod + Z` desfaz uma expansão.

Esse atalho pertence ao editor e não é personalizável.

## Auto-Par e Escape de Tab

Quando você digita um parêntese de abertura, aspas ou acento grave, o VMark insere automaticamente o par de fechamento. Pressione **Tab** para pular o caractere de fechamento em vez de usar a tecla de seta.

- Parênteses: `()` `[]` `{}`
- Aspas: `""` `''` `` ` ` ``
- CJK: `「」` `『』` `（）` `【】` `《》` `〈〉`
- Aspas curvas: `""` `''`
- Marcas de formatação em WYSIWYG: **negrito**, *itálico*, `código`, ~~tachado~~, links

Backspace exclui ambos os caracteres quando o par está vazio. Auto-par e pulo de parêntese com Tab estão **desabilitados dentro de blocos de código e código inline** — parênteses no código permanecem literais. Configurável em **Configurações → Editor**.

[Saiba mais →](/pt-BR/guide/tab-navigation)

## Formatação de Texto

### Estilos Básicos

- **Negrito**, *Itálico*, <u>Sublinhado</u>, ~~Tachado~~
- `Código inline`, ==Destaque==
- Subscrito e Sobrescrito
- Links, Links Wiki e Links de Favorito com popups de visualização
- Notas de rodapé com edição inline
- Alternância de comentário HTML (`Mod + /`)
- Comando de limpar formatação

### Transformações de Texto

Altere rapidamente o caso do texto via Formatar → Transformar:

| Transformação | Atalho |
|---------------|--------|
| MAIÚSCULAS | `Ctrl + Shift + U` (macOS) / `Alt + Shift + U` (Win/Linux) |
| minúsculas | `Ctrl + Shift + L` (macOS) / `Alt + Shift + L` (Win/Linux) |
| Capitalização de Título | `Ctrl + Shift + T` (macOS) / `Alt + Shift + T` (Win/Linux) |
| Alternar Caso | — |

### Elementos de Bloco

- Títulos 1-6 com atalhos fáceis (aumentar/diminuir nível com `Mod + Alt + ]`/`[`)
- Citações (aninhamento suportado)
- Blocos de código com realce de sintaxe
- Listas ordenadas, não ordenadas e de tarefas
- Ciclar tipo de lista: converte um parágrafo em lista com marcadores, numerada ou de tarefas em sequência
- Desativar uma lista: clicar de novo no tipo de lista ativo remove a formatação de lista
- Converter em código: a ação Bloco de código transforma a lista inteira no cursor — ou qualquer seleção de vários blocos (parágrafos, títulos, listas) — em um único bloco de código, uma linha por bloco ou item de lista
- Linhas horizontais
- Tabelas com suporte completo de edição

### Quebras de Linha Duras

Pressione `Shift + Enter` para inserir uma quebra de linha dura dentro de um parágrafo.
O VMark usa o estilo de dois espaços por padrão para máxima compatibilidade.
Configure em **Configurações > Editor > Espaços em Branco**.

### Operações de Linha

Manipulação poderosa de linhas via Editar → Linhas:

| Ação | Atalho |
|------|--------|
| Mover Linha Acima | `Alt + Cima` |
| Mover Linha Abaixo | `Alt + Baixo` |
| Duplicar Linha | `Shift + Alt + Baixo` |
| Excluir Linha | `Mod + Shift + K` |
| Unir Linhas | `Mod + J` |
| Remover Linhas em Branco | — |
| Ordenar Linhas Crescente | `F4` _(somente no modo Fonte)_ |
| Ordenar Linhas Decrescente | `Shift + F4` _(somente no modo Fonte)_ |

A ordenação trabalha com linhas de texto simples, por isso está disponível apenas no modo Fonte.

## Tabelas

Edição completa de tabelas:

- Inserir tabelas via menu ou atalho
- Adicionar/excluir linhas e colunas
- Alinhamento de células (esquerda, centro, direita)
- As colunas se ajustam automaticamente ao conteúdo; tabelas largas rolam horizontalmente
- Ajustar à largura — fixa uma tabela na largura do editor com colunas proporcionais ao conteúdo (Configurações → Markdown, ou por tabela pelo clique com o botão direito)
- Barra de ferramentas contextual para ações rápidas
- Navegação por teclado — `Tab` / `Shift + Tab` movem entre as células, as setas saem da tabela nas bordas e `Mod + Enter` / `Mod + Shift + Enter` adicionam uma linha abaixo / acima

## Imagens

Suporte abrangente a imagens:

- Inserir via diálogo de arquivo
- Arrastar e soltar do sistema de arquivos
- Colar da área de transferência
- Copiar automaticamente para a pasta de ativos do projeto
- Duplo clique para editar o caminho da fonte e o texto alternativo — as dimensões da imagem são exibidas somente para leitura
- Clique com o botão direito para Alterar imagem, Excluir imagem, Copiar caminho e Mostrar no Finder (Mostrar no Explorador no Windows, Mostrar no gerenciador de arquivos no Linux)
- Alternar entre exibição inline e em bloco

## Vídeo e Áudio

Suporte completo de mídia com tags HTML5:

- Inserir vídeo e áudio via seletor de arquivo na barra de ferramentas
- Arrastar e soltar arquivos de mídia no editor
- Copiar automaticamente para a pasta `.assets/` do projeto
- Clicar para editar caminho da fonte, título e pôster (vídeo)
- Suporte a incorporação do YouTube com iframes de privacidade aprimorada
- Fallback de sintaxe de imagem: `![](arquivo.mp4)` promovido automaticamente a vídeo
- Decoração no modo fonte com bordas coloridas específicas por tipo
- [Saiba mais →](/pt-BR/guide/media-support)

## Painel de Frontmatter

Edite o frontmatter YAML diretamente no modo WYSIWYG sem alternar para o modo Fonte.

- **Recolhido por padrão** — um pequeno rótulo "Frontmatter" aparece no topo do documento quando há frontmatter presente
- **Clique para expandir** — abre um editor de texto simples para o conteúdo YAML
- **`Mod + Enter`** — salvar alterações e recolher o painel
- **`Escape`** — reverter para o último valor salvo e recolher
- **Salvamento automático ao perder o foco** — se você clicar fora, as alterações são salvas automaticamente após um breve atraso

O painel cria um ponto de desfazer no histórico do editor, então você sempre pode usar `Mod + Z` para reverter alterações no frontmatter.

## Conteúdo Especial

### Caixas de Informação

Alertas no estilo Markdown do GitHub:

- NOTE — Informações gerais
- TIP — Sugestões úteis
- IMPORTANT — Informações importantes
- WARNING — Problemas potenciais
- CAUTION — Ações perigosas

### Seções Recolhíveis

Crie blocos de conteúdo expansíveis usando o elemento HTML `<details>`.

### Equações Matemáticas

Renderização LaTeX baseada no KaTeX:

- Matemática inline: `$E = mc^2$`
- Matemática em bloco: `$$...$$`
- Delimitadores no estilo do ChatGPT são reconhecidos ao abrir/colar e normalizados
  para a forma com `$`: `\( ... \)` vira matemática inline, e um `\[ ... \]`
  isolado vira um bloco
- Um bloco `$$` precisa ser fechado antes de uma linha em branco (a regra do pandoc) — um
  `$$` não fechado é renderizado como texto literal em vez de engolir os parágrafos seguintes.
  Linhas em branco logo antes do fechamento não são problema (um bloco
  `$$` … `$$` vazio continua sendo um bloco matemático)
- Suporte completo à sintaxe LaTeX
- Mensagens de erro úteis com dicas de sintaxe

### Diagramas

Suporte a diagramas Mermaid com visualização ao vivo:

- Fluxogramas, diagramas de sequência, gráficos de Gantt
- Diagramas de classe, diagramas de estado, diagramas ER
- Painel de visualização ao vivo no modo Fonte (arrastar, redimensionar, zoom)
- [Saiba mais →](/pt-BR/guide/mermaid)

Suporte a Graphviz DOT com as mesmas superfícies de visualização:

- Blocos delimitados ` ```dot ` e ` ```graphviz ` renderizam localmente (WASM)
- Pan, zoom e exportação PNG como nos diagramas Mermaid
- [Saiba mais →](/pt-BR/guide/graphviz)

### Gráficos SVG

Renderize SVG bruto inline via blocos de código ` ```svg `:

- Renderização instantânea com pan, zoom e exportação PNG
- Visualização ao vivo nos modos WYSIWYG e Fonte
- Ideal para gráficos gerados por IA e ilustrações personalizadas
- [Saiba mais →](/pt-BR/guide/svg)

### Sumário Inline

Digite `[TOC]` sozinho em uma linha, ou escolha **Inserir → Sumário**, para inserir um sumário dinâmico (o item de menu não tem atalho padrão; atribua um em Configurações → Atalhos):

- Gerado automaticamente a partir dos títulos do documento, com o aninhamento correto
- Clique em qualquer título para rolar diretamente até ele
- Atualiza em tempo real enquanto você edita
- Renderiza no WYSIWYG e na exportação (HTML/PDF), e o modo Fonte preserva o conteúdo sem perdas

## Gênios de IA

Assistência de escrita com IA integrada com base no seu provedor escolhido:

- 13 gênios em quatro categorias — edição, criativo, estrutura e ferramentas
- Seletor no estilo Spotlight com pesquisa e prompts livres (`Mod + Y`)
- Renderização de sugestão inline — aceitar ou rejeitar com atalhos de teclado
- Suporta provedores CLI (Claude, Codex, Gemini) e APIs REST (Anthropic, OpenAI, Google AI, Ollama)

[Saiba mais →](/pt-BR/guide/ai-genies) | [Configurar provedores →](/pt-BR/guide/ai-providers)

## Pesquisar e Substituir

Abra a barra de pesquisa com `Mod + F`. Ela abre na barra da parte inferior da janela e funciona nos modos WYSIWYG e Fonte.

**Navegação:**

| Ação | Atalho |
|------|--------|
| Encontrar próxima correspondência | `Enter` ou `Mod + G` |
| Encontrar correspondência anterior | `Shift + Enter` ou `Mod + Shift + G` |
| Usar seleção para pesquisa | `Mod + E` |
| Fechar barra de pesquisa | `Escape` |

**Opções de pesquisa** — alternar via botões na barra de pesquisa:

- **Diferenciar maiúsculas/minúsculas** — corresponder ao caso exato das letras
- **Palavra inteira** — corresponder apenas a palavras completas, não substrings
- **Expressão regular** — usar padrões regex (habilitar nas Configurações primeiro)

**Substituir:**

O campo de substituição fica ao lado do campo de pesquisa — ambos estão sempre visíveis, e `Tab` passa de um para o outro. Digite o texto de substituição, então use **Substituir** (única correspondência) ou **Substituir Tudo** (todas as correspondências de uma vez). O contador de correspondências exibe a posição atual e o total (por exemplo, "3 de 12") para que você sempre saiba onde está.

## Lint de Markdown

O VMark inclui um linter de Markdown integrado que verifica seu documento em busca de erros de sintaxe comuns e problemas de acessibilidade. Habilite em **Configurações > Markdown > Lint**.

**Como usar:**

| Ação | Atalho |
|------|--------|
| Executar verificação lint | `Alt + Mod + V` |
| Ir para o próximo problema | `F2` |
| Ir para o problema anterior | `Shift + F2` |

Ao executar uma verificação lint, diagnósticos aparecem como destaques inline e marcadores na margem. Se nenhum problema for encontrado, uma notificação confirma que o documento está limpo. Problemas são classificados como erros ou avisos.

**Regras verificadas (13 no total):**

- Links de referência não definidos
- Contagem de colunas de tabela não correspondente
- Sintaxe de link invertida `(texto)[url]` em vez de `[texto](url)`
- Espaço faltando após `#` em títulos
- Espaços dentro de marcadores de ênfase
- Texto de link vazio ou URLs de link vazias
- Definições de link/imagem duplicadas
- Definições de link/imagem não utilizadas
- Incrementos de nível de título que pulam níveis (ex.: H1 para H3)
- Imagens sem texto alternativo (acessibilidade)
- Blocos de código delimitados não fechados
- Links de fragmento quebrados (`#ancora` que não corresponde a nenhum título)

Os resultados do lint não são atualizados enquanto você digita. No modo Fonte, uma edição os limpa. No modo WYSIWYG, uma edição remove os destaques, mas a contagem de problemas na barra de status e os alvos de `F2` / `Shift + F2` permanecem da última execução até você executar a verificação novamente ou fechar a aba. Execute a verificação novamente a qualquer momento com `Alt + Mod + V`.

## Barra de Ferramentas Universal

Uma barra de ferramentas de formatação ancorada na parte inferior do editor, fornecendo acesso rápido a todas as ações de formatação nos modos WYSIWYG e Fonte.

- **Alternar:** `Mod + Shift + B` abre a barra de ferramentas e dá foco a ela. Pressione novamente para retornar o foco ao editor mantendo a barra visível.
- **Navegação por teclado:** Use as setas `Esquerda`/`Direita` para mover entre grupos. `Enter` ou `Espaço` abre um menu suspenso. As setas navegam dentro dos menus.
- **Escape em dois passos:** Se um menu suspenso estiver aberto, `Escape` fecha primeiro o menu. Pressione `Escape` novamente para fechar toda a barra de ferramentas.
- **Memória de sessão:** A barra de ferramentas lembra qual botão estava focado por último durante a sessão atual, então ao re-focar continua de onde parou.
- **Atalho dos Gênios de IA:** A barra de ferramentas inclui um botão de Gênios de IA que abre o seletor de gênios (`Mod + Y`).

## Menu de Contexto do Editor

Clique com o botão direito em qualquer lugar do editor (modo WYSIWYG ou Fonte) para abrir um menu de contexto com ações comuns.

- **Área de transferência:** Recortar, Copiar, Colar e Selecionar tudo. No macOS, eles usam o pipeline nativo da área de transferência, então colar conteúdo rico (por exemplo, HTML copiado de um navegador) mantém a formatação — idêntico a `Mod + V`.
- **Formatação inline:** Negrito, Itálico, Tachado e Código inline, com marcas de seleção mostrando as marcas ativas no cursor.
- **Operações de bloco:** submenus de nível de Título e de tipo de Lista, Citação em bloco e Bloco de código — as marcas de seleção refletem o bloco atual.
- **Links:** Inserir link em texto simples; sobre um link existente, a seção passa a mostrar Editar link, Copiar link e Remover link.
- **Sensível ao contexto:** dentro de tabelas, aparece o menu dedicado de tabela; clicar com o botão direito em uma imagem abre o menu de imagem; dentro de blocos de código, apenas as ações da área de transferência são oferecidas. Arquivos que não são Markdown (JSON, YAML, …) recebem um menu reduzido, só com a área de transferência.
- **Tratamento da seleção:** clicar com o botão direito dentro de uma seleção a mantém; clicar em outro lugar move primeiro o cursor para lá (convenção do macOS).
- **Teclado:** as setas navegam (itens desabilitados são pulados), `Direita`/`Esquerda` entram e saem dos submenus, `Escape` fecha primeiro o submenu e depois o menu. As dicas de atalho refletem suas combinações de teclas personalizadas.

## Paleta de Comandos

Pressione `Mod + Shift + P` para abrir a paleta de comandos. Com a consulta vazia, ela lista todos os comandos disponíveis agrupados por categoria — arquivo, área de trabalho, visualização, exportação, formatação, títulos, listas, tabelas, linhas, seleção, transformação, CJK, lint, histórico, IA e mais; digite para filtrar e classificar por correspondência. `↑`/`↓` movem, `Enter` executa o comando, `Escape` (ou um clique no fundo) fecha. Só aparecem os comandos que se aplicam no momento — um comando de editor desaparece quando não há documento aberto, um comando de área de trabalho quando não há área de trabalho — e o comando é executado na janela em que você abriu a paleta. As páginas deste guia citam os comandos da paleta entre aspas ("Alternar visualização dividida do Markdown", "Detalhamento de coerência", "Status das janelas"). A paleta não tem item de menu; seu atalho é personalizável em **Configurações → Atalhos**.

## Opções de Exportação

O VMark oferece opções flexíveis de exportação para compartilhar seus documentos.

### Exportação HTML

**Arquivo → Exportar → HTML...** grava uma pasta com `index.html` (com uma pasta `assets/` vinculada) e `standalone.html` (tudo incorporado) — não há modo para escolher; use o arquivo que for mais conveniente.

O HTML exportado inclui o [**VMark Reader**](/pt-BR/guide/export#vmark-reader) — controles interativos para configurações, sumário, lightbox de imagens e mais.

[Saiba mais sobre exportação →](/pt-BR/guide/export)

### Exportação PDF

**Arquivo → Exportar → PDF...** abre o diálogo de exportação próprio do VMark — tamanho da página (A4, Carta, A3, Ofício) e orientação, predefinições de margem ou uma caixa de margem personalizada arrastável, tamanho da fonte, altura de linha, fontes latinas e CJK, predefinições de estilo e números de página — e então grava o PDF no macOS, Windows e Linux, com um sumário de títulos clicável na barra lateral do visualizador. **Imprimir** (`Cmd/Ctrl + P`) é o caminho separado pelo diálogo de impressão do sistema. [Saiba mais →](/pt-BR/guide/export#imprimir-exportar-pdf)

### Copiar como HTML

Copiar conteúdo formatado para colar em outros aplicativos (`Cmd/Ctrl + Shift + C`).

### Formato de Cópia

Por padrão, copiar do WYSIWYG coloca texto simples (sem formatação) na área de transferência. Habilite o formato de cópia **Markdown** em **Configurações > Editor > Comportamento** para colocar sintaxe Markdown em `text/plain` em vez disso — títulos mantêm seus `#`, links mantêm seus URLs, etc. Útil ao colar em terminais, editores de código ou aplicativos de chat.

## Formatação CJK

Ferramentas de formatação de texto em Chinês/Japonês/Coreano integradas:

- Mais de 20 regras de formatação configuráveis
- Espaçamento CJK-Inglês
- Conversão de caracteres de largura total
- Normalização de pontuação
- Emparelhamento inteligente de aspas com detecção de apóstrofo/prime
- Proteção de construtos técnicos (URLs, versões, horários, decimais)
- Conversão contextual de aspas (curvas para CJK, retas para Latin)
- Alternar estilo de aspas no cursor (`Shift + Mod + '`)
- [Saiba mais →](/pt-BR/guide/cjk-formatting)

## Histórico de Documentos

O VMark salva automaticamente snapshots dos seus documentos para que você possa recuperar versões anteriores.

- **Salvamento automático** com intervalo configurável captura snapshots em segundo plano
- **Histórico por documento** armazenado localmente na pasta de dados do aplicativo do VMark — um arquivo de índice mais um arquivo Markdown por snapshot
- Abra a barra lateral de Histórico com `Ctrl + Shift + 3` para navegar por versões anteriores
- Os snapshots são **agrupados por dia** com carimbos de data/hora mostrando o momento exato de cada versão salva
- **Restaure** uma versão anterior clicando no botão de restaurar ao lado de qualquer snapshot (um diálogo de confirmação previne reversões acidentais)
- **Exclua** snapshots individuais que você não precisa mais com o botão de lixeira
- O conteúdo atual é salvo como novo snapshot antes de qualquer reversão, então você nunca perde seu trabalho
- O histórico requer que o documento esteja salvo em um arquivo (documentos sem título não têm histórico)
- Ative ou desative o rastreamento de histórico em **Configurações > Geral**

## Recuperação de Sessão (Hot Exit)

Quando o VMark reinicia para instalar uma atualização, ou fecha inesperadamente, seu trabalho é preservado e restaurado no próximo lançamento.

**O que uma reinicialização para atualização salva:**
- Todas as abas abertas e seu conteúdo (incluindo alterações não salvas)
- Posições do cursor e histórico de desfazer/refazer
- Layout da interface: estado da barra lateral, visibilidade do esquema, modo fonte/foco/máquina de escrever, estado do terminal
- Posição e tamanho da janela
- Área de trabalho ativa e configurações do explorador de arquivos

**Como funciona:**
- Quando você escolhe reiniciar e instalar uma atualização, o VMark primeiro captura o estado completo da sessão de todas as janelas
- Ao relançar, as abas são restauradas exatamente como você as deixou, com documentos modificados (não salvos) marcados adequadamente
- As alterações não salvas também são gravadas em snapshots de recuperação a cada 10 segundos. Após uma saída inesperada, o VMark as restaura no próximo lançamento como abas não salvas
- Snapshots de recuperação com mais de 7 dias são limpos automaticamente
- Um encerramento comum não captura a sessão: o VMark pede que você salve primeiro os documentos não salvos (veja [Fechando abas e janelas](/pt-BR/guide/tab-navigation#fechando-abas-e-janelas)). As abas abertas de uma área de trabalho ainda voltam na próxima vez que você a abrir (veja [Restauração de Sessão](/pt-BR/guide/workspace-management#restauracao-de-sessao))

Nenhuma configuração necessária. A recuperação de sessão está sempre ativa.

## Barra de Status

A barra de status fica ao longo da parte inferior da janela (`F7` a oculta). O lado esquerdo contém a faixa de abas — veja [Alternando entre abas abertas](/pt-BR/guide/tab-navigation#alternando-entre-abas-abertas) — e avisos curtos como *"Aberto no modo Fonte (arquivo grande)."* O lado direito, da esquerda para a direita:

| Indicador | O que mostra | Clique |
|---|---|---|
| Salvamento automático | Um ícone de salvar e há quanto tempo o documento foi salvo automaticamente; some depois de alguns segundos | — |
| Contagens | Palavras e caracteres (espaços não contados); com uma seleção, *selecionado / total* | Abre um popover de **Contagem de palavras**: palavras, caracteres, caracteres sem espaços, caracteres CJK, caracteres sem pontuação |
| Lint | ⊗ erros ou ⚠ avisos encontrados pela última execução do [lint](#lint-de-markdown); oculto quando não há nenhum | Vai para o próximo problema |
| IA | Enquanto um gênio é executado, *Pensando...* com os segundos decorridos e um × para cancelar; depois *Concluído*, ou o erro com **Tentar novamente**, que executa de novo a solicitação que falhou, e **Dispensar**; Tentar novamente não aparece quando não há nada a repetir, como sem provedor | — |
| MCP | Um ícone de satélite, colorido quando um cliente de IA está conectado; a palavra *off*, *…* ou *error* quando não está funcionando normalmente. A dica de ferramenta mostra os clientes conectados | Abre **Configurações → Integrações** |
| Receptor MCP | Um aviso, *MCP indisponível nesta janela*, quando o receptor de solicitações desta janela não conseguiu iniciar após todas as tentativas: os clientes de IA não alcançam esta janela, mesmo com o servidor MCP em execução. Reinicie o VMark para tentar novamente | — |
| Histórico do MCP | Um ícone de histórico com o número de versões de IA do documento em foco, em cor de aviso quando suas alterações não estão sendo registradas; o painel mostra quem fez cada versão, com **Restaurar esta versão** e **Restaurar o estado anterior a esta alteração**, além de [Pontos de verificação anteriores](/pt-BR/guide/mcp-setup#pontos-de-verificacao-de-edicao) | Abre o painel |
| Terminal | — | Mostra ou oculta o terminal |
| Modo | O modo atual — Fonte ou WYSIWYG (oculto para arquivos de workflow do GitHub Actions) | Alterna o modo |
| Cadeado | Se o documento está somente leitura | Alterna somente leitura |

O lado direito fica oculto enquanto uma aba de navegador está ativa. Uma barra de status oculta volta sozinha enquanto um gênio de IA informa o progresso ou uma aba de navegador está ativa.

## Detalhes de Edição

Alguns comportamentos que funcionam sem nenhuma configuração:

- **A seleção continua visível quando o editor perde o foco.** Clique no terminal, na barra lateral ou em um popup e o texto selecionado mantém um destaque mais fraco, para que você veja sobre o que um comando ou uma ferramenta de IA vai agir. O modo Fonte mostra cada intervalo de uma seleção com múltiplos cursores.
- **Digitar na borda esquerda de um código inline entra nele.** Com o cursor logo antes de um trecho de código inline no modo WYSIWYG — não importa como você chegou lá — o próximo caractere entra no código em vez de ficar fora dele.
- **Métodos de entrada (IME) são seguros.** Enquanto você compõe com um método de entrada chinês, japonês ou coreano, e por 50 ms depois que a composição termina, os atalhos do editor e as conversões automáticas não disparam, então pressionar Enter para aceitar um candidato não divide também o parágrafo. Desfazer e refazer continuam funcionando. Uma sílaba coreana confirmada com Enter também inicia a nova linha. Restos de romanização na frente do texto confirmado são removidos, e um caractere confirmado em uma célula de tabela vazia permanece como foi digitado. Notificações informativas esperam o fim da composição; erros e avisos aparecem na hora. Uma edição de um cliente de IA via MCP é recusada (o cliente tenta de novo) ou retida até a composição terminar, e uma alteração do arquivo no disco também espera, então nenhuma delas sobrescreve um texto que você ainda está compondo.
- **O movimento reduzido é respeitado.** Quando a configuração de acessibilidade *reduzir movimento* do seu sistema operacional está ativada, o VMark desliga suas animações e transições e rola instantaneamente em vez de suavemente (inclusive no modo máquina de escrever). Não há uma configuração separada no VMark. A configuração *reduzir transparência* do sistema, da mesma forma, desliga o desfoque do fundo.

## Visualização e Foco

### Modo Foco (`F8`)

O Modo Foco esmaece todos os blocos exceto aquele que você está editando atualmente, reduzindo o ruído visual para que você possa se concentrar em um único parágrafo. O bloco ativo é destacado com opacidade total enquanto o conteúdo ao redor desaparece para uma cor suave. Alterne com `F8` — funciona nos modos WYSIWYG e Fonte e persiste até você desativar.

### Modo Máquina de Escrever (`F9`)

O Modo Máquina de Escrever mantém a linha ativa verticalmente centralizada no viewport, para que seus olhos fiquem em posição fixa enquanto o documento rola abaixo de você — como digitar em uma máquina de escrever física. Alterne com `F9`. Funciona em ambos os modos de edição e usa rolagem suave com um pequeno limiar para evitar ajustes instáveis em movimentos menores do cursor.

### Combinando Foco + Máquina de Escrever

O Modo Foco e o Modo Máquina de Escrever podem ser habilitados simultaneamente. Juntos, fornecem um ambiente de escrita totalmente livre de distrações: os blocos ao redor são esmaecidos *e* a linha atual fica centralizada na tela.

### Quebra de Linha (`Alt + Z`)

Alterne a quebra de linha suave com `Alt + Z`. Quando habilitado, linhas longas são quebradas na largura do editor em vez de rolar horizontalmente. A configuração persiste entre sessões.

### Modo Somente Leitura (`F10`)

Bloqueie um documento para evitar edições acidentais. Alterne com `F10`. Quando ativo, toda entrada de teclado e comandos de formatação são bloqueados — você ainda pode rolar, selecionar texto e copiar. Útil para revisar documentos finalizados ou consultar conteúdo enquanto escreve em outra aba.

### Painel de Esquema (`Ctrl + Shift + 1`)

O painel de Esquema exibe a estrutura de títulos do seu documento como uma árvore recolhível na barra lateral. Abra com `Ctrl + Shift + 1`.

- Clique em qualquer título para rolar o editor até aquela seção
- Recolha e expanda grupos de títulos para focar em partes específicas do documento
- O título atualmente ativo é destacado conforme você rola ou digita
- Atualiza em tempo real ao adicionar, remover ou renomear títulos
- Títulos longos quebram em duas linhas e aparecem por completo ao passar o mouse
- Um campo de filtro no topo do painel restringe a árvore aos títulos cujo texto corresponde à sua consulta (sem diferenciar maiúsculas de minúsculas; os ancestrais são mantidos para que o caminho continue visível). Pressione `Esc` para limpar.

### Zoom

Ajuste o tamanho da fonte do editor sem abrir as Configurações:

| Ação | Atalho |
|------|--------|
| Aumentar zoom | `Mod + =` |
| Diminuir zoom | `Mod + -` |
| Redefinir para o padrão | `Mod + 0` |

O zoom altera o tamanho da fonte do editor em incrementos de 2px (faixa: 12px a 32px). Modifica o mesmo valor de tamanho de fonte encontrado em **Configurações > Aparência**, então o zoom por teclado e o controle deslizante das configurações permanecem sempre sincronizados.

## Utilitários de Texto

O VMark inclui utilitários para limpeza e formatação de texto, disponíveis no menu Formatar:

### Limpeza de Texto (Formatar → Limpeza de Texto)

- **Remover Espaços no Fim**: Remover espaços em branco ao final das linhas
- **Recolher Linhas em Branco**: Reduzir múltiplas linhas em branco para uma única

### Formatação CJK (Formatar → CJK)

Ferramentas de formatação de texto em Chinês/Japonês/Coreano integradas. [Saiba mais →](/pt-BR/guide/cjk-formatting)

### Limpeza de Imagens (Formatar → Limpeza de texto → Limpar imagens não utilizadas...)

Encontre e remova imagens órfãs da sua pasta de ativos (também disponível na paleta de comandos). O VMark mostra o que encontrou e pergunta antes de excluir, e as imagens excluídas vão para a lixeira do sistema. Uma imagem que qualquer documento aberto ainda usa — incluindo alterações não salvas em outra janela do VMark — é mantida. Se o VMark não conseguir confirmar que uma imagem não é usada (por exemplo, outra janela não responde a tempo), ele não exclui nada.

## Terminal Integrado

Painel de terminal integrado com múltiplas sessões, copiar/colar, pesquisa, caminhos de arquivo e URLs clicáveis, menu de contexto, sincronização de tema e configurações de fonte configuráveis. Alterne com `` Ctrl + ` ``. [Saiba mais →](/pt-BR/guide/terminal)

## Atualização Automática

O VMark verifica atualizações automaticamente e pode baixar e instalar dentro do aplicativo:

- Verificação automática de atualizações ao iniciar
- Instalação de atualização com um clique
- Visualização das notas de versão antes de atualizar

## Suporte a Área de Trabalho

- Abrir pastas como áreas de trabalho
- Navegação na árvore de arquivos na barra lateral
- Alternância rápida de arquivos
- Rastreamento de arquivos recentes
- Tamanho e posição da janela lembrados entre sessões
- Painel Status das janelas — veja o status ao vivo do Claude Code / IA de cada janela aberta e vá direto para a que precisa de você; fixe-o nesta janela ou em todas as janelas (incluindo as que você abrir depois) para mantê-lo aberto enquanto alterna entre janelas

[Saiba mais →](/pt-BR/guide/workspace-management)

## Coerência, Base de Conhecimento e Slidev

- **Coerência e visão de Detalhamento** — o rastreamento de proveniência, opcional, registra quais documentos cada geração de IA leu, sinaliza documentos derivados quando um documento de origem muda e acrescenta verificações semânticas, afirmações canônicas e contextos. Abra-o em **Janela → Detalhamento de coerência**. [Saiba mais →](/pt-BR/guide/coherence)
- **Base de conhecimento** — serve uma área de trabalho aberta como um site com links cruzados (links wiki, backlinks, grafo de relações, pesquisa de texto completo) em `127.0.0.1`, em um painel (`Ctrl + Shift + 4`) ou no seu navegador, e pré-visualiza e exporta apresentações Slidev. Nenhuma versão de lançamento inclui ainda o runtime do servidor de conteúdo de que ela precisa, por isso o painel, seu item de menu, o comando da paleta e o atalho ficam ocultos, a menos que **Configurações → Avançado → Ferramentas de desenvolvedor** esteja ativado. [Saiba mais →](/pt-BR/guide/knowledge-base)

## Personalização

### Temas

Seis temas de cores integrados:

- Branco (limpo, minimalista)
- Papel (branco quente)
- Menta (toque verde suave)
- Sépia (visual vintage)
- Noturno (modo escuro)
- Solarized (escuro, paleta Solarized)

### Fontes

Configure fontes separadas para:

- Texto Latin
- Texto CJK (Chinês/Japonês/Coreano)
- Monoespaçado (código)

Cada seletor oferece uma lista curta de fontes recomendadas, as fontes instaladas no seu computador e uma entrada **Personalizada…** onde você digita o nome de qualquer família de fontes. [Detalhes →](/pt-BR/guide/settings#tipografia)

A fonte monoespaçada é verificada antes de ser usada, no modo Fonte, no código e no terminal: se a fonte escolhida não estiver instalada, ou se revelar não monoespaçada, o VMark recorre à próxima da pilha que seja. Isso importa principalmente no Linux com um idioma CJK, onde um nome de fonte ausente poderia, de outra forma, resolver para uma fonte CJK proporcional e quebrar a grade do terminal.

### Layout

Ajuste:

- Tamanho da fonte
- Altura de linha
- Espaçamento de bloco (lacuna entre parágrafos e blocos)
- Espaçamento de letras CJK (espaçamento sutil para legibilidade CJK)
- Largura do editor
- Tamanho da fonte de elementos de bloco (listas, citações, tabelas, alertas)
- Alinhamento de títulos (esquerda ou centro)
- Alinhamento de imagem e tabela (esquerda ou centro)

### Atalhos de Teclado

Todos os atalhos são personalizáveis em Configurações → Atalhos.

## Detalhes Técnicos

O VMark é construído com tecnologia moderna:

| Componente | Tecnologia |
|-----------|------------|
| Framework Desktop | Tauri v2 (Rust) |
| Frontend | React 19, TypeScript |
| Gerenciamento de Estado | Zustand v5 |
| Editor de Texto Rico | Tiptap (ProseMirror) |
| Editor de Fonte | CodeMirror 6 |
| Estilização | Tailwind CSS v4 |

Todo o processamento acontece localmente na sua máquina — sem serviços em nuvem, sem contas necessárias.
