# Workflow-Genies

Ein **Workflow-Genie** ist ein [Genie-Workflow](/de/guide/workflows) — eine mehrstufige YAML-Pipeline —, das als `.yml`- oder `.yaml`-Datei in Ihrem Genies-Ordner gespeichert ist. Es erscheint in der Genie-Auswahl (`Mod + Y`) und unter **Bearbeiten → Genies** genau wie ein Markdown-Genie; wählen Sie es aus, läuft die gesamte Pipeline über die Workflow-Engine, statt dass ein einzelner Prompt gesendet wird.

## Voraussetzungen

| Voraussetzung | Warum |
|---------------|-------|
| **Einstellungen → Erweitert → Entwickler-Tools**, dann **Workflow-Engine** eingeschaltet | Die Engine ist standardmäßig ausgeschaltet. Die Auswahl listet ein Workflow-Genie auch bei ausgeschalteter Engine, doch das Ausführen schlägt mit „Die Workflow-Engine ist in den Einstellungen deaktiviert“ fehl |
| Ein geöffneter Arbeitsbereich | Aktionsschritte wie `action/save-file` lösen Pfade relativ zum Stammverzeichnis des Arbeitsbereichs auf; ohne einen solchen zeigt VMark eine Toast-Meldung und startet den Lauf nicht |
| Ein konfigurierter [KI-Anbieter](/de/guide/ai-providers) | Genie-Schritte rufen den aktiven Anbieter auf — denselben, den auch Markdown-Genies verwenden |

## Eines schreiben

Legen Sie die YAML-Datei an beliebiger Stelle im Genies-Ordner ab (**Bearbeiten → Genies → Genies-Ordner öffnen**); Unterordner werden wie bei Markdown-Genies zu Kategorien. Die Auswahl zeigt den Dateinamen als Namen des Genies und die `description` der YAML-Datei (oder ersatzweise ihren `name`) als zweite Zeile. Der Geltungsbereich eines Workflow-Genies ist das gesamte Dokument — der Lauf hat keine Auswahl, auf der er arbeiten könnte —, daher liefert jeder Schritt sein eigenes `with: { input: … }`, und die aufgerufenen Markdown-Genies binden das unverändert an ihren Platzhalter `{{content}}`.

Das mitgelieferte Beispiel `triage-and-translate.yml` ist ein fertiger Ausgangspunkt: Kopieren Sie es in den Ordner und ersetzen Sie den Starttext. Wo es liegt, das vollständige YAML-Schema, Ausdrücke, Genehmigungen, Modelle pro Schritt und Timeouts sind alle unter [Genie-Workflows](/de/guide/workflows) dokumentiert; der Lauf eines Workflow-Genies wird wie gewohnt ausgeführt, und seine Genehmigungsdialoge erscheinen wie gewohnt, aber er zeigt keinen Live-Schrittgraphen, lässt sich nicht aus dem Workflow-Panel abbrechen (die Schaltfläche zum Ausführen im Panel meldet die Engine als beschäftigt, solange er läuft), und das Panel bietet dafür kein **Dateien wiederherstellen** an.

Siehe auch [AI Genies](/de/guide/ai-genies) für das Markdown-Genie-Format mit einem einzelnen Prompt.
