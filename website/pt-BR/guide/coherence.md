# Coerência e a visão de detalhamento

A camada de coerência do VMark mantém honestos os projetos de escrita desenvolvidos recursivamente: ela registra **quais documentos cada geração de IA realmente leu**, percebe quando esses documentos de origem mudam depois e mostra a você — sob demanda — exatamente quais artefatos derivados podem ter ficado desatualizados. Nada é atualizado automaticamente; você continua sendo o editor-chefe.

## Como funciona (30 segundos)

- **O rastreamento de proveniência é opcional.** Ative primeiro *Configurações → Arquivos e imagens → Salvamento → Gravar bloco de identidade ao salvar*. Até lá, nenhuma escrita — um salvamento, a aplicação de um genie, uma sugestão de IA aceita, uma escrita via MCP, a restauração de uma versão anterior ou um arquivo novo criado no explorador de arquivos — marca seus arquivos ou cria `.vmark/`.
- Uma vez ativada a opção, cada salvamento, aplicação de genie, sugestão de IA aceita, escrita via MCP, restauração de uma versão anterior e passo `save-file` de um workflow é registrado como uma **transformação** em um registro (ledger) de texto simples dentro do seu workspace (`.vmark/` — JSONL amigável ao git e legível por humanos; apagar o `index.db` derivado não perde nada).
- **Um workspace que já tem um registro** — um `.vmark/` que você criou antes ou que um colaborador comitou — continua registrando as escritas nos documentos que acompanha, mesmo com a opção desativada. Um documento conta como acompanhado quando o registro já o anotou antes, ou quando o arquivo já traz sua própria identidade `vmark:` — um arquivo acompanhado que você moveu, copiou para o workspace ou obteve por checkout; são exatamente esses que a própria varredura do registro adota. Ele não marca nada: um documento sem identidade fica de fora, e uma escrita cujas entradas ficam assim incompletas é registrada como `inferred` em vez de `exact`.
- Quando uma IA escreve um documento enquanto lê outros, essas leituras se tornam **arestas de dependência**, fixadas na revisão que foi lida. Os caminhos instrumentados dentro do aplicativo registram entradas `exact`; uma escrita via MCP registra honestamente um conjunto de leituras `inferred` — apenas o que esse mesmo cliente leu pela própria conexão — e identifica o cliente que a fez.
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
- **Isentar** — registra uma divergência intencional com um **motivo obrigatório** (narradores não confiáveis existem). Na v0, uma isenção é intencionalmente restrita: ela se aplica apenas a esta aresta e à revisão específica da origem contra a qual ela é resolvida. Itens isentos permanecem visíveis, marcados de forma distinta, e reabrem se a origem se mover novamente.

Aceitar mais recente e isentar ficam desabilitados quando a origem tem várias versões atuais — não há uma única revisão contra a qual resolver; revise (ou reconcilie as versões) primeiro.

## Silenciando avisos de que você não precisa

Dois controles em cada linha do detalhamento restringem aquilo sobre o que a camada pergunta. Ambos são exclusivamente humanos — nenhuma ferramenta MCP consegue defini-los.

**Marcar como concluído (ciclo de vida do documento).** Quando um documento derivado está pronto — um capítulo publicado, um relatório entregue — escolha **Marcar como concluído** em qualquer uma das linhas dele. Isso silencia todas as dependências para esse documento, inclusive as que não estão listadas no momento, e é por isso que pede confirmação. As arestas dele passam para o grupo recolhido **Sem perguntas sobre estes**, na parte de baixo do painel, com o rótulo *documento concluído*: ainda acompanhadas, ainda visíveis quando você pede, só que sem interromper você. **Reabrir** as traz de volta com um único clique e sem confirmação, já que reabrir só acrescenta interrupções de volta. O ciclo de vida é registrado no registro (ledger), não no frontmatter, então marcar um documento como concluído não cria uma nova revisão dele.

**Âncoras de seção.** Uma aresta sem âncora pergunta "o arquivo de origem mudou?". **Ancorar a uma seção** restringe a pergunta a "a seção da qual eu dependo mudou?": escolha um título do documento de origem e a aresta fica fixada no caminho desse título. Enquanto a seção ancorada não muda, uma edição da origem em outro lugar deixa a aresta no grupo silenciado como *seção da qual depende sem alterações*; uma edição dentro da seção a traz à tona como *seção ancorada alterada*. Se o título desaparecer, a aresta é sinalizada como *âncora perdida* em vez de voltar silenciosamente ao comportamento de arquivo inteiro. **Alterar âncora** a fixa de novo e **Arquivo inteiro** a remove. As âncoras são entradas próprias e revisáveis no registro, então acompanham a aresta pelas revisões seguintes.

## O registro de coerência e o julgamento dos avisos

O **Registro de coerência** (uma seção expansível no painel de detalhamento) é o histórico por aresta que o registro (ledger) guarda: cada verificação, ratificação e isenção, quantas vezes cada aresta foi resolvida (*resolvido 3x*) e quantas arestas foram resolvidas mais de uma vez — a rotatividade, que é o verdadeiro fardo de um grafo de dependências ruidoso. Uma verificação semântica que o modelo respondeu abaixo do limiar de confiança aparece com o veredicto e a confiança preservados (*o modelo disse … com …, abaixo do limiar*), para que "sem sinal" e "respondeu, mas sem confiança suficiente" continuem distinguíveis. O registro é lido do ledger inteiro, então só carrega quando você o expande e recarrega a cada expansão.

**Valeu a pena avisar sobre isto?** Cada linha exibida oferece **Valeu o aviso?** com três respostas — **Sim**, **Não**, **Não sei** — e, deliberadamente, nenhum padrão. Suas respostas são registradas como entradas próprias no ledger e contabilizadas no registro (*Julgados: relevante … · ruído … · incerto … · não julgados …*). Essa é a medida de relevância da desatualização contra a qual a camada é ajustada: um aviso que você julga ruído é candidato a uma âncora de seção ou a uma marcação de concluído.

## Verificação semântica, afirmações e contextos

A desatualização de versão diz que uma origem *se moveu*; a verificação semântica diz se esse movimento realmente *contradiz* o documento derivado. As verificações são estritamente **sob demanda** (pull): pressione **Verificar** em uma aresta desatualizada e o VMark pede ao provedor de IA configurado que compare a revisão fixada da origem, a atual e o texto derivado. O veredicto chega como um selo — *verificado válido*, *contradito* (sempre com uma citação textual como evidência) ou *não verificado* quando o modelo ficou em dúvida, estourou o tempo ou respondeu abaixo do limiar de confiança. O desconhecido é honesto, nunca escondido. Uma verificação expira no momento em que qualquer um dos dois documentos se move de novo — ou o conjunto de afirmações muda.

As **afirmações canônicas** são fatos que você tornou explícitos ("Elena é canhota"). Selecione texto em um documento e execute *Extrair afirmação da seleção*: a afirmação nasce como **rascunho**, com proveniência (qual documento, qual revisão). Para ver e gerenciar suas afirmações, execute **Afirmações canônicas** pela paleta de comandos — o painel não tem item de menu nem atalho, e *Extrair afirmação da seleção* o abre para você com o novo rascunho. Promova uma afirmação a **estabelecida** quando ela virar cânone — apenas afirmações estabelecidas alimentam as verificações semânticas. Corrigir ou encerrar uma afirmação acrescenta histórico; nada é jamais apagado. Ocultar uma afirmação em um contexto é visibilidade reversível, não encerramento.

Os **contextos** são visões nomeadas do workspace (o contexto *default* está sempre lá). Cada contexto decide o que "atual" significa e quais afirmações se aplicam; um contexto filho herda as afirmações do pai de forma aditiva. Os contextos são **estufa** por padrão — os veredictos de verificação se leem como tensão consultiva. Mudar um deles para **aplicado** (um ato explícito e confirmado) marca as contradições como violações do cânone. O seletor de contexto do detalhamento escolhe através de qual contexto você está olhando; os resultados de verificação ficam vinculados exatamente ao contexto e ao instantâneo de afirmações que os produziram e nunca vazam de um para outro.

## Proveniência, delegação e branches

Três coisas mantêm a camada de coerência honesta à medida que um projeto realmente evolui — nenhuma delas fica no seu pé, todas são somente sob demanda (pull).

**Recuperação de proveniência.** Quando você edita um documento derivado à mão (no VMark ou em um editor externo), a edição perde corretamente suas entradas registradas — as antigas arestas de dependência já não descrevem o novo texto. O grupo *Proveniência desconhecida* do detalhamento se oferece para restaurá-las: pressione **Sugerir entradas** e o VMark propõe o conjunto de entradas anterior mais recente do documento (com os papéis preservados), pré-marcado e editável. **Confirmar proveniência** reanexa as arestas à versão atual sem criar uma nova revisão, de modo que os próprios documentos a jusante nunca veem uma mudança espúria. Documentos que nunca tiveram entradas nunca são listados — não há nada a recuperar e nada para ficar no seu pé.

**Delegação a agentes.** Por padrão, só você pode resolver arestas desatualizadas. Se você quer que um agente de IA aceite a mais recente ou isente em seu nome (pela ferramenta MCP `coherence_resolve`), conceda a ele, a partir do detalhamento, uma **delegação com prazo**: dê um nome ao agente, escolha o escopo (aceitar a mais recente e/ou isentar) e defina uma expiração (7 dias por padrão, nunca "para sempre"). Cada resolução delegada fica registrada na concessão, então a trilha de auditoria sempre mostra quem agiu sob a autoridade de quem. Revogue qualquer concessão com um clique. As afirmações canônicas e os contextos permanecem exclusivamente humanos — um agente nunca pode promover uma afirmação nem aplicar um contexto.

**Contextos de branch.** Um contexto pode ser mapeado para um branch do git. Quando você faz checkout de um branch mapeado, o detalhamento mostra um **chip candidato** que oferece trocar — ele nunca troca sozinho. Se o branch ainda não tem contexto, o chip oferece criar um com o nome dele. Quando um merge de verdade (não fast-forward) chega, um banner dispensável sugere que você revise o detalhamento; a divergência e a desatualização que ele mostra são os estados normais do detalhamento — então nada de novo é executado, você só é conduzido à revisão.

## Identidade no frontmatter

Com *Gravar bloco de identidade ao salvar* ativado, na primeira vez que um arquivo é capturado, o VMark adiciona um pequeno bloco de identidade ao seu frontmatter:

```yaml
vmark:
  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7
```

Esse ID é como um documento mantém seu histórico através de renomeações e movimentações. Ele nunca afeta o hash do conteúdo (adicioná-lo não cria uma "mudança"), e todo o resto do seu frontmatter fica intocado. Se você copiar um arquivo, o ID duplicado é detectado e sinalizado para você resolver — nunca corrigido automaticamente.

Se você prefere que o VMark nunca toque nos seus arquivos, deixe *Gravar bloco de identidade ao salvar* desativado — esse é o padrão. Assim, o VMark não adiciona esse bloco a nenhum arquivo, seja qual for a forma como ele é gravado — nem aos arquivos que uma edição de IA ou MCP apenas leu.

## Interoperabilidade com git

- Os arquivos do registro `.vmark/` são rastreados pelo git e se mesclam de forma limpa entre branches (somente acréscimo, `merge=union`).
- Checkouts, trocas de branch e resets são reconhecidos como **navegação** — eles nunca criam revisões fantasmas.
- `git revert` e merges que geram conteúdo novo são capturados como transformações atribuídas ao git.
- O índice derivado (`index.db`) está no gitignore e é reconstruído a partir do registro de texto simples sempre que necessário.

## Para agentes de IA (MCP)

Agentes externos podem consultar o estado de coerência pela [ferramenta MCP `coherence`](/pt-BR/guide/mcp-tools#coherence) (ações `status`, `edges`, `claims` e `contexts`), para os workspaces que você abriu no VMark. `status` é uma leitura pura; `edges` reconcilia primeiro — ele pode acrescentar registros de proveniência ao registro do próprio workspace, mas nunca toca nos seus documentos. A ferramenta declara `readOnlyHint: true`, então um cliente pode aprová-la automaticamente.

A resolução (ratificar/isentar) fica em uma ferramenta **separada**, [`coherence_resolve`](/pt-BR/guide/mcp-tools#coherence-resolve), e por padrão permanece com o humano: um agente só pode chamá-la depois que você concede a esse agente específico uma delegação com prazo, e cada resolução é registrada no log de auditoria vinculada à concessão. Mantê-la fora de `coherence` é o que permite que a ferramenta de leitura seja aprovada automaticamente sem que um agente adquira silenciosamente a capacidade de escrever no seu registro.

As afirmações canônicas e os contextos nunca podem ser alterados via MCP.
