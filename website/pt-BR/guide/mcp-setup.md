# Integração com IA (MCP)

O VMark inclui um servidor MCP (Model Context Protocol) integrado que permite que assistentes de IA como o Claude interajam diretamente com seu editor.

## O que é MCP?

O [Model Context Protocol](https://modelcontextprotocol.io/) é um padrão aberto que permite que assistentes de IA interajam com ferramentas e aplicativos externos. O servidor MCP do VMark expõe suas capacidades de edição como ferramentas que assistentes de IA podem usar para:

- Ler e escrever conteúdo de documentos
- Aplicar formatação e criar estruturas
- Navegar e gerenciar documentos
- Inserir conteúdo especial (matemática, diagramas, links wiki)

## Configuração Rápida

O VMark facilita a conexão de assistentes de IA com instalação em um clique.

### 1. Habilitar o Servidor MCP

Abra **Configurações → Integrações** e habilite o Servidor MCP:

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-server.png" alt="VMark MCP Server Settings" />
</div>

- **Ativar servidor MCP** - Ativar para permitir conexões de IA
- **Iniciar ao abrir** - Iniciar automaticamente quando o VMark abrir
- **Aprovar automaticamente salvamentos em um novo local e resultados de gênios** - Desativado por padrão. Permite que uma IA salve um documento em um caminho *novo* sem perguntar, e permite que um genie aplique seu resultado diretamente em vez de como sugestão. As escritas comuns da IA nunca dependem dessa opção — a rede de segurança delas é o [histórico de pontos de verificação de edição](#pontos-de-verificacao-de-edicao) (veja [Como as Edições Funcionam](#como-as-edicoes-funcionam))

### 2. Instalar Configuração

Clique em **Instalar** para o seu assistente de IA:

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-install.png" alt="VMark MCP Install Configuration" />
</div>

Assistentes de IA suportados:
- **Claude Desktop** - Aplicativo desktop da Anthropic
- **Claude Code** - CLI para desenvolvedores
- **Codex CLI** - Assistente de programação da OpenAI
- **Antigravity CLI** - O `agy` do Google, sucessor do Gemini CLI
- **Grok CLI** - Agente de programação da xAI
- **opencode** - O agente de terminal de código aberto e independente de provedor

**O Instalar grava uma credencial por cliente.** Além do caminho para o servidor MCP do VMark, o Instalar coloca um token secreto no próprio arquivo de configuração do cliente, em `env.VMARK_MCP_TOKEN` (`environment.VMARK_MCP_TOKEN` no opencode). Cada cliente recebe seu próprio token, que não é armazenado em nenhum outro lugar. Ele informa ao VMark qual cliente está se conectando, em vez de confiar no nome que o cliente declara. Hoje, apenas as ações delegadas precisam dele — responder a uma pergunta de coerência em seu nome com `coherence_resolve`; todas as outras ferramentas funcionam sem ele. O Instalar e o **Reparar** mantêm um token que ainda é válido; para emitir um novo, desinstale e instale de novo. Reinicie o cliente de IA depois de qualquer um dos dois. Trate o token como uma senha: não cole o arquivo de configuração em uma issue ou em um chat.

::: info O Gemini CLI foi descontinuado
O Google substituiu o Gemini CLI pelo Antigravity. Se uma instalação anterior do VMark deixou
uma entrada `vmark` em `~/.gemini/settings.json`, o painel Integrações mostra uma
linha **Descontinuado** para ela com um botão **Remover**; as novas instalações têm como alvo
o Antigravity.
:::

::: info Outros Clientes Compatíveis com MCP
Outros clientes compatíveis com MCP, como Cursor, Windsurf e ferramentas semelhantes, também podem se conectar ao servidor MCP do VMark. Configure-os manualmente apontando para o caminho do binário do servidor MCP (veja [Configuração Manual](#configuracao-manual) abaixo).
:::

#### CC-Switch

Se você gerencia suas CLIs de IA com o CC-Switch, o instalador também mostra uma linha **CC-Switch**. **Adicionar ao CC-Switch** abre um link `ccswitch://v1/import` que entrega o servidor MCP do VMark — o caminho do seu binário — ao CC-Switch, que então grava a entrada `vmark` em todas as CLIs que você gerencia ali; um botão de cópia fornece o próprio link, se você preferir colá-lo. A linha fica desabilitada até que o VMark tenha resolvido o seu próprio binário MCP.

#### Ícones de Status

Cada provedor mostra um indicador de status:

| Ícone | Status | Significado |
|-------|--------|-------------|
| ✓ Verde | Válido | Configuração correta e funcionando |
| ⚠ Âmbar | Caminho Incorreto | VMark foi movido — clique em **Reparar** |
| ✗ Vermelho | Binário Ausente | Binário MCP não encontrado — reinstale o VMark |
| 🗎 Vermelho | Configuração Ilegível | O VMark não consegue ler ou analisar o arquivo de configuração, então não se sabe se ele contém uma entrada do VMark. A mensagem indica o arquivo e o motivo. Corrija-o ou mova-o e clique em **Verificar novamente** — instalar e reparar ficam indisponíveis até que ele seja analisado, porque gravar em um arquivo que o VMark não consegue ler poderia destruir o seu conteúdo |
| ○ Cinza | Não Configurado | Não instalado — clique em **Instalar** |

::: tip VMark foi movido?
Se você mover o VMark.app para um local diferente, o status mostrará âmbar "Caminho Incorreto". Simplesmente clique no botão **Reparar** para atualizar a configuração com o novo caminho.
:::

### 3. Reiniciar o Assistente de IA

Após instalar ou reparar, **reinicie seu assistente de IA** completamente (feche e reabra) para carregar a nova configuração. O VMark exibirá um lembrete após cada alteração de configuração.

### 4. Experimente

No seu assistente de IA, tente comandos como:
- *"O que está no meu documento VMark?"*
- *"Escreva um resumo sobre computação quântica no VMark"*
- *"Adicione um índice ao meu documento"*

## Veja em Ação

Faça uma pergunta ao Claude e peça que ele escreva a resposta diretamente no seu documento VMark:

<div class="screenshot-container">
  <img src="/screenshots/mcp-claude.png" alt="Claude Desktop using VMark MCP" />
  <p class="screenshot-caption">O Claude Desktop chama <code>document</code> → <code>set_content</code> para escrever no VMark</p>
</div>

<div class="screenshot-container">
  <img src="/screenshots/mcp-result.png" alt="Content rendered in VMark" />
  <p class="screenshot-caption">O conteúdo aparece instantaneamente no VMark, totalmente formatado</p>
</div>

<!-- Styles in style.css -->

## Configuração Manual

Se preferir configurar manualmente, aqui estão os locais dos arquivos de configuração:

### Claude Desktop

Edite `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) ou `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Claude Code

Edite `~/.claude.json` ou o projeto `.mcp.json`:

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Codex CLI

Edite `~/.codex/config.toml`:

```toml
[mcp_servers.vmark]
command = "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
```

### Antigravity CLI

Edite `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Grok CLI

Edite `~/.grok/config.toml`:

```toml
[mcp_servers.vmark]
command = "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
```

### opencode

Edite `~/.config/opencode/opencode.json`. O schema do opencode é diferente do
de `mcpServers`: a chave é `mcp`, e `command` é um único array contendo
o programa e seus argumentos:

```json
{
  "mcp": {
    "vmark": {
      "type": "local",
      "command": ["/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"],
      "enabled": true
    }
  }
}
```

Se as suas próprias configurações ficam em `opencode.jsonc`, deixe-as lá — o opencode
mescla os dois arquivos, então a entrada do VMark em `opencode.json` é aditiva. O VMark grava
o arquivo em JSON puro porque não consegue preservar os comentários de um `.jsonc`.

::: warning Uma entrada `vmark` existente em `opencode.jsonc` prevalece
O opencode mescla `config.json`, depois `opencode.json`, depois `opencode.jsonc`, e
o último lido tem precedência. Então, se você adicionou antes uma entrada `vmark`
em `opencode.jsonc` à mão, ela sobrepõe a que o VMark gerencia — o VMark vai
informar o provedor como válido enquanto o opencode continua usando a sua entrada antiga (e
o caminho de binário desatualizado dela). Apague o bloco `mcp.vmark` escrito à mão em
`opencode.jsonc` e deixe que o painel Integrações cuide dele.
:::

::: tip Encontrando o Caminho do Binário
No macOS, o binário do servidor MCP está dentro do VMark.app:
- `VMark.app/Contents/MacOS/vmark-mcp-server`

No Windows:
- `C:\Program Files\VMark\vmark-mcp-server.exe`

No Linux:
- `/usr/bin/vmark-mcp-server` (ou onde você o instalou)

A porta é descoberta automaticamente — nenhum argumento `args` é necessário.
:::

### Flags de CLI (avançado)

O binário do servidor MCP suporta um pequeno conjunto de flags para diagnóstico e configurações legadas:

| Flag | O que faz |
|---|---|
| `--version` (ou `-v`) | Exibe a versão (deve corresponder ao VMark em execução) e encerra. |
| `--health-check` | Executa um autoteste do binário e encerra: inicia o servidor MCP contra uma ponte simulada embutida, imprime sua versão e a contagem de ferramentas como JSON e encerra com código diferente de zero se a contagem de ferramentas não for a esperada por esta build. Ele **não** contata um VMark em execução — use-o para confirmar que o binário funciona; use **Configurações → Integrações** para verificar a ponte ativa. |
| `--port <número>` | Sobrescrita manual de porta. Ignora o handshake de autodescoberta e conecta na porta indicada. Útil apenas para configurações legadas onde a porta da ponte é fixada externamente; o caminho de autodescoberta é preferido. |

Exemplo:

```bash
vmark-mcp-server --health-check
vmark-mcp-server --version
vmark-mcp-server --port 9223   # legado / manual
```

Qualquer outro argumento — uma flag digitada errado, `--port=9223` ou uma palavra solta — é recusado: o programa exibe um erro de uso e sai com o código 64 em vez de recorrer à detecção automática.

## Como Funciona

```text
Assistente de IA <--stdio--> Servidor MCP <--WebSocket--> Editor VMark
```

1. **O VMark inicia uma ponte WebSocket** em uma porta disponível ao ser lançado
2. **O servidor MCP** lê a porta e o token de autenticação do diretório de dados do aplicativo VMark
3. **O servidor MCP** se conecta e autentica via ponte WebSocket
4. **O assistente de IA** se comunica com o servidor MCP via stdio
5. **Os comandos são retransmitidos** ao editor do VMark através da ponte

## Capacidades Disponíveis

Quando conectado, seu assistente de IA tem dez ferramentas:

| Ferramenta | O que abrange |
|------|----------------|
| `session` | Janelas, abas, o documento ativo e as abas do navegador (somente leitura) |
| `workspace` | Novo, abrir, salvar, salvar como, fechar, trocar de aba, focar uma janela, abrir um espaço de trabalho |
| `document` | Ler e escrever o documento inteiro como Markdown; transformações de formatação CJK |
| `selection` | Ler e substituir o texto selecionado |
| `comments` | Listar os comentários de revisão do documento, respondê-los e marcá-los como atendidos (um assistente não pode resolvê-los) |
| `workflow` | Patches seguros para a CST e validação de YAML do GitHub Actions |
| `browser` / `browser_read` | Automação do navegador incorporado no macOS — as metades que alteram e as somente leitura |
| `coherence` / `coherence_resolve` | Ler a camada de coerência; resolver arestas desatualizadas sob uma delegação que você concedeu |

A formatação não é uma ferramenta separada: o assistente escreve Markdown, então títulos, tabelas, matemática e diagramas são o que ele escrever.

Veja a [Referência de Ferramentas MCP](/pt-BR/guide/mcp-tools) para documentação completa.

## Verificando o Status do MCP

O VMark oferece várias formas de verificar o status do servidor MCP:

### Indicador na Barra de Status

A barra de status mostra um indicador **MCP** no lado direito. Quando algo
precisa da sua atenção, uma pequena palavra de estado aparece ao lado do ícone de satélite;
uma conexão saudável é apenas o ícone verde. Passar o cursor sobre ele lista os clientes de IA
conectados no momento, por nome e versão:

| Cor | Palavra | Status |
|-----|---------|--------|
| Verde | — | Conectado e em execução |
| Cinza | `off` | Desconectado ou parado |
| Pulsando (animado) | `…` | Iniciando |
| Vermelho | `error` | O servidor falhou — passe o cursor para ver o motivo |

A inicialização normalmente é concluída em 1-2 segundos.

Clique no indicador para abrir **Configurações → Integrações**.

### Painel de Configurações

**Configurações → Integrações** é a outra superfície de status — não existe um diálogo de status separado. Enquanto a ponte está em execução, ele mostra o endereço em que ela escuta (`localhost:<port>`, com um botão de cópia) e quantos clientes de IA estão conectados, atualizado a cada poucos segundos. O botão **Testar conexão** (chamado **Verificar sidecar** enquanto a ponte está parada) executa o próprio `--health-check` do sidecar e informa a versão do sidecar, sua contagem de ferramentas e quando foi verificado pela última vez — ele confirma que o binário instalado funciona, não que um cliente está conectado.

## Solução de Problemas

### "Conexão recusada" ou "Nenhum editor ativo"

- Certifique-se de que o VMark está em execução e tem um documento aberto
- Verifique se o Servidor MCP está habilitado em Configurações → Integrações
- Confirme que a ponte MCP mostra o status "Em execução"
- Reinicie o VMark se a conexão foi interrompida

### Caminho incorreto após mover o VMark

Se você moveu o VMark.app para um local diferente (por exemplo, de Downloads para Aplicativos), a configuração apontará para o caminho antigo:

1. Abra **Configurações → Integrações**
2. Procure o ícone de aviso âmbar ⚠ ao lado dos provedores afetados
3. Clique em **Reparar** para atualizar o caminho
4. Reinicie seu assistente de IA

### Ferramentas não aparecendo no assistente de IA

- Reinicie seu assistente de IA após instalar a configuração
- Verifique se a configuração foi instalada (procure por marca de verificação verde nas Configurações)
- Verifique os logs do seu assistente de IA em busca de erros de conexão MCP

### Comandos falham com "Nenhum editor ativo"

- Certifique-se de que uma aba de documento está ativa no VMark
- Clique na área do editor para focar nela
- Alguns comandos requerem que o texto esteja selecionado primeiro

## Como as Edições Funcionam

A superfície MCP enxuta segue o eixo leitura-escrita: os assistentes de IA chamam `document.read` para obter o conteúdo atual + um token de revisão, raciocinam sobre ele e então chamam `document.write` com o novo conteúdo completo. O token de revisão protege contra sobrescritas silenciosas: se você digitou no VMark enquanto a IA estava pensando, a escrita retorna `STALE` e a IA lê de novo.

Para arquivos YAML de workflow do GitHub Actions, a IA usa `workflow.apply_patch` em vez disso — os mutadores do VMark que reconhecem a CST preservam comentários, âncoras e a ordem das chaves que uma reescrita de texto bruto perderia.

Não há etapa de prévia para `document.write`, `selection.set` ou `workflow.apply_patch` — a alteração chega ao editor assim que a verificação de revisão passa. A rede de segurança é o [histórico de pontos de verificação de edição](#pontos-de-verificacao-de-edicao) abaixo; se você quer revisar antes que qualquer coisa chegue, mantenha o documento no git e revise o diff. A única barreira de aprovação é **Aprovar automaticamente salvamentos em um novo local e resultados de gênios**: com ela desativada (o padrão), uma IA não pode salvar um documento em um novo caminho — `workspace.save_as` retorna `APPROVAL_REQUIRED` e o VMark mostra uma notificação com o nome do arquivo. Mesmo com ela ativada, `save_as` se recusa a sobrescrever um arquivo diferente já existente.

## Pontos de Verificação de Edição

Cada modificação de documento feita pela IA — `document.write`, `document.transform`, `selection.set` e `workflow.apply_patch` — é registrada no histórico de edição do VMark antes de alterar qualquer coisa. O botão **histórico** na barra de status abre um painel para o documento em foco. Seu contador mostra as versões do documento feitas pela IA, e o botão assume uma cor de aviso quando as alterações não estão sendo registradas. O painel se atualiza ao vivo, em todas as janelas, à medida que versões são registradas.

O painel lista as versões do documento, da mais recente para a mais antiga. Cada linha mostra quando aconteceu, que tipo de alteração foi, a ferramenta e quem a fez: o provedor do cliente de IA (por exemplo `claude` ou `codex`), sua conexão e seu rótulo de sessão. Um cliente sem token aparece como **Cliente não identificado**, um token desconhecido como **Credencial não reconhecida** e um token compartilhado por vários clientes como **Credencial compartilhada por vários provedores** — nunca como um provedor, seja qual for o nome que o cliente se dê. **Restaurar esta versão** devolve o texto daquela versão; **Restaurar o estado anterior a esta alteração** devolve o texto anterior. Restaurar incrementa a revisão do documento, então um cliente de IA que ainda tenha a revisão antiga recebe `STALE` na próxima escrita em vez de sobrescrever sua restauração. A própria restauração é registrada: o texto que ela substitui é guardado primeiro, e um documento editado enquanto a restauração estava em andamento não é alterado. Quando o VMark não consegue confirmar que o registro de uma restauração chegou ao disco, ele avisa ao lado do resultado.

Acima das versões, **Revisar alterações da IA** lista as alterações da IA que você ainda não revisou, agrupadas por cliente e sessão; versões cujas alterações estão todas revisadas são resumidas em uma contagem. Cada alteração oferece **Manter** ou **Reverter** (e depois **Desfazer manter** ou **Desfazer reversão**). Uma reversão que sobrescreveria texto que você editou desde então não é aplicada: a alteração é marcada como em conflito e, depois que você o resolver à mão, **Marcar como resolvida** registra isso. Uma alteração cuja posição não pode mais ser certificada diz o motivo e não oferece reversão automática. **Encerrar revisadas** encerra de vez todas as alterações revisadas, após uma confirmação, pois não pode ser desfeito. Um documento comporta no máximo 500 alterações da IA não revisadas: nesse limite um aviso informa isso, e as edições da IA são recusadas com `REVIEW_BACKLOG_FULL` até você revisar e encerrar. Um salvamento que partiu de uma versão diferente da anterior — o documento foi editado em duas janelas — é marcado como tal, com as duas restaurações para desfazer a mesclagem. **Mostrar as duas alterações** abre duas diferenças desse salvamento: *Em relação à versão da qual este salvamento partiu*, e *Em relação à versão anterior*, em relação à versão anterior no histórico.

Em seguida, **Comentários** reúne as conversas de comentários do documento. **Comentar a seleção** cita o texto selecionado no editor (com apenas o cursor, o parágrafo em que ele está) e adiciona o seu comentário; o texto não salvo é registrado primeiro, então um comentário nunca aponta para uma versão anterior. Cada conversa mostra o estado — aberto, tratado, resolvido ou reaberto —, quem a escreveu, o texto citado e as respostas. Os comentários aparecem como texto simples: HTML em um comentário é exibido, nunca executado. Quando o texto citado passa a aparecer várias vezes, a conversa diz quantas; quando ele some, a conversa avisa. Você pode **Responder** em qualquer estado, **Marcar como tratado** uma conversa aberta ou reaberta, **Resolver** e **Reabrir** ou **Excluir** uma resolvida; excluir pede confirmação e não pode ser desfeito. Enquanto um comentário ou uma resposta está sendo enviado, não é possível editá-lo nem cancelá-lo, mesmo se você fechar o painel e abri-lo de novo; se for recusado, é mantido para que você possa alterá-lo e enviá-lo de novo. Só você pode resolver, reabrir ou excluir uma conversa. Uma conversa reaberta depois que a revisão original saiu do histórico mostra *Revisão de criação não é mais mantida* e é comparada com o texto atual.

O topo do painel informa quando as alterações não estão sendo registradas: o histórico não conseguiu iniciar ou é somente leitura, está atrasado (registros na fila, ainda não no disco), o último salvamento deste documento foi recusado ou o histórico não respondeu a tempo, edições de IA foram recusadas em uma janela com páginas abertas demais, ou algumas alterações da IA não podem mais ser revertidas automaticamente. O painel também conta as edições da IA registradas como alterações do documento inteiro porque não foi possível confirmar o trecho alterado. Uma alteração que não pode mais ser revertida automaticamente aparece como **Bloqueado: motivo (origem)** sob a última versão em que sua posição foi certificada, que fica destacada; quando não há nenhuma, o painel informa que a posição não está disponível. Gravações aplicadas mas nunca registradas aparecem em **Gravações não registradas**, cada uma com restaurar e descartar.

Para distinguir várias sessões de um mesmo cliente, defina `VMARK_SESSION_LABEL` na configuração MCP do cliente, ao lado de `VMARK_MCP_TOKEN`:

```json
"env": { "VMARK_MCP_TOKEN": "…", "VMARK_SESSION_LABEL": "docs refactor" }
```

O rótulo tem no máximo 128 bytes UTF-8, sem caracteres de controle; um rótulo que viola a regra é descartado com um aviso e o cliente se conecta sem ele. Ele é escolhido pela configuração do cliente, então serve apenas para exibição e não decide nada.

O histórico fica na pasta `agent-journal` do diretório de dados do VMark, então sobrevive a uma reinicialização. A pasta contém o texto anterior completo de cada edição registrada e só é acessível ao proprietário (`0700` no macOS e no Linux). Pontos de verificação de uma versão anterior do VMark (um `mcp-checkpoints.jsonl`, importado na primeira inicialização e depois renomeado) aparecem em **Pontos de verificação anteriores**, uma única lista para todos os documentos e janelas. Restaurar um abre o arquivo dele; um sem título, ou um cujo arquivo não pode mais ser aberto, é restaurado em um novo documento. A seção mostra quanto texto de pontos de verificação é mantido e limpa tudo — cada arquivo e cada janela — em uma única ação, apagando os textos do disco.

## Notas de Segurança

- O servidor MCP aceita apenas conexões locais (localhost)
- Nenhum dado é enviado a servidores externos
- As operações de arquivo da IA ficam confinadas à raiz do espaço de trabalho aberto e às pastas dos documentos abertos — veja [Privacidade](/pt-BR/guide/privacy#o-que-um-assistente-de-ia-pode-alcancar)
- Todo o processamento acontece na sua máquina
- A ponte WebSocket é acessível apenas localmente
- Cada cliente instalado tem o seu próprio `VMARK_MCP_TOKEN`. Um cliente sem token, com um token desconhecido ou com um compartilhado com outro cliente ainda se conecta, mas as suas ações delegadas são recusadas com uma mensagem pedindo que você execute Instalar para ele em **Configurações → Integrações** e o reinicie

## Próximos Passos

- Explore todas as [Ferramentas MCP](/pt-BR/guide/mcp-tools) disponíveis
- Aprenda sobre [atalhos de teclado](/pt-BR/guide/shortcuts)
- Conheça outros [recursos](/pt-BR/guide/features)
