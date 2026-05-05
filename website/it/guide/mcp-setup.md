# Integrazione IA (MCP)

VMark include un server MCP (Model Context Protocol) integrato che consente agli assistenti IA come Claude di interagire direttamente con il tuo editor.

## Cos'è MCP?

Il [Model Context Protocol](https://modelcontextprotocol.io/) è uno standard aperto che consente agli assistenti IA di interagire con strumenti e applicazioni esterne. Il server MCP di VMark espone le sue capacità editor come strumenti che gli assistenti IA possono usare per:

- Leggere e scrivere il contenuto del documento
- Applicare formattazione e creare strutture
- Navigare e gestire documenti
- Inserire contenuti speciali (matematica, diagrammi, wiki link)

## Configurazione Rapida

VMark semplifica la connessione degli assistenti IA con installazione in un clic.

### 1. Abilita il Server MCP

Apri **Impostazioni → Integrazioni** e abilita il Server MCP:

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-server.png" alt="Impostazioni Server MCP VMark" />
</div>

- **Abilita Server MCP** - Attiva per consentire le connessioni IA
- **Avvia all'avvio** - Avvio automatico all'apertura di VMark
- **Approva automaticamente le modifiche** - Applica le modifiche IA senza anteprima (vedi sotto)

### 2. Installa la Configurazione

Fai clic su **Installa** per il tuo assistente IA:

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-install.png" alt="Installazione Configurazione MCP VMark" />
</div>

Assistenti IA supportati:
- **Claude Desktop** - App desktop di Anthropic
- **Claude Code** - CLI per sviluppatori
- **Codex CLI** - Assistente di codifica OpenAI
- **Gemini CLI** - Assistente IA di Google

::: info Altri Client Compatibili con MCP
Altri client compatibili con MCP come Cursor, Windsurf e strumenti simili possono anche connettersi al server MCP di VMark. Configurali manualmente puntando al percorso del binario del server MCP (vedi [Configurazione Manuale](#configurazione-manuale) di seguito).
:::

#### Icone di Stato

Ogni provider mostra un indicatore di stato:

| Icona | Stato | Significato |
|-------|-------|-------------|
| ✓ Verde | Valido | La configurazione è corretta e funzionante |
| ⚠ Ambra | Percorso Non Corrispondente | VMark è stato spostato — fai clic su **Ripara** |
| ✗ Rosso | Binario Mancante | Binario MCP non trovato — reinstalla VMark |
| ○ Grigio | Non Configurato | Non installato — fai clic su **Installa** |

::: tip VMark Spostato?
Se sposti VMark.app in una posizione diversa, lo stato mostrerà ambra "Percorso Non Corrispondente". Fai semplicemente clic sul pulsante **Ripara** per aggiornare la configurazione con il nuovo percorso.
:::

### 3. Riavvia il Tuo Assistente IA

Dopo l'installazione o la riparazione, **riavvia completamente il tuo assistente IA** (esci e riapri) per caricare la nuova configurazione. VMark mostrerà un promemoria dopo ogni modifica alla configurazione.

### 4. Provalo

Nel tuo assistente IA, prova comandi come:
- *"Cosa c'è nel mio documento VMark?"*
- *"Scrivi un riassunto del calcolo quantistico su VMark"*
- *"Aggiungi un sommario al mio documento"*

## Guardalo in Azione

Fai una domanda a Claude e fallo scrivere la risposta direttamente nel tuo documento VMark:

<div class="screenshot-container">
  <img src="/screenshots/mcp-claude.png" alt="Claude Desktop che usa VMark MCP" />
  <p class="screenshot-caption">Claude Desktop chiama <code>document</code> → <code>set_content</code> per scrivere su VMark</p>
</div>

<div class="screenshot-container">
  <img src="/screenshots/mcp-result.png" alt="Contenuto renderizzato in VMark" />
  <p class="screenshot-caption">Il contenuto appare istantaneamente in VMark, completamente formattato</p>
</div>

<!-- Styles in style.css -->

## Configurazione Manuale

Se preferisci configurare manualmente, ecco le posizioni dei file di configurazione:

### Claude Desktop

Modifica `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) o `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

Modifica `~/.claude.json` o il progetto `.mcp.json`:

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

Modifica `~/.codex/config.toml`:

```toml
[mcp_servers.vmark]
command = "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
```

### Gemini CLI

Modifica `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

::: tip Trovare il Percorso del Binario
Su macOS, il binario del server MCP è all'interno di VMark.app:
- `VMark.app/Contents/MacOS/vmark-mcp-server`

Su Windows:
- `C:\Program Files\VMark\vmark-mcp-server.exe`

Su Linux:
- `/usr/bin/vmark-mcp-server` (o dove lo hai installato)

La porta viene scoperta automaticamente — nessun argomento `args` necessario.
:::

## Come Funziona

```text
Assistente IA <--stdio--> Server MCP <--WebSocket--> Editor VMark
```

1. **VMark avvia un bridge WebSocket** su una porta disponibile all'avvio
2. **Il server MCP** legge la porta e il token di autenticazione dalla directory dati dell'app VMark
3. **Il server MCP** si connette e si autentica tramite il bridge WebSocket
4. **L'assistente IA** comunica con il server MCP tramite stdio
5. **I comandi vengono inoltrati** all'editor di VMark attraverso il bridge

## Capacità Disponibili

Quando connesso, il tuo assistente IA può:

| Categoria | Capacità |
|----------|----------|
| **Documento** | Leggi/scrivi contenuto, cerca, sostituisci |
| **Selezione** | Ottieni/imposta selezione, sostituisci testo selezionato |
| **Formattazione** | Grassetto, corsivo, codice, collegamenti, e altro |
| **Blocchi** | Intestazioni, paragrafi, blocchi di codice, citazioni |
| **Elenchi** | Puntati, numerati e liste di attività |
| **Tabelle** | Inserisci, modifica righe/colonne |
| **Speciale** | Equazioni matematiche, diagrammi Mermaid, wiki link |
| **Workspace** | Apri/salva documenti, gestisci finestre |

Vedi il [Riferimento Strumenti MCP](/it/guide/mcp-tools) per la documentazione completa.

## Verifica dello Stato MCP

VMark offre diversi modi per verificare lo stato del server MCP:

### Indicatore nella Barra di Stato

La barra di stato mostra un indicatore **MCP** sul lato destro:

| Colore | Stato |
|--------|-------|
| Verde | Connesso e in esecuzione |
| Grigio | Disconnesso o fermo |
| Pulsante (animato) | In avvio |

L'avvio si completa tipicamente entro 1-2 secondi.

Fai clic sull'indicatore per aprire il dialogo di stato dettagliato.

### Dialogo di Stato

Accedi tramite **Aiuto → Stato Server MCP** o fai clic sull'indicatore nella barra di stato.

Il dialogo mostra:
- Stato della connessione (Integro / Errore / Fermo)
- Stato del bridge e porta
- Versione del server
- Strumenti disponibili (12) e risorse (4)
- Orario dell'ultimo controllo di integrità
- Elenco completo degli strumenti disponibili con pulsante copia

### Pannello Impostazioni

In **Impostazioni → Integrazioni**, quando il server è in esecuzione vedrai:
- Numero di versione
- Conteggio strumenti e risorse
- Pulsante **Test Connessione** — esegue un controllo di integrità
- Pulsante **Visualizza Dettagli** — apre il dialogo di stato

## Risoluzione dei Problemi

### "Connessione rifiutata" o "Nessun editor attivo"

- Assicurati che VMark sia in esecuzione e abbia un documento aperto
- Verifica che il Server MCP sia abilitato in Impostazioni → Integrazioni
- Verifica che il bridge MCP mostri lo stato "In esecuzione"
- Riavvia VMark se la connessione è stata interrotta

### Percorso non corrispondente dopo aver spostato VMark

Se hai spostato VMark.app in una posizione diversa (es. da Download ad Applicazioni), la configurazione punterà al vecchio percorso:

1. Apri **Impostazioni → Integrazioni**
2. Cerca l'icona di avviso ambra ⚠ accanto ai provider interessati
3. Fai clic su **Ripara** per aggiornare il percorso
4. Riavvia il tuo assistente IA

### Strumenti non visualizzati nell'assistente IA

- Riavvia il tuo assistente IA dopo aver installato la configurazione
- Verifica che la configurazione sia stata installata (controlla il segno di spunta verde nelle Impostazioni)
- Controlla i log del tuo assistente IA per errori di connessione MCP

### I comandi falliscono con "Nessun editor attivo"

- Assicurati che una scheda documento sia attiva in VMark
- Fai clic nell'area editor per mettere il focus
- Alcuni comandi richiedono che il testo sia prima selezionato

## Sistema di Suggerimenti e Approvazione Automatica

Per impostazione predefinita, quando gli assistenti IA modificano il tuo documento (inseriscono, sostituiscono o eliminano contenuto), VMark crea **suggerimenti** che richiedono la tua approvazione:

- **Inserimento** - Il nuovo testo appare come anteprima fantasma
- **Sostituzione** - Il testo originale ha il barrato, il nuovo testo come anteprima fantasma
- **Eliminazione** - Il testo da rimuovere appare con il barrato

Premi **Invio** per accettare o **Escape** per rifiutare. Questo preserva la cronologia annulla/ripristina e ti dà il controllo completo.

### Modalità Approvazione Automatica

::: warning Usa Con Cautela
Abilitare **Approva automaticamente le modifiche** bypassa l'anteprima dei suggerimenti e applica immediatamente le modifiche IA. Abilita questa opzione solo se ti fidi del tuo assistente IA e vuoi una modifica più veloce.
:::

Quando l'approvazione automatica è abilitata:
- Le modifiche vengono applicate direttamente senza anteprima
- Annulla (Mod+Z) funziona ancora per annullare le modifiche
- I messaggi di risposta includono "(auto-approvato)" per trasparenza

Questa impostazione è utile per:
- Flussi di lavoro di scrittura rapida assistita dall'IA
- Assistenti IA fidati con compiti ben definiti
- Operazioni batch in cui visualizzare in anteprima ogni modifica è impraticabile

## Note sulla Sicurezza

- Il server MCP accetta solo connessioni locali (localhost)
- Nessun dato viene inviato a server esterni
- Tutta l'elaborazione avviene sulla tua macchina
- Il bridge WebSocket è accessibile solo localmente
- L'approvazione automatica è disabilitata per impostazione predefinita per prevenire modifiche indesiderate

## Prossimi Passi

- Esplora tutti gli [Strumenti MCP](/it/guide/mcp-tools) disponibili
- Scopri le [scorciatoie da tastiera](/it/guide/shortcuts)
- Dai un'occhiata alle altre [funzionalità](/it/guide/features)
