# Configurações

O painel de configurações do VMark permite personalizar todos os aspectos do editor. Abra-o com `Mod + ,` ou via **VMark > Configurações** na barra de menus.

A janela de configurações tem uma barra lateral com seções agrupadas por tópico — as seções mais usadas aparecem primeiro, com Sobre e Avançado no final. As alterações têm efeito imediato — não há botão de salvar.

## Aparência

Controla o tema visual e o comportamento da janela.

### Tema

Escolha um dos cinco temas de cores. O tema ativo é indicado por um anel ao redor de sua amostra.

| Tema | Fundo | Estilo |
|------|-------|--------|
| White | `#FFFFFF` | Limpo, alto contraste |
| Paper | `#EEEDED` | Neutro quente (padrão) |
| Mint | `#CCE6D0` | Verde suave, descansado para os olhos |
| Sepia | `#F9F0DB` | Amarelado quente, estilo livro |
| Night | `#23262B` | Modo escuro |

### Idioma

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Idioma | Altera o idioma da interface para menus, rótulos e mensagens. Tem efeito imediato | English | English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Italiano, Português (Brasil) |

### Janela

| Configuração | Descrição | Padrão |
|-------------|-----------|--------|
| Mostrar nome do arquivo na barra de título | Exibir o nome do arquivo atual na barra de título da janela macOS | Desligado |
| Ocultar barra de status automaticamente | Ocultar automaticamente a barra de status quando não estiver interagindo com ela | Desligado |

## Editor

Tipografia, exibição, comportamento de edição e configurações de espaço em branco.

### Tipografia

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Fonte Latina | Família de fontes para texto latino (inglês) | Padrão do Sistema | Padrão do Sistema, Athelas, Palatino, Georgia, Charter, Literata |
| Fonte CJK | Família de fontes para texto em Chinês, Japonês, Coreano | Padrão do Sistema | Padrão do Sistema, PingFang SC, Songti SC, Kaiti SC, Noto Serif CJK, Source Han Sans |
| Fonte Mono | Família de fontes para código e texto monoespaçado | Padrão do Sistema | Padrão do Sistema, SF Mono, Monaco, Menlo, Consolas, JetBrains Mono, Fira Code, SauceCodePro NFM, IBM Plex Mono, Hack, Inconsolata |
| Tamanho da Fonte | Tamanho de fonte base para o conteúdo do editor | 18px | 14px, 16px, 18px, 20px, 22px |
| Altura de Linha | Espaçamento vertical entre linhas | 1.8 (Relaxado) | 1.4 (Compacto), 1.6 (Normal), 1.8 (Relaxado), 2.0 (Espaçoso), 2.2 (Extra) |
| Espaçamento de Bloco | Espaço visual entre elementos de bloco (títulos, parágrafos, listas) medido em múltiplos da altura da linha | 1x (Normal) | 0.5x (Apertado), 1x (Normal), 1.5x (Relaxado), 2x (Espaçoso) |
| Espaçamento entre Letras CJK | Espaçamento extra entre caracteres CJK, em unidades em | Desligado | Desligado, 0.02em (Sutil), 0.03em (Leve), 0.05em (Normal), 0.08em (Amplo), 0.10em (Mais Amplo), 0.12em (Extra) |

### Exibição

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Largura do Editor | Largura máxima do conteúdo. Valores maiores são adequados para monitores grandes; valores menores melhoram a legibilidade | 50em (Médio) | 36em (Compacto), 42em (Estreito), 50em (Médio), 60em (Largo), 80em (Extra Largo), Ilimitado |

::: tip
50em com tamanho de fonte 18px é aproximadamente 900px — uma largura de leitura confortável para a maioria dos monitores.
:::

### Comportamento

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Tamanho do Tab | Número de espaços inseridos ao pressionar Tab | 2 espaços | 2 espaços, 4 espaços |
| Habilitar auto-emparelhamento | Inserir automaticamente o parêntese/aspa de fechamento correspondente ao digitar um de abertura | Ligado | Ligado / Desligado |
| Parênteses CJK | Auto-emparelhar parênteses específicos do CJK como `「」` `【】` `《》`. Disponível apenas quando o auto-emparelhamento estiver habilitado | Auto | Desligado, Auto |
| Incluir aspas curvas | Auto-emparelhar os caracteres `""` e `''`. Pode conflitar com alguns recursos de aspas inteligentes do IME. Aparece quando os parênteses CJK estão definidos como Auto | Ligado | Ligado / Desligado |
| Também emparelhar `"` | Digitar as aspas duplas direitas `"` também insere um par `""`. Útil quando o IME alterna entre aspas de abertura e fechamento. Aparece quando as aspas curvas estão habilitadas | Desligado | Ligado / Desligado |
| Formato de cópia | Qual formato usar para o slot de área de transferência de texto simples ao copiar do modo WYSIWYG | Texto simples | Texto simples, Markdown |
| Copiar ao selecionar | Copiar automaticamente o texto para a área de transferência sempre que você o selecionar | Desligado | Ligado / Desligado |

### Espaço em Branco

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Fim de linha ao salvar | Controlar como os fins de linha são tratados ao salvar arquivos | Preservar existente | Preservar existente, LF (`\n`), CRLF (`\r\n`) |
| Preservar quebras de linha consecutivas | Manter múltiplas linhas em branco como estão em vez de colapsá-las | Desligado | Ligado / Desligado |
| Estilo de quebra rígida ao salvar | Como as quebras de linha rígidas são representadas no arquivo Markdown salvo | Preservar existente | Dois espaços (Recomendado), Preservar existente, Barra invertida (`\`) |
| Mostrar tags `<br>` | Exibir tags de quebra de linha HTML visivelmente no editor | Desligado | Ligado / Desligado |

::: tip
Dois espaços é o estilo de quebra rígida mais compatível — funciona no GitHub, GitLab e todos os principais renderizadores de Markdown. O estilo de barra invertida pode falhar no Reddit, Jekyll e alguns parsers mais antigos.
:::

## Markdown

Configurações de comportamento ao colar, layout e renderização HTML.

### Colar e Entrada

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Habilitar regex na pesquisa | Mostrar um botão de alternância de regex na barra de Localizar e Substituir | Ligado | Ligado / Desligado |
| Modo de colar | Como o VMark roteia o conteúdo da área de transferência | Smart | Smart, Plain |
| Colar Markdown no WYSIWYG | Ao colar texto que parece Markdown no editor WYSIWYG, convertê-lo automaticamente em conteúdo rico | Auto | Auto, Desligado |

### Layout

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Tamanho de fonte do elemento de bloco | Tamanho relativo de fonte para listas, citações, tabelas, alertas e blocos de detalhes | 100% | 100%, 95%, 90%, 85% |
| Alinhamento de título | Alinhamento de texto para títulos | Esquerda | Esquerda, Centro |
| Bordas de imagens e diagramas | Se mostrar uma borda ao redor de imagens, diagramas Mermaid e blocos matemáticos | Nenhuma | Nenhuma, Sempre, Ao passar o mouse |
| Alinhamento de imagens e tabelas | Alinhamento horizontal para imagens de bloco e tabelas | Centro | Centro, Esquerda |

### Lint

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Habilitar markdown lint | Verificar problemas comuns de markdown (links quebrados, texto alt ausente, incrementos de títulos, blocos de código não fechados, etc.) | Ligado | Ligado / Desligado |

Veja [Lint de Markdown](/pt-BR/guide/lint) para a lista completa de regras e níveis de severidade.

### Renderização HTML

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| HTML bruto em texto rico | Controlar se os blocos HTML brutos são renderizados no modo WYSIWYG | Oculto | Oculto, Sanitizado, Sanitizado + estilos |

::: tip
**Oculto** é a opção mais segura — blocos HTML brutos são colapsados e não renderizados. **Sanitizado** renderiza HTML com tags perigosas removidas. **Sanitizado + estilos** também preserva atributos `style` inline.
:::

## Arquivos e Imagens

Navegador de arquivos, salvamento, histórico de documentos, tratamento de imagens e ferramentas de documento.

### Navegador de Arquivos

Essas configurações só se aplicam quando uma área de trabalho (pasta) estiver aberta.

| Configuração | Descrição | Padrão |
|-------------|-----------|--------|
| Mostrar arquivos ocultos | Incluir dotfiles e itens ocultos do sistema no painel lateral do explorador de arquivos | Desligado |
| Mostrar todos os arquivos | Mostrar arquivos que não são markdown no explorador de arquivos. Arquivos não markdown abrem com o aplicativo padrão do sistema | Desligado |

### Comportamento ao Sair

| Configuração | Descrição | Padrão |
|-------------|-----------|--------|
| Confirmar saída | Exigir pressionar `Cmd+Q` (ou `Ctrl+Q`) duas vezes para sair, evitando saídas acidentais | Ligado |

### Salvamento

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Habilitar salvamento automático | Salvar arquivos automaticamente após a edição | Ligado | Ligado / Desligado |
| Intervalo de salvamento | Tempo entre salvamentos automáticos. Disponível apenas quando o salvamento automático estiver habilitado | 30 segundos | 10s, 30s, 1 min, 2 min, 5 min |
| Manter histórico de documentos | Rastrear versões de documentos para desfazer e recuperação | Ligado | Ligado / Desligado |
| Máximo de versões | Número de instantâneos de histórico a manter por documento | 50 versões | 10, 25, 50, 100 |
| Manter versões por | Idade máxima dos instantâneos de histórico antes de serem removidos | 7 dias | 1 dia, 7 dias, 14 dias, 30 dias |
| Janela de mesclagem | Salvamentos automáticos consecutivos dentro desta janela se consolidam em um único instantâneo, reduzindo o ruído de armazenamento | 30 segundos | Desligado, 10s, 30s, 1 min, 2 min |
| Tamanho máximo de arquivo para histórico | Pular instantâneos de histórico para arquivos maiores que este limite | 512 KB | 256 KB, 512 KB, 1 MB, 5 MB, Ilimitado |

### Imagens

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Redimensionar automaticamente ao colar | Redimensionar automaticamente imagens grandes antes de salvar na pasta de ativos. O valor é a dimensão máxima em pixels | Desligado | Desligado, 800px, 1200px, 1920px (Full HD), 2560px (2K) |
| Copiar para pasta de ativos | Copiar imagens coladas ou arrastadas para a pasta de ativos do documento em vez de incorporá-las | Ligado | Ligado / Desligado |
| Limpar imagens não utilizadas ao fechar | Excluir automaticamente imagens da pasta de ativos que não são mais referenciadas no documento ao fechá-lo | Desligado | Ligado / Desligado |
| Limite de imagem inline | Tamanho máximo (MB) para incorporar imagens como URLs de dados base64 na exportação HTML/PDF. Arquivos maiores são vinculados | 1.0 MB | 0.1 – 10 MB |

### Arquivos grandes

| Configuração | Descrição | Padrão | Opções |
|--------------|-----------|--------|--------|
| Avisar acima do tamanho | Mostrar uma confirmação ao abrir arquivos acima deste tamanho | 5 MB | Ligado / Desligado |
| Modo Fonte automático | Abrir automaticamente arquivos acima do limite no modo Fonte (pula o WYSIWYG para manter o desempenho fluido) | Ligado | Ligado / Desligado |

Veja [Large Files](/guide/large-files) para a explicação completa de como arquivos grandes são tratados.

### Atualizações

| Configuração | Descrição | Padrão | Opções |
|--------------|-----------|--------|--------|
| Frequência de verificação | Quando verificar novas versões do VMark | Na inicialização | Na inicialização, Diariamente, Semanalmente, Manual |
| Baixar atualizações automaticamente | Baixar artefatos de versão em segundo plano assim que uma atualização é detectada | Desligado | Ligado / Desligado |
| Pular uma versão | Suprime o aviso de atualização para uma versão específica (definido por atualização a partir do próprio aviso) | Nenhuma | — |

::: tip
Habilite **Redimensionar automaticamente ao colar** se você frequentemente cola capturas de tela ou fotos — isso mantém a pasta de ativos leve sem redimensionamento manual.
:::

### Ferramentas de Documento

O VMark detecta o [Pandoc](https://pandoc.org) para habilitar a exportação para formatos adicionais (DOCX, EPUB, LaTeX e mais). Clique em **Detectar** para procurar o Pandoc no seu sistema. Se encontrado, sua versão e caminho são exibidos.

Veja [Exportar e Imprimir](/pt-BR/guide/export) para detalhes sobre todas as opções de exportação.

## Integrações

Configuração do servidor MCP e provedor de IA.

### Servidor MCP

O servidor MCP (Model Context Protocol) permite que assistentes de IA externos como Claude Code e Cursor controlem o VMark programaticamente.

| Configuração | Descrição | Padrão |
|-------------|-----------|--------|
| Habilitar Servidor MCP | Iniciar ou parar o servidor MCP. Quando em execução, um emblema de status mostra a porta e os clientes conectados | Ligado (alternável) |
| Iniciar ao abrir | Iniciar automaticamente o servidor MCP quando o VMark abrir | Ligado |
| Aprovar edições automaticamente | Aplicar alterações de documentos iniciadas por IA sem mostrar uma prévia para aprovação primeiro. Use com cautela | Desligado |

Quando o servidor estiver em execução, o painel também exibe:
- **Porta** — atribuída automaticamente; os clientes de IA a descobrem através do arquivo de configuração
- **Versão** — versão do sidecar do servidor MCP
- **Ferramentas / Recursos** — número de ferramentas e recursos MCP disponíveis
- **Clientes Conectados** — número de clientes de IA atualmente conectados

Abaixo da seção Servidor MCP, você pode instalar a configuração MCP do VMark em clientes de IA suportados (Claude Desktop, Claude Code, Codex CLI, Gemini CLI) com um único clique.

Veja [Configuração MCP](/pt-BR/guide/mcp-setup) e [Referência de Ferramentas MCP](/pt-BR/guide/mcp-tools) para detalhes completos.

### Provedores de IA

Configure qual provedor de IA alimenta os [Gênios de IA](/pt-BR/guide/ai-genies). Apenas um provedor pode estar ativo por vez.

**Provedores CLI** — Use ferramentas CLI de IA instaladas localmente (Claude, Codex, Gemini). Clique em **Detectar** para verificar seu `$PATH` em busca de CLIs disponíveis. Os provedores CLI usam seu plano de assinatura e não requerem chave de API.

**Provedores REST API** — Conecte-se diretamente a APIs de nuvem (Anthropic, OpenAI, Google AI, Ollama API). Cada um requer um endpoint, chave de API e nome de modelo.

Veja [Provedores de IA](/pt-BR/guide/ai-providers) para instruções de configuração detalhadas para cada provedor.

## Formatos

Alternâncias de adesão para adaptadores de formato não padrão, além do comando de editor externo explícito para o escape de abas de código somente leitura.

Markdown, texto simples e YAML/YML estão **sempre** registrados — os padrões tranquilos. Todos os outros adaptadores estão **desativados por padrão** para que usuários existentes não sejam surpreendidos na atualização. Ative uma alternância e o registro é reconstruído no lugar; as abas abertas remontam com o adaptador correto, sem necessidade de reinicialização.

Para a lista completa de formatos e suas prévias, veja [Formatos Suportados](/pt-BR/guide/formats).

### Suporte a formatos

| Alternância | Padrão | Habilita |
|---|---|---|
| **Formatos de dados** | Desligado | `.json`, `.jsonl`, `.toml` — painel dividido com fonte + árvore navegável. Prévias com reconhecimento de esquema para `Cargo.toml`, `package.json`, `pyproject.toml`. |
| **Diagramas e SVG** | Desligado | `.mmd` (Mermaid) e `.svg` — painel dividido com fonte + renderização ao vivo sanitizada. |
| **Prévia HTML** | Desligado | `.html` e `.htm` — prévia em iframe com sandbox (`sandbox=""` com lista de permissões vazia, DOMPurify, CSP `<meta>`). Verificado com o top-20 do OWASP — veja [Modelo de segurança para HTML](/pt-BR/guide/formats#modelo-de-seguranca-para-html). |
| **Visualizadores de código** | Desligado | 12 visualizadores somente leitura (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua`). Abrem em um visualizador com realce de sintaxe e botões **Habilitar edição** e **Abrir no editor externo**. |

Quando uma categoria está desativada, as extensões correspondentes recaem no fallback de texto simples para que o arquivo ainda abra — apenas sem a visualização de esquema.

### Editor externo

Para o botão **Abrir no editor externo** em abas de código somente leitura, escolha o editor que deve ser iniciado. Um bundle de app (ex.: `/Applications/Visual Studio Code.app`) ou um executável.

A configuração da interface substitui qualquer variável de ambiente — explícito prevalece sobre implícito. Deixe vazio para usar a cadeia de fallback de variáveis de ambiente `$VMARK_EXTERNAL_EDITOR → $VISUAL → $EDITOR → padrão da plataforma`. Veja [Abrir no editor externo](/pt-BR/guide/formats#abrir-no-editor-externo) para a ordem de resolução completa e a barreira de segurança.

### Notificação única de atualização

Na primeira execução após atualizar para o suporte a múltiplos formatos, o VMark exibe uma notificação não bloqueante apontando para **Configurações → Formatos**. A notificação é exibida uma única vez por instalação — após ser mostrada (ou dispensada), nunca reaparece.

## Idioma

Regras de formatação CJK (Chinês, Japonês, Coreano). Essas regras são aplicadas quando você executa **Formatar → Formatar Seleção CJK** (`Cmd+Shift+F`) sobre uma seleção, ou **Formatar → Formatar Documento CJK** (`Alt+Cmd+Shift+F`) sobre o arquivo inteiro.

::: tip
A seção Idioma contém mais de 20 alternâncias de formatação refinadas. Para uma explicação completa de cada regra com exemplos, veja [Formatação CJK](/pt-BR/guide/cjk-formatting).
:::

### Normalização de Largura Total

| Configuração | Descrição | Padrão |
|-------------|-----------|--------|
| Converter letras/números de largura total | Converter caracteres alfanuméricos de largura total para meia largura (ex: `ＡＢＣ` para `ABC`) | Ligado |
| Normalizar largura de pontuação | Converter vírgulas e pontos de largura total para meia largura quando entre caracteres CJK | Ligado |
| Converter parênteses | Converter parênteses de largura total para meia largura quando o conteúdo é CJK | Ligado |
| Converter colchetes | Converter colchetes de meia largura para largura total `【】` quando o conteúdo é CJK | Desligado |

### Espaçamento

| Configuração | Descrição | Padrão |
|-------------|-----------|--------|
| Adicionar espaçamento CJK-Inglês | Inserir um espaço entre caracteres CJK e latinos | Ligado |
| Adicionar espaçamento CJK-parênteses | Inserir um espaço entre caracteres CJK e parênteses | Ligado |
| Remover espaçamento de moeda | Remover espaço extra após símbolos de moeda (ex: `$ 100` vira `$100`) | Ligado |
| Remover espaçamento de barra | Remover espaços ao redor de barras (ex: `A / B` vira `A/B`), preservando URLs | Ligado |
| Colapsar múltiplos espaços | Reduzir múltiplos espaços consecutivos para um único espaço | Ligado |

### Travessão e Aspas

| Configuração | Descrição | Padrão |
|-------------|-----------|--------|
| Converter travessões | Converter hífens duplos (`--`) em travessões (`——`) entre caracteres CJK | Ligado |
| Corrigir espaçamento de travessão | Garantir espaçamento adequado ao redor de travessões | Ligado |
| Converter aspas retas | Converter `"` e `'` retos em aspas inteligentes (curvas) | Ligado |
| Estilo de aspas | Estilo alvo para conversão de aspas inteligentes | Curvas `""` `''` |
| Corrigir espaçamento de aspas duplas | Normalizar espaçamento ao redor de aspas duplas | Ligado |
| Corrigir espaçamento de aspas simples | Normalizar espaçamento ao redor de aspas simples | Ligado |
| Aspas de canto CJK | Converter aspas curvas em colchetes de canto `「」` para texto em Chinês Tradicional e Japonês. Disponível apenas quando o estilo de aspas é Curvas | Desligado |
| Aspas de canto aninhadas | Converter aspas simples aninhadas em `『』` dentro de `「」` | Desligado |

### Limpeza

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Limitar pontuação consecutiva | Limitar marcas de pontuação repetidas como `!!!` | Desligado | Desligado, Único (`!!` para `!`), Duplo (`!!!` para `!!`) |
| Remover espaços no final | Remover espaços no final das linhas | Ligado | Ligado / Desligado |
| Normalizar reticências | Converter pontos espaçados (`. . .`) em reticências adequadas (`...`) | Ligado | Ligado / Desligado |
| Colapsar novas linhas | Reduzir três ou mais novas linhas consecutivas para duas | Ligado | Ligado / Desligado |

## Atalhos

Visualize e personalize todos os atalhos de teclado. Os atalhos são agrupados por categoria (Arquivo, Editar, Visualizar, Formatar, etc.).

- **Pesquisar** — Filtrar atalhos por nome, categoria ou combinação de teclas
- **Clicar em um atalho** para alterar sua vinculação de tecla. Pressione a nova combinação e confirme
- **Redefinir** — Restaurar um atalho individual para seu padrão ou redefinir todos de uma vez
- **Exportar / Importar** — Salvar suas vinculações personalizadas como arquivo JSON e importá-las em outra máquina

Veja [Atalhos de Teclado](/pt-BR/guide/shortcuts) para a referência completa de atalhos padrão.

## Terminal

Configure o painel de terminal integrado. Abra o terminal com `` Ctrl + ` ``.

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Shell | Qual shell usar. Requer reinício do terminal para ter efeito | Padrão do Sistema | Shells detectados automaticamente no seu sistema (ex: zsh, bash, fish) |
| Posição do Painel | Onde colocar o painel do terminal | Auto | Auto (baseado na proporção da janela), Embaixo, Direita |
| Tamanho do Painel | Proporção do espaço disponível que o terminal ocupa. Arrastar para redimensionar o painel também atualiza este valor | 40% | 10% a 80% |
| Tamanho da Fonte | Tamanho do texto no terminal | 13px | 10px a 24px |
| Altura de Linha | Espaçamento vertical entre linhas do terminal | 1.2 (Compacto) | 1.0 (Apertado) a 2.0 (Extra) |
| Estilo do Cursor | Forma do cursor do terminal | Barra | Barra, Bloco, Sublinhado |
| Cursor Piscante | Se o cursor do terminal pisca | Ligado | Ligado / Desligado |
| Copiar ao Selecionar | Copiar automaticamente o texto do terminal selecionado para a área de transferência | Desligado | Ligado / Desligado |
| Renderizador WebGL | Usar renderização acelerada por GPU para o terminal. Desabilite se tiver problemas de entrada IME. Requer reinício do terminal | Ligado | Ligado / Desligado |

Veja [Terminal Integrado](/pt-BR/guide/terminal) para mais sobre sessões, atalhos de teclado e ambiente de shell.

## Sobre

Exibe a versão do aplicativo, links para o site e repositório GitHub e gerenciamento de atualizações.

### Atualizações

| Configuração | Descrição | Padrão |
|-------------|-----------|--------|
| Atualizações automáticas | Verificar atualizações automaticamente na inicialização | Ligado |
| Verificar Agora | Acionar manualmente uma verificação de atualização | — |

Quando uma atualização estiver disponível, um cartão aparece mostrando o novo número de versão, data de lançamento e notas de versão. Você pode **Baixar** a atualização, **Pular** esta versão ou — uma vez baixada — **Reiniciar para Atualizar**.

## Avançado

::: tip
A seção Avançado está oculta por padrão. Pressione `Ctrl + Option + Cmd + D` na janela de Configurações para revelá-la.
:::

Configuração para desenvolvedores e em nível de sistema.

### Protocolos de Link

| Configuração | Descrição | Padrão |
|-------------|-----------|--------|
| Protocolos de link personalizados | Protocolos de URL adicionais que o VMark deve reconhecer ao inserir links. Insira cada protocolo como uma tag | `obsidian`, `vscode`, `dict`, `x-dictionary` |

Isso permite criar links como `obsidian://open?vault=...` ou `vscode://file/...` que o VMark tratará como URLs válidas.

### Desempenho

| Configuração | Descrição | Padrão |
|-------------|-----------|--------|
| Manter ambos os editores ativos | Montar os editores dos modos WYSIWYG e Fonte simultaneamente para alternância mais rápida entre modos. Aumenta o uso de memória | Desligado |

### Motor de workflow

| Configuração | Descrição | Padrão | Opções |
|--------------|-----------|--------|--------|
| Motor de workflow | Habilita o visualizador/editor de workflow do GitHub Actions para arquivos `.yml`/`.yaml` em `.github/workflows/`. Quando desligado, esses arquivos abrem como YAML simples | Desligado | Ligado / Desligado |
| Preservar formatação YAML | Ao salvar edições de workflow feitas pelo painel de formulário, preservar comentários, âncoras, ordem de chaves e linhas em branco do YAML original via o pipeline de ida e volta da CST. Quando desligado, o salvamento usa um serializador compacto (mais rápido, mas com perda) | Ligado | Ligado / Desligado |

Veja [Workflow Viewer](/guide/workflow-viewer) para a superfície completa de recursos.

### Específico da plataforma

| Configuração | Descrição | Padrão | Plataformas |
|--------------|-----------|--------|-------------|
| Limpar quarentena macOS ao abrir | Ao abrir um arquivo que carrega o atributo de quarentena do macOS (`com.apple.quarantine`), removê-lo antes da leitura. Útil para arquivos baixados da web que o VMark não conseguiria abrir | Ligado | macOS |
| Tecla Option do Mac como Meta (terminal) | Tratar a tecla Option do macOS como Meta no terminal integrado. Necessária para ferramentas como emacs e tmux que esperam atalhos prefixados com Alt | Desligado | macOS |

### Ferramentas de Desenvolvedor

Quando as **Ferramentas de desenvolvedor** estão ativadas, um painel **Hot Exit Dev Tools** aparece com botões para testar captura de sessão, inspeção, restauração, limpeza e reinicialização — útil para depurar o comportamento de hot exit durante o desenvolvimento.

## Veja Também

- [Recursos](/pt-BR/guide/features) — Visão geral das capacidades do VMark
- [Atalhos de Teclado](/pt-BR/guide/shortcuts) — Referência completa de atalhos
- [Formatação CJK](/pt-BR/guide/cjk-formatting) — Regras detalhadas de formatação CJK
- [Terminal Integrado](/pt-BR/guide/terminal) — Sessões de terminal e uso
- [Provedores de IA](/pt-BR/guide/ai-providers) — Guia de configuração de provedores de IA
- [Configuração MCP](/pt-BR/guide/mcp-setup) — Configuração do servidor MCP para assistentes de IA
