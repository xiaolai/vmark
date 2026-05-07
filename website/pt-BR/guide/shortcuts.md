# Atalhos de Teclado

O VMark é projetado para fluxos de trabalho com teclado em primeiro lugar. A maioria dos atalhos pode ser personalizada nas Configurações. Algumas primitivas são fixas: os seletores de múltiplos cursores `Mod+D` (Selecionar Próxima Ocorrência) e `Mod+Shift+L` (Selecionar Todas as Ocorrências), e os bindings globais de Desfazer/Refazer. Os demais atalhos de múltiplos cursores (Pular Ocorrência, Desfazer Cursor Suave, Adicionar Cursor Acima/Abaixo) são configuráveis. Atalhos marcados como _(sensíveis ao contexto)_ são tratados dentro do editor para estruturas específicas (ex.: alternar caixa de seleção em lista de tarefas) e não aparecem no registro de personalização.

## Notação

- **Mod** = Cmd no macOS, Ctrl no Windows/Linux
- **Alt** = Option no macOS

## Teclas de Função no macOS

O VMark usa teclas de função (F4–F10) para alternâncias rápidas de modo. No macOS, essas teclas são mapeadas para funções do sistema (brilho, volume, etc.) por padrão.

**Para usar as teclas F diretamente sem segurar Fn:**

1. Abra **Configurações do Sistema** → **Teclado**
2. Habilite **"Usar teclas F1, F2, etc. como teclas de função padrão"**

Alternativamente, segure a tecla **Fn** ao pressionar F4–F10 para acionar os atalhos do VMark.

::: tip
Se você preferir manter as funções do sistema nas teclas F, pode personalizar os atalhos do VMark nas Configurações (`Mod + ,`) para usar combinações de teclas diferentes.
:::

### Referência Rápida de Teclas F

| Tecla | Ação |
|-------|------|
| `F2` | Próximo problema |
| `Shift + F2` | Problema anterior |
| `F4` | Ordenar Linhas Crescente |
| `Shift + F4` | Ordenar Linhas Decrescente |
| `F5` | Peek de Fonte |
| `F6` | Alternar Modo Fonte |
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
| Código Inline | `` Mod + Shift + ` `` |
| Destaque | `Mod + Shift + M` |
| Subscrito | `Alt + Mod + =` |
| Sobrescrito | `Alt + Mod + Shift + =` |
| Link | `Mod + K` |
| Abrir Link (modo Fonte) | `Cmd + Clique` |
| Remover Link | `Alt + Shift + K` |
| Link Wiki | `Alt + Mod + K` |
| Link de Favorito | `Alt + Mod + B` |
| Limpar Formatação | `Mod + \` |
| Alternar Ênfase | `Mod + Alt + E` _(nenhuma → itálico → negrito → negrito+itálico)_ |

## Formatação de Bloco

| Ação | Atalho |
|------|--------|
| Título 1-6 | `Mod + 1` até `Mod + 6` |
| Parágrafo | `Mod + Shift + 0` |
| Aumentar Nível de Título | `Alt + Mod + ]` |
| Diminuir Nível de Título | `Alt + Mod + [` |
| Alternar Nível de Título | `Mod + Alt + H` _(P → H1 → H2 → … → H6)_ |
| Citação | `Alt + Mod + Q` |
| Bloco de Código | `Alt + Mod + C` |
| Lista com Marcadores | `Alt + Mod + U` |
| Lista Ordenada | `Alt + Mod + O` |
| Lista de Tarefas | `Alt + Mod + X` |
| Alternar Caixa de Seleção de Tarefa | `Mod + Shift + Enter` _(sensível ao contexto; não personalizável)_ |
| Alternar Tipo de Lista | _(personalizável)_ |
| Aumentar Recuo | `Mod + ]` |
| Diminuir Recuo | `Mod + [` |
| Linha Horizontal | `Alt + Mod + -` |

## Operações de Linha

| Ação | Atalho |
|------|--------|
| Mover Linha Acima | `Alt + Cima` |
| Mover Linha Abaixo | `Alt + Baixo` |
| Duplicar Linha | `Shift + Alt + Baixo` |
| Excluir Linha | `Mod + Shift + K` |
| Unir Linhas | `Mod + J` |
| Ordenar Linhas Crescente | `F4` |
| Ordenar Linhas Decrescente | `Shift + F4` |

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
| Matemática Inline | `Alt + Mod + M` |
| Bloco Matemático | `Alt + Mod + Shift + M` |
| Inserir Nota | `Alt + Mod + N` |
| Inserir Dica | `Alt + Mod + Shift + T` |
| Inserir Aviso | `Mod + Shift + W` |
| Inserir Importante | `Alt + Mod + Shift + I` |
| Inserir Cuidado | `Mod + Shift + U` |
| Inserir Recolhível | `Alt + Mod + D` |
| Inserir Diagrama | `Alt + Shift + Mod + D` |
| Inserir Mapa Mental | `Alt + Shift + Mod + K` |
| Alternar Comentário | `Mod + /` |

## Seleção e Múltiplos Cursores

| Ação | Atalho |
|------|--------|
| Selecionar Linha | `Mod + L` |
| Expandir Seleção | `Ctrl + Shift + Cima` |
| Selecionar Próxima Ocorrência | `Mod + D` |
| Pular Ocorrência | `Mod + Shift + D` |
| Selecionar Todas as Ocorrências | `Mod + Shift + L` |
| Desfazer Cursor Suave | `Alt + Mod + Z` |
| Adicionar Cursor Acima | `Mod + Alt + Cima` |
| Adicionar Cursor Abaixo | `Mod + Alt + Baixo` |
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
| Alternar Modo Fonte | `F6` |
| Alternar Barra de Status | `F7` |
| Modo Foco | `F8` |
| Modo Máquina de Escrever | `F9` |
| Modo Somente Leitura | `F10` |
| Tamanho Real | `Mod + 0` |
| Aumentar Zoom | `Mod + =` |
| Diminuir Zoom | `Mod + -` |
| Quebra de Linha | `Alt + Z` |
| Alternar Esboço | `Ctrl + Shift + 1` |
| Alternar Explorador de Arquivos | `Ctrl + Shift + 2` |
| Alternar Histórico | `Ctrl + Shift + 3` |
| Alternar Números de Linha (blocos de código) | `Alt + Mod + L` |
| Alternar Terminal | Ctrl + `` ` `` |
| Alternar Visualização de Diagrama | `Alt + Mod + P` |
| Ajustar Tabelas à Largura | _(personalizável)_ |
| Barra de Ferramentas Universal | `Mod + Shift + P` |
| Peek de Fonte | `F5` |
| Verificar Markdown | `Alt + Mod + V` |
| Próximo problema | `F2` |
| Problema anterior | `Shift + F2` |

## Operações de Arquivo

| Ação | Atalho |
|------|--------|
| Novo Arquivo | `Mod + N` |
| Abertura Rápida | `Mod + O` _(navegador de arquivos com busca fuzzy)_ |
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
| Fechar Aba | `Mod + W` |
| Alternar Arquivos Ocultos | `Mod + Shift + .` |
| Alternar Todos os Arquivos | _(personalizável)_ |

::: tip Nota Windows/Linux
Alternar Arquivos Ocultos usa `Ctrl + H` no Windows e Linux.
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
| Dentro de **negrito**, *itálico*, `código` | Pular após a formatação |
| Dentro de um link | Pular após o link |

| Contexto | Ação do Shift+Tab |
|----------|------------------|
| Após `(`, `[`, `{`, aspas | Pular antes do caractere de abertura |
| Após parênteses CJK `「`, `『`, etc. | Pular antes do parêntese de abertura |
| Dentro de **negrito**, *itálico*, `código` | Pular antes da formatação |
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
| Adicionar Coluna à Esquerda | `Alt + Mod + Left` |
| Adicionar Coluna à Direita | `Alt + Mod + Right` |
| Excluir Coluna | `Alt + Mod + Backspace` |
| Alinhar Coluna à Esquerda | `Mod + Alt + Shift + L` |
| Alinhar Coluna à Direita | `Mod + Shift + R` |
| Alinhar Coluna ao Centro | _(personalizável)_ |
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
| Copiar | `Mod + C` (com seleção) |
| Colar | `Mod + V` |
| Limpar | `Mod + K` |
| Pesquisar | `Mod + F` |

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
2. Navegue até a aba **Atalhos**
3. Clique em qualquer atalho para editar
4. Pressione a combinação de teclas desejada
5. As alterações são salvas automaticamente

::: tip
Os atalhos sincronizam com os aceleradores de menu quando aplicável, portanto os itens de menu mostrarão seus atalhos personalizados.
:::
