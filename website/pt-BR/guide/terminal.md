# Terminal Integrado

O VMark inclui um painel de terminal integrado para que você possa executar comandos sem sair do editor.

Pressione `` Ctrl + ` `` para alternar o painel do terminal.

## Sessões

O terminal suporta até 5 sessões concorrentes, cada uma com seu próprio processo de shell. Uma barra de abas vertical no lado direito mostra as abas de sessão numeradas.

| Ação | Como |
|------|------|
| Nova sessão | Clique no botão **+** |
| Alternar sessão | Clique em um número de aba |
| Fechar sessão | Clique no ícone de lixeira |
| Reiniciar shell | Clique no ícone de reiniciar |

Quando você fecha a última sessão, o painel se oculta, mas a sessão permanece ativa — reabra com `` Ctrl + ` `` e você estará de volta onde parou. Se um processo de shell sair, pressione qualquer tecla para reiniciá-lo.

## Atalhos de Teclado

Estes atalhos funcionam quando o painel do terminal está em foco:

| Ação | Atalho |
|------|--------|
| Copiar | `Mod + C` (com seleção) |
| Colar | `Mod + V` |
| Limpar | `Mod + K` |
| Pesquisar | `Mod + F` |
| Alternar Terminal | `` Ctrl + ` `` |

::: tip
`Mod + C` sem uma seleção de texto envia SIGINT ao processo em execução — o mesmo que pressionar Ctrl+C em um terminal regular.
:::

## Pesquisa

Pressione `Mod + F` para abrir a barra de pesquisa. Digite para pesquisar incrementalmente pelo buffer do terminal.

| Ação | Atalho |
|------|--------|
| Próxima correspondência | `Enter` |
| Correspondência anterior | `Shift + Enter` |
| Fechar pesquisa | `Escape` |

## Menu de Contexto

Clique com o botão direito dentro do terminal para acessar:

- **Copiar** — copiar texto selecionado (desabilitado quando nada está selecionado)
- **Colar** — colar da área de transferência no shell
- **Selecionar Tudo** — selecionar todo o buffer do terminal
- **Limpar** — limpar a saída visível
- **Redefinir exibição** — repinta o terminal e reinicia seu cache de renderização. Use isso se os caracteres começarem a se sobrepor, misturar caixa, ou aparecer truncados após uma sessão longa — o que costuma acontecer ao rodar CLIs com muito estilo (ex.: Claude Code) por horas.

## Links Clicáveis

O terminal detecta dois tipos de links na saída dos comandos:

- **URLs Web** — clique para abrir no navegador padrão
- **Caminhos de arquivo** — clique para abrir o arquivo no editor (suporta sufixos `:linha:coluna` e caminhos relativos resolvidos em relação à raiz da área de trabalho)

## Ambiente do Shell

O VMark define estas variáveis de ambiente em cada sessão do terminal:

| Variável | Valor |
|----------|-------|
| `TERM_PROGRAM` | `vmark` |
| `EDITOR` | `vmark` |
| `VMARK_WORKSPACE` | Caminho raiz da área de trabalho (quando uma pasta está aberta) |
| `PATH` | PATH completo do shell de login (igual ao seu terminal do sistema) |

O terminal integrado herda o `PATH` do shell de login, portanto ferramentas CLI como `node`, `claude` e outros binários instalados pelo usuário são detectáveis — assim como seriam em uma janela de terminal regular.

O shell é lido de `$SHELL` (usa `/bin/sh` como fallback). O diretório de trabalho começa na raiz da área de trabalho, ou no diretório pai do arquivo ativo, ou em `$HOME`.

Os atalhos padrão do shell como `Ctrl+R` (pesquisa de histórico reverso no zsh/bash) funcionam quando o terminal está em foco — eles não são interceptados pelo editor.

Quando você abre uma área de trabalho ou arquivo enquanto o terminal já está em execução, todas as sessões fazem automaticamente `cd` para a nova raiz da área de trabalho.

## Pausar / Retomar

Para processos de longa duração que produzem muita saída, é possível suspender o processo de shell subjacente a partir do VMark para liberar CPU sem encerrar a sessão. Ao retomar, o processo continua de onde parou.

| Ação | Como |
|------|------|
| Pausar a sessão ativa | Clique com o botão direito na aba da sessão → **Pausar** |
| Retomar a sessão pausada | Clique com o botão direito na aba pausada → **Retomar** |

Enquanto pausada:

- A aba da sessão exibe um indicador esmaecido
- O shell recebe `SIGSTOP` (POSIX); o sistema operacional suspende o agendamento do processo
- A saída em buffer já escrita no terminal permanece na tela, mas nenhuma saída nova aparece até você retomar
- Os controles de matar / limpar / reiniciar continuam disponíveis

Pausar/Retomar é um recurso exclusivo de macOS/Linux — o controle de processos do Windows não expõe um sinal de suspensão equivalente, então os itens de menu ficam ocultos nas builds para Windows.

## Configurações

Abra **Configurações → Terminal** para configurar:

| Configuração | Intervalo | Padrão | Plataformas |
|--------------|-----------|--------|-------------|
| Tamanho da Fonte | 10 – 24 px | 13 px | Todas |
| Altura de Linha | 1.0 – 2.0 | 1.2 | Todas |
| Copiar ao Selecionar | Ligado / Desligado | Desligado | Todas |
| Tecla Option do Mac como Meta | Ligado / Desligado | Desligado | macOS |

As alterações se aplicam imediatamente a todas as sessões abertas. **Tecla Option do Mac como Meta** roteia a tecla Option do macOS como Meta no terminal integrado para que emacs, tmux e ferramentas similares enxerguem atalhos prefixados com Alt.

## Persistência

A visibilidade do painel do terminal e a altura são salvas e restauradas nas reinicializações de saída a quente. Os processos de shell em si não podem ser preservados — um novo shell é criado para cada sessão ao reiniciar, e qualquer sessão pausada perde seu estado de `SIGSTOP` junto com o próprio processo.
