# CJK-Formatierungshandbuch

VMark enthält einen umfassenden Satz von Formatierungsregeln für chinesischen, japanischen und koreanischen Text. Diese Tools helfen dabei, eine konsistente Typografie beim Mischen von CJK- und lateinischen Zeichen beizubehalten.

::: info Koreanisch wird bewusst nicht angetastet
Koreanisch verwendet native Wortabstände, und Partikeln hängen direkt am vorangehenden Wort — `VMark에는`, niemals `VMark 에는`. Dort ein Leerzeichen einzufügen ist ein Grammatikfehler, keine typografische Vorliebe, daher ist **Hangul von jeder Abstandsregel** und von der Umwandlung in vollbreite Interpunktion **ausgenommen**. Koreanischer Text bleibt unverändert; nur Han-Zeichen darin werden formatiert.
:::

## Schnellstart

Verwenden Sie **Format → CJK → Gesamte Datei formatieren** oder drücken Sie `Alt + Mod + Umschalt + F`, um das gesamte Dokument zu formatieren.

**Format → CJK → Auswahl formatieren** (`Mod + Umschalt + F`) formatiert **die Blöcke, die Ihre Auswahl umfasst** — den gesamten Absatz, die Liste oder die Tabelle, die der Cursor oder die Auswahl berührt, nicht die exakt ausgewählten Zeichen. CJK-Abstand ist eine Eigenschaft der Grenze *zwischen* zwei benachbarten Zeichen, und eine Auswahl mitten im Wort enthält keine solche Grenze. Der Befehl benennt daher einen zu korrigierenden Bereich statt eines neu zu schreibenden Textes. Ohne Auswahl formatiert er den Block an der Cursorposition.

Beide Befehle schützen genau dasselbe (siehe [Geschützter Inhalt](#geschutzter-inhalt)), ein Alles-Markieren vor `Mod + Umschalt + F` ist also unbedenklich.

---

## Formatierungsregeln

### 1. CJK-Lateinischer Abstand

Fügt automatisch Leerzeichen zwischen CJK- und lateinischen Zeichen/Zahlen hinzu,
einschließlich Zahlen mit Vorzeichen (negativ, positiv, plus-minus) und Zahlen mit
vorangestelltem Währungszeichen.

| Vorher | Nachher |
|--------|---------|
| 学习Python编程 | 学习 Python 编程 |
| 共100个 | 共 100 个 |
| 使用macOS系统 | 使用 macOS 系统 |
| 我有-1个 | 我有 -1 个 |
| 我有+1个 | 我有 +1 个 |
| 误差±5%范围 | 误差 ±5% 范围 |
| 中文-$100元 | 中文 -$100 元 |
| 范围-100到-200 | 范围 -100 到 -200 |

Als Vorzeichen erkannt werden ASCII `-` `+`, vollbreites `－` `＋`, das Unicode-Minus
`−` und Plus-Minus `±`. Ein Vorzeichen wird nur dann der Zahl zugeordnet, wenn eine
Ziffer folgt (oder ein Währungszeichen, gefolgt von einer Ziffer), sodass CJK-lateinische
Bindestrich-Bezeichner (z. B. `中文-Web`) und CJK-CJK-Bindestrich-Wendungen
(z. B. `中文-我`) erhalten bleiben und Bereiche wie `5-10` unverändert bleiben.

**Was als CJK und was als lateinisch gilt.** Ein CJK-Zeichen ist nach Unicode-Schrift
ein Han-, Hiragana-, Katakana- oder Bopomofo-Zeichen. Dazu gehören die selteneren
Han-Blöcke (Erweiterung A, die Erweiterungen der Zusatzebenen und die
Kompatibilitätsideogramme), das Wiederholungszeichen `々`, die ideografische Null `〇`,
halbbreite Katakana und das Dehnungszeichen `ー`. Ein lateinisches Zeichen ist jeder
Buchstabe der lateinischen Schrift, Buchstaben mit Akzent eingeschlossen, sodass beide
Seiten eines Wortes Abstand erhalten:

| Vorher | Nachher |
|--------|---------|
| 中文café中文 | 中文 café 中文 |
| 中文𠀀abc | 中文𠀀 abc |
| ｶﾀｶﾅabc | ｶﾀｶﾅ abc |
| 日本・東京 | 日本・東京 |

Vollbreite lateinische Buchstaben (`Ａ`) bringen ihren eigenen Abstand mit und erhalten nie
zusätzlichen Abstand. Der Katakana-Mittelpunkt `・` ist ein Satzzeichen, kein Buchstabe,
daher wird daneben kein Leerzeichen eingefügt.

**Links.** Die schließende Klammer eines Links erhält nur dann Abstand zu nachfolgendem
CJK-Text, wenn der sichtbare Text des Links auf einen lateinischen Buchstaben oder eine
Ziffer endet — das ist die Lücke, die ein Leser sieht. `参见[link](https://x.com)中文` wird zu
`参见[link](https://x.com) 中文`; `参见[中文](https://x.com)中文` bleibt unverändert.

### 2. Vollbreite Interpunktion

Konvertiert halbbreite Interpunktion zu vollbreiter in CJK-Kontext.

| Vorher | Nachher |
|--------|---------|
| 你好,世界 | 你好，世界 |
| 什么? | 什么？ |
| 注意:重要 | 注意：重要 |

### 3. Vollbreite Zeichenumwandlung

Konvertiert vollbreite Buchstaben und Zahlen zu halbbreiter.

| Vorher | Nachher |
|--------|---------|
| １２３４ | 1234 |
| ＡＢＣ | ABC |

### 4. Klammernkonvertierung

Konvertiert halbbreite Klammern zu vollbreiten, wenn sie CJK-Inhalt umschließen. Beide Klammern müssen im selben Absatz stehen: über eine Leerzeile hinweg bleiben sie, wie sie getippt wurden.

| Vorher | Nachher |
|--------|---------|
| (注意) | （注意） |
| [重点] | 【重点】 |
| (English) | (English) |

### 5. Gedankenstrichkonvertierung

Konvertiert doppelte Bindestriche zu korrekten CJK-Gedankenstrichen.

| Vorher | Nachher |
|--------|---------|
| 原因--结果 | 原因 —— 结果 |
| 说明--这是 | 说明 —— 这是 |

### 6. Typografische Anführungszeichenkonvertierung

VMark verwendet einen **stapelbasierten Anführungszeichen-Paarungsalgorithmus**, der korrekt behandelt:

- **Apostrophe**: Kontraktionen wie `don't`, `it's`, `l'amour` werden beibehalten
- **Possessiv**: `Xiaolai's` bleibt unverändert
- **Primzeichen**: Maße wie `5'10"` (Fuß/Zoll) werden beibehalten
- **Jahrzehnte**: Abkürzungen wie `'90s` werden erkannt
- **CJK-Kontexterkennung**: Anführungszeichen um CJK-Inhalt erhalten geschwungene/Eckklammern-Anführungszeichen

| Vorher | Nachher |
|--------|---------|
| 他说"hello" | 他说 “hello” |
| "don't worry" | “don't worry” |
| 5'10" tall | 5'10" tall |

Geschweifte Anführungszeichen erhalten neben CJK-Text ein Leerzeichen: `他说"hello"` wird zu `他说 “hello”`. Eckige Anführungszeichen (`「 」`, `『 』`) und Schlusszeichen erhalten keines. Wer geschweifte Anführungszeichen lieber eng setzt, schaltet **Anführungszeichen-Abstand korrigieren** oder **Einfache Anführungszeichen-Abstand korrigieren** unter Einstellungen → Sprache → CJK-Formatierung ab: `“ ”` und `‘ ’` sind im CJK-Kontext vollbreit, und GB/T 15834 wie JLREQ betrachten die Lücke als Teil der Glyphe — genau dafür gibt es diese Schalter.

Mit aktivierter Eckklammern-Option:

| Vorher | Nachher |
|--------|---------|
| "中文内容" | 「中文内容」 |
| 「包含'嵌套'」 | 「包含『嵌套』」 |

### 7. Auslassungszeichen-Normalisierung

Standardisiert die Formatierung von Auslassungszeichen in der Form, die die umgebende Schrift verwendet. Es gibt keine einzige richtige Antwort: Chinesisch (GB/T 15834) und Japanisch (JIS X 4051) verwenden die sechspunktige Auslassung `……` und setzen danach **kein** Leerzeichen, Koreanisch verwendet `…`, und nur lateinischer Text verwendet `...` gefolgt von einem Leerzeichen.

| Vorher | Nachher |
|--------|---------|
| 等等. . . | 等等…… |
| 然后...继续 | 然后……继续 |
| そして...続く | そして……続く |
| 그리고...계속 | 그리고…계속 |
| wait...ok | wait... ok |

Die Schrift wird anhand der Zeichen unmittelbar neben den Punkten bestimmt, nicht anhand des Dokuments, sodass `...` innerhalb eines englischen Zitats in einer chinesischen Datei seine lateinische Form behält.

### 8. Wiederholte Interpunktion

Begrenzt aufeinanderfolgende Satzzeichen (konfigurierbares Limit).

| Vorher | Nachher (Limit=1) |
|--------|------------------|
| 太棒了！！！ | 太棒了！ |
| 真的吗？？？ | 真的吗？ |

### 9. Sonstige Bereinigung

- Mehrere Leerzeichen werden komprimiert: `多个   空格` → `多个 空格`
- Nachgestellte Leerzeichen werden entfernt
- Schrägstrich-Abstände: `A / B` → `A/B`
- Bindung von Währung und Einheit: `$ 100` → `$100`, `100 %` → `100%`. Entfernt werden nur Leerzeichen und Tabulatoren: Eine Zahl am Ende einer Zeile oder eines Absatzes wird nie mit einer Einheit oder Währung in der nächsten verbunden, und ein von Ihnen zwischen Zahl und Einheit getipptes geschütztes Leerzeichen bleibt erhalten

---

## Geschützter Inhalt

Der folgende Inhalt wird **nicht** durch Formatierung beeinflusst:

- Code-Blöcke (```) — einschließlich eines **nicht geschlossenen** Code-Fence, der, wie CommonMark es vorschreibt, den Rest des Dokuments einnimmt
- Inline-Code (`)
- Link-URLs
- Bildpfade
- HTML-Tags
- Frontmatter — sowohl YAML (`---`) als auch TOML (`+++`)
- Inline-Mathematik (`$…$`), erkannt nach derselben Regel, die der Renderer von VMark verwendet, sodass ein Betragspaar wie `价格是 $100 和 $200 元` *nicht* für Mathematik gehalten wird
- Abgesetzte Mathematik (`$$…$$`)
- Eingerückte Code-Blöcke
- Wiki-Links (`[[target]]`, `[[target|display]]`)
- Fußnotenmarkierungen — Verweise wie `[^1]` und das `[^1]:`-Label einer Definition (der Text der Definition selbst wird formatiert)
- HTML-Zeichenreferenzen (`&amp;`, `&#x5176;`)
- Thematische Umbrüche (`---`, `***`)
- Backslash-maskierte Interpunktion (z. B. `\,` bleibt als `,`)

### Technische Konstrukte

Der **Latin Span Scanner** von VMark erkennt und schützt technische Konstrukte vor der Interpunktionskonvertierung:

| Typ | Beispiele | Schutz |
|-----|----------|--------|
| URLs | `https://example.com` | Alle Interpunktionen beibehalten |
| E-Mails | `user@example.com` | @ und . beibehalten |
| Versionen | `v1.2.3`, `1.2.3.4` | Punkte beibehalten |
| Dezimalzahlen | `3.14`, `0.5` | Punkt beibehalten |
| Zeiten | `12:30`, `1:30:00` | Doppelpunkte beibehalten |
| Tausender | `1,000`, `1,000,000` | Kommas beibehalten |
| Domains | `example.com` | Punkt beibehalten |

Beispiel:

| Vorher | Nachher |
|--------|---------|
| 版本v1.2.3发布 | 版本 v1.2.3 发布 |
| 访问https://example.com获取 | 访问 https://example.com 获取 |
| 温度是3.14度 | 温度是 3.14 度 |

### Backslash-Escapes

Präfixieren Sie eine Interpunktion mit `\`, um die Konvertierung zu verhindern:

| Eingabe | Ausgabe |
|---------|---------|
| `价格\,很贵` | 价格,很贵 (Komma bleibt halbbreit) |
| `测试\.内容` | 测试.内容 (Punkt bleibt halbbreit) |

---

## KI-unterstützte Formatierung

Wenn der [MCP-Server](/de/guide/mcp-setup) verbunden ist, können KI-Assistenten die CJK-Formatierung programmatisch über das Werkzeug `document.transform` mit einem von drei `kind`-Werten anwenden:

- `"cjk-format"` — vollständige CJK-Normalisierung (Abstände + Interpunktion + typografische Anführungszeichen), derselbe Formatierer, den der Menübefehl ausführt, gemäß Ihren Einstellungen unter Einstellungen → Sprache
- `"cjk-spacing"` — fügt überall dort genau ein Leerzeichen ein, wo ein CJK-Zeichen auf einen lateinischen Buchstaben oder eine Ziffer trifft, und sonst nichts
- `"cjk-punctuation"` — wandelt halbbreite `,` `.` `!` `?` `;` `:` `(` `)` neben einem CJK-Zeichen in ihre vollbreite Form um; vollbreite Zeichen wandelt es nie in halbbreite zurück

Nur `cjk-format` liest Ihre Formatierungseinstellungen. `cjk-spacing` und `cjk-punctuation` sind feste Regeln, die sie ignorieren, und anders als der Formatierer behandeln sie auch koreanisches Hangul als CJK. Alle drei arbeiten auf dem Markdown-Quelltext des Dokuments und lassen [geschützten Inhalt](#geschutzter-inhalt) unangetastet.

In der [MCP-Tools-Referenz](/de/guide/mcp-tools#transform) finden Sie die vollständige Anfrageform — `document.transform` nimmt `tabId`, `kind` und ein `expected_revision` für optimistische Nebenläufigkeit.

## Konfiguration

CJK-Formatierungsoptionen können in Einstellungen → Sprache konfiguriert werden:

- Bestimmte Regeln aktivieren/deaktivieren
- Interpunktionswiederholungslimit festlegen
- Anführungszeichenstil auswählen (Standard oder Eckklammern)

### Kontextuelle Anführungszeichen

Wenn **Kontextbezogene Anführungszeichen** aktiviert ist (Standard):

- Anführungszeichen um CJK-Inhalt → geschwungene Anführungszeichen `""`
- Anführungszeichen um reinen lateinischen Inhalt → gerade Anführungszeichen `""`

Dies bewahrt das natürliche Erscheinungsbild englischer Texte, während CJK-Inhalt korrekt formatiert wird.

### CJK-Eckklammern *(standardmäßig aus)*

Wenn **CJK-Winkelanführungszeichen** aktiviert ist, werden geschwungene Anführungszeichen um CJK-Inhalte in Eckklammern konvertiert (`「」` für primär, `『』` für verschachtelt) — die typografisch traditionelle Anführungsform für vertikalen CJK-Satz. Lateinische Inhalte behalten unabhängig von dieser Einstellung standardmäßige geschwungene Anführungszeichen.

### Referenzabschnitte überspringen

Ist **Referenzabschnitte überspringen** unter Einstellungen → Sprache → Abschnittsbehandlung aktiviert (standardmäßig aus), erkennt der CJK-Formatierer Überschriften wie „References“ / „Further Reading“ / „参考文献“ / „参考资料“ / „Bibliography“ und überspringt die Neuformatierung in diesen Abschnitten — zitatformatierter Text stützt sich häufig auf bestimmte Interpunktion, die die CJK-Regeln sonst normalisieren würden. Schalten Sie es für wissenschaftliche Dokumente ein; lassen Sie es aus, um die ganze Datei zu formatieren.

### Integritätsprüfung

Nach jedem CJK-Formatierungsdurchlauf vergleicht der Formatierer das **Inhaltsskelett** des Dokuments vorher und nachher: den Text ohne Leerzeichen und Interpunktion und mit normalisierter Zeichenbreite. Alle Formatierungsregeln ändern ausschließlich Leerzeichen, Interpunktion oder die Breite eines alphanumerischen Zeichens, also muss dieses Skelett unverändert zurückkommen — und da es eine Folge und keine Zählung ist, fällt auch umgestellter Inhalt auf. Buchstaben, Ziffern, Ideogramme, Kana, Hangul und Emoji zählen alle mit.

Schlägt die Prüfung fehl, bleibt das Dokument **vollständig unverändert** und eine Meldung weist Sie darauf hin. Eine Ablehnung ist nie stillschweigend und wird nie mit „es gab nichts zu ändern“ verwechselt.

---

## CJK-Buchstabenabstand

VMark enthält eine spezielle Buchstabenabstandsfunktion für CJK-Text, die die Lesbarkeit durch subtile Abstände zwischen Zeichen verbessert.

### Einstellungen

Konfigurieren Sie in **Einstellungen → Editor → Typografie → CJK-Zeichenabstand**:

| Option | Wert | Beschreibung |
|--------|------|-------------|
| Aus | 0 | Kein Buchstabenabstand (Standard) |
| Subtil | 0,02em | Kaum wahrnehmbarer Abstand |
| Leicht | 0,03em | Leichter Abstand |
| Normal | 0,05em | Empfohlen für die meisten Anwendungsfälle |
| Weit | 0,08em | Ausgeprägter Abstand |
| Weiter | 0,10em | Noch weiter, für große Anzeigegrößen |
| Extra | 0,12em | Die weiteste Einstellung |

### Funktionsweise

- Wendet Buchstabenabstand-CSS auf CJK-Zeichenfolgen an
- Schließt Code-Blöcke und Inline-Code aus
- Funktioniert in WYSIWYG und exportiertem HTML
- Keine Auswirkung auf lateinischen Text oder Zahlen

### Beispiel

Ohne Buchstabenabstand:
> 这是一段中文文字，没有任何字间距。

Mit 0,05em Buchstabenabstand:
> 这 是 一 段 中 文 文 字 ， 有 轻 微 的 字 间 距 。

Der Unterschied ist subtil, verbessert aber die Lesbarkeit, besonders bei längeren Abschnitten.

---

## Typografische Anführungszeichenstile

VMark kann gerade Anführungszeichen automatisch in typografisch korrekte Anführungszeichen umwandeln. Diese Funktion funktioniert während der CJK-Formatierung und unterstützt mehrere Anführungszeichenstile.

### Anführungszeichenstile

| Stil | Doppelte Anführungszeichen | Einfache Anführungszeichen |
|------|--------------------------|--------------------------|
| Geschwungen | "text" | 'text' |
| Eckklammern | 「text」 | 『text』 |
| Guillemets | «text» | ‹text› |

### Stapelbasierter Paarungsalgorithmus

VMark verwendet einen ausgeklügelten stapelbasierten Algorithmus zur Anführungszeichen-Paarung:

1. **Tokenisierung**: Identifiziert alle Anführungszeichen im Text
2. **Klassifizierung**: Bestimmt anhand des Kontexts, ob jedes Anführungszeichen öffnend oder schließend ist
3. **Apostroph-Erkennung**: Erkennt Kontraktionen (don't, it's) und bewahrt sie
4. **Primzeichen-Erkennung**: Erkennt Maße (5'10") und bewahrt sie
5. **CJK-Kontexterkennung**: Prüft, ob der zitierte Inhalt CJK-Zeichen enthält
6. **Waisen-Bereinigung**: Behandelt ungematchte Anführungszeichen korrekt; ein am Absatzende noch offenes Anführungszeichen bleibt ungepaart, sodass Anführungszeichen nie über eine Leerzeile hinweg gepaart werden

### Beispiele

| Vorher | Nachher (Geschwungen) |
|--------|----------------------|
| "hello" | "hello" |
| 'world' | 'world' |
| it's | it's |
| don't | don't |
| 5'10" | 5'10" |
| '90s | '90s |

Apostrophe in Kontraktionen (wie "it's" oder "don't") werden korrekt beibehalten.

### Anführungszeichenstil am Cursor umschalten

Sie können den Anführungszeichenstil vorhandener Anführungszeichen schnell umschalten, ohne das gesamte Dokument neu zu formatieren. Platzieren Sie Ihren Cursor innerhalb eines Anführungszeichenpaars und drücken Sie `Umschalt + Mod + '`, um umzuschalten. Dies funktioniert nur im WYSIWYG-Modus; im Quellmodus gibt es keine Umschaltung der Anführungszeichen.

**Einfacher Modus** (Standard): Wechselt zwischen geraden Anführungszeichen und Ihrem bevorzugten Stil.

| Vorher | Nachher | Nochmals |
|--------|---------|---------|
| "hello" | "hello" | "hello" |
| 'world' | 'world' | 'world' |

**Vollständiger Zyklusmodus**: Durchläuft alle vier Stile.

| Schritt | Doppelt | Einfach |
|---------|---------|---------|
| 1 | "text" | 'text' |
| 2 | "text" | 'text' |
| 3 | 「text」 | 『text』 |
| 4 | «text» | ‹text› |
| 5 | "text" (zurück zum Start) | 'text' |

**Verschachtelte Anführungszeichen**: Wenn Anführungszeichen verschachtelt sind, schaltet der Befehl das **innerste** Paar um, das den Cursor umschließt.

**Intelligente Erkennung**: Apostrophe (`don't`), Primzeichen (`5'10"`) und Jahrzehntsabkürzungen (`'90s`) werden nie als Anführungszeichenpaare behandelt.

::: tip
Wechseln Sie zwischen einfachem und vollständigem Zyklusmodus in Einstellungen → Sprache → CJK-Formatierung → Verhalten beim Umschalten von Anführungszeichen.
:::

### Konfiguration

Aktivieren Sie die typografische Anführungszeichenkonvertierung in Einstellungen → Sprache → CJK-Formatierung. Sie können auch Ihren bevorzugten Anführungszeichenstil aus dem Dropdown-Menü auswählen.

---

## CJK-Eckklammernkonvertierung

Wenn **CJK-Winkelanführungszeichen** aktiviert ist, werden geschwungene Anführungszeichen um CJK-Inhalt automatisch in Eckklammern konvertiert.

### Unterstützte Zeichen

Die Eckklammernkonvertierung wird ausgelöst, wenn der zitierte Inhalt — oder der Text
unmittelbar daneben — aus Han, Hiragana, Katakana oder Bopomofo besteht:

| Inhaltstyp | Beispiel | Konvertiert? |
|------------|---------|-------------|
| Chinesisch | `"中文"` | ✓ `「中文」` |
| Japanisch mit Kanji | `"日本語"` | ✓ `「日本語」` |
| Nur Hiragana | `"ひらがな"` | ✓ `「ひらがな」` |
| Nur Katakana | `"カタカナ"` | ✓ `「カタカナ」` |
| Koreanisch | `"한글"` | ✗ bleibt als `"한글"` |
| Englisch | `"hello"` | ✗ bleibt als `"hello"` |

Koreanisch ist aus demselben Grund ausgenommen wie bei den Abstandsregeln: Koreanisch verwendet `“ ”`,
nicht Eckklammern.

---

## Testabsatz

Kopieren Sie diesen unformatierten Text in VMark und drücken Sie `Alt + Mod + Umschalt + F` zur Formatierung:

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

### Erwartetes Ergebnis

Nach der Formatierung sieht der Text folgendermaßen aus:

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

**Angewendete Änderungen:**
- CJK-Lateinischer Abstand hinzugefügt (学习 TypeScript)
- Vollbreite Interpunktion konvertiert (，。！)
- Vollbreite Zahlen normalisiert (３→3, １０００→1000, ２００→200)
- Doppelte Bindestriche in Gedankenstriche konvertiert (是--状态 → 是 —— 状态)
- Auslassungszeichen in die chinesische Form normalisiert, ohne Leerzeichen danach (. . . → ……)
- Typografische Anführungszeichen mit Leerzeichen neben dem CJK-Text angewendet, Apostroph beibehalten (don't)
- Technische Konstrukte geschützt (https://example.com/docs, v2.0.0, $99.99, 12:30)

**Und was sich _nicht_ ändert:** Das `--` in `**Frontend**--React` bleibt ein doppelter
Bindestrich. Die Gedankenstrichkonvertierung braucht ein CJK-Zeichen oder ein alphanumerisches Zeichen
unmittelbar neben den Bindestrichen, und `*` ist keins von beiden. Würde sie stattdessen bei Hervorhebungsmarkern
greifen, würde sie `--` in jedem rein englischen Listenpunkt eines chinesischen Dokuments umwandeln, was
schlimmer ist, als diese drei in Ruhe zu lassen.
