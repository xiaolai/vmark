# Guida alla Formattazione CJK

VMark include un insieme completo di regole di formattazione per testo cinese, giapponese e coreano. Questi strumenti aiutano a mantenere una tipografia coerente quando si mischiano caratteri CJK e latini.

## Avvio Rapido

Usa **Formato → Formatta Documento CJK** o premi `Alt + Mod + Shift + F` per formattare l'intero documento.

Per formattare solo una selezione, usa `Mod + Shift + F`.

---

## Regole di Formattazione

### 1. Spaziatura CJK-Latino

Aggiunge automaticamente spazi tra caratteri/numeri CJK e latini.

| Prima | Dopo |
|-------|------|
| 学习Python编程 | 学习 Python 编程 |
| 共100个 | 共 100 个 |
| 使用macOS系统 | 使用 macOS 系统 |

### 2. Punteggiatura a Larghezza Intera

Converte la punteggiatura a mezza larghezza in punteggiatura a larghezza intera nel contesto CJK.

| Prima | Dopo |
|-------|------|
| 你好,世界 | 你好，世界 |
| 什么? | 什么？ |
| 注意:重要 | 注意：重要 |

### 3. Conversione Caratteri a Larghezza Intera

Converte lettere e numeri a larghezza intera in mezza larghezza.

| Prima | Dopo |
|-------|------|
| １２３４ | 1234 |
| ＡＢＣ | ABC |

### 4. Conversione Parentesi

Converte le parentesi a mezza larghezza in parentesi a larghezza intera quando circondano contenuto CJK.

| Prima | Dopo |
|-------|------|
| (注意) | （注意） |
| [重点] | 【重点】 |
| (English) | (English) |

### 5. Conversione Trattini

Converte i doppi trattini in trattini CJK corretti.

| Prima | Dopo |
|-------|------|
| 原因--结果 | 原因 —— 结果 |
| 说明--这是 | 说明 —— 这是 |

### 6. Conversione Virgolette Tipografiche

VMark usa un **algoritmo di abbinamento virgolette basato su stack** che gestisce correttamente:

- **Apostrofi**: Le contrazioni come `don't`, `it's`, `l'amour` vengono preservate
- **Possessivi**: `Xiaolai's` rimane invariato
- **Apici**: Le misure come `5'10"` (piedi/pollici) vengono preservate
- **Decenni**: Le abbreviazioni come `'90s` vengono riconosciute
- **Rilevamento contesto CJK**: Le virgolette intorno al contenuto CJK ricevono virgolette curve/a forcella

| Prima | Dopo |
|-------|------|
| 他说"hello" | 他说 "hello" |
| "don't worry" | "don't worry" |
| 5'10" tall | 5'10" tall |

Con l'opzione parentesi a forcella abilitata:

| Prima | Dopo |
|-------|------|
| "中文内容" | 「中文内容」 |
| 「包含'嵌套'」 | 「包含『嵌套』」 |

### 7. Normalizzazione dei Puntini di Sospensione

Standardizza la formattazione dei puntini di sospensione.

| Prima | Dopo |
|-------|------|
| 等等. . . | 等等... |
| 然后. . .继续 | 然后... 继续 |

### 8. Punteggiatura Ripetuta

Limita i segni di punteggiatura consecutivi (limite configurabile).

| Prima | Dopo (limite=1) |
|-------|-----------------|
| 太棒了！！！ | 太棒了！ |
| 真的吗？？？ | 真的吗？ |

### 9. Altre Pulizie

- Spazi multipli compressi: `多个   空格` → `多个 空格`
- Spazi finali rimossi
- Spaziatura barre: `A / B` → `A/B`
- Spaziatura valute: `$ 100` → `$100`

---

## Contenuto Protetto

Il seguente contenuto **non** è interessato dalla formattazione:

- Blocchi di codice (```)
- Codice inline (`)
- URL dei collegamenti
- Percorsi delle immagini
- Tag HTML
- Frontmatter YAML
- Punteggiatura con escape backslash (es. `\,` rimane come `,`)

### Costrutti Tecnici

Lo **Scanner di Sequenze Latine** di VMark rileva e protegge automaticamente i costrutti tecnici dalla conversione della punteggiatura:

| Tipo | Esempi | Protezione |
|------|--------|------------|
| URL | `https://example.com` | Tutta la punteggiatura preservata |
| Email | `user@example.com` | @ e . preservati |
| Versioni | `v1.2.3`, `1.2.3.4` | Punti preservati |
| Decimali | `3.14`, `0.5` | Punto preservato |
| Orari | `12:30`, `1:30:00` | Due punti preservati |
| Migliaia | `1,000`, `1,000,000` | Virgole preservate |
| Domini | `example.com` | Punto preservato |

Esempio:

| Prima | Dopo |
|-------|------|
| 版本v1.2.3发布 | 版本 v1.2.3 发布 |
| 访问https://example.com获取 | 访问 https://example.com 获取 |
| 温度是3.14度 | 温度是 3.14 度 |

### Escape Backslash

Prefissa qualsiasi punteggiatura con `\` per impedirne la conversione:

| Input | Output |
|-------|--------|
| `价格\,很贵` | 价格,很贵 (la virgola rimane a mezza larghezza) |
| `测试\.内容` | 测试.内容 (il punto rimane a mezza larghezza) |

---

## Formattazione Assistita dall'IA

Quando il [server MCP](/it/guide/mcp-setup) è connesso, gli assistenti IA possono applicare la formattazione CJK in modo programmatico tramite lo strumento `document.transform` con uno dei tre valori `kind`:

- `"cjk-format"` — normalizzazione CJK completa (spaziatura + punteggiatura + virgolette tipografiche secondo le tue impostazioni)
- `"cjk-spacing"` — regola solo gli spazi bianchi attorno ai confini CJK ↔ Latino/cifre
- `"cjk-punctuation"` — converte la punteggiatura tra larghezza intera e mezza larghezza secondo le regole

Ogni trasformazione esegue il documento attivo attraverso un percorso di andata e ritorno serializzazione-formattazione-analisi per preservare le marcature inline (grassetto, collegamenti, matematica, ecc.) e rispettare le regole di formattazione configurate.

Consulta il [Riferimento Strumenti MCP](/it/guide/mcp-tools#document-tool) per la forma completa della richiesta — `document.transform` accetta `tabId`, `kind` e un `expected_revision` per la concorrenza ottimistica.

## Configurazione

Le opzioni di formattazione CJK possono essere configurate in Impostazioni → Lingua:

- Abilita/disabilita regole specifiche
- Imposta il limite di ripetizione della punteggiatura
- Scegli lo stile delle virgolette (standard o parentesi a forcella)

### Virgolette Contestuali

Quando le **Virgolette Contestuali** sono abilitate (predefinito):

- Virgolette intorno al contenuto CJK → virgolette curve `""`
- Virgolette intorno al contenuto puramente latino → virgolette dritte `""`

Questo preserva l'aspetto naturale del testo inglese formattando correttamente il contenuto CJK.

### Parentesi a forcella CJK *(disattivato per impostazione predefinita)*

Quando **Virgolette a forcella CJK** è abilitato, le virgolette curve attorno al contenuto CJK vengono convertite in parentesi a forcella (`「」` per primarie, `『』` per annidate) — la forma di citazione tipograficamente tradizionale per la composizione tipografica CJK verticale. Il contenuto latino mantiene le virgolette curve standard indipendentemente da questa impostazione.

### Salto della sezione di riferimenti

Il formattatore CJK rileva le intestazioni «References» / «参考文献» / «参考资料» / «Bibliography» e salta la riformattazione in quelle sezioni — il testo formattato per le citazioni si basa spesso su una punteggiatura specifica che le regole CJK normalizzerebbero altrimenti.

### Verifica di integrità

Dopo ogni passaggio di formattazione CJK, il formattatore esegue un controllo di integrità che confronta il contenuto del testo visibile (ignorando le trasformazioni di spazi bianchi/punteggiatura) prima e dopo. Se il controllo fallisce, l'operazione viene annullata e appare una diagnostica — garantisce che la formattazione CJK non perda mai silenziosamente contenuto.

---

## Spaziatura tra Lettere CJK

VMark include una funzione dedicata di spaziatura tra lettere per il testo CJK che migliora la leggibilità aggiungendo una spaziatura sottile tra i caratteri.

### Impostazioni

Configura in **Impostazioni → Editor → Tipografia → Spaziatura tra Lettere CJK**:

| Opzione | Valore | Descrizione |
|---------|--------|-------------|
| Off | 0 | Nessuna spaziatura (predefinito) |
| Sottile | 0.02em | Spaziatura appena percettibile |
| Leggera | 0.03em | Spaziatura leggera |
| Normale | 0.05em | Consigliata per la maggior parte dei casi |
| Ampia | 0.08em | Spaziatura più pronunciata |

### Come Funziona

- Applica il CSS letter-spacing alle sequenze di caratteri CJK
- Esclude i blocchi di codice e il codice inline
- Funziona sia in WYSIWYG che nell'HTML esportato
- Nessun effetto sul testo latino o sui numeri

### Esempio

Senza spaziatura tra lettere:
> 这是一段中文文字，没有任何字间距。

Con spaziatura tra lettere di 0.05em:
> 这 是 一 段 中 文 文 字 ， 有 轻 微 的 字 间 距 。

La differenza è sottile ma migliora la leggibilità, specialmente per i passaggi più lunghi.

---

## Stili di Virgolette Tipografiche

VMark può convertire automaticamente le virgolette dritte in virgolette tipograficamente corrette. Questa funzione funziona durante la formattazione CJK e supporta più stili di virgolette.

### Stili di Virgolette

| Stile | Virgolette Doppie | Virgolette Singole |
|-------|-------------------|-------------------|
| Curve | "testo" | 'testo' |
| Parentesi a Forcella | 「testo」 | 『testo』 |
| Guillemets | «testo» | ‹testo› |

### Algoritmo di Abbinamento Basato su Stack

VMark usa un sofisticato algoritmo basato su stack per l'abbinamento delle virgolette:

1. **Tokenizzazione**: Identifica tutti i caratteri virgoletta nel testo
2. **Classificazione**: Determina se ogni virgoletta è di apertura o di chiusura in base al contesto
3. **Rilevamento Apostrofi**: Riconosce le contrazioni (don't, it's) e le preserva
4. **Rilevamento Apici**: Riconosce le misure (5'10") e le preserva
5. **Rilevamento Contesto CJK**: Verifica se il contenuto citato coinvolge caratteri CJK
6. **Pulizia Virgolette Solitarie**: Gestisce le virgolette senza corrispondenza con grazia

### Esempi

| Prima | Dopo (Curve) |
|-------|--------------|
| "hello" | "hello" |
| 'world' | 'world' |
| it's | it's |
| don't | don't |
| 5'10" | 5'10" |
| '90s | '90s |

Gli apostrofi nelle contrazioni (come "it's" o "don't") vengono preservati correttamente.

### Attiva/Disattiva Stile Virgolette al Cursore

Puoi cambiare rapidamente lo stile delle virgolette esistenti senza riformattare l'intero documento. Posiziona il cursore all'interno di qualsiasi coppia di virgolette e premi `Shift + Mod + '` per cambiare.

**Modalità semplice** (predefinita): Alterna tra virgolette dritte e il tuo stile preferito.

| Prima | Dopo | Dopo ancora |
|-------|------|-------------|
| "hello" | "hello" | "hello" |
| 'world' | 'world' | 'world' |

**Modalità ciclo completo**: Scorre tutti e quattro gli stili.

| Passo | Doppie | Singole |
|-------|--------|---------|
| 1 | "testo" | 'testo' |
| 2 | "testo" | 'testo' |
| 3 | 「testo」 | 『testo』 |
| 4 | «testo» | ‹testo› |
| 5 | "testo" (ritorno all'inizio) | 'testo' |

**Virgolette annidate**: Quando le virgolette sono annidate, il comando alterna la coppia **più interna** che racchiude il cursore.

**Rilevamento intelligente**: Gli apostrofi (`don't`), gli apici (`5'10"`) e le abbreviazioni di decennio (`'90s`) non vengono mai trattati come coppie di virgolette.

::: tip
Passa tra la modalità semplice e quella a ciclo completo in Impostazioni → Lingua → Formattazione CJK → Modalità Alternanza Virgolette.
:::

### Configurazione

Abilita la Conversione Virgolette Tipografiche in Impostazioni → Lingua → Formattazione CJK. Puoi anche selezionare il tuo stile di virgolette preferito dal menu a discesa.

---

## Conversione Parentesi a Forcella CJK

Quando le **Virgolette a Forcella CJK** sono abilitate, le virgolette curve intorno al contenuto CJK vengono automaticamente convertite in parentesi a forcella.

### Caratteri Supportati

La conversione delle parentesi a forcella si attiva quando il contenuto citato contiene **caratteri cinesi** (CJK Unified Ideographs U+4E00–U+9FFF):

| Tipo di Contenuto | Esempio | Converte? |
|-------------------|---------|-----------|
| Cinese | `"中文"` | ✓ `「中文」` |
| Giapponese con Kanji | `"日本語"` | ✓ `「日本語」` |
| Solo Hiragana | `"ひらがな"` | ✗ rimane `"ひらがな"` |
| Solo Katakana | `"カタカナ"` | ✗ rimane `"カタカナ"` |
| Coreano | `"한글"` | ✗ rimane `"한글"` |
| Inglese | `"hello"` | ✗ rimane `"hello"` |

**Suggerimento:** Per il testo giapponese con solo Kana, usa manualmente le parentesi a forcella `「」` o includi almeno un carattere Kanji.

---

## Paragrafo di Test

Copia questo testo non formattato in VMark e premi `Alt + Mod + Shift + F` per formattare:

```text
最近我在学习TypeScript和React,感觉收获很大.作为一个developer,掌握这些modern前端技术是必须的.

目前已经完成了３个projects,代码量超过１０００行.其中最复杂的是一个dashboard应用,包含了数据可视化,用户认证,还有API集成等功能.

学习过程中遇到的最大挑战是--状态管理.Redux的概念. . .说实话有点难理解.后来换成了Zustand,简单多了!

老师说"don't give up"然后继续讲"写代码要注重可读性",我觉得很有道理.

访问https://example.com/docs获取v2.0.0版本文档,价格$99.99,时间12:30开始.

项目使用的技术栈如下:

- **Frontend**--React + TypeScript
- **Backend**--Node.js + Express
- **Database**--PostgreSQL

总共花费大约$２００美元购买了学习资源,包括书籍和online courses.虽然价格不便宜,但非常值得.
```

### Risultato Atteso

Dopo la formattazione, il testo apparirà così:

---

最近我在学习 TypeScript 和 React，感觉收获很大。作为一个 developer，掌握这些 modern 前端技术是必须的。

目前已经完成了 3 个 projects，代码量超过 1000 行。其中最复杂的是一个 dashboard 应用，包含了数据可视化，用户认证，还有 API 集成等功能。

学习过程中遇到的最大挑战是 —— 状态管理。Redux 的概念... 说实话有点难理解。后来换成了 Zustand，简单多了！

老师说 "don't give up" 然后继续讲 "写代码要注重可读性"，我觉得很有道理。

访问 https://example.com/docs 获取 v2.0.0 版本文档，价格 $99.99，时间 12:30 开始。

项目使用的技术栈如下：

- **Frontend** —— React + TypeScript
- **Backend** —— Node.js + Express
- **Database** —— PostgreSQL

总共花费大约 $200 美元购买了学习资源，包括书籍和 online courses。虽然价格不便宜，但非常值得。

---

**Modifiche applicate:**
- Spaziatura CJK-Latino aggiunta (学习 TypeScript)
- Punteggiatura a larghezza intera convertita (，。！)
- Numeri a larghezza intera normalizzati (３→3, １０００→1000, ２００→200)
- Doppi trattini convertiti in em-dash (-- → ——)
- Puntini di sospensione normalizzati (. . . → ...)
- Virgolette tipografiche applicate, apostrofo preservato (don't)
- Costrutti tecnici protetti (https://example.com/docs, v2.0.0, $99.99, 12:30)
