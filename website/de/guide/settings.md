# Einstellungen

VMark's Einstellungsbereich ermöglicht die Anpassung aller Aspekte des Editors. Öffnen Sie ihn mit `Mod + ,` oder über **VMark > Einstellungen** in der Menüleiste.

Das Einstellungsfenster hat eine Seitenleiste mit nach Themen gruppierten Abschnitten — die am häufigsten verwendeten Abschnitte stehen oben, „Über" und „Erweitert" am Ende. Änderungen werden sofort wirksam — es gibt keine Speichern-Schaltfläche.

## Erscheinungsbild

Steuert das visuelle Design und das Fensterverhalten.

### Design

Wählen Sie eines von fünf Farbdesigns. Das aktive Design wird durch einen Ring um sein Farbfeld angezeigt.

| Design | Hintergrund | Stil |
|--------|------------|------|
| Weiß | `#FFFFFF` | Sauber, hoher Kontrast |
| Papier | `#EEEDED` | Warmes Neutral (Standard) |
| Mint | `#CCE6D0` | Sanftes Grün, augenfreundlich |
| Sepia | `#F9F0DB` | Warmes Gelblich, buchähnlich |
| Nacht | `#23262B` | Dunkelmodus |

### Sprache

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Sprache | Ändert die UI-Sprache für Menüs, Beschriftungen und Meldungen. Wird sofort wirksam | Englisch | English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Italiano, Português (Brasil) |

### Fenster

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Dateiname in Titelleiste anzeigen | Aktuellen Dateinamen in der macOS-Fenstertitelleiste anzeigen | Aus |
| Statusleiste automatisch ausblenden | Statusleiste automatisch ausblenden, wenn Sie nicht damit interagieren | Aus |

## Editor

Typografie, Anzeige, Bearbeitungsverhalten und Leerzeichen-Einstellungen.

### Typografie

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Lateinische Schriftart | Schriftfamilie für lateinischen (englischen) Text | Systemstandard | Systemstandard, Athelas, Palatino, Georgia, Charter, Literata |
| CJK-Schriftart | Schriftfamilie für chinesischen, japanischen, koreanischen Text | Systemstandard | Systemstandard, PingFang SC, Songti SC, Kaiti SC, Noto Serif CJK, Source Han Sans |
| Mono-Schriftart | Schriftfamilie für Code und monospace Text | Systemstandard | Systemstandard, SF Mono, Monaco, Menlo, Consolas, JetBrains Mono, Fira Code, SauceCodePro NFM, IBM Plex Mono, Hack, Inconsolata |
| Schriftgröße | Basis-Schriftgröße für Editor-Inhalt | 18px | 14px, 16px, 18px, 20px, 22px |
| Zeilenhöhe | Vertikaler Abstand zwischen Zeilen | 1,8 (Entspannt) | 1,4 (Kompakt), 1,6 (Normal), 1,8 (Entspannt), 2,0 (Geräumig), 2,2 (Extra) |
| Block-Abstand | Visueller Abstand zwischen Blockelementen (Überschriften, Absätzen, Listen) gemessen in Vielfachen der Zeilenhöhe | 1x (Normal) | 0,5x (Eng), 1x (Normal), 1,5x (Entspannt), 2x (Geräumig) |
| CJK-Buchstabenabstand | Zusätzlicher Abstand zwischen CJK-Zeichen in em-Einheiten | Aus | Aus, 0,02em (Subtil), 0,03em (Leicht), 0,05em (Normal), 0,08em (Weit), 0,10em (Weiter), 0,12em (Extra) |

### Anzeige

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Editor-Breite | Maximale Inhaltsbreite. Breitere Werte eignen sich für große Monitore; schmalere verbessern die Lesbarkeit | 50em (Mittel) | 36em (Kompakt), 42em (Schmal), 50em (Mittel), 60em (Weit), 80em (Extra Weit), Unbegrenzt |

::: tip
50em bei 18px Schriftgröße entspricht etwa 900px — eine angenehme Lesebreite für die meisten Displays.
:::

### Verhalten

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Tab-Größe | Anzahl der Leerzeichen beim Drücken von Tab | 2 Leerzeichen | 2 Leerzeichen, 4 Leerzeichen |
| Auto-Pairing aktivieren | Automatisch passendes schließendes Zeichen einfügen, wenn Sie ein öffnendes eingeben | Ein | Ein / Aus |
| CJK-Klammern | CJK-spezifische Klammern wie `「」` `【】` `《》` automatisch pairen. Nur verfügbar, wenn Auto-Pairing aktiviert ist | Auto | Aus, Auto |
| Typografische Anführungszeichen einschließen | `""` und `''` automatisch pairen. Kann mit einigen IME-Smartquote-Funktionen in Konflikt geraten | Ein | Ein / Aus |
| Auch `"` pairen | Das Eingeben des rechten doppelten Anführungszeichens `"` fügt ebenfalls ein `""`-Paar ein. Nützlich, wenn Ihr IME zwischen öffnenden und schließenden Anführungszeichen wechselt | Aus | Ein / Aus |
| Kopierformat | Welches Format für den reinen Text-Zwischenablageplatz beim Kopieren aus dem WYSIWYG-Modus verwendet wird | Reiner Text | Reiner Text, Markdown |
| Bei Auswahl kopieren | Text automatisch in die Zwischenablage kopieren, wenn Sie ihn auswählen | Aus | Ein / Aus |

### Leerzeichen

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Zeilenenden beim Speichern | Steuert, wie Zeilenenden beim Speichern von Dateien behandelt werden | Bestehende erhalten | Bestehende erhalten, LF (`\n`), CRLF (`\r\n`) |
| Aufeinanderfolgende Zeilenumbrüche erhalten | Mehrere Leerzeilen so lassen, anstatt sie zu reduzieren | Aus | Ein / Aus |
| Harter Zeilenumbruch-Stil beim Speichern | Wie harte Zeilenumbrüche in der gespeicherten Markdown-Datei dargestellt werden | Bestehende erhalten | Zwei Leerzeichen (Empfohlen), Bestehende erhalten, Backslash (`\`) |
| `<br>`-Tags anzeigen | HTML-Zeilenumbruch-Tags sichtbar im Editor anzeigen | Aus | Ein / Aus |

::: tip
Zwei Leerzeichen ist der kompatabelste Stil für harte Zeilenumbrüche — er funktioniert auf GitHub, GitLab und allen wichtigen Markdown-Renderern. Der Backslash-Stil kann auf Reddit, Jekyll und einigen älteren Parsern fehlschlagen.
:::

## Markdown

Einfüge-Verhalten, Layout und HTML-Rendering-Einstellungen.

### Einfügen & Eingabe

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Regex in Suche aktivieren | Zeigt eine Regex-Umschalter-Schaltfläche in der Suchen & Ersetzen-Leiste | Ein | Ein / Aus |
| Einfügemodus | Wie VMark Inhalte aus der Zwischenablage weiterleitet | Smart | Smart, Plain |
| Markdown-Einfügen in WYSIWYG | Wenn Text, der wie Markdown aussieht, in den WYSIWYG-Editor eingefügt wird, automatisch in Rich-Content konvertieren | Auto | Auto, Aus |

### Layout

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Block-Element-Schriftgröße | Relative Schriftgröße für Listen, Blockzitate, Tabellen, Hinweise und Details-Blöcke | 100% | 100%, 95%, 90%, 85% |
| Überschriften-Ausrichtung | Textausrichtung für Überschriften | Links | Links, Zentriert |
| Bild- und Diagramm-Ränder | Ob ein Rand um Bilder, Mermaid-Diagramme und Mathematik-Blöcke angezeigt wird | Keiner | Keiner, Immer, Beim Hover |
| Bild- und Tabellen-Ausrichtung | Horizontale Ausrichtung für Block-Bilder und Tabellen | Zentriert | Zentriert, Links |

### Lint

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Markdown-Lint aktivieren | Auf häufige Markdown-Probleme prüfen (defekte Links, fehlender Alt-Text, Überschriftenhierarchie, nicht geschlossene Umzäunungen usw.) | Ein | Ein / Aus |

Siehe [Markdown-Lint](/de/guide/lint) für die vollständige Regelliste und Schweregrade.

### HTML-Rendering

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Rohes HTML im Rich-Text | Steuert, ob rohe HTML-Blöcke im WYSIWYG-Modus gerendert werden | Versteckt | Versteckt, Bereinigt, Bereinigt + Stile |

::: tip
**Versteckt** ist die sicherste Option — rohe HTML-Blöcke werden eingeklappt und nicht gerendert. **Bereinigt** rendert HTML mit entfernten gefährlichen Tags. **Bereinigt + Stile** behält zusätzlich Inline-`style`-Attribute bei.
:::

## Dateien & Bilder

Dateibrowser, Speichern, Dokumentverlauf, Bildbehandlung und Dokumentwerkzeuge.

### Dateibrowser

Diese Einstellungen gelten nur, wenn ein Arbeitsbereich (Ordner) geöffnet ist.

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Versteckte Dateien anzeigen | Dotfiles und versteckte Systemelemente in der Datei-Explorer-Seitenleiste einschließen | Aus |
| Alle Dateien anzeigen | Nicht-Markdown-Dateien im Datei-Explorer anzeigen. Nicht-Markdown-Dateien werden mit der Standardanwendung Ihres Systems geöffnet | Aus |

### Beenden-Verhalten

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Beenden bestätigen | Erfordert zweimaliges Drücken von `Cmd+Q` (oder `Strg+Q`) zum Beenden, um versehentliche Beendigungen zu verhindern | Ein |

### Speichern

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Autospeichern aktivieren | Dateien nach der Bearbeitung automatisch speichern | Ein | Ein / Aus |
| Speicherintervall | Zeit zwischen automatischen Speicherungen. Nur verfügbar, wenn Autospeichern aktiviert ist | 30 Sekunden | 10s, 30s, 1 Min., 2 Min., 5 Min. |
| Dokumentverlauf speichern | Dokumentversionen für Rückgängig und Wiederherstellung verfolgen | Ein | Ein / Aus |
| Maximale Versionen | Anzahl der Verlaufs-Snapshots pro Dokument | 50 Versionen | 10, 25, 50, 100 |
| Versionen behalten für | Maximales Alter von Verlaufs-Snapshots, bevor sie bereinigt werden | 7 Tage | 1 Tag, 7 Tage, 14 Tage, 30 Tage |
| Zusammenführungsfenster | Aufeinanderfolgende Autospeicherungen innerhalb dieses Fensters werden in einem einzigen Snapshot zusammengefasst | 30 Sekunden | Aus, 10s, 30s, 1 Min., 2 Min. |
| Maximale Dateigröße für Verlauf | Verlaufs-Snapshots für Dateien überspringen, die größer als dieser Schwellenwert sind | 512 KB | 256 KB, 512 KB, 1 MB, 5 MB, Unbegrenzt |

### Bilder

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Beim Einfügen automatisch skalieren | Große Bilder vor dem Speichern im Asset-Ordner automatisch skalieren. Der Wert ist die maximale Dimension in Pixeln | Aus | Aus, 800px, 1200px, 1920px (Full HD), 2560px (2K) |
| In Asset-Ordner kopieren | Eingefügte oder gezogene Bilder in den Asset-Ordner des Dokuments kopieren, anstatt sie einzubetten | Ein | Ein / Aus |
| Unbenutzte Bilder beim Schließen bereinigen | Bilder aus dem Asset-Ordner automatisch löschen, die beim Schließen nicht mehr im Dokument referenziert werden | Aus | Ein / Aus |
| Schwelle für eingebettete Bilder | Maximale Größe (MB) für das Einbetten von Bildern als base64-Daten-URLs im HTML-/PDF-Export. Größere Dateien werden stattdessen verlinkt | 1,0 MB | 0,1 – 10 MB |

### Große Dateien

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Warnen ab Größe | Beim Öffnen von Dateien oberhalb dieser Größe einen Bestätigungsdialog anzeigen | 5 MB | Ein / Aus |
| Auto-Quellmodus | Dateien oberhalb der Schwelle automatisch im Quellmodus öffnen (überspringt WYSIWYG für flüssige Performance) | Ein | Ein / Aus |

Siehe [Große Dateien](/guide/large-files) für die vollständige Aufschlüsselung des Umgangs mit großen Dateien.

### Updates

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Prüfintervall | Wann nach neuen VMark-Veröffentlichungen gesucht wird | Beim Start | Beim Start, Täglich, Wöchentlich, Manuell |
| Updates automatisch herunterladen | Release-Artefakte im Hintergrund herunterladen, sobald ein Update erkannt wird | Aus | Ein / Aus |
| Version überspringen | Unterdrückt die Update-Aufforderung für eine bestimmte Version (wird pro Update aus der Aufforderung selbst gesetzt) | Keine | — |

::: tip
Aktivieren Sie **Beim Einfügen automatisch skalieren**, wenn Sie häufig Screenshots oder Fotos einfügen — es hält Ihren Asset-Ordner ohne manuelles Skalieren leichtgewichtig.
:::

### Dokumentwerkzeuge

VMark erkennt [Pandoc](https://pandoc.org), um den Export in zusätzliche Formate zu ermöglichen (DOCX, EPUB, LaTeX und mehr). Klicken Sie auf **Erkennen**, um Pandoc auf Ihrem System zu suchen. Wenn gefunden, werden Version und Pfad angezeigt.

Unter [Export & Drucken](/de/guide/export) finden Sie Details zu allen Exportoptionen.

## Integrationen

MCP-Server- und KI-Anbieter-Konfiguration.

### MCP-Server

Der MCP-Server (Model Context Protocol) ermöglicht externen KI-Assistenten wie Claude Code und Cursor, VMark programmatisch zu steuern.

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| MCP-Server aktivieren | MCP-Server starten oder stoppen. Wenn er läuft, zeigt ein Status-Badge den Port und verbundene Clients | Ein (Umschalter) |
| Beim Start starten | Den MCP-Server beim Öffnen von VMark automatisch starten | Ein |
| Bearbeitungen automatisch genehmigen | Von KI initiierte Dokumentänderungen ohne Vorschau zur Genehmigung anwenden. Mit Vorsicht verwenden | Aus |

Wenn der Server läuft, zeigt der Bereich auch:
- **Port** — automatisch zugewiesen; KI-Clients erkennen ihn über die Konfigurationsdatei
- **Version** — MCP-Server-Sidecar-Version
- **Werkzeuge / Ressourcen** — Anzahl der verfügbaren MCP-Werkzeuge und Ressourcen
- **Verbundene Clients** — Anzahl der aktuell verbundenen KI-Clients

Unterhalb des MCP-Server-Abschnitts können Sie VMark's MCP-Konfiguration mit einem einzigen Klick in unterstützte KI-Clients (Claude Desktop, Claude Code, Codex CLI, Gemini CLI) installieren.

Unter [MCP-Setup](/de/guide/mcp-setup) und [MCP-Werkzeuge Referenz](/de/guide/mcp-tools) finden Sie vollständige Details.

### KI-Anbieter

Konfigurieren Sie, welcher KI-Anbieter [KI-Genies](/de/guide/ai-genies) betreibt. Es kann jeweils nur ein Anbieter aktiv sein.

**CLI-Anbieter** — Verwenden Sie lokal installierte KI-CLI-Werkzeuge (Claude, Codex, Gemini). Klicken Sie auf **Erkennen**, um Ihren `$PATH` nach verfügbaren CLIs zu durchsuchen. CLI-Anbieter verwenden Ihren Abonnement-Plan und benötigen keinen API-Schlüssel.

**REST-API-Anbieter** — Verbinden Sie sich direkt mit Cloud-APIs (Anthropic, OpenAI, Google AI, Ollama API). Jeder benötigt einen Endpunkt, API-Schlüssel und Modellnamen.

Unter [KI-Anbieter](/de/guide/ai-providers) finden Sie detaillierte Setup-Anweisungen für jeden Anbieter.

## Formate

Opt-in-Umschalter für nicht standardmäßige Format-Adapter sowie der explizite Befehl für den externen Editor als Ausstiegsmöglichkeit aus dem schreibgeschützten Code-Tab.

Markdown, Klartext und YAML/YML sind **immer** registriert — die ruhigen Standardwerte. Alle anderen Adapter sind **standardmäßig deaktiviert**, damit bestehende Benutzer beim Upgrade nicht überrascht werden. Schalten Sie einen Umschalter um, und die Registry wird sofort neu aufgebaut; geöffnete Tabs werden mit dem passenden Adapter neu gemountet — kein Neustart erforderlich.

Die vollständige Liste der Formate und ihrer Vorschauen finden Sie unter [Unterstützte Formate](/de/guide/formats).

### Formatunterstützung

| Umschalter | Standard | Aktiviert |
|---|---|---|
| **Datenformate** | Aus | `.json`, `.jsonl`, `.toml` — geteilter Bereich: Quelle + navigierbarer Baum. Schemagestützte Vorschauen für `Cargo.toml`, `package.json`, `pyproject.toml`. |
| **Diagramme & SVG** | Aus | `.mmd` (Mermaid) und `.svg` — geteilter Bereich: Quelle + bereinigtes Live-Rendering. |
| **HTML-Vorschau** | Aus | `.html` und `.htm` — sandboxed iframe-Vorschau (leeres `sandbox=""`, DOMPurify, CSP `<meta>`). OWASP Top-20 verifiziert — siehe [Sicherheitsmodell für HTML](/de/guide/formats#sicherheitsmodell-fur-html). |
| **Code-Betrachter** | Aus | 12 schreibgeschützte Betrachter (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua`). Öffnet in einem syntaxhervorgehobenen Betrachter mit den Schaltflächen **Bearbeitung aktivieren** und **In externem Editor öffnen**. |

Wenn eine Kategorie deaktiviert ist, fallen die zugehörigen Erweiterungen auf den Klartext-Fallback zurück, sodass die Datei trotzdem geöffnet wird — nur ohne Schemaansicht.

### Externer Editor

Für die Schaltfläche **In externem Editor öffnen** auf schreibgeschützten Code-Tabs wählen Sie den Editor, der gestartet werden soll. Ein App-Bundle (z. B. `/Applications/Visual Studio Code.app`) oder eine ausführbare Datei.

Die GUI-Einstellung überschreibt alle Umgebungsvariablen — explizit schlägt implizit. Lassen Sie das Feld leer, um die Fallback-Kette `$VMARK_EXTERNAL_EDITOR → $VISUAL → $EDITOR → Plattformstandard` zu nutzen. Unter [In externem Editor öffnen](/de/guide/formats#in-externem-editor-offnen) finden Sie die vollständige Auflösungsreihenfolge und Sicherheitsüberprüfung.

### Einmaliger Upgrade-Hinweis

Beim ersten Start nach dem Upgrade auf die Mehrformat-Unterstützung zeigt VMark einen nicht blockierenden Toast, der auf **Einstellungen → Formate** hinweist. Der Hinweis erscheint einmal pro Installation — nach dem Anzeigen (oder Verwerfen) erscheint er nie wieder.

## Sprache

CJK (Chinesisch, Japanisch, Koreanisch) Formatierungsregeln. Diese Regeln werden angewendet, wenn Sie **Format → CJK-Auswahl formatieren** (`Cmd+Shift+F`) auf einer Auswahl oder **Format → CJK-Dokument formatieren** (`Alt+Cmd+Shift+F`) auf der gesamten Datei ausführen.

::: tip
Der Sprach-Abschnitt enthält 20+ feinkörnige Formatierungs-Umschalter. Eine vollständige Erklärung jeder Regel mit Beispielen finden Sie unter [CJK-Formatierung](/de/guide/cjk-formatting).
:::

### Vollbreite-Normalisierung

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Vollbreite Buchstaben/Zahlen konvertieren | Vollbreite alphanumerische Zeichen in Halbbreite konvertieren (z. B. `ＡＢＣ` zu `ABC`) | Ein |
| Interpunktionsbreite normalisieren | Vollbreite Kommas und Punkte in Halbbreite konvertieren, wenn sie zwischen CJK-Zeichen stehen | Ein |
| Klammern konvertieren | Vollbreite Klammern in Halbbreite konvertieren, wenn der Inhalt CJK ist | Ein |
| Eckige Klammern konvertieren | Halbbreite eckige Klammern in Vollbreite `【】` konvertieren, wenn der Inhalt CJK ist | Aus |

### Abstände

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| CJK-Englisch-Abstände hinzufügen | Ein Leerzeichen zwischen CJK- und lateinischen Zeichen einfügen | Ein |
| CJK-Klammern-Abstände hinzufügen | Ein Leerzeichen zwischen CJK-Zeichen und Klammern einfügen | Ein |
| Währungsabstände entfernen | Zusätzlichen Abstand nach Währungssymbolen entfernen (z. B. `$ 100` wird zu `$100`) | Ein |
| Schrägstrich-Abstände entfernen | Leerzeichen um Schrägstriche entfernen (z. B. `A / B` wird zu `A/B`), URLs erhalten bleiben | Ein |
| Mehrere Leerzeichen reduzieren | Mehrere aufeinanderfolgende Leerzeichen auf ein einzelnes reduzieren | Ein |

### Gedankenstriche & Anführungszeichen

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Bindestriche konvertieren | Doppelte Bindestriche (`--`) zwischen CJK-Zeichen in Gedankenstriche (`——`) konvertieren | Ein |
| Gedankenstrich-Abstände korrigieren | Korrekte Abstände um Gedankenstriche sicherstellen | Ein |
| Gerade Anführungszeichen konvertieren | Gerade `"` und `'` in typografische (gebogene) Anführungszeichen konvertieren | Ein |
| Anführungsstil | Zielstil für die Konvertierung typografischer Anführungszeichen | Gebogen `""` `''` |
| Doppelte Anführungszeichen-Abstände korrigieren | Abstände um doppelte Anführungszeichen normalisieren | Ein |
| Einfache Anführungszeichen-Abstände korrigieren | Abstände um einfache Anführungszeichen normalisieren | Ein |
| CJK-Eckanführungszeichen | Gebogene Anführungszeichen für traditionellen chinesischen und japanischen Text in eckige Klammern `「」` konvertieren. Nur verfügbar, wenn Anführungsstil Gebogen ist | Aus |
| Verschachtelte Eckanführungszeichen | Verschachtelte einfache Anführungszeichen in `『』` innerhalb von `「」` konvertieren | Aus |

### Bereinigung

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Aufeinanderfolgende Interpunktion begrenzen | Wiederholte Satzzeichen wie `!!!` begrenzen | Aus | Aus, Einfach (`!!` zu `!`), Doppelt (`!!!` zu `!!`) |
| Abschließende Leerzeichen entfernen | Leerzeichen am Zeilenende entfernen | Ein | Ein / Aus |
| Auslassungspunkte normalisieren | Punkte mit Abstand (`. . .`) in korrekte Auslassungspunkte (`...`) konvertieren | Ein | Ein / Aus |
| Neue Zeilen reduzieren | Drei oder mehr aufeinanderfolgende neue Zeilen auf zwei reduzieren | Ein | Ein / Aus |

## Tastaturkürzel

Alle Tastaturkürzel anzeigen und anpassen. Tastaturkürzel sind nach Kategorien gruppiert (Datei, Bearbeiten, Ansicht, Format usw.).

- **Suche** — Tastaturkürzel nach Name, Kategorie oder Tastenkombination filtern
- **Auf ein Tastaturkürzel klicken**, um seine Tastenbindung zu ändern. Neue Kombination drücken, dann bestätigen
- **Zurücksetzen** — Ein einzelnes Tastaturkürzel auf seinen Standard zurücksetzen oder alle auf einmal zurücksetzen
- **Exportieren / Importieren** — Benutzerdefinierte Bindungen als JSON-Datei speichern und auf einem anderen Computer importieren

Unter [Tastaturkürzel](/de/guide/shortcuts) finden Sie die vollständige Standard-Tastaturkürzel-Referenz.

## Terminal

Konfigurieren Sie das integrierte Terminal-Panel. Öffnen Sie das Terminal mit `` Strg + ` ``.

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Shell | Welche Shell verwendet werden soll. Erfordert einen Terminal-Neustart, um wirksam zu werden | Systemstandard | Automatisch erkannte Shells auf Ihrem System (z. B. zsh, bash, fish) |
| Panel-Position | Wo das Terminal-Panel platziert werden soll | Auto | Auto (basierend auf Fenster-Seitenverhältnis), Unten, Rechts |
| Panel-Größe | Anteil des verfügbaren Platzes, den das Terminal einnimmt. Das Panel durch Ziehen zu ändern aktualisiert diesen Wert ebenfalls | 40% | 10% bis 80% |
| Schriftgröße | Textgröße im Terminal | 13px | 10px bis 24px |
| Zeilenhöhe | Vertikaler Abstand zwischen Terminalzeilen | 1,2 (Kompakt) | 1,0 (Eng) bis 2,0 (Extra) |
| Cursor-Stil | Form des Terminal-Cursors | Balken | Balken, Block, Unterstrichen |
| Cursor blinken | Ob der Terminal-Cursor blinkt | Ein | Ein / Aus |
| Bei Auswahl kopieren | Ausgewählten Terminaltext automatisch in die Zwischenablage kopieren | Aus | Ein / Aus |
| WebGL-Renderer | GPU-beschleunigtes Rendering für das Terminal verwenden. Deaktivieren bei IME-Eingabeproblemen. Erfordert Terminal-Neustart | Ein | Ein / Aus |

Unter [Integriertes Terminal](/de/guide/terminal) finden Sie mehr über Sitzungen, Tastaturkürzel und Shell-Umgebung.

## Über

Zeigt App-Version, Links zur Website und zum GitHub-Repository sowie Update-Verwaltung.

### Updates

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Automatische Updates | Beim Start automatisch nach Updates suchen | Ein |
| Jetzt prüfen | Manuell eine Update-Prüfung auslösen | — |

Wenn ein Update verfügbar ist, erscheint eine Karte mit der neuen Versionsnummer, dem Release-Datum und den Versionshinweisen. Sie können das Update **Herunterladen**, diese Version **Überspringen** oder — nach dem Download — **Neu starten zum Aktualisieren**.

## Erweitert

::: tip
Der Erweitert-Abschnitt ist standardmäßig ausgeblendet. Drücken Sie `Strg + Option + Cmd + D` im Einstellungsfenster, um ihn anzuzeigen.
:::

Entwickler- und systemebene Konfiguration.

### Link-Protokolle

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Benutzerdefinierte Link-Protokolle | Zusätzliche URL-Protokolle, die VMark beim Einfügen von Links erkennen soll. Jedes Protokoll als Tag eingeben | `obsidian`, `vscode`, `dict`, `x-dictionary` |

Damit können Sie Links wie `obsidian://open?vault=...` oder `vscode://file/...` erstellen, die VMark als gültige URLs behandelt.

### Leistung

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Beide Editoren aktiv halten | Sowohl den WYSIWYG- als auch den Quellmodus-Editor gleichzeitig mounten, für schnelleres Moduswechseln. Erhöht den Speicherverbrauch | Aus |

### Workflow-Engine

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Workflow-Engine | Den GitHub-Actions-Workflow-Viewer/-Editor für `.yml`/`.yaml`-Dateien unter `.github/workflows/` aktivieren. Wenn aus, werden diese Dateien als reines YAML geöffnet | Aus | Ein / Aus |
| YAML-Formatierung erhalten | Beim Speichern von Workflow-Bearbeitungen aus dem Formular-Panel die ursprünglichen YAML-Kommentare, Anker, Schlüsselreihenfolge und Leerzeilen über die CST-Roundtrip-Pipeline erhalten. Wenn aus, verwendet das Speichern einen kompakten Serialisierer (schneller, aber verlustbehaftet) | Ein | Ein / Aus |

Siehe [Workflow-Viewer](/guide/workflow-viewer) für den vollständigen Funktionsumfang.

### Plattformspezifisch

| Einstellung | Beschreibung | Standard | Plattformen |
|-------------|-------------|---------|-------------|
| macOS-Quarantäne beim Öffnen entfernen | Beim Öffnen einer Datei mit dem macOS-Quarantäne-Attribut (`com.apple.quarantine`) dieses vor dem Lesen entfernen. Hilfreich für aus dem Web heruntergeladene Dateien, deren Öffnen VMark sonst blockiert würde | Ein | macOS |
| Mac Option als Meta (Terminal) | Die macOS-Option-Taste im integrierten Terminal als Meta behandeln. Erforderlich für Werkzeuge wie emacs und tmux, die Alt-präfigierte Tastenkürzel erwarten | Aus | macOS |

### Entwicklerwerkzeuge

Wenn **Entwicklerwerkzeuge** aktiviert ist, erscheint ein **Hot Exit Dev Tools**-Panel mit Schaltflächen zum Testen von Sitzungserfassung, Inspektion, Wiederherstellung, Löschen und Neustart — nützlich zum Debuggen des Hot-Exit-Verhaltens während der Entwicklung.

## Siehe auch

- [Funktionen](/de/guide/features) — Überblick über VMark's Fähigkeiten
- [Tastaturkürzel](/de/guide/shortcuts) — Vollständige Tastaturkürzel-Referenz
- [CJK-Formatierung](/de/guide/cjk-formatting) — Detaillierte CJK-Formatierungsregeln
- [Integriertes Terminal](/de/guide/terminal) — Terminal-Sitzungen und Verwendung
- [KI-Anbieter](/de/guide/ai-providers) — KI-Anbieter-Setup-Leitfaden
- [MCP-Setup](/de/guide/mcp-setup) — MCP-Server-Konfiguration für KI-Assistenten
