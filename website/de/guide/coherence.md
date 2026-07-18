# Kohärenz und die Aufschlüsselungsansicht

VMarks Kohärenzschicht hält rekursiv entwickelte Schreibprojekte ehrlich:
Sie zeichnet auf, **welche Dokumente jede KI-Generierung tatsächlich
gelesen hat**, bemerkt, wenn sich diese Upstream-Dokumente später ändern,
und zeigt Ihnen — auf Abruf — genau, welche Downstream-Artefakte jetzt
veraltet sein könnten. Nichts wird jemals automatisch aktualisiert; Sie
bleiben der Chefredakteur.

## So funktioniert es (30 Sekunden)

- Jedes Speichern, jede Genie-Anwendung, jeder angenommene KI-Vorschlag,
  jeder MCP-Schreibvorgang und jeder `save-file`-Schritt eines Workflows
  wird als **Transformation** in einem Klartext-Ledger in Ihrem
  Arbeitsbereich aufgezeichnet (`.vmark/` — git-freundliches,
  menschenlesbares JSONL; das Löschen der abgeleiteten `index.db` verliert
  nichts).
- Wenn eine KI ein Dokument schreibt und dabei andere liest, werden diese
  Lesevorgänge zu **Abhängigkeitskanten**, fixiert auf die exakte
  Revision, die gelesen wurde.
- Wenn ein Upstream-Dokument über eine fixierte Revision hinaus
  voranschreitet, wird die Kante **veraltet**. Haben sich zwei Revisionen
  parallel entwickelt (z. B. auf Git-Branches), ist die Kante
  **divergiert** — sie wird angezeigt, nie erraten.
- Dateien, die außerhalb von VMark bearbeitet wurden (Terminal, andere
  Editoren), werden beim Scan als *beobachtete externe Änderungen*
  abgeglichen — die Historie bleibt lückenlos und ist ehrlich als
  Herkunft-unbekannt markiert.

## Die Aufschlüsselungsansicht

Öffnen Sie sie über **Fenster → Kohärenz-Aufschlüsselung** (oder die
Befehlspalette: „Breakdown View“). Sie ist strikt **pull-basiert**: Sie
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
  Ausgesetzte Einträge bleiben sichtbar, deutlich markiert, und öffnen
  sich erneut, wenn sich der Upstream wieder bewegt.

Neuere übernehmen und Aussetzen sind deaktiviert, wenn der Upstream
mehrere aktuelle Versionen hat — es gibt keine einzelne Revision, gegen
die aufgelöst werden könnte; überarbeiten Sie zuerst (oder führen Sie die
Versionen zusammen).

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
Revision). Stufen Sie sie zu **etabliert** hoch, wenn sie Kanon wird —
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

## Frontmatter-Identität

Beim ersten Erfassen einer Datei fügt VMark ihrem Frontmatter einen
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
`status` und `edges`) — für Arbeitsbereiche, die Sie in VMark geöffnet
haben. `status` ist ein reiner Lesevorgang; `edges` gleicht zuerst ab —
es kann Provenienz-Einträge an das Ledger des Arbeitsbereichs anhängen,
rührt Ihre Dokumente aber nie an. Die Auflösung (Ratifizieren/Aussetzen)
ist in dieser Version bewusst *nicht* über MCP verfügbar — die
Entscheidungen bleiben beim Menschen in der App.
