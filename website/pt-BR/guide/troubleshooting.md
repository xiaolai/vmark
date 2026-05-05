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

Para qualquer coisa não listada acima, veja [Reportar bugs](#reportar-bugs).

## Arquivos de log

O VMark grava arquivos de log para ajudar a diagnosticar problemas. Os logs incluem avisos e erros tanto do backend Rust quanto do frontend.

### Localização dos arquivos de log

| Plataforma | Caminho |
|------------|---------|
| macOS | `~/Library/Logs/app.vmark/` |
| Windows | `%APPDATA%\app.vmark\logs\` |
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
