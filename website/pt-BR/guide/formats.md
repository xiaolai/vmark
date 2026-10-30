# Formatos Suportados

O VMark abre diretamente todos os formatos de arquivo listados abaixo. O diferencial são as **prévias com reconhecimento de esquema**: quando o arquivo é um artefato conhecido, o VMark exibe a visualização *correta*, não uma árvore JSON genérica.

[[toc]]

## Habilitando formatos

Markdown, texto simples e YAML/YML sempre abrem em seus editores completos — esses são os padrões tranquilos. Todos os outros formatos abaixo estão **desativados por padrão** e ficam por trás de um botão de alternância de categoria em **Configurações → Formatos**:

| Alternância | Habilita |
|---|---|
| **Formatos de dados** | `.json`, `.jsonl`, `.toml` (painel dividido com fonte + árvore, com renderizadores de esquema para Cargo / package.json / pyproject) |
| **Diagramas e SVG** | `.mmd`, `.svg` (painel dividido com fonte + renderização ao vivo sanitizada) |
| **Prévia HTML** | `.html`, `.htm` (iframe em sandbox — veja [Modelo de segurança para HTML](#modelo-de-seguranca-para-html)) |
| **Visualizadores de código** | 12 visualizadores de código somente leitura (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua`) |

Quando uma categoria está desativada, as extensões correspondentes recaem no fallback de texto simples, então o arquivo ainda abre — apenas sem a prévia ou visualização de esquema. Ative uma alternância e o registro é reconstruído no lugar; as abas abertas remontam com o adaptador correto.

Na primeira execução após atualizar para o suporte a múltiplos formatos, o VMark exibe uma notificação única sugerindo que você acesse **Configurações → Formatos**. Se você a dispensou (ou instalou o VMark pela primeira vez), o painel está disponível em **Configurações → Formatos** a qualquer momento.

## Visão geral

| Família | Extensões | Padrão | Editor | Prévia |
|---|---|---|---|---|
| Markdown | `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx` | sempre ativo | modos WYSIWYG + Fonte | prosa renderizada |
| Texto simples | `.txt` | sempre ativo | fonte | — |
| Dados — YAML | `.yaml`, `.yml` | sempre ativo | fonte + árvore | árvore navegável, com reconhecimento de esquema (GitHub Actions, workflows do VMark) |
| Dados — JSON | `.json`, `.jsonl` | requer a alternância **Formatos de dados** | fonte + árvore | árvore JSON navegável, com reconhecimento de esquema (`package.json`) |
| Dados — TOML | `.toml` | requer a alternância **Formatos de dados** | fonte + árvore | árvore navegável, com reconhecimento de esquema (`Cargo.toml`, `pyproject.toml`) |
| Diagramas | `.mmd` | requer a alternância **Diagramas e SVG** | fonte + renderização | diagrama Mermaid ao vivo |
| Vetorial | `.svg` | requer a alternância **Diagramas e SVG** | fonte + renderização | renderização inline sanitizada |
| Web | `.html`, `.htm` | requer a alternância **Prévia HTML** | fonte + renderização | iframe em sandbox (`sandbox=""` vazio, DOMPurify, CSP); o [modo confiável](#previa-html-confiavel-opcional) é opcional, por arquivo |
| Código (somente leitura) | `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua` | requer a alternância **Visualizadores de código** | visualizador (com opção de edição) | — |
| Mídia | imagens (`.png`, `.jpg`, `.gif`, `.webp`, `.heic`, `.tiff`, …), vídeo (`.mp4`, `.webm`, `.mov`, …), áudio (`.mp3`, `.wav`, `.flac`, …) | sempre ativo | visualizador (somente leitura) | imagem nativa / `<video>` / `<audio>` |

Arquivos de código abrem por padrão em modo somente leitura com um banner oferecendo **Ativar edição** ou **Abrir no editor externo**.

## Modos de exibição (Fonte / Dividido / Visualização)

Qualquer formato que tenha prévia — HTML, SVG, Mermaid, JSON, YAML, TOML — abre com
uma pequena alternância **Fonte · Dividido · Visualização** no canto superior direito:

- **Fonte** — o painel de fonte editável, em largura total.
- **Dividido** — fonte e prévia lado a lado (o padrão).
- **Visualização** — o resultado renderizado, em largura total. A visualização é uma
  renderização **somente leitura**; para editar, volte para Fonte ou Dividido.

Você também pode alternar pelo teclado: **`F6`** alterna Fonte ⇄ Dividido e
**`Shift + F6`** alterna Visualização ⇄ Dividido (Dividido é o estado base). A escolha é
lembrada por aba. Defina o padrão para arquivos recém-abertos em
**Configurações → Formatos → Modo de exibição padrão**.

Formatos sem prévia (texto simples, visualizadores de código) sempre mostram apenas a fonte, então
nenhuma alternância aparece.

## Arquivos de mídia (imagens, vídeo, áudio)

Abra uma imagem, um vídeo ou um arquivo de áudio e o VMark o exibe inline — como a
Visualização Rápida (Quick Look) do Finder. Há duas formas de pré-visualizar:

- **Abra-o** (clique nele no explorador de arquivos, use **Arquivo → Abrir arquivo...** ou
  arraste-o para a janela) para vê-lo em uma aba.
- **Visualização Rápida**: selecione um arquivo no explorador e pressione **Espaço** para uma
  sobreposição de prévia que ocupa a janela inteira. Pressione **Espaço**, **Esc** ou clique no fundo
  para fechar.

Como funciona e o que esperar:

- **Nunca carregado como texto.** Mídia é binária — o VMark transmite o arquivo diretamente
  para o visualizador pelo pipeline nativo de recursos. Ele nunca é lido como UTF-8,
  nunca é mantido na memória como documento e nunca é editável nem salvo. Até
  vídeos de vários gigabytes abrem instantaneamente e permitem avançar/retroceder nativamente.
- **Edições no disco aparecem.** Reexporte a imagem do seu editor, ou deixe um
  script reescrevê-la, e a aba aberta carrega a nova versão sozinha — sem
  reabrir, sem fechar e abrir o arquivo de novo.
- **Ampla cobertura de formatos.** O VMark entrega o arquivo ao mecanismo de mídia da
  plataforma, então o suporte acompanha o que a webview do seu sistema consegue decodificar. No macOS
  isso é amplo — HEIC, TIFF, `.mov`/H.264 e FLAC funcionam. Formatos que a
  webview não consegue decodificar (por exemplo, `.mkv`, `.avi`, `.wmv`) ainda abrem, mostrando um
  painel alternativo com **Abrir com o aplicativo padrão** e **Mostrar no Finder**
  (**Mostrar no Explorador** no Windows, **Mostrar no gerenciador de arquivos** no Linux).
- **Somente leitura.** Abas de mídia nunca ficam com alterações pendentes e fecham sem pedir para salvar.

## Prévias com reconhecimento de esquema

Quando o caminho ou o conteúdo corresponde a um esquema conhecido, o VMark substitui a visualização genérica de árvore pela visualização correta.

### Workflow do GitHub Actions (`.github/workflows/*.yml`)

Abre com a bancada de workflow: o canvas interativo do DAG de jobs mais um editor de formulários estruturado com Salvar / Descartar (veja o [guia do Visualizador de Workflows](/pt-BR/guide/workflow-viewer)). O painel de fonte também reconhece workflows — completação de expressões `${{ }}`, destaque do job no canvas a partir do cursor e Cmd-clique em referências `uses:` locais.

- Detecção por caminho: um arquivo `.yml` / `.yaml` em `.github/workflows/` é roteado para o renderizador de workflow — mesmo com YAML malformado, você vê a visualização degradada com diagnósticos em vez de uma árvore em branco. (O arquivo deve chegar primeiro ao adaptador YAML; isso requer a extensão `.yml`/`.yaml`.)
- Detecção por conteúdo: chaves de nível superior `on:` e `jobs:`.

### Workflow do VMark (`steps:` no nível superior)

Abre com o painel de execução de workflow: uma barra de ferramentas **Executar** / **Cancelar** com uma linha de status, o grafo de etapas ao vivo (ou o erro de análise) e **Restaurar arquivos** depois de uma execução que gravou arquivos. Veja o [guia de Workflows](/pt-BR/guide/workflows).

- Detecção por caminho: nunca em `.github/workflows/` — o GitHub é dono dessa pasta.
- Detecção por conteúdo: o YAML é analisado sem erros, não tem `jobs:` no nível superior e tem uma lista `steps:` no nível superior em que o `uses:` de pelo menos uma etapa começa com `genie/`, `action/` ou `webhook/`. YAML quebrado nunca é um workflow do VMark.
- O painel requer **Configurações → Avançado → Motor de workflow**. Com o motor desativado, o arquivo mostra a árvore YAML simples (a menos que uma execução iniciada nesta aba ainda esteja ativa, para que o seu Cancelar continue acessível).

### `Cargo.toml`

Abre com uma árvore de dependências Rust — dependências de runtime, de desenvolvimento e de build, com especificações de versão e flags de features.

- Detecção por caminho: nome de arquivo `Cargo.toml` (sem distinção de maiúsculas) em caminhos POSIX ou Windows.
- Detecção por conteúdo: cabeçalho `[package]` ou `[workspace]`.
- Sem chamadas de rede — o VMark nunca resolve o crates.io.

### `package.json`

Abre com uma árvore de dependências npm — `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`.

- Detecção por caminho: nome de arquivo `package.json`.
- Detecção por conteúdo: `name` de nível superior mais qualquer combinação de `dependencies` / `devDependencies` / `peerDependencies`.

### `pyproject.toml`

Abre com uma árvore de dependências Python — tanto PEP 621 (`[project]` + `[project.optional-dependencies]`) quanto Poetry (`[tool.poetry.dependencies]`, `[tool.poetry.dev-dependencies]`, `[tool.poetry.group.<name>.dependencies]`).

- Detecção por caminho: nome de arquivo `pyproject.toml`.
- Detecção por conteúdo: cabeçalho `[project]` ou `[tool.poetry]` (condicionado a um parse TOML válido).

## Regras de edição

- **Markdown** inclui a barra de ferramentas completa, formatação de parágrafos, regras CJK, matemática, mermaid, notas de rodapé — todos os recursos markdown existentes.
- **Formatos de dados** (JSON, YAML, TOML) são exibidos no painel de fonte com marcadores de erro de parse na margem; a prévia de árvore é atualizada enquanto você digita. Ações de menu exclusivas do Markdown estão desabilitadas (formatação CJK, inserção de bloco, formatação de parágrafo); os controles relevantes para o modo permanecem ativos. O menu de contexto do botão direito fica reduzido às ações da área de transferência (Recortar/Copiar/Colar/Selecionar tudo).
- **Formatos visuais** (Mermaid, SVG, HTML) são exibidos no painel de fonte com a visualização renderizada no painel direito. A prévia é renderizada com prioridade menor que a sua digitação, então, em um documento grande, ela acompanha um instante atrás do cursor em vez de ser renderizada de novo a cada tecla.
- **Formatos de código** abrem como visualizadores com realce de sintaxe; ative a edição no local ou abra no seu editor externo (veja abaixo).

## Dialeto Markdown

O VMark lê e grava Markdown com o remark (micromark por baixo): CommonMark, mais GitHub Flavored Markdown (tabelas, listas de tarefas, tachado com `~~`, autolinks, notas de rodapé), front matter YAML, matemática `$…$` / `$$…$$`, wiki links (`[[target]]`), alertas do GitHub (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`), blocos `<details>`, `[TOC]` e quatro marcas inline: `==highlight==`, `~subscript~`, `^superscript^` e `++underline++`. Um til simples é subscrito, nunca tachado.

**Limite de aninhamento.** O WYSIWYG suporta citações e listas aninhadas até 1000 níveis de profundidade. Um documento mais profundo abre no **modo Fonte** com uma mensagem informando a profundidade, e a barra de status mostra *"Aberto no modo Fonte (não pode ser exibido no WYSIWYG)."* Enquanto estiver nesse estado, o arquivo fica protegido contra ser sobrescrito pelo editor rico. Reduza o aninhamento e então use **Mudar para WYSIWYG**. Blocos de código cercados, quebras temáticas e ênfase inline não contam para o limite. Veja também [Arquivos grandes](/pt-BR/guide/large-files).

## Como o VMark decide o tipo de um arquivo

O VMark trata o **markdown como uma lista de permissões, não como padrão**. A regra, em ordem:

1. **Uma extensão da família markdown** (`.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx`) abre no editor markdown completo.
2. **Uma extensão registrada que não seja markdown** (quando sua categoria está habilitada — JSON, YAML, visualizadores de código etc.) abre no painel de fonte desse formato.
3. **Todo o resto** — `.env`, `.env.local`, `Dockerfile`, `Makefile`, `.gitignore`, extensões desconhecidas — abre no **painel de fonte de texto simples**, nunca no editor markdown.

Isso significa que um arquivo de configuração nunca é renderizado silenciosamente como markdown. Um `.env.local` abre como texto simples, com suas linhas `KEY=value`, comentários `#` e sublinhados exatamente como foram digitados.

Famílias de dotfiles são reconhecidas em grupo: uma substituição em `.env` vale para `.env.local`, `.env.production` e assim por diante.

### Abrindo arquivos a partir do sistema

O instalador registra o VMark no seu sistema operacional como editor destes tipos de arquivo, para que eles apareçam em **Abrir com** e possam ser abertos no VMark com um clique duplo:

| Extensões | Registrado como |
|---|---|
| `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx` | Markdown Document |
| `.txt` | Plain Text Document |
| `.json`, `.jsonl` | JSON Document |
| `.yaml`, `.yml` | YAML Document |
| `.toml` | TOML Document |
| `.mmd` | Mermaid Diagram |
| `.svg` | SVG Image |
| `.html`, `.htm` | HTML Document |

No **Windows**, o instalador não assume um tipo de arquivo que outro programa já trata: para cada extensão que já tem um programa padrão, o VMark se adiciona a **Abrir com** e mantém esse padrão. Ele só se torna o padrão onde nada estava registrado — na prática, as extensões Markdown, e não `.txt`, `.html`, `.htm` ou `.svg`. Um padrão que você mesmo escolhe nas configurações do Windows sempre prevalece. A desinstalação restaura a entrada de menu **Novo → Documento de Texto** do Windows e o manipulador anterior.

Um arquivo registrado só abre no VMark se o seu formato estiver habilitado (veja [Habilitando formatos](#habilitando-formatos)); caso contrário, ele abre como texto simples.

No Windows e no Linux, uma pasta passada na linha de comando (`vmark C:\notes` ou `vmark ~/notes`) abre como espaço de trabalho em uma janela própria, como acontece no macOS ao soltar uma pasta sobre o ícone no Dock. Isso também funciona quando o VMark já está em execução.

### Realce de sintaxe para arquivos simples

Mesmo quando um arquivo abre como texto simples, o VMark o colore quando reconhece o tipo — `.env`/`.ini`/`.conf` (properties), `.sh`/`.bash` (shell), `Dockerfile`, `.toml`, `.sql`, `.diff` e as linguagens habituais. Isso é puramente cosmético; nunca muda em qual editor o arquivo abriu e funciona independentemente de a categoria de visualizadores de código estar habilitada.

### Substituição: "Definir tipo de arquivo"

A detecção é o padrão, não uma prisão. Abra a paleta de comandos e execute:

- **Definir tipo de arquivo: Texto sem formatação** — força a família do arquivo atual a abrir como texto simples (por exemplo, para impedir que um `.txt` que você mantém como notas brutas seja renderizado).
- **Definir tipo de arquivo: Markdown** — renderiza um arquivo que não é `.md` com o editor markdown (por exemplo, um `.txt` em que você de fato escreve markdown).
- **Definir tipo de arquivo: Redefinir para padrão** — remove a substituição.

As substituições são lembradas por família de arquivos (pela extensão, ou pelo nome do dotfile para arquivos como `.env`) e persistem entre sessões. Elas têm precedência sobre as regras embutidas acima.

## Localizar, salvar, pesquisa de conteúdo

- **Arquivo → Abrir arquivo...** oferece dois filtros: **Todos os formatos suportados** (todos os formatos registrados) e **Markdown**. O item não tem atalho padrão — `Mod + O` é a Abertura rápida — mas você pode atribuir um em **Configurações → Atalhos**. Os filtros de Salvar Como e a extensão padrão de salvamento são derivados do adaptador de formato da aba ativa, então salvar um arquivo `.toml` propõe `.toml` como extensão.
- **Arrastar e soltar** aceita qualquer extensão registrada.
- **Salvar Como** — os filtros e a extensão padrão ao salvar são derivados do adaptador de formato da aba ativa.
- A pesquisa de conteúdo **Cmd+Shift+H** ("Localizar em Arquivos") indexa todos os formatos semelhantes a texto (markdown, txt, json, yaml, toml, html, svg, mermaid). Arquivos de código são excluídos por padrão — eles estão em modo de visualizador de código.

## Modelo de segurança para HTML

De acordo com o ADR-4 do plano multi-formato, a prévia HTML se apoia em três camadas independentes de defesa:

1. **`<iframe sandbox="">`** com uma lista de permissões vazia — sem scripts, sem mesma origem, sem formulários, sem popups. O sandboxing é aplicado apenas pelo atributo do iframe (o CSP via `<meta>` não é um sandbox conforme o MDN).
2. **Sanitização com DOMPurify** executada primeiro — remove `<script>`, URLs `javascript:`, manipuladores de eventos inline, truques de base-href.
3. **Injeção de CSP `<meta>`** — `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none';` — restringe o carregamento de recursos dentro do iframe.

O validador exibe tags de script, URLs `javascript:` e manipuladores de eventos inline como avisos para que você veja o que está sendo bloqueado. Depois que você [confia no arquivo](#previa-html-confiavel-opcional), eles passam a ser mostrados como informação, para que nada contradiga o banner de confiança. Duas mensagens dizem o que a prévia nunca permite, confiável ou não: um script externo (`<script src="…">`) nunca é carregado, já que nenhum script vem de um arquivo ou URL, e um link `javascript:` direcionado a outra janela ou à página de nível superior (`target="_top"`, `_blank` ou um `<base target>`) nunca navega, já que a prévia não pode sair de si mesma. A detecção lê as tags da página de forma aproximada; ela rotula as descobertas e nunca decide o que é executado — quem decide é o sandbox.

A aprovação formal de segurança desta prévia ainda está pendente, e a prévia avisa isso em um aviso acima da página renderizada: **A prévia HTML é isolada. A revisão de segurança ainda está em andamento.** As três camadas acima estão em vigor; a etapa que falta é confirmá-las contra os payloads XSS do OWASP dentro da webview do aplicativo em execução.

### Prévia HTML confiável (opcional)

A prévia segura acima é o padrão e nunca muda. Para um documento que você mesmo
escreveu — um laboratório interativo, um painel local, uma demonstração autocontida —
você pode autorizar a execução de scripts para **aquele único arquivo, nesta sessão**.

Use **Ativar pré-visualização confiável…** na barra acima da prévia. Primeiro você recebe
um aviso; nada é executado até você confirmar. Enquanto está ativa, a barra permanece visível
e diz **Confiável — scripts ativados**, e **Revogar confiança** fica a um clique de distância.

O que o modo confiável concede, e o que não concede:

| | Prévia confiável |
|---|---|
| JavaScript, DOM, eventos de ponteiro, `requestAnimationFrame`, Web Audio | ✅ executa |
| Rede (`fetch`, `XMLHttpRequest`, WebSocket, imagens/scripts remotos) | ❌ bloqueada por `default-src 'none'` |
| A própria página do VMark, comandos Tauri, seu sistema de arquivos | ❌ inacessíveis — o documento roda em uma origem opaca própria |
| Navegação de nível superior, popups, envio de formulários, downloads, modais | ❌ não concedidos (`sandbox="allow-scripts"` e nada mais) |
| Câmera, microfone, geolocalização, área de transferência | ❌ nenhum recurso é delegado ao frame |
| `localStorage` / `sessionStorage` | ❌ indisponíveis — uma origem opaca não tem armazenamento de mesma origem |
| `eval` / `new Function` | ❌ não permitidos |

Três propriedades que vale conhecer:

- **A confiança nunca é inferida.** Nem pela extensão `.html`, nem pela origem
  do arquivo, nem por um arquivo vizinho no qual você já confiou. Somente a
  confirmação a concede.
- **A confiança nunca é persistida.** Feche o VMark e todas as concessões desaparecem. Ela também
  fica indisponível para um documento não salvo, que não tem identidade à qual associar uma concessão
  — salve o arquivo primeiro.
- **Uma prévia confiável nunca se executa de novo sozinha.** Editar a fonte a marca como
  *Pode não corresponder ao código-fonte atual* e aguarda **Recarregar**, para que uma
  simulação em execução não seja reiniciada a cada tecla. A mesma marcação aparece quando
  o VMark não consegue saber o que o frame está executando — depois que você sai da
  aba e volta, ou a fecha e reabre, a prévia continua executando o que foi
  publicado por último para aquele arquivo, então ela avisa isso em vez de afirmar que está
  atualizada. **Recarregar** publica de novo o arquivo como ele está agora.

::: info O Windows a serve por uma origem http local
A WebView2 não tem esquemas de URL personalizados, então no Windows o documento confiável é servido
a partir de `http://vmark-trusted.localhost` em vez de `vmark-trusted://` — a mesma
concessão, o mesmo sandbox e o mesmo CSP, na forma de URL que o Tauri usa para todo
protocolo personalizado ali. A prévia segura funciona em todas as plataformas.
:::

O conteúdo confiável é servido a partir de uma origem `vmark-trusted://`
(`http://vmark-trusted.localhost` no Windows) com seu próprio CSP restritivo. Esse desvio é necessário, não decorativo: um
frame `srcdoc`, `blob:` ou `data:` herda a política `script-src 'self'` do próprio
VMark, e um CSP dentro do frame só pode restringir uma política herdada, nunca
relaxá-la — então nenhum atributo de iframe sozinho consegue fazer um script inline ser executado.

## Abrir no editor externo

Para arquivos de código, o botão **Abrir no editor externo** no banner de somente leitura inicia o editor de sua escolha. Ordem de resolução:

1. **Configurações → Formatos → Editor externo** (o campo da interface — veja [Configurações](/pt-BR/guide/settings#formatos)). Informe o **nome de um editor conhecido** (`code`, `cursor`, `zed`, `subl`, `bbedit`, `idea`, `vim`, `nvim`, `emacs`, `notepad++`, …) ou o **caminho completo** de um editor — um bundle `.app` no macOS, um executável no Linux/Windows. O campo contém um único programa, nunca argumentos; para passar argumentos, use `$VMARK_EXTERNAL_EDITOR`.
2. `$VMARK_EXTERNAL_EDITOR` (sobrescrita de ambiente por projeto)
3. `$VISUAL`
4. `$EDITOR`
5. Padrão da plataforma (`open -t` no macOS, `notepad.exe` no Windows, `xdg-open` no Linux)

A configuração da interface substitui variáveis de ambiente — explícito prevalece sobre implícito. Deixe o campo vazio para usar a cadeia de fallback de variáveis de ambiente.

O VMark roteia através de um PATH de login-shell para que wrappers do VS Code / Cursor / JetBrains sejam resolvidos corretamente quando iniciados em um app GUI do macOS.

### Barreira de segurança

A própria configuração **Editor externo** é verificada antes de qualquer execução. O VMark recusa:

- caracteres de shell (`;`, `|`, `&`, `` ` ``, `$`, `<`, `>`, aspas, quebras de linha) e um `-` inicial
- um nome simples que não seja um editor que o VMark conheça — *"“X” não é um editor que o VMark reconheça pelo nome: informe o caminho completo do editor"*
- um caminho relativo, um caminho com um segmento `..` ou uma barra final, ou um caminho que não existe
- um programa que executa os arquivos que recebe em vez de abri-los — um shell (`sh`, `bash`, `zsh`, `pwsh`, `cmd`, …), um interpretador (`python`, `node`, `ruby`, `perl`, `osascript`, …), um lançador (`env`, `sudo`, `open`, `xdg-open`, …) ou um emulador de terminal — verificado tanto pelo nome que você digitou quanto pelo nome para o qual um link aponta

As variáveis de ambiente da cadeia de fallback não são restritas: elas são definidas fora do VMark, por você.

O comando Tauri `open_in_external_editor` também rejeita:

- caminhos inexistentes
- diretórios e outros arquivos não regulares (sockets, dispositivos)
- caminhos cuja extensão canônica não esteja no conjunto de formatos registrados do VMark
- symlinks cujo alvo canônico falhe em qualquer uma das verificações acima

Uma webview comprometida não pode usar o botão para iniciar o editor externo em arquivos de sistema arbitrários (senhas, chaves, etc.) — apenas em caminhos que o próprio VMark abriria.

## O que não é suportado

Conforme os não-objetivos do plano:

- **Não é um editor de código.** Sem LSP, sem autocomplete, sem refatoração, sem depurador, sem indicadores git.
- **Não é "todo formato de texto simples."** Escopo delimitado — veja a tabela acima.
- **Sem execução de scripts HTML por padrão.** Apenas renderização em sandbox, a menos que você
  autorize explicitamente um arquivo pela [Prévia HTML confiável](#previa-html-confiavel-opcional).
- **Sem impressão / exportação / copiar como HTML para formatos não-markdown** na v1.
- **Ainda não suportados como visualizadores de código**: Zig, Swift, Kotlin, Java, Elixir, OCaml e outras linguagens fora do conjunto de 12 extensões. A regra de decisão é "linguagens que usamos" — abra uma issue se quiser que uma seja adicionada.

Se um formato que você deseja não está listado e não está deliberadamente fora do escopo, abra uma issue.
