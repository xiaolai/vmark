# Markdown-Lint

VMark bringt eine integrierte Lint-Engine mit, die **Korrektheitsprobleme** erkennt — keine Stilvorlieben. Lint läuft auf Anforderung (Cmd-Shift-L oder **Werkzeuge → Markdown prüfen**) und zeigt Ergebnisse inline als Wellenlinien am Rand an, mit einem Status-Badge in der Statusleiste und F2-Navigation zwischen den Befunden.

## Was Lint ist und was nicht

VMarks Lint ist ein **Korrektheits**-Prüfer:

- Defekte Querverweise
- Undefinierte Link-/Fußnotenreferenzen
- Nicht geschlossene Code-Blöcke
- Tabellen mit nicht übereinstimmender Spaltenanzahl
- Übersprungene Überschriftsebenen (h1 → h3)
- Bilder ohne Alt-Text
- Leerer Linktext oder leeres `href`

VMarks Lint ist **kein** Stil-Erzwinger. Es markiert nicht:

- Zeilenlänge
- Listenmarkierungs-Stil (`-` vs. `*`)
- Hervorhebungs-Stil (`_` vs. `*`)
- Überschriftenstil (`#` vs. Unterstreichung)
- Nachgestellte Leerzeichen

Verwenden Sie für Stil-Erzwingung ein separates Werkzeug wie `prettier --check` außerhalb von VMark.

## Regelreferenz

| Regel-ID | Schweregrad | Beschreibung |
|---------|-------------|--------------|
| **E01** | Fehler | Undefinierte Referenz: `[link][missing]` verweist auf eine nicht existierende Definition |
| **E02** | Fehler | Tabellenzeile hat falsche Spaltenanzahl (Abweichung zur Kopfzeile) |
| **E03** | Fehler | Umgekehrter Link — sieht aus wie `(text)[url]` statt `[text](url)` |
| **E04** | Fehler | ATX-Überschrift fehlt das Leerzeichen nach `#` (z. B. `##Überschrift` sollte `## Überschrift` sein) |
| **E05** | Fehler | Leerzeichen innerhalb von Hervorhebungsmarkierungen — `* Wort *` rendert nicht als Kursiv |
| **E06** | Fehler | Nicht geschlossener Code-Block — Datei endet mit einer offenen ```` ``` ````-Begrenzung |
| **E07** | Fehler | Doppelte Linkreferenz-Definition (gleiches `[label]:` erscheint zweimal) |
| **E08** | Fehler | Leeres Link-`href` — `[text]()` |
| **W01** | Warnung | Überschriftsebene übersprungen (h2 erwartet, h3 gefunden) |
| **W02** | Warnung | Bild ohne Alt-Text — Barrierefreiheit |
| **W03** | Warnung | Ungenutzte Linkreferenz-Definition (definiert, aber nie verlinkt) |
| **W04** | Warnung | Anker-Fragment passt zu keiner Überschrift — `#section` für einen nicht existierenden Abschnitt |
| **W05** | Warnung | Leerer Linktext — `[](url)` |
| **M001** | Fehler | Bilddatei am lokalen Pfad nicht gefunden |
| **M002** | Fehler | Verlinkte Datei am lokalen Pfad nicht gefunden |
| **Y001** | Fehler | YAML-Parse-Fehler (für YAML-Dateien) |
| **Y002** | Warnung | YAML-Parse-Warnung (für YAML-Dateien) |

## Lint auslösen

| Auslöser | Aktion |
|---|---|
| `Cmd + Shift + L` (macOS) / `Ctrl + Shift + L` (Win/Linux) | Lint im aktiven Dokument ausführen |
| **Werkzeuge → Markdown prüfen** | Wie das Tastenkürzel |
| `F2` | Zur nächsten Diagnose springen |
| `Shift + F2` | Zur vorherigen Diagnose springen |

Bei Markdown-Dateien mit Dateipfaden läuft die Link-Existenz-Prüfung automatisch parallel zu den synchronen Regeln — siehe [Link-Prüfung](/de/guide/link-check).

Bei YAML-Dateien erscheinen Parse-Fehler live während der Eingabe am Rand, und dasselbe Tastenkürzel `Cmd-Shift-L` füllt das Badge und die F2-Navigation.

## Einstellungen

Die Lint-Engine hat einen einzigen benutzerseitigen Schalter:

- **Einstellungen → Markdown → Markdown-Lint aktivieren** — die Engine vollständig ein- oder ausschalten

Wenn deaktiviert, wird das Tastenkürzel zu einem No-Op und es erscheinen keine Diagnosen am Rand.

## Siehe auch

- [Link-Prüfung](/de/guide/link-check) — Erkennung defekter lokaler Links/Bilder
- [Einstellungen → Markdown → Lint](/de/guide/settings#lint)
