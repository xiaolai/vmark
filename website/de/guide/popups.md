# Inline-Popups

VMark bietet kontextbezogene Popups zum Bearbeiten von Links, Bildern, Medien, Mathematik, Fußnoten und mehr. Diese Popups funktionieren sowohl im WYSIWYG- als auch im Quellmodus mit einheitlicher Tastaturnavigation.

## Gemeinsame Tastaturkürzel

Alle Popups teilen dieses Tastaturverhalten:

| Aktion | Kürzel |
|--------|--------|
| Schließen/Abbrechen | `Escape` |
| Bestätigen/Speichern | `Eingabe` |
| Felder navigieren | `Tab` / `Umschalt + Tab` |

## Link-Popup

Ein Klick auf einen Link zeigt sein Bearbeitungs-Popup. Der Cursor bleibt dort, wo Sie geklickt haben, sodass Sie den Linktext weiter bearbeiten können — Tippen, `Backspace` und Kopieren/Einfügen wirken alle auf das Dokument. Das Popup schließt sich, sobald Sie den Text bearbeiten oder den Cursor aus dem Link bewegen.

### Bestehenden Link bearbeiten

**Auslöser:** Auf einen Link klicken oder Cursor im Link platzieren + `Mod + K`

Nach einem Klick bleibt die Tastatur im Dokument; klicken Sie in das URL-Feld, um das Ziel zu bearbeiten. `Mod + K` setzt den Fokus direkt in das URL-Feld.

**Felder:**
- **URL** — Link-Ziel bearbeiten
- **Ziel öffnen** — Öffnet eine externe URL im Browser, springt bei `#bookmark`-Links zur Überschrift oder öffnet bei dateiübergreifenden Links eine lokale Datei in einem neuen Tab
- **Kopieren** — URL in die Zwischenablage kopieren
- **Löschen** — Link entfernen, Text behalten

**Ohne Popup öffnen:** `Cmd + Klick` (`Strg + Klick` unter Windows/Linux) auf einen Link öffnet sein Ziel direkt.

### Neuen Link erstellen

**Auslöser:** Text auswählen + `Mod + K`

**Intelligente Zwischenablage:** Wenn Ihre Zwischenablage eine URL enthält, wird sie automatisch eingetragen.

**Felder:**
- **URL-Eingabe** — Ziel eingeben
- **Bestätigen** — Eingabe drücken oder ✓ klicken
- **Abbrechen** — Escape drücken oder ✗ klicken

### Quellmodus

- **`Cmd + Klick`** (`Strg + Klick` unter Windows/Linux) auf Link → externe URLs öffnen im Browser, `#bookmark`-Links springen zur Überschrift, und lokale Dateipfade öffnen die Datei in einem neuen Tab
- **Klick** auf `[text](url)`-Syntax → Bearbeitungs-Popup anzeigen; der Cursor bleibt im Markdown, sodass Sie weitertippen können
- **`Mod + K`** innerhalb Link → Bearbeitungs-Popup mit Fokus im URL-Feld anzeigen

::: tip Lesezeichen-Links
Links, die mit `#` beginnen, werden als Lesezeichen (interne Überschriften-Links) behandelt. Öffnen springt zur Überschrift anstatt einen Browser zu öffnen.
:::

::: tip Dateiübergreifende Links
Links auf lokale Dateien öffnen die Zieldatei in einem neuen Tab und springen zur Überschrift, wenn der Link ein `#fragment` enthält. Relative Pfade wie `../appendix/cards.md` oder `./notes.md` werden relativ zum Verzeichnis des aktuellen Dokuments aufgelöst. Absolute Pfade — `/Users/me/notes/a.md` unter macOS/Linux, `C:\notes\a.md` unter Windows — öffnen genau die Datei, die sie benennen. Netzwerkpfade (`\\server\share\…`) werden aus Links nicht geöffnet. Ist das Dokument unbenannt, können nur absolute Pfade geöffnet werden.
:::

## Überschriftenauswahl (Lesezeichen-Links)

**Auslöser:** `Alt + Mod + B` (Lesezeichen-Link), **Einfügen → Links → Lesezeichen** oder die Link-Gruppe der Universellen Symbolleiste

Ein Lesezeichen-Link verweist auf eine Überschrift im selben Dokument (`[text](#heading-id)`). Statt den Anker einzutippen, listet die Auswahl jede Überschrift des Dokuments auf, nach Ebene eingerückt, mit einem Filterfeld oben.

**Verhalten:**
- `↑`/`↓` bewegen sich durch die Liste, `Eingabe` fügt den Link ein, `Escape` schließt
- Ist Text ausgewählt, wird die Auswahl zum Linktext; ohne Auswahl wird der Text der Überschrift selbst als Link eingefügt
- Das Popup weist darauf hin, wenn das Dokument keine Überschriften hat oder nichts zum Filter passt

## Medien-Popup (Bilder, Video, Audio)

Ein einheitliches Popup zum Bearbeiten aller Medientypen — Bilder, Video und Audio.

### Bearbeitungs-Popup

**Auslöser:** Doppelklick auf ein beliebiges Medienelement (Bild, Video oder Audio)

**Gemeinsame Felder (alle Medientypen):**
- **Quelle** — Dateipfad oder URL

**Typspezifische Felder:**

| Feld | Bild | Video | Audio |
|------|------|-------|-------|
| Alternativtext | Ja | — | — |
| Titel | — | Ja | Ja |
| Poster | — | Ja | — |
| Abmessungen | Nur-Lese | — | — |
| Inline/Block-Umschalter | Ja (nicht für verlinkte Bilder) | — | — |

**Schaltflächen:**
- **Durchsuchen** — Datei aus dem Dateisystem auswählen
- **Kopieren** — Quellpfad in die Zwischenablage kopieren
- **Löschen** — Das Medienelement entfernen

**Kürzel:**
- `Mod + Umschalt + I` — Neues Bild einfügen
- `Eingabe` — Änderungen speichern
- `Escape` — Popup schließen

### Quellmodus

Im Quellmodus öffnet das Klicken auf Bildsyntax `![alt](path)` dasselbe Medien-Popup.

Der Quellmodus zeigt außerdem eine schwebende **Vorschau** des Mediums — ein Bild oder einen Video- bzw. Audioplayer mit nativen Wiedergabe-Steuerelementen. Sie erscheint, solange der Cursor innerhalb von `![alt](path)` steht (ohne ausgewählten Text), und wenn die Maus über der Syntax schwebt; die Vorschau des Cursors hat Vorrang vor der Hover-Vorschau. Der Pfad muss auf eine erkannte Bild-, Video- oder Audioendung enden (oder eine `data:image/`-URL sein). Die Vorschau wird ausgeblendet, solange das Medien-Popup geöffnet ist.

## Bild-Kontextmenü

Rechtsklick auf ein Bild im WYSIWYG-Modus öffnet ein Kontextmenü mit Schnellaktionen (getrennt vom Doppelklick-Bearbeitungs-Popup).

**Auslöser:** Rechtsklick auf ein beliebiges Bild

**Aktionen:**
| Aktion | Beschreibung |
|--------|--------------|
| Bild ändern | Dateiauswahl öffnen, um das Bild zu ersetzen |
| Bild löschen | Das Bild aus dem Dokument entfernen |
| Pfad kopieren | Den Quellpfad des Bildes in die Zwischenablage kopieren |
| Im Finder anzeigen | Den Speicherort der Bilddatei im Dateimanager öffnen (Beschriftung passt sich je nach Plattform an) |

`Escape` drücken, um das Kontextmenü ohne Aktion zu schließen.

## Mathematik-Popup

LaTeX-Mathematikausdrücke mit Live-Vorschau bearbeiten.

**Auslöser:**
- **WYSIWYG:** Auf Inline-Mathematik `$...$` klicken
- **Quelle:** Cursor innerhalb eines nicht leeren `$...$`, eines `$$...$$`-Blocks oder eines ` ```latex `- / ` ```math `-Blocks platzieren

**Felder:**
- **LaTeX-Eingabe** — Den Mathematikausdruck bearbeiten
- **Vorschau** — Echtzeit-gerenderte Vorschau
- **Fehleranzeige** — Zeigt LaTeX-Fehler mit hilfreichen Syntaxhinweisen

**Kürzel:**
- `Mod + Eingabe` — Speichern und schließen
- `Click outside` — Speichern und schließen (übernimmt Ihre Änderungen)
- `Escape` — Abbrechen und schließen (verwirft Ihre Änderungen)
- `Umschalt + Rücktaste` — Inline-Mathematik löschen (funktioniert auch bei nicht-leerem Inhalt, nur WYSIWYG)
- `Alt + Mod + M` — Neue Inline-Mathematik einfügen

::: tip Fehlerhinweise
Bei einem LaTeX-Syntaxfehler zeigt das Popup hilfreiche Vorschläge wie fehlende Klammern, unbekannte Befehle oder unausgeglichene Begrenzer.
:::

::: info Quellmodus
Der Quellmodus bietet dasselbe bearbeitbare Mathematik-Popup wie der WYSIWYG-Modus — ein Textfeld für die LaTeX-Eingabe mit einer Live-KaTeX-Vorschau darunter. Das Popup öffnet sich automatisch, wenn der Cursor in eine beliebige Mathematik-Syntax eintritt (ein nicht leeres `$...$`, `$$...$$` oder ` ```latex ` / ` ```math `). Drücken Sie `Mod + Eingabe` zum Speichern oder `Escape` zum Abbrechen. Ein leeres `$$`, das am Zeilenende getippt wird, gilt als normaler Text — wahrscheinlich ein halb getippter Begrenzer für Blockmathematik — und öffnet das Popup nicht.
:::

## Fußnoten-Popup

Fußnoteninhalt inline bearbeiten.

**Auslöser:**
- **WYSIWYG:** Über Fußnotenreferenz `[^1]` hovern
- **Quelle:** Über eine Fußnotenreferenz oder -definition hovern oder darauf klicken

**Felder:**
- **Inhalt** — Mehrzeiliger Fußnotentext (automatische Größenanpassung)
- **Zur Definition springen** — Zur Fußnotendefinition springen
- **Löschen** — Fußnote entfernen

**Verhalten:**
- Neue Fußnoten fokussieren automatisch das Inhaltsfeld
- Textarea erweitert sich beim Tippen

## Wiki-Link-Popup

Wiki-Stil-Links für interne Dokumentverbindungen bearbeiten.

**Auslöser:**
- **WYSIWYG:** Über `[[ziel]]` hovern (300ms Verzögerung)
- **Quelle:** Auf Wiki-Link-Syntax klicken

**Felder:**
- **Ziel** — Arbeitsbereich-relativer Pfad (`.md`-Erweiterung automatisch behandelt)
- **Durchsuchen** — Datei aus dem Arbeitsbereich auswählen
- **Öffnen** — Verlinktes Dokument öffnen
- **Kopieren** — Zielpfad kopieren
- **Löschen** — Wiki-Link entfernen

## Tabellen-Kontextmenü

Schnelle Tabellen-Bearbeitungsaktionen.

**Auslöser:**
- **WYSIWYG:** Rechtsklick auf eine Tabellenzelle (dieselben Aktionen gibt es auch in der Symbolleiste und als Tastaturkürzel)
- **Quelle:** Rechtsklick auf eine Tabellenzelle

**Aktionen:**
| Aktion | Beschreibung |
|--------|--------------|
| Zeile darüber/darunter einfügen | Zeile am Cursor hinzufügen |
| Spalte links/rechts einfügen | Spalte am Cursor hinzufügen |
| Zeile löschen | Aktuelle Zeile entfernen |
| Spalte löschen | Aktuelle Spalte entfernen |
| Tabelle löschen | Gesamte Tabelle entfernen |
| Spalte links/zentriert/rechts ausrichten | Ausrichtung für aktuelle Spalte festlegen |
| Alle links/zentriert/rechts ausrichten | Ausrichtung für alle Spalten festlegen |
| Tabelle formatieren | Tabellenspalten automatisch ausrichten (Markdown verschönern) |
| An Breite anpassen / Natürliche Breite | Nur WYSIWYG: diese Tabelle mit inhaltsproportionalen Spalten an die Editorbreite anheften oder auf ihre natürliche Breite zurücksetzen |

## Rechtschreibprüfungs-Popup

Rechtschreibfehler mit Vorschlägen korrigieren.

**Auslöser:**
- Rechtsklick auf falsch geschriebenes Wort (rote Unterstreichung)

**Aktionen:**
- **Vorschläge** — Klicken, um durch Vorschlag zu ersetzen
- **Zum Wörterbuch hinzufügen** — Aufhören, als falsch geschrieben zu markieren

## Text durch Ziehen verschieben

Im WYSIWYG-Modus können Sie eine Auswahl mit der Maus verschieben: Drücken Sie auf den ausgewählten Text, ziehen Sie — ein Ablage-Cursor zeigt, wo er landen wird — und lassen Sie los. Das Verschieben ist ein einziger rückgängig zu machender Schritt (`Mod + Z` stellt ihn zurück). Drücken Sie während des Ziehens `Escape` oder lassen Sie das Fenster den Fokus verlieren, um abzubrechen. VMark implementiert dies selbst, weil die Desktop-Shell die nativen Drag-Ereignisse des Browsers abfängt; deshalb ist es eine Mausgeste und kein systemweites Drag & Drop.

## Modusvergleich

| Element | WYSIWYG-Bearbeitung | Quelle |
|---------|---------------------|--------|
| Link | Klick / `Mod+K` / `Cmd+Klick` zum Öffnen | Klick / `Mod+K` / `Cmd+Klick` zum Öffnen |
| Bild | Doppelklick | Klick auf `![](path)` |
| Video | Doppelklick | — |
| Audio | Doppelklick | — |
| Mathematik | Klick | Cursor in Mathematik → Popup |
| Fußnote | Hover | Direkte Bearbeitung |
| Wiki-Link | Hover | Klick |
| Tabelle | Symbolleiste | Rechtsklick-Menü |
| Rechtschreibprüfung | Rechtsklick | Rechtsklick |

## Popup-Navigationstipps

### Fokusfluss
1. Popup öffnet sich mit fokussiertem ersten Eingabefeld
2. `Tab` bewegt vorwärts durch Felder und Schaltflächen
3. `Umschalt + Tab` bewegt rückwärts
4. Fokus bleibt innerhalb des Popups

### Schnelle Bearbeitung
- Für einfache URL-Änderungen: bearbeiten und `Eingabe` drücken
- Zum Abbrechen: `Escape` aus einem beliebigen Feld drücken
- Für mehrzeiligen Inhalt (Fußnoten, Mathematik): `Mod + Eingabe` zum Speichern verwenden

### Mausverhalten
- Außerhalb des Popups klicken zum Schließen. Standardmäßig werden nicht gespeicherte
  Änderungen **verworfen**; das Mathematik-Popup ist eine Ausnahme und **übernimmt** die Änderung beim
  Klick außerhalb (siehe Abschnitt [Mathematik-Popup](#mathematik-popup)).
- Hover-Popups (Fußnote, Wiki) haben 300ms Verzögerung vor dem Anzeigen
- Maus zurück zum Popup bewegen hält es offen

<!-- Styles in style.css -->
