# Atalhos de Teclado

O VMark é projetado para fluxos de trabalho com teclado em primeiro lugar. A maioria dos atalhos pode ser personalizada nas Configurações. Algumas primitivas são fixas: os seletores de múltiplos cursores `Mod+D` (Selecionar Próxima Ocorrência) e `Mod+Shift+L` (Selecionar Todas as Ocorrências), e os bindings globais de Desfazer/Refazer. Os demais atalhos de múltiplos cursores (Pular Ocorrência, Desfazer Cursor Suave, Adicionar Cursor Acima/Abaixo) são configuráveis. Atalhos marcados como _(sensíveis ao contexto)_ são tratados dentro do editor para estruturas específicas (ex.: alternar caixa de seleção em lista de tarefas) e não aparecem no registro de personalização.

## Notação

- **Mod** = Cmd no macOS, Ctrl no Windows/Linux
- **Alt** = Option no macOS

## Teclas de Função no macOS

O VMark usa teclas de função (F2–F10) para alternâncias rápidas de modo. No macOS, essas teclas são mapeadas para funções do sistema (brilho, volume, etc.) por padrão.

**Para usar as teclas F diretamente sem segurar Fn:**

1. Abra **Configurações do Sistema** → **Teclado**
2. Habilite **"Usar teclas F1, F2, etc. como teclas de função padrão"**

Alternativamente, segure a tecla **Fn** ao pressionar F2–F10 para acionar os atalhos do VMark.

::: tip
Se você preferir manter as funções do sistema nas teclas F, pode personalizar os atalhos do VMark nas Configurações (`Mod + ,`) para usar combinações de teclas diferentes.
:::

### Referência Rápida de Teclas F

| Tecla | Ação |
|-------|------|
| `F2` | Próximo problema |
| `Shift + F2` | Problema anterior |
| `F3` | Alternar Caracteres Invisíveis |
| `F4` | Ordenar Linhas Crescente _(somente no modo Fonte; não faz nada no WYSIWYG)_ |
| `Shift + F4` | Ordenar Linhas Decrescente _(somente no modo Fonte; não faz nada no WYSIWYG)_ |
| `F5` | Peek de Fonte |
| `F6` | Visualização de fonte (Markdown: WYSIWYG ⇄ Fonte; outros formatos: Fonte ⇄ Dividido) |
| `Shift + F6` | Dividido / Visualização (Markdown: visualização dividida; outros formatos: Visualização ⇄ Dividido) |
| `F7` | Alternar Barra de Status |
| `F8` | Modo Foco |
| `F9` | Modo Máquina de Escrever |
| `F10` | Modo Somente Leitura |

## Editar

| Ação | Atalho |
|------|--------|
| Desfazer | `Mod + Z` |
| Refazer | `Mod + Shift + Z` |

## Formatação de Texto

| Ação | Atalho |
|------|--------|
| Negrito | `Mod + B` |
| Itálico | `Mod + I` |
| Sublinhado | `Mod + U` |
| Tachado | `Mod + Shift + X` |
| Código Inline | Mod + Shift + `` ` `` |
| Destaque | `Mod + Shift + M` |
| Subscrito | `Alt + Mod + =` |
| Sobrescrito | `Alt + Mod + Shift + =` |
| Link | `Mod + K` |
| Abrir Link (modo Fonte) | `Cmd + Click` |
| Remover Link | `Alt + Shift + K` |
| Link Wiki | `Alt + Mod + K` |
| Link de Favorito | `Alt + Mod + B` |
| Limpar Formatação | `Mod + \` |

## Formatação de Bloco

| Ação | Atalho |
|------|--------|
| Título 1-6 | `Mod + 1` até `Mod + 6` |
| Parágrafo | `Mod + Shift + 0` |
| Aumentar Nível de Título | `Alt + Mod + ]` |
| Diminuir Nível de Título | `Alt + Mod + [` |
| Citação | `Alt + Mod + Q` |
| Bloco de Código | `Alt + Mod + C` |
| Lista com Marcadores | `Alt + Mod + U` |
| Lista Ordenada | `Alt + Mod + O` |
| Lista de Tarefas | `Alt + Mod + X` |
| Alternar Caixa de Seleção de Tarefa | `Mod + Shift + Enter` _(sensível ao contexto; não personalizável)_ |
| Aumentar Recuo | `Mod + ]` |
| Diminuir Recuo | `Mod + [` |
| Linha Horizontal | `Alt + Mod + -` |

## Operações de Linha

| Ação | Atalho |
|------|--------|
| Mover Linha Acima | `Alt + Up` |
| Mover Linha Abaixo | `Alt + Down` |
| Duplicar Linha | `Shift + Alt + Down` |
| Excluir Linha | `Mod + Shift + K` |
| Unir Linhas | `Mod + J` |
| Ordenar Linhas Crescente | `F4` _(somente no modo Fonte)_ |
| Ordenar Linhas Decrescente | `Shift + F4` _(somente no modo Fonte)_ |

## Transformações de Texto

| Ação | macOS | Windows/Linux |
|------|-------|---------------|
| MAIÚSCULAS | `Ctrl + Shift + U` | `Alt + Shift + U` |
| minúsculas | `Ctrl + Shift + L` | `Alt + Shift + L` |
| Capitalização de Título | `Ctrl + Shift + T` | `Alt + Shift + T` |
| Alternar Maiúsculas/Minúsculas | _(personalizável)_ | _(personalizável)_ |
| Remover Linhas em Branco | _(personalizável)_ | _(personalizável)_ |
| Alternar Estilo de Aspas | `Shift + Mod + '` | `Shift + Mod + '` |

## Inserir

| Ação | Atalho |
|------|--------|
| Inserir Imagem | `Mod + Shift + I` |
| Inserir Vídeo | — |
| Inserir Áudio | — |
| Inserir Tabela | `Mod + Shift + T` |
| Sumário | _(personalizável)_ |
| Matemática Inline | `Alt + Mod + M` |
| Bloco Matemático | `Alt + Mod + Shift + M` |
| Inserir Nota | `Alt + Mod + N` |
| Inserir Dica | `Alt + Mod + Shift + T` |
| Inserir Aviso | `Mod + Shift + W` |
| Inserir Importante | `Alt + Mod + Shift + I` |
| Inserir Cuidado | `Mod + Shift + U` |
| Inserir Recolhível | `Alt + Mod + D` |
| Inserir Diagrama | `Alt + Mod + Shift + D` |
| Inserir Diagrama Graphviz | _(personalizável)_ |
| Inserir Mapa Mental | `Alt + Mod + Shift + K` |
| Alternar Comentário | `Mod + /` |

## Seleção e Múltiplos Cursores

| Ação | Atalho |
|------|--------|
| Selecionar Linha | `Mod + L` |
| Selecionar Todas as Ocorrências no Bloco | `Alt + Mod + Shift + L` |
| Expandir Seleção | `Ctrl + Shift + Up` |
| Selecionar Próxima Ocorrência | `Mod + D` |
| Pular Ocorrência | `Mod + Shift + D` |
| Selecionar Todas as Ocorrências | `Mod + Shift + L` |
| Desfazer Cursor Suave | `Alt + Mod + Z` |
| Adicionar Cursor Acima | `Mod + Alt + Up` |
| Adicionar Cursor Abaixo | `Mod + Alt + Down` |
| Colapsar Múltiplos Cursores | `Escape` |

## Localizar e Substituir

| Ação | Atalho |
|------|--------|
| Localizar e Substituir | `Mod + F` |
| Localizar Próximo | `Mod + G` |
| Localizar Anterior | `Mod + Shift + G` |
| Usar Seleção para Pesquisa | `Mod + E` |
| Localizar em Arquivos | `Mod + Shift + H` |

## Visualização e Modo

| Ação | Atalho |
|------|--------|
| Visualização de fonte (Markdown ⇄ Fonte; outros formatos Fonte ⇄ Dividido) | `F6` |
| Dividido / Visualização (Markdown dividido; outros formatos Visualização ⇄ Dividido) | `Shift + F6` |
| Dividir Editor — Dois Documentos | `Alt + Mod + \` |
| Alternar Barra de Status | `F7` |
| Modo Foco | `F8` |
| Modo Máquina de Escrever | `F9` |
| Modo Somente Leitura | `F10` |
| Tamanho Real | `Mod + 0` |
| Aumentar Zoom | `Mod + =` |
| Diminuir Zoom | `Mod + -` |
| Quebra de Linha | `Alt + Z` |
| Última Aba Usada | `Ctrl + Tab` |
| Dividir Editor — Dois Documentos | `Alt + Mod + \` |
| Fechar Painel | `Alt + Mod + Shift + \` |
| Focar o Outro Painel | `Alt + Mod + Shift + O` |
| Alternar Barra Lateral | `Ctrl + Shift + 0` |
| Alternar Esboço | `Ctrl + Shift + 1` |
| Alternar Explorador de Arquivos | `Ctrl + Shift + 2` |
| Alternar Histórico | `Ctrl + Shift + 3` |
| Alternar Base de Conhecimento | `Ctrl + Shift + 4` |
| Alternar Status das Janelas | `Ctrl + Shift + 5` |
| Alternar Números de Linha (margem do Fonte/Dividido) | `Alt + Mod + L` |
| Alternar Terminal | Ctrl + `` ` `` |
| Focar Terminal ou Editor | Ctrl + Shift + `` ` `` (Alt + Shift + `` ` `` no Windows/Linux) |
| Alternar Visualização de Diagrama | `Alt + Mod + P` |
| Ajustar Tabelas à Largura | _(personalizável)_ |
| Abrir Barra de Ferramentas Universal | `Mod + Shift + B` |
| Peek de Fonte | `F5` |
| Verificar Markdown | `Alt + Mod + V` |
| Próximo problema | `F2` |
| Problema anterior | `Shift + F2` |

::: tip Alternar Base de Conhecimento
`Ctrl + Shift + 4` fica oculto por padrão, junto com o item de menu **Visualizar → Base
de conhecimento** e o comando da paleta. Nenhuma versão de lançamento, em nenhuma plataforma,
inclui o runtime do servidor de conteúdo de que o recurso precisa, por isso os pontos de entrada
só aparecem quando **Configurações → Avançado → Ferramentas de desenvolvedor** está ativado — veja
[Base de conhecimento e Slidev](/pt-BR/guide/knowledge-base#requisitos). De qualquer forma, o atalho
continua listado e personalizável em **Configurações → Atalhos**.
:::

## Operações de Arquivo

| Ação | Atalho |
|------|--------|
| Novo Arquivo | `Mod + N` |
| Abertura Rápida | `Mod + O` _(navegador de arquivos com busca fuzzy)_ |
| Abrir Paleta de Comandos | `Mod + Shift + P` |
| Abrir Arquivo... | Somente no menu _(seletor de arquivos nativo)_ |
| Abrir Área de Trabalho | `Mod + Shift + O` |
| Salvar | `Mod + S` |
| Salvar Como | `Mod + Shift + S` |
| Salvar Tudo e Sair | `Alt + Mod + Shift + Q` |
| Mover para | Somente no menu |
| Fechar | `Mod + W` |
| Exportar HTML | Somente no menu |
| Imprimir | `Mod + P` |
| Exportar PDF | — |
| Configurações | `Mod + ,` |

## Área de Transferência

| Ação | Atalho |
|------|--------|
| Copiar como HTML | `Mod + Shift + C` |
| Colar Texto Simples | `Mod + Shift + V` |

## Gênios de IA

| Ação | Atalho |
|------|--------|
| Abrir Gênios de IA | `Mod + Y` |
| Aceitar sugestão | `Enter` |
| Rejeitar sugestão | `Escape` |
| Próxima sugestão | `Tab` |
| Sugestão anterior | `Shift + Tab` |
| Aceitar todas as sugestões | `Mod + Shift + Enter` |
| Rejeitar todas as sugestões | `Mod + Shift + Escape` |

## Formatação CJK

| Ação | Atalho |
|------|--------|
| Formatar Seleção | `Mod + Shift + F` |
| Formatar Documento | `Alt + Mod + Shift + F` |

## Janela e Abas

| Ação | Atalho |
|------|--------|
| Nova Janela | `Mod + Shift + N` |
| Nova Aba | `Mod + T` |
| Nova Aba do Navegador | `Alt + Mod + Shift + B` |
| Próxima Aba | `Mod + Shift + ]` |
| Aba Anterior | `Mod + Shift + [` |
| Fechar Aba | `Mod + W` |
| Reabrir Aba Fechada | _(personalizável)_ |
| Alternar Arquivos Ocultos | `Mod + Shift + .` |
| Alternar Todos os Arquivos | `Mod + Shift + A` |

::: tip Nota Windows/Linux
Alternar Arquivos Ocultos usa `Ctrl + H` no Windows e Linux.

Alternar Barra Lateral usa `Alt + Shift + 0` no Windows e Linux, porque lá `Mod` é
Ctrl — então a combinação do macOS `Ctrl + Shift + 0` colidiria com o
`Mod + Shift + 0` de Parágrafo.
:::

::: tip Nova Aba do Navegador
`Alt + Mod + Shift + B` abre uma aba do navegador incorporado e também aparece no menu
**Arquivo**. O navegador incorporado vem ativado por padrão no macOS; se você o desativar
em **Configurações → Avançado → Navegador incorporado**, o item de menu fica oculto
(não acinzentado) até que você o ative de novo. O navegador é exclusivo do macOS, então o
item nunca aparece no Windows nem no Linux.

É um item de menu de verdade, e não apenas uma associação de teclado, e isso importa: assim que
uma página web recebe o foco do teclado, o motor do navegador consome as teclas pressionadas antes que o VMark
as veja, então um atalho interno do app não consegue disparar. Um acelerador de menu é despachado pelo
próprio macOS, então continua funcionando enquanto você navega.
:::

## Ajuda (somente macOS)

| Ação | Atalho |
|------|--------|
| Pesquisar Menus | `Cmd + Shift + /` |

::: tip
Este é um atalho nativo do sistema macOS que pesquisa todos os itens de menu. Digite uma palavra-chave para encontrar e executar qualquer ação de menu.
:::

## Navegação Inteligente com Tab

Tab e Shift+Tab são sensíveis ao contexto — eles escapam de parênteses, aspas, marcas de formatação e links.

| Contexto | Ação do Tab |
|----------|------------|
| Antes de `)`, `]`, `}`, aspas | Pular o caractere de fechamento |
| Antes de parênteses CJK `」`, `』`, etc. | Pular o parêntese de fechamento |
| Dentro de **negrito**, *itálico*, `code` | Pular após a formatação |
| Dentro de um link | Pular após o link |

| Contexto | Ação do Shift+Tab |
|----------|------------------|
| Após `(`, `[`, `{`, aspas | Pular antes do caractere de abertura |
| Após parênteses CJK `「`, `『`, etc. | Pular antes do parêntese de abertura |
| Dentro de **negrito**, *itálico*, `code` | Pular antes da formatação |
| Dentro de um link | Pular antes do link |

::: tip
Veja [Navegação Inteligente com Tab](/pt-BR/guide/tab-navigation) para o guia completo incluindo parênteses CJK, aspas curvas e configurações.
:::

## Edição de Tabelas

Quando o cursor estiver dentro de uma tabela:

| Ação | Atalho |
|------|--------|
| Próxima Célula | `Tab` |
| Célula Anterior | `Shift + Tab` |
| Adicionar Linha Abaixo | `Mod + Enter` |
| Adicionar Linha Acima | `Mod + Shift + Enter` |
| Excluir Linha | `Mod + Backspace` |
| Formatar Tabela | `Alt + Mod + T` |
| Sair da Tabela | Teclas de seta na borda da tabela |

## Navegação em Popups

Quando um popup estiver aberto (link, imagem, matemática, etc.):

| Ação | Atalho |
|------|--------|
| Fechar Popup | `Escape` |
| Confirmar/Salvar | `Enter` |
| Navegar Campos | `Tab` / `Shift + Tab` |

## Edição de Bloco Matemático

Ao editar um bloco matemático:

| Ação | Atalho |
|------|--------|
| Confirmar e Sair | `Mod + Enter` |
| Cancelar e Sair | `Escape` |

## Terminal

Quando o terminal integrado estiver focado:

| Ação | Atalho |
|------|--------|
| Alternar Terminal | `` Ctrl + ` `` |
| Focar Terminal ou Editor | `` Ctrl + Shift + ` `` (`` Alt + Shift + ` `` no Windows/Linux) |
| Copiar | `Mod + C` (com seleção); no Linux também `Ctrl + Shift + C` ou `Ctrl + Insert` |
| Colar | `Mod + V`; no Linux também `Ctrl + Shift + V` ou `Shift + Insert` |
| Selecionar Tudo (somente a saída do terminal) | `Mod + A` (`Ctrl + Shift + A` no Linux) |
| Limpar | `Mod + K` (`Ctrl + Shift + K` no Linux) |
| Pesquisar | `Mod + F` (`Ctrl + Shift + F` no Linux) |
| Alternar para a sessão 1–5 | `Mod + 1` até `Mod + 5` |
| Aumentar fonte do terminal | `Mod + =` |
| Diminuir fonte do terminal | `Mod + -` |
| Tamanho padrão da fonte do terminal | `Mod + 0` |
| Prompt de comando anterior | `Mod + ↑` |
| Próximo prompt de comando | `Mod + ↓` |
| Nova linha na linha de entrada (Claude Code e ferramentas semelhantes) | `Shift + Enter` |

Enquanto o terminal estiver focado, `Mod + =`, `Mod + -` e `Mod + 0` redimensionam a fonte do terminal em vez da do editor.

A navegação entre prompts salta entre os prompts de comando no histórico de rolagem e requer integração com o shell (zsh ou bash).

No macOS, o terminal também traduz os atalhos habituais de edição de texto para o shell:

| Ação | Atalho |
|------|--------|
| Mover uma palavra para a esquerda / direita | `Option + ←` / `Option + →` |
| Mover para o início / fim da linha | `Cmd + ←` / `Cmd + →` |
| Apagar a linha de entrada (envia `Ctrl + U`) | `Cmd + Backspace` |

Combinações com `Ctrl`, como `Ctrl + A`, `Ctrl + R` e `Ctrl + W`, vão direto para o shell no macOS.

No Linux, o terminal segue a convenção habitual dos terminais Linux: combinações simples de `Ctrl` + letra vão para o shell, então teclas do readline como `Ctrl + A`, `Ctrl + E`, `Ctrl + K`, `Ctrl + F`, `Ctrl + U` e `Ctrl + W` funcionam como em qualquer outro terminal Linux, e as ações próprias do terminal passam para `Ctrl + Shift`: `Ctrl + Shift + A` seleciona tudo, `Ctrl + Shift + K` limpa, `Ctrl + Shift + F` pesquisa, e `Ctrl + Shift + C` / `Ctrl + Shift + V` copiam e colam. `Ctrl + Insert` e `Shift + Insert` também copiam e colam. O terminal mantém duas combinações simples de `Ctrl`: `Ctrl + C` copia uma seleção (e envia SIGINT quando nada está selecionado), e `Ctrl + V` cola. `Ctrl + 1` até `Ctrl + 5` continuam alternando entre sessões.

Quando a barra de pesquisa do terminal estiver aberta:

| Ação | Atalho |
|------|--------|
| Próxima Correspondência | `Enter` |
| Correspondência Anterior | `Shift + Enter` |
| Fechar Pesquisa | `Escape` |

::: tip
`Mod + C` sem seleção envia SIGINT ao processo em execução. Veja [Terminal Integrado](/pt-BR/guide/terminal) para o guia completo.
:::

## Personalizando Atalhos

1. Abra as Configurações com `Mod + ,`
2. Navegue até a aba **Atalhos** (digite na caixa de pesquisa para filtrar por nome, categoria, descrição ou tecla)
3. Clique na tecla mostrada ao lado de um atalho — ou em **Não atribuído** para um que ainda não tem tecla
4. Pressione a combinação de teclas desejada e clique em **Atribuir** (`Escape` cancela)

A caixa de diálogo avisa você antes de atribuir uma combinação:

- **Conflito** — a combinação já é usada por outro atalho, que é indicado pelo nome. Você ainda pode escolher **Atribuir mesmo assim**.
- **Não suportada** — o VMark não pode usar essa combinação, então ela não pode ser atribuída. Tente outra.

Um atalho personalizado fica destacado e ganha um botão **Redefinir para o padrão**. **Redefinir tudo** restaura todos os padrões após pedir confirmação. **Exportar** salva seus atalhos como um arquivo JSON (`vmark-shortcuts.json`) e **Importar** carrega um; se alguma entrada do arquivo for inválida, nada é importado e os problemas são listados.

::: tip
Os atalhos sincronizam com os aceleradores de menu quando aplicável, portanto os itens de menu mostrarão seus atalhos personalizados.
:::
