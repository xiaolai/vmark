# Terminal Integrado

O VMark inclui um painel de terminal integrado para que você possa executar comandos sem sair do editor.

Pressione `` Ctrl + ` `` para mostrar ou ocultar o painel do terminal. Abri-lo coloca o cursor no shell, e fechá-lo devolve o cursor ao editor — assim o painel pode ser alcançado e deixado sem tocar no mouse.

Para alternar entre o editor e um terminal ABERTO sem ocultá-lo, pressione `` Ctrl + Shift + ` `` (**Focar o terminal ou o editor**; `` Alt + Shift + ` `` no Windows e no Linux). Ele alterna nas duas direções e nunca muda a visibilidade do painel — se o terminal estiver oculto, ele o abre em vez de não fazer nada.

## Sessões

O terminal suporta até 5 sessões concorrentes, cada uma com seu próprio processo de shell. Uma barra de abas vertical no lado direito mostra as abas de sessão numeradas.

| Ação | Como |
|------|------|
| Nova sessão | Clique no botão **+** |
| Alternar sessão | Clique em um número de aba |
| Fechar sessão | Clique no ícone de lixeira |
| Reiniciar shell | Clique no ícone de reiniciar |
| Renomear sessão | Clique duas vezes em uma aba, digite um nome e pressione `Enter` (`Escape` cancela) |
| Trocar o lado do painel | Clique no ícone de troca (↕ / ↔) para levar o terminal ao lado oposto do seu eixo atual. No modo **Automático**, isso mantém a alternância inteligente baseada na proporção (paisagem → lateral, retrato → inferior/superior) — apenas escolhe a outra extremidade. |
| Maximizar o painel | Clique duas vezes na alça de redimensionamento; clique duas vezes de novo para restaurar |

Quando você fecha a última sessão, o painel se oculta, mas a sessão permanece ativa — reabra com `` Ctrl + ` `` e você estará de volta onde parou. Quando o shell sai de forma limpa (`exit` ou `Ctrl + D`), sua aba fecha automaticamente — e o painel se oculta se era a última. Se o shell sair com um erro, a aba permanece aberta mostrando o código de saída; pressione qualquer tecla para reiniciá-lo.

Fechar uma sessão — pelo ícone de lixeira, fechando a janela dela ou saindo do VMark — encerra tudo o que foi iniciado nela, e não apenas o shell. O VMark envia um sinal de desligamento (`SIGHUP`) para todo o grupo de processos do shell, espera até um segundo para que ele termine e então força o encerramento (`SIGKILL`) do que tiver sobrado. Um processo que você separou de propósito em seu próprio grupo de processos (por exemplo, com `nohup` ou `setsid`) não é afetado. No Windows não há a etapa de desligamento: o shell é encerrado imediatamente.

**Notificações:** quando um terminal toca a campainha (por exemplo, o Claude Code concluindo um turno) enquanto aquela janela do VMark não está em foco, o VMark publica uma notificação do sistema com o nome do documento da janela — assim você pode rodar o Claude Code em várias janelas e ser avisado sobre a que precisa de você, sem vigiar cada uma. Ative ou desative em **Configurações → Terminal → Notificar quando sem foco** (ativado por padrão; pede permissão de notificação no primeiro uso). O mesmo sinal de campainha sem foco também marca a janela no [painel de status das janelas](/pt-BR/guide/workspace-management#painel-de-status-das-janelas), para que você veja qual janela precisa de você e vá direto até ela.

Cada aba reflete o título do programa em execução (definido por ferramentas que emitem um título de terminal, como `vim` ou `ssh`), a menos que você tenha renomeado a sessão manualmente — uma renomeação manual sempre prevalece. Para renomear, **clique duas vezes na aba**: `Enter` confirma, `Escape` descarta e clicar fora mantém o que você digitou. Um nome vazio é ignorado.

**Maximizando:** o tamanho do painel para em 80 % do espaço disponível para que o editor continue alcançável, e um **clique duplo na alça de redimensionamento** o leva direto a esse limite. Um segundo clique duplo o devolve ao tamanho salvo. É uma alternância de visualização — nunca muda o tamanho que você configurou.

**Abrir terminal aqui:** clique com o botão direito em qualquer pasta no explorador de arquivos e escolha **Abrir terminal aqui** para iniciar uma sessão nesse diretório. A nova sessão abre ali independentemente de onde estejam as suas outras sessões. Com cinco sessões, o item fica acinzentado.

## Sessões do terminal e a barra de espaços de trabalho

Com a [barra de espaços de trabalho](/pt-BR/guide/workspace-rail) ativada, cada área de trabalho da barra tem o seu **próprio conjunto** de sessões de terminal. Trocar de área de trabalho troca as abas de terminal visíveis — os shells da área de trabalho oculta ficam exatamente onde estavam: ativos, no mesmo diretório de trabalho, sem nada digitado neles. Voltar mostra os mesmos shells de novo, e a sessão que você estava vendo é lembrada por área de trabalho.

- Novas sessões pertencem à área de trabalho que estava ativa quando foram criadas e começam na raiz dessa área de trabalho.
- O limite de 5 sessões e a numeração `Terminal 1…5` se aplicam ao conjunto **visível** — as sessões de áreas de trabalho ocultas não consomem a margem da área de trabalho ativa.
- Abrir o painel sobre uma área de trabalho sem sessões cria uma automaticamente; sem área de trabalho (ou um arquivo salvo que sirva de âncora para um diretório), o painel mostra uma dica.
- Fechar uma área de trabalho pela barra, ou movê-la para a sua própria janela, fecha as sessões de terminal dela junto.
- Com a barra **desativada**, tudo funciona como antes: um único conjunto de sessões para a janela inteira, cujos shells ociosos acompanham as trocas de área de trabalho com um `cd`.

## Atalhos de Teclado

Estes atalhos funcionam quando o painel do terminal está em foco:

| Ação | Atalho |
|------|--------|
| Copiar | `Mod + C` (com seleção) |
| Colar | `Mod + V` |
| Limpar | `Mod + K` |
| Pesquisar | `Mod + F` |
| Início / fim da linha | `Cmd + ←` / `Cmd + →` (macOS) |
| Excluir linha | `Cmd + ⌫` (macOS) |
| Zoom da fonte do terminal | `Mod + =` / `Mod + -` / `Mod + 0` |
| Selecionar toda a saída do terminal | `Mod + A` |
| Ir para a sessão 1 … 5 | `Mod + 1` … `Mod + 5` |
| Alternar Terminal | `` Ctrl + ` `` |
| Focar o terminal ou o editor | `` Ctrl + Shift + ` `` |
| Prompt de comando anterior | `Mod + ↑` |
| Próximo prompt de comando | `Mod + ↓` |

Quando o terminal está em foco, `Mod + =` / `-` / `0` ajustam o zoom da fonte do **terminal** (definida separadamente nas configurações do Terminal), não a fonte do editor, e `Mod + F` abre a pesquisa do **terminal** em vez da barra de localização do editor.

A navegação entre prompts (`Mod + ↑` / `Mod + ↓`) requer a integração com o shell — veja [Integração com o shell](#integracao-com-o-shell) abaixo.

**Linux:** `Ctrl` + uma letra vai para o shell, então teclas do readline como `Ctrl + A`, `Ctrl + E`, `Ctrl + K`, `Ctrl + F`, `Ctrl + U` e `Ctrl + W` funcionam como em qualquer terminal Linux. Os atalhos de letra do próprio terminal passam para `Ctrl + Shift`: `Ctrl + Shift + F` pesquisa, `Ctrl + Shift + K` limpa, `Ctrl + Shift + A` seleciona tudo, e `Ctrl + Shift + C` / `Ctrl + Shift + V` copiam e colam. `Ctrl + C` continua copiando uma seleção (sem seleção, envia SIGINT) e `Ctrl + V` continua colando; `Ctrl + Insert` / `Shift + Insert` também copiam e colam.

**Acentos ao manter a tecla pressionada (macOS).** Manter uma tecla de letra pressionada abre o seletor de acentos do macOS. A essa altura a letra simples já foi enviada ao shell, então, quando você escolhe um acento, o VMark envia um backspace (DEL) seguido do caractere acentuado. Em um programa que não trata DEL como apagar o caractere anterior, a letra original pode continuar aparecendo.

::: tip
`Mod + C` sem uma seleção de texto envia SIGINT ao processo em execução — o mesmo que pressionar Ctrl+C em um terminal regular.
:::

## Ler o histórico enquanto digita

Role para cima para ler a saída anterior e continue digitando: a visualização fica onde você está e um **prompt flutuante** aparece na parte de baixo do terminal com uma cópia ao vivo das linhas em que você digita — o prompt do shell ou a caixa de entrada de uma TUI como o Claude Code. As teclas continuam indo para o shell, então autocompletar com Tab, histórico e métodos de entrada funcionam normalmente. Clique na seta na extremidade direita para voltar ao prompt; ele some sozinho quando o prompt volta a ficar visível. Pressionar Enter ou Ctrl+C também volta para baixo, para você ver o que o comando — ou o prompt enviado a uma TUI — faz em seguida; qualquer outra tecla, inclusive Shift+Enter, deixa a visualização onde está. Programas em tela cheia (vim, less) não têm histórico, então ele nunca aparece neles.

## Pesquisa

Pressione `Mod + F` para abrir a barra de pesquisa. Digite para pesquisar incrementalmente pelo buffer do terminal.

| Ação | Atalho |
|------|--------|
| Próxima correspondência | `Enter` |
| Correspondência anterior | `Shift + Enter` |
| Fechar pesquisa | `Escape` |

A barra informa o que encontrou ao lado do campo de entrada:

- **`3 / 17`** — você está na terceira de dezessete correspondências.
- **`5000 correspondências`** — correspondências demais para o terminal acompanhar
  qual está ativa, então ele informa o total sem uma posição.
- **Nenhum resultado** — a consulta não encontrou nada; o texto do campo também
  fica vermelho.

Três alternâncias ficam entre o campo e as setas:

| Alternância | Efeito |
|-------------|--------|
| **Aa** | Diferenciar maiúsculas de minúsculas |
| **ab** | Somente palavras inteiras |
| **.\*** | Tratar a consulta como uma expressão regular |

Com o modo regex ativado, um padrão digitado pela metade (`[` a caminho de
`[a-z]`) simplesmente informa nenhum resultado em vez de dar erro — continue
digitando. As alternâncias são redefinidas sempre que você fecha a barra ou troca
de sessão.

## Menu de Contexto

Clique com o botão direito dentro do terminal para acessar:

- **Copiar** — copiar texto selecionado (desabilitado quando nada está selecionado)
- **Copiar sem quebras de linha** — copia a seleção removendo as quebras de linha feitas pela largura de exibição. Alguns programas de linha de comando (codex e outros aplicativos TUI) quebram a saída na largura do terminal inserindo quebras de linha reais; uma cópia normal preserva essas quebras. "Copiar sem quebras de linha" junta as linhas quebradas de volta em parágrafos contínuos (linhas em branco são mantidas como quebras de parágrafo). Reconhece CJK — texto em chinês/japonês é unido sem inserir espaços. Selecione o bloco que você sabe ser um único fluxo lógico, já que o VMark não consegue distinguir uma quebra de linha de ajuste de uma intencional.
- **Colar** — colar da área de transferência no shell
- **Selecionar tudo** — selecionar todo o buffer do terminal
- **Limpar** — limpar a saída visível
- **Redefinir exibição** — repinta o terminal e reinicia seu cache de renderização. Use isso se os caracteres começarem a se sobrepor, misturar caixa, ou aparecer truncados após uma sessão longa — o que costuma acontecer ao rodar CLIs com muito estilo (ex.: Claude Code) por horas. Os terminais de uma mesma janela compartilham um único cache de glifos, então isso repinta todos os terminais da janela, e não apenas a aba ativa.
- **Copiar saída do comando** — copia tudo o que um comando imprimiu, sem a linha do prompt e sem a saída do comando seguinte. Aparece apenas quando você clica com o botão direito dentro da saída de um comando e a [integração com o shell](#integracao-com-o-shell) está ativada, já que é ela que diz ao VMark onde cada comando começou e terminou.

O menu é totalmente navegável pelo teclado: ele abre com a primeira ação disponível em foco, as setas movem entre os itens (pulando os desabilitados), Home/End vão para o primeiro/último, Enter ou Espaço ativam, e Escape ou Tab o fecham.

## Executando um bloco de código

Passe o mouse sobre qualquer bloco `bash`, `sh`, `zsh` ou `shell` — ou um bloco
de transcrição marcado como `console`, `shell-session`, `shellsession` ou
`terminal` — no seu documento e um botão **▶ Executar no terminal** aparece ao
lado do botão de copiar. Ele cola o bloco no terminal — mostrando o painel e
iniciando uma sessão, se necessário — e para por aí.

::: warning Ele cola; não executa
O comando é colocado na linha de entrada do shell e **nunca é executado por
você**: nenhuma quebra de linha é acrescentada, então nada acontece até que
*você* pressione Enter. Leia primeiro o que foi colado — um documento pode vir de
qualquer lugar, e um bloco de código é apenas texto que alguém escreveu.
:::

Em um bloco de transcrição (`console`, `shell-session`, `shellsession`,
`terminal`) — uma sessão colada — os prompts iniciais `$ `, `% ` e `# ` são
removidos, para que você receba o comando e não o prompt. Em um bloco `bash`
eles são mantidos, já que ali fazem parte do código-fonte.

## Links Clicáveis

O terminal detecta três tipos de links na saída dos comandos:

- **URLs Web** — clique para abrir no navegador padrão
- **Hiperlinks OSC 8** — hiperlinks de terminal explícitos emitidos por ferramentas como `ls --hyperlink=auto`, `gh` e compiladores modernos. O texto visível e a URL subjacente podem ser diferentes; clicar abre a URL.
- **Caminhos de arquivo** — um caminho que contém uma `/` e termina em uma extensão de arquivo; clique para abrir o arquivo no editor (suporta sufixos `:linha:coluna`; um caminho relativo é resolvido em relação ao diretório atual do shell quando a [integração com o shell](#integracao-com-o-shell) o informa e, caso contrário, em relação à raiz da área de trabalho)

## Ambiente do Shell

O VMark define estas variáveis de ambiente em cada sessão do terminal:

| Variável | Valor |
|----------|-------|
| `TERM` | `xterm-256color` |
| `TERM_PROGRAM` | `WezTerm` |
| `TERM_PROGRAM_VERSION` | `20240203-110809-5046fc22` |
| `VMARK_WORKSPACE` | Caminho raiz da área de trabalho (quando uma pasta está aberta) |
| `PATH` | PATH completo do shell de login (igual ao seu terminal do sistema) |
| `COLORTERM` | `truecolor` |
| `LC_CTYPE` | `UTF-8` — **somente macOS** |

`TERM_PROGRAM` informa `WezTerm`, e não `vmark`, e isso é proposital. Várias
ferramentas de linha de comando — entre elas o `/terminal-setup` do Claude Code —
só ativam a codificação de teclas
[CSI u](https://invisible-island.net/xterm/modified-keys.html) para terminais de
uma lista fixa de permitidos, e recorrem a um caminho degradado de "terminal
desconhecido" para todos os outros. O VMark fala esse protocolo, então ele se
identifica como o terminal permitido cujo comportamento mais se aproxima do seu.
Mudar esse valor para `vmark` quebraria silenciosamente Shift+Enter e outras
sequências de teclas modificadas nessas ferramentas. Veja
[ADR-006](https://github.com/xiaolai/vmark/blob/main/dev-docs/decisions/ADR-006-terminal-program-identity.md).

`LC_CTYPE=UTF-8` é definido **somente no macOS**. Um aplicativo gráfico iniciado
pelo Dock ou pelo Spotlight herda quase nenhum ambiente ali, então sem isso o
shell recorre à localidade C e as ferramentas imprimem `?` para texto CJK. O nome
simples `UTF-8` é uma localidade no macOS e *não* é no Linux, então defini-lo lá
substituiria uma localidade herdada perfeitamente válida por uma inválida — todo
programa que chama `setlocale()` reclamaria. No Linux e no Windows, os `LANG` /
`LC_*` da sua própria sessão de desktop são herdados sem alteração.

O VMark propositalmente **não** define `EDITOR`. O seu próprio `$EDITOR` — o que
quer que a configuração do seu shell exporte — é o que `git commit`,
`crontab -e` e similares vão abrir. (O VMark costumava forçar `EDITOR=vmark`,
mas o atalho de linha de comando `vmark` é opcional e retorna imediatamente em
vez de esperar você fechar a aba, então o `git commit` falhava com "command not
found" ou com uma mensagem de commit vazia. Fazer isso funcionar exige um
protocolo bloqueante `vmark --wait`, que ainda não foi construído.)

O terminal integrado herda o `PATH` do shell de login, portanto ferramentas CLI como `node`, `claude` e outros binários instalados pelo usuário são detectáveis — assim como seriam em uma janela de terminal regular.

A menos que você escolha um shell nas configurações do terminal, o VMark inicia o seu shell de login. Um shell que você escolher precisa ser um dos que o VMark oferece — no macOS e no Linux, um shell listado em `/etc/shells` (ou o seu shell de login) que exista e seja executável; no Windows, PowerShell, `pwsh`, `cmd.exe` ou `%COMSPEC%` — informado como caminho absoluto. Uma escolha salva que não está mais disponível aparece como *(indisponível)* nas configurações, e o VMark inicia o seu shell padrão no lugar. No macOS e no Linux, ele lê primeiro o shell de login do registro da sua conta de usuário, depois `$SHELL`, e usa `/bin/sh` como fallback. No Windows, ele usa `%COMSPEC%`, com o caminho completo de `cmd.exe` como fallback. O diretório de trabalho começa na raiz da área de trabalho, ou no diretório pai do arquivo ativo, ou em `$HOME`.

Os atalhos padrão do shell como `Ctrl+R` (pesquisa de histórico reverso no zsh/bash) funcionam quando o terminal está em foco — eles não são interceptados pelo editor.

Quando a raiz da área de trabalho muda enquanto o terminal já está em execução, as sessões ociosas fazem automaticamente `cd` para a nova raiz. Uma sessão ocupada com um comando (por exemplo, `vim` ou `less`) não é interrompida: ela muda de diretório quando o comando termina, o que requer a [integração com o shell](#integracao-com-o-shell) para ser detectado. Com a [barra de espaços de trabalho](/pt-BR/guide/workspace-rail) ativada, as sessões que pertencem a uma área de trabalho mantêm seu próprio diretório. Sem a integração com o shell — no Windows, com fish ou quando a configuração está desligada — o VMark não consegue saber se uma sessão está ocupada, então o `cd` é digitado no que estiver rodando em primeiro plano.

## Ferramentas CLI de IA e o próprio acesso ao navegador

Uma ferramenta CLI de IA como Claude Code ou Codex CLI é executada como um programa comum no terminal. O VMark oferece três coisas distintas a ela, e separá-las torna muito mais fácil diagnosticar uma configuração quebrada:

| O quê | Quem fornece | O que permite à CLI |
|---|---|---|
| O terminal | VMark | Executar comandos com o seu shell de login e o seu `PATH`, como em qualquer janela de terminal |
| VMark MCP | VMark, depois que você instalar a configuração dele em **Configurações → Integrações** | Ler e gravar o documento aberto no VMark por meio das próprias ferramentas MCP do VMark |
| Ferramentas de navegador | O cliente de IA, não o VMark | Acessar um navegador pela integração própria do cliente, como uma extensão do Chrome ou um servidor de automação de navegador |

O VMark não configura, não intermedeia nem garante as ferramentas de navegador. Uma conexão de navegador é verificada lendo o título real de uma página na sessão: um código de saída zero e um nome de ferramenta no catálogo não provam nenhum dos dois. Instalação da extensão, conectividade do aplicativo de desktop, descoberta de ferramentas e acesso efetivo à página são quatro verificações separadas.

Os limites de reinicialização importam. Um processo CLI recém-iniciado pode continuar conversando com um servidor de aplicativo compartilhado em segundo plano iniciado antes, então as versões do cliente e do servidor podem diferir; anote as duas ao solucionar problemas. O terminal do VMark não reinicia nem isola esses processos para você.

Não habilite a depuração remota, não copie substituições de confiança nem afrouxe as verificações da ponte nativa para fazer uma conexão de navegador funcionar. Isso amplia o modelo de permissões para todas as páginas que o navegador alcança, e um resultado obtido assim não é uma receita de configuração.

## Microfone, câmera e Apple Events no macOS

Os programas que você executa no terminal integrado podem solicitar o microfone, a câmera ou permissão para controlar outros apps (Apple Events, usados pelo `osascript`). O macOS pergunta em nome do VMark, porque considera o VMark o app responsável por tudo o que o terminal inicia. Permita o acesso quando o macOS perguntar; você pode alterá-lo depois em **Ajustes do Sistema → Privacidade e Segurança**, em **Microfone**, **Câmera** ou **Automação**. A solicitação acontece quando um programa usa o recurso pela primeira vez, não ao abrir o terminal.

Se um programa gravar silêncio, capturar uma imagem preta ou relatar um erro de "não autorizado" sem que apareça nenhuma solicitação, verifique na página de ajustes correspondente se o VMark está listado e permitido. Ao relatar o problema, inclua a saída do programa.

Para entradas de áudio virtuais como o BlackHole, a permissão por si só não roteia o áudio. Selecione a entrada desejada na sua ferramenta de gravação, roteie o áudio para ela e verifique uma gravação curta antes de uma sessão longa: um arquivo de áudio crescendo não prova, por si só, que o som foi capturado. O VMark não inclui gravador nem transcritor; esses comandos vêm de ferramentas que você instala separadamente.

## Ainda não implementado

Estes itens estão planejados, mas **não** estão disponíveis hoje. Eles aparecem
aqui porque versões anteriores desta página descreviam alguns deles como se
existissem:

- **Pausar / Retomar uma sessão.** O VMark consegue suspender internamente um
  processo de shell — ele faz isso automaticamente como controle de fluxo quando
  a saída chega mais rápido do que o terminal consegue renderizá-la —, mas não há
  um controle para o usuário, nem um menu de contexto na aba da sessão onde
  colocá-lo.
- **Um `vmark --wait` bloqueante**, para que `$EDITOR` possa apontar para o VMark
  (veja [Ambiente do Shell](#ambiente-do-shell) acima).
- **Persistência do histórico de rolagem entre reinicializações** (veja
  [Persistência](#persistencia)).
- **Integração com o shell fish** (veja
  [Integração com o shell](#integracao-com-o-shell)).

## Configurações

Abra **Configurações → Terminal** para configurar:

| Configuração | Intervalo | Padrão | Plataformas |
|--------------|-----------|--------|-------------|
| Tamanho do painel | 10 % – 80 % do espaço disponível, em passos de 5 % | 40 % | Todas |
| Tamanho da fonte | 10 – 24 px | 13 px | Todas |
| Altura da linha | 1.0 – 2.0 | 1.2 | Todas |
| Copiar ao selecionar | Ligado / Desligado | Desligado | Todas |
| Renderizar transcrições automaticamente | Ligado / Desligado | Desligado | Todas |
| Option como tecla Meta | Ligado / Desligado | Ligado | macOS |
| Integração com o shell | Ligado / Desligado | Ligado | macOS / Linux (zsh, bash) |
| Área de transferência remota (OSC 52) | Ligado / Desligado | Ligado | Todas |
| Histórico de rolagem | 1.000 / 5.000 / 10.000 / 50.000 linhas | 5.000 | Todas |
| Modo leitor de tela | Ligado / Desligado | Desligado | Todas |

### Renderizar transcrições automaticamente

Ative **Renderizar transcrições automaticamente** para exibir o Markdown do assistente, tabelas selecionáveis e diagramas Mermaid em uma seção de transcrição formatada dentro da área do terminal. Ela fica à direita da CLI quando o terminal está no topo ou na parte inferior, e abaixo dela quando o terminal está à esquerda ou à direita; a CLI interativa continua utilizável ao lado.

A seção começa recolhida. Ela se abre sozinha quando uma nova resposta contém uma tabela ou um diagrama Mermaid — respostas em texto simples, que o terminal já exibe bem, a mantêm fechada. Clique no botão de gráfico na barra de abas do terminal (dica **Transcrição formatada**) para mostrá-la ou ocultá-la a qualquer momento; o botão fica destacado enquanto a transcrição está visível, e ocultá-la devolve toda a área à CLI; depois que você a recolhe, ela permanece fechada até a próxima resposta com uma tabela ou um diagrama. O conteúdo que já está na transcrição quando a sessão é exibida pela primeira vez não a abre. Um terminal oculto para de ler transcrições.

Ao ativar, um hook `SessionStart` local é adicionado ao `settings.json` do Claude Code e ao `hooks.json` do Codex, preservando os hooks existentes. Depois de ativar, inicie ou retome o Claude/Codex em um terminal do VMark; reinicie as sessões que já estão em execução. O Codex pode pedir que você confie no novo hook na primeira execução. São necessários o Node e uma versão da CLI com hooks de ciclo de vida. Hooks explicitamente desativados ou restringidos por política, sessões SSH remotas e diretórios de configuração personalizados da CLI que diferem do ambiente do VMark não conseguem fornecer um vínculo.

Cada terminal acompanha exatamente a sua sessão, em vez da transcrição modificada mais recentemente. A pré-visualização mantém até 100 mensagens do assistente dos últimos 2 MiB de dados da transcrição. HTML bruto e imagens remotas permanecem inertes; diagramas inválidos continuam legíveis como código-fonte. Ao desativar, a seção formatada é removida e os hooks do VMark são desligados: as entradas do hook SessionStart continuam no `settings.json` do Claude Code e no `hooks.json` do Codex (o VMark não reescreve a configuração da sua CLI para removê-las), mas o script do hook sai imediatamente enquanto a configuração estiver desligada, e o VMark esquece todos os vínculos de transcrição existentes. Cada novo shell continua recebendo a variável `VMARK_TRANSCRIPT_TOKEN`, então religar a configuração funciona para sessões que já estão abertas.

### Acessibilidade

| Configuração | Opções | Padrão |
|--------------|--------|--------|
| Campainha do terminal | Desligada / Visual / Sonora | Visual |
| Contraste mínimo | Desligado / WCAG AA (4,5:1) / WCAG AAA (7:1) / Máximo | WCAG AA (4,5:1) |

A maioria das alterações se aplica imediatamente a todas as sessões abertas — tamanho e posição do painel, tamanho da fonte, altura da linha, cursor, Copiar ao selecionar, Option como tecla Meta, Histórico de rolagem, Modo leitor de tela, Campainha do terminal e Contraste mínimo. **Shell**, o **Renderizador WebGL** (indisponível no Linux), a **Área de transferência remota** e a **Integração com o shell** são definidos quando uma sessão começa, então valem para as sessões abertas depois da alteração. **Tamanho do painel** vai até 80 % do espaço disponível. O editor mantém um tamanho mínimo em pixels, então ele nunca desaparece por completo, por maior que o terminal fique. Clique duas vezes na alça de redimensionamento para ir direto ao máximo e voltar, sem alterar o tamanho salvo. **Option como tecla Meta** roteia a tecla Option do macOS como Meta no terminal integrado para que emacs, tmux e ferramentas similares enxerguem atalhos prefixados com Alt (somente macOS); vem ativada por padrão, então Option+Seta move por palavras em vez de inserir caracteres acentuados. **Integração com o shell** está disponível no macOS e no Linux (oculta no Windows). **Área de transferência remota** é somente de escrita (leituras são sempre recusadas) e está descrita abaixo. **Histórico de rolagem** controla quantas linhas de saída cada sessão mantém no histórico de rolagem — valores maiores usam mais memória. **Modo leitor de tela** expõe a saída do terminal a tecnologias assistivas como o VoiceOver; vem desativado por padrão por questões de desempenho. **Campainha do terminal** escolhe como uma campainha (BEL) é sinalizada — uma marca visual de atividade em segundo plano na aba da sessão, um bipe sonoro suave (que também marca a aba de uma sessão em segundo plano para que você a encontre) ou nada. **Contraste mínimo** eleva texto tênue do terminal a uma razão de contraste legível em relação ao fundo; aumente-o para acessibilidade ou escolha Desligado para desativar a elevação.

::: tip Família de fonte do terminal
O terminal usa a **Fonte mono** de **Configurações → Editor**, e não uma
fonte própria, então alterá-la ali muda o estilo dos blocos de código, do modo
Fonte e do terminal ao mesmo tempo. No Linux, a opção Padrão do sistema segue a
fonte monoespaçada do seu próprio desktop, que é a que o seu terminal do sistema
usa.
:::

::: tip Tamanho da fonte e zoom
O tamanho da fonte do terminal é propositalmente independente do tamanho de
leitura do editor: um terminal é uma superfície densa de monitoramento, e o seu
padrão de 13 px corresponde ao que os terminais independentes usam, e não ao
padrão de leitura de 18 px. `Mod + =` / `Mod + -` ajustam o zoom em passos de
2 px, então a fonte do terminal pode parar em um valor que a lista não mostra
(13 → 15 → 17 …). A lista mostra o tamanho que está de fato em uso,
acrescentando o valor ampliado à lista em vez de levar você de volta a um valor
predefinido.
:::

## Área de transferência remota (OSC 52)

Copie dentro de uma sessão `ssh`, dentro do `tmux` ou em um editor remoto, e o
texto vai para a **sua** área de transferência — não para a da máquina remota. Os
programas pedem isso imprimindo uma sequência de escape OSC 52; o VMark a
encaminha para a área de transferência do sistema.

```bash
# De qualquer lugar onde o terminal possa imprimir — inclusive via ssh:
printf '\e]52;c;%s\a' "$(printf 'hello' | base64)"
```

::: warning Somente escrita — leituras são sempre recusadas
O OSC 52 também define uma forma de *ler* a área de transferência, e o VMark
**nunca** responde a ela, mesmo com esta configuração ativada. Qualquer processo
capaz de imprimir bytes no seu terminal poderia perguntar — inclusive um `cat`
de um arquivo que você não escreveu — e a resposta chegaria como se você a
tivesse digitado. O iTerm2 e o VS Code recusam pelo mesmo motivo. A configuração
controla as escritas; as leituras são recusadas incondicionalmente.
:::

Desative **Configurações → Terminal → Área de transferência remota** para fechar
o canal por completo. A alteração vale para as sessões criadas depois.

## Integração com o shell

Quando a **Integração com o shell** está ativada, o VMark injeta marcadores de
comando leves no shell para que o terminal entenda onde cada comando começa e
termina. Ela habilita:

- **Navegação entre prompts** — `Cmd + ↑` / `Cmd + ↓` vai para o prompt de
  comando anterior / seguinte no histórico de rolagem.
- **Indicadores de status de saída** — uma barra fina na margem marca cada linha
  de comando em verde (sucesso) ou vermelho (falha).
- **Rastreamento do diretório de trabalho ao vivo** — caminhos de arquivo
  relativos na saída são resolvidos em relação ao diretório atual do shell, e
  novos terminais abrem ali.

**zsh** e **bash** são suportados, no macOS e no Linux. Nos dois casos a injeção
não é destrutiva — a sua configuração real é carregada primeiro, e os hooks do
VMark são acrescentados em vez de substituídos, então seu prompt, tema e aliases
ficam intactos.

| Shell | Como o VMark se conecta | O que ele preserva |
|---|---|---|
| zsh | `ZDOTDIR` aponta para um `.zshrc` gerado que carrega o seu e depois registra hooks com `add-zsh-hook` | Um `$ZDOTDIR` personalizado é respeitado: o VMark descobre o seu verdadeiro a partir de um shell de login e carrega `.zshenv` e `.zshrc` de lá, não apenas de `$HOME` |
| bash | `bash --rcfile <generated>`, que carrega `~/.bashrc` primeiro | Um `PROMPT_COMMAND` e uma trap `DEBUG` existentes são **combinados**, não substituídos — então `bash-preexec`, `direnv` e `atuin` continuam funcionando |

Como o terminal executa um shell interativo sem login, arquivos exclusivos de
login (`.zprofile`, `.bash_profile`, `.profile`) ficam fora do escopo nos dois
shells, igual ao comportamento de uma aba de terminal comum.

O fish ainda não é integrado; ele roda normalmente sem esses recursos. Desative a
configuração para desligar a injeção por completo. As alterações valem para as
sessões criadas depois (reinicie o terminal para aplicar).

## Persistência

O estado aberto ou fechado do painel do terminal é salvo e restaurado nas reinicializações de saída a quente. Seu tamanho é a configuração **Tamanho do painel** — uma fração da janela, atualizada quando você arrasta a alça de redimensionamento —, então ele é guardado com suas configurações e sobrevive a toda reinicialização, seja qual for o lado em que o painel está. Os processos de shell em si não podem ser preservados — um novo shell é criado para cada sessão ao reiniciar. O histórico de rolagem também não é preservado: restaurá-lo significaria gravar em disco tudo o que passou pelo seu terminal (chaves de API incluídas), então isso fica propositalmente para um projeto que resolva essa questão primeiro.
