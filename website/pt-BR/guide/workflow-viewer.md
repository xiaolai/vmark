# Visualizador de Workflows do GitHub Actions

O VMark renderiza YAML de workflows do GitHub Actions como um grafo acíclico dirigido (DAG) interativo e permite editar jobs, steps, triggers, permissões e concorrência através de formulários estruturados — sem nunca perder comentários, âncoras ou formatação no arquivo subjacente.

A funcionalidade trabalha em duas superfícies:

1. **Arquivos `.yml` independentes** dentro de `.github/workflows/` (ou qualquer arquivo YAML com as chaves `on:` e `jobs:` no nível superior): visão dividida com a fonte à esquerda e o canvas interativo + editor de formulários à direita.
2. **Blocos de código em Markdown**: quando um bloco com cerca em três crases `yaml` ou `yml` contém um workflow reconhecível, o VMark o renderiza em linha como uma imagem do mesmo grafo de jobs, da mesma forma que blocos `mermaid` são renderizados.

::: tip Não é o mesmo que os workflows do próprio VMark
Um arquivo YAML cujos `steps:` de nível superior usam `genie/…` ou `action/…` é um [Workflow de Genie](/pt-BR/guide/workflows) — o formato de pipeline do próprio VMark, que o VMark pode executar. Um workflow do GitHub Actions é apenas visualizado e editado aqui; veja [O que isto não é](#o-que-isto-nao-e).
:::

## Arquivos de workflow independentes

Abra qualquer arquivo `.github/workflows/*.yml` no VMark. O arquivo abre em uma visão dividida — o fonte YAML à esquerda, a bancada de workflow à direita (a alternância Fonte / Dividido / Visualização troca o layout). A bancada mostra:

- O workflow completo como um canvas React Flow interativo (jobs como nós, dependências `needs:` como arestas). Sua faixa de controles aplica zoom, ajusta o grafo ao painel e alterna o layout entre de cima para baixo e da esquerda para a direita — útil para uma longa cadeia de `needs:` em um painel largo.
- O controle de exportação no canto superior direito do canvas (veja [Exportações](#exportacoes)).
- Um painel de edição estruturado abaixo do canvas: o banner de [Diagnósticos](#diagnosticos), os controles Salvar / Descartar, os formulários do nível do workflow e o formulário do job ou step que estiver selecionado.

Clique em um job no canvas para editá-lo. Clique em um step dentro do job para editar esse step. Escape limpa a seleção e devolve o foco ao fonte.

Enquanto você edita o fonte, o VMark mantém os dois painéis sincronizados: mover o cursor para as linhas de um job destaca o nó dele no canvas, expressões `${{ }}` são autocompletadas com base nos contextos do workflow analisado, e Cmd-clique em uma referência `uses:` local abre o arquivo de destino.

### Edição de jobs

Campos editáveis:

| Campo | Tipo de patch |
|-------|---------------|
| `name` | `job.set` |
| `runs-on` | `job.set` |
| `if` | `job.set` |

Resumo somente leitura: contagem de steps, `needs:` e `uses:` (para jobs de workflow reutilizável).

**Adicionar trabalho** (acima dos formulários) cria um job a partir de um ID que você digita — ele deve começar com uma letra ou sublinhado e ainda não existir — executando em `ubuntu-latest` até que você o altere. O botão de exclusão do formulário do job remove o job selecionado depois que você confirma.

O formulário do job também lista os steps do job. Cada linha pode ser movida para cima ou para baixo ou excluída (após uma confirmação), e **Adicionar etapa** acrescenta um novo step como `run: echo TODO`, pronto para editar.

### Edição de steps

Campos editáveis:

| Campo | Tipo de patch |
|-------|---------------|
| `name` | `step.set` |
| `run` (para run-steps) | `step.set` |
| `working-directory` | `step.set` |
| `if` | `step.set` |
| chaves `with:` | `with.set` / `with.remove` |

O bloco `with:` é renderizado como linhas de adicionar/editar/remover chave/valor. Renomear uma chave emite um `with.remove` para a chave antiga seguido de um `with.set` para a nova. Uma chave já usada por outra linha é recusada ali mesmo, na linha.

Para steps `uses:`, a referência da action em si é somente leitura — altere-a no fonte se precisar de uma action diferente.

No formulário do step, **Alt + Left** / **Alt + Right** vão para o step anterior / seguinte. O atalho funciona em qualquer lugar da janela, exceto dentro de um campo de texto, de uma seleção ou de um editor de código, onde Alt + seta mantém o significado normal de navegar por palavras.

### Triggers

Um trigger escrito como mapeamento (`on: { push: { branches: [main] } }`) tem campos de filtro editáveis — branches, branches-ignore, tags, tags-ignore, paths, paths-ignore e types — cada um uma lista separada por vírgulas. Um cron de `schedule` é exibido como uma frase no idioma da interface — os nomes de dias e meses continuam como abreviações de três letras em inglês (`Mon`, `Jan`) — com um aviso quando executa com frequência maior que a cada 5 minutos (o GitHub limita esses agendamentos), e é somente leitura. O mesmo vale para um trigger escrito como um nome de evento isolado ou uma lista de nomes; edite esses no fonte.

### Permissões e concorrência

Dois formulários do nível do workflow ficam acima do formulário do job:

- **Permissões** — o padrão do GitHub (sem a chave `permissions:`), `read-all`, `write-all`, `none` ou uma tabela por escopo (`contents`, `pull-requests`, …) com read / write / none para cada um.
- **Concorrência** — o `group` e se `cancel-in-progress` está ativado. Um `cancel-in-progress` escrito como expressão é exibido, mas não pode ser editado aqui.

## Salvando edições

As edições se acumulam em uma lista de patches em memória conforme você altera os campos. O botão Salvar mostra a contagem atual (por exemplo, **3 não salvas**), e novos jobs e steps já aparecem no canvas e nos formulários antes de você salvar.

Quando você clica em Salvar, o VMark:

1. Lê o YAML atual do editor.
2. Aplica cada patch enfileirado ao CST (concrete syntax tree) do YAML — preservando comentários, âncoras e formatação existente.
3. Para um arquivo em disco, grava o resultado no arquivo e depois atualiza o editor para corresponder — a menos que você tenha digitado no fonte nesse meio-tempo, caso em que sua digitação é mantida.

Se a gravação falhar, nada se perde: as edições continuam na fila e você pode salvar de novo. Um documento sem título não tem arquivo para gravar, então Salvar atualiza apenas o editor; pressione **Cmd+Shift+S** para salvá-lo. **Descartar** remove as edições enfileiradas.

### Preservando a formatação

O caminho de salvamento padrão executa cada patch pela API CST do pacote `yaml` — comentários, nós de âncora, indentação personalizada e escolhas existentes entre estilo flow e block são preservados.

Desabilite **Preservar a formatação YAML ao salvar** em Configurações → Avançado se preferir saída canônica reformatada. O caminho de reformatação descarta comentários, então isso é opt-in.

## Blocos de código em markdown

Digite um workflow em um bloco de código YAML:

````markdown
```yaml
name: ci
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test
```
````

O VMark detecta a forma do workflow (chaves `on:` e `jobs:` de nível superior) e renderiza em linha uma imagem do seu grafo de jobs — o mesmo canvas da visão independente, capturado como imagem. A imagem é somente leitura; clique duas vezes nela para editar o fonte.

## Diagnósticos

O VMark expõe diagnósticos de parse + lint em um banner no topo do painel de formulários. Clicar em uma linha leva o fonte até a linha problemática, ou seleciona o job problemático quando a linha não está disponível (por exemplo, no modo Visualização):

| Prefixo do código | Significado |
|-------------------|-------------|
| `GHA-PARSE-*` | YAML malformado ou faltando chaves obrigatórias |
| `GHA-JOB-*` | Problemas no nível do job (id duplicado, conflito entre `uses:` e `steps:`) |
| `GHA-NEEDS-*` | Problemas de dependências (referência desconhecida, ciclo) |
| `GHA-STEP-*` | Problemas no nível do step |
| `GHA-EXPR-*` | Referências de contexto desconhecidas |
| `GHA-MATRIX-*` | Problemas de expansão de matriz |
| `GHA-SEC-*` | Avisos de segurança (por exemplo, padrões de checkout em `pull_request_target`) |
| `GHA-ACTIONLINT-*` | Encaminhados pelo `actionlint`, se instalado |

Instale o `actionlint` para diagnósticos de expressão mais ricos. Com **Usar actionlint quando disponível** ativado — em Configurações → Avançado (Arquivos de fluxo de trabalho), ativado por padrão — o VMark executa o binário a partir do PATH do seu shell de login sempre que o fonte de um arquivo de workflow muda e acrescenta os resultados ao banner de Diagnósticos da bancada, marcados como `GHA-ACTIONLINT-<rule>`; as verificações integradas acima nunca esperam por ele. Se a opção estiver ativada mas o binário não estiver instalado, o VMark avisa uma vez por sessão e, fora isso, fica em silêncio; se o binário estiver presente mas falhar ao executar, a falha é informada uma vez com a própria mensagem do actionlint. Desative a opção para ignorar o actionlint por completo. A operação MCP `workflow.validate` executa a mesma verificação sob demanda.

## Metadados de actions

Para steps `uses:` que referenciam GitHub Actions públicas, o VMark busca o `action.yml` de cada action para popular as descrições de inputs no editor estruturado. Os resultados ficam em cache no disco por 24 horas. Actions locais do espaço de trabalho (`./…`) são lidas do disco, nunca da rede.

Para manter o editor de workflow totalmente offline, desative **Buscar metadados de actions** em Configurações → Avançado (Arquivos de fluxo de trabalho) — com a opção desativada, nenhuma requisição de rede é feita e o formulário `with:` volta a usar linhas livres de chave/valor.

## Exportações

O controle de exportação no canto superior direito do canvas oferece três formatos:

| Formato | Use para |
|---------|----------|
| **Mermaid** | Embutir em READMEs e outros documentos markdown. Copiado para a área de transferência. Com perdas: omite status de execução, ícones de actions, badges personalizadas e detalhes de expansão de matriz. |
| **SVG** | Embutir em documentos que precisam de gráficos vetoriais. Usa `foreignObject` para conteúdo HTML. |
| **PNG** | Compartilhar em chat ou onde quer que SVG não seja suportado. Renderiza com o zoom atual do canvas. |

## O que isto não é

O VMark não executa workflows do GitHub Actions. É um visualizador e editor — a execução continua sendo trabalho do GitHub. A funcionalidade é puramente para ler, revisar e escrever YAML de workflow. Os pipelines executáveis do próprio VMark são um formato diferente: veja [Workflows de Genie](/pt-BR/guide/workflows).
