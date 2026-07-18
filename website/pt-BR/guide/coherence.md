# Coerência e a visão de detalhamento

A camada de coerência do VMark mantém honestos os projetos de escrita desenvolvidos recursivamente: ela registra **quais documentos cada geração de IA realmente leu**, percebe quando esses documentos de origem mudam depois e mostra a você — sob demanda — exatamente quais artefatos derivados podem ter ficado desatualizados. Nada é atualizado automaticamente; você continua sendo o editor-chefe.

## Como funciona (30 segundos)

- Cada salvamento, aplicação de genie, sugestão de IA aceita, escrita via MCP e passo `save-file` de um workflow é registrado como uma **transformação** em um registro (ledger) de texto simples dentro do seu workspace (`.vmark/` — JSONL amigável ao git e legível por humanos; apagar o `index.db` derivado não perde nada).
- Quando uma IA escreve um documento enquanto lê outros, essas leituras se tornam **arestas de dependência**, fixadas na revisão exata que foi lida.
- Quando um documento de origem avança além de uma revisão fixada, a aresta fica **desatualizada**. Se duas revisões evoluíram em paralelo (por exemplo, em branches do git), a aresta está **divergente** — sinalizada, nunca adivinhada.
- Arquivos editados fora do VMark (terminal, outros editores) são reconciliados na varredura como *edições externas observadas* — o histórico permanece sem lacunas, marcado honestamente como de proveniência desconhecida.

## A visão de detalhamento

Abra-a em **Janela → Detalhamento de coerência** (ou pela paleta de comandos: "Detalhamento de coerência"). Ela é estritamente **sob demanda** (pull): atualiza quando você a abre ou pressiona atualizar — nunca incomoda em segundo plano.

Os itens são agrupados por artefato (o documento derivado) e mostram o documento de origem, a revisão fixada e o estado atual:

| Estado | Significado |
|---|---|
| `version-stale` | A origem avançou além daquilo a partir do qual este artefato foi construído |
| `diverged` | A revisão fixada e a atual são paralelas — não há linha de descendência |
| `diverged-multi-head` | A própria origem tem versões atuais paralelas |
| `waived` | Você aceitou a divergência, com um motivo registrado |
| `unpinnable` | A origem não pode ser resolvida (por exemplo, um pin inválido) |

### Ações

Cada item oferece três ações honestas — nenhuma delas reescreve o histórico:

- **Aceitar mais recente** — registra que o artefato ainda é compatível com a origem mais recente (uma *ratificação*). O item sai da lista; se a origem mudar de novo, ele volta.
- **Revisar** — abre o artefato para que você possa atualizá-lo. Salvar uma nova versão aposenta a aresta antiga.
- **Isentar** — registra uma divergência intencional com um **motivo obrigatório** (narradores não confiáveis existem). Itens isentos permanecem visíveis, marcados de forma distinta, e reabrem se a origem se mover novamente.

Aceitar mais recente e isentar ficam desabilitados quando a origem tem várias versões atuais — não há uma única revisão contra a qual resolver; revise (ou reconcilie as versões) primeiro.

## Verificação semântica, afirmações e contextos

A desatualização de versão diz que uma origem *se moveu*; a verificação semântica diz se esse movimento realmente *contradiz* o documento derivado. As verificações são estritamente **sob demanda** (pull): pressione **Verificar** em uma aresta desatualizada e o VMark pede ao provedor de IA configurado que compare a revisão fixada da origem, a atual e o texto derivado. O veredicto chega como um selo — *verificado válido*, *contradito* (sempre com uma citação textual como evidência) ou *não verificado* quando o modelo ficou em dúvida, estourou o tempo ou respondeu abaixo do limiar de confiança. O desconhecido é honesto, nunca escondido. Uma verificação expira no momento em que qualquer um dos dois documentos se move de novo — ou o conjunto de afirmações muda.

As **afirmações canônicas** são fatos que você tornou explícitos ("Elena é canhota"). Selecione texto em um documento e execute *Extrair afirmação da seleção*: a afirmação nasce como **rascunho**, com proveniência (qual documento, qual revisão). Promova-a a **estabelecida** quando ela virar cânone — apenas afirmações estabelecidas alimentam as verificações semânticas. Corrigir ou encerrar uma afirmação acrescenta histórico; nada é jamais apagado. Ocultar uma afirmação em um contexto é visibilidade reversível, não encerramento.

Os **contextos** são visões nomeadas do workspace (o contexto *default* está sempre lá). Cada contexto decide o que "atual" significa e quais afirmações se aplicam; um contexto filho herda as afirmações do pai de forma aditiva. Os contextos são **estufa** por padrão — os veredictos de verificação se leem como tensão consultiva. Mudar um deles para **aplicado** (um ato explícito e confirmado) marca as contradições como violações do cânone. O seletor de contexto do detalhamento escolhe através de qual contexto você está olhando; os resultados de verificação ficam vinculados exatamente ao contexto e ao instantâneo de afirmações que os produziram e nunca vazam de um para outro.

## Identidade no frontmatter

Na primeira vez que um arquivo é capturado, o VMark adiciona um pequeno bloco de identidade ao seu frontmatter:

```yaml
vmark:
  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7
```

Esse ID é como um documento mantém seu histórico através de renomeações e movimentações. Ele nunca afeta o hash do conteúdo (adicioná-lo não cria uma "mudança"), e todo o resto do seu frontmatter fica intocado. Se você copiar um arquivo, o ID duplicado é detectado e sinalizado para você resolver — nunca corrigido automaticamente.

## Interoperabilidade com git

- Os arquivos do registro `.vmark/` são rastreados pelo git e se mesclam de forma limpa entre branches (somente acréscimo, `merge=union`).
- Checkouts, trocas de branch e resets são reconhecidos como **navegação** — eles nunca criam revisões fantasmas.
- `git revert` e merges que geram conteúdo novo são capturados como transformações atribuídas ao git.
- O índice derivado (`index.db`) está no gitignore e é reconstruído a partir do registro de texto simples sempre que necessário.

## Para agentes de IA (MCP)

Agentes externos podem consultar o estado de coerência pela [ferramenta MCP `coherence`](/pt-BR/guide/mcp-tools#coherence) (ações `status` e `edges`), para os workspaces que você abriu no VMark. `status` é uma leitura pura; `edges` reconcilia primeiro — ele pode acrescentar registros de proveniência ao registro do próprio workspace, mas nunca toca nos seus documentos. A resolução (ratificar/isentar) deliberadamente *não* é exposta via MCP nesta versão — as decisões ficam com o humano no aplicativo.
