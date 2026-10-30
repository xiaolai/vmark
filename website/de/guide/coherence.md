# Kohärenz und die Kohärenz-Aufschlüsselung

Die Kohärenzschicht von VMark hält rekursiv entwickelte Schreibprojekte ehrlich:
Sie zeichnet auf, **welche Dokumente jede KI-Generierung tatsächlich
gelesen hat**, bemerkt, wenn sich diese Upstream-Dokumente später ändern,
und zeigt Ihnen — auf Abruf — genau, welche Downstream-Artefakte jetzt
veraltet sein könnten. Nichts wird jemals automatisch aktualisiert; Sie
bleiben der Chefredakteur.

## So funktioniert es (30 Sekunden)

- **Provenienzverfolgung ist opt-in.** Aktivieren Sie zuerst
  *Einstellungen → Dateien & Bilder → Speichern → Identitätsblock beim
  Speichern einfügen*. Bis dahin versieht kein Schreibvorgang —
  Speichern, Genie-Anwendung, angenommener KI-Vorschlag,
  MCP-Schreibvorgang, Zurücksetzen auf eine frühere Version oder eine
  neue Datei aus dem Datei-Explorer — Ihre Dateien mit einem
  Identitätsblock oder legt `.vmark/` an.
- Sobald die Einstellung aktiv ist, wird jedes Speichern, jede
  Genie-Anwendung, jeder angenommene KI-Vorschlag, jeder
  MCP-Schreibvorgang, jedes Zurücksetzen auf eine frühere Version und
  jeder `save-file`-Schritt eines Workflows als **Transformation** in
  einem Klartext-Ledger in Ihrem Arbeitsbereich aufgezeichnet (`.vmark/`
  — git-freundliches, menschenlesbares JSONL; das Löschen der
  abgeleiteten `index.db` verliert nichts).
- **Ein Arbeitsbereich, der bereits ein Ledger hat** — ein `.vmark/`,
  das Sie früher angelegt haben oder das ein Mitwirkender eingecheckt
  hat — zeichnet auch bei ausgeschalteter Einstellung weiterhin
  Schreibvorgänge an den Dokumenten auf, die er verfolgt. Als verfolgt
  gilt ein Dokument, wenn das Ledger es bereits aufgezeichnet hat oder
  wenn die Datei schon eine eigene `vmark:`-Identität trägt — eine
  verfolgte Datei, die Sie verschoben, hineinkopiert oder ausgecheckt
  haben; genau diese übernimmt der eigene Scan des Ledgers. Er fügt
  nichts ein: Ein Dokument ohne Identität wird ausgelassen, und ein
  Schreibvorgang mit dadurch unvollständigen Eingaben wird als
  `inferred` statt `exact` erfasst.
- Wenn eine KI ein Dokument schreibt und dabei andere liest, werden diese
  Lesevorgänge zu **Abhängigkeitskanten**, fixiert auf die exakte
  Revision, die gelesen wurde. In der App instrumentierte Pfade
  zeichnen `exact`-Eingaben auf; ein MCP-Schreibvorgang erfasst ehrlich
  einen `inferred` Lesesatz — nur das, was derselbe Client über seine eigene
  Verbindung gelesen hat — und nennt den Client, der geschrieben hat.
- Wenn ein Upstream-Dokument über eine fixierte Revision hinaus
  voranschreitet, wird die Kante **veraltet**. Haben sich zwei Revisionen
  parallel entwickelt (z. B. auf Git-Branches), ist die Kante
  **divergiert** — sie wird angezeigt, nie erraten.
- Dateien, die außerhalb von VMark bearbeitet wurden (Terminal, andere
  Editoren), werden beim Scan als *beobachtete externe Änderungen*
  abgeglichen — die Historie bleibt lückenlos und ist ehrlich als
  Herkunft-unbekannt markiert.

## Das Panel Kohärenz-Aufschlüsselung

Öffnen Sie sie über **Fenster → Kohärenz-Aufschlüsselung** (oder die
Befehlspalette: „Kohärenz-Aufschlüsselung“). Sie ist strikt **pull-basiert**: Sie
aktualisiert sich, wenn Sie sie öffnen oder auf Aktualisieren drücken —
sie nervt nie im Hintergrund.

Die Einträge sind nach Artefakt (dem Downstream-Dokument) gruppiert und
zeigen das Upstream-Dokument, die fixierte Revision und den aktuellen
Zustand:

| Zustand | Bedeutung |
|---|---|
| `version-stale` | Der Upstream ist über den Stand hinaus, aus dem dieses Artefakt erzeugt wurde |
| `diverged` | Die fixierte und die aktuelle Revision verlaufen parallel — keine Abstammungslinie |
| `diverged-multi-head` | Der Upstream selbst hat parallele aktuelle Versionen |
| `waived` | Sie haben die Divergenz akzeptiert, mit dokumentierter Begründung |
| `unpinnable` | Der Upstream kann nicht aufgelöst werden (z. B. eine ungültige Fixierung) |

### Aktionen

Jeder Eintrag bietet drei ehrliche Aktionen — keine davon schreibt die
Historie um:

- **Neuere übernehmen** — hält fest, dass das Artefakt mit dem neueren
  Upstream weiterhin kompatibel ist (eine *Ratifizierung*). Der Eintrag
  verschwindet aus der Liste; ändert sich der Upstream erneut, kommt er
  zurück.
- **Überarbeiten** — öffnet das Artefakt, damit Sie es aktualisieren
  können. Das Speichern einer neuen Version setzt die alte Kante außer
  Dienst.
- **Aussetzen** — dokumentiert eine beabsichtigte Divergenz mit einer
  **verpflichtenden Begründung** (unzuverlässige Erzähler gibt es).
  In v0 ist ein Aussetzen bewusst eng gefasst: Es gilt nur für diese
  Kante und die konkrete Upstream-Revision, gegen die es aufgelöst wird.
  Ausgesetzte Einträge bleiben sichtbar, deutlich markiert, und öffnen
  sich erneut, wenn sich der Upstream wieder bewegt. Ein Aussetzen kann
  zusätzlich ein optionales Ablaufdatum erhalten — ein Datum (`YYYY-MM-DD`,
  gemeint ist das Ende dieses Tages in UTC) oder einen vollständigen
  Zeitstempel. Ist es überschritten, verfällt das Aussetzen und der Eintrag
  öffnet sich erneut; ein fehlerhaftes Ablaufdatum verfällt sofort, sodass
  der Eintrag nie stillschweigend ausgesetzt bleibt.

Neuere übernehmen und Aussetzen sind deaktiviert, wenn der Upstream
mehrere aktuelle Versionen hat — es gibt keine einzelne Revision, gegen
die aufgelöst werden könnte; überarbeiten Sie zuerst (oder führen Sie die
Versionen zusammen).

## Meldungen stummschalten, die Sie nicht brauchen

Zwei Steuerelemente in jeder Zeile der Aufschlüsselung grenzen ein,
wonach die Schicht fragt. Beide sind rein menschlich — kein MCP-Tool
kann sie setzen.

**Als abgeschlossen markieren (Dokument-Lebenszyklus).** Wenn ein
Downstream-Dokument fertig ist — ein veröffentlichtes Kapitel, ein
ausgelieferter Bericht —, wählen Sie in einer beliebigen seiner Zeilen
**Als abgeschlossen markieren**. Das schaltet jede Abhängigkeit zu
diesem Dokument stumm, auch solche, die gerade nicht aufgeführt sind,
weshalb eine Bestätigung verlangt wird. Seine Kanten wandern in die
eingeklappte Gruppe **Hierzu keine Rückfragen** am unteren Rand des
Panels, gekennzeichnet als *abgeschlossenes Dokument*: weiterhin
erfasst, auf Wunsch weiterhin sichtbar, nur ohne Sie zu unterbrechen.
**Wieder öffnen** holt sie mit einem einzigen Klick und ohne
Bestätigung zurück, da Wiederöffnen immer nur Unterbrechungen
hinzufügt. Der Lebenszyklus wird im Ledger aufgezeichnet, nicht im
Frontmatter, sodass das Markieren eines Dokuments als abgeschlossen
keine neue Revision davon erzeugt.

**Abschnittsanker.** Eine nicht verankerte Kante fragt: „Hat sich die
Upstream-Datei geändert?“ **An Abschnitt verankern** grenzt das ein
auf: „Hat sich der Abschnitt geändert, von dem ich abhänge?“ Wählen Sie
eine Überschrift aus dem Upstream-Dokument, und die Kante wird auf
diesen Überschriftenpfad fixiert. Solange der verankerte Abschnitt
unverändert ist, lässt eine Upstream-Änderung an anderer Stelle die
Kante in der unterdrückten Gruppe, gekennzeichnet als *referenzierter
Abschnitt unverändert*; eine Änderung innerhalb des Abschnitts zeigt
sie als *verankerter Abschnitt geändert* an. Verschwindet die
Überschrift, wird die Kante als *Anker verloren* markiert, statt
stillschweigend zum Verhalten für die ganze Datei zurückzukehren.
**Anker ändern** fixiert sie neu, und **Ganze Datei** entfernt den
Anker. Anker sind eigene, überarbeitbare Ledger-Einträge und folgen der
Kante daher durch spätere Revisionen.

## Das Kohärenz-Protokoll und die Bewertung von Meldungen

**Kohärenz-Protokoll** (ein aufklappbarer Bereich im
Aufschlüsselungs-Panel) ist der Verlauf pro Kante, den das Ledger
enthält: jede Prüfung, Ratifizierung und Aussetzung, wie oft jede
Kante aufgelöst wurde (*3x aufgelöst*) und wie viele Kanten mehr als
einmal aufgelöst wurden — Wiederholungsaufwand, die eigentliche Last
eines verrauschten Abhängigkeitsgraphen. Eine semantische Prüfung, die
das Modell unterhalb der Konfidenzschwelle beantwortet hat, wird mit
ihrem erhaltenen Urteil und ihrer Konfidenz angezeigt (*Modell sagte …
bei …, unter dem Schwellenwert*), sodass „kein Signal“ und
„beantwortet, aber nicht sicher genug“ unterscheidbar bleiben. Das
Protokoll wird aus dem gesamten Ledger gelesen; es lädt daher erst,
wenn Sie es aufklappen, und lädt bei jedem Aufklappen neu.

**War diese Meldung sinnvoll?** Jede angezeigte Zeile bietet **Meldung
sinnvoll?** mit drei Antworten — **Ja**, **Nein**, **Unklar** — und
bewusst ohne Voreinstellung. Ihre Antworten werden als eigene
Ledger-Einträge aufgezeichnet und im Protokoll gezählt (*Bewertet:
relevant … · Rauschen … · unklar … · offen …*). Das ist das Maß für die
Relevanz von Veraltungsmeldungen, auf das die Schicht abgestimmt wird:
Eine Meldung, die Sie als Rauschen bewerten, ist ein Kandidat für einen
Abschnittsanker oder eine Abschluss-Markierung.

## Semantische Prüfung, Aussagen und Kontexte

Versions-Veraltung sagt nur, dass sich ein Upstream *bewegt* hat; die
semantische Prüfung sagt, ob diese Bewegung dem abgeleiteten Dokument
tatsächlich *widerspricht*. Prüfungen sind strikt **pull-basiert**:
Drücken Sie **Prüfen** auf einer veralteten Kante, und VMark bittet
Ihren konfigurierten KI-Anbieter, die fixierte Upstream-Revision, die
aktuelle und den abgeleiteten Text zu vergleichen. Das Urteil erscheint
als Abzeichen — *geprüft gültig*, *widersprochen* (immer mit einem
wörtlichen Belegzitat) oder *ungeprüft*, wenn das Modell unsicher war,
in einen Timeout lief oder unterhalb der Konfidenzschwelle antwortete.
Unbekannt ist ehrlich, nie versteckt. Eine Prüfung verfällt in dem
Moment, in dem sich eines der beiden Dokumente erneut bewegt — oder
sich der Aussagenbestand ändert.

**Kanon-Aussagen** sind Fakten, die Sie explizit gemacht haben („Elena
ist Linkshänderin“). Wählen Sie Text in einem Dokument aus und führen
Sie *Aussage aus Auswahl extrahieren* aus: Die Aussage wird als
**Entwurf** geboren, mit Provenienz (welches Dokument, welche
Revision). Um Ihre Aussagen zu sehen und zu verwalten, führen Sie **Kanon-Aussagen** aus der Befehlspalette aus — das Panel hat weder einen Menüeintrag noch ein Tastaturkürzel, und *Aussage aus Auswahl extrahieren* öffnet es für Sie mit dem neuen Entwurf. Stufen Sie eine Aussage zu **etabliert** hoch, wenn sie Kanon wird —
nur etablierte Aussagen fließen in semantische Prüfungen ein. Das
Korrigieren oder Beenden einer Aussage hängt Historie an; nichts wird
je gelöscht. Eine Aussage in einem Kontext auszublenden ist umkehrbare
Sichtbarkeit, kein Beenden.

**Kontexte** sind benannte Sichten auf den Arbeitsbereich (der
*default*-Kontext ist immer da). Jeder Kontext legt fest, was „aktuell“
bedeutet und welche Aussagen gelten; ein Kind-Kontext erbt die Aussagen
seines Eltern-Kontexts additiv. Kontexte sind standardmäßig im
**Gewächshaus**-Modus — Prüfurteile lesen sich als beratende Spannung.
Wird einer auf **durchgesetzt** umgestellt (ein expliziter, bestätigter
Akt), werden Widersprüche als Kanon-Verstöße markiert. Der
Kontext-Wähler der Aufschlüsselung bestimmt, durch welchen Kontext Sie
blicken; Prüfergebnisse sind an genau den Kontext und den
Aussagen-Schnappschuss gebunden, die sie erzeugt haben — sie sickern
nie in andere Kontexte durch.

## Provenienz, Delegation und Branches

Drei Dinge halten die Kohärenzschicht ehrlich, während ein Projekt sich
tatsächlich weiterentwickelt — keines davon nervt, alle sind rein
pull-basiert.

**Provenienz-Wiederherstellung.** Wenn Sie ein abgeleitetes Dokument von
Hand bearbeiten (in VMark oder einem externen Editor), verliert die
Bearbeitung korrekterweise ihre aufgezeichneten Eingaben — die alten
Abhängigkeitskanten beschreiben den neuen Text nicht mehr. Die Gruppe
*Provenienz unbekannt* der Aufschlüsselung bietet an, sie
wiederherzustellen: Drücken Sie **Eingaben vorschlagen**, und VMark
schlägt den jüngsten früheren Eingabesatz des Dokuments vor (Rollen
bleiben erhalten), vorausgewählt und bearbeitbar. **Provenienz
bestätigen** heftet die Kanten wieder an die aktuelle Version, ohne eine
neue Revision zu erzeugen, sodass die eigenen Downstreams des Dokuments
nie eine scheinbare Änderung sehen. Dokumente, die nie Eingaben hatten,
werden nie aufgeführt — es gibt nichts wiederherzustellen und nichts,
womit man nerven könnte.

**Agenten-Delegation.** Standardmäßig können nur Sie veraltete Kanten
auflösen. Wenn Sie möchten, dass ein KI-Agent in Ihrem Namen die neuere
Version übernimmt oder aussetzt (über das MCP-Tool
`coherence_resolve`), erteilen Sie ihm aus der
Aufschlüsselung eine **zeitlich begrenzte Delegation**: Benennen Sie den
Agenten, wählen Sie den Geltungsbereich (Neuere übernehmen und/oder
Aussetzen) und setzen Sie ein Ablaufdatum (standardmäßig 7 Tage, nie
„für immer“). Jede delegierte Auflösung wird der Erteilung zugeordnet,
sodass der Audit-Verlauf immer zeigt, wer unter wessen Befugnis
gehandelt hat. Widerrufen Sie jede Erteilung mit einem Klick.
Kanon-Aussagen und Kontexte bleiben rein menschlich — ein Agent kann
eine Aussage nie hochstufen oder einen Kontext durchsetzen.

**Branch-Kontexte.** Ein Kontext kann einem Git-Branch zugeordnet
werden. Wenn Sie einen zugeordneten Branch auschecken, zeigt die
Aufschlüsselung einen **Kandidaten-Chip**, der das Wechseln anbietet —
sie wechselt nie von selbst. Hat der Branch noch keinen Kontext, bietet
der Chip an, einen nach ihm benannten zu erstellen. Wenn ein echter
Merge (kein Fast-Forward) landet, weist ein schließbares Banner Sie
darauf hin, die Aufschlüsselung zu prüfen; die Divergenz und Veraltung,
die es zeigt, sind die normalen Zustände der Aufschlüsselung — es läuft
also nichts Neues, Sie werden nur zur Prüfung geführt.

## Frontmatter-Identität

Sobald *Identitätsblock beim Speichern einfügen* aktiv ist, fügt VMark
beim ersten Erfassen einer Datei ihrem Frontmatter einen
kleinen Identitätsblock hinzu:

```yaml
vmark:
  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7
```

Über diese ID behält ein Dokument seine Historie über Umbenennungen und
Verschiebungen hinweg. Sie beeinflusst nie das Content-Hashing (das
Hinzufügen erzeugt keine „Änderung“), und alles andere in Ihrem
Frontmatter bleibt unangetastet. Wenn Sie eine Datei kopieren, wird die
doppelte ID erkannt und Ihnen zur Auflösung angezeigt — nie automatisch
korrigiert.

Wenn VMark Ihre Dateien nie verändern soll, lassen Sie *Identitätsblock
beim Speichern einfügen* ausgeschaltet — das ist die Voreinstellung.
Dann fügt VMark diesen Block in keine Datei ein, gleich wie sie
geschrieben wird — auch nicht in Dateien, die eine KI- oder
MCP-Bearbeitung nur gelesen hat.

## Git-Interoperabilität

- Die Ledger-Dateien in `.vmark/` werden von Git verfolgt und lassen sich
  über Branches hinweg sauber zusammenführen (append-only, `merge=union`).
- Checkouts, Branch-Wechsel und Resets werden als **Navigation** erkannt —
  sie erzeugen nie Phantom-Revisionen.
- `git revert` und Merges, die neuen Inhalt hervorbringen, werden als
  git-attribuierte Transformationen erfasst.
- Der abgeleitete Index (`index.db`) steht in der gitignore und wird bei
  Bedarf jederzeit aus dem Klartext-Ledger neu aufgebaut.

## Für KI-Agenten (MCP)

Externe Agenten können den Kohärenzzustand über das
[`coherence`-MCP-Tool](/de/guide/mcp-tools#coherence) abfragen (Aktionen
`status`, `edges`, `claims` und `contexts`) — für Arbeitsbereiche, die Sie
in VMark geöffnet haben. `status` ist ein reiner Lesevorgang; `edges`
gleicht zuerst ab — es kann Provenienz-Einträge an das Ledger des
Arbeitsbereichs anhängen, rührt Ihre Dokumente aber nie an. Das Tool
deklariert `readOnlyHint: true`, sodass ein Client es automatisch
genehmigen darf.

Die Auflösung (Ratifizieren/Aussetzen) liegt in einem **separaten** Tool,
[`coherence_resolve`](/de/guide/mcp-tools#coherence-resolve), und bleibt
standardmäßig beim Menschen: Ein Agent kann es erst aufrufen, nachdem
Sie genau diesem Agenten eine zeitlich begrenzte Delegation erteilt
haben, und jede Auflösung wird im Audit-Protokoll der Erteilung
zugeordnet. Dass es aus `coherence` herausgehalten wird, erlaubt es,
das Lese-Tool automatisch zu genehmigen, ohne dass ein Agent
stillschweigend die Fähigkeit erlangt, in Ihr Ledger zu schreiben.

Kanon-Aussagen und Kontexte lassen sich über MCP überhaupt nicht
verändern.
