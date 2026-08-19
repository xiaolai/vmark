# Referência de Ferramentas MCP

O VMark expõe **nove ferramentas MCP compostas** para assistentes de IA: `session`, `workspace`, `document`, `workflow`, `selection`, `browser`, `browser_read`, `coherence` e `coherence_resolve`. Juntas, elas cobrem a espinha dorsal do editor, o ciclo de vida de arquivos/janelas, edições de workflow seguras via CST, edições direcionadas na seleção, navegação delimitada do navegador e uma visão da camada de coerência do workspace.

Três das nove — `session`, `browser_read` e `coherence` — declaram `readOnlyHint: true`, de modo que um cliente MCP pode aprová-las automaticamente. É por isso que `browser`/`browser_read` e `coherence`/`coherence_resolve` são ferramentas separadas: as anotações são **por ferramenta**, não por ação, então uma ferramenta que agrupa um snapshot ARIA com `execute_js` precisa anunciar o perigo do `execute_js`. Dividir segundo o critério "isto modifica algo?" permite que cada metade diga a verdade e mantém as ações genuinamente destrutivas da superfície bem visíveis na lista de ferramentas.

A superfície anterior, com 12 ferramentas e 76 ações, foi reduzida porque as ferramentas de formatação dentro do documento (negrito, títulos, tabelas etc.) duplicam um trabalho que agentes de IA já fazem trivialmente via round-trip de Markdown. A `selection` foi mantida (conforme o ADR-7 do plano de poda) porque o round-trip do documento inteiro é antieconômico em arquivos grandes — cada edição paga o documento inteiro em tokens de entrada, o documento inteiro em tokens de saída (~5× o preço da entrada) e uma janela de escrita mais longa que amplia o laço de repetição por revisão desatualizada. Veja [o plano de poda do MCP](https://github.com/xiaolai/vmark/blob/main/dev-docs/plans/20260504-mcp-pruning.md) para a justificativa completa.

::: tip Fluxo de trabalho recomendado
1. Chame `session.get_state` uma vez para ver janelas abertas, abas e, por aba, `{filePath, dirty, revision, kind}`.
2. Para pequenas alterações em Markdown ou reescritas integrais: `document.read` → raciocinar → `document.write` (passando `expected_revision` para concorrência segura).
3. Para edições direcionadas em um arquivo Markdown grande quando o usuário já selecionou a região a alterar: `selection.get` → raciocinar → `selection.set` (reduz o custo em tokens de entrada e saída ao tamanho da seleção).
4. Para YAML do GitHub Actions (`kind: "yaml-workflow"`): `workflow.apply_patch` para edições seguras via CST que preservam comentários e âncoras; `workflow.validate` para diagnósticos do actionlint.
5. Operações de arquivo (abrir, salvar, fechar, alternar abas) ficam em `workspace`.
:::

::: tip Diagramas Mermaid
Ao usar IA para gerar Mermaid via MCP, considere instalar o [servidor MCP mermaid-validator](/guide/mermaid#mermaid-validator-mcp-server-syntax-checking) — ele captura erros de sintaxe usando os mesmos parsers do Mermaid v11 antes que os diagramas cheguem ao seu documento.
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
mesma chamada**; uma vez que o usuário aprove, a repetição abre a pasta. Uma
requisição negada continua falhando até ser reaprovada. Não há opção de
"lembrar" — cada abertura é aprovada individualmente.

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

Salvar em um caminho diferente do arquivo atual da própria aba é tratado como uma
nova escrita. Quando **Aprovar edições automaticamente** (Configurações →
Integrações) está desativado (o padrão), essa requisição é recusada com
`APPROVAL_REQUIRED` e um aviso informa o que foi bloqueado. Salvar de volta no
próprio caminho da aba é sempre permitido.

### `close`

Fecha uma aba. Recusa-se a descartar trabalho não salvo sem `force`.

| Parâmetro | Tipo | Obrigatório |
|-----------|------|-------------|
| `tabId` | string | Sim |
| `force` | boolean | Não |

Retorna `{closed: true}` em caso de sucesso, ou `{closed: false, reason: "DIRTY"}` se a aba estiver suja e `force` não foi fornecido.

### `switch_tab`

Ativa uma aba e a torna **visível**. Com a [barra de workspaces](/guide/workspace-rail)
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

Substitui o que quer que o editor reporte como a seleção atual. **No modo WYSIWYG**, texto inline simples é inserido como um nó de texto literal, de modo que espaços em branco no início/fim são preservados exatamente no round-trip; conteúdo que carrega marcadores de markdown (`**bold**`, `*italic*`, `` `code` ``, código cercado, blockquotes, listas etc.) é interpretado como markdown e inserido como os nós correspondentes. **No modo de código-fonte**, `content` é sempre inserido como texto bruto — a superfície de código-fonte já é bytes de markdown. Um `content` vazio exclui a seleção. Quando a seleção está recolhida, `content` é inserido na posição do cursor.

Retorna `{revision, replaced_chars}` em caso de sucesso. `replaced_chars` é o comprimento do texto que estava selecionado antes da chamada — útil para a IA confirmar que editou o que esperava.

`STALE` retorna `{error: "STALE", message, current_revision}` exatamente como `document.write`. A revisão em nível de documento captura as teclas pressionadas entre `get` e `set`. O movimento puro do cursor (sem pressionar uma tecla) não é arbitrado pelo servidor — se o usuário moveu o cursor entre `get` e `set`, a edição ocorre na nova posição.

---

## `browser`

A metade **mutante** da superfície do navegador integrado — tudo que altera a página,
a aba ou um login armazenado. Leia a página primeiro com [`browser_read`](#browser-read):
todo modo de segmentação aqui se refere ao que uma leitura retornou.

As ferramentas do navegador seguem **Configurações → Avançado → macOS → Navegador
incorporado**, que está **ativado por padrão** no macOS — então essas ferramentas
ficam disponíveis para um cliente de IA conectado, a menos que você o desative.
Toda ação falha com `BROWSER_DISABLED` enquanto estiver desativado. As URLs
retornadas ao MCP são ocultadas pela mesma fronteira usada pelo estado da sessão de
navegador do aplicativo.

Anotada como `readOnlyHint: false, destructiveHint: true` — preciso, e não meramente
conservador, porque toda ação aqui altera algo.

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

**Um clique verifica seu efeito antes de relatar sucesso.** O alvo é trazido à vista,
precisa estar renderizado de forma visível (estilos computados e ancestrais recolhidos são
verificados, então um botão duplicado dentro de um passo de acordeão fechado é ignorado, não
clicado), e o ponto de clique passa por hit-test — um alvo coberto por uma sobreposição é
recusado com o oclusor nomeado (`covered by div.cmp-overlay`) em vez de clicado por baixo.
Os resultados de role + name carregam contagens `matchedTotal` / `matchedVisible`, de modo
que a ambiguidade fica visível, e toda resposta de act inclui a `url` e a `generation` atuais
da aba. `type` lida com campos de texto, controles `<select>` (passe o rótulo ou o valor da
opção; uma opção ausente é recusada como `no-such-option`) e regiões `contenteditable`.

### `workflow_run` / `workflow_cancel`

`workflow_run` executa um workflow que você fornece como texto em `source` numa aba
pertencente à IA. Argumentos: `tabId?`, `source` (o texto do workflow — uma pequena gramática
orientada a linhas; você o escreve, a IA o faz, ou [`workflow_record`](#workflow-record) o
captura a partir das suas próprias ações), `inputs?` (um mapa
`{name: value}` substituído nas referências `{name}`), `allowRepeat?`. Retorna `{runId, steps}`
**imediatamente** — a execução ocorre de forma **assíncrona**, porque uma execução com vários
passos pode durar mais que uma única requisição. Consulte o `workflow_status` de
[`browser_read`](#browser-read) para acompanhar o progresso.

Passos determinísticos — `click` / `type` / `navigate` nessa gramática, e `extract` — são
executados dentro do VMark e são **individualmente condicionados a aprovação**, exatamente como
um `act` emitido manualmente: a execução autoriza cada um por conta própria, então um workflow
não é uma forma de contornar os avisos de aprovação. `goal`, `confirm`, `api` e qualquer passo
em prosa livre **pausam** a execução para a IA tratar manualmente. Uma reexecução **pula os
passos de escrita que já tiveram sucesso** nesta sessão (o registro de escritas concluídas), a
menos que `allowRepeat` esteja definido — então reexecutar após uma pausa não envia em
duplicidade.

`workflow_cancel {tabId?, runId}` interrompe uma execução. **Nunca é condicionado a
aprovação** — parar é sempre permitido — e retira os avisos pendentes da execução e devolve a
aba a você. A execução também para no instante em que você assume o controle do navegador
(qualquer interação com a página ou com seus controles reivindica o controle).

As execuções são limitadas (≤ 25 passos, ≤ 120 s, `source` ≤ 64 KiB) e uma de cada vez por aba.

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
você pode salvar ou passar diretamente para [`workflow_run`](#workflow-run).

A gravação é **livre de valores por construção**, e isso não é um filtro que confia na página:
nada do que você digita chega a ser capturado. Todo campo de texto vira uma variável `{input}`
nomeada (o valor é fornecido na reprodução, nunca gravado); um **campo de senha ou de código de
uso único** vira um passo `confirm:` — uma etapa manual que você completa à mão na reprodução —
de modo que um segredo nunca é sequer parametrizado; e toda URL é reduzida a origem + caminho,
então um token em uma query string não sobrevive. O que é gravado são os **localizadores** que
você tocou (papel ARIA + nome acessível), nunca seus dados. A gravação acompanha você através
das navegações de página e é limitada (200 eventos por página, 1.000 por sessão).

### `open`

Argumentos: `url` e `timeoutMs` opcional (1–12.000 ms). Cria uma aba pertencente à IA usando a
postura Sandbox ou Compartilhada atual e retorna seu `tabId`, `navigationId`, URL, título e
generation após a conclusão do carregamento.

### `navigate`

Argumentos: `tabId?`, `url` e `timeoutMs` opcional. Navega uma aba pertencente à IA e retorna
o resultado do ticket de navegação. Um timeout ainda retorna o ticket, de modo que um `wait`
posterior possa recuperar o resultado final.

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

Argumentos: `tabId?`, `script` (deve `return` um valor serializável em JSON). A saída de
emergência para o que os verbos estruturados não conseguem expressar. Executa no **mundo de
conteúdo isolado** — compartilha o DOM (então `querySelector`, `element.style` funcionam), mas
**não** consegue ver o heap/globais de JS da própria página. É aprovado **apenas por chamada**
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
(aprovada por chamada), e uma aprovação para um handle não pode ser gasta em outro. *Hoje isto
cobre `localStorage`; a captura de cookies é um acompanhamento em testes ao vivo.*

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

Retorna `{url, snapshot}` para a aba de navegador focada, ou a aba nomeada por `tabId`.
`snapshot` é uma lista orientada a ARIA de `{role, name, ref}` — cada `ref` (por exemplo,
`"e5"`) é um identificador estável para aquele elemento, válido durante a vida da visualização
atual.

### `screenshot`

Argumentos: `tabId?`. Retorna um **bloco de conteúdo de imagem** (JPEG em base64, com qualidade
limitada) da renderização atual da aba, mais uma linha de texto que nomeia a página — um canal
visual para o layout e o estado renderizado que o snapshot ARIA não consegue descrever. É
capturado nativamente (`takeSnapshot`) e não lê nenhum DOM ou JavaScript da página. Classe read:
autorizado exatamente como `read` (permitido em uma aba pertencente à IA; uma aba humana precisa
de uma anexação, consumida na captura).

### `query`

Argumentos: `tabId?`, `selector` (CSS) e `fields: {attributes, box, styles:[...]}` opcional.
Retorna `{count, elements: [{ref, tag, text, …}]}` — dados estruturados do DOM que o snapshot
ARIA não consegue nomear (tabelas, valores computados). **Classe read.** Executa no mundo de
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

Argumentos: `tabId?`, `runId` (de `workflow_run`). Retorna `{status, completedSteps, stepCount,
pausedAt?, reasonCode?, reason?, stepResults}`, onde `status` é um de `running` / `paused` /
`completed` / `failed` / `cancelled`. Um status `paused` nomeia em `pausedAt` o passo que precisa
de você. **Classe read** — consulte à vontade.

### `console`

Argumentos: `tabId?`. Retorna `{entries: [{level, text}], url}` — a saída `console.*` capturada
da página, mais **erros não capturados e rejeições de promessa não tratadas** (registrados como
entradas `level: "error"` com o prefixo `Uncaught` / `Unhandled rejection:` — o sinal que só o
patch de `console.*` nunca vê). Apenas abas Sandbox. A captura funciona por um shim no mundo da
página que escreve em um buffer oculto do DOM, que o driver lê a partir do mundo isolado — então
**nenhum canal de mensagens** é aberto de volta para o VMark (a garantia de ausência de ponte se
mantém). A saída é controlada pela página e **não confiável** — trate-a como um `read`, nunca
como alvo de um `act`.

O buffer é um anel limitado, então leituras consecutivas se sobrepõem. Para esvaziá-lo à medida
que você lê, use o `console_clear` de [`browser`](#browser) — o esvaziamento escreve `[]` no
elemento de buffer da página, o que é uma escrita no DOM e, portanto, não pode viver sob
`readOnlyHint: true`.

### `wait`

Argumentos: `tabId?`, `navigationId` opcional e `timeoutMs` opcional. Nunca inicia uma
navegação. Retorna um resultado de carregamento/falha em buffer, `NAVIGATION_SUPERSEDED`, ou
`TIMEOUT` quando o ticket não termina dentro do limite.

### `wait_for`

Argumentos: `tabId?`, exatamente um de `ref` (de uma leitura), `role` (+ `name` opcional),
`text` (uma substring do texto visível), ou `urlContains` (uma substring que a URL da aba deve
conter — confirma que uma navegação disparada por clique ocorreu, respondida a partir do estado
da aba sem ida e volta à página), e `timeoutMs` opcional (1–12.000 ms). Consulta repetidamente
até que a condição se sustente ou o tempo limite se esgote e retorna `{matched: true|false}`
(mais o `ref` do elemento correspondente para uma condição de ref/role) — assim você distingue
"encontrado" de "tempo esgotado". Classe read. Use-a para tornar um fluxo determinístico: aja,
faça `wait_for` do resultado e então leia.

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

Resolver uma aresta (accept-newer / waive) é normalmente uma ação humana realizada na visão de detalhamento do VMark. Uma IA só pode fazê-lo por meio de [`coherence_resolve`](#coherence-resolve), e apenas quando o proprietário do workspace tiver delegado isso a ela explicitamente.

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
aplicativo, a partir do Detalhamento), e a aresta precisa continuar ativa. Toda resolução
delegada é registrada no log de auditoria vinculada à concessão, e a entrada não pode ser
desfeita.

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
| `STALE` | envelope | `expected_revision` não combinou; releia e tente novamente |
| `INVALID_PATCH` | envelope | `workflow.apply_patch` recebeu um array `patches` malformado |
| `INVALID_TAB` | envelope | `tabId` não pôde ser resolvido |
| `INVALID_PATH` | envelope | Um `filePath` não pôde ser lido, ou está fora do escopo do workspace aberto / dos documentos |
| `APPROVAL_REQUIRED` | envelope | `save_as` para um novo local enquanto **Aprovar edições automaticamente** está desativado |
| `NOT_WORKFLOW` | envelope | `workflow.*` foi chamado em uma aba que não é YAML de workflow |
| `READ_ONLY` | envelope | Foi tentada uma mutação em um documento somente leitura |
| `NO_EDITOR` | envelope | `selection.*` foi chamado, mas a aba focada não tem um editor ativo |
| `INTERNAL` | envelope | Erro inesperado no manipulador |
| (string simples) | string | Argumento obrigatório ausente ou de tipo errado |
