# Arbeitsbereichsverwaltung

Ein Arbeitsbereich in VMark ist ein Ordner, der als Stammverzeichnis Ihres Projekts geöffnet wird. Wenn Sie einen Arbeitsbereich öffnen, zeigt die Seitenleiste eine Dateistruktur, Quick Open indiziert jede Markdown-Datei, das Terminal startet im Projektstammverzeichnis und Ihre geöffneten Tabs werden für das nächste Mal gespeichert.

Ohne einen Arbeitsbereich können Sie weiterhin einzelne Dateien öffnen, verlieren aber den Datei-Explorer, die projekteigene Suche und die Sitzungswiederherstellung.

## Arbeitsbereich öffnen

| Methode | Wie |
|---------|-----|
| Menü | **Datei > Arbeitsbereich öffnen** |
| Quick Open | `Mod + O`, dann unten **Durchsuchen...** auswählen |
| Drag-and-Drop | Eine Markdown-Datei aus dem Finder in das Fenster ziehen — VMark erkennt das Projektstammverzeichnis und öffnet den Arbeitsbereich automatisch |
| Zuletzt geöffnete Arbeitsbereiche | **Datei > Zuletzt geöffnete Arbeitsbereiche** und ein früheres Projekt auswählen |

Wenn Sie einen Arbeitsbereich öffnen, zeigt VMark die Seitenleiste mit dem Datei-Explorer. Wenn der Arbeitsbereich zuvor geöffnet war, werden die vorherigen Tabs wiederhergestellt.

::: tip
Wenn das aktuelle Fenster nicht gespeicherte Änderungen hat, bietet VMark an, den Arbeitsbereich in einem neuen Fenster zu öffnen, anstatt Ihre Arbeit zu ersetzen.
:::

## Datei-Explorer

Der Datei-Explorer erscheint in der Seitenleiste, wenn ein Arbeitsbereich geöffnet ist. Er zeigt eine Baumstruktur von Markdown-Dateien, die im Arbeitsbereichsordner verwurzelt ist.

### Navigation

- **Einfacher Klick** auf einen Ordner zum Auf- oder Zuklappen
- **Doppelklick** oder **Eingabe** auf eine Datei, um sie in einem Tab zu öffnen
- Nicht-Markdown-Dateien werden mit der Standardanwendung des Systems geöffnet

### Dateioperationen

Rechtsklick auf eine Datei oder einen Ordner für das Kontextmenü:

| Aktion | Beschreibung |
|--------|--------------|
| Öffnen | Datei in einem neuen Tab öffnen |
| Umbenennen | Datei- oder Ordnernamen inline bearbeiten (auch `F2`) |
| Duplizieren | Eine Kopie der Datei erstellen |
| Verschieben nach... | Datei über einen Dialog in einen anderen Ordner verschieben |
| Löschen | Datei oder Ordner in den Systempapierkopf verschieben |
| Pfad kopieren | Den absoluten Dateipfad in die Zwischenablage kopieren |
| Im Finder anzeigen | Die Datei im Finder anzeigen (macOS) |
| Neue Datei | Eine neue Markdown-Datei an dieser Stelle erstellen |
| Neuer Ordner | Einen neuen Ordner an dieser Stelle erstellen |

Sie können Dateien auch **per Drag-and-Drop** direkt in der Baumstruktur zwischen Ordnern verschieben.

### Sichtbarkeitsschalter

Standardmäßig zeigt der Explorer nur Markdown-Dateien und blendet Dotfiles aus. Zwei Schalter ändern dies:

| Schalter | Kürzel | Was er bewirkt |
|----------|--------|----------------|
| Versteckte Dateien anzeigen | `Mod + Umschalt + .` (macOS) / `Strg + H` (Win/Linux) | Zeigt Dotfiles und versteckte Ordner |
| Alle Dateien anzeigen | *(Einstellungen oder Kontextmenü)* | Zeigt Nicht-Markdown-Dateien neben Dokumenten |

Beide Einstellungen werden pro Arbeitsbereich gespeichert und bleiben über Sitzungen hinweg erhalten.

### Ausgeschlossene Ordner

Bestimmte Ordner sind standardmäßig aus der Baumstruktur ausgeschlossen:

- `.git`
- `node_modules`

Diese Standardwerte werden beim ersten Öffnen eines Arbeitsbereichs angewendet.

## Quick Open

`Mod + O` drücken, um das Quick Open-Overlay zu öffnen. Es bietet Fuzzy-Suche über drei Quellen:

1. **Zuletzt verwendete Dateien**, die Sie zuvor geöffnet haben
2. **Geöffnete Tabs** im aktuellen Fenster (mit einem Punktindikator markiert)
3. **Alle Markdown-Dateien** im Arbeitsbereich

Einige Zeichen eingeben, um zu filtern — die Übereinstimmung ist fuzzy, daher findet `rme` `README.md`. Pfeiltasten zur Navigation und **Eingabe** zum Öffnen verwenden. Eine angeheftete **Durchsuchen...**-Zeile am unteren Rand öffnet einen Dateidialog.

| Aktion | Kürzel |
|--------|--------|
| Quick Open öffnen | `Mod + O` |
| Ergebnisse navigieren | `Auf / Ab` |
| Ausgewählte Datei öffnen | `Eingabe` |
| Schließen | `Escape` |

::: tip
Ohne einen Arbeitsbereich funktioniert Quick Open weiterhin — es zeigt zuletzt geöffnete Dateien und geöffnete Tabs, kann aber nicht die Dateistruktur durchsuchen.
:::

## Inhaltssuche im Arbeitsbereich

Wenn ein Arbeitsbereich geöffnet ist, kann VMark **Dateiinhalte** (nicht nur Dateinamen) nach Übereinstimmungen in Markdown- und Textdateien durchsuchen.

| Aktion | Kürzel |
|---|---|
| Inhaltssuche-Panel öffnen | `Mod + Shift + F` |
| Zum nächsten Treffer springen | `Eingabe` (oder Pfeiltasten zum Navigieren) |
| Treffer in neuem Tab öffnen | Auf die Treffervorschau klicken |

Jedes Ergebnis zeigt den Dateipfad, die Zeilennummer und einen Ausschnitt mit hervorgehobenem Treffertext. Die Treffer werden sortiert nach:

1. Relevanz des Dateinamens (Dateien, die den Begriff im Namen tragen, zuerst)
2. Nähe zur Überschrift (Treffer in Überschriften vor Treffern im Fließtext)
3. Aktualität (kürzlich geänderte Dateien zuerst)

**Standardmäßig ausgeschlossen**: `node_modules/`, `.git/`, `dist/`, `target/`, `coverage/` sowie alle Verzeichnisse, die Sie unter **Ausgeschlossene Ordner** in den Arbeitsbereichseinstellungen hinzugefügt haben.

**Versteckte Dateien**: werden übersprungen, sofern **Versteckte Dateien anzeigen** im Datei-Explorer nicht aktiviert ist.

Dies unterscheidet sich von [Quick Open](#quick-open), das nur *Dateinamen* durchsucht — die Inhaltssuche öffnet die getroffene Datei und platziert den Cursor an der Trefferstelle.

## Zuletzt geöffnete Arbeitsbereiche

VMark merkt sich bis zu 10 zuletzt geöffnete Arbeitsbereiche. Diese sind über **Datei > Zuletzt geöffnete Arbeitsbereiche** in der Menüleiste zugänglich.

- Arbeitsbereiche werden nach zuletzt geöffneter Zeit sortiert (neueste zuerst)
- Die Liste wird bei jeder Änderung mit dem nativen Menü synchronisiert
- **Zuletzt geöffnete Arbeitsbereiche löschen** auswählen, um die Liste zurückzusetzen

## Arbeitsbereichseinstellungen

Jeder Arbeitsbereich hat seine eigene Konfiguration, die zwischen Sitzungen erhalten bleibt. Einstellungen werden im VMark-Anwendungsdatenverzeichnis gespeichert — nicht im Projektordner — damit Ihr Arbeitsbereich sauber bleibt.

Die folgenden Einstellungen werden pro Arbeitsbereich gespeichert:

| Einstellung | Beschreibung |
|-------------|--------------|
| Ausgeschlossene Ordner | Im Datei-Explorer ausgeblendete Ordner |
| Versteckte Dateien anzeigen | Ob Dotfiles sichtbar sind |
| Alle Dateien anzeigen | Ob Nicht-Markdown-Dateien sichtbar sind |
| Zuletzt geöffnete Tabs | Dateipfade für die Sitzungswiederherstellung beim nächsten Öffnen |

::: tip
Die Arbeitsbereichskonfiguration ist an den Ordnerpfad gebunden. Das Öffnen desselben Ordners auf demselben Rechner stellt immer Ihre Einstellungen wieder her, auch aus einem anderen Fenster.
:::

## Sitzungswiederherstellung

Wenn Sie ein Fenster schließen, das einen geöffneten Arbeitsbereich hat, speichert VMark die Liste der geöffneten Tabs in der Arbeitsbereichskonfiguration. Wenn Sie denselben Arbeitsbereich das nächste Mal öffnen, werden diese Tabs automatisch wiederhergestellt.

- Nur Tabs mit einem gespeicherten Dateipfad werden wiederhergestellt (unbenannte Tabs werden nicht gespeichert)
- Wenn eine Datei seit der letzten Sitzung verschoben oder gelöscht wurde, wird sie lautlos übersprungen
- Sitzungsdaten werden beim Schließen des Fensters und beim Schließen des Arbeitsbereichs gespeichert (`Datei > Arbeitsbereich schließen`)

## Mehrfachfenster

Jedes VMark-Fenster kann seinen eigenen unabhängigen Arbeitsbereich haben. So können Sie gleichzeitig an mehreren Projekten arbeiten.

- **Datei > Neues Fenster** öffnet ein frisches Fenster
- Das Öffnen eines Arbeitsbereichs in einem neuen Fenster beeinflusst andere Fenster nicht
- Fenstergröße und -position werden pro Fenster gespeichert

Wenn Sie eine Markdown-Datei aus dem Finder ziehen und das aktuelle Fenster nicht gespeicherte Arbeit hat, öffnet VMark das Projekt der Datei automatisch in einem neuen Fenster.

### Tabs in neue Fenster ablösen

Sie können einen Tab aus seinem Fenster herausziehen, um ein neues zu erstellen:

- **Einen Tab nach unten ziehen** über die Tab-Leiste hinaus (ca. 40 px), um ihn in ein neues Fenster an der Cursorposition abzulösen
- **Einen Tab horizontal ziehen** innerhalb der Tab-Leiste, um ihn unter anderen Tabs umzuordnen
- Angeheftete Tabs können nicht gezogen werden

Die Geste ist richtungsgebunden: Horizontale Bewegung startet eine Neuanordnung, während vertikale Bewegung eine Ablösung auslöst. Sie können mitten im Ziehen von Neuanordnung zu Ablösung wechseln, indem Sie den Zeiger außerhalb der Tab-Leiste bewegen.

## Externe Änderungen

VMark überwacht Ihren Arbeitsbereich auf Änderungen, die von anderen Programmen vorgenommen werden (Git, externe Editoren, Build-Tools usw.) und hält geöffnete Dokumente synchron.

- **Unveränderte Dateien** werden automatisch neu geladen, wenn sich ihr Inhalt auf der Festplatte ändert. Eine kurze Toast-Benachrichtigung bestätigt das Neuladen.
- **Dateien mit nicht gespeicherten Änderungen** lösen einen Dialog mit drei Optionen aus: **Speichern unter** (Ihre Version an einem neuen Speicherort speichern), **Neu laden** (Ihre Änderungen verwerfen und von der Festplatte laden) oder **Behalten** (Ihre Bearbeitungen beibehalten und die Datei als abweichend markieren).
- **Gelöschte Dateien** werden in ihrem Tab als fehlend markiert, aber nicht geschlossen — Sie können den Inhalt weiterhin an einem neuen Speicherort speichern.
- Wenn mehrere geänderte Dateien gleichzeitig auf der Festplatte geändert werden (z. B. nach einem `git checkout`), fasst VMark sie in einen einzigen Dialog zusammen, damit Sie alle neu laden, alle behalten oder jede Datei einzeln überprüfen können.
- Wenn der Festplatteninhalt einer abweichenden Datei später mit dem übereinstimmt, was Sie im Editor haben (z. B. ein `git checkout` stellt denselben Text wieder her), löscht VMark automatisch den abweichenden Status, sodass das normale automatische Speichern wieder aufgenommen wird.

VMark filtert seine eigenen Speichervorgänge heraus, sodass Sie nie durch Änderungen aufgefordert werden, die Sie innerhalb der App vorgenommen haben.

## macOS Dock — Letzte Dokumente

Dokumente, die Sie in VMark öffnen, werden bei macOS registriert, sodass sie im Untermenü **Zuletzt benutzte Objekte** erscheinen, wenn Sie mit der rechten Maustaste auf das VMark-Symbol im Dock klicken.

## Terminal-Integration

Das integrierte Terminal verwendet automatisch das Arbeitsbereichsstammverzeichnis als Arbeitsverzeichnis. Wenn Sie Arbeitsbereiche öffnen oder wechseln, wechseln alle Terminal-Sitzungen per `cd` zum neuen Stammverzeichnis.

Die Umgebungsvariable `VMARK_WORKSPACE` wird in jeder Terminal-Sitzung auf den Arbeitsbereichspfad gesetzt, damit Ihre Skripte das Projektstammverzeichnis referenzieren können.

[Mehr über das Terminal erfahren →](/de/guide/terminal)

## Shell-CLI-Befehl

VMark kann einen `vmark`-Shell-Befehl installieren, damit Sie Dateien und Ordner vom Terminal aus öffnen können.

### Installation

Gehen Sie zu **Hilfe > Befehl 'vmark' installieren**. VMark schreibt ein kleines Startskript nach `/usr/local/bin/vmark` und fragt nach Ihrem Administratorkennwort (derselbe Ansatz, den VS Code für seinen `code`-Befehl verwendet).

### Verwendung

```bash
# Eine Datei öffnen
vmark README.md

# Einen Ordner als Arbeitsbereich öffnen
vmark ~/projects/my-blog

# Mehrere Dateien öffnen
vmark chapter1.md chapter2.md
```

Der Befehl delegiert an `open -b app.vmark`, sodass macOS das Einzelinstanz-Verhalten handhabt — Dateien werden in Ihrem bestehenden VMark-Fenster geöffnet, anstatt einen neuen Prozess zu starten.

### Deinstallation

Gehen Sie zu **Hilfe > Befehl 'vmark' deinstallieren**, um `/usr/local/bin/vmark` zu entfernen. Wenn die Datei an diesem Pfad nicht von VMark installiert wurde, wird der Vorgang blockiert und Sie werden aufgefordert, sie manuell zu entfernen.
