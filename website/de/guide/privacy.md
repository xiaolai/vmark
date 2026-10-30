# Datenschutz

VMark ist ein Local-First-Editor: Ihre Dokumente sind Dateien auf Ihrem Datenträger, die Darstellung geschieht auf Ihrem Rechner, und es gibt kein Konto, keine Telemetrie und keine Absturzberichte. Diese Seite listet jeden Weg auf, auf dem VMark das Netzwerk nutzt, was dabei jeweils gesendet wird und wie Sie es abschalten — und was VMark auf Ihrem Datenträger lesen darf.

## Jede Netzwerkverbindung, die VMark herstellt

| Wann | Wohin | Was gesendet wird | Wie Sie es unterbinden |
|------|-------|-------------------|------------------------|
| Update-Prüfung — standardmäßig beim Start | `log.vmark.app`, ersatzweise GitHub Releases | Plattform, Architektur, App-Version und ein anonymer Maschinen-Hash — [Details unten](#die-update-prufung-im-detail) | **Einstellungen → Über → Prüfhäufigkeit → Nur manuell**, oder `log.vmark.app` blockieren |
| Ausführen eines KI-Genies mit einem **REST-Anbieter** | Der von Ihnen konfigurierte Endpunkt — Anthropic, OpenAI, ein OpenAI-kompatibler Host, Google AI oder Ihr Ollama-Host | Der ausgefüllte Prompt: der ausgewählte Text, Block oder das Dokument plus jeglicher umgebende Kontext, den das Genie angefordert hat, sowie Ihr API-Schlüssel. Auch die Schaltflächen **Testen** und Modellaktualisierung kontaktieren den Endpunkt | Keinen Anbieter konfigurieren oder ein lokales Ollama verwenden |
| Ausführen eines KI-Genies mit einem **CLI-Anbieter** | Nichts von VMark selbst — die von Ihnen installierte `claude`-, `codex`- oder `gemini`-CLI kommuniziert unter ihrem eigenen Konto mit ihrem eigenen Anbieter | VMark leitet den Prompt an die CLI auf Ihrem Rechner weiter | Wie oben |
| HTML-Export | jsDelivr (ersatzweise cdnjs) und Google Fonts | Nichts — nur Downloads: die KaTeX-Mathe-Schriften, wenn das Dokument Mathematik enthält, und jede Webschrift, die Sie in den Einstellungen gewählt haben, damit sie eingebettet werden können | Ohne Verbindung exportieren; der Export weicht dann auf Systemschriften aus |
| Öffnen einer exportierten `index.html` | jsDelivr | Nichts — lädt das KaTeX-Stylesheet für Dokumente mit Mathematik herunter | `standalone.html` verwenden, das es inline enthält |
| Bearbeiten eines GitHub-Actions-Workflows | `raw.githubusercontent.com` | Das `owner/repo@ref` jedes `uses:`-Schritts, um dessen `action.yml` abzurufen (24 h zwischengespeichert) | **Einstellungen → Erweitert → Action-Metadaten abrufen** aus |
| Der eingebettete Browser | Jede Website, die Sie — oder, mit Ihrer Genehmigung, ein KI-Assistent — öffnen | Es ist ein Webbrowser; siehe die [Browser-Anleitung](/de/guide/browser) zur KI-Haltung, zu isolierten Sitzungen und zur Zielrichtlinie | **Einstellungen → Erweitert → Eingebetteter Browser** aus |
| Dokumente, die auf das Web verweisen | Die in Ihrem Dokument genannten Hosts | Entfernte Bilder und YouTube-/Vimeo-/Bilibili-Einbettungen werden von ihren Hosts geladen, wenn sie im Editor oder in exportiertem HTML dargestellt werden | Bilder lokal halten |

Zwei Dinge, die wie Netzwerkdienste aussehen, sind reine Loopback-Dienste und verlassen Ihren Rechner nie:

- **Der MCP-Server** — KI-Assistenten verbinden sich über eine WebSocket-Bridge, die an `127.0.0.1` gebunden ist und mit einem Token authentifiziert wird, das VMark in seinem App-Datenverzeichnis aufbewahrt. Der Assistent selbst (Claude Desktop, Claude Code, Codex CLI…) kommuniziert mit seinem eigenen Anbieter; VMark beantwortet nur seine Tool-Aufrufe. Siehe [KI-Integration](/de/guide/mcp-setup).
- **Die Wissensdatenbank und die Slidev-Vorschau** — ein lokaler Server, gebunden an `127.0.0.1`, mit einem Token pro Sitzung; die [Anleitung zur Wissensdatenbank](/de/guide/knowledge-base#datenschutz-sicherheit) beschreibt seine Abschottung.

Das integrierte Terminal führt Ihre eigene Shell aus — alles, womit es sich verbindet, ist Ihr Befehl, nicht der von VMark.

## Was VMark NICHT sendet

- Ihre Dokumente oder deren Inhalte (außer an einen von Ihnen konfigurierten KI-Anbieter, wenn Sie ein Genie ausführen)
- Dateinamen oder Pfade
- Nutzungsmuster oder Funktionsanalysen
- Persönliche Informationen jeglicher Art
- Absturzberichte
- Tastenanschlag- oder Bearbeitungsdaten
- Umkehrbare Hardware-Kennungen oder Fingerabdrücke

## Die Update-Prüfung im Detail

Der **Auto-Update-Checker** von VMark kontaktiert unseren Server, um zu prüfen, ob eine neue Version verfügbar ist. Jede Prüfung sendet genau diese Felder — nicht mehr:

| Daten | Beispiel | Zweck |
|-------|---------|-------|
| IP-Adresse | `203.0.113.42` | Inhärent in jeder HTTP-Anfrage — wir können sie nicht nicht empfangen |
| Betriebssystem | `darwin`, `windows`, `linux` | Um das korrekte Update-Paket bereitzustellen |
| Architektur | `aarch64`, `x86_64` | Um das korrekte Update-Paket bereitzustellen |
| App-Version | `0.5.10` | Um zu bestimmen, ob ein Update verfügbar ist |
| Maschinen-Hash | `a3f8c2...` (64-stelliger Hex) | Anonymer Gerätezähler — SHA-256 aus Hostname + OS + Architektur; nicht umkehrbar |

Die vollständige URL sieht so aus:

```text
GET https://log.vmark.app/update/latest.json?target=darwin&arch=aarch64&version=0.5.10
X-Machine-Id: a3f8c2b1d4e5f6078a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1
```

Ist dieser Server nicht erreichbar, versucht der Updater dasselbe Manifest von GitHub Releases (`github.com/xiaolai/vmark/releases/latest/download/latest.json`). Updates selbst werden vor der Installation mit einer minisign-Signatur verifiziert.

Sie können dies selbst überprüfen — die Endpunkte befinden sich in [`tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json) (suchen Sie nach `"endpoints"`), und der Hash befindet sich in [`app_setup.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/app_setup.rs) (suchen Sie nach `machine_id_hash`).

### Wie wir die Daten verwenden

Wir aggregieren die Update-Check-Protokolle, um die Live-Statistiken zu erstellen, die auf unserer [Startseite](/de/) angezeigt werden:

| Metrik | Wie sie berechnet wird |
|--------|----------------------|
| **Eindeutige Geräte** | Anzahl unterschiedlicher Maschinen-Hashes pro Tag/Woche/Monat |
| **Eindeutige IPs** | Anzahl unterschiedlicher IP-Adressen pro Tag/Woche/Monat |
| **Pings** | Gesamtanzahl der Update-Check-Anfragen |
| **Plattformen** | Anzahl der Pings pro OS + Architektur-Kombination |
| **Versionen** | Anzahl der Pings pro App-Version |

Diese Zahlen werden offen unter [`log.vmark.app/api/stats`](https://log.vmark.app/api/stats) veröffentlicht. Nichts ist verborgen.

**Wichtige Vorbehalte:**
- Eindeutige IPs unterschätzen tatsächliche Benutzer — mehrere Personen hinter demselben Router/VPN zählen als eine
- Eindeutige Geräte liefern genauere Zählungen, aber eine Hostname-Änderung oder eine frische OS-Installation erzeugt einen neuen Hash
- Pings überschätzen tatsächliche Benutzer — eine Person kann mehrmals täglich prüfen

### Datenspeicherung

- Protokolle werden auf unserem Server im Standard-Zugriffsprotokollformat gespeichert
- Protokolldateien rotieren bei 1 MB und nur die 3 neuesten Dateien werden aufbewahrt
- Protokolle werden mit niemandem geteilt
- Es gibt kein Kontosystem — VMark weiß nicht, wer Sie sind
- Der Maschinen-Hash ist nicht mit einem Konto, einer E-Mail oder einer IP-Adresse verknüpft — er ist ausschließlich ein pseudonymer Gerätezähler
- Wir verwenden keine Tracking-Cookies, Fingerabdrücke oder Analytics-SDKs

### Update-Prüfungen deaktivieren

Stellen Sie **Einstellungen → Über → Prüfhäufigkeit** auf **Nur manuell**, dann kontaktiert VMark den Update-Server nie von sich aus; **Jetzt prüfen** funktioniert weiterhin, wenn Sie es möchten. Um auf Netzwerkebene sicherzugehen, blockieren Sie `log.vmark.app` (Firewall, `/etc/hosts` oder DNS) — VMark funktioniert ohne diesen Server ganz normal weiter; Sie erhalten nur keine Update-Benachrichtigungen.

## Wo API-Schlüssel gespeichert werden

API-Schlüssel für REST-KI-Anbieter liegen im Anmeldedatenspeicher des Betriebssystems — macOS-Schlüsselbund, Windows-Anmeldeinformationsverwaltung oder Linux Secret Service — unter dem Dienstnamen `app.vmark.secrets`. Sie werden nie in die Einstellungsdateien von VMark oder in `localStorage` geschrieben, und die gespeicherten Anbietereinstellungen der App werden ohne den Schlüssel gesichert. Schlüssel werden nur an den von Ihnen konfigurierten Anbieter-Endpunkt gesendet, wenn Sie ein Genie ausführen oder **Testen** drücken. Details unter [KI-Anbieter](/de/guide/ai-providers#wo-api-schlussel-liegen).

## Was ein KI-Assistent erreichen kann

Ein über MCP verbundener Assistent handelt nur innerhalb dessen, was Sie bereits geöffnet haben: Seine Dateioperationen sind auf das Stammverzeichnis des geöffneten Arbeitsbereichs und auf die Ordner der in VMark geöffneten Dokumente beschränkt, und eine Anfrage außerhalb dieser Grenze wird abgelehnt. Das Speichern eines Dokuments unter einem **neuen** Pfad erfordert die Einstellung **Speichern an neuem Ort und Genie-Ergebnisse automatisch genehmigen** (standardmäßig aus) — andernfalls wird der Aufruf abgelehnt, und VMark zeigt eine Toast-Meldung mit dem Dateinamen; selbst wenn sie eingeschaltet ist, kann ein Assistent auf diesem Weg nie eine andere, bereits vorhandene Datei überschreiben. Das Öffnen eines Arbeitsbereichs, den er benennt, fragt Sie zuerst. Jeder KI-Schreibvorgang in ein Dokument wird zuerst im Bearbeitungsverlauf festgehalten, sodass Sie den vorherigen Inhalt wiederherstellen können ([Bearbeitungs-Checkpoints](/de/guide/mcp-setup#bearbeitungs-prufpunkte)). Der eingebettete Browser hat ein eigenes Genehmigungsmodell, das in der [Browser-Anleitung](/de/guide/browser) beschrieben ist.

## Was VMark auf dem Datenträger lesen kann

Der Dateizugriff von VMark ist ein eng begrenzter Berechtigungsbereich, nicht die ganze Festplatte:

- **Statischer Bereich**: Ihr Benutzerordner (`$HOME/**`) sowie eingebundene Laufwerke — `/Volumes/**` unter macOS, `/mnt/**` und `/media/**` unter Linux. Unter Windows umfasst er zusätzlich die Laufwerke `C:\` bis `F:\`, sodass nur `G:\` und spätere Laufwerke sowie Netzwerkfreigaben eine Laufzeitfreigabe benötigen. Unter macOS und Linux liegt alles innerhalb eines versteckten Ordners (dessen Name mit `.` beginnt) außerhalb des statischen Bereichs.
- **Laufzeitfreigaben**: Eine Datei, die Sie ausdrücklich öffnen — aus dem Finder oder Explorer, über die Befehlszeile `vmark` oder über einen Dateidialog —, erhält eine Freigabe für genau diese Datei. Ein **Ordner** wird nur freigegeben, wenn VMark erkennen kann, dass Sie ihn ausgewählt haben: Sie haben ihn im Ordnerdialog von VMark gewählt oder aus dem Finder geöffnet. VMark führt eine Liste dieser Ordner (`workspace-grants.json` im App-Datenordner) und gibt sie bei jedem Start erneut frei, damit Ihre wiederhergestellte Sitzung und **Zuletzt geöffnet** weiter funktionieren. Ein zuletzt verwendeter Arbeitsbereich, der nicht auf dieser Liste steht und nicht im statischen Bereich liegt, öffnet den Ordnerdialog bei genau diesem Ordner — wählen Sie ihn zur Bestätigung aus. Wenn ein KI-Assistent einen solchen Ordner öffnen möchte, verfährt VMark genauso, nachdem Sie die Anfrage genehmigt haben.
- **Bilder und Medien**: Lokale Bilder, Videos und Audiodateien zeigt VMark über sein Asset-Protokoll an, das dieselben Orte erreicht — den statischen Bereich plus die oben genannten Laufzeitfreigaben. Der Medienbetrachter fügt eine Freigabe für die eine Datei hinzu, die er anzeigt, und nur für eine Datei mit Medienendung; eine Anfrage für einen anderen Pfad wird abgelehnt, statt den Bereich zu erweitern. Ein Bild außerhalb dieser Orte, etwa eines neben einem Dokument, das Sie einzeln von außerhalb des statischen Bereichs geöffnet haben, wird erst angezeigt, wenn Sie seinen Ordner als Arbeitsbereich öffnen.

Hier wird nichts irgendwohin gesendet; der Bereich legt fest, was die App selbst lesen darf.

## Open-Source-Transparenz

VMark ist vollständig Open Source. Sie können alles hier Beschriebene überprüfen:

- Update-Endpunkt-Konfiguration: [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)
- Maschinen-Hash-Generierung: [`src-tauri/src/app_setup.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/app_setup.rs) — nach `machine_id_hash` suchen
- Dateisystem- und Asset-Bereich: [`src-tauri/capabilities/default.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/capabilities/default.json), der Eintrag `assetProtocol` in [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json), [`src-tauri/src/fs_scope.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/fs_scope.rs) und [`src-tauri/src/workspace/grants/`](https://github.com/xiaolai/vmark/tree/main/src-tauri/src/workspace/grants)
- Schlüsselbund-Speicherung: [`src-tauri/src/secure_store.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/secure_store.rs)
- Serverseitige Statistik-Aggregation: [`scripts/vmark-stats-json`](https://github.com/xiaolai/vmark/blob/main/scripts/vmark-stats-json) — das genaue Skript, das auf unserem Server läuft, um die [öffentlichen Statistiken](https://log.vmark.app/api/stats) zu erstellen
- Die Netzwerkaufrufe sind genau die oben aufgeführten — suchen Sie im Repository nach `reqwest` (Rust) und `fetch(` (TypeScript), um es selbst zu prüfen

## Ein Sicherheitsproblem melden

Wenn Sie eine Sicherheitslücke in VMark finden, etwa in der MCP-Bridge, im eingebetteten Browser, im Updater oder in der Dateiverarbeitung, melden Sie sie bitte vertraulich über [GitHubs private Meldung von Sicherheitslücken](https://github.com/xiaolai/vmark/security/advisories/new) und nicht als öffentliches Issue. Die [Sicherheitsrichtlinie](https://github.com/xiaolai/vmark/blob/main/SECURITY.md) beschreibt, was abgedeckt ist und was Sie erwarten können.
