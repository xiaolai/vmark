# Configurações

O painel de configurações do VMark permite personalizar todos os aspectos do editor. Abra-o com `Mod + ,` ou via **VMark > Configurações** na barra de menus.

A janela de configurações tem uma barra lateral que lista as seções em ordem alfabética (pelos nomes em inglês), com Sobre no final e Avançado abaixo dela quando exibida. As alterações têm efeito imediato — não há botão de salvar.

Use a **caixa de pesquisa** no topo da barra lateral para filtrar as configurações de todos os painéis por nome ou descrição — as linhas correspondentes são agrupadas, então você não precisa saber em qual categoria uma configuração está. Para restaurar tudo aos padrões de fábrica, use **Redefinir para os padrões** na seção Sobre.

## Aparência

Controla o tema visual e o comportamento da janela.

### Tema

Escolha um dos seis temas de cores. O tema ativo é indicado por um anel ao redor de sua amostra.

| Tema | Fundo | Estilo |
|------|-------|--------|
| White | `#FFFFFF` | Branco limpo, o maior contraste |
| Paper | `#EEEDED` | Papel de jornal quente, o padrão |
| Mint | `#CCE6D0` | Verde suave, descansado para os olhos |
| Sepia | `#F9F0DB` | Papel de livro, para leituras longas |
| Night | `#23262B` | Ardósia escura para pouca luz |
| Solarized | `#002B36` | Solarized Dark, a paleta clássica |

::: info Windows 10 e Linux oferecem apenas White e Night
No Windows 10 e no Linux é o sistema que desenha a barra de título, e ela só pode ser clara ou escura. Por isso essas plataformas oferecem apenas **White** e **Night**, e um tema que não combina com a interface do sistema é exibido como o mais próximo dos dois: Paper, Mint e Sepia aparecem como White, Solarized como Night. Sua escolha salva não é alterada — no macOS e no Windows 11 o catálogo completo está disponível. No Windows 11 a barra de título assume as cores do próprio tema; a barra de menus continua sendo desenhada clara ou escura.
:::

#### Seguir a aparência do sistema

| Configuração | Descrição | Padrão |
|-------------|-----------|--------|
| Seguir a aparência do sistema | Alterna automaticamente entre os seus temas claro e escuro conforme o sistema | Desligado |

Quando ativada, a linha única de tema é substituída por duas linhas — **Tema claro** (usado enquanto o sistema está no modo claro, padrão Paper) e **Tema escuro** (usado no modo escuro, padrão Night). O VMark alterna entre eles no momento em que a aparência do sistema muda; sua escolha manual de tema é mantida e restaurada quando você desativa a opção.

### Barra lateral

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Estilo da barra lateral | Como a barra lateral e o trilho de espaços de trabalho são enquadrados. **Altura total** os encosta na borda da janela com um divisor fino, como as barras laterais do próprio macOS; **Cartão** os faz flutuar dentro da janela com cantos arredondados e sombra. Vale também para a janela de Configurações | Altura total | Altura total, Cartão |

### Janela

| Configuração | Descrição | Padrão |
|-------------|-----------|--------|
| Mostrar nome do arquivo na barra de título | Exibir o nome do arquivo atual na barra de título da janela do macOS. **Somente macOS** — esta configuração fica oculta nas outras plataformas, porque o Windows e o Linux sempre mostram o nome do arquivo na barra de título do sistema | Desligado |

No macOS, o VMark desenha a sua própria barra de título sobre a do sistema, então
o nome do arquivo é um elemento opcional dessa faixa. No Windows e no Linux o
sistema desenha uma barra de título real acima da janela: o nome do arquivo (com
um `•` enquanto houver alterações não salvas) sempre aparece ali, e o VMark não
acrescenta nenhuma faixa de título própria.

### Modo de foco

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Nível de escurecimento | Quão intensamente o conteúdo fora de foco é escurecido no Modo de foco. **Padrão** mantém o escurecimento apenas por cor; **Forte** e **Mais forte** acrescentam uma opacidade progressivamente menor por cima | Padrão | Padrão, Forte, Mais forte |

## Editor

Tipografia, exibição, comportamento de edição, espaço em branco e configurações de arquivos grandes.

### Tipografia

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Fonte Latina | Família de fontes para texto latino (inglês) | Padrão do Sistema | Padrão do Sistema, Athelas, Palatino, Georgia, Charter, Literata — além de qualquer fonte instalada |
| Fonte CJK | Família de fontes para texto em Chinês, Japonês, Coreano | Padrão do Sistema | Padrão do Sistema, PingFang SC, Songti SC, Kaiti SC, Noto Serif CJK, Source Han Sans — além de qualquer fonte instalada |
| Fonte Mono | Família de fontes para código e texto monoespaçado — também usada pelo terminal integrado | Padrão do Sistema | Padrão do Sistema, SF Mono, Monaco, Menlo, Consolas, DejaVu Sans Mono, Liberation Mono, Ubuntu Mono, Noto Sans Mono, Noto Sans Mono CJK SC, JetBrains Mono, Fira Code, SauceCodePro NFM, IBM Plex Mono, Hack, Inconsolata — além de qualquer fonte instalada |
| Tamanho da Fonte | Tamanho de fonte base para o conteúdo do editor | 18px | 14px, 16px, 18px, 20px, 22px |
| Altura de Linha | Espaçamento vertical entre linhas | 1.8 (Relaxado) | 1.4 (Compacto), 1.6 (Normal), 1.8 (Relaxado), 2.0 (Espaçoso), 2.2 (Extra) |
| Espaçamento de Bloco | Espaço visual entre elementos de bloco (títulos, parágrafos, listas) medido em múltiplos da altura da linha | 1x (Normal) | 0.5x (Apertado), 1x (Normal), 1.5x (Relaxado), 2x (Espaçoso) |
| Espaçamento entre Letras CJK | Espaçamento extra entre caracteres CJK, em unidades em | Desligado | Desligado, 0.02em (Sutil), 0.03em (Leve), 0.05em (Normal), 0.08em (Amplo), 0.10em (Mais Amplo), 0.12em (Extra) |

#### Usando uma fonte que você mesmo instalou

Os nomes listados acima são uma lista curta, não o limite. Cada um dos três
seletores de fonte também traz uma seção **Fontes instaladas** que lista todas as
famílias de fonte da máquina, então uma fonte que você instalou — LXGW WenKai,
Iosevka, Source Han Serif — é escolhida da mesma forma que as integradas.

Escolha **Personalizada…** no fim da lista para digitar um nome de família. Use o
nome exatamente como o sistema o informa (macOS: Catálogo de Fontes; Windows:
Configurações → Personalização → Fontes) — para LXGW WenKai / 霞鹜文楷 é
`LXGW WenKai`. A fonte é aplicada assim que o nome está completo; se nada mudar,
o nome não corresponde a uma família instalada. Um nome que contenha aspas,
vírgulas, ponto e vírgula ou parênteses é recusado, e a linha avisa.

::: tip Fontes instaladas é exclusivo do macOS
O macOS lista todas as famílias instaladas para você. No Windows e no Linux a
seção fica vazia e **Personalizada…** é o caminho — digitar o nome da família
funciona da mesma forma nas três plataformas.
:::

A escolha vale também para a exportação em PDF, que renderiza com o mesmo motor e
as mesmas fontes. A exportação HTML não consegue incluir uma fonte da sua
máquina, então uma página exportada recorre às fontes do próprio leitor, a menos
que ele tenha a mesma família instalada.

### Exibição

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Largura do Editor | Largura máxima do conteúdo. Valores maiores são adequados para monitores grandes; valores menores melhoram a legibilidade | 50em (Médio) | 36em (Compacto), 42em (Estreito), 50em (Médio), 60em (Largo), 80em (Extra Largo), Ilimitado |

::: tip A mesma largura se lê de forma diferente em latim e em CJK
A Largura do Editor é medida em `em`, então o comprimento da linha em *caracteres* depende do sistema de escrita: com 50em uma linha latina comporta cerca de 90–100 caracteres (cerca de 2× a medida tipográfica de 45–75 caracteres, o que convém a um editor de dois painéis), enquanto uma linha CJK comporta cerca de 50 caracteres de largura total — bem dentro da faixa tradicional de 40–60 para texto chinês. Se você escreve principalmente prosa em alfabeto latino e quer uma medida de livro, escolha 36–42em; para documentos principalmente em CJK, o padrão já é a medida clássica.
:::

::: tip
50em com tamanho de fonte 18px é aproximadamente 900px — uma largura de leitura confortável para a maioria dos monitores.
:::

### Comportamento

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Tamanho do Tab | Número de espaços inseridos ao pressionar Tab | 2 espaços | 2 espaços, 4 espaços |
| Abrir arquivos em uma nova aba | Abrir arquivos existentes em uma nova aba em vez de reutilizar a aba vazia atual | Desligado | Ligado / Desligado |
| Habilitar auto-emparelhamento | Inserir automaticamente o parêntese/aspa de fechamento correspondente ao digitar um de abertura | Ligado | Ligado / Desligado |
| Parênteses CJK | Auto-emparelhar parênteses específicos do CJK como `「」` `【】` `《》`. Disponível apenas quando o auto-emparelhamento estiver habilitado | Auto | Desligado, Auto |
| Incluir aspas curvas | Auto-emparelhar `“”` e `‘’`, e transformar um `"` ou `'` reto digitado em um par curvo. Pode conflitar com alguns recursos de aspas inteligentes do IME. Aparece quando os parênteses CJK estão definidos como Auto | Ligado | Ligado / Desligado |
| Também emparelhar `"` | Digitar as aspas duplas direitas `"` também insere um par `""`. Útil quando o IME alterna entre aspas de abertura e fechamento. Aparece quando as aspas curvas estão habilitadas | Desligado | Ligado / Desligado |
| Formato de cópia | Qual formato usar para o slot de área de transferência de texto simples ao copiar do modo WYSIWYG | Texto simples | Texto simples, Markdown |
| Copiar ao selecionar | Copiar automaticamente o texto para a área de transferência sempre que você o selecionar | Desligado | Ligado / Desligado |

### Espaço em Branco

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Fim de linha ao salvar | Controlar como os fins de linha são tratados ao salvar arquivos | Preservar existente | Preservar existente, LF (`\n`), CRLF (`\r\n`) |
| Quebras de linha viram quebras forçadas | Tratar quebras de linha simples dentro de um parágrafo como quebras forçadas (não afeta as linhas em branco entre blocos) | Desligado | Ligado / Desligado |
| Preservar quebras de linha consecutivas | Manter múltiplas linhas em branco como estão em vez de colapsá-las | Ligado | Ligado / Desligado |
| Estilo de quebra rígida ao salvar | Como as quebras de linha rígidas são representadas no arquivo Markdown salvo | Preservar existente | Dois espaços (Recomendado), Preservar existente, Barra invertida (`\`) |
| Mostrar tags `<br>` | Exibir tags de quebra de linha HTML visivelmente no editor | Desligado | Ligado / Desligado |
| Mostrar invisíveis | Visualiza os espaços em branco: espaços como `·`, tabulações como `→` (somente Fonte), quebras de linha suaves como `↓` (somente Fonte), quebras de linha forçadas como `⏎`. Oculto na impressão. Alternar: `F3` ou Visualizar → Mostrar invisíveis. | Desligado | Ligado / Desligado |

::: tip
Dois espaços é o estilo de quebra rígida mais compatível — funciona no GitHub, GitLab e todos os principais renderizadores de Markdown. O estilo de barra invertida pode falhar no Reddit, Jekyll e alguns parsers mais antigos.
:::

### Arquivos grandes

| Configuração | Descrição | Padrão | Opções |
|--------------|-----------|--------|--------|
| Modo Fonte automático | Abrir arquivos grandes no modo Fonte — arquivos acima de 1 MB ou markdown com 1.200+ blocos estimados (pula o WYSIWYG para manter o desempenho fluido). Você pode mudar para WYSIWYG pela barra de status a qualquer momento | Ligado | Ligado / Desligado |
| Avisar acima do tamanho | Mostrar uma confirmação antes de abrir arquivos acima de 5 MB. Arquivos de 50 MB ou mais são sempre recusados | Ligado | Ligado / Desligado |

Veja [Arquivos grandes](/pt-BR/guide/large-files) para a explicação completa de como arquivos grandes são tratados.

## Markdown

Configurações de comportamento ao colar, layout e renderização HTML.

### Colar e Entrada

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Habilitar regex na pesquisa | Mostrar um botão de alternância de regex na barra de Localizar e Substituir | Ligado | Ligado / Desligado |
| Modo de colar | Como o conteúdo da área de transferência é processado ao colar. **Inteligente** converte HTML em Markdown e detecta a sintaxe Markdown; **Texto simples** sempre cola texto simples; **Rich** mantém a formatação HTML original | Inteligente | Inteligente, Texto simples, Rich |
| Colar Markdown no WYSIWYG | Ao colar texto que parece Markdown no editor WYSIWYG, convertê-lo automaticamente em conteúdo rico | Auto | Auto, Desligado |

### Layout

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Dividir fonte/visualização por padrão | Abrir arquivos Markdown na divisão lado a lado de código-fonte + prévia ao vivo (caso contrário, WYSIWYG). Alterne por sessão com `Shift + F6` ou **Visualizar → Visualização dividida do Markdown** | Desligado | Ligado / Desligado |
| Tamanho de fonte do elemento de bloco | Tamanho relativo de fonte para listas, citações, tabelas, alertas e blocos de detalhes | 100% | 100%, 95%, 90%, 85% |
| Alinhamento de título | Alinhamento de texto para títulos. Só no editor — não se aplica à exportação nem à impressão | Esquerda | Esquerda, Centro |
| Bordas de imagens e diagramas | Se mostrar uma borda ao redor de imagens, diagramas Mermaid e blocos matemáticos. Só no editor — não se aplica à exportação nem à impressão | Nenhuma | Nenhuma, Sempre, Ao passar o mouse |
| Alinhamento de imagens e tabelas | Alinhamento horizontal para imagens de bloco e tabelas. Só no editor — não se aplica à exportação nem à impressão | Centro | Centro, Esquerda |
| Ajustar tabelas à largura | Limitar todas as tabelas à largura do editor em vez de permitir rolagem horizontal | Desligado | Ligado / Desligado |
| Números de linha em blocos de código | Mostrar números de linha dentro dos blocos de código no editor WYSIWYG. Independente de **Números de linha** do menu Visualizar, que controla a margem do editor Fonte/Dividido | Desligado | Ligado / Desligado |

### Lint

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Habilitar markdown lint | Verificar problemas comuns de markdown (links quebrados, texto alt ausente, incrementos de títulos, blocos de código não fechados, etc.) | Ligado | Ligado / Desligado |

Veja [Lint de Markdown](/pt-BR/guide/lint) para a lista completa de regras e níveis de severidade.

### Renderização HTML

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| HTML bruto em texto rico | Controlar se os blocos HTML brutos são renderizados no modo WYSIWYG | Sanitizado | Oculto, Sanitizado, Sanitizado + estilos |
| Tags HTML permitidas | Quão amplo é o conjunto de tags renderizadas | Estrito | Estrito, Estendido |
| Permitir também estas tags | Nomes de tags extras a permitir, separados por vírgula | _(vazio)_ | ex.: `kbd, samp, var` |

::: tip
**Oculto** colapsa o HTML bruto e não renderiza nada. **Sanitizado** renderiza HTML com tags perigosas removidas. **Sanitizado + estilos** também preserva um subconjunto seguro de atributos `style` inline.

**Estrito** permite um conjunto de tags pequeno e conservador. **Estendido** também renderiza `<svg>` (e seus elementos filhos seguros), `<figure>`/`<figcaption>`, `<details>`/`<summary>` e outras tags semânticas/estruturais — todas ainda sanitizadas. Use **Permitir também estas tags** para acrescentar extras específicos (ex.: `kbd, samp, var`).
:::

::: warning
Independentemente dessas configurações, tags perigosas (`<script>`, `<style>`, `<iframe>`, `<form>`, manipuladores de eventos, …) são **sempre** removidas — o campo de tags personalizadas não consegue reativá-las. A amplitude da lista de permitidas afeta apenas a prévia WYSIWYG; o HTML bruto no seu arquivo nunca é modificado.
:::

## Arquivos e Imagens

Navegador de arquivos, salvamento, histórico de documentos, tratamento de imagens e ferramentas de documento.

### Espaço de trabalho

| Configuração | Descrição | Padrão |
|-------------|-----------|--------|
| Barra de espaços de trabalho | Mostrar a barra de espaços de trabalho à esquerda e manter vários espaços de trabalho e arquivos avulsos em uma única janela | Desligado |

Veja [Barra de espaços de trabalho](/pt-BR/guide/workspace-rail) para saber o que a barra acrescenta.

### Navegador de Arquivos

As duas primeiras configurações só se aplicam quando uma área de trabalho (pasta) estiver aberta, e são salvas por área de trabalho.

| Configuração | Descrição | Padrão |
|-------------|-----------|--------|
| Mostrar arquivos ocultos | Incluir dotfiles e itens ocultos do sistema no painel lateral do explorador de arquivos | Desligado |
| Mostrar todos os arquivos | Mostrar arquivos que não são markdown no explorador de arquivos. Arquivos não markdown abrem com o aplicativo padrão do sistema | Desligado |
| Mostrar extensões de arquivo | Exibir o nome completo do arquivo — `notes.md`, e não `notes` — na barra lateral, na faixa de abas e na barra de título. Vale em todo lugar, com ou sem área de trabalho | Ligado |

Desativar **Mostrar extensões de arquivo** oculta apenas as extensões que o VMark reconhece. Um arquivo que ele não consegue abrir mantém o sufixo de qualquer forma, então o nome que você vê sempre existe no disco.

### Comportamento ao Sair

| Configuração | Descrição | Padrão |
|-------------|-----------|--------|
| Confirmar saída | Exigir pressionar `Cmd+Q` (ou `Ctrl+Q`) duas vezes para sair, evitando saídas acidentais | Ligado |
| Minimizar para a bandeja ao fechar | **Somente Windows.** Fechar a última janela mantém o VMark em execução na bandeja do sistema em vez de sair | Desligado |

**Minimizar para a bandeja ao fechar** muda apenas a *última* janela. Com várias janelas abertas, fechar uma ainda a fecha; é o fechamento final — aquele que antes encerrava o VMark — que agora o estaciona na bandeja. Nada é fechado, então o trabalho não salvo fica exatamente onde você o deixou.

- **Clique com o botão esquerdo** no ícone da bandeja para trazer o VMark de volta.
- **Clique com o botão direito** nele para **Mostrar VMark** e **Sair do VMark**. Sair pela bandeja traz a janela de volta primeiro, para que qualquer aviso de alterações não salvas apareça onde você possa respondê-lo.
- `Ctrl+Q` continua saindo normalmente.
- Desativar a configuração enquanto o VMark está na bandeja traz a janela de volta antes que o ícone desapareça, então ele nunca fica em execução sem janela e sem ícone.

A configuração não aparece no macOS nem no Linux.

### Salvamento

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Habilitar salvamento automático | Salvar arquivos automaticamente após a edição | Ligado | Ligado / Desligado |
| Gravar bloco de identidade ao salvar | Permite que o VMark insira um bloco de identidade `vmark:` no frontmatter de um arquivo e crie uma pasta `.vmark` no espaço de trabalho, para que a camada de coerência acompanhe o documento. Vale para toda gravação: salvamentos, edições de IA e MCP, restaurações de versões anteriores e arquivos novos. Desativado, nada é inserido e nenhuma pasta `.vmark` é criada; um espaço de trabalho que já tenha uma continua registrando as alterações dos documentos que acompanha — um documento que já registrou antes, ou um que já traz sua própria identidade `vmark:`, como um arquivo acompanhado que você moveu ou obteve por checkout. Veja [Coerência](/pt-BR/guide/coherence#como-funciona-30-segundos) | Desligado | Ligado / Desligado |
| Intervalo de salvamento | Tempo entre salvamentos automáticos. Disponível apenas quando o salvamento automático estiver habilitado | 30 segundos | 10s, 30s, 1 min, 2 min, 5 min |
| Manter histórico de documentos | Rastrear versões de documentos para desfazer e recuperação | Ligado | Ligado / Desligado |
| Máximo de versões | Número de instantâneos de histórico a manter por documento | 50 versões | 10, 25, 50, 100 |
| Manter versões por | Idade máxima dos instantâneos de histórico antes de serem removidos | 7 dias | 1 dia, 7 dias, 14 dias, 30 dias |
| Janela de mesclagem | Salvamentos automáticos consecutivos dentro desta janela se consolidam em um único instantâneo, reduzindo o ruído de armazenamento | 30 segundos | Desligado, 10s, 30s, 1 min, 2 min |
| Tamanho máximo de arquivo para histórico | Pular instantâneos de histórico do salvamento automático para arquivos maiores que este limite. Salvamentos manuais, salvamentos via MCP e a cópia de segurança feita antes de restaurar uma versão são sempre mantidos | 512 KB | 256 KB, 512 KB, 1 MB, 5 MB, Ilimitado |

### Imagens

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Redimensionar automaticamente ao colar | Redimensionar automaticamente imagens grandes antes de salvar na pasta de ativos. O valor é a dimensão máxima em pixels | Desligado | Desligado, 800px, 1200px, 1920px (Full HD), 2560px (2K) |
| Copiar para pasta de ativos | Copiar imagens coladas ou arrastadas para a pasta de ativos do documento em vez de incorporá-las | Ligado | Ligado / Desligado |
| Limpar imagens não utilizadas ao fechar | Excluir automaticamente imagens da pasta de ativos que o documento não referencia mais. Executa ao fechar o documento, a janela ou o aplicativo. Imagens ainda referenciadas por outro documento na mesma pasta são mantidas, e as removidas vão para a lixeira do sistema | Desligado | Ligado / Desligado |

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
| Aprovar automaticamente salvamentos em um novo local e resultados de gênios | Permite que um cliente MCP salve um documento em um novo local sem perguntar, e que um gênio aplique seu resultado diretamente em vez de mostrar uma prévia. Quando desativado, uma solicitação MCP para salvar em um novo caminho é recusada e uma notificação avisa você. As gravações de documentos via MCP nunca dependem disto — cada uma é registrada no histórico de edições de agentes e pode ser restaurada pelo Histórico de escritas MCP na barra de status | Desligado |

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

**Provedores REST API** — Conecte-se diretamente a uma API: Anthropic, OpenAI, um serviço **compatível com OpenAI** (DeepSeek, Groq, OpenRouter, …), Google AI ou um servidor Ollama local (Ollama API). Cada um precisa de um nome de modelo e de uma chave de API — exceto o Ollama, para o qual a chave é opcional. Todos, exceto o Google AI, também aceitam um endpoint, pré-preenchido quando o provedor tem um padrão (o slot compatível com OpenAI não tem, então você o informa).

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
| **Prévia HTML** | Desligado | `.html` e `.htm` — prévia em iframe com sandbox (`sandbox=""` com lista de permissões vazia, DOMPurify, CSP `<meta>`). Sua aprovação de segurança ainda está pendente, e a prévia avisa isso — veja [Modelo de segurança para HTML](/pt-BR/guide/formats#modelo-de-seguranca-para-html). |
| **Visualizadores de código** | Desligado | 12 visualizadores somente leitura (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua`). Abrem em um visualizador com realce de sintaxe e botões **Habilitar edição** e **Abrir no editor externo**. |

Quando uma categoria está desativada, as extensões correspondentes recaem no fallback de texto simples para que o arquivo ainda abra — apenas sem a visualização de esquema.

### Modo de exibição padrão

Arquivos com visualização (HTML, SVG, Mermaid, JSON, YAML, TOML) abrem em um dos
três [modos de exibição](/pt-BR/guide/formats#modos-de-exibicao-fonte-dividido-visualizacao):

| Opção | Resultado |
|---|---|
| **Fonte** | Painel de código-fonte editável, em largura total. |
| **Dividido** (padrão) | Código-fonte e visualização lado a lado. |
| **Visualização** | Renderização somente leitura, em largura total. |

Este é o padrão para abas recém-abertas; cada aba lembra a sua própria escolha, e
você pode alternar qualquer aba com o botão na tela ou `F6` / `Shift + F6`.

### Editor externo

Para o botão **Abrir no editor externo** em abas de código somente leitura, escolha o editor que deve ser iniciado: o nome de um editor conhecido (`code`, `zed`, `subl`, `vim`, …) ou o caminho completo de um bundle de app (ex.: `/Applications/Visual Studio Code.app`) ou de um executável. Shells, interpretadores e emuladores de terminal são recusados, assim como um caminho que não existe.

A configuração da interface substitui qualquer variável de ambiente — explícito prevalece sobre implícito. Deixe vazio para usar a cadeia de fallback de variáveis de ambiente `$VMARK_EXTERNAL_EDITOR → $VISUAL → $EDITOR → padrão da plataforma`. Veja [Abrir no editor externo](/pt-BR/guide/formats#abrir-no-editor-externo) para a ordem de resolução completa e a barreira de segurança.

### Notificação única de atualização

Na primeira execução após atualizar para o suporte a múltiplos formatos, o VMark exibe uma notificação não bloqueante apontando para **Configurações → Formatos**. A notificação é exibida uma única vez por instalação — após ser mostrada (ou dispensada), nunca reaparece.

### Substituições por tipo de arquivo

Além das alternâncias por categoria, você pode substituir como uma família de arquivos específica abre pela paleta de comandos — **Definir tipo de arquivo: Texto sem formatação / Markdown / Redefinir para padrão**. As substituições são armazenadas por família de arquivos (pela extensão, ou pelo nome do dotfile para arquivos como `.env`) e persistem entre sessões. Veja [Como o VMark decide o tipo de um arquivo](/pt-BR/guide/formats#como-o-vmark-decide-o-tipo-de-um-arquivo).

O painel **Formatos** lista todas as substituições que você definiu, cada uma como `chave → formato`. Remova uma única entrada com o botão `×` dela, ou use **Limpar tudo** para descartá-las de uma vez — as entradas removidas voltam à regra interna.

## Idioma

O idioma da interface e as regras de formatação CJK (Chinês, Japonês, Coreano).

### Idioma da interface

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Idioma da interface | Altera o idioma da interface para menus, rótulos e mensagens. Tem efeito imediato | Idioma do sistema | English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Italiano, Português (Brasil) |

Na primeira execução, o VMark escolhe o primeiro idioma da lista de idiomas preferidos do sistema que ele inclui, e usa o inglês quando nenhum corresponde. Depois que você escolhe um idioma aqui, sua escolha é mantida.

### Formatação CJK

As regras abaixo são aplicadas quando você executa **Formatar → CJK → Formatar seleção** (`Cmd+Shift+F`) sobre uma seleção, ou **Formatar → CJK → Formatar arquivo inteiro** (`Alt+Cmd+Shift+F`) sobre o arquivo inteiro.

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
| Aspas contextuais | Usar aspas curvas ao redor de texto CJK, mas manter aspas retas em texto puramente latino. Disponível apenas quando Converter aspas retas está ativado | Ligado |
| Comportamento da alternância de aspas | Como o comando de alternância de estilo de aspas percorre os estilos — **Simples** troca reta ↔ o seu estilo preferido; **Ciclo completo** passa por todos os estilos | Simples |
| Corrigir espaçamento de aspas duplas | Normalizar espaçamento ao redor de aspas duplas | Ligado |
| Corrigir espaçamento de aspas simples | Normalizar espaçamento ao redor de aspas simples | Ligado |
| Aspas de canto CJK | Converter aspas curvas em colchetes de canto `「」` para texto em Chinês Tradicional e Japonês. Disponível apenas quando o estilo de aspas é Curvas | Desligado |
| Aspas de canto aninhadas | Converter aspas simples aninhadas em `『』` dentro de `「」` | Desligado |

### Tratamento de seções

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Ignorar seções de referência | Deixar as seções `## References` e `## Further Reading` sem formatação ao executar a formatação CJK — útil em documentos acadêmicos, em que o texto das citações deve permanecer literal | Desligado | Ligado / Desligado |

### Limpeza

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Limitar pontuação consecutiva | Limitar marcas de pontuação repetidas como `!!!` | Desligado | Desligado, Único (`!!` para `!`), Duplo (`!!!` para `!!`) |
| Remover espaços no final | Remover espaços no final das linhas | Ligado | Ligado / Desligado |
| Normalizar reticências | Converter pontos espaçados (`. . .`) em reticências adequadas (`...`) | Ligado | Ligado / Desligado |
| Colapsar novas linhas | Reduzir três ou mais novas linhas consecutivas para duas | Desligado | Ligado / Desligado |

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
| Shell | Qual shell usar. Requer reinício do terminal para ter efeito. Um shell salvo que não está mais disponível aparece como *(indisponível)* e o padrão é usado | Padrão do Sistema | Shells detectados automaticamente no seu sistema (ex: zsh, bash, fish) |
| Posição do Painel | Onde colocar o painel do terminal | Auto | Auto (baseado na proporção da janela), Acima, Embaixo, Esquerda, Direita |
| Tamanho do Painel | Proporção do espaço disponível que o terminal ocupa. Arrastar para redimensionar o painel também atualiza este valor | 40% | 10% a 80% |
| Tamanho da Fonte | Tamanho do texto no terminal | 13px | 10px a 24px |
| Altura de Linha | Espaçamento vertical entre linhas do terminal | 1.2 (Compacto) | 1.0 (Apertado) a 2.0 (Extra) |
| Estilo do Cursor | Forma do cursor do terminal | Barra | Barra, Bloco, Sublinhado |
| Cursor Piscante | Se o cursor do terminal pisca | Ligado | Ligado / Desligado |
| Copiar ao Selecionar | Copiar automaticamente o texto do terminal selecionado para a área de transferência | Desligado | Ligado / Desligado |
| Renderizar transcrições automaticamente | Exibir Markdown, tabelas e diagramas Mermaid do Claude/Codex ao lado da CLI do terminal. Adiciona um hook SessionStart local à configuração do Claude Code e do Codex; reinicie as sessões CLI em execução após ativar | Desligado | Ligado / Desligado |
| Renderizador WebGL | Usar renderização acelerada por GPU para o terminal. Desabilite se tiver problemas de entrada IME. Requer reinício do terminal. Apenas macOS e Windows — o Linux sempre usa o renderizador DOM | Ligado | Ligado / Desligado |
| Área de transferência remota (OSC 52) | Permitir que programas em execução no terminal — por ssh, dentro do tmux — copiem para a área de transferência do sistema. O canal é somente de escrita: a leitura da área de transferência é sempre recusada, pois qualquer saída impressa no terminal poderia solicitá-la | Ligado | Ligado / Desligado |
| Histórico de rolagem | Número de linhas de saída que cada sessão mantém no histórico de rolagem. Valores maiores usam mais memória | 5.000 | 1.000 / 5.000 / 10.000 / 50.000 |
| Modo leitor de tela | Expor a saída do terminal a tecnologias assistivas (VoiceOver). Desativado por padrão por questões de desempenho | Desligado | Ligado / Desligado |

Dois interruptores específicos de plataforma também aparecem aqui, ambos ligados por padrão: **Option como tecla Meta** (somente macOS — trata a tecla Option como Meta, como esperam ferramentas como emacs e tmux para atalhos prefixados com `Alt` e navegação por palavras; desligue se precisar das teclas mortas de Option para acentos, como `Option + E`) e **Integração com o shell** (oculto no Windows — injeta marcadores de comando no zsh e no bash para navegação entre prompts, indicadores de status de saída e rastreamento do diretório atual; vale para novas sessões de terminal).

### Acessibilidade

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Campainha do terminal | Como uma campainha do terminal (BEL) é sinalizada. **Visual** marca atividade em segundo plano na aba da sessão; **Sonora** toca um bipe suave e (para uma sessão em segundo plano) também marca a aba para que você a encontre; **Desligada** a ignora. Aplica-se na hora às sessões em execução | Visual | Desligada, Visual, Sonora |
| Notificar quando sem foco | Mostrar uma notificação do sistema (com o nome do documento da janela) quando um terminal toca a campainha enquanto aquela janela do VMark não está em foco — por exemplo, o Claude Code concluindo um turno. Permite acompanhar o Claude Code em várias janelas sem vigiar cada uma. Exige conceder permissão de notificação no primeiro uso | Ligado | Ligado / Desligado |
| Contraste mínimo | Elevar texto tênue do terminal a uma razão de contraste mínima em relação ao fundo. Aumente para melhorar a legibilidade; **Desligado** desativa a elevação. Aplica-se na hora às sessões em execução | WCAG AA (4,5:1) | Desligado, WCAG AA (4,5:1), WCAG AAA (7:1), Máximo |

Veja [Terminal Integrado](/pt-BR/guide/terminal) para mais sobre sessões, atalhos de teclado e ambiente de shell.

## Sobre

Exibe a versão do aplicativo, links para o site e repositório GitHub e gerenciamento de atualizações. O link **Avisos de terceiros** abre os textos de licença do software de código aberto incluído no VMark no app padrão do sistema para arquivos de texto.

### Atualizações

| Configuração | Descrição | Padrão | Opções |
|-------------|-----------|--------|--------|
| Atualizações automáticas | Verificar periodicamente se há novas versões | Ligado | Ligado / Desligado |
| Frequência de verificação | Com que frequência verificar atualizações. Disponível apenas quando as atualizações automáticas estão ativadas | Ao iniciar | Ao iniciar, Diariamente, Semanalmente, Apenas manual |
| Baixar atualizações automaticamente | Baixar novas versões em segundo plano quando disponíveis | Desligado | Ligado / Desligado |
| Verificar Agora | Acionar manualmente uma verificação de atualização | — | — |

Quando uma atualização estiver disponível, um cartão aparece mostrando o novo número de versão, data de lançamento e notas de versão. Você pode **Baixar** a atualização, **Pular** esta versão ou — uma vez baixada — **Reiniciar para Atualizar**.

#### A atualização corresponde à forma como você instalou o VMark

O atualizador baixa o mesmo formato de pacote que você instalou, e não um formato fixo por plataforma:

| Você instalou | O atualizador baixa |
|---|---|
| `.dmg` do macOS | o pacote de aplicativo assinado |
| `.exe` do Windows (NSIS) | o instalador `.exe` |
| `.msi` do Windows | o pacote `.msi` |
| `.deb` do Linux | o pacote `.deb` |
| `.rpm` do Linux | o pacote `.rpm` |
| AppImage do Linux | o AppImage |

No Linux, atualizar uma instalação `.deb` ou `.rpm` executa o gerenciador de pacotes do sistema, então você é solicitado a se autenticar — instalar um pacote do sistema exige root. As atualizações de AppImage substituem o arquivo no lugar e não pedem nada.

#### Se uma atualização travar

A verificação e o download passam pela rede, e uma conexão que trava em vez de falhar de vez poderia deixar a atualização em andamento para sempre. Se uma verificação não progredir por um minuto, ou um download ou instalação por três minutos, o VMark mostra uma notificação persistente **Atualização travada** na janela do documento. O botão **Tentar novamente** dela devolve o atualizador ao estado ocioso para que você tente de novo — **Verificar Agora** nesta seção, ou a próxima verificação automática, recomeça com uma verificação nova.

A atividade de atualização é gravada no arquivo de log, então, se o problema se repetir, vale a pena anexar o log a um relatório de bug:

| Plataforma | Local do log |
|---|---|
| macOS | `~/Library/Logs/app.vmark/` |
| Windows | `%LOCALAPPDATA%\app.vmark\logs\` |
| Linux | `~/.local/share/app.vmark/logs/` |

### Redefinir

| Configuração | Descrição |
|-------------|-----------|
| Redefinir para os padrões | Restaurar as configurações destes painéis aos valores padrão. Uma confirmação aparece antes — isso não pode ser desfeito |

Três coisas são armazenadas separadamente e **não** são redefinidas: as personalizações de atalhos de teclado (use **Redefinir tudo** no painel [Atalhos](#atalhos)), a configuração do seu provedor de IA e as configurações do navegador de arquivos por área de trabalho (**Mostrar arquivos ocultos**, **Mostrar todos os arquivos**). O idioma da interface volta ao idioma do sistema.

## Avançado

::: tip
A seção Avançado fica visível por padrão — ela abriga o botão para desligar o navegador incorporado, que vem ativado. Pressione `Ctrl + Option + Cmd + D` na janela de Configurações para ocultá-la, e de novo para trazê-la de volta.
:::

Configuração para desenvolvedores e em nível de sistema.

### Protocolos de Link

| Configuração | Descrição | Padrão |
|-------------|-----------|--------|
| Protocolos de link personalizados | Protocolos de URL adicionais que o VMark trata como links. Insira cada protocolo como uma tag | `obsidian`, `vscode`, `dict`, `x-dictionary` |

A lista faz duas coisas. Ao inserir um link, uma URL da área de transferência com um desses protocolos é reconhecida como link, assim como `https://`. E ao abrir um link, o VMark o repassa ao sistema somente se o protocolo for `http`, `https`, `mailto` ou estiver nesta lista — assim, links `obsidian://open?vault=...` e `vscode://file/...` abrem em seus aplicativos, enquanto qualquer outro protocolo é recusado. Alguns protocolos nunca podem ser habilitados dessa forma, não importa o que a lista diga: `javascript:`, `data:`, `file:` e similares.

Um padrão que você remove continua removido. Um protocolo padrão adicionado em uma versão posterior do VMark é acrescentado à sua lista uma única vez, na primeira execução dessa versão.

### Desempenho

| Configuração | Descrição | Padrão |
|-------------|-----------|--------|
| Manter ambos os editores ativos | Montar os editores dos modos WYSIWYG e Fonte simultaneamente para alternância mais rápida entre modos. Aumenta o uso de memória | Desligado |

### Coerência

| Configuração | Descrição | Padrão | Opções |
|--------------|-----------|--------|--------|
| Confiança da verificação semântica | Quanta certeza uma verificação precisa ter para que sua resposta seja registrada como veredito. Abaixo disso, a resposta é mantida, mas marcada como desconhecida | 0.9 | 0.7, 0.8, 0.9, 0.95 |

Veja [Coerência](/pt-BR/guide/coherence) para saber o que é uma verificação e como os vereditos são registrados.

### Arquivos de fluxo de trabalho

| Configuração | Descrição | Padrão | Opções |
|--------------|-----------|--------|--------|
| Buscar metadados de actions | Permite que o VMark busque o `action.yml` das GitHub Actions referenciadas para preencher o formulário `with:` do editor estruturado. Desative para manter o editor de workflow totalmente offline | Ligado | Ligado / Desligado |
| Usar actionlint quando disponível | Se o binário `actionlint` estiver no seu PATH, ele é executado nos arquivos de workflow para diagnósticos mais ricos. Sem efeito se o binário não estiver instalado | Ligado | Ligado / Desligado |

### Workflow

O visualizador do GitHub Actions não tem interruptor: abrir um arquivo em
`.github/workflows/` mostra o grafo e o editor de formulários, e os recursos do
painel de fonte (autocompletar de expressões, sincronização entre cursor e
canvas, ir para a definição de `uses:`) carregam junto. O que resta aqui é a
única preferência do visualizador e o motor de execução, que é separado.

| Configuração | Descrição | Padrão | Opções |
|--------------|-----------|--------|--------|
| Preservar formatação YAML | Ao salvar edições de workflow feitas pelo painel de formulário, preservar comentários, âncoras, ordem de chaves e linhas em branco do YAML original via o pipeline de ida e volta da CST. Quando desligado, o salvamento usa um serializador compacto (mais rápido, mas com perda) | Ligado | Ligado / Desligado |
| Motor de workflow | Executa os arquivos de workflow YAML do próprio VMark: um arquivo de workflow abre com o grafo de etapas e uma barra de ferramentas Executar / Cancelar ao lado do fonte, e os genies de workflow podem ser executados. As etapas podem chamar provedores de IA e gravar arquivos, por isso fica desligado até que você o ative | Desligado | Ligado / Desligado |

O motor não altera o que o visualizador mostra: arquivos do GitHub Actions abrem
no visualizador de qualquer forma, e com o motor desligado um arquivo de
workflow do VMark aparece como uma árvore YAML simples. Com o motor desligado, o
VMark também recusa de imediato as solicitações de execução de workflow, em vez
de apenas ocultar o botão — inclusive as que chegam via MCP — e informa "O motor
de fluxo de trabalho está desativado nas configurações".

As duas linhas ficam em **Ferramentas de desenvolvedor** (veja abaixo) — ative as
Ferramentas de desenvolvedor para revelá-las. Veja
[Visualizador de Workflows](/pt-BR/guide/workflow-viewer) para o visualizador e
[Workflows de Genie](/pt-BR/guide/workflows) para o motor.

### Navegador incorporado

| Configuração | Descrição | Padrão | Opções |
|--------------|-----------|--------|--------|
| Navegador incorporado | O navegador web dentro do aplicativo (somente macOS). Enquanto ativado, **Nova aba do navegador** fica no menu Arquivo e na paleta de comandos, e as ferramentas MCP `browser` ficam disponíveis. Desativá-lo fecha as abas de navegador abertas e retira a superfície de automação da IA | Ligado | Ligado / Desligado |
| Sessão do navegador da IA | Escolha `Sandbox` (recomendado, cookies da IA isolados e não persistentes) ou `Perfil compartilhado` (perfil humano com aprovação de destinos) | Sandbox | Sandbox / Compartilhado |
| Permitir acesso de loopback para a IA | Permite que a IA navegue para localhost e endereços de loopback. Faixas de LAN privada, metadados e link-local permanecem bloqueadas | Desligado | Ligado / Desligado |

Essas configurações ficam em **Avançado → macOS** e aparecem somente no macOS. As
duas linhas de postura da IA aparecem apenas enquanto o navegador está ativado, e
não são afetadas por ele estar ativado — ficam em Sandbox / loopback bloqueado até
que você as altere. Veja [Navegador incorporado](/pt-BR/guide/browser) para a
superfície completa de recursos.

### Específico da plataforma

| Configuração | Descrição | Padrão | Plataformas |
|--------------|-----------|--------|-------------|
| Limpar quarentena macOS ao abrir | Ao abrir um espaço de trabalho, remove o atributo de quarentena de downloads do macOS (`com.apple.quarantine`) da pasta do espaço de trabalho e dos arquivos que o VMark pode abrir diretamente dentro dela (subpastas não são tocadas). Sem isso, o macOS pode descartar silenciosamente um clique duplo no Finder em um arquivo baixado enquanto o VMark está em execução. Aparece na interface como **Remover quarentena de downloads ao abrir o espaço de trabalho**, em **Avançado → macOS** | Ligado | macOS |

A configuração **Option como tecla Meta** do terminal fica no painel [Terminal](#terminal).

### Ferramentas de Desenvolvedor

**Ferramentas de desenvolvedor** é um interruptor geral persistente para configurações
experimentais e exclusivas de desenvolvimento. Ativá-lo revela a linha **Preservar
formatação YAML**, a alternância **Motor de workflow** e um painel **Hot Exit Dev
Tools** (botões para testar captura de sessão, inspeção, restauração, limpeza e
reinicialização). Como o interruptor persiste, um recurso em andamento que você
ativar continua acessível entre sessões e em versões de lançamento — você não
precisa reativar as Ferramentas de desenvolvedor sempre que abrir as Configurações.

Ele também revela a [Base de conhecimento](/pt-BR/guide/knowledge-base) fora das
Configurações: o item de menu **Visualizar → Base de conhecimento**, o comando da
paleta e o atalho `Ctrl + Shift + 4` ficam ocultos até que as Ferramentas de
desenvolvedor estejam ativadas, porque nenhuma versão de lançamento, em nenhuma
plataforma, inclui o runtime do servidor de conteúdo de que esse recurso precisa.

| Configuração | Descrição | Padrão |
|-------------|-----------|--------|
| Ferramentas de desenvolvedor | Ativar o modo de desenvolvedor e revelar as configurações experimentais e exclusivas de desenvolvimento abaixo | Desligado |

## Veja Também

- [Recursos](/pt-BR/guide/features) — Visão geral das capacidades do VMark
- [Atalhos de Teclado](/pt-BR/guide/shortcuts) — Referência completa de atalhos
- [Formatação CJK](/pt-BR/guide/cjk-formatting) — Regras detalhadas de formatação CJK
- [Terminal Integrado](/pt-BR/guide/terminal) — Sessões de terminal e uso
- [Provedores de IA](/pt-BR/guide/ai-providers) — Guia de configuração de provedores de IA
- [Configuração MCP](/pt-BR/guide/mcp-setup) — Configuração do servidor MCP para assistentes de IA
