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
| Dados — YAML | `.yaml`, `.yml` | sempre ativo | fonte + árvore | árvore navegável, com reconhecimento de esquema (GitHub Actions) |
| Dados — JSON | `.json`, `.jsonl` | requer a alternância **Formatos de dados** | fonte + árvore | árvore JSON navegável, com reconhecimento de esquema (`package.json`) |
| Dados — TOML | `.toml` | requer a alternância **Formatos de dados** | fonte + árvore | árvore navegável, com reconhecimento de esquema (`Cargo.toml`, `pyproject.toml`) |
| Diagramas | `.mmd` | requer a alternância **Diagramas e SVG** | fonte + renderização | diagrama Mermaid ao vivo |
| Vetorial | `.svg` | requer a alternância **Diagramas e SVG** | fonte + renderização | renderização inline sanitizada |
| Web | `.html`, `.htm` | requer a alternância **Prévia HTML** | fonte + renderização | iframe em sandbox (empty `sandbox=""`, DOMPurify, CSP) |
| Código (somente leitura) | `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua` | requer a alternância **Visualizadores de código** | visualizador (com opção de edição) | — |

Arquivos de código abrem por padrão em modo somente leitura com um banner oferecendo **Habilitar edição** ou **Abrir no editor externo**.

## Prévias com reconhecimento de esquema

Quando o caminho ou o conteúdo corresponde a um esquema conhecido, o VMark substitui a visualização genérica de árvore pela visualização correta.

### Workflow do GitHub Actions (`.github/workflows/*.yml`)

Abre com a visualização do workflow (DAG de jobs, gatilhos, permissões).

- Detecção por caminho: um arquivo `.yml` / `.yaml` em `.github/workflows/` é roteado para o renderizador de workflow — mesmo com YAML malformado, você vê a visualização degradada com diagnósticos em vez de uma árvore em branco. (O arquivo deve chegar primeiro ao adaptador YAML; isso requer a extensão `.yml`/`.yaml`.)
- Detecção por conteúdo: chaves de nível superior `on:` e `jobs:`.

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
- **Formatos de dados** (JSON, YAML, TOML) são exibidos no painel de fonte com marcadores de erro de parse na margem; a prévia de árvore é atualizada enquanto você digita. Ações de menu exclusivas do Markdown estão desabilitadas (formatação CJK, inserção de bloco, formatação de parágrafo); os controles relevantes para o modo permanecem ativos.
- **Formatos visuais** (Mermaid, SVG, HTML) são exibidos no painel de fonte com a visualização renderizada no painel direito (com debounce).
- **Formatos de código** abrem como visualizadores com realce de sintaxe; ative a edição no local ou abra no seu editor externo (veja abaixo).

## Localizar, salvar, pesquisa de conteúdo

- **Cmd+O** filtra: um único predefinido "Todos os Suportados" cobrindo todos os formatos registrados. Os filtros de Salvar Como e a extensão padrão de salvamento são derivados do adaptador de formato da aba ativa, então salvar um arquivo `.toml` propõe `.toml` como extensão.
- **Arrastar e soltar** aceita qualquer extensão registrada.
- **Salvar Como** — os filtros e a extensão padrão ao salvar são derivados do adaptador de formato da aba ativa.
- **Cmd+Shift+H** ("Localizar em Arquivos") indexa todos os formatos semelhantes a texto (markdown, txt, json, yaml, toml, html, svg, mermaid). Arquivos de código são excluídos por padrão — eles estão em modo de visualizador de código.

## Modelo de segurança para HTML

De acordo com o ADR-4 do plano multi-formato, a prévia HTML se apoia em três camadas independentes de defesa:

1. **`<iframe sandbox="">`** com uma lista de permissões vazia — sem scripts, sem mesma origem, sem formulários, sem popups. O sandboxing é aplicado apenas pelo atributo do iframe (o CSP via `<meta>` não é um sandbox conforme o MDN).
2. **Sanitização com DOMPurify** executada primeiro — remove `<script>`, URLs `javascript:`, manipuladores de eventos inline, truques de base-href.
3. **Injeção de CSP `<meta>`** — `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none';` — restringe o carregamento de recursos dentro do iframe.

O validador exibe tags de script, URLs `javascript:` e manipuladores de eventos inline como avisos para que você veja o que está sendo bloqueado.

## Abrir no editor externo

Para arquivos de código, o botão **Abrir no editor externo** no banner de somente leitura inicia o editor de sua escolha. Ordem de resolução:

1. **Configurações → Formatos → Editor externo** (o campo da interface — veja [Configurações](/pt-BR/guide/settings#formatos)). Escolha um bundle `.app` no macOS, um executável no Linux/Windows, ou qualquer coisa que seu shell resolva.
2. `$VMARK_EXTERNAL_EDITOR` (sobrescrita de ambiente por projeto)
3. `$VISUAL`
4. `$EDITOR`
5. Padrão da plataforma (`open -t` no macOS, `notepad.exe` no Windows, `xdg-open` no Linux)

A configuração da interface substitui variáveis de ambiente — explícito prevalece sobre implícito. Deixe o campo vazio para usar a cadeia de fallback de variáveis de ambiente.

O VMark roteia através de um PATH de login-shell para que wrappers do VS Code / Cursor / JetBrains sejam resolvidos corretamente quando iniciados em um app GUI do macOS.

### Barreira de segurança

O comando Tauri `open_in_external_editor` rejeita:

- caminhos inexistentes
- diretórios e outros arquivos não regulares (sockets, dispositivos)
- caminhos cuja extensão canônica não esteja no conjunto de formatos registrados do VMark
- symlinks cujo alvo canônico falhe em qualquer uma das verificações acima

Uma webview comprometida não pode usar o botão para iniciar o editor externo em arquivos de sistema arbitrários (senhas, chaves, etc.) — apenas em caminhos que o próprio VMark abriria.

## O que não é suportado

Conforme os não-objetivos do plano:

- **Não é um editor de código.** Sem LSP, sem autocomplete, sem refatoração, sem depurador, sem indicadores git.
- **Não é "todo formato de texto simples."** Escopo delimitado — veja a tabela acima.
- **Sem execução de scripts HTML.** Apenas renderização em sandbox.
- **Sem impressão / exportação / copiar como HTML para formatos não-markdown** na v1.
- **Ainda não suportados como visualizadores de código**: Zig, Swift, Kotlin, Java, Elixir, OCaml e outras linguagens fora do conjunto de 12 extensões. A regra de decisão é "linguagens que usamos" — abra uma issue se quiser que uma seja adicionada.

Se um formato que você deseja não está listado e não está deliberadamente fora do escopo, abra uma issue.
