# Wissensdatenbank & Slidev

VMark kann Ihren gesamten Arbeitsbereich als durchsuchbare, querverlinkte
Wissensdatenbank bereitstellen und [Slidev](https://sli.dev)-Präsentationen in
der Vorschau zeigen und exportieren — beides angetrieben von einem einzigen
lokalen Content-Server, den VMark bei Bedarf startet.

::: warning Status
Diese Funktion wird schrittweise eingeführt, und **kein Release-Build auf
irgendeiner Plattform enthält die Content-Server-Laufzeit**, von der sie abhängt
— siehe [Voraussetzungen](#voraussetzungen). Deshalb ist sie **ausgeblendet,
solange der Entwicklermodus nicht aktiv ist**: Der Menüpunkt im Ansicht-Menü, der
Eintrag in der Befehlspalette und das Tastenkürzel `Strg + Umschalt + 4` erscheinen
erst, wenn Sie **Einstellungen → Erweitert → Entwickler-Tools** aktivieren.
Schalten Sie das ein und öffnen Sie das Panel **Wissensdatenbank**, um zu sehen,
was auf Ihrem Rechner vorhanden ist und was fehlt.
:::

## Voraussetzungen

Die Wissensdatenbank, ihr Beziehungsgraph, die Suche, das Live-Neuladen und die
Slidev-Vorschau laufen alle auf einem lokalen Content-Server — einem separaten
Node.js-Programm, das VMark bei Bedarf startet. Zwei Dinge müssen vorhanden sein,
bevor er starten kann:

- **Node.js.** VMark löst `node` über den `PATH` Ihrer Login-Shell auf, so wie es
  ein Terminal tun würde; ein Node.js, das nur ein projektlokales Werkzeug sieht,
  zählt also nicht. Installieren Sie es so, dass `node` im `PATH` Ihrer
  Login-Shell liegt.
- **Der Content-Server selbst** (`server/content` im VMark-Repository, gebaut zu
  einer `cli.js`). **Noch kein paketierter VMark-Build enthält ihn — auf keiner
  Plattform.** Das ist keine Lücke von Linux oder Windows: Auch das macOS-DMG
  liefert keine Content-Server-Laufzeit mit, und die Release-Prüfungen von VMark
  stellen genau das bei jedem Release sicher. Bis es eine Lösung für die
  Auslieferung gibt, erfordert die Funktion eine Entwicklungsumgebung — einen
  Checkout von VMark mit gebautem Content-Server, bereitgestellt über die
  Umgebungsvariable `VMARK_CONTENT_SERVER_CLI` (oder eine `base-kb`-Laufzeit,
  die Sie von Hand in den Anwendungsdaten von VMark ablegen; VMark lädt nie eine herunter).

Das Panel prüft beides beim Öffnen. Fehlt eines davon, sagt es, welches, und was
es bereitstellen würde, statt einen Start zu versuchen, der nicht gelingen kann.

## Das Panel öffnen

Die Wissensdatenbank ist **standardmäßig ausgeblendet**, weil ein Release-Build
sie nicht starten kann. Um sie einzublenden, aktivieren Sie **Einstellungen →
Erweitert → Entwickler-Tools**. Der Menüpunkt **Ansicht → Wissensdatenbank**, der
Eintrag in der Befehlspalette („Wissensdatenbank umschalten“) und das
Tastenkürzel `Strg + Umschalt + 4` erscheinen damit zusammen und verschwinden
wieder, wenn Sie die Einstellung ausschalten.

Mit aktivierten Entwickler-Tools öffnen Sie das Panel über **Ansicht →
Wissensdatenbank**, die Befehlspalette oder `Strg + Umschalt + 4`. Das Panel dockt
rechts an; schalten Sie es erneut um, um es auszublenden.

Wenn Sie die Entwickler-Tools wieder ausschalten, werden die Einstiegspunkte
wieder ausgeblendet und das Panel mit ihnen geschlossen: Das Panel hat keine
eigene Schließen-Schaltfläche, und ein offen gelassenes Panel wäre ein Dock, das
sich durch nichts mehr schließen ließe. Ein Server, der bereits **läuft**, bleibt
unangetastet — schalten Sie die Entwickler-Tools wieder ein, um seine
Stopp-Schaltfläche zu erreichen; beim Beenden stoppt VMark seine Content-Server
ohnehin.

## Wissensdatenbank

Öffnen Sie einen Arbeitsbereich und starten Sie das Panel **Wissensdatenbank**.
VMark startet einen lokalen Server, der an `127.0.0.1` gebunden ist (nur
Loopback), und rendert jede Markdown-Datei als HTML mit derselben
Markdown-Semantik wie der Editor — Wiki-Links, Hinweisboxen, Mathematik,
Tabellen, Aufgabenlisten und Details werden alle identisch dargestellt.

Fähigkeiten:

- **Wiki-Link-Navigation** — `[[Page]]`, `[[dir/Page]]`, `[[Page#Heading]]` und
  `[[Page|Alias]]` werden über den gesamten Arbeitsbereich aufgelöst. Nicht
  aufgelöste Links werden als „fehlend“ dargestellt, damit Lücken sichtbar sind.
- **Beziehungsgraph** — Notizen, Tags (`#tag` und Frontmatter-`tags:`) sowie
  typisierte Frontmatter-Beziehungen (`up`, `related`, `links`, …) bilden einen
  interaktiven Graphen mit Rückverweisen.
- **Volltextsuche** über den gesamten Arbeitsbereich.
- **Live-Neuladen** — gespeicherte Änderungen aktualisieren die bereitgestellten
  Seiten automatisch.

Sie können die Wissensdatenbank innerhalb von VMark (eingebettetes Panel)
anzeigen oder **in Ihrem Browser öffnen** — die Aktion „Im Browser öffnen“ führt
einen einmaligen authentifizierten Handshake durch, sodass Ihr Browser ein
Sitzungs-Cookie erhält. Der Server ist nur über Loopback erreichbar und durch
das Cookie geschützt; er macht Ihren Arbeitsbereich niemals außerhalb Ihres
Rechners zugänglich.

## Slidev-Präsentationen

Wenn Sie eine Markdown-Datei öffnen, deren Frontmatter sie als Slidev-Deck
kennzeichnet (z. B. `theme:`, `layout:` + Folien oder ein explizites
`format: slidev`), kann VMark die echte Slidev-Toolchain ausführen, um sie live
in der Vorschau anzuzeigen — derselbe Renderer, den Slidev verwendet, sodass
Layouts, Klick-Animationen und Komponenten vollständig originalgetreu sind.

Wenn das Deck geöffnet ist und das Panel Wissensdatenbank läuft, öffnen Sie mit
**Folien-Vorschau** das Live-Deck in Ihrem Browser und rendern es mit **Folien
exportieren**. Slidev beobachtet das Deck auf der Festplatte, sodass in VMark
gespeicherte Änderungen die geöffnete Vorschau per Hot-Reload aktualisieren.

### Export

Slidev-Decks lassen sich als **PDF**, **PNG** oder **PPTX** exportieren. Der
Content-Server führt Slidevs eigenen Befehl `slidev export` aus, der die Folien
über das Paket `playwright-chromium` in Chromium rendert. VMark lädt dafür
keinen Browser herunter und sucht auch keinen: Ist `playwright-chromium` nicht
neben Slidev in der Laufzeit des Content-Servers installiert, schlägt der Export
fehl und zeigt die Fehlermeldung von Slidev an. Ein Export, der länger als drei
Minuten läuft, wird abgebrochen.

**Folien exportieren** fragt mit dem nativen Sichern-Dialog von VMark nach dem
Speicherort, und der Export schreibt nur an den dort gewählten Pfad; die
Dateiendung muss zum Format passen (`.pdf`, `.png`, `.pptx`).

## Datenschutz & Sicherheit

- Der Server bindet nur an `127.0.0.1` und verlangt ein Token pro Sitzung
  (übermittelt als HttpOnly-, SameSite=Strict-Cookie).
- Der Dateizugriff ist auf das Stammverzeichnis des Arbeitsbereichs beschränkt;
  Pfad-Traversierung wird abgewiesen, und symbolischen Links wird nicht gefolgt.
- Gerendertes HTML wird bereinigt und unter einer Content Security Policy
  ausgeliefert. **Das Vertrauen in einen Arbeitsbereich ändert hier genau eines:
  ob entfernte Bilder dargestellt werden.** VMark übergibt dem Server beim Start
  das Vertrauen des Arbeitsbereichs; bei einem vertrauenswürdigen Arbeitsbereich
  lockert die Richtlinie `img-src`, sodass `https:`-Bilder geladen werden, bei
  einem nicht vertrauenswürdigen Arbeitsbereich werden nur lokale und
  eingebettete Bilder dargestellt. Das Vertrauen entscheidet nicht darüber, ob
  ein Arbeitsbereich bereitgestellt wird — jeder geöffnete Arbeitsbereich kann es
  werden. Wenn Sie das Vertrauen eines Arbeitsbereichs ändern, während seine
  Wissensdatenbank läuft, wird der Server neu gestartet, damit die Richtlinie der
  Änderung folgt.
