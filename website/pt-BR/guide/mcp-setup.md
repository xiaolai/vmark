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

- **Habilitar Servidor MCP** - Ativar para permitir conexões de IA
- **Iniciar ao abrir** - Iniciar automaticamente quando o VMark abrir
- **Aprovar edições automaticamente** - Aplicar alterações da IA sem prévia (veja abaixo)

### 2. Instalar Configuração

Clique em **Instalar** para o seu assistente de IA:

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-install.png" alt="VMark MCP Install Configuration" />
</div>

Assistentes de IA suportados:
- **Claude Desktop** - Aplicativo desktop da Anthropic
- **Claude Code** - CLI para desenvolvedores
- **Codex CLI** - Assistente de programação da OpenAI
- **Gemini CLI** - Assistente de IA do Google

::: info Outros Clientes Compatíveis com MCP
Outros clientes compatíveis com MCP, como Cursor, Windsurf e ferramentas semelhantes, também podem se conectar ao servidor MCP do VMark. Configure-os manualmente apontando para o caminho do binário do servidor MCP (veja [Configuração Manual](#configuracao-manual) abaixo).
:::

#### Ícones de Status

Cada provedor mostra um indicador de status:

| Ícone | Status | Significado |
|-------|--------|-------------|
| ✓ Verde | Válido | Configuração correta e funcionando |
| ⚠ Âmbar | Caminho Incorreto | VMark foi movido — clique em **Reparar** |
| ✗ Vermelho | Binário Ausente | Binário MCP não encontrado — reinstale o VMark |
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

### Gemini CLI

Edite `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

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
| `--health-check` | Executa um autoteste contra a ponte VMark em execução e encerra. Use isso para verificar sua instalação antes de conectar um assistente de IA. |
| `--port <número>` | Sobrescrita manual de porta. Ignora o handshake de autodescoberta e conecta na porta indicada. Útil apenas para configurações legadas onde a porta da ponte é fixada externamente; o caminho de autodescoberta é preferido. |

Exemplo:

```bash
vmark-mcp-server --health-check
vmark-mcp-server --version
vmark-mcp-server --port 9223   # legado / manual
```

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

Quando conectado, seu assistente de IA pode:

| Categoria | Capacidades |
|-----------|-------------|
| **Documento** | Ler/escrever conteúdo, pesquisar, substituir |
| **Seleção** | Obter/definir seleção, substituir texto selecionado |
| **Formatação** | Negrito, itálico, código, links e mais |
| **Blocos** | Títulos, parágrafos, blocos de código, citações |
| **Listas** | Bullet, ordenada e listas de tarefas |
| **Tabelas** | Inserir, modificar linhas/colunas |
| **Especial** | Equações matemáticas, diagramas Mermaid, links wiki |
| **Área de Trabalho** | Abrir/salvar documentos, gerenciar janelas |

Veja a [Referência de Ferramentas MCP](/pt-BR/guide/mcp-tools) para documentação completa.

## Verificando o Status do MCP

O VMark oferece várias formas de verificar o status do servidor MCP:

### Indicador na Barra de Status

A barra de status mostra um indicador **MCP** no lado direito:

| Cor | Status |
|-----|--------|
| Verde | Conectado e em execução |
| Cinza | Desconectado ou parado |
| Pulsando (animado) | Iniciando |

A inicialização normalmente é concluída em 1-2 segundos.

Clique no indicador para abrir o diálogo de status detalhado.

### Diálogo de Status

Acesse via **Ajuda → Status do Servidor MCP** ou clique no indicador da barra de status.

O diálogo mostra:
- Saúde da conexão (Saudável / Erro / Parado)
- Estado de execução da ponte e porta
- Versão do servidor
- Ferramentas disponíveis (12) e recursos (4)
- Hora do último verificação de saúde
- Lista completa de ferramentas disponíveis com botão de cópia

### Painel de Configurações

Em **Configurações → Integrações**, quando o servidor estiver em execução você verá:
- Número da versão
- Contagens de ferramentas e recursos
- Botão **Testar Conexão** — executa uma verificação de saúde
- Botão **Ver Detalhes** — abre o diálogo de status

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

## Sistema de Sugestões e Aprovação Automática

Por padrão, quando assistentes de IA modificam seu documento (inserir, substituir ou excluir conteúdo), o VMark cria **sugestões** que requerem sua aprovação:

- **Inserir** - Novo texto aparece como prévia fantasma
- **Substituir** - Texto original com tachado, novo texto como prévia fantasma
- **Excluir** - Texto a remover aparece com tachado

Pressione **Enter** para aceitar ou **Escape** para rejeitar. Isso preserva seu histórico de desfazer/refazer e lhe dá controle total.

### Modo de Aprovação Automática

::: warning Use com Cuidado
Habilitar **Aprovar edições automaticamente** ignora a prévia de sugestão e aplica as alterações da IA imediatamente. Só habilite isso se você confiar no seu assistente de IA e quiser edição mais rápida.
:::

Quando a aprovação automática está habilitada:
- As alterações são aplicadas diretamente sem prévia
- Desfazer (Mod+Z) ainda funciona para reverter alterações
- As mensagens de resposta incluem "(aprovado automaticamente)" para transparência

Esta configuração é útil para:
- Fluxos de trabalho de escrita rápida assistida por IA
- Assistentes de IA confiáveis com tarefas bem definidas
- Operações em lote onde visualizar cada alteração é impraticável

## Notas de Segurança

- O servidor MCP aceita apenas conexões locais (localhost)
- Nenhum dado é enviado a servidores externos
- Todo o processamento acontece na sua máquina
- A ponte WebSocket é acessível apenas localmente
- A aprovação automática está desabilitada por padrão para evitar alterações não intencionais

## Próximos Passos

- Explore todas as [Ferramentas MCP](/pt-BR/guide/mcp-tools) disponíveis
- Aprenda sobre [atalhos de teclado](/pt-BR/guide/shortcuts)
- Conheça outros [recursos](/pt-BR/guide/features)
