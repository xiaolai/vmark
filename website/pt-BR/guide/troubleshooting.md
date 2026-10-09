# Solução de problemas

## Consulta rápida

Problemas comuns e onde encontrar a correção:

| Sintoma | Causa provável | Onde procurar |
|---------|----------------|---------------|
| Cliente MCP não consegue conectar | Arquivo de porta antigo ou VMark não está em execução | [Problemas de conexão do servidor MCP](#problemas-de-conexao-do-servidor-mcp) |
| Arquivo não abre ou mostra texto truncado | Codificação não-UTF-8 ou atributo de quarentena | [O arquivo não abre](#o-arquivo-nao-abre) |
| Gênio de IA trava ou não retorna nada | Provedor mal configurado ou CLI fora do PATH | [O Gênio de IA não responde](#o-genio-de-ia-nao-responde) |
| Atalho de teclado não faz nada | Reatribuído nas Configurações ou sobrescrito pelo sistema | [O atalho de teclado não funciona](#o-atalho-de-teclado-nao-funciona) |
| Editor lento em arquivos grandes | Memória por aba + atraso em entradas com mais de 10 mil linhas | [Desempenho do editor](#desempenho-do-editor) |
| Menu continua em inglês após mudar o idioma | O menu é reconstruído na inicialização | [A barra de menus mostra inglês após a troca de idioma](#a-barra-de-menus-mostra-ingles-apos-a-troca-de-idioma) |
| Exportação de PDF incompleta | Caminhos de imagens ou permissões de gravação | [Problemas de exportação/impressão](#problemas-de-exportacao-impressao) |
| Inicialização lenta no Windows | WebView2 + varredura de antivírus | [O aplicativo inicia lentamente no Windows](#o-aplicativo-inicia-lentamente-no-windows) |
| `Cmd + R` / `Ctrl + R` não faz nada | O recarregamento é bloqueado de propósito | [O recarregamento está bloqueado](#o-recarregamento-esta-bloqueado) |
| Dar duplo clique em um arquivo o abriu no VMark já em execução | Encaminhamento para uma única instância no Windows e no Linux | [Um VMark por vez no Windows e no Linux](#um-vmark-por-vez-no-windows-e-no-linux) |
| Janela em branco no Linux | Renderizador DMABUF do WebKitGTK | [Janela em branco no Linux](#janela-em-branco-no-linux) |
| Aspas retas e `--` permanecem literais no macOS | As substituições inteligentes do sistema ficam desativadas para o VMark | [Aspas e travessões inteligentes no macOS](#aspas-e-travessoes-inteligentes-no-macos) |
| O VMark nunca "cochila" no Monitor de Atividade | O App Nap é desativado para que os assistentes de IA continuem funcionando | [O VMark permanece ativo em segundo plano (App Nap)](#o-vmark-permanece-ativo-em-segundo-plano-app-nap) |
| Uma caixa de diálogo de pastas abre para um espaço de trabalho recente, ou um erro menciona `forbidden path` | A pasta está fora do que o VMark pode ler | [Acesso a pastas e erros `forbidden path`](#acesso-a-pastas-e-erros-forbidden-path) |

Para qualquer coisa não listada acima, veja [Reportar bugs](#reportar-bugs).

## Arquivos de log

O VMark grava arquivos de log para ajudar a diagnosticar problemas. Os logs incluem avisos e erros tanto do backend Rust quanto do frontend.

### Localização dos arquivos de log

| Plataforma | Caminho |
|------------|---------|
| macOS | `~/Library/Logs/app.vmark/` |
| Windows | `%LOCALAPPDATA%\app.vmark\logs\` |
| Linux | `~/.local/share/app.vmark/logs/` |

### Níveis de log

| Nível | O que é registrado | Produção | Desenvolvimento |
|-------|-------------------|----------|-----------------|
| Error | Falhas, travamentos | Sim | Sim |
| Warn | Problemas recuperáveis, alternativas | Sim | Sim |
| Info | Marcos, mudanças de estado | Sim | Sim |
| Debug | Rastreamento detalhado | Não | Sim |

### Rotação de logs

- Tamanho máximo do arquivo: 5 MB
- Rotação: mantém um arquivo de log anterior
- Logs antigos são substituídos automaticamente

## Reportar bugs

Ao reportar um bug, inclua:

1. **Versão do VMark** — exibida no badge da barra de navegação ou no diálogo Sobre
2. **Sistema operacional** — versão do macOS, build do Windows ou distribuição Linux
3. **Passos para reproduzir** — o que você fez antes do problema ocorrer
4. **Arquivo de log** — anexe ou cole as entradas de log relevantes

As entradas de log possuem carimbo de data/hora e são marcadas por módulo (por exemplo, `[HotExit]`, `[MCP Bridge]`, `[Export]`), facilitando a localização das seções relevantes.

### Encontrar logs relevantes

1. Abra o diretório de logs indicado na tabela acima
2. Abra o arquivo `.log` mais recente
3. Procure por entradas `ERROR` ou `WARN` próximas ao horário em que o problema ocorreu
4. Copie as linhas relevantes e inclua no seu relatório de bug

## Problemas comuns

### O aplicativo inicia lentamente no Windows

O VMark é otimizado para macOS. No Windows, a inicialização pode ser mais lenta devido à inicialização do WebView2. Certifique-se de que:

- O WebView2 Runtime esteja atualizado
- O software antivírus não esteja verificando o diretório de dados do aplicativo em tempo real

### A barra de menus mostra inglês após a troca de idioma

Se a barra de menus permanecer em inglês após trocar o idioma nas Configurações, reinicie o VMark. O menu é reconstruído na próxima inicialização com o idioma salvo.

### O terminal não aceita pontuação CJK

Corrigido na versão v0.6.5+. Atualize para a versão mais recente.

### Problemas de conexão do servidor MCP

O servidor MCP pode falhar ao iniciar ou os clientes podem não conseguir se conectar.

- Certifique-se de que o VMark está em execução — o servidor MCP só inicia quando o aplicativo está aberto.
- Verifique se nenhum outro processo está usando a mesma porta. O servidor MCP grava um arquivo de porta para descoberta de clientes; arquivos de porta obsoletos de uma sessão anterior podem causar conflitos. Reinicie o VMark para regenerá-lo.
- Verifique o arquivo de log em busca de entradas `[MCP Bridge]` para identificar erros de conexão.

### O atalho de teclado não funciona

Um atalho pode parecer não responder se estiver em conflito com outra associação ou tiver sido personalizado.

- Abra Configurações (`Mod + ,`) e navegue até a aba **Atalhos** para verificar se o atalho foi reatribuído.
- Procure por associações duplicadas — se duas ações compartilham a mesma combinação de teclas, apenas uma será acionada.
- No macOS, alguns atalhos podem conflitar com associações do sistema (por exemplo, Mission Control, Spotlight). Verifique em **Ajustes do Sistema > Teclado > Atalhos de Teclado**.

### Problemas de exportação/impressão

A exportação em PDF pode travar ou produzir saída incompleta.

- Se imagens estão faltando na exportação, verifique se os caminhos das imagens são relativos ao documento e se os arquivos existem no disco. URLs absolutas e imagens remotas devem ser acessíveis.
- Verifique as permissões de arquivo no diretório de saída — o VMark precisa de acesso de escrita para salvar o arquivo exportado.
- Para documentos grandes, a exportação pode demorar mais. Verifique o arquivo de log em busca de entradas `[Export]` se parecer travado.

### O arquivo não abre

O VMark pode se recusar a abrir um arquivo ou mostrar conteúdo ilegível.

- Verifique se o arquivo tem permissões de leitura para sua conta de usuário.
- O VMark espera Markdown codificado em UTF-8. Arquivos em outras codificações (por exemplo, GB2312, Shift-JIS) podem não ser exibidos corretamente — converta-os para UTF-8 primeiro.
- Se o arquivo está bloqueado por outro processo (por exemplo, um cliente de sincronização ou ferramenta de backup), feche esse processo e tente novamente.
- **macOS: dar duplo clique em um arquivo baixado não faz nada enquanto o VMark está em execução.** Arquivos salvos por alguns aplicativos carregam o atributo de quarentena de download (`com.apple.quarantine`), e o macOS pode descartar silenciosamente o pedido para abrir esse arquivo em um aplicativo que já está em execução. Quando você abre um espaço de trabalho, o VMark remove o atributo da pasta do espaço de trabalho e dos arquivos diretamente dentro dela que ele consegue abrir (subpastas não são tocadas) — a configuração **Remover quarentena de downloads ao abrir o espaço de trabalho** em **Configurações → Avançado → macOS**, ativada por padrão. Para qualquer outro arquivo, use **Arquivo → Abrir** ou execute `xattr -d com.apple.quarantine <file>` no Terminal.

### Acesso a pastas e erros `forbidden path`

Fora da sua pasta pessoal e dos volumes montados — e, no Windows, fora das unidades de `C:\` a `F:\` — o VMark só lê aquilo a que você deu acesso; veja [O Que o VMark Pode Ler no Disco](/pt-BR/guide/privacy#o-que-o-vmark-pode-ler-no-disco).

- **Uma caixa de diálogo de pastas abre quando você escolhe um espaço de trabalho recente.** O VMark não consegue confirmar que você escolheu essa pasta antes, e nada mais permite que ele a leia. A caixa de diálogo abre nessa pasta: clique em **Abrir** para confirmá-la, e o VMark passa a lembrar dela. Se você cancelar, nada é aberto.
- **O pedido de um assistente de IA para abrir uma pasta precisa de mais um passo.** Depois que você aprova o pedido, o VMark mostra a mesma caixa de diálogo; escolha a pasta ali e deixe o assistente tentar de novo.
- **Um erro menciona `forbidden path`, ou uma imagem não aparece.** O arquivo está fora de todos os lugares que o VMark pode ler — muitas vezes é uma imagem ao lado de um documento que você abriu sozinho. Abra a pasta do documento com **Arquivo → Abrir espaço de trabalho...** para dar ao VMark a pasta inteira.

### Desempenho do editor

O editor pode ficar lento com arquivos muito grandes ou muitas abas abertas.

- Feche abas não utilizadas para liberar memória — cada aba aberta mantém seu próprio estado de editor.
- Documentos muito grandes (mais de 10.000 linhas) podem causar atraso na digitação. Considere dividi-los em arquivos menores.
- Desative o Modo Foco e o Modo Máquina de Escrever se não forem necessários, pois adicionam sobrecarga extra de renderização.

### O Gênio de IA não responde

Os Gênios de IA requerem um provedor de IA configurado para funcionar.

- Abra Configurações e verifique se um provedor de IA (por exemplo, Ollama, OpenAI, Anthropic) está configurado com um nome de modelo válido.
- O CLI do provedor deve estar disponível no seu PATH. No macOS, aplicativos com interface gráfica têm um PATH mínimo — se o CLI foi instalado via Homebrew, certifique-se de que seu perfil de shell exporte o caminho correto.
- Verifique o nome do modelo em busca de erros de digitação. Um nome de modelo incorreto falhará silenciosamente ou retornará um erro.

### O recarregamento está bloqueado

`Cmd + R`, `Ctrl + R` e `Ctrl + Shift + R` não fazem nada, de propósito. Recarregar o webview descartaria todos os editores abertos, o histórico de desfazer e qualquer estado não salvo, então o VMark bloqueia os atalhos, o caminho de descarregamento da página e o próprio menu de contexto do webview. Duas exceções: `Ctrl + R` chega ao shell quando o terminal integrado está em foco (reverse-i-search), e `F5` nunca é bloqueado porque é o atalho de Espiar código-fonte. As builds de desenvolvimento apenas avisam sobre documentos não salvos.

### Um VMark por vez no Windows e no Linux

Dar duplo clique em um arquivo, ou abrir o VMark de novo por um inicializador, entrega o arquivo ao VMark que já está em execução e traz uma janela para a frente, em vez de iniciar uma segunda cópia. Um segundo processo compartilharia os dados de aplicativo, a sessão e o armazenamento de janelas do primeiro, e os dois sobrescreveriam o estado um do outro — a perda de dados por trás do #1330. O macOS sempre se comportou assim por meio do sistema operacional. Uma build de desenvolvimento (`tauri dev`) usa seu próprio identificador e, portanto, conta como outro aplicativo.

No Windows, se o VMark que já está em execução parou de responder e não consegue mais receber a passagem, uma nova inicialização não abre uma segunda cópia ao lado dele. Em vez disso, mostra uma mensagem: abra o Gerenciador de Tarefas, finalize todos os processos `VMark` e inicie o VMark novamente (#1527).

No Linux, isso depende do barramento de sessão do D-Bus. Em uma sessão sem um `DBUS_SESSION_BUS_ADDRESS` utilizável, o VMark ainda inicia, mas sem essa proteção — abri-lo de novo inicia uma segunda cópia, com o risco descrito acima — e o log registra que a proteção está desligada. Inicie-o a partir de uma sessão de desktop ou de um shell onde essa variável esteja definida.

### Janela em branco no Linux

Em algumas combinações de AMD / Mesa / WebKitGTK (Arch com KDE Plasma 6 foi o caso relatado, #1058), o renderizador DMABUF do WebKitGTK falha e a área de conteúdo fica em branco. O VMark define `WEBKIT_DISABLE_DMABUF_RENDERER=1` antes de o webview iniciar para que isso não aconteça. Se quiser o renderizador DMABUF de volta, inicie com `WEBKIT_DISABLE_DMABUF_RENDERER=0` — o VMark só define a variável quando você não a definiu.

### Um atalho digita um caractere quando um método de entrada chinês está ativo

Corrigido. Com a pontuação chinesa ativada, um método de entrada reescreve as teclas de pontuação — a tecla de acento grave produz `·`, os colchetes produzem `【】` — e confirma esse caractere **antes** que o aplicativo seja avisado de que a tecla foi pressionada. Por isso `` Ctrl + ` `` alternava o terminal *e* deixava um `·` perdido no documento, marcando um arquivo limpo como editado.

Agora o VMark veta a própria inserção, e não o pressionamento da tecla, então um atalho de comando não digita nada. A digitação comum em chinês, as teclas mortas (`Option + e`) e os caracteres AltGr dos teclados europeus não são afetados — apenas as inserções que chegam enquanto `Ctrl` ou `Cmd` está pressionado são recusadas, e nenhum atalho do VMark significa "digite este caractere".

Se você ainda vir um caractere perdido vindo de um atalho, vale a pena [relatar](https://github.com/xiaolai/vmark/issues) informando o nome do método de entrada e o atalho exato.

### Aspas e travessões inteligentes no macOS

Digitar `--` ou `"` no VMark permanece literal mesmo que o seu Mac tenha *Usar aspas e travessões inteligentes* ativado. Caso contrário, o sistema reescreveria o texto por baixo do editor — `-->` em um bloco Mermaid virava `—>` —, então o VMark desativa as substituições automáticas de travessão, aspas e ponto final apenas para o seu próprio processo. Outros aplicativos não são afetados, nem os métodos de entrada e as suas próprias substituições de texto. Para aspas tipográficas dentro do VMark, use as [regras de aspas inteligentes do formatador CJK](/pt-BR/guide/cjk-formatting#estilos-de-aspas-inteligentes) ou a alternância de estilo de aspas (`Shift + Mod + '`).

### O VMark permanece ativo em segundo plano (App Nap)

No macOS, o VMark desativa o App Nap enquanto estiver em execução, então o Monitor de Atividade o mostra como nunca cochilando, mesmo quando suas janelas estão ocultas. O App Nap congelaria o webview — e com ele todas as solicitações de assistentes de IA (MCP) — até você trazer uma janela para a frente; permanecer ativo é o que permite que um assistente continue trabalhando enquanto você está em outro aplicativo. O sistema ainda pode entrar em repouso quando ocioso; o VMark apenas pede para não ser colocado para cochilar.
