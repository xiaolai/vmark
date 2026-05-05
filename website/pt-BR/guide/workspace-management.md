# Gerenciamento de Área de Trabalho

Uma área de trabalho no VMark é uma pasta aberta como raiz do seu projeto. Quando você abre uma área de trabalho, a barra lateral mostra uma árvore de arquivos, a Abertura Rápida indexa todos os arquivos markdown, o terminal inicia na raiz do projeto e as abas abertas são lembradas para a próxima vez.

Sem uma área de trabalho, você ainda pode abrir arquivos individuais, mas perde o explorador de arquivos, a pesquisa no projeto e a restauração de sessão.

## Abrindo uma Área de Trabalho

| Método | Como |
|--------|------|
| Menu | **Arquivo > Abrir Área de Trabalho** |
| Abertura Rápida | `Mod + O`, depois selecione **Navegar...** no final |
| Arrastar e soltar | Arraste um arquivo markdown do Finder para a janela — o VMark detecta sua raiz de projeto e abre a área de trabalho automaticamente |
| Áreas de Trabalho Recentes | **Arquivo > Áreas de Trabalho Recentes** e escolha um projeto anterior |

Quando você abre uma área de trabalho, o VMark mostra a barra lateral com o explorador de arquivos. Se a área de trabalho foi aberta antes, as abas abertas anteriormente são restauradas.

::: tip
Se a janela atual tiver alterações não salvas, o VMark oferece abrir a área de trabalho em uma nova janela em vez de substituir seu trabalho.
:::

## Explorador de Arquivos

O explorador de arquivos aparece na barra lateral sempre que uma área de trabalho estiver aberta. Ele mostra uma árvore de arquivos markdown com raiz na pasta da área de trabalho.

### Navegação

- **Clique único** em uma pasta para expandi-la ou colapsá-la
- **Duplo clique** ou **Enter** em um arquivo para abri-lo em uma aba
- Arquivos que não são markdown abrem com o aplicativo padrão do sistema

### Operações de Arquivo

Clique com o botão direito em qualquer arquivo ou pasta para acessar o menu de contexto:

| Ação | Descrição |
|------|-----------|
| Abrir | Abrir o arquivo em uma nova aba |
| Renomear | Editar o nome do arquivo ou pasta inline (também `F2`) |
| Duplicar | Criar uma cópia do arquivo |
| Mover Para... | Mover o arquivo para uma pasta diferente via diálogo |
| Excluir | Mover o arquivo ou pasta para a lixeira do sistema |
| Copiar Caminho | Copiar o caminho absoluto do arquivo para a área de transferência |
| Revelar no Finder | Mostrar o arquivo no Finder (macOS) |
| Novo Arquivo | Criar um novo arquivo markdown neste local |
| Nova Pasta | Criar uma nova pasta neste local |

Você também pode **arrastar e soltar** arquivos entre pastas diretamente na árvore.

### Alternâncias de Visibilidade

Por padrão, o explorador mostra apenas arquivos markdown e oculta dotfiles. Duas alternâncias mudam isso:

| Alternância | Atalho | O que faz |
|-------------|--------|-----------|
| Mostrar Arquivos Ocultos | `Mod + Shift + .` (macOS) / `Ctrl + H` (Win/Linux) | Revela dotfiles e pastas ocultas |
| Mostrar Todos os Arquivos | _(Configurações ou menu de contexto)_ | Mostra arquivos que não são markdown junto com seus documentos |

Ambas as configurações são salvas por área de trabalho e persistem entre sessões.

### Pastas Excluídas

Certas pastas são excluídas da árvore por padrão:

- `.git`
- `node_modules`

Esses padrões são aplicados quando uma área de trabalho é aberta pela primeira vez.

## Abertura Rápida

Pressione `Mod + O` para abrir a sobreposição de Abertura Rápida. Ela fornece pesquisa fuzzy em três fontes:

1. **Arquivos recentes** que você abriu antes
2. **Abas abertas** na janela atual (marcadas com um indicador de ponto)
3. **Todos os arquivos markdown** na área de trabalho

Digite alguns caracteres para filtrar — a correspondência é fuzzy, então `rme` encontra `README.md`. Use as teclas de seta para navegar e **Enter** para abrir. Uma linha **Navegar...** fixada na parte inferior abre um diálogo de arquivo.

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

Quando uma área de trabalho está aberta, o VMark pode pesquisar **dentro do conteúdo dos arquivos** (não apenas nos nomes) por correspondências em arquivos markdown e de texto.

| Ação | Atalho |
|------|--------|
| Abrir o painel de pesquisa de conteúdo | `Mod + Shift + F` |
| Pular para o próximo resultado | `Enter` (ou teclas de seta para navegar) |
| Abrir resultado em uma nova aba | Clique na pré-visualização do trecho |

Cada resultado mostra o caminho do arquivo, o número da linha e um trecho com o texto correspondente destacado. As correspondências são ranqueadas por:

1. Relevância do nome do arquivo (arquivos que contêm o termo no nome aparecem primeiro)
2. Proximidade com cabeçalhos (correspondências dentro de cabeçalhos antes do corpo do texto)
3. Recência (arquivos modificados recentemente vêm antes)

**Excluídos por padrão**: `node_modules/`, `.git/`, `dist/`, `target/`, `coverage/`, além de quaisquer diretórios adicionados em **Pastas excluídas** nas Configurações de área de trabalho.

**Arquivos ocultos**: ignorados, a menos que **Mostrar arquivos ocultos** esteja habilitado no explorador de arquivos.

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

### Separando Abas em Novas Janelas

Você pode puxar uma aba para fora da janela para criar uma nova:

- **Arraste uma aba para baixo** além da barra de abas (cerca de 40 px) para separá-la em uma nova janela na posição do cursor
- **Arraste uma aba horizontalmente** dentro da barra de abas para reordená-la entre outras abas
- Abas fixadas não podem ser arrastadas

O gesto é bloqueado por direção: movimento horizontal inicia uma reordenação, enquanto movimento vertical aciona uma separação. Você pode mudar de reordenação para separação durante o arrasto movendo o ponteiro para fora da barra de abas.

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

O terminal integrado usa automaticamente a raiz da área de trabalho como seu diretório de trabalho. Quando você abre ou alterna áreas de trabalho, todas as sessões do terminal fazem `cd` para a nova raiz.

A variável de ambiente `VMARK_WORKSPACE` é definida como o caminho da área de trabalho em cada sessão do terminal, para que seus scripts possam referenciar a raiz do projeto.

[Saiba mais sobre o terminal →](/pt-BR/guide/terminal)

## Comando CLI Shell

O VMark pode instalar um comando shell `vmark` para que você possa abrir arquivos e pastas a partir do terminal.

### Instalação

Vá para **Ajuda > Instalar comando 'vmark'**. O VMark escreve um pequeno script lançador em `/usr/local/bin/vmark` e solicita sua senha de administrador (a mesma abordagem que o VS Code usa para seu comando `code`).

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

### Desinstalação

Vá para **Ajuda > Desinstalar comando 'vmark'** para remover `/usr/local/bin/vmark`. Se o arquivo nesse caminho não foi instalado pelo VMark, a operação é bloqueada e você é solicitado a removê-lo manualmente.
