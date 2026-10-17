# Große Dateien

VMark öffnet die meisten Markdown-Dateien sofort, doch sehr große Dateien benötigen besondere Behandlung, damit der Editor reaktionsfähig bleibt. Diese Seite beschreibt, wie VMark damit umgeht und wie Sie das Verhalten anpassen können.

## Was als „groß" gilt

VMark stuft eine Datei vor dem Öffnen anhand ihrer Größe ein:

| Größe | Stufe | Was passiert |
|-------|-------|--------------|
| < 1 MB | Klein | Öffnet sich sofort im WYSIWYG-Modus (Rich-Text). |
| 1 MB – 5 MB | Groß | Öffnet sich standardmäßig im **Quellmodus** — im Sub-Sekunden-Bereich. Die Statusleiste bietet „Zu WYSIWYG wechseln" an. |
| 5 MB – 50 MB | Riesig | Zuerst erscheint ein Bestätigungsdialog. Öffnet sich nur im Quellmodus. |
| ≥ 50 MB | Abgelehnt | VMark verweigert das Öffnen der Datei. Verwenden Sie stattdessen `less`, `bat` oder ein ähnliches Werkzeug. |

Die Größe wird über das Betriebssystem geprüft, ohne die Datei zu lesen, sodass die Entscheidung schnell ist und keine Daten vorab geladen werden.

## Warum Quellmodus für große Dateien

Der Quellmodus nutzt CodeMirror mit Viewport-Virtualisierung — nur der sichtbare Teil des Dokuments wird gerendert. Der WYSIWYG-Modus verwendet Tiptap/ProseMirror, das für jeden Block im Dokument einen DOM-Knoten aufbauen muss. Bei einer 1,4 MB großen Markdown-Datei mit etwa 2.250 Blöcken dauert das beim ersten Öffnen rund 15 Sekunden; der Quellmodus öffnet dieselbe Datei in weniger als einer Sekunde.

Die meiste Zeit kosten Aufbau und Layout der Ansicht, nicht das Parsen. Bei einem langen CJK-Dokument, gemessen auf einem langsamen Rechner, machte das Parsen zwischen einem Viertel und zwei Fünfteln der Öffnungskosten des Editors aus.

## Während ein Dokument geöffnet wird

Ein Fenster reagiert auf Menüs, Tastenkürzel und die Schließen-Schaltfläche, bevor VMark die Rich-Text-Ansicht des Dokuments aufbaut; das Dokument erscheint kurz danach. Früher wurde ein langes Dokument zuerst aufgebaut, und auf einem langsamen Rechner konnte das verhindern, dass das Fenster bereit wurde: Menüs reagierten verzögert, und im Protokoll stand *menu commands did not mount within 5000ms*.

Auch was WYSIWYG beim Öffnen tut, bleibt im Verhältnis zum Dokument:

- Bilder werden geladen, wenn sie in die Nähe des sichtbaren Bereichs kommen.
- **CJK-Buchstabenabstand** (**Einstellungen → Editor → Typografie**) tut nichts, solange er ausgeschaltet ist (die Voreinstellung), und durchsucht das Dokument nur einmal, wenn er eingeschaltet ist.
- Dekorationen wie Code-Hervorhebung, CJK-Abstand und Lint-Markierungen kosten ungefähr linear in der Länge des Dokuments. Sehr lange Dokumente kosteten früher quadratisch.

## Hinweise in der Statusleiste

- **Beim Öffnen einer großen Datei in WYSIWYG:** Ein unbestimmter Spinner mit der Beschriftung *„Große Datei wird geöffnet (N MB)…"* erscheint links in der Statusleiste, während der Editor geladen wird. Er verschwindet, sobald der Editor interaktiv ist.
- **Datei automatisch im Quellmodus geöffnet:** Die Statusleiste zeigt *„Im Quellmodus geöffnet (große Datei)."* mit einem Link **Zu WYSIWYG wechseln**. Ein Klick auf den Link wechselt den aktiven Tab in den WYSIWYG-Modus. Wird die Datei geschlossen und erneut geöffnet, kehrt sie in den Quellmodus zurück — die Übersteuerung gilt pro Sitzung.
- **Dokument, das WYSIWYG nicht darstellen kann:** Ein Dokument mit Zitaten oder Listen, die mehr als 1000 Ebenen tief verschachtelt sind, lässt sich unabhängig von seiner Größe nicht als Rich Text einlesen. Es öffnet sich im Quellmodus mit einer Meldung, die die Tiefe nennt, und die Statusleiste zeigt *„Im Quelltextmodus geöffnet (in WYSIWYG nicht darstellbar)."* Verringern Sie die Verschachtelung und verwenden Sie dann **Zu WYSIWYG wechseln**.

## Einstellungen

Öffnen Sie **Einstellungen → Editor → Große Dateien**:

- **Dateien über 1 MB automatisch im Quellmodus öffnen** *(standardmäßig aktiviert)* — deaktivieren Sie diese Option, wenn Sie WYSIWYG für Dateien bis zu 5 MB bevorzugen und die längere Öffnungszeit in Kauf nehmen.
- **Vor dem Öffnen von Dateien über 5 MB warnen** *(standardmäßig aktiviert)* — deaktivieren Sie diese Option, um den Bestätigungsdialog für Dateien zwischen 5 MB und 50 MB zu überspringen. Sie werden weiterhin im Quellmodus geöffnet.

Die harte 50-MB-Grenze ist nicht vom Benutzer einstellbar. Die Webview kann beliebig große Zeichenketten nicht sicher halten, ohne Out-of-Memory-Abstürze zu riskieren.

## Tipps

- Müssen Sie eine sehr große Datei weiter in WYSIWYG bearbeiten, sollten Sie sie in kleinere, von einem Indexdokument verlinkte Dateien aufteilen. Markdown eignet sich gut als Sammlung kleinerer Kapitel.
- Wenn Sie eine große Datei nur lesen oder durchsuchen müssen, ist der Quellmodus mit dem Zeilennummern-Lineal und `Find` (`Mod + F`) meist der schnellste Arbeitsablauf.
- **Format → CJK → Gesamte Datei formatieren** und andere ganzdokumentbezogene Befehle laufen auch auf Quellmodus-Dokumenten korrekt.

## Edge Cases

- **Datei wächst während des Öffnens.** VMark entscheidet die Stufe anhand der Größe zum Öffnungszeitpunkt. Eine Datei, die während der Bearbeitung auf 2 MB anwächst, bleibt in dem Modus, den Sie gewählt haben.
- **Symlinks.** Größenangaben beziehen sich auf die Zieldatei, ein Symlink auf eine 10-MB-Datei wird also als riesig behandelt.
- **Leere Dateien.** Null-Byte-Dateien gelten als klein und öffnen sich in WYSIWYG.
- **Datei verschwindet zwischen Größencheck und Lesen.** Der gewohnte „Datei nicht gefunden"-Fehler erscheint — keine zusätzliche Warnung.

## Bekannte Einschränkungen

- Die Schwellen sind Byte-Größen, also ein Stellvertreter für die tatsächlichen Kosten (Block-Anzahl). Eine 600 KB große Datei mit Tausenden kurzer Blöcke kann langsamer sein als eine 1,2 MB große Datei mit langen Absätzen. Die Standardwerte sind konservativ.
- WYSIWYG baut beim Öffnen weiterhin jeden Block des Dokuments auf — nur Bilder und Inline-Formeln warten, bis sie in die Nähe des sichtbaren Bereichs kommen —, daher kostet der Wechsel einer großen Datei zu WYSIWYG die oben beschriebene volle Öffnungszeit.
