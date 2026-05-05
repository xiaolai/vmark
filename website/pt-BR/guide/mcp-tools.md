# Referência de Ferramentas MCP

O VMark expõe **quatro ferramentas MCP compostas** para assistentes de IA: `session`, `workspace`, `document` e `workflow`. Juntas, elas cobrem **14 ações** — a espinha dorsal de leitura/escrita, o ciclo de vida de arquivos/janelas e edições seguras via CST para YAML do GitHub Actions.

A superfície anterior, com 12 ferramentas e 76 ações, foi reduzida porque as ferramentas de formatação dentro do documento (negrito, títulos, tabelas etc.) duplicam um trabalho que agentes de IA já fazem trivialmente via round-trip de Markdown. Veja [o plano de poda do MCP](https://github.com/xiaolai/vmark/blob/main/dev-docs/plans/20260504-mcp-pruning.md) para a justificativa completa.

::: tip Fluxo de trabalho recomendado
1. Chame `session.get_state` uma vez para ver janelas abertas, abas e, por aba, `{filePath, dirty, revision, kind}`.
2. Para Markdown: `document.read` → raciocinar → `document.write` (passando `expected_revision` para concorrência segura).
3. Para YAML do GitHub Actions (`kind: "yaml-workflow"`): `workflow.apply_patch` para edições seguras via CST que preservam comentários e âncoras; `workflow.validate` para diagnósticos do actionlint.
4. Operações de arquivo (abrir, salvar, fechar, alternar abas) ficam em `workspace`.
:::

::: tip Diagramas Mermaid
Ao usar IA para gerar Mermaid via MCP, considere instalar o [servidor MCP mermaid-validator](/pt-BR/guide/mermaid#mermaid-validator-mcp-server-syntax-checking) — ele captura erros de sintaxe usando os mesmos parsers do Mermaid v11 antes que os diagramas cheguem ao seu documento.
:::

---

## `session`

Orientação em uma única chamada. Descubra todas as janelas, todas as abas e as capacidades do servidor de uma só vez.

### `get_state`

Sem argumentos.

**Retorna** `{windows, capabilities}`:

```json
{
  "windows": [
    {
      "label": "main",
      "focused": true,
      "tabs": [
        {
          "id": "tab-1",
          "filePath": "/path/to/notes.md",
          "title": "notes",
          "dirty": false,
          "revision": "rev-x7Q3aB1F",
          "kind": "markdown"
        },
        {
          "id": "tab-2",
          "filePath": "/repo/.github/workflows/ci.yml",
          "title": "ci",
          "dirty": true,
          "revision": "rev-x7Q3aB1F",
          "kind": "yaml-workflow"
        }
      ]
    }
  ],
  "capabilities": {
    "version": "<vmark-mcp-server version>",
    "supportedKinds": ["markdown", "yaml-workflow"],
    "mcpProtocol": "0.1.0"
  }
}
```

O discriminador `kind` informa se você deve usar `document.write` (para markdown) ou `workflow.apply_patch` (para yaml-workflow) na aba correspondente.

---

## `workspace`

Ciclo de vida de arquivos e janelas. Nada que altere o conteúdo do documento.

### `new`

Cria uma nova aba sem título.

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `kind` | string | Não | `"markdown"` (padrão) ou `"yaml-workflow"` |
| `windowLabel` | string | Não | Janela alvo; padrão é a focada |

Retorna `{tabId}`.

### `open`

Abre um arquivo do disco.

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `filePath` | string | Sim |
| `windowLabel` | string | Não |

Retorna `{tabId}`.

### `save`

Salva uma aba em seu caminho atual.

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `tabId` | string | Não (padrão é a focada) |

Retorna `{filePath, revision}`.

### `save_as`

Salva uma aba em um novo caminho.

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `tabId` | string | Não |
| `filePath` | string | Sim |

Retorna `{revision}`.

### `close`

Fecha uma aba. Recusa-se a descartar trabalho não salvo sem `force`.

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `tabId` | string | Sim |
| `force` | boolean | Não |

Retorna `{closed: true}` em caso de sucesso, ou `{closed: false, reason: "DIRTY"}` se a aba estiver suja e `force` não foi fornecido.

### `switch_tab`

Ativa uma aba.

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `tabId` | string | Sim |

### `focus_window`

Foca uma janela.

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `windowLabel` | string | Sim |

---

## `document`

Ler, escrever, transformar. A espinha dorsal da superfície.

### `read`

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `tabId` | string | Não (padrão é a focada) |

Retorna `{content, revision, filePath, kind, dirty}`. Sempre leia antes de escrever — o token `revision` deve acompanhar o próximo `write`.

### `write`

Substitui o conteúdo completo do documento.

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `tabId` | string | Não | Aba alvo (padrão é a focada) |
| `content` | string | Sim | Novo conteúdo completo |
| `expected_revision` | string | Não | Token de revisão da leitura mais recente |

Se `expected_revision` for fornecido e o documento tiver mudado desde aquela leitura, a resposta é um envelope estruturado de erro `STALE` com a revisão atual; releia e tente novamente.

```json
// success
{ "revision": "rev-newAfterWrite" }

// stale
{ "error": "STALE", "message": "Document has changed since the last read", "current_revision": "rev-currentNow" }
```

### `transform`

Aplica uma reescrita determinística. Atualmente suporta transformações específicas de CJK (conversão de pontuação de largura total ↔ ASCII, espaçamento entre CJK e Latim).

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `tabId` | string | Não | Aba alvo |
| `kind` | string | Sim | `"cjk-format"`, `"cjk-spacing"` ou `"cjk-punctuation"` |
| `expected_revision` | string | Não | Token de concorrência |

`cjk-format` aplica as configurações de formatação CJK do usuário de ponta a ponta. `cjk-spacing` insere um único espaço entre caracteres CJK e Latim/dígitos adjacentes. `cjk-punctuation` converte pontuação ASCII adjacente a caracteres CJK para sua forma de largura total.

Retorna `{revision}`.

---

## `workflow`

Validação via `actionlint` e **edições cirúrgicas seguras via CST** para YAML de workflows do GitHub Actions. Disponível apenas para abas cujo `kind` seja `"yaml-workflow"`.

::: info `document.read` / `document.write` funcionam em qualquer aba — incluindo YAML de workflow
A ferramenta `workflow` **não** é um substituto da espinha de leitura/escrita. Para uma aba de workflow, você pode:

- usar `document.read` para obter o texto YAML bruto (com todos os comentários);
- usar `document.write` para substituí-lo por inteiro (a string que você enviar é armazenada literalmente — comentários preservados se você os incluir);
- usar `workflow.apply_patch` quando você quer **que o servidor garanta** que comentários, âncoras e ordem das chaves sobrevivam a uma edição parcial.

Use `apply_patch` quando alterar um único campo e deixar o resto intacto (o servidor não pode remover comentários que ele próprio não toca). Use `document.write` quando estiver reescrevendo do zero ou gerando um novo workflow integralmente.
:::

### `apply_patch`

Aplica um array de objetos `IRPatch`. Os patches são despachados pelos mutadores cientes do CST do VMark, que preservam comentários, âncoras e a ordem das chaves. Um `document.write` cru em um arquivo YAML perderia esses dados.

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `tabId` | string | Não |
| `patches` | IRPatch[] | Sim |
| `expected_revision` | string | Não |

`IRPatch` é uma união discriminada (campo `kind`). Tipos suportados:

| `kind` | Efeito |
|---|---|
| `workflow.set` | Define campos de nível superior (`{path, value}`) — `name`, `env.X` etc. |
| `job.set` | Define um campo em um job (`{jobId, path, value}`) |
| `step.set` | Define um campo em um step (`{jobId, stepIndex, path, value}`) |
| `with.set` | Define uma chave no bloco `with:` de um step (`{jobId, stepIndex, key, value}`) |
| `with.remove` | Remove uma chave do bloco `with:` de um step |
| `needs.add` / `needs.remove` | Adiciona ou remove um ID de job de `needs:` |
| `trigger.setFilters` | Substitui um array de filtros de trigger — branches, paths, types etc. (`{event, filter, value: string[]}`) |

Retorna `{revision}` em caso de sucesso ou um envelope estruturado de erro `STALE` / `INVALID_PATCH` / `NOT_WORKFLOW`.

### `validate`

Executa o `actionlint` sobre o YAML do workflow.

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `tabId` | string | Não |

Retorna `{ok, diagnostics, binaryAvailable}`. Cada diagnóstico carrega `{line, col, message, severity}`. `binaryAvailable: false` significa que o `actionlint` não está instalado localmente; instale-o via Homebrew ou nas releases upstream.

---

## Erros

Aparecem dois formatos de erro:

**Erros de domínio** — definem `success: false` e retornam um envelope codificado em JSON em `error`:

```json
{ "error": "STALE", "message": "...", "current_revision": "rev-..." }
```

**Erros de formato dos argumentos** — para argumentos obrigatórios faltando ou inválidos (por exemplo, `document.write` sem o campo `content`), `error` é uma string simples descrevendo o problema. O envelope estruturado é reservado para condições de domínio.

| Código | Apresentado como | Significado |
|---|---|---|
| `STALE` | envelope | `expected_revision` não combinou; releia e tente novamente |
| `INVALID_PATCH` | envelope | `workflow.apply_patch` recebeu um array `patches` malformado |
| `INVALID_TAB` | envelope | `tabId` não pôde ser resolvido |
| `INVALID_PATH` | envelope | `workspace.open` recebeu um `filePath` que não pôde ser lido |
| `NOT_WORKFLOW` | envelope | `workflow.*` foi chamado em uma aba que não é YAML de workflow |
| `READ_ONLY` | envelope | Foi tentada uma mutação em um documento somente leitura |
| `INTERNAL` | envelope | Erro inesperado no manipulador |
| (string simples) | string | Argumento obrigatório ausente ou de tipo errado |
