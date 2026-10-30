# Genie del workflow

Un **genie del workflow** è un [workflow Genie](/it/guide/workflows) — una pipeline YAML multi-passaggio — salvato nella cartella dei genie come file `.yml` o `.yaml`. Compare nel selettore dei genie (`Mod + Y`) e in **Modifica → Geni** esattamente come un genie markdown; sceglierlo esegue l'intera pipeline tramite il motore dei workflow invece di inviare un singolo prompt.

## Requisiti

| Requisito | Perché |
|-------------|-----|
| **Impostazioni → Avanzate → Strumenti sviluppatore**, poi **Motore workflow** attivato | Il motore è disattivato per impostazione predefinita. Il selettore elenca comunque un genie del workflow mentre il motore è disattivato, ma eseguirlo fallisce con "Il motore dei flussi di lavoro è disattivato nelle impostazioni" |
| Un workspace aperto | I passaggi di azione come `action/save-file` risolvono i percorsi rispetto alla radice del workspace; senza un workspace, VMark mostra un toast e non avvia l'esecuzione |
| Un [provider IA](/it/guide/ai-providers) configurato | I passaggi genie chiamano il provider attivo, lo stesso usato dai genie markdown |

## Scriverne uno

Metti il file YAML in qualsiasi punto della cartella dei genie (**Modifica → Geni → Apri cartella geni**); le sottocartelle diventano categorie, come per i genie markdown. Il selettore mostra il nome del file come nome del genie e la `description` del YAML (o, in sua assenza, il suo `name`) come riga secondaria. L'ambito di un genie del workflow è l'intero documento — l'esecuzione non ha una selezione su cui lavorare — quindi ogni passaggio fornisce il proprio `with: { input: … }`, e i genie markdown che chiama lo associano al loro segnaposto `{{content}}` senza modifiche.

L'esempio incluso `triage-and-translate.yml` è un punto di partenza pronto all'uso: copialo nella cartella e sostituisci il testo iniziale. Dove si trova, lo schema YAML completo, le espressioni, le approvazioni, i modelli per passaggio e i timeout sono tutti documentati in [Flussi di lavoro Genie](/it/guide/workflows); l'esecuzione di un workflow genie avviene e le sue finestre di approvazione compaiono come di consueto, ma non mostra il grafo dei passaggi in tempo reale, non può essere annullata dal pannello Workflow (il pulsante di esecuzione del pannello segnala il motore occupato mentre è in corso) e il pannello non offre **Ripristina file** per essa.

Vedi anche [Genies IA](/it/guide/ai-genies) per il formato dei genie markdown a prompt singolo.
