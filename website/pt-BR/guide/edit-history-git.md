# Exportar o histórico de edições para o Git

O VMark mantém um histórico de edições para cada documento: cada salvamento e cada edição que um cliente de IA faz pelo MCP é registrado, com quem fez. **Arquivo → Histórico do documento → Exportar histórico de edições para o Git…** copia esse histórico para um repositório Git, para que você possa percorrê-lo com `git log`, compará-lo ou guardá-lo junto com o seu projeto.

## Como exportar

1. Abra o documento cujo histórico você quer.
2. Escolha **Arquivo → Histórico do documento → Exportar histórico de edições para o Git…** (ou execute *Exportar histórico de edições para o Git* na paleta de comandos).
3. Escolha uma pasta dentro do repositório Git. O seletor abre na pasta do próprio documento.

O VMark informa quantos commits adicionou, ou que o branch já estava atualizado.

## O que o branch contém

O histórico vai para um branch próprio, `vmark-journal/<document-uuid>`. O VMark nunca mexe na sua árvore de trabalho, no seu índice, no `HEAD` ou em qualquer outro branch, e não troca de branch. O branch contém um arquivo, com o nome do documento.

- **Um commit por revisão.** O autor é quem fez a edição (você ou o cliente de IA), e a data é o momento da edição.
- **Um commit de resumo por trecho de histórico podado.** O VMark poda revisões antigas para manter o histórico pequeno. Uma sequência de revisões podadas vira um único commit chamado *Collected history*, que lista todos que editaram naquele trecho.

Cada mensagem de commit termina com trailers que a ligam ao VMark:

| Trailer | Significado |
|---------|-------------|
| `VMark-Document` | A identidade do documento, a mesma em todos os commits |
| `VMark-Revision` | A revisão que este commit registra |
| `VMark-Parent` | A revisão anterior |
| `VMark-Actor` | Quem fez a edição |
| `VMark-Kind` | Como foi registrada: `controlled` (uma edição de IA pelo VMark), `observed` (um salvamento), `gap` (uma alteração feita fora do VMark) e outros |
| `VMark-Tool` | A ferramenta MCP por trás de uma edição de IA |
| `VMark-Session`, `VMark-Client` | O rótulo de sessão e o nome do cliente de IA, quando informados |
| `VMark-Collected` | Em um commit de resumo: o intervalo de revisões podadas que ele cobre |
| `VMark-Actors` | Em um commit de resumo: todos que editaram nesse intervalo, em ordem |

## Exportar de novo

Exporte quantas vezes quiser. Uma nova exportação adiciona só as revisões feitas desde a anterior; se não houver nada novo, nada muda. O mesmo histórico sempre produz os mesmos commits.

O VMark recusa, em vez de sobrescrever, quando o branch não é o que ele deixou lá:

- **O branch mudou desde a última exportação** (alguém fez commit nele, voltou-o ou reescreveu-o). Mova ou exclua o branch e exporte de novo.
- **Existe um branch com esse nome, mas ele não é a exportação do VMark deste documento.**
- **O branch está em uso** em um worktree.

## Requisitos e limites

- O Git precisa estar instalado. O VMark o procura no `PATH` do seu shell de login; se ele faltar, a exportação avisa.
- Só o histórico salvo é exportado. Edições ainda não salvas não fazem parte dele.
- O VMark cria os commits com os comandos de baixo nível do Git, então os hooks de commit não rodam. Hooks que observam atualizações de branch rodam.
- Um histórico grande leva um tempo: cada commit custa alguns processos do Git.
- Em um clone raso (shallow clone), o VMark só continua um branch que ele mesmo exportou deste computador.
- Não faça checkout do branch de exportação enquanto a exportação estiver em andamento. Um checkout depois da última verificação de worktrees pode deixar o índice e os arquivos desse worktree inconsistentes com o branch, que foi movido.
