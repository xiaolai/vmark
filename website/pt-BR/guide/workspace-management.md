# Gerenciamento de Área de Trabalho

Uma área de trabalho no VMark é uma pasta aberta como raiz do seu projeto. Quando você abre uma área de trabalho, a barra lateral mostra uma árvore de arquivos, a Abertura Rápida consegue encontrar todos os arquivos que a árvore de arquivos mostra, o terminal inicia na raiz do projeto e as abas abertas são lembradas para a próxima vez.

Sem uma área de trabalho, você ainda pode abrir arquivos individuais, mas perde o explorador de arquivos, a pesquisa no projeto e a restauração de sessão.

::: tip Várias áreas de trabalho em uma janela
A [barra de espaços de trabalho](/pt-BR/guide/workspace-rail) experimental permite que uma única janela contenha várias áreas de trabalho e alterne entre elas — cada uma com suas próprias abas, árvore de arquivos e layout.
:::

## Abrindo uma Área de Trabalho

| Método | Como |
|--------|------|
| Menu | **Arquivo > Abrir Área de Trabalho** |
| Abertura Rápida | `Mod + O`, depois selecione **Navegar...** no final |
| Arrastar e soltar | Arraste um arquivo markdown do Finder para a janela — o VMark detecta sua raiz de projeto e abre a área de trabalho automaticamente |
| Áreas de Trabalho Recentes | **Arquivo > Áreas de Trabalho Recentes** e escolha um projeto anterior |

Quando você abre uma área de trabalho, o VMark mostra a barra lateral com o explorador de arquivos. Se a área de trabalho foi aberta antes, as abas abertas anteriormente são restauradas.

No Windows e no Linux, uma pasta passada na linha de comando (`vmark C:\notes` ou `vmark ~/notes`) abre como área de trabalho em uma janela própria, como acontece no macOS ao soltar uma pasta sobre o ícone no Dock. Isso também funciona quando o VMark já está em execução.

::: tip
Se a janela atual tiver alterações não salvas, o VMark oferece abrir a área de trabalho em uma nova janela em vez de substituir seu trabalho.
:::

## Explorador de Arquivos

O explorador de arquivos aparece na barra lateral sempre que uma área de trabalho estiver aberta. Ele mostra uma árvore de arquivos markdown com raiz na pasta da área de trabalho.

### Navegação

- **Clique único** em uma pasta para expandi-la ou colapsá-la
- **Clique único** em um arquivo para abri-lo em uma aba
- **Enter** (ou `F2`) em um item selecionado inicia a renomeação inline
- Arquivos que o próprio VMark não edita (visíveis com **Mostrar Todos os Arquivos**) abrem com o aplicativo padrão do sistema
- As pastas começam recolhidas quando uma área de trabalho é aberta pela primeira vez; o estado aberto delas é preservado enquanto você alterna entre as visualizações Arquivos, Estrutura e Histórico

### Visualização Rápida

Selecione um arquivo na árvore e pressione `Space` para pré-visualizá-lo em uma sobreposição que ocupa a janela inteira, sem abrir uma aba — imagens, vídeo e áudio são exibidos com seus controles nativos; qualquer outro arquivo mostra um painel "não é possível pré-visualizar" com um botão para abri-lo externamente. `←`/`↑` e `→`/`↓` percorrem em ordem os arquivos visíveis da árvore (sem dar a volta), e `Space`, `Escape` ou um clique no fundo fecham a prévia. Digitar um espaço no campo de renomeação inline nunca a aciona.

### Botões do Cabeçalho

O cabeçalho da visualização Arquivos traz os controles que valem para a árvore inteira:

- **Expandir todas as pastas** — abre todas as pastas da árvore
- **Recolher todas as pastas** — fecha todas as pastas de volta até a raiz
- **Mostrar todos os arquivos** — uma alternância; quando está ativada (destacada), a árvore lista
  todos os arquivos em vez de apenas os que o VMark consegue abrir
- **Novo arquivo** / **Nova pasta** — criam dentro da pasta selecionada, ou na
  raiz da área de trabalho quando nada está selecionado

### Operações de Arquivo

Clique com o botão direito em um arquivo, em uma pasta ou no espaço vazio abaixo da árvore para acessar o menu de contexto:

| Ação | Exibida para | Descrição |
|------|--------------|-----------|
| Abrir | Arquivos | Abrir o arquivo em uma nova aba |
| Renomear | Arquivos, pastas | Editar o nome do arquivo ou pasta inline (também `F2`) |
| Duplicar | Arquivos | Criar uma cópia do arquivo |
| Mover para... | Arquivos | Mover o arquivo para uma pasta diferente via diálogo |
| Excluir | Arquivos, pastas | Mover o arquivo ou pasta para a lixeira do sistema |
| Copiar caminho | Arquivos, pastas | Copiar o caminho absoluto para a área de transferência |
| Mostrar no Finder | Arquivos, pastas | Mostrar o item no seu gerenciador de arquivos — com o rótulo **Mostrar no Explorador** no Windows e **Mostrar no gerenciador de arquivos** no Linux |
| Novo Arquivo | Pastas, espaço vazio | Criar um novo arquivo markdown neste local |
| Nova Pasta | Pastas, espaço vazio | Criar uma nova pasta neste local |
| Abrir terminal aqui | Pastas | Iniciar uma nova sessão de terminal nesta pasta (desativado quando 5 sessões já estão abertas) — veja [Terminal](/pt-BR/guide/terminal) |

Você também pode **arrastar e soltar** arquivos entre pastas diretamente na árvore.

### Alternâncias de Visibilidade

Por padrão, o explorador mostra apenas os tipos de arquivo que o VMark consegue abrir e oculta dotfiles.
**As pastas são listadas contendo ou não algo visível**, então um projeto de
tipos de arquivo não suportados parece uma árvore de pastas vazias — é o filtro em ação,
não uma falha ao ler o diretório. Duas alternâncias mudam isso:

| Alternância | Atalho | O que faz |
|-------------|--------|-----------|
| Mostrar Arquivos Ocultos | `Mod + Shift + .` (macOS) / `Ctrl + H` (Win/Linux) | Revela dotfiles e pastas ocultas |
| Mostrar Todos os Arquivos | `Mod + Shift + A` | Mostra arquivos que não são markdown junto com seus documentos |

Ambas as configurações são salvas por área de trabalho e persistem entre sessões.

### Pastas Excluídas

Alguns diretórios nunca têm seu conteúdo listado, independentemente do que digam as configurações da área de trabalho — o
mesmo piso que a pesquisa na área de trabalho aplica: `.git`, `node_modules`, `.obsidian`,
`.svn`, `__pycache__`, `.DS_Store`, `.vscode`, `.idea`, `target`, `.next`,
`dist`, `.superpowers`. Eles ainda aparecem como pastas para que você saiba que existem; seu
conteúdo não é lido. Adicione seus próprios nomes em **Pastas excluídas** nas
configurações da área de trabalho (uma nova área de trabalho começa com `.git` e `node_modules` ali).

A árvore é listada em uma única passada e atualizada quando os arquivos mudam. Uma rajada de
alterações a atualiza uma vez, logo após o fim da rajada; uma pasta que nunca
para de mudar (um download em andamento, um build, uma sincronização) é atualizada em um
intervalo crescente em vez de continuamente, para que o explorador nunca prenda um núcleo da CPU
relendo uma área de trabalho movimentada.

## Abertura Rápida

Pressione `Mod + O` para abrir a sobreposição de Abertura Rápida. Ela fornece pesquisa fuzzy em três fontes, listadas nesta ordem:

1. **Abas abertas** na janela atual (marcadas com um indicador de ponto), das usadas mais recentemente para as menos recentes
2. **Arquivos recentes** que você abriu antes
3. **Todos os arquivos que o explorador de arquivos está mostrando** na área de trabalho

Antes de você digitar, a lista mostra apenas as abas abertas e os arquivos recentes. Quando você digita, aparecem resultados das três fontes, agrupados nessa ordem e classificados pela qualidade da correspondência dentro de cada grupo.

Digite alguns caracteres para filtrar — a correspondência é fuzzy, então `rme` encontra `README.md`. Use as teclas de seta para navegar e **Enter** para abrir. Uma linha **Navegar...** fixada na parte inferior abre um diálogo de arquivo.

A terceira fonte segue exatamente o explorador de arquivos, então os dois nunca discordam
sobre o que existe. Ative **Mostrar arquivos ocultos** e a Abertura Rápida encontra documentos
em `.claude/`, `.github/workflows/` e em qualquer outro diretório com ponto; ative
**Mostrar todos os arquivos** e ela também encontra os que não são markdown, abrindo cada um da mesma
forma que um clique na barra lateral abriria — os formatos do próprio VMark em uma aba, todo o resto
no aplicativo padrão do sistema. As pastas da lista sempre ignorada
(`.git`, `node_modules`, `.vscode` e as demais) ficam de fora de ambos.

| Ação | Atalho |
|------|--------|
| Abrir Abertura Rápida | `Mod + O` |
| Navegar resultados | `Cima / Baixo` |
| Abrir arquivo selecionado | `Enter` |
| Fechar | `Escape` |

::: tip
Sem uma área de trabalho, a Abertura Rápida ainda funciona — ela mostra arquivos recentes e abas abertas, mas não consegue pesquisar a árvore de arquivos.
:::

## Pesquisa de conteúdo na área de trabalho

Quando uma área de trabalho está aberta, o VMark pode pesquisar **dentro do conteúdo dos arquivos** (não apenas nos nomes). Por padrão, ele pesquisa os tipos de arquivo que o VMark abre (Markdown, texto simples, YAML e JSON/TOML/Mermaid/SVG/HTML quando o suporte a esses formatos está ativado). Desligue a opção **.md** (**Somente tipos de arquivo compatíveis**) para pesquisar todos os arquivos de texto (arquivos binários são sempre ignorados).

| Ação | Atalho |
|------|--------|
| Abrir o painel de pesquisa de conteúdo | `Mod + Shift + H` (também **Editar → Localizar → Encontrar em arquivos...**) |
| Pular para o próximo resultado | `Enter` (ou teclas de seta para navegar) |
| Abrir resultado em uma nova aba | Clique na pré-visualização do trecho |

Cada resultado mostra o caminho do arquivo, o número da linha e um trecho com o texto correspondente destacado. Os resultados não são ranqueados: os arquivos são listados na ordem em que a pesquisa os alcança ao percorrer as pastas da área de trabalho. Uma pesquisa para após 50 arquivos com correspondências, 1.000 correspondências ou 5 segundos, e mostra o que encontrou até aquele momento.

**Excluídos por padrão**: as pastas em que o VMark nunca entra — `.git`, `node_modules`, `.obsidian`, `.svn`, `__pycache__`, `.DS_Store`, `.vscode`, `.idea`, `target`, `.next`, `dist`, `.superpowers` — além de quaisquer nomes em **Pastas excluídas** nas Configurações de área de trabalho (uma nova área de trabalho começa com `.git` e `node_modules` ali).

**Arquivos ocultos**: os dotfiles são sempre ignorados pela pesquisa de conteúdo, independentemente do que diga a alternância **Mostrar arquivos ocultos** do explorador de arquivos.

Isso é distinto da [Abertura Rápida](#abertura-rapida), que pesquisa apenas *nomes de arquivos* — a pesquisa de conteúdo abre o arquivo correspondente com o cursor posicionado na linha da ocorrência.

## Áreas de Trabalho Recentes

O VMark lembra até 10 áreas de trabalho abertas recentemente. Acesse-as em **Arquivo > Áreas de Trabalho Recentes** na barra de menus.

- As áreas de trabalho são ordenadas por hora da última abertura (mais recente primeiro)
- A lista sincroniza com o menu nativo a cada alteração
- Escolha **Limpar Áreas de Trabalho Recentes** para redefinir a lista

## Configurações de Área de Trabalho

Cada área de trabalho tem sua própria configuração que persiste entre sessões. As configurações são armazenadas no diretório de dados do aplicativo VMark — não dentro da pasta do projeto — para que sua área de trabalho permaneça limpa.

As seguintes configurações são salvas por área de trabalho:

| Configuração | Descrição |
|-------------|-----------|
| Pastas excluídas | Pastas ocultas do explorador de arquivos |
| Mostrar arquivos ocultos | Se os dotfiles são visíveis |
| Mostrar todos os arquivos | Se arquivos que não são markdown são visíveis |
| Últimas abas abertas | Caminhos de arquivo para restauração de sessão na próxima abertura |

::: tip
A configuração da área de trabalho está vinculada ao caminho da pasta. Abrir a mesma pasta na mesma máquina sempre restaura suas configurações, mesmo de uma janela diferente.
:::

## Janela de Área de Trabalho Vazia

Fechar o último documento aberto não fecha mais a janela. Em vez disso, a janela permanece aberta em uma **tela de boas-vindas** e — se você tiver uma área de trabalho aberta — a barra lateral e a árvore de arquivos continuam visíveis. Isso funciona da mesma forma no macOS, no Windows e no Linux.

A tela de boas-vindas oferece ações rápidas para voltar ao trabalho:

- Os botões **Novo arquivo**, **Abrir arquivo** e **Abrir espaço de trabalho…**
- Uma lista de **Arquivos recentes** e uma lista de **Espaços de trabalho recentes** — clique em qualquer item para
  reabri-lo. Cada lista só aparece quando tem itens.

**Abrir arquivo** e as listas de recentes reutilizam a janela em que você já está. Uma
janela na tela de boas-vindas não tem abas a serem deslocadas, então nada abre em uma segunda
janela — a menos que a janela ainda tenha uma área de trabalho aberta; nesse caso, um arquivo de
fora dessa área de trabalho ganha sua própria janela em vez de substituir a árvore de arquivos
que você ainda vê na barra lateral.

A barra de título de uma janela na tela de boas-vindas mostra **VMark**: não há documento
aberto, então não há nome de arquivo para mostrar.

Para fechar a própria janela, use o botão vermelho do semáforo, `Cmd/Ctrl + Q` (sair) ou pressione `Cmd/Ctrl + W` novamente enquanto a tela de boas-vindas estiver sendo exibida.

## Documentos Lado a Lado

Abra dois documentos **diferentes** ao mesmo tempo — divida o editor em dois painéis, cada um
com seu próprio documento. Útil para leitura/tradução bilíngue (original de um
lado, tradução do outro) ou para manter uma referência aberta enquanto você escreve.
Isso é diferente da **Visualização Dividida do Markdown** (`Shift + F6`), que é o
código-fonte + a prévia do *mesmo* arquivo.

- Alterne a divisão com **`Alt + Mod + \`** ou pela paleta de comandos
  (**Dividir editor: dois documentos lado a lado**). O documento atual fica em um painel
  e o documento que você usou mais recentemente antes dele (ou, se não houver nenhum, outro documento aberto) abre no outro — o
  mesmo documento nunca é mostrado duas vezes, então a divisão precisa de dois documentos abertos.
  Clique em uma aba enquanto um painel está focado para trocar o documento desse painel, ou
  clique com o botão direito em uma aba e escolha **Abrir ao lado**.
- Arraste o divisor (ou foque-o e use as teclas de seta) para redimensionar os painéis.
- O painel que você está editando é o painel **focado** — a barra de ferramentas, a barra de pesquisa e os
  comandos de menu atuam sobre ele.
- Ative **Sincronizar rolagem entre painéis** (paleta de comandos) para rolar os dois
  lados juntos, proporcionalmente — útil para alinhar uma tradução.

## Restauração de Sessão

Quando você fecha uma janela que tem uma área de trabalho aberta, o VMark salva a lista de abas abertas na configuração da área de trabalho. Da próxima vez que você abrir a mesma área de trabalho, essas abas são restauradas automaticamente.

- Apenas abas com um caminho de arquivo salvo são restauradas (abas sem título não são persistidas)
- Se um arquivo foi movido ou excluído desde a última sessão, ele é silenciosamente ignorado
- Os dados de sessão são salvos no fechamento da janela e no fechamento da área de trabalho (**Arquivo > Fechar Área de Trabalho**)

## Múltiplas Janelas

Cada janela do VMark pode ter sua própria área de trabalho independente. Isso permite trabalhar em múltiplos projetos simultaneamente.

- **Arquivo > Nova Janela** abre uma janela nova
- Abrir uma área de trabalho em uma nova janela não afeta outras janelas
- O tamanho e a posição da janela são lembrados por janela

Quando você arrasta um arquivo markdown do Finder e a janela atual já tem trabalho não salvo, o VMark abre o projeto do arquivo em uma nova janela automaticamente.

### Abrindo um arquivo de fora da área de trabalho atual

Uma janela com uma área de trabalho aberta mantém essa área de trabalho. Abrir um arquivo que está
em outro lugar — pelo Finder ou pelo Explorador, por **Arquivo > Abrir** ou pelos Arquivos
Recentes — o abre em uma **nova janela** com raiz na pasta dele, para que a árvore de arquivos
em que você estava trabalhando fique onde está. Apenas uma janela sem área de trabalho
própria recebe o arquivo no lugar.

No Windows e no Linux, dar um clique duplo em um arquivo cujo tipo está associado ao
VMark agora o entrega ao VMark que você já tem em execução, em vez de iniciar uma
segunda cópia. O macOS sempre funcionou assim.

### Separando Abas em Novas Janelas

Você pode puxar uma aba para fora da janela para criar uma nova:

- **Arraste uma aba para fora da barra de abas** — mais de cerca de 40 px acima ou abaixo dela — para separá-la. Solte-a sobre outra janela do VMark para mover a aba para essa janela; solte-a em qualquer outro lugar para abri-la em uma nova janela na posição do ponteiro
- **Arraste uma aba horizontalmente** dentro da barra de abas para reordená-la entre outras abas
- Abas fixadas não podem ser arrastadas

Uma notificação toast confirma a movimentação e oferece **Desfazer**, que traz a aba de volta. Abas do navegador e a última aba da janela principal não podem ser arrastadas para fora; elas voltam ao lugar.

O gesto é bloqueado por direção: movimento horizontal inicia uma reordenação, enquanto movimento vertical aciona uma separação. Você pode mudar de reordenação para separação durante o arrasto movendo o ponteiro para fora da barra de abas.

### Painel de Status das Janelas

Quando você roda o Claude Code em várias janelas, **Visualizar > Alternar status das janelas** (também na paleta de comandos, ou pressione `Ctrl + Shift + 5`) abre um painel que lista todas as outras janelas abertas com seu status em tempo real e permite ir direto até elas.

Cada linha mostra o nome do documento da janela e seu status atual:

| Status | Significado |
|--------|-------------|
| **Requer atenção** | Um terminal naquela janela (sem foco) tocou a campainha — o Claude Code a toca quando um turno termina ou quando está esperando por você |
| **Em execução** | Um gênio de IA do VMark está em execução naquela janela |
| **Erro** | A última execução de gênio de IA falhou |
| **Ociosa** | Nada em execução |

As linhas são ordenadas com a atenção em primeiro lugar, então a janela que precisa de você fica no topo. Clique em qualquer linha para focar e trazer aquela janela para a frente; focar uma janela limpa sua marcação de "requer atenção". O status vem de dois sinais confiáveis — o próprio estado de invocação dos gênios de IA do VMark e a campainha do terminal — e não da análise da saída do terminal.

**Fixe o painel** para usá-lo como um "centro de controle" persistente: enquanto fixado, clicar em uma linha foca a janela de destino, mas deixa o painel aberto, para que você possa alternar entre várias janelas sem reabri-lo. O botão de fixar no cabeçalho abre um pequeno menu com dois escopos:

- **Fixar esta janela** — fixa o painel apenas na janela atual. Seu estado aberto e fixado é lembrado por janela entre reinicializações, então uma janela que você configurou como seu painel de controle continua assim.
- **Fixar todas as janelas** — uma fixação global: todas as janelas abrem o painel automaticamente e se comportam como fixadas, *incluindo janelas que você abrir depois*, para que você adote o layout de centro de controle uma única vez em vez de configurar cada janela à mão. Desativá-la faz cada janela voltar ao seu próprio estado de fixação por janela.

## Alterações Externas

O VMark monitora sua área de trabalho em busca de alterações feitas por outros programas (Git, editores externos, ferramentas de build, etc.) e mantém os documentos abertos sincronizados.

- **Arquivos não modificados** são recarregados automaticamente quando seu conteúdo muda no disco. Uma breve notificação toast confirma o recarregamento.
- **Arquivos com alterações não salvas** disparam um diálogo com três opções: **Salvar como** (salvar sua versão em um novo local), **Recarregar** (descartar suas alterações e carregar do disco) ou **Manter** (preservar suas edições e marcar o arquivo como divergente).
- **Arquivos excluídos** são marcados como ausentes em sua aba, mas não são fechados — você ainda pode salvar o conteúdo em um novo local.
- Quando múltiplos arquivos modificados mudam de uma vez (por exemplo, após um `git checkout`), o VMark os agrupa em um único diálogo para que você possa recarregar todos, manter todos ou revisar cada arquivo individualmente.
- Se o conteúdo no disco de um arquivo divergente depois corresponder ao que você tem no editor (por exemplo, um `git checkout` restaura o mesmo texto), o VMark limpa automaticamente o estado divergente para que o salvamento automático normal seja retomado.

O VMark filtra seus próprios salvamentos para que você nunca seja solicitado por alterações que fez dentro do aplicativo.

## Documentos Recentes do Dock do macOS

Os documentos que você abre no VMark são registrados no macOS, então eles aparecem no submenu **Abrir Recentes** quando você clica com o botão direito no ícone do VMark no Dock.

## Integração com Terminal

O terminal integrado usa automaticamente a raiz da área de trabalho como seu diretório de trabalho. Quando você abre ou alterna áreas de trabalho, as sessões do terminal ociosas fazem `cd` para a nova raiz. Uma sessão ocupada executando um comando não é interrompida e muda de diretório quando o comando termina (isso requer a integração com o shell para saber quando ela está ocupada). Com a [barra de espaços de trabalho](/pt-BR/guide/workspace-rail) ativada, uma sessão que pertence a uma área de trabalho mantém seu próprio diretório.

A variável de ambiente `VMARK_WORKSPACE` é definida como o caminho da área de trabalho em cada sessão do terminal, para que seus scripts possam referenciar a raiz do projeto.

[Saiba mais sobre o terminal →](/pt-BR/guide/terminal)

## Comando CLI Shell

O VMark pode instalar um comando shell `vmark` para que você possa abrir arquivos e pastas a partir do terminal.

### Instalação e remoção

**Ajuda > Comando shell: instalar 'vmark' no PATH...** é um único item que alterna. Quando nenhum comando `vmark` está instalado, ele escreve um pequeno script lançador em `/usr/local/bin/vmark` e solicita sua senha de administrador (a mesma abordagem que o VS Code usa para seu comando `code`). Quando o script do próprio VMark já está lá, o mesmo item o remove. Um diálogo informa o resultado em ambos os casos. Somente macOS.

### Uso

```bash
# Abrir um arquivo
vmark README.md

# Abrir uma pasta como área de trabalho
vmark ~/projects/my-blog

# Abrir múltiplos arquivos
vmark chapter1.md chapter2.md
```

O comando delega para `open -b app.vmark`, então o macOS gerencia o comportamento de instância única — os arquivos abrem na sua janela VMark existente em vez de iniciar um novo processo.

Se o arquivo em `/usr/local/bin/vmark` não foi escrito pelo VMark, o item não mexe em nada e pede que você o remova manualmente.
