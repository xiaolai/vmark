# Integrierter Browser

VMark kann einen echten Webbrowser **innerhalb** eines Dokumentfensters betreiben — eine Webseite wird zu einem vollwertigen Tab neben Ihren Markdown-Dokumenten. Es ist eine echte native Webview (macOS `WKWebView`), kein externes Chrome-Fenster und kein eingebetteter Frame.

::: warning Experimentell
Der integrierte Browser ist eine frühe Funktion und in diesem Build **nur für macOS** verfügbar. Unterstützung für Windows und Linux folgt später — auf diesen Plattformen erscheinen die unten stehenden Einstellungen überhaupt nicht.
:::


::: info Workspace-Leiste
Bei aktivierter experimenteller [Workspace-Leiste](/guide/workspace-rail) sind Browserseiten **fensterweit global**: Sie bleiben aus jedem Arbeitsbereich des Fensters erreichbar und sind nie an die Tabs eines einzelnen Arbeitsbereichs gebunden.
:::

## Ausschalten

Der Browser ist auf macOS **standardmäßig aktiviert**. **Neuer Browser-Tab** finden Sie
im Menü **Datei** (`Alt + Mod + Shift + B`) und in der Befehlspalette — es muss vorher
nichts aktiviert werden.

Um ihn auszuschalten, öffnen Sie **Einstellungen → Erweitert → macOS** und deaktivieren
Sie **Eingebetteter Browser**. Damit werden auch alle offenen Browser-Tabs geschlossen und
die unten beschriebene KI-Automatisierungsfläche zurückgezogen.

Zwei Einstellungen zur KI-Haltung befinden sich direkt unter dem Schalter und erscheinen
nur, solange er aktiviert ist. Beide sind konservativ voreingestellt und ändern sich nicht
dadurch, dass der Browser aktiviert wird:

| Einstellung | Standard | Bedeutung |
|---|---|---|
| **KI-Sitzung** | Sandbox | KI-gesteuerte Seiten erhalten eine isolierte Sitzung, statt Ihre angemeldete Sitzung mitzunutzen |
| **Loopback zulassen** | Aus | KI-Navigation zu `localhost` / Adressen im privaten Netzwerk wird verweigert |

Website-Berechtigungen befinden sich nicht in den Einstellungen — sie liegen in der
Browser-Seitenleiste, in dem Fenster, dem sie gehören.

## Verwendung

Ein Browser-Tab öffnet sich im Editorbereich, neben Ihren Dokumenten — die Seitenleiste, die Tab-Leiste, das Terminal und die Statusleiste bleiben alle an ihrem Platz. Seine Bedienelemente sitzen **über der Seite**: Auf macOS teilen sie sich die Titelleiste des Fensters, da VMark diese selbst zeichnet. Wo stattdessen das System die Titelleiste zeichnet (Windows, Linux), sitzen sie innerhalb des Fensters über der Seite — so, wie jeder andere Desktop-Browser sie anordnet.

| Bedienelement | Aktion |
|---------|--------|
| ‹ / › | Zurück / Vorwärts. Ausgegraut, wenn es kein Ziel gibt |
| ⟳ / ✕ | Neu laden oder einen laufenden Ladevorgang stoppen |
| Adressleiste | Eine **Omnibox**: Tippen Sie eine URL, um dorthin zu gehen, oder etwas anderes, um zu suchen |
| ☆ / ★ | Diese Seite als Lesezeichen speichern |

Die Adressleiste verfolgt die Seite automatisch: Wenn eine Website weiterleitet oder ein Link Sie woanders hinbringt, aktualisiert sich die Leiste, um anzuzeigen, wo Sie tatsächlich sind.

## Die Seitenleiste folgt dem Tab

Wenn ein Browser-Tab aktiv ist, zeigt die Seitenleiste **Browserverlauf** und **Lesezeichen**. Wenn Sie zu einem Dokument zurückwechseln, zeigt sie wieder den Datei-Explorer, die Gliederung und den Dateiverlauf — automatisch. Es gibt keinen zweiten Modus, den man synchron halten müsste, und jede Seite merkt sich, was Sie zuletzt geöffnet hatten, sodass ein Blick auf einen Browser-Tab Sie nicht den Dateibaum kostet, den Sie gerade verwendet haben.

**Der Verlauf** ist fensterbezogen und existiert nur für die Sitzung: Er wird nie auf die Festplatte geschrieben. (Es gibt dennoch eine Schaltfläche **Löschen** — „verschwindet beim Beenden" ist nicht dasselbe wie „lässt sich jetzt entfernen".) Ein Neuladen fügt keinen doppelten Eintrag hinzu, und eine Website, die Sie weiterleitet, verzeichnet die Seite, die Sie besuchen *wollten*, statt jeder einzelnen Zwischenstation.

**Lesezeichen** bleiben hingegen erhalten. Sie werden unter genau der URL gespeichert, die Sie als Lesezeichen abgelegt haben — dieselbe Seite, ein anderer Abschnitt (`#install` vs. `#usage`) sind zwei Lesezeichen, und VMark wird die Query-Parameter einer URL nicht stillschweigend „aufräumen", weil eine umgeschriebene URL Sie möglicherweise nicht zu dem zurückbringt, was Sie gesehen haben.

## Das Fenster wird um eine Seite herum neutral

VMarks Designs sind bewusst getönt — Paper ist ein warmes Grau, Mint und Sepia noch stärker. Das ist angenehm zum Schreiben und falsch, um es um die Webseite eines anderen zu legen: Ein farbiger Rahmen verschiebt, wie man jede Farbe darin liest — deshalb tönt kein echter Browser seinen eigenen Rahmen.

Wenn also ein Browser-Tab fokussiert ist, wechselt das umgebende Fenster zu einem schlichten Neutralton — **Weiß in einem hellen Design, Dunkel in einem dunklen** — und wechselt in dem Moment zurück, in dem Sie zu einem Dokument zurückkehren. Ihr Design bleibt unverändert; nur das, was eine Webseite umgibt, ändert sich.

**Das Terminal folgt derselben Regel.** Wenn Sie ein Terminal neben einem Browser-Tab geöffnet haben, nimmt es den passenden Neutralton an, statt bei der Farbe Ihres Designs zu bleiben, sodass die beiden Hälften des Fensters übereinstimmen, statt an einer sichtbaren Naht aufeinanderzutreffen. Ein dunkles Design bekommt ein dunkles Terminal, kein weißes — die Farben in einem Terminal sind auf seinen Hintergrund abgestimmt, und ein erzwungenes Weiß würde die Ausgabe eines dunklen Designs schwer lesbar machen.

### Wenn eine Seite abstürzt

Wenn der Webinhaltsprozess einer Seite stirbt, zeigt der Tab eine Überlagerung **„Diese Seite ist abgestürzt."** mit einer Schaltfläche **Neu laden**, statt einer leeren oder eingefrorenen Ansicht. VMark lädt bei vorübergehenden Abstürzen einige Male automatisch neu; wenn eine Seite beim Laden immer wieder abstürzt, hört es auf und wartet darauf, dass Sie manuell neu laden, sodass Sie nie in einer Neulade-Schleife feststecken.

## Wie er aufgebaut ist (und warum er von Grund auf privat ist)

VMark erstellt die Plattform-Webview selbst und fügt sie als natives Kind des Fensters hinzu — es fragt das App-Framework **nicht** danach. Das ist für den Datenschutz entscheidend: Eine vom Framework erstellte Webview würde in jede Seite eine interne Nachrichtenbrücke injizieren und damit jeder Website einen Kanal in die App geben. Weil VMark eine frisch konstruierte Webview ohne eine solche Brücke besitzt, **hat eine besuchte Seite keinen Kanal in VMark**. Die Seite wird streng einseitig gesteuert (die App kann die Seite lesen und auf ihr handeln; die Seite kann nicht zurückgreifen).

Sitzungen (Anmeldungen, Cookies) bleiben pro Profil im eigenen Datenspeicher der OS-Webview erhalten, sodass Sie sich bei jeder Website einmal anmelden. VMark speichert selbst keine Anmeldedaten.

## Den Browser mit KI steuern

Ein KI-Assistent, der über [MCP](./mcp-tools) verbunden ist, kann den Browser-Tab bedienen:

- **Lesen** — einen strukturierten Barrierefreiheits-Schnappschuss der Seite abrufen (jedes interaktive oder strukturelle Element als Rolle + barrierefreier Name, plus ein stabiler **ref**-Handle wie `e5`).
- **Handeln** — ein Ziel anklicken oder darin tippen, entweder über seine präzise **ref** aus einem vorherigen Lesen oder über ARIA-**Rolle + barrierefreier Name** (zum Beispiel den Link namens „Learn more" anklicken). Eine ref wird nur für eine bereits gewährte Aktion akzeptiert; alles, was Ihre Freigabe erfordert, verwendet Rolle + Name, damit der Dialog Ihnen ein lesbares Element anzeigen kann. Ein Klick **überprüft, dass er tatsächlich angekommen ist**: Er scrollt das Ziel in den sichtbaren Bereich, verlangt, dass es sichtbar gerendert ist — eine doppelte Schaltfläche in einem eingeklappten Abschnitt wird übersprungen, nicht angeklickt — und führt einen Treffertest am Klickpunkt durch, sodass ein von einer Überlagerung verdecktes Ziel als „verdeckt durch …" zurückgemeldet wird, statt durchgeklickt zu werden. Der KI wird mitgeteilt, was *geschehen* ist, nicht bloß, dass sie es versucht hat, sodass sie nicht stillschweigend auf das Falsche einwirken und Erfolg melden kann.
- **Scrollen** — ein Element (per ref) in den sichtbaren Bereich bringen oder um einen Pixelbetrag scrollen. Aktionsklasse (freigabepflichtig wie Klicken).
- **Taste** — einen Tastendruck (`Enter`, `Escape`, `Tab`, Pfeiltasten, mit optionalem Ctrl/Shift/Alt/Meta) an ein fokussiertes Element oder eine ref senden — zum Beispiel ein Formular absenden oder einen Dialog schließen. Aktionsklasse. Hinweis: Tastendrücke und Scrolls sind **synthetische** DOM-Ereignisse, sodass eine Website, die nur echter Hardware-Eingabe vertraut, sie ignorieren kann.
- **Abfrage** — strukturierte DOM-Erkennung, die der Barrierefreiheits-Schnappschuss nicht benennen kann (Tabellen, berechnete Werte, Attribute), per CSS-Selektor. Leseklasse.
- **Extrahieren** — die Seite als Markdown im Lesemodus (Titel, Autorenzeile, Artikeltext, Boilerplate entfernt), für Seiten, die die KI *lesen* statt bedienen möchte. Website-Plugins verfeinern die Extraktion je nach Ursprung — das eingebaute Wikipedia-Plugin entfernt die Wiki-Umrandung gezielt — mit einem generischen Reader als Rückfalloption. Die Seite exportiert nur Bytes; die Extraktion läuft in VMark. Leseklasse.
- **Stil** — CSS-Manipulation (eine blockierende Überlagerung schließen, ein Ziel hervorheben) durch Setzen von Inline-Stilen, Umschalten von Klassen oder Injizieren eines `<style>`-Blocks (seitenweit, nicht auf einen Selektor beschränkt). Aktionsklasse, und die Freigabe bindet genau das jeweilige Styling — es kann nach Ihrer Zustimmung nicht gegen anderes CSS ausgetauscht werden.
- **JavaScript ausführen** — der Notausgang: ein Skript für das ausführen, was die strukturierten Verben nicht ausdrücken können. Es läuft in der **isolierten Content-World** (DOM + CSS, **niemals** das eigene JavaScript der Seite), wird **pro Aufruf** freigegeben (nie gemerkt — es gibt kein „Auf dieser Website zulassen" dafür), und sein Ergebnis wird als **nicht vertrauenswürdig** behandelt. Der Freigabedialog zeigt Ihnen das **exakte Skript**, und genau dieses Skript wird ausgeführt — die KI kann Sie nicht dazu bringen, ein Skript zu genehmigen und dann ein anderes auszuführen. Bevorzugen Sie Abfrage/Stil; greifen Sie hierzu nur, wenn diese nicht ausreichen.
- **Sitzung speichern/laden** — die aktuelle Sitzung des Tabs unter einem **Handle** speichern (einem Namen, den Sie freigeben) und sie später wiederherstellen, sodass ein Ablauf bereits angemeldet beginnt — *ohne dass die KI jemals Ihre Cookies oder Tokens sieht*. Die Werte werden im **OS-Keychain** gespeichert (im Ruhezustand verschlüsselt), und die KI erhält nur den Handle und eine zusammenfassende Anzahl. Sowohl Speichern als auch Laden werden **pro Aufruf freigegeben**, und eine Freigabe für einen Handle kann nicht für einen anderen eingelöst werden. Eine Wiederherstellung gilt nur für eine Seite mit **demselben Ursprung**, aus dem sie gespeichert wurde. Dies sind Anmeldedaten **per Verweis**: Die KI benennt eine Sitzung, VMark hält das Geheimnis.
- **Konsole** — die erfasste `console.*`-Ausgabe der Seite lesen (log/warn/error …), **plus nicht abgefangene Fehler und unbehandelte Promise-Rejections** — das Signal, das eine Seite aussendet, wenn ihr eigenes Skript bricht und das reines `console`-Logging nie zeigt — sodass die KI eine Seite debuggen kann, die sie steuert. Schreibgeschützt, und die Ausgabe wird als **nicht vertrauenswürdige** Seitendaten behandelt. Dies ist so gebaut, dass es die „privat durch Design"-Garantie wahrt: Die Erfassung schreibt in das eigene DOM der Seite, und VMark liest sie von dort, sodass kein Nachrichtenkanal zurück in die App geöffnet wird.

::: tip Sitzung speichern/laden — Geltungsbereich
Eine gespeicherte Sitzung umfasst **`localStorage` und Cookies**, beide auf den Ursprung
beschränkt, dem die Seite beim Speichern zugeordnet war. Cookies werden über den nativen
Cookie-Speicher gelesen und wieder eingespielt und sind **in beide Richtungen
domänengebunden** — beim Speichern wird nie Ihr gesamter Cookie-Bestand kopiert, und beim
Wiederherstellen wird nie ein Cookie unter einer fremden Website abgelegt.
:::
- **Öffnen** — einen KI-eigenen Tab erstellen und eine HTTP(S)-URL laden.
- **Navigieren** — einen KI-eigenen Tab navigieren und auf sein Navigations-Ticket warten. Wenn sich die geladene Seite als **Sperre** liest statt als der angeforderte Inhalt — eine Login-Wand, ein Einwilligungs-Interstitial, eine Mensch-Verifizierungs-Challenge (reCAPTCHA/Turnstile) oder ein Ratenbegrenzungshinweis — sagt das Ergebnis dies, und der KI wird aufgetragen, **Sie einzubeziehen**, statt zu versuchen, es zu umgehen. Die Erkennung ist auf Präzision ausgelegt: Ein Preis, der „$429" erwähnt, oder eine Fußzeile mit „Cloudflare" löst sie nicht aus.
- **Warten** — auf ein bestimmtes Navigations-Ticket warten, ohne einen weiteren Ladevorgang zu starten.
- **Warten auf** — abfragen, bis eine Bedingung erfüllt ist (ein Element per ref oder Rolle + Name, ein Stück sichtbarer Text oder die **URL des Tabs enthält** eine Teilzeichenfolge — Letzteres bestätigt, dass eine per Klick ausgelöste Navigation angekommen ist) oder eine Zeitüberschreitung verstreicht, und melden, ob es passte. Macht einen mehrstufigen Ablauf deterministisch — handeln, dann auf das Ergebnis warten, dann lesen — statt zu raten.
- **Screenshot** — ein JPEG-Bild der aktuellen Darstellung der Seite abrufen, damit die KI Layout und gerenderten Zustand sehen kann, die der Barrierefreiheits-Schnappschuss nicht benennt. Wie *Lesen* ist es nicht verändernd: erlaubt auf einem KI-eigenen Tab und auf einem menschlichen Tab nur, solange Sie ihn angehängt haben.
- **Workflow ausführen** — eine kurze, gespeicherte Abfolge von Schritten (click / type / navigate / extract, in einer kleinen Textgrammatik geschrieben und als `source` übergeben) als einen **asynchronen Lauf** wiedergeben: Er gibt sofort eine Lauf-ID zurück und Sie fragen seinen Status ab, weil ein mehrstufiger Lauf eine einzelne Anfrage überdauert. Jeder Schritt darin ist **einzeln freigabepflichtig**, genau wie eine von Hand ausgelöste Aktion — ein Workflow ist kein Weg an den Dialogen vorbei — und Schritte, die die KI nicht deterministisch ausführen kann (ein Freitext-„Ziel", ein „Bestätigen"), pausieren den Lauf, damit Sie ihn von Hand erledigen. Ein erneuter Lauf überspringt Schritte, die bereits erfolgreich waren, sodass ein erneuter Lauf nach einer Pause nie doppelt absendet. Läufe sind begrenzt und laufen pro Tab einzeln nacheinander und können abgebrochen werden — Abbrechen ist immer erlaubt, und wenn Sie den Browser selbst übernehmen, wird der Lauf gestoppt.
- **Workflow aufzeichnen** — statt die Grammatik von Hand zu schreiben, können Sie einen Workflow **aufzeichnen**: Mit Ihrer Freigabe (jedes Mal neu erfragt — Aufzeichnen ist nie eine dauerhafte Berechtigung) erfasst VMark die **Klicks und Feldeingaben**, die Sie auf dem Tab ausführen, und gibt fertigen Workflow-Text zurück. Sie ist **von Grund auf wertfrei**: Nichts, was Sie eingeben, wird gespeichert — jedes Feld wird zu einem benannten `{input}`, das Sie beim Abspielen ausfüllen, ein Passwort-Feld wird zu einem manuellen `confirm:`-Schritt, und URLs werden auf Origin + Pfad reduziert. Aufgezeichnet wird, *welche* Bedienelemente Sie berührt haben, nie, *was* Sie eingegeben haben.

Die KI-Browser-Haltung wird unter **Einstellungen → Erweitert → Eingebetteter Browser**
konfiguriert:

- **Sandbox** (empfohlen) verwendet einen gemeinsamen, nicht persistenten KI-Webview-Speicher.
  Er teilt Cookies mit anderen Sandbox-Tabs, aber nicht mit menschlichen Tabs.
- **Gemeinsames Profil** verwendet den menschlichen Webview-Speicher und fragt vor jeder
  KI-Navigation nach einer Zielfreigabe, sofern dieser Ursprung nicht über eine passende
  `navigate`-Berechtigung verfügt.

KI-erstellte Tabs sind flüchtig und werden nach einem Neustart nicht wiederhergestellt. Ihre
URLs, ihr Modus, Titel, ihre Generation und ihr Ladezustand erscheinen in
`session.get_state`; Anmeldedaten werden aus MCP-Antworten entfernt.

Aktionen sind **freigabepflichtig**: Eine Operation, die Sie nicht autorisiert haben, wird nicht ausgeführt — der KI wird mitgeteilt, dass eine Freigabe erforderlich ist, und sie wartet. Datei-Uploads sind für die KI **niemals** erlaubt (ein von der KI gewählter Datei-Upload wäre ein Weg zur Datenexfiltration); diese bleiben strikt menschengesteuert.

### Eine Aktion freigeben

Wenn die KI um eine Aktion bittet, blendet VMark einen Dialog ein und pausiert die Seite. Er nennt Ihnen genau drei Dinge — die **Website**, die **Aktion** und das **Element** (seine Rolle und seinen barrierefreien Namen, z. B. `button "Publish"`):

- **Einmal zulassen** — autorisiert genau diese eine Aktion, an diesem Element, auf dieser Seite. Sie ist sofort verbraucht und wird nicht zu einer dauerhaften Berechtigung.
- **Auf dieser Website zulassen** — die KI darf *diese Operation* auf *dieser Website* ausführen, ohne erneut zu fragen. Sie weitet sich nicht auf andere Operationen oder andere Websites aus.
- **Ablehnen** — es geschieht nichts. `Escape` zu drücken oder einfach `Enter` zu betätigen lehnt ebenfalls ab: Der Dialog ist bewusst zum Verweigern hin voreingenommen.

Der Dialog zeigt Ihnen eine **Beschreibung der Aktion, kein Bild der Seite** — und das ist Absicht. Eine Webseite kontrolliert ihre eigenen Pixel, sodass eine feindselige Seite eine Schaltfläche „Alles löschen" so gestalten könnte, dass sie wie „Veröffentlichen" aussieht. Was VMark Ihnen zeigt, ist genau das, was die Sicherheitsschranke durchsetzt — entnommen aus der Browser-Engine statt aus den Selbstauskünften der Seite.

Eine Berechtigung **verfällt außerdem, wenn die Seite navigiert**. Ein Dialog beschreibt eine Aktion auf einer *bestimmten* Seite; wenn sich die Seite ändert, während Sie noch entscheiden, wird die Anfrage verworfen, statt auf das angewendet zu werden, was stattdessen geladen wurde. Ein nicht verbrauchtes „Einmal zulassen" wird auf dieselbe Weise verworfen.

Das schließt Navigation *innerhalb* einer Seite ein. Die meisten modernen Websites wechseln zwischen Ansichten, ohne je eine neue Seite zu laden — die Adresse ändert sich, der Inhalt wird neu geschrieben, aber die Website wird nie verlassen. Das ist hier wichtig, denn Website und Ursprung bleiben gleich, während die `button "Publish"`, die Sie freigegeben haben, vielleicht nicht mehr die Schaltfläche unter diesem Namen ist. Deshalb behandelt VMark eine seiteninterne Navigation genau wie jede andere: Die Autorisierung verfällt mit der **Ansicht**, für die sie gewährt wurde, nicht bloß mit der Seite.

Das Entscheidende ist jedoch der Deskriptor selbst. Eine Website kann ihren eigenen Inhalt jederzeit neu schreiben, ohne überhaupt zu navigieren, und keine Browser-Engine meldet das. Was ein „Einmal zulassen" also autorisiert, ist genau eine Operation, an einem Element, das durch seine Rolle und seinen barrierefreien Namen identifiziert wird, auf einer Website — und sie ist sofort verbraucht. „Auf dieser Website zulassen" ist die Option, bei der man zweimal nachdenken sollte: Sie ist eine dauerhafte Berechtigung für diese Operation auf dieser Website, und eine Website, der Sie sie gewähren, ist eine Website, der Sie damit vertrauen.

### Berechtigungen prüfen und widerrufen

**Einstellungen → Erweitert → Website-Berechtigungen** listet jede Website auf, der Sie etwas gewährt haben, und was sie tun darf. **Widerrufen** nimmt es sofort zurück — die nächste KI-Aktion auf dieser Website fragt erneut nach.

Website-Berechtigungen werden nur im Arbeitsspeicher gehalten: Sie werden **nie auf die Festplatte geschrieben** und verfallen, wenn VMark beendet wird. Einer KI die Fähigkeit zu belassen, über Neustarts hinweg auf einer Website zu klicken, ist ein größeres Versprechen, als es aussieht — deshalb gibt VMark es nicht stillschweigend.

Wenn eine KI auf einen von Menschen erstellten Tab abzielt, fragt VMark zuerst, ob der
KI-Zugriff an diesen Tab angehängt werden soll. Die Anhängung ist an die aktuelle
Navigations-Generation gebunden. **Einmal zulassen** ist nach einem erfolgreichen Lesen oder
einer Aktion verbraucht; **Bis zur nächsten Navigation erlauben** endet bei der nächsten
vollständigen oder seiteninternen Navigation, beim Schließen, Deaktivieren oder Neustart.

KI-Navigation weist standardmäßig Loopback-, privates LAN-, Link-Local-, Metadaten-,
fehlerhafte und Ziele mit nicht unterstütztem Schema ab. DNS-Rebinding bleibt eine
WebKit-eigene Einschränkung; VMark erhebt nicht den Anspruch, es zu beseitigen.

## Mitsteuern: einer KI vom Terminal aus beim Steuern des Browsers zusehen

Der Browser ist ein Bereich, kein Modus. Das ermöglicht einen bestimmten Arbeitsablauf: Öffnen Sie ein **Terminal** (`` Strg + ` ``) neben einem Browser-Tab, lassen Sie darin einen KI-Agenten laufen und beobachten Sie, wie die Seite reagiert, während er arbeitet.

Das Terminal und der Browser sitzen **nebeneinander** — der Browser passt seine Größe an, um Platz zu schaffen, statt verdeckt zu werden. So sehen Sie die Seite die ganze Zeit, während der Agent auf ihr arbeitet, und jede Aktion, die er ausführt, muss immer noch an Ihnen vorbei (siehe *Eine Aktion freigeben* oben).

Das ist die beabsichtigte Form der KI-Browsernutzung in VMark: Der Agent schlägt vor, die Seite ist sichtbar, und Sie geben frei. Es ist nicht der Agent, der in einem Fenster arbeitet, das Sie nicht sehen können.

**Die Kontrolle zurückzunehmen ist eine Geste.** Während ein KI-Workflow-Lauf einen Tab steuert, zeigt dessen Chrome eine Anzeige **„KI steuert — klicken zum Übernehmen"**. Ein Klick darauf — oder einfach, indem Sie selbst mit der Seite oder ihrer Adressleiste interagieren — holt den Tab sofort zurück und stoppt den Lauf. Sie müssen nie im Terminal des Agenten eine Stopp-Schaltfläche suchen; den Browser zu berühren ist die Stopp-Schaltfläche.

## Wenn eine Seite nicht geladen werden kann

Ein offline Netzwerk, ein falscher Hostname, ein abgelehntes Zertifikat oder eine verweigerte
Verbindung erzeugen alle eine Meldung im Browser-Bereich, die angibt, was schiefgelaufen ist,
mit einer Schaltfläche **Erneut versuchen**. Frühere Builds zeigten stattdessen einen leeren
Bereich, der von einer Seite, die bloß langsam war, nicht zu unterscheiden war.

## Aktuelle Einschränkungen

- In diesem Build nur macOS.
- JavaScript-Dialoge `confirm()` / `prompt()` werden vorerst unterdrückt (nur `alert()` wird angezeigt); Pop-ups (`window.open`) werden blockiert, statt als neue Tabs geöffnet zu werden.
- Downloads, Drucken und eine Netzwerkrichtlinie pro Anfrage sind noch nicht implementiert.

Diese werden schrittweise ergänzt; die obige Seite beschreibt, was heute funktioniert.
