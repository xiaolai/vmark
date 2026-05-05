# Gênios de IA

Os Gênios de IA são modelos de prompt que transformam seu texto usando IA. Selecione o texto, invoque um gênio e revise as alterações sugeridas — tudo sem sair do editor.

## Início Rápido

1. Configure um provedor de IA em **Configurações > Integrações** (veja [Provedores de IA](/pt-BR/guide/ai-providers))
2. Selecione algum texto no editor
3. Pressione `Mod + Y` para abrir o seletor de gênios
4. Escolha um gênio ou digite um prompt livre
5. Revise a sugestão inline — aceite ou rejeite

## O Seletor de Gênios

Pressione `Mod + Y` (ou menu **Ferramentas > Gênios de IA**) para abrir uma sobreposição no estilo Spotlight com uma única entrada unificada.

**Pesquisa e formulário livre** — Comece a digitar para filtrar gênios por nome, descrição ou categoria. Se nenhum gênio corresponder, a entrada se torna um campo de prompt livre.

**Chips Rápidos** — Quando o escopo é "seleção" e a entrada está vazia, botões de um clique aparecem para ações comuns (Polir, Condensar, Gramática, Reformular).

**Formulário livre em duas etapas** — Quando nenhum gênio corresponder, pressione `Enter` uma vez para ver uma dica de confirmação, depois `Enter` novamente para enviar como prompt de IA. Isso evita envios acidentais.

**Ciclo de escopo** — Pressione `Tab` para ciclar entre escopos: seleção → bloco → documento → todos.

**Histórico de prompts** — No modo livre (sem gênios correspondentes), pressione `ArrowUp` / `ArrowDown` para ciclar pelos prompts anteriores. Pressione `Ctrl + R` para abrir um dropdown de histórico pesquisável. O texto fantasma mostra o prompt correspondente mais recente como uma dica cinza — pressione `Tab` para aceitá-la.

### Feedback de Processamento

Após selecionar um gênio ou enviar um prompt livre, o seletor mostra feedback inline:

- **Processando** — Um indicador de pensamento com contador de tempo decorrido. Pressione `Escape` para cancelar.
- **Visualização** — A resposta da IA é transmitida em tempo real. Use `Aceitar` para aplicar ou `Rejeitar` para descartar.
- **Erro** — Se algo der errado, a mensagem de erro aparece com um botão `Tentar Novamente`.

A barra de status também mostra o progresso da IA — um ícone giratório com tempo decorrido enquanto executa, um breve flash "Concluído" no sucesso, ou um indicador de erro com botões Tentar Novamente/Dispensar. A barra de status é exibida automaticamente quando a IA tem status ativo, mesmo que você a tenha ocultado anteriormente com `F7`.

## Gênios Integrados

O VMark vem com 13 gênios em quatro categorias:

### Edição

| Gênio | Descrição | Escopo |
|-------|-----------|--------|
| Polir | Melhorar clareza e fluxo | Seleção |
| Condensar | Tornar o texto mais conciso | Seleção |
| Corrigir Gramática | Corrigir gramática e ortografia | Seleção |
| Simplificar | Usar linguagem mais simples | Seleção |

### Criativo

| Gênio | Descrição | Escopo |
|-------|-----------|--------|
| Expandir | Desenvolver ideia em prosa mais completa | Seleção |
| Reformular | Dizer a mesma coisa de forma diferente | Seleção |
| Vívido | Adicionar detalhes sensoriais e imagens | Seleção |
| Continuar | Continuar escrevendo a partir daqui | Bloco |

### Estrutura

| Gênio | Descrição | Escopo |
|-------|-----------|--------|
| Resumir | Resumir o documento | Documento |
| Esboço | Gerar um esboço | Documento |
| Título | Sugerir opções de título | Documento |

### Ferramentas

| Gênio | Descrição | Escopo |
|-------|-----------|--------|
| Traduzir | Traduzir para inglês | Seleção |
| Reescrever em Inglês | Reescrever texto em inglês | Seleção |

## Escopo

Cada gênio opera em um dos três escopos:

- **Seleção** — O texto destacado. Se nada estiver selecionado, volta ao bloco atual.
- **Bloco** — O parágrafo ou elemento de bloco na posição do cursor.
- **Documento** — O conteúdo completo do documento.

O escopo determina qual texto é extraído e passado para a IA como `{{content}}`.

::: tip
Se o escopo for **Seleção** mas nada estiver selecionado, o gênio opera no parágrafo atual.
:::

## Revisando Sugestões

Após a execução de um gênio, a sugestão aparece inline:

- **Substituir** — Texto original com tachado, novo texto em verde
- **Inserir** — Novo texto mostrado em verde após o bloco de origem
- **Excluir** — Texto original com tachado

Cada sugestão tem botões de aceitar (marca de verificação) e rejeitar (X).

### Atalhos de Teclado

| Ação | Atalho |
|------|--------|
| Aceitar sugestão | `Enter` |
| Rejeitar sugestão | `Escape` |
| Próxima sugestão | `Tab` |
| Sugestão anterior | `Shift + Tab` |
| Aceitar todas | `Mod + Shift + Enter` |
| Rejeitar todas | `Mod + Shift + Escape` |

## Indicador da Barra de Status

Enquanto a IA está gerando, a barra de status mostra um ícone de brilho giratório com um contador de tempo decorrido ("Pensando... 3s"). Um botão de cancelar (×) permite parar a solicitação.

Após a conclusão, uma breve marca de verificação "Concluído" pisca por 3 segundos. Se ocorrer um erro, a barra de status mostra a mensagem de erro com botões Tentar Novamente e Dispensar.

A barra de status é exibida automaticamente quando a IA tem status ativo (executando, erro ou sucesso), mesmo que você a tenha ocultado com `F7`.

---

## Escrevendo Gênios Personalizados

Você pode criar seus próprios gênios. Cada gênio é um único arquivo Markdown com frontmatter YAML e um modelo de prompt.

### Onde os Gênios Ficam

Os gênios são armazenados no diretório de dados do aplicativo:

| Plataforma | Caminho |
|------------|---------|
| macOS | `~/Library/Application Support/app.vmark/genies/` |
| Windows | `%APPDATA%\app.vmark\genies\` |
| Linux | `~/.local/share/app.vmark/genies/` |

Abra esta pasta no menu **Ferramentas > Abrir Pasta de Gênios**.

### Estrutura de Diretório

Subdiretórios se tornam **categorias** no seletor. Você pode organizar os gênios como quiser:

```
genies/
├── editing/
│   ├── polish.md
│   ├── condense.md
│   └── fix-grammar.md
├── creative/
│   ├── expand.md
│   └── rephrase.md
├── academic/          ← sua categoria personalizada
│   ├── cite.md
│   └── abstract.md
└── my-workflows/      ← outra categoria personalizada
    └── blog-intro.md
```

### Formato do Arquivo

Todo arquivo de gênio tem duas partes: **frontmatter** (metadados) e **template** (o prompt).

```markdown
---
description: Melhorar clareza e fluxo
scope: selection
category: editing
---

Você é um editor especialista. Melhore a clareza, o fluxo e a concisão
do texto a seguir preservando a voz e a intenção do autor.

Retorne apenas o texto melhorado — sem explicações.

{{content}}
```

O nome do arquivo `polish.md` se torna o nome de exibição "Polish" no seletor.

### Campos do Frontmatter

| Campo | Obrigatório | Valores | Padrão |
|-------|-------------|---------|--------|
| `description` | Não | Breve descrição exibida no seletor | Vazio |
| `scope` | Não | `selection`, `block`, `document` | `selection` |
| `category` | Não | Nome da categoria para agrupamento | Nome do subdiretório |
| `action` | Não | `replace`, `insert` | `replace` |
| `context` | Não | `1`, `2` | `0` (nenhum) |
| `model` | Não | Identificador de modelo para substituir o padrão do provedor | Padrão do provedor |

**Nome do gênio** — O nome de exibição é sempre derivado do **nome do arquivo** (sem `.md`). Por exemplo, `fix-grammar.md` aparece como "Fix Grammar" no seletor. Renomeie o arquivo para alterar o nome de exibição.

### O Placeholder `{{content}}`

O placeholder `{{content}}` é o núcleo de todo gênio. Quando um gênio é executado, o VMark:

1. **Extrai o texto** com base no escopo (texto selecionado, bloco atual ou documento completo)
2. **Substitui** todo `{{content}}` no seu template pelo texto extraído
3. **Envia** o prompt preenchido para o provedor de IA ativo
4. **Transmite** a resposta de volta como sugestão inline

Por exemplo, com este template:

```markdown
Traduza o texto a seguir para o francês.

{{content}}
```

Se o usuário selecionar "Olá, como vai?", a IA recebe:

```
Traduza o texto a seguir para o francês.

Olá, como vai?
```

A IA responde com "Bonjour, comment allez-vous ?" e aparece como sugestão inline substituindo o texto selecionado.

### O Placeholder `{{context}}`

O placeholder `{{context}}` fornece à IA texto ao redor somente leitura — para que ela possa corresponder ao tom, estilo e estrutura dos blocos próximos sem modificá-los.

**Como funciona:**

1. Defina `context: 1` ou `context: 2` no frontmatter para incluir ±1 ou ±2 blocos vizinhos
2. Use `{{context}}` no seu template onde você quer que o texto ao redor seja injetado
3. A IA vê o contexto mas a sugestão só substitui `{{content}}`

**Blocos compostos são atômicos** — se um vizinho for uma lista, tabela, citação ou bloco de detalhes, a estrutura inteira conta como um bloco.

**Restrições de escopo** — O contexto funciona apenas com escopos `selection` e `block`. Para escopo `document`, o conteúdo já É o documento completo.

**Prompts livres** — Quando você digita uma instrução livre no seletor, o VMark inclui automaticamente ±1 bloco ao redor como contexto para escopos `selection` e `block`. Sem configuração necessária.

**Compatível com versões anteriores** — Gênios sem `{{context}}` funcionam exatamente como antes. Se o template não contiver `{{context}}`, nenhum texto ao redor é extraído.

**Exemplo — o que a IA recebe:**

Com `context: 1` e o cursor no segundo parágrafo de um documento de três parágrafos:

```
[Antes]
Conteúdo do primeiro parágrafo aqui.

[Depois]
Conteúdo do terceiro parágrafo aqui.
```

As seções `[Antes]` e `[Depois]` são omitidas quando não há vizinhos nessa direção (por exemplo, o conteúdo está no início ou no final do documento).

### O Campo `action`

Por padrão, os gênios **substituem** o texto de origem pela saída da IA. Defina `action: insert` para **acrescentar** a saída após o bloco de origem em vez disso.

Use `replace` para: edição, reformulação, tradução, correções gramaticais — qualquer coisa que transforme o texto original.

Use `insert` para: continuar escrevendo, gerar resumos abaixo do conteúdo, adicionar comentários — qualquer coisa que adicione novo texto sem remover o original.

**Exemplo — ação insert:**

```markdown
---
description: Continuar escrevendo a partir daqui
scope: block
action: insert
---

Continue escrevendo naturalmente de onde o texto a seguir termina.
Corresponda à voz, estilo e tom do autor. Escreva 2-3 parágrafos.

Não repita nem resuma o texto existente — apenas continue-o.

{{content}}
```

### O Campo `model`

Substitua o modelo padrão para um gênio específico. Útil quando você quer um modelo mais barato para tarefas simples ou um mais poderoso para tarefas complexas.

```markdown
---
description: Correção gramatical rápida (usa modelo rápido)
scope: selection
model: claude-haiku-4-5-20251001
---

Corrija erros de gramática e ortografia. Retorne apenas o texto corrigido.

{{content}}
```

O identificador do modelo deve corresponder ao que seu provedor ativo aceita.

## Escrevendo Prompts Eficazes

### Seja Específico Sobre o Formato de Saída

Diga à IA exatamente o que retornar. Sem isso, os modelos tendem a adicionar explicações, cabeçalhos ou comentários.

```markdown
<!-- Bom -->
Retorne apenas o texto melhorado — sem explicações.

<!-- Ruim — a IA pode envolver a saída em aspas, adicionar "Aqui está a versão melhorada:", etc. -->
Melhore este texto.
```

### Defina um Papel

Dê à IA uma persona para ancorar seu comportamento.

```markdown
<!-- Bom -->
Você é um editor técnico especialista em documentação de APIs.

<!-- Ok, mas menos focado -->
Edite o texto a seguir.
```

### Restrinja o Escopo

Diga à IA o que NÃO deve alterar. Isso evita edição excessiva.

```markdown
<!-- Bom -->
Corrija apenas erros gramaticais e de ortografia.
Não altere o significado, estilo ou tom.
Não reestruture frases.

<!-- Ruim — dá à IA muita liberdade -->
Corrija este texto.
```

### Use Markdown nos Prompts

Você pode usar formatação Markdown nos seus templates de prompt. Isso ajuda quando você quer que a IA produza saída estruturada.

```markdown
---
description: Gerar uma análise de prós/contras
scope: selection
action: insert
---

Analise o texto a seguir e produza uma breve lista de prós/contras.

Formato como:

**Prós:**
- ponto 1
- ponto 2

**Contras:**
- ponto 1
- ponto 2

{{content}}
```

### Mantenha os Prompts Focados

Um gênio, um trabalho. Não combine várias tarefas em um único gênio — crie gênios separados em vez disso.

```markdown
<!-- Bom — um trabalho claro -->
---
description: Converter para voz ativa
scope: selection
---

Reescreva o texto a seguir usando a voz ativa.
Não altere o significado.
Retorne apenas o texto reescrito.

{{content}}
```

## Exemplos de Gênios Personalizados

### Acadêmico — Escrever um Resumo

```markdown
---
description: Gerar um resumo acadêmico
scope: document
action: insert
---

Leia o artigo a seguir e escreva um resumo acadêmico conciso
(150-250 palavras). Siga a estrutura padrão: contexto, métodos,
resultados, conclusão.

{{content}}
```

### Blog — Gerar um Gancho

```markdown
---
description: Escrever um parágrafo de abertura envolvente
scope: document
action: insert
---

Leia o rascunho a seguir e escreva um parágrafo de abertura atraente
que prenda o leitor. Use uma pergunta, fato surpreendente ou cena vívida.
Mantenha em menos de 3 frases.

{{content}}
```

### Código — Explicar Bloco de Código

```markdown
---
description: Adicionar uma explicação em linguagem simples acima do código
scope: selection
action: insert
---

Leia o código a seguir e escreva uma breve explicação em linguagem simples
do que ele faz. Use 1-2 frases. Não inclua o código em si
na sua resposta.

{{content}}
```

### E-mail — Tornar Profissional

```markdown
---
description: Reescrever em tom profissional
scope: selection
---

Reescreva o texto a seguir em um tom profissional e adequado para negócios.
Mantenha o mesmo significado e pontos principais. Remova linguagem informal,
gírias e palavras de preenchimento.

Retorne apenas o texto reescrito — sem explicações.

{{content}}
```

### Tradução — Para Português Brasileiro

```markdown
---
description: Traduzir para Português Brasileiro
scope: selection
---

Traduza o texto a seguir para o Português Brasileiro.
Preserve o significado, tom e formatação originais.
Use Português natural e idiomático — não traduza palavra por palavra.

Retorne apenas o texto traduzido — sem explicações.

{{content}}
```

### Consciente do Contexto — Adequar ao Entorno

```markdown
---
description: Reescrever para corresponder ao tom e estilo circundante
scope: selection
context: 1
---

Reescreva o conteúdo a seguir para se encaixar naturalmente com seu contexto circundante.
Corresponda ao tom, estilo e nível de detalhe.

Retorne apenas o texto reescrito — sem explicações.

## Contexto circundante (não incluir na saída):
{{context}}

## Conteúdo para reescrever:
{{content}}
```

### Revisão — Verificação de Fatos

```markdown
---
description: Sinalizar afirmações que precisam de verificação
scope: selection
action: insert
---

Leia o texto a seguir e liste quaisquer afirmações factuais que devam ser
verificadas. Para cada afirmação, anote por que pode precisar de verificação (por exemplo,
números específicos, datas, estatísticas ou afirmações fortes).

Formate como lista com marcadores. Se tudo parecer sólido, diga
"Nenhuma afirmação sinalizada para verificação."

{{content}}
```

## Sugestões de IA

Quando um Gênio retorna um texto destinado a substituir a seleção (em vez de uma resposta de chat livre), o VMark exibe o resultado como uma **sugestão** com diff inline: tachado em vermelho para o texto original, sublinhado em verde para o texto proposto. Você revisa e aprova antes de qualquer alteração ser persistida.

| Ação | Atalho |
|------|--------|
| Aceitar a sugestão em foco | `Tab` |
| Rejeitar a sugestão em foco | `Esc` |
| Aceitar todas as sugestões do documento | `Mod + Shift + Enter` _(sensível ao contexto — também Adicionar Linha Acima quando dentro de uma tabela)_ |
| Avançar para a próxima sugestão | `Tab` a partir de uma posição fora de foco |

Quando um Gênio reescreve vários parágrafos, cada substituição é uma sugestão independente, navegável separadamente. Aceitar uma não aceita automaticamente as outras.

A interface de sugestões também tem uma superfície MCP — agentes de IA externos conectados pelo [servidor MCP](/pt-BR/guide/mcp-tools) podem emitir as ações `suggestion.accept` / `suggestion.reject` para manipular o mesmo estado.

## Limitações

- Os gênios só funcionam no **modo WYSIWYG**. No modo fonte, uma notificação de toast explica isso.
- Um gênio pode ser executado por vez. Se a IA já estiver gerando, o seletor não iniciará outro.
- O placeholder `{{content}}` é substituído literalmente — não suporta condicionais ou loops.
- Documentos muito grandes podem atingir os limites de token do provedor ao usar `scope: document`.

## Solução de Problemas

**"Nenhum provedor de IA disponível"** — Abra Configurações > Integrações e configure um provedor. Veja [Provedores de IA](/pt-BR/guide/ai-providers).

**Gênio não aparece no seletor** — Verifique se o arquivo tem extensão `.md`, frontmatter válido com delimitadores `---` e está no diretório de gênios (não em subdiretório mais profundo que um nível).

**IA retorna lixo ou erros** — Verifique se sua chave de API está correta e se o nome do modelo é válido para seu provedor. Verifique o terminal/console para detalhes do erro.

**Sugestão não corresponde às expectativas** — Refine seu prompt. Adicione restrições ("retorne apenas o texto", "não explique"), defina um papel ou reduza o escopo.

## Veja Também

- [Provedores de IA](/pt-BR/guide/ai-providers) — Configurar provedores CLI ou API REST
- [Atalhos de Teclado](/pt-BR/guide/shortcuts) — Referência completa de atalhos
- [Ferramentas MCP](/pt-BR/guide/mcp-tools) — Integração de IA externa via MCP
