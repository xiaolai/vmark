# Arbeitsbereichsverwaltung

Ein Arbeitsbereich in VMark ist ein Ordner, der als Stammverzeichnis Ihres Projekts geöffnet wird. Wenn Sie einen Arbeitsbereich öffnen, zeigt die Seitenleiste eine Dateistruktur, Quick Open kann jede Datei finden, die die Dateistruktur anzeigt, das Terminal startet im Projektstammverzeichnis und Ihre geöffneten Tabs werden für das nächste Mal gespeichert.

Ohne einen Arbeitsbereich können Sie weiterhin einzelne Dateien öffnen, verlieren aber den Datei-Explorer, die projekteigene Suche und die Sitzungswiederherstellung.

::: tip Mehrere Arbeitsbereiche in einem Fenster
Mit der experimentellen [Workspace-Leiste](/de/guide/workspace-rail) kann ein einzelnes Fenster mehrere Arbeitsbereiche enthalten und zwischen ihnen wechseln — jeder mit eigenen Tabs, eigener Dateistruktur und eigenem Layout.
:::

## Arbeitsbereich öffnen

| Methode | Wie |
|---------|-----|
| Menü | **Datei > Arbeitsbereich öffnen** |
| Quick Open | `Mod + O`, dann unten **Durchsuchen...** auswählen |
| Drag-and-Drop | Eine Markdown-Datei aus dem Finder in das Fenster ziehen — VMark erkennt das Projektstammverzeichnis und öffnet den Arbeitsbereich automatisch |
| Zuletzt geöffnete Arbeitsbereiche | **Datei > Zuletzt geöffnete Arbeitsbereiche** und ein früheres Projekt auswählen |

Wenn Sie einen Arbeitsbereich öffnen, zeigt VMark die Seitenleiste mit dem Datei-Explorer. Wenn der Arbeitsbereich zuvor geöffnet war, werden die vorherigen Tabs wiederhergestellt.

Unter Windows und Linux öffnet sich ein auf der Befehlszeile übergebener Ordner (`vmark C:\notes` oder `vmark ~/notes`) als Arbeitsbereich in einem eigenen Fenster, so wie das Ablegen eines Ordners auf dem Dock-Symbol unter macOS. Das funktioniert auch, wenn VMark bereits läuft.

::: tip
Wenn das aktuelle Fenster nicht gespeicherte Änderungen hat, bietet VMark an, den Arbeitsbereich in einem neuen Fenster zu öffnen, anstatt Ihre Arbeit zu ersetzen.
:::

## Datei-Explorer

Der Datei-Explorer erscheint in der Seitenleiste, wenn ein Arbeitsbereich geöffnet ist. Er zeigt eine Baumstruktur von Markdown-Dateien, die im Arbeitsbereichsordner verwurzelt ist.

### Navigation

- **Einfacher Klick** auf einen Ordner zum Auf- oder Zuklappen
- **Einfacher Klick** auf eine Datei, um sie in einem Tab zu öffnen
- **Eingabe** (oder `F2`) auf einem ausgewählten Element startet das Umbenennen direkt im Baum
- Dateien, die VMark nicht selbst bearbeitet (sichtbar mit **Alle Dateien anzeigen**), werden mit der Standardanwendung des Systems geöffnet
- Ordner sind beim ersten Öffnen eines Arbeitsbereichs eingeklappt; ihr Auf-/Zuklappzustand bleibt erhalten, während Sie zwischen den Ansichten Dateien, Gliederung und Verlauf wechseln

### Quick Look

Wählen Sie eine Datei in der Baumstruktur aus und drücken Sie die `Leertaste`, um sie in einer Überlagerung über das ganze Fenster in der Vorschau anzuzeigen, ohne einen Tab zu öffnen — Bilder, Videos und Audio werden mit ihren nativen Bedienelementen dargestellt; jede andere Datei zeigt ein Feld „Dieses Format kann nicht in der Vorschau angezeigt werden“ mit einer Schaltfläche, um sie extern zu öffnen. `←`/`↑` und `→`/`↓` gehen die sichtbaren Dateien der Baumstruktur der Reihe nach durch (ohne Umlauf), und `Leertaste`, `Escape` oder ein Klick auf den Hintergrund schließt die Vorschau. Ein Leerzeichen im Inline-Umbenennungsfeld löst sie nie aus.

### Kopfzeilen-Schaltflächen

Die Kopfzeile der Dateien-Ansicht enthält die Steuerelemente für die gesamte Baumstruktur:

- **Alle Ordner ausklappen** — öffnet jeden Ordner der Baumstruktur
- **Alle Ordner einklappen** — schließt jeden Ordner bis zum Stammverzeichnis
- **Alle Dateien anzeigen** — ein Umschalter; ist er eingeschaltet (hervorgehoben), listet
  die Baumstruktur jede Datei auf statt nur derjenigen, die VMark öffnen kann
- **Neue Datei** / **Neuer Ordner** — erstellt das Element im ausgewählten Ordner oder,
  wenn nichts ausgewählt ist, im Stammverzeichnis des Arbeitsbereichs

### Dateioperationen

Rechtsklick auf eine Datei, einen Ordner oder die leere Fläche unterhalb der Baumstruktur für das Kontextmenü:

| Aktion | Angezeigt für | Beschreibung |
|--------|---------------|--------------|
| Öffnen | Dateien | Datei in einem neuen Tab öffnen |
| Umbenennen | Dateien, Ordner | Datei- oder Ordnernamen inline bearbeiten (auch `F2`) |
| Duplizieren | Dateien | Eine Kopie der Datei erstellen |
| Verschieben nach... | Dateien | Datei über einen Dialog in einen anderen Ordner verschieben |
| Löschen | Dateien, Ordner | Datei oder Ordner in den Papierkorb des Systems verschieben |
| Pfad kopieren | Dateien, Ordner | Den absoluten Pfad in die Zwischenablage kopieren |
| Im Finder anzeigen | Dateien, Ordner | Das Element in Ihrem Dateimanager anzeigen — unter Windows mit **Im Explorer anzeigen** und unter Linux mit **Im Dateimanager anzeigen** beschriftet |
| Neue Datei | Ordner, leere Fläche | Eine neue Markdown-Datei an dieser Stelle erstellen |
| Neuer Ordner | Ordner, leere Fläche | Einen neuen Ordner an dieser Stelle erstellen |
| Terminal hier öffnen | Ordner | Eine neue Terminal-Sitzung in diesem Ordner starten (deaktiviert, sobald 5 Sitzungen geöffnet sind) — siehe [Terminal](/de/guide/terminal) |

Sie können Dateien auch **per Drag-and-Drop** direkt in der Baumstruktur zwischen Ordnern verschieben.

### Sichtbarkeitsschalter

Standardmäßig zeigt der Explorer nur die Dateitypen, die VMark öffnen kann, und blendet Dotfiles aus.
**Ordner werden aufgeführt, ob sie etwas Sichtbares enthalten oder nicht**, sodass ein Projekt mit
nicht unterstützten Dateitypen wie eine Baumstruktur leerer Ordner aussieht — das ist der Filter bei
der Arbeit, kein Fehler beim Lesen des Verzeichnisses. Zwei Schalter ändern dies:

| Schalter | Kürzel | Was er bewirkt |
|----------|--------|----------------|
| Versteckte Dateien anzeigen | `Mod + Umschalt + .` (macOS) / `Strg + H` (Win/Linux) | Zeigt Dotfiles und versteckte Ordner |
| Alle Dateien anzeigen | `Mod + Umschalt + A` | Zeigt Nicht-Markdown-Dateien neben Dokumenten |

Beide Einstellungen werden pro Arbeitsbereich gespeichert und bleiben über Sitzungen hinweg erhalten.

### Ausgeschlossene Ordner

Manche Verzeichnisse werden nie durchlaufen, ganz gleich, was die Arbeitsbereichseinstellungen
sagen — dieselbe Untergrenze, die auch die Arbeitsbereichssuche anwendet: `.git`, `node_modules`,
`.obsidian`, `.svn`, `__pycache__`, `.DS_Store`, `.vscode`, `.idea`, `target`, `.next`,
`dist`, `.superpowers`. Sie erscheinen weiterhin als Ordner, damit Sie wissen, dass es sie gibt;
ihr Inhalt wird nicht gelesen. Eigene Namen fügen Sie unter **Ausgeschlossene Ordner** in den
Arbeitsbereichseinstellungen hinzu (ein neuer Arbeitsbereich beginnt dort mit `.git` und `node_modules`).

Die Baumstruktur wird in einem Durchgang eingelesen und aktualisiert, wenn sich Dateien ändern.
Eine Serie von Änderungen aktualisiert sie einmal, kurz nachdem die Serie endet; ein Ordner, der
sich ununterbrochen ändert (ein laufender Download, ein Build, eine Synchronisierung), wird in
wachsenden Abständen statt fortlaufend aktualisiert, sodass der Explorer nie einen CPU-Kern damit
auslastet, einen geschäftigen Arbeitsbereich neu einzulesen.

## Quick Open

`Mod + O` drücken, um das Quick Open-Overlay zu öffnen. Es bietet Fuzzy-Suche über drei Quellen, in dieser Reihenfolge aufgeführt:

1. **Geöffnete Tabs** im aktuellen Fenster (mit einem Punktindikator markiert), zuletzt verwendete zuerst
2. **Zuletzt verwendete Dateien**, die Sie zuvor geöffnet haben
3. **Jede Datei, die der Datei-Explorer gerade anzeigt**, im Arbeitsbereich

Bevor Sie tippen, zeigt die Liste nur geöffnete Tabs und zuletzt verwendete Dateien. Sobald Sie tippen, erscheinen Ergebnisse aus allen drei Quellen, in dieser Reihenfolge gruppiert und innerhalb jeder Gruppe nach Übereinstimmungsqualität sortiert.

Einige Zeichen eingeben, um zu filtern — die Übereinstimmung ist fuzzy, daher findet `rme` `README.md`. Pfeiltasten zur Navigation und **Eingabe** zum Öffnen verwenden. Eine angeheftete **Durchsuchen...**-Zeile am unteren Rand öffnet einen Dateidialog.

Die dritte Quelle folgt exakt dem Datei-Explorer, sodass sich die beiden nie darüber
widersprechen, was existiert. Schalten Sie **Versteckte Dateien anzeigen** ein, und Quick Open
findet Dokumente unter `.claude/`, `.github/workflows/` und jedem anderen Punkt-Verzeichnis;
schalten Sie **Alle Dateien anzeigen** ein, und es findet auch die Nicht-Markdown-Dateien und
öffnet jede so, wie es ein Klick in der Seitenleiste täte — VMarks eigene Formate in einem Tab,
alles andere in der Standardanwendung Ihres Systems. Ordner auf der Liste der immer
übersprungenen Verzeichnisse (`.git`, `node_modules`, `.vscode` und die übrigen) bleiben aus
beiden heraus.

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

Wenn ein Arbeitsbereich geöffnet ist, kann VMark **Dateiinhalte** (nicht nur Dateinamen) durchsuchen. Standardmäßig durchsucht es die Dateitypen, die VMark öffnet (Markdown, Klartext, YAML sowie JSON/TOML/Mermaid/SVG/HTML, wenn deren Formatunterstützung eingeschaltet ist). Schalten Sie den Umschalter **.md** (**Nur unterstützte Dateitypen**) aus, um jede Textdatei zu durchsuchen (Binärdateien werden immer übersprungen).

| Aktion | Kürzel |
|---|---|
| Inhaltssuche-Panel öffnen | `Mod + Umschalt + H` (auch **Bearbeiten → Suchen → In Dateien suchen**) |
| Zum nächsten Treffer springen | `Eingabe` (oder Pfeiltasten zum Navigieren) |
| Treffer in neuem Tab öffnen | Auf die Treffervorschau klicken |

Jedes Ergebnis zeigt den Dateipfad, die Zeilennummer und einen Ausschnitt mit hervorgehobenem Treffertext. Die Ergebnisse werden nicht sortiert: Dateien erscheinen in der Reihenfolge, in der die Suche sie beim Durchlaufen der Arbeitsbereichsordner erreicht. Eine Suche endet nach 50 Dateien mit Treffern, 1.000 Treffern oder 5 Sekunden und zeigt, was sie bis dahin gefunden hat.

**Standardmäßig ausgeschlossen**: die Ordner, die VMark nie durchsucht — `.git`, `node_modules`, `.obsidian`, `.svn`, `__pycache__`, `.DS_Store`, `.vscode`, `.idea`, `target`, `.next`, `dist`, `.superpowers` — sowie alle Namen unter **Ausgeschlossene Ordner** in den Arbeitsbereichseinstellungen (ein neuer Arbeitsbereich beginnt dort mit `.git` und `node_modules`).

**Versteckte Dateien**: Dotfiles werden von der Inhaltssuche immer übersprungen, unabhängig davon, was der Schalter **Versteckte Dateien anzeigen** im Datei-Explorer sagt.

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

## Leeres Arbeitsbereichsfenster

Das Schließen des letzten geöffneten Dokuments schließt das Fenster nicht mehr. Stattdessen bleibt das Fenster mit einem **Willkommensbildschirm** geöffnet, und — wenn ein Arbeitsbereich geöffnet ist — bleiben dessen Seitenleiste und Dateistruktur sichtbar. Das funktioniert unter macOS, Windows und Linux gleich.

Der Willkommensbildschirm bietet Schnellaktionen, um wieder an die Arbeit zu gehen:

- Die Schaltflächen **Neue Datei**, **Datei öffnen** und **Arbeitsbereich öffnen…**
- Eine Liste **Zuletzt verwendete Dateien** und eine Liste **Zuletzt verwendete Arbeitsbereiche** —
  klicken Sie auf einen Eintrag, um ihn wieder zu öffnen. Jede Liste erscheint nur, wenn sie Einträge hat.

**Datei öffnen** und die Zuletzt-Listen verwenden das Fenster, in dem Sie sich bereits befinden. Ein
Fenster mit Willkommensbildschirm hat keine Tabs, die verdrängt würden, daher öffnet sich nichts in einem
zweiten Fenster — es sei denn, im Fenster ist noch ein Arbeitsbereich geöffnet; dann erhält eine Datei
von außerhalb dieses Arbeitsbereichs ein eigenes Fenster, statt die Dateistruktur zu ersetzen, die Sie
noch in der Seitenleiste sehen.

Die Titelleiste eines Fensters mit Willkommensbildschirm lautet **VMark**: Es ist kein Dokument
geöffnet, also gibt es keinen Dateinamen anzuzeigen.

Um das Fenster selbst zu schließen, verwenden Sie die rote Ampel-Schaltfläche, `Cmd/Strg + Q` (Beenden) oder drücken Sie erneut `Cmd/Strg + W`, während der Willkommensbildschirm angezeigt wird.

## Dokumente nebeneinander

Öffnen Sie zwei **verschiedene** Dokumente gleichzeitig — teilen Sie den Editor in zwei Bereiche, jeder
mit seinem eigenen Dokument. Nützlich zum zweisprachigen Lesen oder Übersetzen (Original auf der einen
Seite, Übersetzung auf der anderen) oder um beim Schreiben eine Referenz geöffnet zu halten.
Das unterscheidet sich von der **Markdown-Split-Ansicht** (`Umschalt + F6`), die Quelltext
und Vorschau *derselben* Datei zeigt.

- Schalten Sie die Teilung mit **`Alt + Mod + \`** oder über die Befehlspalette um
  (**Editor teilen — zwei Dokumente**). Das aktuelle Dokument bleibt in einem Bereich,
  und das Dokument, das Sie davor zuletzt verwendet haben (oder, falls es keines gibt, ein anderes geöffnetes Dokument), öffnet sich im anderen — dasselbe
  Dokument wird nie doppelt angezeigt, daher braucht die Teilung zwei geöffnete Dokumente.
  Klicken Sie auf einen Tab, während ein Bereich fokussiert ist, um das Dokument dieses Bereichs zu wechseln, oder
  klicken Sie mit der rechten Maustaste auf einen Tab und wählen Sie **Seitlich öffnen**.
- Ziehen Sie den Trenner (oder fokussieren Sie ihn und verwenden Sie die Pfeiltasten), um die Größe der Bereiche zu ändern.
- Der Bereich, den Sie bearbeiten, ist der **fokussierte** Bereich — Symbolleiste, Suchleiste und
  Menübefehle wirken auf ihn.
- Schalten Sie **Bildlauf zwischen geteilten Bereichen synchronisieren** (Befehlspalette) ein, um beide
  Seiten proportional gemeinsam zu scrollen — praktisch, um eine Übersetzung auszurichten.

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

### Eine Datei von außerhalb des aktuellen Arbeitsbereichs öffnen

Ein Fenster mit geöffnetem Arbeitsbereich behält diesen Arbeitsbereich. Das Öffnen einer Datei, die
woanders liegt — aus dem Finder oder Explorer, über `Datei > Öffnen` oder aus den zuletzt verwendeten
Dateien —, öffnet sie in einem **neuen Fenster** mit ihrem eigenen Ordner als Stammverzeichnis, sodass
die Dateistruktur, in der Sie gearbeitet haben, bleibt, wo sie ist. Nur ein Fenster ohne eigenen
Arbeitsbereich übernimmt die Datei an Ort und Stelle.

Unter Windows und Linux übergibt ein Doppelklick auf eine Datei, deren Typ mit VMark verknüpft ist,
diese jetzt an das bereits laufende VMark, statt eine zweite Instanz zu starten. Unter macOS hat es
schon immer so funktioniert.

### Tabs in neue Fenster ablösen

Sie können einen Tab aus seinem Fenster herausziehen, um ein neues zu erstellen:

- **Einen Tab aus der Tab-Leiste ziehen** — mehr als etwa 40 px darüber oder darunter —, um ihn abzulösen. Lassen Sie ihn über einem anderen VMark-Fenster los, um den Tab in dieses Fenster zu verschieben; lassen Sie ihn irgendwo anders los, um ihn in einem neuen Fenster am Zeiger zu öffnen
- **Einen Tab horizontal ziehen** innerhalb der Tab-Leiste, um ihn unter anderen Tabs umzuordnen
- Angeheftete Tabs können nicht gezogen werden

Eine Toast-Benachrichtigung bestätigt das Verschieben und bietet **Rückgängig** an, womit der Tab zurückkehrt. Browser-Tabs und der letzte Tab des Hauptfensters können nicht herausgezogen werden; sie schnappen stattdessen zurück.

Die Geste ist richtungsgebunden: Horizontale Bewegung startet eine Neuanordnung, während vertikale Bewegung eine Ablösung auslöst. Sie können mitten im Ziehen von Neuanordnung zu Ablösung wechseln, indem Sie den Zeiger außerhalb der Tab-Leiste bewegen.

### Fensterstatus-Panel

Wenn Sie Claude Code in mehreren Fenstern ausführen, öffnet **Ansicht > Fensterstatus umschalten** (auch in der Befehlspalette, oder drücken Sie `Strg + Umschalt + 5`) ein Panel, das jedes andere geöffnete Fenster mit seinem aktuellen Status auflistet und Sie direkt dorthin springen lässt.

Jede Zeile zeigt den Dokumentnamen des Fensters und seinen aktuellen Status:

| Status | Bedeutung |
|--------|-----------|
| **Benötigt Aufmerksamkeit** | Ein Terminal in diesem (nicht fokussierten) Fenster hat die Glocke ausgelöst — Claude Code löst sie aus, wenn eine Runde endet oder es auf Sie wartet |
| **Läuft** | In diesem Fenster läuft gerade ein VMark-KI-Genie |
| **Fehler** | Der letzte Lauf eines KI-Genies ist fehlgeschlagen |
| **Inaktiv** | Nichts läuft |

Die Zeilen sind nach Dringlichkeit sortiert, sodass das Fenster, das Sie braucht, ganz oben steht. Klicken Sie auf eine Zeile, um dieses Fenster zu fokussieren und in den Vordergrund zu holen; das Fokussieren eines Fensters löscht seine Markierung „Benötigt Aufmerksamkeit“. Der Status stammt aus zwei zuverlässigen Signalen — VMarks eigenem Aufrufstatus der KI-Genies und der Terminal-Glocke —, nicht aus dem Auswerten der Terminal-Ausgabe.

**Heften Sie das Panel an**, um es als dauerhafte „Einsatzzentrale“ zu nutzen: Solange es angeheftet ist, fokussiert ein Klick auf eine Zeile das Zielfenster, lässt das Panel aber geöffnet, sodass Sie zwischen mehreren Fenstern hin- und herspringen können, ohne es erneut zu öffnen. Die Anheften-Schaltfläche in der Kopfzeile öffnet ein kleines Menü mit zwei Geltungsbereichen:

- **Dieses Fenster anheften** — heftet das Panel nur im aktuellen Fenster an. Sein Geöffnet- und Angeheftet-Zustand wird pro Fenster über Neustarts hinweg gespeichert, sodass ein Fenster, das Sie als Dashboard eingerichtet haben, so bleibt.
- **Alle Fenster anheften** — ein globales Anheften: Jedes Fenster öffnet das Panel automatisch und verhält sich wie angeheftet, *auch Fenster, die Sie später öffnen*, sodass Sie das Einsatzzentralen-Layout einmal wählen, statt jedes Fenster von Hand einzurichten. Wenn Sie es ausschalten, kehrt jedes Fenster zu seinem eigenen fensterbezogenen Anheften-Zustand zurück.

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

Das integrierte Terminal verwendet automatisch das Arbeitsbereichsstammverzeichnis als Arbeitsverzeichnis. Wenn Sie Arbeitsbereiche öffnen oder wechseln, wechseln untätige Terminal-Sitzungen per `cd` zum neuen Stammverzeichnis. Eine Sitzung, die gerade einen Befehl ausführt, bleibt unberührt und wechselt das Verzeichnis, sobald der Befehl beendet ist (dafür ist Shell-Integration nötig, um zu erkennen, wann sie beschäftigt ist). Mit eingeschalteter [Workspace-Leiste](/de/guide/workspace-rail) behält eine Sitzung, die zu einem Arbeitsbereich gehört, ihr eigenes Verzeichnis.

Die Umgebungsvariable `VMARK_WORKSPACE` wird in jeder Terminal-Sitzung auf den Arbeitsbereichspfad gesetzt, damit Ihre Skripte das Projektstammverzeichnis referenzieren können.

[Mehr über das Terminal erfahren →](/de/guide/terminal)

## Shell-CLI-Befehl

VMark kann einen `vmark`-Shell-Befehl installieren, damit Sie Dateien und Ordner vom Terminal aus öffnen können.

### Installieren und entfernen

**Hilfe → Shell-Befehl: 'vmark' in PATH installieren...** ist ein einzelner Eintrag, der umschaltet. Ist kein `vmark`-Befehl installiert, schreibt er ein kleines Startskript nach `/usr/local/bin/vmark` und fragt nach Ihrem Administratorkennwort (derselbe Ansatz, den VS Code für seinen `code`-Befehl verwendet). Liegt dort bereits VMarks eigenes Skript, entfernt derselbe Eintrag es. In beiden Fällen meldet ein Dialog das Ergebnis. Nur macOS.

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

Wenn die Datei unter `/usr/local/bin/vmark` nicht von VMark geschrieben wurde, verändert der Eintrag nichts und fordert Sie auf, sie manuell zu entfernen.
