# Workspace-Leiste

::: warning Experimentell
Die Workspace-Leiste ist experimentell und **standardmäßig ausgeschaltet**. Aktivieren Sie sie unter **Einstellungen → Dateien & Bilder → Arbeitsbereich → Arbeitsbereichsleiste**. Bei ausgeschalteter Leiste verhält sich VMark genau wie bisher — ein Arbeitsbereich pro Fenster.
:::

Mit der Workspace-Leiste kann ein Fenster **mehrere Arbeitsbereiche gleichzeitig** enthalten, dargestellt als senkrechter Streifen farbiger Symbole am linken Rand. Ein Klick auf einen Arbeitsbereich führt einen **vollständigen Kontextwechsel** aus: Die Editor-Tabs, der Dateibaum in der Seitenleiste, das Layout der geteilten Bereiche und der Zustand von Seitenleiste und Gliederung wechseln alle zum eigenen Satz dieses Arbeitsbereichs — wie das Wechseln zwischen Spaces in einem Browser, nicht bloß das Ändern eines Filters.

## Was wechselt, was bleibt

| Bereich | Bei einem Wechsel in der Leiste |
|---------|---------------------------------|
| Tab-Leiste des Editors | Zeigt nur die Tabs des aktiven Arbeitsbereichs (plus Browserseiten) |
| Dateibaum der Seitenleiste | Wird auf den aktiven Arbeitsbereich neu verwurzelt, mit eigenem Aufklapp- und Scrollzustand der Ordner |
| Geteilte Bereiche | Jeder Arbeitsbereich merkt sich sein eigenes Teilungslayout |
| Gliederung | Der Einklapp-, Filter- und Scrollzustand pro Tab folgt dem Arbeitsbereich |
| Nächster/vorheriger Tab, Tab-Kontextmenü, „offene Tabs“ in Schnellöffnen | Auf den aktiven Arbeitsbereich beschränkt |
| Geschlossenen Tab wieder öffnen | Geschlossene Tabs werden pro Arbeitsbereich aufgezeichnet (plus ein gemeinsamer Bereich für den Browser) und in der Reihenfolge „zuletzt geschlossen zuerst“ wieder geöffnet — über **Datei → Geschlossenen Tab wieder öffnen**, die Befehlspalette oder ein Tastenkürzel, das Sie unter Einstellungen → Tastenkürzel zuweisen (ab Werk ist keines zugewiesen: Die naheliegenden Tastenkombinationen sind belegt). Ein wieder geöffnetes Dokument wird erneut von der Festplatte gelesen und zeigt die Datei also in ihrem aktuellen Zustand; wurde die Datei verschoben oder gelöscht, wird der Tab nicht wiederhergestellt, und ein Hinweis nennt den Grund. Ein unbenannter Tab öffnet sich leer. Nicht gespeicherte Änderungen werden nicht wiederhergestellt — beim Schließen eines geänderten Tabs wurde bereits gefragt, ob gespeichert werden soll |
| **Browserseiten** | **Fensterweit** — von jedem Arbeitsbereich aus erreichbar |
| Menüs „Zuletzt geöffnet“ / „Zuletzt geöffneter Arbeitsbereich“ | Global |
| Automatisches Speichern, Speichernachfragen, Dateiüberwachung | Erfassen **jeden** Tab, ob ausgeblendet oder nicht |

Ein Wechsel schließt nie etwas: Die Tabs eines ausgeblendeten Arbeitsbereichs bleiben im Hintergrund geöffnet, werden weiterhin automatisch gespeichert und lösen trotzdem eine Speichernachfrage aus, wenn Sie das Fenster mit ungespeicherten Änderungen schließen.

## Lose Dateien

Dateien, die von außerhalb aller Arbeitsbereichs-Stammverzeichnisse geöffnet werden, liegen in einem synthetischen Eintrag **Lose Dateien** (das Symbol mit gestapelten Dateien). Ein Wechsel dorthin zeigt diese Tabs; der Eintrag erscheint automatisch, sobald er gebraucht wird.

## Dateien zwischen Arbeitsbereichen verschieben

Die Zugehörigkeit folgt dem Pfad der Datei:

- **Speichern unter** in den Ordner eines anderen Arbeitsbereichs verschiebt den Tab dorthin — und wenn es der Tab ist, den Sie gerade ansehen, folgt ihm der sichtbare Arbeitsbereich.
- Umbenennungen oder Verschiebungen auf der Festplatte (auch aus dem Finder) ordnen den Tab auf dieselbe Weise neu zu.
- Das Öffnen einer Datei, die zu einem *ausgeblendeten* Arbeitsbereich gehört (über Schnellöffnen, zuletzt geöffnete Dateien oder einen Dateidialog), wechselt zuerst zu diesem Arbeitsbereich, sodass der Tab, den Sie angefordert haben, auch der Tab ist, den Sie sehen.

## Sitzungen und Neustart

Die Konfiguration jedes Arbeitsbereichs merkt sich **nur seine eigenen Tabs** und sein Teilungslayout. Von Ihnen geöffnete Browserseiten werden pro Fenster gespeichert. Hot Exit stellt jeden Arbeitsbereich des Fensters wieder her — einschließlich des Seitenleistenzustands pro Arbeitsbereich und des aufgezeichneten Verlaufs geschlossener Tabs — und aktiviert den Arbeitsbereich erneut, in dem Sie sich befanden.

## Verhalten von KI (MCP)

KI-Clients, die Dokumente über MCP öffnen, reißen Ihren sichtbaren Arbeitsbereich nie an sich: `workspace.open` erstellt einen **Hintergrund-Tab** und gibt dessen `tabId` für nachfolgende Dokumentaufrufe zurück. Nur die ausdrückliche Aktion `workspace.switch_tab` ändert, was Sie sehen, und ihre Antwort meldet `workspaceSwitched: true`, damit die KI Ihnen mitteilen kann, dass dies geschehen ist. Siehe die [MCP-Tools-Referenz](/de/guide/mcp-tools).

## Aktionen in der Leiste

| Aktion | So geht's |
|--------|-----------|
| Arbeitsbereich wechseln | Auf sein Symbol klicken |
| Arbeitsbereich hinzufügen | **Datei → Arbeitsbereich öffnen** (ein Ordner, der bereits in der Leiste ist, wird stattdessen aktiviert statt dupliziert) |
| Neu anordnen | Ein Symbol über ein anderes ziehen |
| In ein eigenes Fenster verschieben | Ein Symbol aus dem Fenster herausziehen |
| In ein neues Fenster duplizieren | Die Schaltfläche **⧉** beim Überfahren mit der Maus |
| Arbeitsbereich schließen | Rechtsklick → Schließen. Alle seine Tabs werden mit geschlossen, auch angeheftete; jeder Tab mit ungespeicherten Änderungen fragt zuerst nach, und Abbrechen behält den Arbeitsbereich |

## Terminalsitzungen

Jeder Arbeitsbereich in der Leiste besitzt seine eigenen Terminalsitzungen. Ein Wechsel in der Leiste tauscht die sichtbaren Terminal-Tabs aus; die Shells ausgeblendeter Arbeitsbereiche laufen unberührt weiter — in sie wird kein `cd` eingegeben, ob beschäftigt oder untätig —, und beim Zurückwechseln erscheinen dieselben Shells wieder, wobei die zuletzt angesehene Sitzung pro Arbeitsbereich gemerkt wird. Neue Sitzungen (die Schaltfläche **+**, „Terminal hier öffnen“, „Im Terminal ausführen“) werden im aktiven Arbeitsbereich erstellt und starten in dessen Stammverzeichnis; wird ein Arbeitsbereich geschlossen oder in ein eigenes Fenster verschoben, werden seine Sitzungen mit ihm geschlossen. Details im [Terminal-Leitfaden](/de/guide/terminal#terminalsitzungen-und-die-workspace-leiste).

## Bekannte Einschränkung

Unter macOS werden zwei Schreibweisen desselben Ordners, die sich nur in der Groß-/Kleinschreibung unterscheiden (auf Volumes ohne Unterscheidung der Groß-/Kleinschreibung möglich), als **verschiedene** Arbeitsbereiche behandelt. Das ist beabsichtigt: Die Identität eines Arbeitsbereichs ist unter macOS und Linux bytegenau und unter Windows unabhängig von der Groß-/Kleinschreibung.
