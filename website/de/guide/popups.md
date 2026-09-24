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
- **Öffnen** — Link im Browser öffnen
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

- **`Cmd + Klick`** (`Strg + Klick` unter Windows/Linux) auf Link → externe URLs öffnen im Browser, `#Lesezeichen`-Links springen zur Überschrift, und lokale Dateipfade öffnen die Datei in einem neuen Tab
- **Klick** auf `[Text](url)`-Syntax → Bearbeitungs-Popup anzeigen; der Cursor bleibt im Markdown, sodass Sie weitertippen können
- **`Mod + K`** innerhalb Link → Bearbeitungs-Popup mit Fokus im URL-Feld anzeigen

::: tip Lesezeichen-Links
Links, die mit `#` beginnen, werden als Lesezeichen (interne Überschriften-Links) behandelt. Öffnen springt zur Überschrift anstatt einen Browser zu öffnen.
:::

::: tip Dateiübergreifende Links
Links auf lokale Dateien öffnen die Zieldatei in einem neuen Tab und springen zur Überschrift, wenn der Link ein `#fragment` enthält. Relative Pfade wie `../appendix/cards.md` oder `./notes.md` werden relativ zum Verzeichnis des aktuellen Dokuments aufgelöst. Absolute Pfade — `/Users/me/notes/a.md` unter macOS/Linux, `C:\notes\a.md` unter Windows — öffnen genau die Datei, die sie benennen. Netzwerkpfade (`\\server\share\…`) werden aus Links nicht geöffnet. Ist das Dokument unbenannt, können nur absolute Pfade geöffnet werden.
:::

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

Im Quellmodus öffnet das Klicken auf Bildsyntax `![alt](pfad)` dasselbe Medien-Popup. Mediendateien (Video-/Audioendungen) zeigen eine schwebende Vorschau mit nativen Wiedergabe-Steuerelementen beim Hovern.

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
- **Quelle:** Cursor innerhalb von `$...$`, `$$...$$` oder ` ```latex `-Blöcken platzieren

**Felder:**
- **LaTeX-Eingabe** — Den Mathematikausdruck bearbeiten
- **Vorschau** — Echtzeit-gerenderte Vorschau
- **Fehleranzeige** — Zeigt LaTeX-Fehler mit hilfreichen Syntaxhinweisen

**Kürzel:**
- `Mod + Eingabe` — Speichern und schließen
- `Escape` — Abbrechen und schließen
- `Umschalt + Rücktaste` — Inline-Mathematik löschen (funktioniert auch bei nicht-leerem Inhalt, nur WYSIWYG)
- `Alt + Mod + M` — Neue Inline-Mathematik einfügen

::: tip Fehlerhinweise
Bei einem LaTeX-Syntaxfehler zeigt das Popup hilfreiche Vorschläge wie fehlende Klammern, unbekannte Befehle oder unausgeglichene Begrenzer.
:::

::: info Quellmodus
Der Quellmodus bietet dasselbe bearbeitbare Mathematik-Popup wie der WYSIWYG-Modus — ein Textfeld für die LaTeX-Eingabe mit einer Live-KaTeX-Vorschau darunter. Das Popup öffnet sich automatisch, wenn der Cursor in eine Mathematik-Syntax eintritt (`$...$`, `$$...$$` oder ` ```latex `). Drücken Sie `Mod + Eingabe` zum Speichern oder `Escape` zum Abbrechen.
:::

## Fußnoten-Popup

Fußnoteninhalt inline bearbeiten.

**Auslöser:**
- **WYSIWYG:** Über Fußnotenreferenz `[^1]` hovern

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
- **WYSIWYG:** Symbolleiste oder Tastaturkürzel verwenden
- **Quelle:** Rechtsklick auf Tabellenzelle

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

## Rechtschreibprüfungs-Popup

Rechtschreibfehler mit Vorschlägen korrigieren.

**Auslöser:**
- Rechtsklick auf falsch geschriebenes Wort (rote Unterstreichung)

**Aktionen:**
- **Vorschläge** — Klicken, um durch Vorschlag zu ersetzen
- **Zum Wörterbuch hinzufügen** — Aufhören, als falsch geschrieben zu markieren

## Modusvergleich

| Element | WYSIWYG-Bearbeitung | Quelle |
|---------|---------------------|--------|
| Link | Klick / `Mod+K` / `Cmd+Klick` zum Öffnen | Klick / `Mod+K` / `Cmd+Klick` zum Öffnen |
| Bild | Doppelklick | Klick auf `![](pfad)` |
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
- Außerhalb des Popups klicken zum Schließen (Änderungen werden verworfen)
- Hover-Popups (Fußnote, Wiki) haben 300ms Verzögerung vor dem Anzeigen
- Maus zurück zum Popup bewegen hält es offen

<!-- Styles in style.css -->
