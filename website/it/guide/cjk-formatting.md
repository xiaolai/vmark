# Guida alla Formattazione CJK

VMark include un insieme completo di regole di formattazione per testo cinese, giapponese e coreano. Questi strumenti aiutano a mantenere una tipografia coerente quando si mischiano caratteri CJK e latini.

::: info Il coreano viene volutamente lasciato invariato
Il coreano usa una propria spaziatura tra le parole, e le particelle si attaccano direttamente alla parola precedente — `VMark에는`, mai `VMark 에는`. Inserire uno spazio in quel punto è un errore grammaticale, non una preferenza tipografica, quindi **l'Hangul è escluso da ogni regola di spaziatura** e dalla conversione della punteggiatura a larghezza intera. Il testo coreano passa invariato; vengono formattati solo i caratteri Han al suo interno.
:::

## Avvio Rapido

Usa **Formato → CJK → Formatta intero file** o premi `Alt + Mod + Shift + F` per formattare l'intero documento.

**Formato → CJK → Formatta selezione** (`Mod + Shift + F`) formatta **i blocchi attraversati dalla selezione** — l'intero paragrafo, elenco o tabella toccato dal cursore o dalla selezione, non i caratteri esattamente selezionati. La spaziatura CJK è una proprietà del confine *tra* due caratteri adiacenti, e una selezione a metà parola non contiene alcun confine di questo tipo: il comando indica quindi una regione da correggere anziché il testo da riscrivere. Senza selezione formatta il blocco in cui si trova il cursore.

Entrambi i comandi proteggono esattamente le stesse cose (vedi [Contenuto protetto](#contenuto-protetto)), quindi selezionare tutto prima di `Mod + Shift + F` è sicuro.

---

## Regole di Formattazione

### 1. Spaziatura CJK-Latino

Aggiunge automaticamente spazi tra caratteri/numeri CJK e latini, inclusi i
numeri con segno (negativi, positivi, più-meno) e i numeri preceduti da un
simbolo di valuta.

| Prima | Dopo |
|-------|------|
| 学习Python编程 | 学习 Python 编程 |
| 共100个 | 共 100 个 |
| 使用macOS系统 | 使用 macOS 系统 |
| 我有-1个 | 我有 -1 个 |
| 我有+1个 | 我有 +1 个 |
| 误差±5%范围 | 误差 ±5% 范围 |
| 中文-$100元 | 中文 -$100 元 |
| 范围-100到-200 | 范围 -100 到 -200 |

I caratteri di segno riconosciuti sono `-` `+` ASCII, `－` `＋` a larghezza
intera, il segno meno Unicode `−` e il più-meno `±`. Un segno viene unito al
numero solo se è seguito da una cifra (o da un simbolo di valuta seguito da una
cifra), quindi gli identificatori CJK-latini con trattino (es. `中文-Web`) e le
frasi CJK-CJK con trattino (es. `中文-我`) restano intatti, e gli intervalli come
`5-10` vengono preservati.

**Cosa conta come CJK e cosa come latino.** Un carattere CJK è un carattere
Han, Hiragana, Katakana o Bopomofo secondo lo script Unicode. Ciò include i
blocchi Han più rari (Extension A, le estensioni del piano supplementare e gli
ideogrammi di compatibilità), il segno di iterazione `々`, lo zero ideografico
`〇`, i katakana a mezza larghezza e il segno di prolungamento `ー`. Un carattere
latino è qualsiasi lettera dell'alfabeto latino, lettere accentate comprese,
quindi entrambi i lati di una parola vengono spaziati:

| Prima | Dopo |
|-------|------|
| 中文café中文 | 中文 café 中文 |
| 中文𠀀abc | 中文𠀀 abc |
| ｶﾀｶﾅabc | ｶﾀｶﾅ abc |
| 日本・東京 | 日本・東京 |

Le lettere latine a larghezza intera (`Ａ`) hanno già una propria spaziatura e
non vengono mai spaziate. Il punto centrale katakana `・` è punteggiatura, non
una lettera, quindi accanto a esso non viene aggiunto alcuno spazio.

**Collegamenti.** La parentesi di chiusura di un collegamento viene separata da
uno spazio dal testo CJK che la segue solo quando il testo visibile del
collegamento termina con una lettera latina o una cifra — è lo stacco che vede
chi legge. `参见[link](https://x.com)中文` diventa
`参见[link](https://x.com) 中文`; `参见[中文](https://x.com)中文` resta invariato.

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

Converte le parentesi a mezza larghezza in parentesi a larghezza intera quando circondano contenuto CJK. Entrambe le parentesi devono trovarsi nello stesso paragrafo: separate da una riga vuota restano come sono state digitate.

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
| 他说"hello" | 他说 “hello” |
| "don't worry" | “don't worry” |
| 5'10" tall | 5'10" tall |

Le virgolette curve prendono uno spazio accanto al testo CJK: `他说"hello"` diventa `他说 “hello”`. Le virgolette angolari (`「 」`, `『 』`) e la punteggiatura finale non ne prendono mai. Per mantenere le virgolette curve strette, disattiva **Correggi spaziatura virgolette doppie** o **Correggi spaziatura virgolette singole** in Impostazioni → Lingua → Formattazione CJK: `“ ”` e `‘ ’` sono a larghezza intera nel contesto CJK, e GB/T 15834 e JLREQ considerano il margine parte del glifo — è proprio per questo che esistono questi interruttori.

Con l'opzione parentesi a forcella abilitata:

| Prima | Dopo |
|-------|------|
| "中文内容" | 「中文内容」 |
| 「包含'嵌套'」 | 「包含『嵌套』」 |

### 7. Normalizzazione dei Puntini di Sospensione

Standardizza la formattazione dei puntini di sospensione, nella forma usata dalla scrittura circostante. Non esiste un'unica risposta corretta: il cinese (GB/T 15834) e il giapponese (JIS X 4051) usano i puntini di sospensione a sei punti `……` e **non** vogliono uno spazio dopo, il coreano usa `…`, e solo il testo latino usa `...` seguito da uno spazio.

| Prima | Dopo |
|-------|------|
| 等等. . . | 等等…… |
| 然后...继续 | 然后……继续 |
| そして...続く | そして……続く |
| 그리고...계속 | 그리고…계속 |
| wait...ok | wait... ok |

La scrittura viene decisa in base ai caratteri immediatamente accanto ai puntini, non in base al documento, quindi `...` all'interno di una citazione inglese in un file cinese mantiene la forma latina.

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
- Unione di valute e unità: `$ 100` → `$100`, `100 %` → `100%`. Vengono rimossi solo spazi e tabulazioni: un numero alla fine di una riga o di un paragrafo non viene mai unito a un'unità o a una valuta sulla riga successiva, e uno spazio indivisibile che hai digitato tra un numero e la sua unità viene mantenuto

---

## Contenuto Protetto

Il seguente contenuto **non** è interessato dalla formattazione:

- Blocchi di codice (```) — inclusa una recinzione **non chiusa**, che occupa il resto del documento, come previsto da CommonMark
- Codice inline (`)
- URL dei collegamenti
- Percorsi delle immagini
- Tag HTML
- Frontmatter — sia YAML (`---`) sia TOML (`+++`)
- Matematica inline (`$…$`), riconosciuta con la stessa regola usata dal renderer di VMark, così che una coppia di importi come `价格是 $100 和 $200 元` *non* venga scambiata per matematica
- Matematica in blocco (`$$…$$`)
- Blocchi di codice indentati
- Wiki link (`[[target]]`, `[[target|display]]`)
- Marcatori delle note a piè di pagina — riferimenti come `[^1]` e l'etichetta `[^1]:` di una definizione (il testo della definizione viene formattato)
- Riferimenti a caratteri HTML (`&amp;`, `&#x5176;`)
- Interruzioni tematiche (`---`, `***`)
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

- `"cjk-format"` — normalizzazione CJK completa (spaziatura + punteggiatura + virgolette tipografiche), lo stesso formattatore eseguito dal comando di menu, secondo le tue impostazioni in Impostazioni → Lingua
- `"cjk-spacing"` — inserisce uno spazio ovunque un carattere CJK incontri una lettera latina o una cifra, e nient'altro
- `"cjk-punctuation"` — converte `,` `.` `!` `?` `;` `:` `(` `)` a mezza larghezza accanto a un carattere CJK nella loro forma a larghezza intera; non converte mai dalla larghezza intera alla mezza larghezza

Solo `cjk-format` legge le tue impostazioni di formattazione. `cjk-spacing` e `cjk-punctuation` sono regole fisse che le ignorano e, a differenza del formattatore, trattano come CJK anche l'Hangul coreano. Tutte e tre operano sul sorgente markdown del documento e lasciano intatto il [contenuto protetto](#contenuto-protetto).

Consulta il [Riferimento Strumenti MCP](/it/guide/mcp-tools#transform) per la forma completa della richiesta — `document.transform` accetta `tabId`, `kind` e un `expected_revision` per la concorrenza ottimistica.

## Configurazione

Le opzioni di formattazione CJK possono essere configurate in Impostazioni → Lingua:

- Abilita/disabilita regole specifiche
- Imposta il limite di ripetizione della punteggiatura
- Scegli lo stile delle virgolette (standard o parentesi a forcella)

### Virgolette Contestuali

Quando **Virgolette contestuali** è abilitato (predefinito):

- Virgolette intorno al contenuto CJK → virgolette curve `""`
- Virgolette intorno al contenuto puramente latino → virgolette dritte `""`

Questo preserva l'aspetto naturale del testo inglese formattando correttamente il contenuto CJK.

### Parentesi a forcella CJK *(disattivato per impostazione predefinita)*

Quando **Virgolette ad angolo CJK** è abilitato, le virgolette curve attorno al contenuto CJK vengono convertite in parentesi a forcella (`「」` per primarie, `『』` per annidate) — la forma di citazione tipograficamente tradizionale per la composizione tipografica CJK verticale. Il contenuto latino mantiene le virgolette curve standard indipendentemente da questa impostazione.

### Salto della sezione di riferimenti

Quando **Salta le sezioni di riferimento** è abilitato in Impostazioni → Lingua → Gestione delle sezioni (disattivato per impostazione predefinita), il formattatore CJK rileva le intestazioni «References» / «Further Reading» / «参考文献» / «参考资料» / «Bibliography» e salta la riformattazione in quelle sezioni — il testo formattato per le citazioni si basa spesso su una punteggiatura specifica che le regole CJK normalizzerebbero altrimenti. Attivalo per i documenti accademici; lascialo disattivato per formattare l'intero file.

### Verifica di integrità

Dopo ogni passaggio di formattazione CJK, il formattatore confronta lo **scheletro del contenuto** del documento prima e dopo: il testo privato di spazi e punteggiatura e con la larghezza dei caratteri normalizzata. Tutte le regole di formattazione modificano soltanto spazi, punteggiatura o la larghezza di un carattere alfanumerico, quindi quello scheletro deve tornare identico — e, trattandosi di una sequenza e non di un conteggio, anche il contenuto riordinato non supera il controllo. Contano lettere, cifre, ideogrammi, kana, hangul ed emoji.

Se il controllo fallisce, il documento resta **completamente immutato** e una notifica te lo comunica. Un rifiuto non è mai silenzioso e non viene mai confuso con «non c'era nulla da cambiare».

---

## Spaziatura tra Lettere CJK

VMark include una funzione dedicata di spaziatura tra lettere per il testo CJK che migliora la leggibilità aggiungendo una spaziatura sottile tra i caratteri.

### Impostazioni

Configura in **Impostazioni → Editor → Tipografia → Spaziatura lettere CJK**:

| Opzione | Valore | Descrizione |
|---------|--------|-------------|
| Off | 0 | Nessuna spaziatura (predefinito) |
| Sottile | 0.02em | Spaziatura appena percettibile |
| Leggera | 0.03em | Spaziatura leggera |
| Normale | 0.05em | Consigliata per la maggior parte dei casi |
| Ampia | 0.08em | Spaziatura più pronunciata |
| Più ampia | 0.10em | Ancora più ampia, per dimensioni di visualizzazione grandi |
| Extra | 0.12em | L'impostazione più ampia |

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
6. **Pulizia Virgolette Solitarie**: Gestisce le virgolette senza corrispondenza con grazia; una virgoletta ancora aperta alla fine di un paragrafo resta senza coppia, quindi le virgolette non si accoppiano mai attraverso una riga vuota

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

Puoi cambiare rapidamente lo stile delle virgolette esistenti senza riformattare l'intero documento. Posiziona il cursore all'interno di qualsiasi coppia di virgolette e premi `Shift + Mod + '` per cambiare. Funziona solo in modalità WYSIWYG; la modalità Sorgente non ha un comando per alternare le virgolette.

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
Passa tra la modalità semplice e quella a ciclo completo in Impostazioni → Lingua → Formattazione CJK → Comportamento del cambio virgolette.
:::

### Configurazione

Abilita la Conversione Virgolette Tipografiche in Impostazioni → Lingua → Formattazione CJK. Puoi anche selezionare il tuo stile di virgolette preferito dal menu a discesa.

---

## Conversione Parentesi a Forcella CJK

Quando **Virgolette ad angolo CJK** è abilitato, le virgolette curve intorno al contenuto CJK vengono automaticamente convertite in parentesi a forcella.

### Caratteri Supportati

La conversione delle parentesi a forcella si attiva quando il contenuto citato
— o il testo immediatamente accanto — è Han, Hiragana, Katakana o Bopomofo:

| Tipo di Contenuto | Esempio | Converte? |
|-------------------|---------|-----------|
| Cinese | `"中文"` | ✓ `「中文」` |
| Giapponese con Kanji | `"日本語"` | ✓ `「日本語」` |
| Solo Hiragana | `"ひらがな"` | ✓ `「ひらがな」` |
| Solo Katakana | `"カタカナ"` | ✓ `「カタカナ」` |
| Coreano | `"한글"` | ✗ rimane `"한글"` |
| Inglese | `"hello"` | ✗ rimane `"hello"` |

Il coreano è escluso per lo stesso motivo delle regole di spaziatura: il coreano usa `“ ”`,
non le parentesi a forcella.

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

学习过程中遇到的最大挑战是 —— 状态管理。Redux 的概念……说实话有点难理解。后来换成了 Zustand，简单多了！

老师说 “don't give up” 然后继续讲 “写代码要注重可读性”，我觉得很有道理。

访问 https://example.com/docs 获取 v2.0.0 版本文档，价格 $99.99，时间 12:30 开始。

项目使用的技术栈如下：

- **Frontend**--React + TypeScript
- **Backend**--Node.js + Express
- **Database**--PostgreSQL

总共花费大约 $200 美元购买了学习资源，包括书籍和 online courses。虽然价格不便宜，但非常值得。

---

**Modifiche applicate:**
- Spaziatura CJK-Latino aggiunta (学习 TypeScript)
- Punteggiatura a larghezza intera convertita (，。！)
- Numeri a larghezza intera normalizzati (３→3, １０００→1000, ２００→200)
- Doppi trattini convertiti in em-dash (是--状态 → 是 —— 状态)
- Puntini di sospensione normalizzati nella forma cinese, senza spazio dopo (. . . → ……)
- Virgolette tipografiche applicate con spazio accanto al testo CJK, apostrofo preservato (don't)
- Costrutti tecnici protetti (https://example.com/docs, v2.0.0, $99.99, 12:30)

**E cosa _non_ cambia:** il `--` in `**Frontend**--React` resta un doppio
trattino. La conversione dei trattini richiede un carattere CJK o un carattere
alfanumerico immediatamente accanto ai trattini, e `*` non è né l'uno né
l'altro. Attivarla anche sui marcatori di enfasi convertirebbe il `--` in ogni
voce di elenco puramente inglese di un documento cinese, il che è peggio che
lasciare invariati questi tre.
