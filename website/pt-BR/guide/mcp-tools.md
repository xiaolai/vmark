# Referência de Ferramentas MCP

O VMark expõe **dez ferramentas MCP compostas** para assistentes de IA: `session`, `workspace`, `document`, `workflow`, `selection`, `comments`, `browser`, `browser_read`, `coherence` e `coherence_resolve`. Juntas, elas cobrem a espinha dorsal do editor, o ciclo de vida de arquivos/janelas, edições de workflow seguras via CST, edições direcionadas na seleção, navegação delimitada do navegador e uma visão da camada de coerência do workspace.

Três das dez — `session`, `browser_read` e `coherence` — declaram `readOnlyHint: true`, de modo que um cliente MCP pode aprová-las automaticamente. É por isso que `browser`/`browser_read` e `coherence`/`coherence_resolve` são ferramentas separadas: as anotações são **por ferramenta**, não por ação, então uma ferramenta que agrupa um snapshot ARIA com `execute_js` precisa anunciar o perigo do `execute_js`. Dividir segundo o critério "isto modifica algo?" permite que cada metade diga a verdade e mantém as ações genuinamente destrutivas da superfície bem visíveis na lista de ferramentas.

A superfície anterior, com 12 ferramentas e 76 ações, foi reduzida porque as ferramentas de formatação dentro do documento (negrito, títulos, tabelas etc.) duplicam um trabalho que agentes de IA já fazem trivialmente via round-trip de Markdown. A `selection` foi mantida (conforme o ADR-7 do plano de poda) porque o round-trip do documento inteiro é antieconômico em arquivos grandes — cada edição paga o documento inteiro em tokens de entrada, o documento inteiro em tokens de saída (~5× o preço da entrada) e uma janela de escrita mais longa que amplia o laço de repetição por revisão desatualizada. Veja [o plano de poda do MCP](https://github.com/xiaolai/vmark/blob/main/.claude/adr/plans/20260504-mcp-pruning.md) para a justificativa completa.

::: tip Fluxo de trabalho recomendado
1. Chame `session.get_state` uma vez para ver janelas abertas, abas e, por aba, `{filePath, dirty, revision, kind}`.
2. Para pequenas alterações em Markdown ou reescritas integrais: `document.read` → raciocinar → `document.write` (passando `expected_revision` para concorrência segura).
3. Para edições direcionadas em um arquivo Markdown grande quando o usuário já selecionou a região a alterar: `selection.get` → raciocinar → `selection.set` (reduz o custo em tokens de entrada e saída ao tamanho da seleção).
4. Para YAML do GitHub Actions (`kind: "yaml-workflow"`): `workflow.apply_patch` para edições seguras via CST que preservam comentários e âncoras; `workflow.validate` para diagnósticos do actionlint.
5. Operações de arquivo (abrir, salvar, fechar, alternar abas) ficam em `workspace`.
:::

::: tip Diagramas Mermaid
Ao usar IA para gerar Mermaid via MCP, considere instalar o [servidor MCP mermaid-validator](/pt-BR/guide/mermaid#servidor-mcp-mermaid-validator-verificacao-de-sintaxe) — ele captura erros de sintaxe usando os mesmos parsers do Mermaid v11 antes que os diagramas cheguem ao seu documento.
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
      "activeWorkspaceInstanceId": "wsi-a1b2c3",
      "tabs": [
        {
          "id": "tab-1",
          "filePath": "/path/to/notes.md",
          "title": "notes",
          "dirty": false,
          "revision": "rev-x7Q3aB1F",
          "kind": "markdown",
          "active": true,
          "visible": true
        },
        {
          "id": "tab-2",
          "filePath": "/repo/.github/workflows/ci.yml",
          "title": "ci",
          "dirty": true,
          "revision": "rev-x7Q3aB1F",
          "kind": "yaml-workflow",
          "active": false,
          "visible": false
        }
      ]
    }
  ],
  "capabilities": {
    "version": "<vmark-mcp-server version>",
    "supportedKinds": ["markdown", "yaml-workflow"],
    "mcpProtocol": "0.2.0"
  }
}
```

#### Sabendo o que está de fato na tela

Uma aba pode existir, ser endereçável e ainda assim não estar visível. Três campos indicam isso:

| Campo | Significado |
|---|---|
| `tab.active` | Esta aba é a aba atual da sua janela. |
| `tab.visible` | Esta aba é renderizada neste momento. É `false` quando a aba pertence a uma instância de workspace que a janela não está exibindo no momento. |
| `window.activeWorkspaceInstanceId` | A instância de workspace que a janela está exibindo, ou `null` quando a barra de workspaces está desativada (nesse caso, todas as abas ficam visíveis). |

`window.focused` é a janela para a qual o **usuário** está olhando, lida a partir do sistema operacional. Não é "a janela que respondeu a esta requisição" — o VMark encaminha uma requisição para a janela que detém o workspace relevante, que em uma sessão com várias janelas frequentemente é outra.

`windows` lista todas as janelas de documento — `main` e cada janela aberta pelo Finder ou pela linha de comando —, porque o VMark consulta todas elas. Enquanto você digita no seu cliente de IA, nenhuma janela do VMark tem o foco e todo `focused` é `false`; uma requisição sem `tabId` nem caminho de workspace vai então para a última janela de documento que você usou, não para `main`.

Trate esses campos como a etapa de confirmação: depois de `workspace.switch_tab`, um `get_state` de acompanhamento diz se a aba está mesmo à frente do usuário. O próprio `switch_tab` relê os stores antes de responder, então relata `activated: false` quando uma ativação não ocorreu, em vez de apenas repetir a requisição.

O discriminador `kind` informa se você deve usar `document.write` (para markdown) ou `workflow.apply_patch` (para yaml-workflow) na aba correspondente.

---

## `workspace`

Ciclo de vida de arquivos e janelas. Nada que altere o conteúdo do documento.

> **Escopo de caminhos.** As operações de arquivo (`open`, `save`, `save_as`)
> ficam confinadas à raiz do workspace aberto e aos diretórios de documentos já
> abertos. Uma requisição para um caminho fora desse escopo é recusada com
> `INVALID_PATH`. Sem workspace e sem documento aberto, não há escopo, então as
> operações de arquivo são recusadas. Isso mantém um cliente automatizado agindo
> dentro do que você abriu.

### `new`

Cria uma nova aba sem título.

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `kind` | string | Não | `"markdown"` (padrão) ou `"yaml-workflow"` |
| `windowLabel` | string | Não | Janela alvo; padrão é a focada |

Retorna `{tabId}`.

### `open`

Abre um **arquivo** do disco em uma aba em **segundo plano** — a aba visível do
usuário e o workspace não mudam. Encadeie o `tabId` retornado em chamadas a
`document` / `selection`; use `switch_tab` apenas quando o usuário deva *ver* a aba.

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `filePath` | string | Sim |
| `windowLabel` | string | Não |

Retorna `{tabId, workspaceInstanceId, activationChanged, workspaceSwitched}`.

### `open_workspace`

Abre uma **pasta** como o workspace ativo. Diferentemente de `open` (um único
arquivo dentro de uma árvore já consentida), isto concede ao assistente acesso a
uma árvore de arquivos inteiramente nova, portanto é **condicionado a uma
aprovação única do usuário** e não é coberto pelo escopo de caminhos acima.

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `folderPath` | string | Sim |

`windowLabel` **não** é aceito aqui, ao contrário de `new` e `open`. A pasta
sempre abre na janela em que a requisição chega. Isso é deliberado: o diálogo de
aprovação e a abertura precisam ocorrer na mesma janela, e um rótulo fornecido
pelo cliente poderia colocar o aviso à frente de uma janela enquanto altera
outra — aprovando uma coisa e obtendo outra. O direcionamento para múltiplas
janelas exige um roteamento de requisições que ainda não existe.

**Fluxo de aprovação.** A primeira chamada retorna `{needsApproval: true}` e abre
um diálogo de consentimento que nomeia o caminho *canônico* da pasta (com links
simbólicos resolvidos). O assistente deve perguntar ao usuário e então **repetir a
mesma chamada**; uma vez que o usuário aprove, a repetição abre a pasta. A aprovação pertence à conexão que a pediu: só uma nova tentativa da mesma conexão MCP pode usá-la. Outro assistente conectado recebe o seu próprio pedido, e um cliente que se reconectou (uma nova conexão) precisa ser aprovado de novo. A aprovação também expira se não for usada em cinco minutos. Uma
requisição negada continua falhando até ser reaprovada. Não há opção de
"lembrar" — cada abertura é aprovada individualmente.

**Acesso a pastas.** Aprovar o diálogo não basta para o VMark ler uma pasta fora dos locais que ele sempre pode ler (sua pasta pessoal e os volumes montados). Para uma pasta assim, a nova tentativa aprovada abre o seletor de pastas do VMark nessa pasta e responde `APPROVAL_REQUIRED`, pedindo ao usuário que a escolha lá; depois disso, a tentativa seguinte a abre. Se outro diálogo de pastas já estiver aberto, nada é mostrado e a resposta é `BUSY` — a aprovação é mantida, então tente de novo quando o usuário fechar aquele diálogo. `BUSY` também é a resposta enquanto uma troca de espaço de trabalho já estiver em andamento nessa janela.

### `save`

Salva uma aba em seu caminho atual.

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `tabId` | string | Não (padrão é a focada) |

Retorna `{filePath, revision, journaled}`.

### `save_as`

Salva uma aba em um novo caminho.

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `tabId` | string | Não |
| `filePath` | string | Sim |

Retorna `{revision, journaled}`.

Salvar em um caminho diferente do arquivo atual da própria aba é tratado como uma
nova escrita. Quando **Aprovar automaticamente salvamentos em um novo local e
resultados de gênios** (Configurações → Integrações) está desativado (o padrão), essa requisição é recusada com
`APPROVAL_REQUIRED` e um aviso informa o que foi bloqueado. Salvar de volta no
próprio caminho da aba é sempre permitido.

A verificação do caminho é feita de novo quando chega a vez do salvamento na fila de salvamentos daquele arquivo. Um caminho que até lá saiu do escopo permitido (por exemplo, o workspace foi fechado enquanto o salvamento esperava) é recusado com `INVALID_PATH`, e nada é gravado.

`save_as` nunca substitui um arquivo que não seja o da própria aba. Um destino que já contém um arquivo é recusado com `APPROVAL_REQUIRED` — inclusive um arquivo criado depois da verificação da solicitação, enquanto o salvamento estava em andamento: o arquivo só é gravado se não houver nada naquele caminho no momento em que é colocado no lugar, e o arquivo encontrado ali mantém seu conteúdo. Se o disco não puder gravar dessa forma, o salvamento é recusado em vez de sobrescrever.

Um `save` ou `save_as` é recusado com `STALE` quando um salvamento feito depois deste — a partir de qualquer documento ou janela — já chegou àquele arquivo (por exemplo, por meio de um link simbólico e do arquivo para o qual ele aponta), então este, mais antigo, não gravou nada. Releia o documento antes de gravar novamente. `document.write` informa o mesmo caso como `saved: false` com um `save_error`.

### `close`

Fecha uma aba de documento. Recusa-se a descartar trabalho não salvo sem `force` e nunca fecha uma aba fixada.

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `tabId` | string | Sim |
| `force` | boolean | Não |

Retorna `{closed: true}` em caso de sucesso. Caso contrário, `{closed: false, reason}`:

| `reason` | Significado |
|----------|-------------|
| `DIRTY` | A aba tem alterações não salvas e `force` não foi fornecido |
| `DIVERGENT` | O arquivo mudou no disco e o usuário manteve a versão da aba; sem `force`, o fechamento a perderia |
| `PINNED` | A aba está fixada — recusado mesmo com `force`; o usuário precisa desafixá-la |

As teclas que o editor ainda não repassou são contadas como não salvas antes da verificação. Uma aba de navegador é recusada com um erro `INVALID_TAB` — feche-a com a ação `close` da ferramenta `browser`.

### `switch_tab`

Ativa uma aba e a torna **visível**. Com a [barra de workspaces](/pt-BR/guide/workspace-rail)
ativada, isto pode alternar o contexto de workspace ativo do usuário — a resposta
relata `workspaceSwitched: true` quando isso acontece, então o assistente deve
avisar o usuário.

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `tabId` | string | Sim |

Retorna `{activated, workspaceSwitched, workspaceInstanceId, activeTabId}`.

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
| `addresses` | string[] | Não | Ids de comentários de `comments.list` que esta edição responde (no máximo 64) |
| `save` | boolean | Não | Também salva no disco (padrão `true`); `false` altera apenas a aba |

Por padrão, a escrita é salva: a resposta traz `saved: true`, ou `saved: false` com `save_skipped` (`"untitled"` — a aba ainda não tem arquivo, use `save_as`; `"opt_out"` — você passou `save: false`) ou `save_error` (a gravação em disco falhou). Quando o alvo é a aba WYSIWYG ativa de um documento Markdown, o texto é carregado no editor ao vivo (como um único passo desfazível), e o que é salvo é a serialização do editor — o mesmo Markdown, possivelmente normalizado, não necessariamente os caracteres exatos enviados. As demais abas salvam o texto como enviado, com as quebras de linha normalizadas.

Se a aba for fechada depois que a escrita a alterou, mas antes de o salvamento ser executado, a resposta é `saved: false` com um `save_error` informando que a aba foi fechada. Nada é gravado no caminho que a aba tinha.

Todo salvamento feito por um cliente de IA — por `write`, `workspace.save` ou `workspace.save_as` — é registrado no histórico do documento como um snapshot `mcp` (rotulado *(mcp)* na barra lateral de Histórico), para que as versões escritas por uma IA se destaquem das suas. Assim como um salvamento manual, ele nunca é mesclado a um salvamento automático vizinho nem ignorado pelo tamanho.

Toda resposta de salvamento também traz `journaled` — em `write`, só quando houve salvamento. `"yes"`: o diário de edições de agentes do VMark registrou o texto salvo. `"pending"`: está registrado e assume seu lugar no histórico do documento quando uma escrita ainda em registro terminar. `"no"`: o arquivo está salvo, mas o diário não o registrou. Um salvamento nunca é um erro por causa do diário.

Se `expected_revision` for fornecido e o documento tiver mudado desde aquela leitura, a resposta é um envelope estruturado de erro `STALE` com a revisão atual; releia e tente novamente.

```json
// success
{ "revision": "rev-newAfterWrite", "applied": true, "durable": true, "saved": true }

// stale
{ "error": "STALE", "message": "Document has changed since the last read", "current_revision": "rev-currentNow" }
```

Enquanto o usuário compõe texto com um método de entrada (IME) no editor que mostra a aba, no modo WYSIWYG ou no modo Fonte, a escrita é recusada com `BUSY` e nada muda: o texto em composição pertence ao método de entrada até ser confirmado. Um editor do modo Fonte também é tratado como em composição durante um breve período de tolerância logo depois que a composição termina. Tente de novo em instantes.

Toda escrita é registrada no diário de edições de agentes do VMark antes que algo mude. A resposta de sucesso traz `applied: true` e `durable`: `durable: false` significa que o conteúdo foi escrito, mas o registro dele no diário ainda não pôde ser gravado — o VMark tenta de novo em segundo plano e, até conseguir, a próxima escrita nesse documento é recusada com `JOURNAL_DEGRADED`. Se o diário recusar o registro de vez, a escrita continua aplicada, fica no log como não registrada e a próxima escrita segue normalmente. Uma escrita é recusada, sem mudar nada, com `JOURNAL_BUSY` enquanto outra escrita no mesmo documento está sendo registrada (duas janelas com o mesmo arquivo compartilham um documento), com `STALE_PARENT` quando outra janela escreveu o documento depois da última escrita desta aba (leia de novo e tente outra vez), com `JOURNAL_UNAVAILABLE` quando o diário não está em execução ou não responde a tempo, e com `INVALID_TEXT` quando `content` contém um substituto UTF-16 isolado. Se o usuário editar o documento, fechar a aba, começar a compor com um método de entrada ou mover a seleção (ou trocar de aba, quando nenhum `tabId` foi informado) enquanto a escrita está sendo registrada, ela é recusada com `ABORTED` e um `reason` (`edited`, `closed`, `composing`, `selection`) e nada muda; leia de novo e tente outra vez. Um erro `INTERNAL` que traz `applied: true` é diferente: o editor falhou depois que a escrita já havia alterado o documento, e o texto que ele continha naquele momento foi registrado (`durable` como acima, `current_revision` é a revisão do documento); leia de novo antes de escrever outra vez. Um erro `INTERNAL` sem `applied` após uma escrita que falhou significa que o documento pode ter sido alterado em parte; leia-o de novo também.

### `transform`

Aplica uma reescrita determinística. Atualmente suporta transformações específicas de CJK (conversão de pontuação de largura total ↔ ASCII, espaçamento entre CJK e Latim).

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `tabId` | string | Não | Aba alvo |
| `kind` | string | Sim | `"cjk-format"`, `"cjk-spacing"` ou `"cjk-punctuation"` |
| `expected_revision` | string | Não | Token de concorrência |
| `addresses` | string[] | Não | Ids de comentários de `comments.list` que esta edição responde (no máximo 64) |

`cjk-format` aplica as configurações de formatação CJK do usuário de ponta a ponta. `cjk-spacing` insere um único espaço entre caracteres CJK e Latim/dígitos adjacentes. `cjk-punctuation` converte pontuação ASCII adjacente a caracteres CJK para sua forma de largura total.

Retorna `{revision, applied, durable}`. Assim como `write`, é recusado com `BUSY`, sem mudar nada, enquanto o usuário compõe com um método de entrada no editor que mostra a aba, no modo WYSIWYG ou no modo Fonte. Assim como `write`, a chamada é registrada no diário de edições de agentes do VMark antes que algo mude: `applied`, `durable` e as recusas do diário (`JOURNAL_BUSY`, `STALE_PARENT`, `JOURNAL_DEGRADED`, `JOURNAL_UNAVAILABLE`, `INVALID_TEXT`, `ABORTED`) significam o mesmo; uma chamada que não muda nada não é registrada.

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
| `addresses` | string[] | Não |

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

Retorna `{revision, applied, durable}` em caso de sucesso ou um envelope estruturado de erro `STALE` / `INVALID_PATCH` / `NOT_WORKFLOW`. Assim como `write`, a chamada é registrada no diário de edições de agentes do VMark antes que algo mude: `applied`, `durable` e as recusas do diário (`JOURNAL_BUSY`, `STALE_PARENT`, `JOURNAL_DEGRADED`, `JOURNAL_UNAVAILABLE`, `INVALID_TEXT`, `ABORTED`) significam o mesmo; uma chamada que não muda nada não é registrada.

### `validate`

Executa o `actionlint` sobre o YAML do workflow.

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `tabId` | string | Não |

Retorna `{ok, diagnostics, binaryAvailable}`. Cada diagnóstico carrega `{line, col, message, severity}`. `binaryAvailable: false` significa que o `actionlint` não está instalado localmente; instale-o via Homebrew ou nas releases upstream.

---

## `selection`

Lê ou substitui a seleção atual do editor do usuário. Use isto em vez de `document.read`/`document.write` quando o usuário tiver destacado a região a alterar — `selection.get` retorna apenas o trecho selecionado, e `selection.set` reescreve apenas esse intervalo, então o custo em tokens acompanha a edição, não o documento.

::: warning A seleção é estado de visualização — apenas a aba focada
A seleção só existe no editor que está renderizado no momento. Se `tabId` for fornecido, ele deve corresponder à aba focada; uma divergência retorna `INVALID_TAB`. Se a aba focada não tiver um editor ativo (por exemplo, um visualizador somente leitura), a resposta é `NO_EDITOR`.
:::

### `get`

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `tabId` | string | Não |

Retorna:

| Campo | Tipo | Observações |
|---|---|---|
| `text` | string | Serialização em Markdown do trecho selecionado (modo WYSIWYG), ou texto selecionado bruto (modo de código-fonte). String vazia quando recolhida. |
| `isEmpty` | boolean | `true` quando a seleção está recolhida (apenas o cursor). |
| `range` | `{from, to}` | Posições do ProseMirror no modo WYSIWYG; deslocamentos de caractere no modo de código-fonte. |
| `mode` | `"wysiwyg"` \| `"source"` | Desambigua o espaço de posições de `range`. |
| `kind` | `"markdown"` \| `"yaml-workflow"` | Discriminador do tipo de documento. |
| `tabId` | string | Repetido para confirmação. |
| `revision` | string | Passe de volta para `set` para concorrência otimista. |

### `set`

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `tabId` | string | Não |
| `content` | string | Sim |
| `expected_revision` | string | Não (recomendado) |
| `addresses` | string[] | Não |

Substitui o que quer que o editor reporte como a seleção atual. **No modo WYSIWYG**, texto inline simples é inserido como um nó de texto literal, de modo que espaços em branco no início/fim são preservados exatamente no round-trip; conteúdo que carrega marcadores de markdown (`**bold**`, `*italic*`, `` `code` ``, código cercado, blockquotes, listas etc.) é interpretado como markdown e inserido como os nós correspondentes. **No modo de código-fonte**, `content` é sempre inserido como texto bruto — a superfície de código-fonte já é bytes de markdown. Um `content` vazio exclui a seleção. Quando a seleção está recolhida, `content` é inserido na posição do cursor.

Retorna `{revision, replaced_chars, applied, durable}` em caso de sucesso. `replaced_chars` é o comprimento do texto que estava selecionado antes da chamada — útil para a IA confirmar que editou o que esperava. Assim como `write`, a chamada é registrada no diário de edições de agentes do VMark antes que algo mude: `applied`, `durable` e as recusas do diário (`JOURNAL_BUSY`, `STALE_PARENT`, `JOURNAL_DEGRADED`, `JOURNAL_UNAVAILABLE`, `INVALID_TEXT`, `ABORTED`) significam o mesmo; uma chamada que não muda nada não é registrada.

`STALE` retorna `{error: "STALE", message, current_revision}` exatamente como `document.write`. A revisão em nível de documento captura as teclas pressionadas entre `get` e `set`. O movimento puro do cursor (sem pressionar uma tecla) não é arbitrado pelo servidor — se o usuário moveu o cursor entre `get` e `set`, a edição ocorre na nova posição.

`set` retorna `BUSY`, sem mudar nada, enquanto o usuário compõe texto com um método de entrada no editor em foco, no modo WYSIWYG ou no modo Fonte; tente de novo em instantes. `get` nunca é recusado por isso.

---

## `comments`

Lê e responde os comentários de revisão do usuário em um documento. Resolver, reabrir e excluir um comentário são decisões do usuário: a ferramenta não tem essas ações, e uma chamada que pede uma delas é recusada antes de chegar ao VMark.

### `list`

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `tabId` | string | Não |
| `cursor` | string | Não |

Retorna `{doc, generation, threads, nextCursor?}`, com a thread mais antiga primeiro. Cada thread traz seu id `comment`, seu `state` (`open`, `addressed`, `resolved` ou `reopened`), seu `commentGen`, o texto citado ao qual está ancorada e suas respostas.

Uma lista longa chega em páginas, cada uma pequena o bastante para chegar inteira. Enquanto houver `nextCursor`, chame `list` de novo com `cursor` igual a esse valor. Uma thread dividida entre páginas traz `repliesFrom` e `repliesTotal`; suas partes seguintes trazem apenas `comment`, `state`, `commentGen`, `continued: true` e as próximas respostas. Um corpo longo demais para qualquer página como texto JSON (só texto com muitos escapes) chega como `bodyBase64`, seus bytes UTF-8 em base64, no lugar de `body`. Um cursor cuja thread foi excluída, ou um emitido para outro documento, é recusado com `STALE_COMMENT`: liste de novo sem cursor.

### `reply`

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `tabId` | string | Não |
| `commentId` | string | Sim |
| `body` | string | Sim |
| `expectedCommentGen` | string | Sim |

Adiciona uma resposta à thread. O VMark gera o id da resposta, então uma chamada repetida recebe o primeiro resultado e nunca adiciona uma segunda resposta.

### `mark_addressed`

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `tabId` | string | Não |
| `commentId` | string | Sim |
| `expectedCommentGen` | string | Sim |

Marca a thread como atendida. Resolvê-la continua sendo decisão do usuário.

`comments.reply` e `comments.mark_addressed` informam ambos o `commentGen` da thread como `list` o retornou. Elas são recusadas, sem mudar nada, com `STALE_COMMENT` quando a thread mudou ou foi excluída desde então (liste de novo), `INVALID_COMMENT` quando o id do comentário está malformado ou não indica nenhum comentário deste documento, `COMMENT_NOT_ALLOWED` quando a thread está resolvida, `COMMENT_LIMIT` quando a thread tem respostas demais, o texto é longo demais ou a thread não pode mais mudar, e com as recusas do diário `JOURNAL_BUSY`, `JOURNAL_DEGRADED`, `JOURNAL_UNAVAILABLE` e `INVALID_TEXT`.

Para indicar que uma edição responde a comentários, passe os ids deles como `addresses` para `document.write`, `document.transform`, `workflow.apply_patch` ou `selection.set`. O vínculo é registrado com a revisão e mostrado no histórico do documento (um comentário excluído depois aparece como comentário excluído); ele não move nenhuma thread. Mais de 64 ids, um id repetido ou um id desconhecido, excluído, resolvido ou de outro documento é recusado com `INVALID_ADDRESSES`, e nada muda.

---

## `browser`

A metade **mutante** da superfície do navegador integrado — tudo que altera a página,
a aba ou um login armazenado. Leia a página primeiro com [`browser_read`](#browser-read):
todo modo de segmentação aqui se refere ao que uma leitura retornou.

As ferramentas do navegador seguem **Configurações → Avançado → macOS → Navegador incorporado**, que está **ativado por padrão** no macOS — então essas ferramentas
ficam disponíveis para um cliente de IA conectado, a menos que você o desative.
Toda ação falha com `BROWSER_DISABLED` enquanto estiver desativado. As URLs
retornadas ao MCP são ocultadas pela mesma fronteira usada pelo estado da sessão de
navegador do aplicativo.

Anotada como `readOnlyHint: false, destructiveHint: true` — preciso, e não meramente
conservador, porque toda ação aqui altera algo.

**Os erros são tipados.** Uma recusa chega como `TOKEN: message` (`STALE_COMMAND`,
`NOT_GRANTED`, `EVAL_TIMEOUT`, `TAB_LIMIT`, …) com o mesmo token — e quaisquer dados
estruturados que o aplicativo anexou (um ticket de navegação, o `reason` de um act, o verbo
de nova tentativa) — em `structuredContent`. Compare pelo token, não pelo texto.

Um `EVAL_TIMEOUT` é **indeterminado**, não uma falha limpa: o script enviado pode ter sido
executado até o fim depois que o driver parou de esperar, então ele carrega
`data.detail.indeterminate: true` e não deve ser repetido como se nada tivesse acontecido —
leia a página (`browser_read`) para saber em que estado ela está antes de agir de novo.

### `act`

Argumentos: `tabId?`, `operation: "click" | "type" | "scroll" | "key"` e alvos por
operação:

- **click / type** — um alvo, seja `ref` (de uma leitura anterior) **ou** `role` + `name`,
  e `text?` para digitação. Um `ref` é preciso e independente de ordem, mas só é honrado
  para uma operação **já concedida**; se a ação puder exigir aprovação, use `role` + `name`
  para que o aviso mostre ao usuário um elemento legível.
- **scroll** — `ref` (para trazê-lo à vista) **ou** `dy` (um deslocamento vertical em pixels).
- **key** — `key` (por exemplo, `"Enter"`, `"Escape"`, `"Tab"`), `ref` opcional para o alvo
  e `modifiers: {ctrl, shift, alt, meta}` opcionais.

`scroll` e `key` são da classe act (condicionadas a aprovação) e despacham eventos
**sintéticos** do DOM, então um site que se baseia em `event.isTrusted` pode ignorá-los.
Operações mutantes exigem uma aprovação com escopo de origem; uploads escolhidos pela IA
nunca são permitidos.

**Um clique verifica seu efeito antes de relatar sucesso e recusa em vez de
adivinhar.** O alvo é trazido à vista, precisa estar renderizado de forma visível (estilos
computados e ancestrais recolhidos ou transparentes são verificados, então um botão duplicado
dentro de um passo de acordeão fechado é ignorado, não clicado), e o ponto de clique passa por
hit-test — um alvo coberto por uma sobreposição é recusado com o oclusor nomeado
(`covered by div.cmp-overlay`, dados da página) em vez de clicado por baixo. Quando vários
elementos visíveis compartilham o role e o name, o act é recusado como `ambiguous` e
`candidates` lista seus refs — ele nunca escolhe um pela ordem no documento. Outros motivos de
recusa: `hidden`, `offscreen` (não pode ser rolado para dentro da viewport), `disabled`
(incluindo `pointer-events: none` e subárvores inertes), `upload` (campos de arquivo nunca são
automatizados) e `rejected-value` (o campo sanitizou o texto). Shadow roots abertos são
percorridos; a resposta inclui as contagens `matchedTotal` / `matchedVisible`, a `url` e a
`generation` atuais da aba em caso de sucesso **e** de falha, e `popup: {url}` quando a página
tentou abrir uma janela durante o act (o VMark bloqueia popups; a URL é o que ela queria
abrir). `type` lida com campos de texto, controles `<select>` (passe o rótulo ou o valor da
opção; uma opção ausente é recusada como `no-such-option`) e regiões `contenteditable`. `key`
emula as ações padrão que faltam aos eventos sintéticos — Enter dentro de um formulário o
envia, Tab move o foco — e informa `defaultAction`.

**O que uma aprovação vincula.** Uma aprovação de `click` vincula o elemento (role + name).
Uma aprovação de `type`, `key` ou `scroll` também vincula o texto, a tecla (com modificadores)
ou o deslocamento exatos que você pediu — o aviso os mostra —, então uma nova tentativa com
conteúdo diferente pede aprovação de novo.

### `workflow_run` / `workflow_cancel`

`workflow_run` executa um workflow que você fornece como texto em `source` numa aba
pertencente à IA. Argumentos: `tabId?`, `source` (o texto do workflow — uma pequena gramática
orientada a linhas; você o escreve, a IA o faz, ou [`workflow_record`](#workflow-record) o
captura a partir das suas próprias ações), `inputs?` (um mapa `{name: value}` substituído nas
referências `{name}`; toda entrada declarada precisa ser fornecida e as não declaradas são
recusadas), `allowRepeat?` e `resumeRunId?` (veja abaixo). Retorna `{runId, steps, firstStep}`
**imediatamente** — a execução ocorre de forma **assíncrona**, porque uma execução com vários
passos pode durar mais que uma única requisição. Consulte o `workflow_status` de
[`browser_read`](#browser-read) para acompanhar o progresso; enquanto a execução espera por
você, ele informa `pendingApproval`.

Passos determinísticos — `click` / `type` / `navigate` nessa gramática, e `extract` — são
executados dentro do VMark e são **individualmente condicionados a aprovação**, exatamente como
um `act` emitido manualmente: a execução autoriza cada um por conta própria, então um workflow
não é uma forma de contornar os avisos de aprovação. `goal`, `confirm`, `api` e qualquer passo
em prosa livre **pausam** a execução para a IA tratar manualmente. **Retomando após uma
pausa:** faça o passo pausado (ou peça ajuda à IA) e então inicie uma nova execução com
`resumeRunId` definido como a execução pausada — ela herda os passos concluídos e trata o passo
pausado como feito, então nada é enviado duas vezes. Uma reexecução com **o mesmo source e as
mesmas entradas** também pula os passos de escrita que já tiveram sucesso nesta sessão (o
registro de escritas concluídas; os passos pulados são informados como `skipped`), a menos que
`allowRepeat` esteja definido. Entradas diferentes são um trabalho diferente e são executadas
por completo.

`workflow_cancel {tabId?, runId}` interrompe uma execução. **Nunca é condicionado a
aprovação** — parar é sempre permitido — e retira os avisos pendentes da execução, aborta um
passo que esteja esperando sua aprovação e devolve a aba a você. Uma execução já terminada
informa `already-terminal` e fica como estava; um `runId` desconhecido é `RUN_NOT_FOUND`. A
execução também para no instante em que você assume o controle do navegador (qualquer interação
com a página ou com seus controles reivindica o controle) — inclusive enquanto espera um aviso.

As execuções são limitadas (≤ 25 passos, `source` ≤ 64 KiB e 120 s de tempo **em execução** —
o tempo gasto esperando por você não conta) e uma de cada vez por aba.

### `workflow_record`

Grava **suas próprias ações** em uma aba pertencente à IA, transformando-as em um workflow
reproduzível. Argumentos: `tabId?`, `recordOp` (`"start"` ou `"stop"`) e `site?` (o id de site
do front-matter do workflow gravado; o padrão é `recording`).

`start` é **condicionado ao seu consentimento** pela permissão `record`, que — assim como
`execute_js` e `session` — **nunca é uma concessão permanente**: cada gravação pede sua
autorização de novo, de modo que a IA nunca pode gravá-lo silenciosamente. Até você permitir,
`start` retorna `needsApproval`; assim que você permite, o VMark prepara um shim de captura
dormente no mundo da página e começa a gravar os **cliques e edições de campos** que você
realiza. `stop` retorna `{source, inputs, eventCount}` — o `source` é texto de workflow que
você pode salvar ou passar diretamente para [`workflow_run`](#workflow-run-workflow-cancel).

A gravação é **livre de valores por construção**, e isso não é um filtro que confia na página:
nada do que você digita chega a ser capturado. Todo campo de texto vira uma variável `{input}`
nomeada (o valor é fornecido na reprodução, nunca gravado); um **campo de senha ou de código de
uso único** vira um passo `confirm:` — uma etapa manual que você completa à mão na reprodução —
de modo que um segredo nunca é sequer parametrizado; e toda URL é reduzida a origem + caminho,
então um token em uma query string não sobrevive. O que é gravado são os **localizadores** que
você tocou (papel ARIA + nome acessível), nunca seus dados. A gravação acompanha você através
das navegações de página e é limitada (200 eventos por página, 1.000 por sessão).

### `open`

Argumentos: `url`, `timeoutMs` opcional (1–9.000 ms) e `profile` opcional
(`[A-Za-z0-9._-]`, macOS 14+, postura Sandbox): um **contexto persistente nomeado**, para que um
login possa ser reutilizado pelo nome — abrir um exige uma aprovação nova a cada uso, e a IA
nunca vê as credenciais. Cria uma aba pertencente à IA usando a postura Sandbox ou Compartilhada
atual, traz a aba para a frente e retorna seu `tabId`, `navigationId`, URL, título e generation
após a conclusão do carregamento. No máximo **8 abas pertencentes à IA** podem estar abertas
(`TAB_LIMIT`); a IA fecha as que não usa mais. Na postura Compartilhada, um `open` que precisa
da sua aprovação de destino mantém a aba e diz à IA para tentar de novo com `navigate` naquele
`tabId` (`data.retry`) — um `open` novo criaria uma aba que a aprovação não consegue cobrir.

### `navigate`

Argumentos: `tabId?`, `url` e `timeoutMs` opcional. Navega uma aba pertencente à IA (trazendo-a
para a frente) e retorna o resultado do ticket de navegação. Um `TIMEOUT` ainda carrega o
ticket, de modo que um `wait` posterior possa recuperar o resultado final.

### `close`

Argumentos: `tabId`. Fecha uma aba pertencente à IA que a IA abriu. **Nunca é condicionado a
aprovação** — parar é sempre permitido. Uma aba humana é recusada (`TAB_NOT_AI_OWNED`). O
resultado é `{tabId, closed: true, destroyed: true}` assim que a visualização nativa é
confirmada como encerrada; um encerramento que o driver não conseguiu confirmar após suas novas
tentativas é informado como `TAB_TEARDOWN_FAILED` com `data.destroyed: false` — o registro da
aba já foi removido, então não repita o fechamento; avise o usuário de que uma visualização
nativa ainda pode estar em execução.

**Detecção de barreiras.** Um resultado carregado de `open` / `navigate` / `wait` pode carregar
`gate: {kind, hint}` quando a página em que se chegou é reconhecida como uma **barreira de
login**, um **interstício de consentimento**, um **desafio de verificação humana** ou um
**limite de taxa** — assim a IA descobre que não está vendo o conteúdo que pediu, no exato
momento em que lê o resultado. A detecção prioriza a precisão (um widget de desafio renderizado,
ou pelo menos dois sinais independentes numa página enxuta — um preço `$429`, um rodapé
"Protected by Cloudflare", ou um artigo *sobre* CAPTCHAs nunca classificam) e é puramente
informativa: muda o que a IA é informada, nunca o que é autorizado, e toda dica aponta para
envolver você em vez de contornar a barreira.

### `style`

Argumentos: `tabId?`, um alvo (`ref` **ou** `selector`) e um de `set: {prop: value}`,
`addClasses`, `removeClasses` ou `injectCss`. Descartar uma sobreposição bloqueante, destacar
um alvo etc. **Classe act** (condicionada a aprovação, op `style`). Mundo de conteúdo isolado.

### `execute_js`

Argumentos: `tabId?`, `script` — o corpo de uma função assíncrona que faz `return` (ou await) de
um valor serializável em JSON. A saída de emergência para o que os verbos estruturados não
conseguem expressar. Executa no **mundo de conteúdo isolado** — compartilha o DOM (então
`querySelector`, `element.style` funcionam), mas **não** consegue ver o heap/globais de JS da
própria página. O valor volta como `result` (`undefined` vira `null`); uma exceção, ou um valor
que o JSON não consegue codificar, é uma **falha que nomeia o erro**, nunca um resultado. É aprovado **apenas por chamada**
(nunca uma concessão permanente, imposto no driver em Rust), a aprovação mostra o script, e o
valor de retorno é marcado como **não confiável** e nunca alimentado automaticamente em um `act`
posterior. Prefira `query`/`style` primeiro.

### `session_save` / `session_load`

Argumentos: `tabId?`, `handle` (`[A-Za-z0-9._-]`, 1–128 caracteres). `session_save` captura a
sessão da aba em uma entrada do **keychain do SO** nomeada por `handle` e retorna um resumo sem
valores (contagens); `session_load` a restaura e retorna `{loaded: true, handle}` — uma
confirmação mais o handle fornecido pela IA, nunca quaisquer valores. Um `session_load` só se
aplica a uma página com a **mesma origem** de onde a sessão foi salva. Isto é credencial **por
referência** (ADR-A7): a IA nomeia uma sessão salva e nunca recebe os valores de cookie/token,
que nunca são registrados. Ambos usam a permissão `session` — **nunca uma concessão permanente**
(aprovada por chamada), e uma aprovação para um handle não pode ser gasta em outro. Uma sessão salva
cobre `localStorage` **e cookies**, ambos limitados à origem com que a página estava confirmada
quando você salvou.

### `console_clear`

Argumentos: `tabId?`. Retorna `{entries: [{level, text}], url}` exatamente como o `console` de
[`browser_read`](#browser-read), **e esvazia o buffer** para que a próxima leitura veja apenas
saída nova. Fica aqui, e não junto da outra leitura de console, porque o esvaziamento avalia
`element.textContent = "[]"` na página — uma escrita no DOM.

A postura Compartilhada pede aprovação de destino para cada nova origem, a menos que exista uma
concessão `navigate` correspondente. Uma aba criada por humano exige uma aprovação de anexação
efêmera antes de a IA ler/agir. As abas Sandbox usam um armazenamento de cookies de IA separado
e não persistente.

---

## `browser_read`

A metade **somente leitura**: observar a aba sem alterá-la. Anotada como
`readOnlyHint: true`, então um cliente MCP pode aprová-la automaticamente — que é o objetivo da
divisão. Essas ações ficavam em `browser`, onde uma única anotação em nível de ferramenta tinha
de descrever também o `execute_js`, de modo que tirar um snapshot ARIA custava uma aprovação
humana.

`openWorldHint` permanece `true`: somente leitura descreve o que a ferramenta *altera*, não se
os bytes são confiáveis. Tudo que é retornado é controlado pela página e **não confiável** —
nunca alimente um resultado diretamente de volta como alvo de um act de `browser`.

### `read`

Retorna `{url, snapshot, truncated?, unreachable?}` para a aba de navegador focada, ou a aba
nomeada por `tabId`. `snapshot` é uma lista orientada a ARIA de nós `{role, name, ref}` — mais
`level` para títulos, `checked`, `disabled` e `upload: true` para um campo de arquivo que a IA
nunca pode operar —, e cada `ref` (por exemplo, `"e5"`) é um identificador estável para aquele
elemento, válido durante a vida da visualização atual. A varredura entra em shadow roots
abertos; `unreachable` conta os shadow roots fechados e os frames em que não conseguiu entrar,
e `truncated: true` significa que o limite de nós (2.000) ou o limite de nome (200 caracteres)
foi atingido.

### `screenshot`

Argumentos: `tabId?`. Retorna um **bloco de conteúdo de imagem** (JPEG em base64, com qualidade
limitada) da renderização atual da aba, mais uma linha de texto que nomeia a página — um canal
visual para o layout e o estado renderizado que o snapshot ARIA não consegue descrever. É
capturado nativamente (`takeSnapshot`) e não lê nenhum DOM ou JavaScript da página. Classe read:
autorizado exatamente como `read` (permitido em uma aba pertencente à IA; uma aba humana precisa
de uma anexação, consumida na captura). Uma aba que não é a página visível pode ser renderizada
em branco — `open` e `navigate` trazem uma aba para a frente.

### `query`

Argumentos: `tabId?`, `selector` (CSS) e `fields: {attributes, box, styles:[...]}` opcional.
Retorna `{count, elements: [{ref, tag, text, …}], truncated?}` — dados estruturados do DOM que o
snapshot ARIA não consegue nomear (tabelas, valores computados) —, limitados a 50 elementos e
500 caracteres de texto cada (`truncated: true` quando o seletor encontrou mais). **Classe read.** Executa no mundo de
conteúdo isolado.

### `extract`

Argumentos: `tabId?`. Retorna `{title, byline, url, markdown, textLength, truncated}` — a página
como **Markdown em modo leitura**, para páginas que a IA quer *ler* em vez de operar. Uma única
captura limitada exporta o HTML da página; a extração em si é executada no VMark, nunca na
página: um **plugin de site** registrado para a origem tem prioridade (o plugin embutido da
Wikipedia remove os elementos de chrome do wiki — infoboxes, navboxes, hatnotes, links de edição
— por nome), e um leitor genérico por heurística de densidade é o fallback para todos os outros
sites. `truncated: true` significa que a página excedeu o limite de captura e o final não foi
lido. **Classe read.** Tudo que é retornado é derivado da página e não confiável.

### `workflow_status`

Argumentos: `tabId?`, `runId` (de `workflow_run`). Retorna `{status, completedSteps,
skippedSteps, stepCount, firstStep, pausedAt?, pendingApproval?, reasonCode?, reason?,
resumedFrom?, stepResults}`, onde `status` é um de `running` / `paused` / `completed` /
`failed` / `cancelled` / `superseded`, `stepResults` contém uma entrada por passo
(`{index, status, attempts, reason?, data?}`) e `pendingApproval` está presente enquanto a
execução espera sua decisão. Um status `paused` nomeia em `pausedAt` o passo que precisa
de você. **Classe read** — consulte à vontade.

### `console`

Argumentos: `tabId?`. Retorna `{entries: [{level, text}], url}` — a saída `console.*` capturada
da página, mais **erros não capturados e rejeições de promessa não tratadas** (registrados como
entradas `level: "error"` com o prefixo `Uncaught` / `Unhandled rejection:` — o sinal que só o
patch de `console.*` nunca vê). Apenas abas pertencentes à IA (tanto na postura Sandbox quanto
na Compartilhada; uma aba humana não tem shim de captura), apenas o frame principal. A captura funciona por um shim no mundo da
página que escreve em um buffer oculto do DOM, que o driver lê a partir do mundo isolado — então
**nenhum canal de mensagens** é aberto de volta para o VMark (a garantia de ausência de ponte se
mantém). A saída é controlada pela página e **não confiável** — trate-a como um `read`, nunca
como alvo de um `act`.

O buffer é um anel limitado, então leituras consecutivas se sobrepõem. Para esvaziá-lo à medida
que você lê, use o `console_clear` de [`browser`](#browser) — o esvaziamento escreve `[]` no
elemento de buffer da página, o que é uma escrita no DOM e, portanto, não pode viver sob
`readOnlyHint: true`.

### `wait`

Argumentos: `tabId?`, `navigationId` opcional (omita-o para usar o ticket mais recente da aba) e
`timeoutMs` opcional (1–9.000 ms). Nunca inicia uma navegação, nunca muda o foco nem a aba ativa
e nunca cria uma visualização — apenas observa, o que permite que ela viva na ferramenta somente
leitura. Apenas abas pertencentes à IA. Retorna um resultado de carregamento/falha em buffer, `NAVIGATION_SUPERSEDED`, ou
`TIMEOUT` quando o ticket não termina dentro do limite.

### `wait_for`

Argumentos: `tabId?`, exatamente um de `ref` (de uma leitura), `role` (+ `name` opcional),
`text` (uma substring do texto visível), ou `urlContains` (uma substring que a URL da aba deve
conter — confirma que uma navegação disparada por clique ocorreu, respondida a partir do estado
da aba sem ida e volta à página), e `timeoutMs` opcional (1–9.000 ms). Consulta repetidamente
até que a condição se sustente ou o tempo limite se esgote e retorna `{matched: true|false}`
(mais o `ref` do elemento correspondente para uma condição de ref/role) — assim você distingue
"encontrado" de "tempo esgotado". Classe read. Use-a para tornar um fluxo determinístico: aja,
faça `wait_for` do resultado e então leia.

Duas regras decorrem do que ela pode ver. `urlContains` corresponde à URL **ocultada** — a
query string e o fragmento são removidos, porque um token que um redirecionamento plantou ali
não pode ser sondável —, então uma agulha que contenha `?` ou `#` é recusada de imediato. E em
uma aba humana anexada com **Permitir uma vez** ela é recusada (`ATTACHMENT_ONCE_INSUFFICIENT`):
consultar repetidamente são muitas leituras, e uma anexação de uma única leitura não consegue
cobri-las — peça **Permitir até a navegação**.

---

## `coherence`

Uma visão **somente leitura** da camada de coerência do workspace — quais documentos derivados estão desatualizados em relação às origens a partir das quais foram gerados. Nenhuma ação modifica documentos ou o estado do editor. `status` é somente leitura; `edges` reconcilia primeiro e pode anexar registros de proveniência ao ledger do workspace, mas nunca altera o conteúdo do documento. Todas são respondidas inteiramente pelo backend em Rust a partir do kernel por workspace, então funcionam mesmo quando nenhuma janela do editor está em primeiro plano.

Duas ações adicionais somente leitura expõem a camada semântica:

- `claims` — as afirmações canônicas atuais: `{claim, entryId, statement, maturity, invalidAt, visible}`. Apenas afirmações `established` restringem as verificações semânticas; `visible` reflete o contexto default.
- `contexts` — o conjunto de contextos (o `default` implícito está sempre presente): `{id, name, parent, enforcement, visibleClaims, errors}`.

Anotada como `readOnlyHint: true`. A única ação mutante, `resolve`, vive em sua própria ferramenta — veja [`coherence_resolve`](#coherence-resolve) — que é o que permite que esta seja auto-aprovável. A mutação de afirmações e contextos nunca é exposta: o cânone permanece sob controle humano.

Todas as ações exigem `workspace_root`: o caminho absoluto do workspace a consultar. Descubra-o via `session.get_state` (o `filePath` das abas abertas) ou pela ferramenta workspace. Um caminho ausente, não absoluto ou que não seja um diretório é recusado com um erro de string simples.

### `status`

Contadores de status do kernel para um workspace.

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `workspace_root` | string | Sim | Caminho absoluto do workspace a consultar |

**Retorna:**

```json
{
  "initialized": true,
  "objects": 12,
  "open_items": 2,
  "quarantined": 0,
  "writer": "0198c0de-0000-7000-8000-000000000001"
}
```

| Campo | Significado |
|---|---|
| `initialized` | `false` quando o workspace ainda não tem um registro de coerência (sem diretório `.vmark/`). Nesse caso, todos os contadores exceto `objects` são 0. |
| `objects` | Objetos rastreados (arquivos com identidade de coerência). |
| `open_items` | Arestas vivas não frescas — o tamanho atual do detalhamento. |
| `quarantined` | Linhas malformadas do registro postas em quarentena na última leitura. |
| `writer` | O ID de escritor (UUID) desta instalação. |

### `edges`

O detalhamento: cada aresta de dependência viva cuja origem se moveu. Executa primeiro uma reconciliação com varredura, de modo que a resposta reflete os arquivos em disco no momento da chamada.

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `workspace_root` | string | Sim | Caminho absoluto do workspace a consultar |

**Retorna** um array — vazio quando tudo está coerente:

```json
[
  {
    "txf": "0198c0de-0000-7000-8000-00000000000a",
    "input": 0,
    "upstream": "0198c0de-0000-7000-8000-00000000000b",
    "upstream_path": "characters/elena.md",
    "pinned": "rev-a1b2c3",
    "downstream": "0198c0de-0000-7000-8000-00000000000c",
    "downstream_path": "scenes/chapter-3.md",
    "downstream_rev": "rev-d4e5f6",
    "state": "version-stale"
  }
]
```

| Campo | Significado |
|---|---|
| `txf` / `input` | A entrada de transformação e o slot de entrada que identificam esta aresta (passe-os às ações de resolução no aplicativo). |
| `upstream` / `upstream_path` | O objeto do qual o derivado depende, e seu último caminho conhecido. |
| `pinned` | A revisão da origem a partir da qual o derivado foi gerado. |
| `downstream` / `downstream_path` / `downstream_rev` | O objeto derivado, seu caminho e sua revisão atual. |
| `state` | `"version-stale"`, `"stale-valid"`, `"stale-contradicted"`, `"stale-unknown"`, `"waived"`, `"diverged"`, `"diverged-multi-head"` ou `"unpinnable"`. |

Resolver uma aresta (accept-newer / waive) é normalmente uma ação humana realizada no painel Detalhamento de coerência do VMark. Uma IA só pode fazê-lo por meio de [`coherence_resolve`](#coherence-resolve), e apenas quando o proprietário do workspace tiver delegado isso a ela explicitamente.

---

## `coherence_resolve`

A **única ação mutante** da camada de coerência, em sua própria ferramenta para que
[`coherence`](#coherence) possa permanecer auto-aprovável — e para que algo não desfazível fique
bem visível na lista de ferramentas, em vez de enterrado como um valor de enum entre cinco.
Anotada como `readOnlyHint: false, destructiveHint: true`.

### `resolve`

Argumentos: `{workspace_root, txf, input, resolution: "accept-newer" | "waive", reason? (required for waive)}`.
`txf` e `input` vêm de uma linha de `coherence` → `edges`.

Resolve uma aresta desatualizada ativa como um agente explicitamente delegado. A autorização é
**fail-closed**: o proprietário do workspace precisa ter concedido à **sua identidade de ponte
autenticada** uma delegação ativa e não expirada que cubra o tipo de resolução (concedida no
aplicativo, a partir do painel Detalhamento de coerência), e a aresta precisa continuar ativa. Toda resolução
delegada é registrada no log de auditoria vinculada à concessão, e a entrada não pode ser
desfeita. `coherence_resolve` não consegue definir uma expiração, então a isenção de uma IA nunca
caduca sozinha.

Uma recusa significa que a concessão está ausente ou expirada — peça ao usuário para concedê-la
em vez de tentar de novo. Separar isto de `coherence` não mudou nenhuma propriedade de segurança:
a autorização sempre se baseou no principal de ponte autenticado, nunca em algo que o cliente
afirme.

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
| `STALE` | envelope | `expected_revision` não combinou; releia e tente novamente. Ou `save` / `save_as`: um salvamento feito depois deste já chegou àquele arquivo, então este não gravou nada — releia antes de gravar novamente |
| `INVALID_PATCH` | envelope | `workflow.apply_patch` recebeu um array `patches` malformado |
| `INVALID_TAB` | envelope | `tabId` não pôde ser resolvido |
| `INVALID_PATH` | envelope | Um `filePath` não pôde ser lido, ou está fora do escopo do workspace aberto / dos documentos |
| `APPROVAL_REQUIRED` | envelope | `save_as` para um novo local enquanto **Aprovar automaticamente salvamentos em um novo local e resultados de gênios** está desativado; `save_as` para um caminho que já contém um arquivo diferente do da aba; ou `open_workspace` aguardando a aprovação do usuário, ou que ele escolha a pasta no seletor de pastas do VMark |
| `BUSY` | envelope | `open_workspace` não pôde continuar: outro diálogo de pastas está aberto, ou uma troca de espaço de trabalho está em andamento nessa janela; a aprovação é mantida — tente de novo. Ou `document.write`, `document.transform` ou `selection.set` chegou enquanto o usuário compunha texto com um método de entrada; nada foi alterado — tente de novo em instantes |
| `JOURNAL_BUSY` | envelope | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch` chegou enquanto outra escrita no mesmo documento estava sendo registrada; nada foi alterado — tente de novo em instantes |
| `WRITE_BUSY` | string | Uma chamada de escrita (`document.write` / `document.transform`, `selection.set`, `workflow.apply_patch`, `comments.reply` / `mark_addressed`, `coherence_resolve`, …) esperou 3 s atrás de outra escrita sem chegar sua vez; não foi aplicada — tente de novo |
| `TIMEOUT` | string | Uma chamada a `coherence` ou `coherence_resolve` não terminou em 20 s. Se for uma escrita (`edges`, `resolve`), ela ainda está em execução e seu resultado é desconhecido — leia o estado atual antes de tentar de novo |
| `STALE_PARENT` | envelope | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch`: outra janela escreveu o documento depois da última escrita desta aba; nada foi alterado — leia de novo e tente outra vez |
| `JOURNAL_DEGRADED` | envelope | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch`: um registro anterior do diário para este documento ainda aguarda ser gravado; nada foi alterado — tente de novo em alguns segundos |
| `JOURNAL_UNAVAILABLE` | envelope | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch`: o diário de edições de agentes não está em execução ou não consegue registrar; nada foi alterado |
| `INVALID_TEXT` | envelope | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch`: `content` contém um substituto UTF-16 isolado; nada foi alterado |
| `REVIEW_BACKLOG_FULL` | envelope | `document.write`: o documento tem alterações de IA não revisadas demais; nada foi alterado |
| `ABORTED` | envelope | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch`: o usuário editou, fechou, compôs texto no documento ou moveu a seleção dele enquanto a escrita era registrada; `reason` diz qual; nada foi alterado — leia de novo e tente outra vez |
| `NOT_WORKFLOW` | envelope | `workflow.*` foi chamado em uma aba que não é YAML de workflow |
| `READ_ONLY` | envelope | Foi tentada uma mutação em um documento somente leitura |
| `NO_EDITOR` | envelope | `selection.*` foi chamado, mas a aba focada não tem um editor ativo |
| `INTERNAL` | envelope | Erro inesperado no manipulador |
| (string simples) | string | Argumento obrigatório ausente ou de tipo errado |
