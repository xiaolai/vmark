# CJK-Formatierungshandbuch

VMark enthält einen umfassenden Satz von Formatierungsregeln für chinesischen, japanischen und koreanischen Text. Diese Tools helfen dabei, eine konsistente Typografie beim Mischen von CJK- und lateinischen Zeichen beizubehalten.

## Schnellstart

Verwenden Sie **Format → CJK-Dokument formatieren** oder drücken Sie `Alt + Mod + Umschalt + F`, um das gesamte Dokument zu formatieren.

Um nur eine Auswahl zu formatieren, verwenden Sie `Mod + Umschalt + F`.

---

## Formatierungsregeln

### 1. CJK-Lateinischer Abstand

Fügt automatisch Leerzeichen zwischen CJK- und lateinischen Zeichen/Zahlen hinzu.

| Vorher | Nachher |
|--------|---------|
| 学习Python编程 | 学习 Python 编程 |
| 共100个 | 共 100 个 |
| 使用macOS系统 | 使用 macOS 系统 |

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

Konvertiert halbbreite Klammern zu vollbreiten, wenn sie CJK-Inhalt umschließen.

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
| 他说"hello" | 他说 "hello" |
| "don't worry" | "don't worry" |
| 5'10" tall | 5'10" tall |

Mit aktivierter Eckklammern-Option:

| Vorher | Nachher |
|--------|---------|
| "中文内容" | 「中文内容」 |
| 「包含'嵌套'」 | 「包含『嵌套』」 |

### 7. Auslassungszeichen-Normalisierung

Standardisiert die Formatierung von Auslassungszeichen.

| Vorher | Nachher |
|--------|---------|
| 等等. . . | 等等... |
| 然后. . .继续 | 然后... 继续 |

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
- Währungsabstände: `$ 100` → `$100`

---

## Geschützter Inhalt

Der folgende Inhalt wird **nicht** durch Formatierung beeinflusst:

- Code-Blöcke (```)
- Inline-Code (`)
- Link-URLs
- Bildpfade
- HTML-Tags
- YAML-Frontmatter
- Backslash-maskierte Interpunktion (z.B. `\,` bleibt als `,`)

### Technische Konstrukte

VMark's **Latin Span Scanner** erkennt und schützt automatisch technische Konstrukte vor der Interpunktionskonvertierung:

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

- `"cjk-format"` — vollständige CJK-Normalisierung (Abstände + Interpunktion + typografische Anführungszeichen gemäß Ihren Einstellungen)
- `"cjk-spacing"` — passt nur Leerzeichen an Übergängen zwischen CJK ↔ Latein/Ziffer an
- `"cjk-punctuation"` — konvertiert Interpunktion zwischen Voll- und Halbbreite gemäß den Regeln

Jede Transformation führt das aktive Dokument durch einen Serialisieren-Formatieren-Parsen-Roundtrip, um Inline-Markierungen (Fett, Links, Mathematik usw.) zu erhalten und Ihre konfigurierten Formatierungsregeln zu respektieren.

In der [MCP-Tools-Referenz](/de/guide/mcp-tools#document-tool) finden Sie die vollständige Anfrageform — `document.transform` nimmt `tabId`, `kind` und ein `expected_revision` für optimistische Nebenläufigkeit.

## Konfiguration

CJK-Formatierungsoptionen können in Einstellungen → Sprache konfiguriert werden:

- Bestimmte Regeln aktivieren/deaktivieren
- Interpunktionswiederholungslimit festlegen
- Anführungszeichenstil auswählen (Standard oder Eckklammern)

### Kontextuelle Anführungszeichen

Wenn **Kontextuelle Anführungszeichen** aktiviert ist (Standard):

- Anführungszeichen um CJK-Inhalt → geschwungene Anführungszeichen `""`
- Anführungszeichen um reinen lateinischen Inhalt → gerade Anführungszeichen `""`

Dies bewahrt das natürliche Erscheinungsbild englischer Texte, während CJK-Inhalt korrekt formatiert wird.

### CJK-Eckklammern *(standardmäßig aus)*

Wenn **CJK-Eckanführungszeichen** aktiviert sind, werden geschwungene Anführungszeichen um CJK-Inhalte in Eckklammern konvertiert (`「」` für primär, `『』` für verschachtelt) — die typografisch traditionelle Anführungsform für vertikalen CJK-Satz. Lateinische Inhalte behalten unabhängig von dieser Einstellung standardmäßige geschwungene Anführungszeichen.

### Referenzabschnitte überspringen

Der CJK-Formatierer erkennt Überschriften wie „References", „参考文献", „参考资料" oder „Bibliography" und überspringt die Neuformatierung in diesen Abschnitten — zitatformatierter Text stützt sich häufig auf bestimmte Interpunktion, die die CJK-Regeln sonst normalisieren würden.

### Integritätsprüfung

Nach jedem CJK-Formatierungsdurchlauf führt der Formatierer eine Integritätsprüfung durch, die den sichtbaren Textinhalt (ohne Berücksichtigung von Leerzeichen-/Interpunktionsänderungen) vor und nach dem Vorgang vergleicht. Schlägt die Prüfung fehl, wird der Vorgang zurückgerollt und es erscheint eine Diagnose — so ist garantiert, dass die CJK-Formatierung niemals stillschweigend Inhalt verliert.

---

## CJK-Buchstabenabstand

VMark enthält eine spezielle Buchstabenabstandsfunktion für CJK-Text, die die Lesbarkeit durch subtile Abstände zwischen Zeichen verbessert.

### Einstellungen

Konfigurieren Sie in **Einstellungen → Editor → Typografie → CJK-Buchstabenabstand**:

| Option | Wert | Beschreibung |
|--------|------|-------------|
| Aus | 0 | Kein Buchstabenabstand (Standard) |
| Subtil | 0,02em | Kaum wahrnehmbarer Abstand |
| Leicht | 0,03em | Leichter Abstand |
| Normal | 0,05em | Empfohlen für die meisten Anwendungsfälle |
| Weit | 0,08em | Ausgeprägter Abstand |

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
2. **Klassifizierung**: Bestimmt, ob jedes Anführungszeichen öffnend oder schließend ist
3. **Apostroph-Erkennung**: Erkennt Kontraktionen (don't, it's) und bewahrt sie
4. **Primzeichen-Erkennung**: Erkennt Maße (5'10") und bewahrt sie
5. **CJK-Kontexterkennung**: Prüft, ob der zitierte Inhalt CJK-Zeichen enthält
6. **Waisen-Bereinigung**: Behandelt ungematchte Anführungszeichen korrekt

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

Sie können den Anführungszeichenstil vorhandener Anführungszeichen schnell umschalten, ohne das gesamte Dokument neu zu formatieren. Platzieren Sie Ihren Cursor innerhalb eines Anführungszeichenpaars und drücken Sie `Umschalt + Mod + '`, um umzuschalten.

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
Wechseln Sie zwischen einfachem und vollständigem Zyklusmodus in Einstellungen → Sprache → CJK-Formatierung → Anführungszeichen-Umschaltmodus.
:::

### Konfiguration

Aktivieren Sie die typografische Anführungszeichenkonvertierung in Einstellungen → Sprache → CJK-Formatierung. Sie können auch Ihren bevorzugten Anführungszeichenstil aus dem Dropdown-Menü auswählen.

---

## CJK-Eckklammernkonvertierung

Wenn **CJK-Eckklammern** aktiviert ist, werden geschwungene Anführungszeichen um CJK-Inhalt automatisch in Eckklammern konvertiert.

### Unterstützte Zeichen

Die Eckklammernkonvertierung wird ausgelöst, wenn der zitierte Inhalt **chinesische Zeichen** enthält (CJK-Unified Ideographs U+4E00–U+9FFF):

| Inhaltstyp | Beispiel | Konvertiert? |
|------------|---------|-------------|
| Chinesisch | `"中文"` | ✓ `「中文」` |
| Japanisch mit Kanji | `"日本語"` | ✓ `「日本語」` |
| Nur Hiragana | `"ひらがな"` | ✗ bleibt als `"ひらがな"` |
| Nur Katakana | `"カタカナ"` | ✗ bleibt als `"カタカナ"` |
| Koreanisch | `"한글"` | ✗ bleibt als `"한글"` |
| Englisch | `"hello"` | ✗ bleibt als `"hello"` |

**Tipp:** Für japanischen Text mit nur Kana verwenden Sie manuell Eckklammern `「」` oder fügen Sie mindestens ein Kanji-Zeichen hinzu.

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

学习过程中遇到的最大挑战是 —— 状态管理。Redux 的概念... 说实话有点难理解。后来换成了 Zustand，简单多了！

老师说 "don't give up" 然后继续讲 "写代码要注重可读性"，我觉得很有道理。

访问 https://example.com/docs 获取 v2.0.0 版本文档，价格 $99.99，时间 12:30 开始。

项目使用的技术栈如下：

- **Frontend** —— React + TypeScript
- **Backend** —— Node.js + Express
- **Database** —— PostgreSQL

总共花费大约 $200 美元购买了学习资源，包括书籍和 online courses。虽然价格不便宜，但非常值得。

---

**Angewendete Änderungen:**
- CJK-Lateinischer Abstand hinzugefügt (学习 TypeScript)
- Vollbreite Interpunktion konvertiert (，。！)
- Vollbreite Zahlen normalisiert (３→3, １０００→1000, ２００→200)
- Doppelte Bindestriche in Gedankenstriche konvertiert (-- → ——)
- Auslassungszeichen normalisiert (. . . → ...)
- Typografische Anführungszeichen angewendet, Apostroph beibehalten (don't)
- Technische Konstrukte geschützt (https://example.com/docs, v2.0.0, $99.99, 12:30)
