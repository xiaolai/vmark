# Utenti come Sviluppatori

Nell'era degli strumenti di codifica IA, il confine tra "utente" e "sviluppatore" sta scomparendo. Se riesci a descrivere un bug, puoi risolverlo. Se riesci a immaginare una funzionalità, puoi costruirla — con un assistente IA che già comprende il codebase.

VMark abbraccia questa filosofia. Il repo viene fornito con regole di progetto, documentazione dell'architettura e convenzioni pre-caricate per gli strumenti di codifica IA. Clona il repo, apri il tuo assistente IA e inizia a contribuire — l'IA conosce già come funziona VMark.

## Per Iniziare

1. **Clona il repo** — La configurazione IA è già in place.
2. **Installa il tuo strumento IA** — [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex), o [Gemini CLI](https://github.com/google-gemini/gemini-cli).
3. **Apri una sessione** — Lo strumento legge `AGENTS.md` e le regole automaticamente.
4. **Inizia a programmare** — L'IA conosce le convenzioni del progetto, i requisiti di test e i pattern architetturali.

Non è necessaria alcuna configurazione aggiuntiva. Inizia semplicemente a chiedere al tuo IA di aiutare.

## Guida alla Lettura

Nuovo allo sviluppo assistito dall'IA? Queste pagine si costruiscono l'una sull'altra:

1. **[Perché Ho Costruito VMark](/it/guide/users-as-developers/why-i-built-vmark)** — Il viaggio di un non-programmatore dagli script a un'app desktop
2. **[Cinque Abilità Umane Fondamentali che Potenziano l'IA](/it/guide/users-as-developers/what-are-indispensable)** — Git, TDD, alfabetizzazione terminale, inglese e gusto — le fondamenta su cui tutto il resto si costruisce
3. **[Perché i Modelli Costosi Sono Più Economici](/it/guide/users-as-developers/why-expensive-models-are-cheaper)** — Il prezzo per token è una metrica di vanità; il costo per attività è ciò che conta
4. **[Abbonamento vs Prezzi API](/it/guide/users-as-developers/subscription-vs-api)** — Perché gli abbonamenti a tariffa fissa battono il pagamento per token per le sessioni di codifica
5. **[I Prompt in Inglese Funzionano Meglio](/it/guide/users-as-developers/prompt-refinement)** — Traduzione, raffinamento e il gancio `::`
6. **[Verifica Cross-Model](/it/guide/users-as-developers/cross-model-verification)** — Usare Claude + Codex per auditarsi a vicenda per un codice migliore
7. **[Perché Issue, Non PR](/it/guide/users-as-developers/why-issues-not-prs)** — Perché accettiamo issue ma non pull request in un codebase mantenuto dall'IA
8. **[Valutazione di costi e impegno](/it/guide/users-as-developers/cost-evaluation)** — Quanto costerebbe costruire VMark con un team umano vs. la realtà dello sviluppo assistito dall'IA

Già familiare con le basi? Salta direttamente a [Verifica Cross-Model](/it/guide/users-as-developers/cross-model-verification) per il flusso di lavoro avanzato, o continua a leggere per capire come funziona la configurazione IA di VMark sotto il cofano.

## Un File, Ogni Strumento

Gli strumenti di codifica IA leggono ognuno il proprio file di configurazione:

| Strumento | File di configurazione |
|-----------|----------------------|
| Claude Code | `CLAUDE.md` |
| Codex CLI | `AGENTS.md` |
| Gemini CLI | `GEMINI.md` |

Mantenere le stesse istruzioni in tre posti è soggetto a errori. VMark risolve questo con un'unica fonte di verità:

- **`AGENTS.md`** — Contiene tutte le regole del progetto, le convenzioni e le note sull'architettura.
- **`CLAUDE.md`** — Solo una riga: `@AGENTS.md` (una direttiva Claude Code che include il file in linea).
- **Codex CLI** — Legge `AGENTS.md` direttamente.
- **Gemini CLI** — Usa `@AGENTS.md` in `GEMINI.md` per includere in linea lo stesso file.

Aggiorna `AGENTS.md` una volta, ogni strumento raccoglie la modifica.

::: tip Cos'è `@AGENTS.md`?
Il prefisso `@` è una direttiva Claude Code che include il contenuto di un altro file in linea. È simile a `#include` in C — i contenuti di `AGENTS.md` vengono inseriti in `CLAUDE.md` in quella posizione. Scopri di più su [agents.md](https://agents.md/).
:::

## Usare Codex come Seconda Opinione

VMark usa la verifica cross-model — Claude scrive il codice, poi Codex (un modello IA diverso di OpenAI) lo audita indipendentemente. Questo individua i punti ciechi che un singolo modello potrebbe perdere. Per i dettagli completi e le istruzioni di configurazione, vedi [Verifica Cross-Model](/it/guide/users-as-developers/cross-model-verification).

## Cosa Sa l'IA

Quando uno strumento di codifica IA apre il repo VMark, riceve automaticamente:

### Regole del Progetto (`.claude/rules/`)

Questi file vengono caricati automaticamente in ogni sessione Claude Code. Coprono:

| Regola | Cosa applica |
|--------|-------------|
| Flusso di lavoro TDD | Il test-first è obbligatorio; le soglie di copertura bloccano la build |
| Token di Design | Mai hardcode i colori — incluso il riferimento completo ai token CSS |
| Pattern Componenti | Pattern popup, toolbar, menu contestuale con esempi di codice |
| Indicatori di Focus | Accessibilità: il focus della tastiera deve essere sempre visibile |
| Tema Scuro | Regole del selettore `.dark-theme`, requisiti di parità dei token |
| Scorciatoie da Tastiera | Procedura di sincronizzazione a tre file (Rust, TypeScript, docs) |
| Bump di Versione | Procedura di aggiornamento a cinque file |
| Convenzioni del Codebase | Pattern di store, hook, plugin, test e import |

### Skill Personalizzate

I comandi slash danno all'IA capacità specializzate:

| Comando | Cosa fa |
|---------|---------|
| `/fix` | Risolve i problemi correttamente — analisi della causa radice, TDD, nessuna patch |
| `/fix-issue` | Risolutore end-to-end di issue GitHub (fetch, branch, fix, audit, PR) |
| `/codex-audit` | Audit completo del codice a 9 dimensioni (sicurezza, correttezza, conformità, ...) |
| `/codex-audit-mini` | Controllo rapido a 5 dimensioni per piccole modifiche |
| `/codex-verify` | Verifica le correzioni da un audit precedente |
| `/codex-commit` | Messaggi di commit intelligenti dall'analisi delle modifiche |
| `/audit-fix` | Audit, correggi tutti i risultati, verifica — ripeti fino a quando è pulito |
| `/feature-workflow` | Flusso di lavoro end-to-end con agenti specializzati |
| `/merge-prs` | Revisiona e unisci le PR aperte sequenzialmente |
| `/bump` | Bump di versione su tutti i 5 file, commit, tag, push |

### Agenti Specializzati

Per compiti complessi, Claude Code può delegare ad agenti secondari focalizzati:

| Agente | Ruolo |
|--------|-------|
| Pianificatore | Ricerca le best practice, fa brainstorming sui casi limite, produce piani modulari |
| Implementatore | Implementazione guidata da TDD con indagine preflight |
| Auditor | Revisiona i diff per correttezza e violazioni delle regole |
| Test Runner | Esegue i gate, coordina i test E2E tramite Tauri MCP |
| Verificatore | Lista di controllo finale prima del rilascio |

## Override Privati

Non tutto appartiene alla configurazione condivisa. Per le preferenze personali:

| File | Condiviso? | Scopo |
|------|-----------|-------|
| `AGENTS.md` | Sì | Regole del progetto per tutti gli strumenti IA |
| `CLAUDE.md` | Sì | Punto di ingresso Claude Code |
| `.claude/settings.json` | Sì | Permessi condivisi del team |
| `CLAUDE.local.md` | **No** | Le tue istruzioni personali (gitignored) |
| `.claude/settings.local.json` | **No** | Le tue impostazioni personali (gitignored) |

Crea `CLAUDE.local.md` nella radice del progetto per le istruzioni che si applicano solo a te — lingua preferita, abitudini di flusso di lavoro, preferenze degli strumenti.
