# Barra de espaços de trabalho

::: warning Experimental
A barra de espaços de trabalho é experimental e vem **desativada por padrão**. Ative-a em **Configurações → Arquivos e imagens → Espaço de trabalho → Barra de espaços de trabalho**. Com a barra desativada, o VMark se comporta exatamente como antes — um espaço de trabalho por janela.
:::

A barra de espaços de trabalho permite que uma janela contenha **vários espaços de trabalho ao mesmo tempo**, exibidos como uma faixa vertical de glifos coloridos na borda esquerda. Clicar em um espaço de trabalho faz uma **troca completa de contexto**: as abas do editor, a árvore de arquivos da barra lateral, o layout dos painéis divididos e o estado da barra lateral e do sumário passam todos para o conjunto próprio desse espaço de trabalho — como trocar de Spaces em um navegador, e não apenas mudar um filtro.

## O que troca e o que permanece

| Superfície | Em uma troca pela barra |
|---------|------------------|
| Faixa de abas do editor | Mostra apenas as abas do espaço de trabalho ativo (mais as páginas do navegador) |
| Árvore de arquivos da barra lateral | Passa a ter como raiz o espaço de trabalho ativo, com seu próprio estado de pastas abertas e de rolagem |
| Painéis divididos | Cada espaço de trabalho lembra seu próprio layout de divisão |
| Sumário | O estado de recolhimento/filtro/rolagem de cada aba acompanha o espaço de trabalho |
| Aba seguinte/anterior, menu de contexto da aba, "abas abertas" da Abertura rápida | Restritos ao espaço de trabalho ativo |
| Reabrir aba fechada | As abas fechadas são registradas por espaço de trabalho (mais um escopo compartilhado do navegador) e reabertas da mais recente para a mais antiga por **Arquivo → Reabrir aba fechada**, pela paleta de comandos ou por um atalho que você atribuir em Configurações → Atalhos (ele vem sem atalho: as combinações próximas já estão ocupadas). Um documento reaberto é lido de novo do disco, então mostra o arquivo como ele está agora; se o arquivo foi movido ou excluído, a aba não é restaurada e um aviso explica o motivo. Uma aba sem título reabre vazia. Edições não salvas não são recuperadas — fechar uma aba modificada já perguntou se você queria salvar |
| **Páginas do navegador** | **Globais na janela** — acessíveis a partir de todos os espaços de trabalho |
| Menus de Arquivos recentes / Espaços de trabalho recentes | Globais |
| Salvamento automático, pedidos de salvamento, monitoramento de arquivos | Cobrem **todas** as abas, ocultas ou não |

Trocar nunca fecha nada: as abas de um espaço de trabalho oculto continuam abertas em segundo plano, continuam sendo salvas automaticamente e ainda recebem um pedido de salvamento se você fechar a janela com alterações não salvas.

## Arquivos avulsos

Arquivos abertos de fora de todas as raízes de espaço de trabalho ficam em uma entrada sintética **Arquivos avulsos** (o ícone de arquivos empilhados). Trocar para ela mostra essas abas; ela aparece automaticamente quando necessário.

## Movendo arquivos entre espaços de trabalho

A posse segue o caminho do arquivo:

- **Salvar como** na pasta de outro espaço de trabalho move a aba para lá — e, se for a aba que você está vendo, o espaço de trabalho visível a acompanha.
- Renomeações ou movimentações no disco (inclusive pelo Finder) realocam a aba da mesma forma.
- Abrir um arquivo que pertence a um espaço de trabalho *oculto* (pela Abertura rápida, pelos recentes ou por uma caixa de diálogo de arquivo) troca primeiro para esse espaço de trabalho, para que a aba que você pediu seja a aba que você vê.

## Sessões e reinício

A configuração de cada espaço de trabalho lembra **apenas as suas próprias abas** e o seu layout de divisão. As páginas do navegador abertas por uma pessoa persistem por janela. A saída rápida (hot exit) restaura todos os espaços de trabalho da janela — incluindo o estado da barra lateral de cada espaço de trabalho e o histórico registrado de abas fechadas — e reativa o espaço de trabalho em que você estava.

## Comportamento da IA (MCP)

Clientes de IA que abrem documentos via MCP nunca arrancam você do espaço de trabalho visível: `workspace.open` cria uma **aba em segundo plano** e retorna seu `tabId` para as chamadas de documento seguintes. Só a ação explícita `workspace.switch_tab` muda o que você vê, e sua resposta informa `workspaceSwitched: true` para que a IA possa dizer a você que isso aconteceu. Veja a [Referência de Ferramentas MCP](/pt-BR/guide/mcp-tools).

## Ações da barra

| Ação | Como |
|--------|-----|
| Trocar de espaço de trabalho | Clique no glifo dele |
| Adicionar um espaço de trabalho | **Arquivo > Abrir espaço de trabalho** (uma pasta que já está na barra passa a ser a ativa em vez de ser duplicada) |
| Reordenar | Arraste um glifo sobre outro |
| Mover para uma janela própria | Arraste um glifo para fora da janela |
| Duplicar em uma nova janela | O botão **⧉** ao passar o mouse |
| Fechar um espaço de trabalho | Clique com o botão direito → Fechar. Todas as abas dele fecham junto, inclusive as fixadas; cada aba com alterações não salvas pergunta antes, e cancelar mantém o espaço de trabalho |

## Sessões do terminal

Cada espaço de trabalho da barra tem suas próprias sessões de terminal. Uma troca pela barra substitui as abas de terminal visíveis; os shells dos espaços de trabalho ocultos continuam em execução sem serem tocados — nenhum `cd` é digitado neles, ocupados ou ociosos — e voltar mostra os mesmos shells, com a sessão que você estava vendo lembrada por espaço de trabalho. Novas sessões (o botão **+**, "Abrir terminal aqui", "Executar no terminal") são criadas no espaço de trabalho ativo e começam na raiz dele; fechar um espaço de trabalho ou movê-lo para a sua própria janela fecha as sessões dele junto. Detalhes no [guia do terminal](/pt-BR/guide/terminal#sessoes-do-terminal-e-a-barra-de-espacos-de-trabalho).

## Limitação conhecida

No macOS, duas grafias da mesma pasta que diferem apenas em maiúsculas e minúsculas (possível em volumes que não diferenciam maiúsculas de minúsculas) são tratadas como espaços de trabalho **diferentes**. Isso é proposital: a identidade de um espaço de trabalho é exata byte a byte no macOS e no Linux, e ignora maiúsculas e minúsculas no Windows.
