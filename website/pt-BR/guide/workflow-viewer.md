# Visualizador de Workflows do GitHub Actions

O VMark renderiza YAML de workflows do GitHub Actions como um grafo acíclico dirigido (DAG) interativo e permite editar jobs, steps e triggers através de formulários estruturados — sem nunca perder comentários, âncoras ou formatação no arquivo subjacente.

A funcionalidade trabalha em duas superfícies:

1. **Arquivos `.yml` independentes** dentro de `.github/workflows/` (ou qualquer arquivo cuja forma de nível superior corresponda a um workflow): visão dividida com a fonte à esquerda e o canvas interativo + editor de formulários à direita.
2. **Blocos de código em Markdown**: quando um bloco com cerca em três crases `yaml` ou `yml` contém um workflow reconhecível, o VMark o renderiza como um DAG estilo Mermaid em linha, da mesma forma que blocos `mermaid` são renderizados.

## Arquivos de workflow independentes

Abra qualquer `.github/workflows/*.yml` no VMark. O painel lateral à direita abre automaticamente e mostra:

- O workflow completo como um canvas React Flow interativo (jobs como nós, dependências `needs:` como arestas).
- Um painel de edição estruturado abaixo do canvas.
- Controles Salvar / Descartar no cabeçalho do editor.

Clique em um job no canvas para editá-lo. Clique em um step dentro do job para editar esse step.

### Edição de jobs

Campos editáveis:

| Campo | Tipo de patch |
|-------|---------------|
| `name` | `job.set` |
| `runs-on` | `job.set` |
| `if` | `job.set` |

Resumo somente leitura: contagem de steps, `needs:` e `uses:` (para jobs de workflow reutilizável).

### Edição de steps

Campos editáveis:

| Campo | Tipo de patch |
|-------|---------------|
| `name` | `step.set` |
| `run` (para run-steps) | `step.set` |
| `working-directory` | `step.set` |
| `if` | `step.set` |
| chaves `with:` | `with.set` / `with.remove` |

O bloco `with:` é renderizado como linhas de adicionar/editar/remover chave/valor. Renomear uma chave emite um `with.remove` para a chave antiga seguido de um `with.set` para a nova.

Para steps `uses:`, a referência da action em si é somente leitura — altere-a no fonte se precisar de uma action diferente.

### Triggers

O resumo de triggers (event, branches, tags, paths, cron, types) é somente leitura nesta versão. Editar a estrutura densa de triggers via campos de uma única linha é perda demais; edite triggers no fonte até que um seletor dedicado seja entregue.

## Salvando edições

As edições se acumulam em uma lista de patches em memória conforme você altera os campos. O botão Salvar mostra a contagem atual (por exemplo, **3 não salvos**).

Quando você clica em Salvar, o VMark:

1. Lê o YAML atual do editor.
2. Aplica cada patch enfileirado ao CST (concrete syntax tree) do YAML — preservando comentários, âncoras e formatação existente.
3. Escreve o resultado de volta no editor como se você tivesse digitado.

O arquivo fica sujo no sentido normal; pressione **Cmd+S** para gravar em disco.

### Preservando a formatação

O caminho de salvamento padrão executa cada patch pela API CST do pacote `yaml` — comentários, nós de âncora, indentação personalizada e escolhas existentes entre estilo flow e block são preservados.

Desabilite **Preservar formatação YAML ao salvar** em Configurações → Avançado se preferir saída canônica reformatada. O caminho de reformatação descarta comentários, então isso é opt-in.

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

O VMark detecta a forma do workflow (`jobs:` de nível superior com `runs-on` por job) e renderiza o diagrama em linha. O diagrama é somente leitura — edite o fonte para alterar o workflow.

## Diagnósticos

O VMark expõe diagnósticos de parse + lint ao lado do fonte:

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

Instale o `actionlint` e ative **Usar actionlint quando disponível** em Configurações → Avançado para diagnósticos de expressão mais ricos.

## Metadados de actions

Para steps `uses:` que referenciam GitHub Actions públicas, o VMark pode buscar o `action.yml` de cada action para popular as descrições de inputs no editor estruturado. Isso é opt-in e fica em cache no disco por 24 horas.

Alterne **Buscar metadados de action** em Configurações → Avançado. Desabilite para manter todas as referências de action puramente como texto — nenhuma requisição de rede é feita.

## Exportações

O painel lateral do workflow inclui três opções de exportação acessíveis a partir do menu do cabeçalho:

| Formato | Use para |
|---------|----------|
| **Mermaid** | Embutir em READMEs e outros documentos markdown. Com perdas: omite status de execução, ícones de actions, badges personalizadas e detalhes de expansão de matriz. |
| **SVG** | Embutir em documentos que precisam de gráficos vetoriais. Usa `foreignObject` para conteúdo HTML. |
| **PNG** | Compartilhar em chat ou onde quer que SVG não seja suportado. Renderiza com o zoom atual do canvas. |

## O que isto não é

O VMark não executa workflows do GitHub Actions. É um visualizador e editor — a execução continua sendo trabalho do GitHub. A funcionalidade é puramente para ler, revisar e escrever YAML de workflow.
