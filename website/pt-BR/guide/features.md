# Recursos

O VMark é um editor Markdown repleto de recursos projetado para fluxos de trabalho de escrita modernos. Veja o que está incluído.

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

Toda a edição padrão (digitação, exclusão, área de transferência, navegação) funciona em cada cursor independentemente. Com escopo de bloco por padrão para evitar edições não intencionais entre seções.

[Saiba mais →](/pt-BR/guide/multi-cursor)

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
| Ordenar Linhas Crescente | `F4` |
| Ordenar Linhas Decrescente | `Shift + F4` |

## Tabelas

Edição completa de tabelas:

- Inserir tabelas via menu ou atalho
- Adicionar/excluir linhas e colunas
- Alinhamento de células (esquerda, centro, direita)
- Redimensionar colunas arrastando
- Barra de ferramentas contextual para ações rápidas
- Navegação por teclado (Tab, setas, Enter)

## Imagens

Suporte abrangente a imagens:

- Inserir via diálogo de arquivo
- Arrastar e soltar do sistema de arquivos
- Colar da área de transferência
- Copiar automaticamente para a pasta de ativos do projeto
- Redimensionar via menu de contexto
- Duplo clique para editar caminho da fonte, texto alternativo e dimensões
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
- Suporte completo à sintaxe LaTeX
- Mensagens de erro úteis com dicas de sintaxe

### Diagramas

Suporte a diagramas Mermaid com visualização ao vivo:

- Fluxogramas, diagramas de sequência, gráficos de Gantt
- Diagramas de classe, diagramas de estado, diagramas ER
- Painel de visualização ao vivo no modo Fonte (arrastar, redimensionar, zoom)
- [Saiba mais →](/pt-BR/guide/mermaid)

### Gráficos SVG

Renderize SVG bruto inline via blocos de código ` ```svg `:

- Renderização instantânea com pan, zoom e exportação PNG
- Visualização ao vivo nos modos WYSIWYG e Fonte
- Ideal para gráficos gerados por IA e ilustrações personalizadas
- [Saiba mais →](/pt-BR/guide/svg)

## Gênios de IA

Assistência de escrita com IA integrada com base no seu provedor escolhido:

- 13 gênios em quatro categorias — edição, criativo, estrutura e ferramentas
- Seletor no estilo Spotlight com pesquisa e prompts livres (`Mod + Y`)
- Renderização de sugestão inline — aceitar ou rejeitar com atalhos de teclado
- Suporta provedores CLI (Claude, Codex, Gemini) e APIs REST (Anthropic, OpenAI, Google AI, Ollama)

[Saiba mais →](/pt-BR/guide/ai-genies) | [Configurar provedores →](/pt-BR/guide/ai-providers)

## Pesquisar e Substituir

Abra a barra de pesquisa com `Mod + F`. Ela aparece inline na parte superior da área do editor e funciona nos modos WYSIWYG e Fonte.

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

Clique no chevron de expansão na barra de pesquisa para revelar a linha de substituição. Digite o texto de substituição, então use **Substituir** (única correspondência) ou **Substituir Tudo** (todas as correspondências de uma vez). O contador de correspondências exibe a posição atual e o total (por exemplo, "3 de 12") para que você sempre saiba onde está.

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

Os resultados do lint são efêmeros e limpos quando você edita o documento. Execute a verificação novamente a qualquer momento com `Alt + Mod + V`.

## Barra de Ferramentas Universal

Uma barra de ferramentas de formatação ancorada na parte inferior do editor, fornecendo acesso rápido a todas as ações de formatação nos modos WYSIWYG e Fonte.

- **Alternar:** `Mod + Shift + P` abre a barra de ferramentas e dá foco a ela. Pressione novamente para retornar o foco ao editor mantendo a barra visível.
- **Navegação por teclado:** Use as setas `Esquerda`/`Direita` para mover entre grupos. `Enter` ou `Espaço` abre um menu suspenso. As setas navegam dentro dos menus.
- **Escape em dois passos:** Se um menu suspenso estiver aberto, `Escape` fecha primeiro o menu. Pressione `Escape` novamente para fechar toda a barra de ferramentas.
- **Memória de sessão:** A barra de ferramentas lembra qual botão estava focado por último durante a sessão atual, então ao re-focar continua de onde parou.
- **Atalho dos Gênios de IA:** A barra de ferramentas inclui um botão de Gênios de IA que abre o seletor de gênios (`Mod + Y`).

## Opções de Exportação

O VMark oferece opções flexíveis de exportação para compartilhar seus documentos.

### Exportação HTML

Exportar para HTML autônomo com dois modos de empacotamento:

- **Modo pasta** (padrão): Cria `Documento/index.html` com ativos em uma subpasta
- **Modo arquivo único**: Cria um arquivo `.html` autocontido com imagens incorporadas

O HTML exportado inclui o [**VMark Reader**](/pt-BR/guide/export#vmark-reader) — controles interativos para configurações, sumário, lightbox de imagens e mais.

[Saiba mais sobre exportação →](/pt-BR/guide/export)

### Exportação PDF

Imprimir para PDF com diálogo nativo do sistema (`Cmd/Ctrl + P`).

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
- **Histórico por documento** armazenado localmente em formato JSONL
- Abra a barra lateral de Histórico com `Ctrl + Shift + 3` para navegar por versões anteriores
- Os snapshots são **agrupados por dia** com carimbos de data/hora mostrando o momento exato de cada versão salva
- **Restaure** uma versão anterior clicando no botão de restaurar ao lado de qualquer snapshot (um diálogo de confirmação previne reversões acidentais)
- **Exclua** snapshots individuais que você não precisa mais com o botão de lixeira
- O conteúdo atual é salvo como novo snapshot antes de qualquer reversão, então você nunca perde seu trabalho
- O histórico requer que o documento esteja salvo em um arquivo (documentos sem título não têm histórico)
- Ative ou desative o rastreamento de histórico em **Configurações > Geral**

## Recuperação de Sessão (Hot Exit)

Quando você sai do VMark ou ele fecha inesperadamente, sua sessão é preservada e restaurada no próximo lançamento.

**O que é salvo:**
- Todas as abas abertas e seu conteúdo (incluindo alterações não salvas)
- Posições do cursor e histórico de desfazer/refazer
- Layout da interface: estado da barra lateral, visibilidade do esquema, modo fonte/foco/máquina de escrever, estado do terminal
- Posição e tamanho da janela
- Área de trabalho ativa e configurações do explorador de arquivos

**Como funciona:**
- Ao sair, o VMark captura o estado completo da sessão de todas as janelas
- Ao relançar, as abas são restauradas exatamente como você as deixou, com documentos modificados (não salvos) marcados adequadamente
- A recuperação de falhas é executada automaticamente após uma saída inesperada, restaurando documentos a partir de snapshots de recuperação periódicos
- Snapshots de recuperação com mais de 7 dias são limpos automaticamente

Nenhuma configuração necessária. A recuperação de sessão está sempre ativa.

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

### Limpeza de Imagens (Arquivo → Limpar Imagens Não Utilizadas)

Encontre e remova imagens órfãs da sua pasta de ativos.

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

[Saiba mais →](/pt-BR/guide/workspace-management)

## Personalização

### Temas

Cinco temas de cores integrados:

- Branco (limpo, minimalista)
- Papel (branco quente)
- Menta (toque verde suave)
- Sépia (visual vintage)
- Noturno (modo escuro)

### Fontes

Configure fontes separadas para:

- Texto Latin
- Texto CJK (Chinês/Japonês/Coreano)
- Monoespaçado (código)

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
