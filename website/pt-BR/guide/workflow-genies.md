# Genies de Workflow

Um **genie de workflow** é um [workflow de genie](/pt-BR/guide/workflows) — um pipeline YAML de várias etapas — salvo na sua pasta de genies como um arquivo `.yml` ou `.yaml`. Ele aparece no seletor de genies (`Mod + Y`) e em **Editar → Assistentes** exatamente como um genie em Markdown; ao escolhê-lo, o pipeline inteiro é executado pelo motor de workflow em vez de enviar um único prompt.

## Requisitos

| Requisito | Por quê |
|-----------|---------|
| **Configurações → Avançado → Ferramentas de desenvolvedor** e, em seguida, **Motor de workflow** ativado | O motor vem desativado por padrão. O seletor continua listando um genie de workflow enquanto o motor está desativado, mas executá-lo falha com "O motor de fluxo de trabalho está desativado nas configurações" |
| Uma área de trabalho aberta | Etapas de ação como `action/save-file` resolvem caminhos em relação à raiz da área de trabalho; sem uma, o VMark mostra um aviso e não inicia a execução |
| Um [provedor de IA](/pt-BR/guide/ai-providers) configurado | As etapas de genie chamam o provedor ativo, o mesmo que os genies em Markdown usam |

## Escrevendo um

Coloque o arquivo YAML em qualquer lugar dentro da pasta de genies (**Editar → Assistentes → Abrir pasta de assistentes**); subpastas viram categorias, como acontece com os genies em Markdown. O seletor mostra o nome do arquivo como nome do genie e a `description` do YAML (ou, na falta dela, seu `name`) como linha secundária. O escopo de um genie de workflow é o documento inteiro — a execução não tem uma seleção sobre a qual trabalhar — por isso cada etapa fornece seu próprio `with: { input: … }`, e os genies em Markdown que ela chama vinculam isso ao seu placeholder `{{content}}` sem alterações.

O exemplo incluído `triage-and-translate.yml` é um ponto de partida pronto: copie-o para a pasta e substitua o texto inicial. Onde ele fica, o esquema YAML completo, expressões, aprovações, modelos por etapa e timeouts estão todos documentados em [Workflows de Genie](/pt-BR/guide/workflows); a execução de um genie de workflow acontece e seus diálogos de aprovação aparecem normalmente, mas ela não mostra o grafo de etapas ao vivo, não pode ser cancelada pelo painel de Workflow (o Executar do painel informa que o motor está ocupado enquanto ela roda), e o painel não oferece Restaurar arquivos para ela.

Veja também [AI Genies](/pt-BR/guide/ai-genies) para o formato de genie em Markdown de prompt único.
