# Popups Inline

O VMark fornece popups contextuais para editar links, imagens, mídia, matemática, rodapés e mais. Esses popups funcionam nos modos WYSIWYG e Fonte com navegação por teclado consistente.

## Atalhos de Teclado Comuns

Todos os popups compartilham estes comportamentos de teclado:

| Ação | Atalho |
|------|--------|
| Fechar/Cancelar | `Escape` |
| Confirmar/Salvar | `Enter` |
| Navegar campos | `Tab` / `Shift + Tab` |

## Popup de Link

Clicar em um link mostra seu popup de edição. O cursor permanece onde você clicou, então você pode continuar editando o texto do link — digitar, `Backspace` e copiar/colar atuam no documento. O popup fecha assim que você edita o texto ou move o cursor para fora do link.

### Editar Link Existente

**Ativação:** Clicar em um link, ou posicionar o cursor no link + `Mod + K`

Um clique mantém o teclado no documento; clique no campo URL para editar o destino. `Mod + K` move o foco diretamente para o campo URL.

**Campos:**
- **URL** — Editar o destino do link
- **Abrir destino** — Abre uma URL externa no navegador, vai para o título em links `#favorito` ou abre um arquivo local em uma nova aba em links entre arquivos
- **Copiar** — Copiar URL para a área de transferência
- **Excluir** — Remover link, manter texto

**Abrir sem o popup:** `Cmd + Clique` (`Ctrl + Clique` no Windows/Linux) em um link abre o destino diretamente.

### Criar Novo Link

**Ativação:** Selecionar texto + `Mod + K`

**Área de transferência inteligente:** Se a sua área de transferência contiver uma URL, ela é preenchida automaticamente.

**Campos:**
- **Entrada de URL** — Inserir destino
- **Confirmar** — Pressione Enter ou clique em ✓
- **Cancelar** — Pressione Escape ou clique em ✗

### Modo Fonte

- **`Cmd + Clique`** (`Ctrl + Clique` no Windows/Linux) no link → URLs externas abrem no navegador, links `#favorito` vão para o título e caminhos de arquivos locais abrem o arquivo em uma nova aba
- **Clique** na sintaxe `[text](url)` → mostra popup de edição; o cursor permanece no markdown para você continuar digitando
- **`Mod + K`** dentro do link → mostra popup de edição com o foco no campo URL

::: tip Links de Favorito
Links que começam com `#` são tratados como favoritos (links de títulos internos). Abrir vai para o título em vez de abrir um navegador.
:::

::: tip Links Entre Arquivos
Links que apontam para arquivos locais abrem o arquivo de destino em uma nova aba, indo para o título quando o link tem um `#fragment`. Caminhos relativos como `../appendix/cards.md` ou `./notes.md` são resolvidos a partir do diretório do documento atual. Caminhos absolutos — `/Users/me/notes/a.md` no macOS/Linux, `C:\notes\a.md` no Windows — abrem exatamente o arquivo indicado. Caminhos de rede (`\\server\share\…`) não são abertos a partir de links. Se o documento não tiver título, apenas caminhos absolutos podem ser abertos.
:::

## Seletor de Títulos (Links de Favorito)

**Ativação:** `Alt + Mod + B` (Link marcador), **Inserir → Links → Marcador** ou o grupo de links da Barra de Ferramentas Universal

Um link de favorito aponta para um título no mesmo documento (`[text](#heading-id)`). Em vez de digitar a âncora, o seletor lista todos os títulos do documento, recuados por nível, com um campo de filtro no topo.

**Comportamento:**
- `↑`/`↓` percorrem a lista, `Enter` insere o link, `Escape` fecha
- Com texto selecionado, a seleção vira o texto do link; sem seleção, o próprio texto do título é inserido como link
- O popup avisa quando o documento não tem títulos ou quando nada corresponde ao filtro

## Popup de Mídia (Imagens, Vídeo, Áudio)

Um popup unificado para editar todos os tipos de mídia — imagens, vídeo e áudio.

### Popup de Edição

**Ativação:** Duplo clique em qualquer elemento de mídia (imagem, vídeo ou áudio)

**Campos comuns (todos os tipos de mídia):**
- **Fonte** — Caminho do arquivo ou URL

**Campos específicos por tipo:**

| Campo | Imagem | Vídeo | Áudio |
|-------|--------|-------|-------|
| Texto alternativo | Sim | — | — |
| Título | — | Sim | Sim |
| Pôster | — | Sim | — |
| Dimensões | Somente leitura | — | — |
| Alternância Inline/Bloco | Sim (exceto imagens com link) | — | — |

**Botões:**
- **Navegar** — Escolher arquivo do sistema de arquivos
- **Copiar** — Copiar caminho da fonte para a área de transferência
- **Excluir** — Remover o elemento de mídia

**Atalhos:**
- `Mod + Shift + I` — Inserir nova imagem
- `Enter` — Salvar alterações
- `Escape` — Fechar popup

### Modo Fonte

No modo Fonte, clicar na sintaxe de imagem `![alt](path)` abre o mesmo popup de mídia.

O modo Fonte também mostra uma **prévia** flutuante da mídia — uma imagem, ou um player de vídeo ou áudio com controles nativos de reprodução. Ela aparece enquanto o cursor está dentro de `![alt](path)` (sem texto selecionado) e quando o mouse passa sobre a sintaxe; a prévia do cursor prevalece sobre a do mouse. O caminho deve terminar em uma extensão reconhecida de imagem, vídeo ou áudio (ou ser uma URL `data:image/`). A prévia some enquanto o popup de mídia está aberto.

## Menu de Contexto de Imagem

Clicando com o botão direito em uma imagem no modo WYSIWYG abre um menu de contexto com ações rápidas (separado do popup de edição de duplo clique).

**Ativação:** Clique com o botão direito em qualquer imagem

**Ações:**
| Ação | Descrição |
|------|-----------|
| Alterar Imagem | Abrir um seletor de arquivo para substituir a imagem |
| Excluir Imagem | Remover a imagem do documento |
| Copiar Caminho | Copiar o caminho da fonte da imagem para a área de transferência |
| Revelar no Finder | Abrir a localização do arquivo de imagem no gerenciador de arquivos (o rótulo se adapta por plataforma) |

Pressione `Escape` para fechar o menu de contexto sem executar nenhuma ação.

## Popup de Matemática

Edite expressões LaTeX com prévia ao vivo.

**Ativação:**
- **WYSIWYG:** Clique em matemática inline `$...$`
- **Fonte:** Posicione o cursor dentro de um `$...$` não vazio, de um bloco `$$...$$` ou de um bloco ` ```latex ` / ` ```math `

**Campos:**
- **Entrada LaTeX** — Editar a expressão matemática
- **Prévia** — Prévia renderizada em tempo real
- **Exibição de Erros** — Mostra erros LaTeX com dicas de sintaxe úteis

**Atalhos:**
- `Mod + Enter` — Salvar e fechar
- `Click outside` — Salvar e fechar (confirma suas edições)
- `Escape` — Cancelar e fechar (descarta suas edições)
- `Shift + Backspace` — Excluir matemática inline (funciona mesmo quando não vazia, apenas WYSIWYG)
- `Alt + Mod + M` — Inserir nova matemática inline

::: tip Dicas de Erro
Quando você tem um erro de sintaxe LaTeX, o popup mostra sugestões úteis como chaves faltando, comandos desconhecidos ou delimitadores desbalanceados.
:::

::: info Modo Fonte
O modo Fonte fornece o mesmo popup de matemática editável do modo WYSIWYG — uma caixa de texto para entrada LaTeX com uma prévia KaTeX ao vivo abaixo. O popup abre automaticamente quando o cursor entra em qualquer sintaxe matemática (um `$...$` não vazio, `$$...$$` ou ` ```latex ` / ` ```math `). Pressione `Mod + Enter` para salvar ou `Escape` para cancelar. Um `$$` vazio digitado no fim de uma linha é tratado como texto simples — provavelmente um delimitador de bloco matemático digitado pela metade — e não abre o popup.
:::

## Popup de Rodapé

Edite o conteúdo de rodapé inline.

**Ativação:**
- **WYSIWYG:** Passar o mouse sobre a referência de rodapé `[^1]`
- **Fonte:** Passar o mouse sobre uma referência ou definição de rodapé, ou clicar nela

**Campos:**
- **Conteúdo** — Texto de rodapé em múltiplas linhas (redimensionamento automático)
- **Ir para Definição** — Saltar para a definição do rodapé
- **Excluir** — Remover rodapé

**Comportamento:**
- Novos rodapés focam automaticamente o campo de conteúdo
- A área de texto se expande conforme você digita

## Popup de Link Wiki

Edite links no estilo wiki para conexões internas de documentos.

**Ativação:**
- **WYSIWYG:** Passar o mouse sobre `[[target]]` (atraso de 300ms)
- **Fonte:** Clicar na sintaxe de link wiki

**Campos:**
- **Alvo** — Caminho relativo à área de trabalho (extensão `.md` tratada automaticamente)
- **Navegar** — Escolher arquivo da área de trabalho
- **Abrir** — Abrir documento vinculado
- **Copiar** — Copiar caminho de destino
- **Excluir** — Remover link wiki

## Menu de Contexto de Tabela

Ações rápidas de edição de tabelas.

**Ativação:**
- **WYSIWYG:** Clique com o botão direito em uma célula da tabela (as mesmas ações também estão na barra de ferramentas e têm atalhos de teclado)
- **Fonte:** Clique com o botão direito em uma célula da tabela

**Ações:**
| Ação | Descrição |
|------|-----------|
| Inserir Linha Acima/Abaixo | Adicionar linha no cursor |
| Inserir Coluna à Esquerda/Direita | Adicionar coluna no cursor |
| Excluir Linha | Remover linha atual |
| Excluir Coluna | Remover coluna atual |
| Excluir Tabela | Remover tabela inteira |
| Alinhar Coluna à Esquerda/Centro/Direita | Definir alinhamento para a coluna atual |
| Alinhar Todas à Esquerda/Centro/Direita | Definir alinhamento para todas as colunas |
| Formatar Tabela | Alinhar automaticamente as colunas da tabela (embelezar markdown) |
| Ajustar à largura / Largura natural | Apenas no WYSIWYG: fixar esta tabela na largura do editor com colunas proporcionais ao conteúdo, ou devolvê-la à sua largura natural |

## Popup de Verificação Ortográfica

Corrija erros de ortografia com sugestões.

**Ativação:**
- Clique com o botão direito na palavra com erro de ortografia (sublinhado vermelho)

**Ações:**
- **Sugestões** — Clique para substituir pela sugestão
- **Adicionar ao Dicionário** — Parar de marcar como erro ortográfico

## Movendo Texto ao Arrastar

No modo WYSIWYG você pode mover uma seleção com o mouse: pressione sobre o texto selecionado, arraste — um cursor de soltura mostra onde ele vai parar — e solte. A movimentação é uma única etapa que pode ser desfeita (`Mod + Z` a reverte). Pressione `Escape` durante o arraste, ou deixe a janela perder o foco, para cancelar. O VMark implementa isso por conta própria porque o shell de desktop intercepta os eventos nativos de arrastar do navegador, e por isso é um gesto de mouse e não o arrastar e soltar do sistema.

## Comparação de Modos

| Elemento | Edição WYSIWYG | Fonte |
|----------|----------------|-------|
| Link | Clique / `Mod+K` / `Cmd+Clique` para abrir | Clique / `Mod+K` / `Cmd+Clique` para abrir |
| Imagem | Duplo clique | Clique em `![](path)` |
| Vídeo | Duplo clique | — |
| Áudio | Duplo clique | — |
| Matemática | Clique | Cursor na matemática → popup |
| Rodapé | Passar mouse | Edição direta |
| Link Wiki | Passar mouse | Clique |
| Tabela | Barra de ferramentas | Menu de contexto |
| Verificação Ortográfica | Clique direito | Clique direito |

## Dicas de Navegação em Popups

### Fluxo de Foco
1. O popup abre com o primeiro campo em foco
2. `Tab` avança pelos campos e botões
3. `Shift + Tab` volta
4. O foco envolve dentro do popup

### Edição Rápida
- Para alterações simples de URL: edite e pressione `Enter`
- Para cancelar: pressione `Escape` em qualquer campo
- Para conteúdo de múltiplas linhas (rodapés, matemática): use `Mod + Enter` para salvar

### Comportamento do Mouse
- Clique fora do popup para fechar. O comportamento padrão é **descartar**
  as alterações não salvas; o popup de matemática é uma exceção e **confirma** a edição
  ao clicar fora (veja a seção [Popup de Matemática](#popup-de-matematica)).
- Popups de hover (rodapé, wiki) têm atraso de 300ms antes de aparecerem
- Mover o mouse de volta para o popup mantém-no aberto

<!-- Styles in style.css -->
