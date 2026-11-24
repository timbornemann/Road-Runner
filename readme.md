# Road-Runner

Road-Runner ist ein deutschsprachiger Reiseplaner für Solo-Reisende. Ein Docker-Container stellt die Weboberfläche und die SQLite-Datenbank bereit. PC und Handy greifen im selben Netz auf dieselben Reisen zu.

## Schnellstart

Auf dem Rechner mit Docker diesen Befehl ausführen. Docker lädt das fertige Image und legt das Datenvolume beim ersten Start an.

```sh
docker run --name road-runner -d --restart unless-stopped -p 8080:8080 -e TZ=Europe/Berlin -v road-runner_reisedaten:/data --label com.centurylinklabs.watchtower.enable=true ghcr.io/timbornemann/road-runner:latest
```

Am Rechner öffnest du [Road-Runner auf Port 8080](http://localhost:8080), am Handy `http://<LAN-IP-des-Rechners>:8080`. Windows zeigt die LAN-IP mit `ipconfig` an. Der Port ist auf allen Host-Schnittstellen veröffentlicht. Jedes erreichbare Gerät kann ohne Anmeldung Reisen bearbeiten. Bei aktiver Firewall gib TCP-Port 8080 für das private Netz frei.

Beim ersten Start erscheint die gekennzeichnete Beispielreise **Dolomiten-Roadtrip**. Über **Neue Reise** beginnst du mit einem leeren Plan.

## Reisen planen und unterwegs nutzen

- **Ortekarte** ist die eigene Sammlung einer Reise. Suche nach einem Namen, setze einen Punkt auf die Karte, gib Koordinaten ein oder entdecke Parks, Berge, Aussichtspunkte, Campingplätze und Sehenswürdigkeiten im sichtbaren Ausschnitt. Gespeicherte Orte haben Platz für Beschreibung, Tags, Weblinks und ein Titelbild. Als Marker kannst du ein Emoji oder ein Lucide-Symbol auswählen. Auch Ideen ohne Koordinaten lassen sich in der Ortsliste vormerken.
- **Routenplanung** stellt aus diesen Orten einzelne Besuche zusammen. Über **Zur Route hinzufügen** kannst du zum Beispiel denselben Campingplatz für Hin- und Rückfahrt einplanen. Termin, Übernachtungszeitraum, Etappe, Variante und Besuchsstatus gehören zum jeweiligen Besuch. Bearbeitest du das Ortsprofil, erscheinen die Änderungen an beiden Stopps. Die Reihenfolge kann flexibel bleiben oder feste Termine enthalten. **Straßenverlauf** berechnet auf Wunsch die Autofahrt mit Kilometern und geschätzter Fahrzeit. Nicht berechenbare Abschnitte sind als Lücken erkennbar. Die Navigation zum gewählten Ziel öffnet Google Maps.
- **Etappen und Varianten** gliedern lange Routen. Lege etwa die Etappe *Lofoten* an und ordne ihr den Fährhafen als gemeinsamen Stopp zu. Die Küstenstraße und die Fahrt durchs Gebirge kannst du als Varianten mit eigenen Orten und Notizen vorbereiten. Beim Wechsel bleiben beide Varianten gespeichert. Die Reiseübersicht verwendet die jeweils aktive Route.
- **Reisetagebuch** sammelt deine Erinnerungen auf Tagesseiten. Zu einem Eintrag kannst du mehrere Orte verknüpfen sowie Fotos und Videos hinzufügen. Unterstützt werden JPEG, PNG, GIF, WebP, MP4, MOV und WebM mit bis zu 100 MiB je Datei. Bei einem besuchten Stopp kannst du einen Eintrag mit vorausgewähltem Ort beginnen. Auf der Reisekarte findest du besuchte Orte mit Koordinaten. Lieblingsplätze kannst du für spätere Reisen vormerken und auf die Ortekarte der neuen Reise übernehmen.
- **Planungsheft** gibt jeder Reise Platz für offene Fragen, Entscheidungen und Checklisten. Lege etwa das Thema *Lofoten* mit dem Unterthema *Fährüberfahrt* an. In einer Notiz kannst du Abfahrtszeiten vergleichen, einen Weblink festhalten und Aufgaben abhaken. Themen und Notizen lassen sich verschieben, sortieren und durchsuchen. Auch bereits angelegte Reisen erhalten ein leeres Heft.
- **Verknüpfungen im Heft** führen von einem Thema oder einer Notiz zu den passenden Orten, Gebieten, Etappen, Varianten, Anschaffungen, Vorräten, Einkaufsartikeln, Fahrten, Ausgaben oder Tagebucheinträgen. Auch Themen und Notizen können aufeinander verweisen. Zum Beispiel kannst du einen Hafen direkt aus der Notiz anlegen, eine Fährfahrt ergänzen und von dort über **Im Planungsheft** zur Notiz zurückkehren. Ein benanntes Gebiet fasst mehrere Orte unabhängig von der Routenfolge zusammen.
- **Anschaffungen** hält Mengen und Schätzpreise fest. Beim Abhaken kannst du den Kaufpreis bestätigen. **Vorräte & Einkauf** verwaltet Bestand, Verbrauch und Einkaufslisten je Reise. Beim Einkauf werden die gekauften Teilmengen in den Vorrat übernommen und der Bon einmal gebucht.
- **Auto & Verkehr** erfasst Tankstopps, Fähren, Bahnfahrten, Maut und Parkkosten. **Finanzen** zeigt bezahlte und geplante Ausgaben sowie das verfügbare Budget. Für Auslandszahlungen erfasst du den Originalbetrag und den Wert einer Einheit der Landeswährung in deiner Basiswährung.
- **Tags** lassen sich in den Eingabeformularen mit Komma trennen oder aus Vorschlägen wählen. Jede Liste bietet Tagfilter und Gruppierung. Anschaffungen und Fahrten teilen ihre Tags mit der Finanzbuchung. Beim Einkauf übernimmt der Vorrat die Artikel-Tags und der Bon erhält die Tags der gekauften Artikel.
- **Reise exportieren** lädt die Reise im JSON-Format 5 herunter. `places` enthält die Orte der Reise, `visits` referenziert sie über `place_id`. Titelbilder stehen unter `place_image_content`, jeweils einmal pro Ort. Der Export umfasst auch Etappen und Varianten, das Planungsheft, Tagebuchmedien, Favoriten und Finanzen. Beim Update von Schema 4 wird jeder frühere Stopp zu einem Ort mit seiner bisherigen ID. Für eingeplante Stopps entsteht zusätzlich ein Besuch. Bestehende Verweise und Daten im Volume werden übernommen.

### Kartendienste im Docker-Betrieb

Für die voreingestellten Dienste ist kein API-Schlüssel erforderlich. Die gespeicherte Sammlung, Besuchsreihenfolge, Bilder und bereits berechnete Straßenabschnitte liegen auf dem Host. Für neue Kartenausschnitte, externe Ortssuchen und neue Fahrstrecken braucht der jeweilige Dienst eine Internetverbindung. Bei der Namenssuche werden Suchbegriff und Kartenmittelpunkt übermittelt, bei der Umgebungssuche Ausschnitt und Kategorie, beim Routing die angefragten Koordinaten. Die Fahrzeit ist ein Planungswert.

Über die folgenden Umgebungsvariablen lassen sich die Dienste austauschen. Bei Compose kannst du sie in der lokalen `.env` setzen. Mit `docker run` kannst du sie als `-e NAME=WERT` übergeben.

| Einstellung | Voreinstellung | Zweck |
| --- | --- | --- |
| `RR_PHOTON_URL` | `https://photon.komoot.io` | Basis-URL der Namenssuche |
| `RR_OVERPASS_URL` | `https://overpass.private.coffee/api/interpreter` | Vollständiger Endpunkt für die Umgebungssuche |
| `RR_OSRM_URL` | `https://routing.openstreetmap.de/routed-car` | Basis-URL des Auto-Routers |

Die externen Dienste begrenzen ihre Kapazität. Road-Runner speichert wiederholte Suchanfragen zwischen und fragt die Umgebung auf Anforderung in einem begrenzten Ausschnitt ab. Bei einem Ausfall des voreingestellten Overpass-Dienstes kann die Umgebungssuche den Ausschnitt und die gewählte Kategorie an Photon senden. Ein selbst eingestellter Overpass-Endpunkt wird ausschließlich direkt verwendet. Beim Routing hält der Server mindestens eine Sekunde Abstand zwischen Anfragen. [Photon](https://github.com/komoot/photon#demo-server) · [Photon-Suchparameter](https://github.com/komoot/photon/blob/master/docs/api-v1.md) · [Overpass bei Private.coffee](https://overpass.private.coffee/) · [FOSSGIS-Routing](https://map.project-osrm.org/about.html)

## Mit Codex oder einem anderen KI-Agenten planen

Road-Runner bietet einen optionalen MCP-Server über Streamable HTTP am Pfad `/mcp`. Damit kann ein Agent vorhandene Reisen lesen, Reisen anlegen und Routen, Einkäufe, Budget und Tagebuch gemeinsam mit dir pflegen. Er arbeitet direkt mit den Daten der Weboberfläche. Bei aktiviertem Schreibzugriff aktualisiert eine offene Reiseansicht Änderungen innerhalb weniger Sekunden.

### Server einschalten

MCP ist standardmäßig ausgeschaltet. Erzeuge einmal ein zufälliges Token mit Python auf dem Host.

```sh
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Alternativ kannst du es in einem vorhandenen Road-Runner-Container erzeugen.

```sh
docker exec road-runner python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Ergänze für **Docker Compose** diese Zeilen in der lokalen `.env` neben `compose.yaml`. Ersetze den Platzhalter durch das erzeugte Token. Für einen Agenten, der nur nachschlägt und Vorschläge formuliert, setze `RR_MCP_READ_ONLY=true`.

```dotenv
RR_MCP_ENABLED=true
RR_MCP_TOKEN=<dein-zufälliges-Token>
RR_MCP_READ_ONLY=false
```

Das veröffentlichte Image enthält den MCP-Server ab v1.1.0. Starte Compose aus dem bisherigen Projektverzeichnis, damit dieselben Reisedaten eingebunden werden.

```sh
docker compose up -d --pull always
```

Bei **`docker run`** kannst du dieselben drei MCP-Einstellungen über `--env-file .env` mitgeben. Dieser Einzeiler veröffentlicht Road-Runner auf Port 3005 und aktiviert das Watchtower-Label. Beim Ersetzen einer bestehenden Installation übernimm ihren bisherigen Volumenamen und Host-Port.

```sh
docker run -d --name road-runner --restart unless-stopped --pull always -p 3005:8080 -e TZ=Europe/Berlin --env-file .env -v road-runner_reisedaten:/data --label com.centurylinklabs.watchtower.enable=true ghcr.io/timbornemann/road-runner:latest
```

### Agent verbinden

Öffne **KI-Agent verbinden** in der Seitenleiste. Dort findest du den aktuellen Zugriffsmodus, die Adresse und den kopierbaren Codex-Befehl für den verwendeten Host und Port.

Setze auf dem **Gerät mit Codex** die Umgebungsvariable `RR_MCP_TOKEN` auf denselben Wert wie im Container. In PowerShell kannst du das Token verdeckt für die aktuelle Sitzung eingeben.

```powershell
$env:RR_MCP_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host 'Road-Runner-Token' -AsSecureString)).Password
```

Unter Bash gilt die Eingabe ebenfalls für die aktuelle Sitzung.

```bash
read -rs -p 'Road-Runner-Token: ' RR_MCP_TOKEN && export RR_MCP_TOKEN
```

Registriere den Server einmal. Starte Codex anschließend aus einer Umgebung, die das Token enthält. Bei einer Desktop-App kannst du die Variable in den Benutzer-Umgebungsvariablen hinterlegen und die App neu starten. Auf einem anderen Gerät ersetzt du `localhost:8080` durch die LAN-Adresse und den veröffentlichten Port des Docker-Hosts. [MCP in Codex konfigurieren](https://developers.openai.com/codex/mcp/)

```sh
codex mcp add road-runner --url http://localhost:8080/mcp --bearer-token-env-var RR_MCP_TOKEN
```

Andere Clients verwenden die gleiche URL mit dem Transport **Streamable HTTP** und dem Header `Authorization: Bearer <dein-Token>`. Das Token gilt für alle Reisen dieser Installation. Der Lesemodus beschränkt die MCP-Werkzeuge. Für die normale Weboberfläche und deren REST-API gilt weiterhin der Zugriff im vertrauten Netz. Bei Zugriff über öffentliche Netze verwende eine HTTPS-Verbindung über einen entsprechend abgesicherten Host oder ein VPN.

Native Clients wie Codex können den Host per IP oder DNS-Namen ansprechen. Bei Anfragen mit einem Browser-`Origin` akzeptiert der Server denselben Ursprung über `localhost` oder eine IP-Adresse.

**Zum Ausprobieren** eignen sich diese Aufträge.

- „Zeig mir die aktive Route meines Dolomiten-Roadtrips, den nächsten Schlafplatz und das noch freie Budget.“
- „Lege eine Reise nach Norwegen an. Plane die Lofoten als Etappe mit einer Küsten- und einer Bergvariante. Die Fähre am 18. Juni 2027 gehört zu beiden.“
- „Setze zwei Packungen Haferflocken auf die Einkaufsliste meiner Norwegenreise.“
- „Suche in meiner Ortekarte nach Campingplätzen. Plane am Seeufer je einen Besuch für Hin- und Rückfahrt ein und gib mir beide Termine aus.“
- „Lege im Planungsheft das Thema Fährüberfahrt an. Erstelle eine Notiz mit einer Checkliste für die Buchung und verknüpfe sie mit der geplanten Fähre und dem Abfahrtshafen.“

Der MCP-Lesemodus erlaubt das Nachschlagen von Themen, Notizen, Gebieten und Verweisen. Bei Schreibzugriff kann ein Agent dieselben Heftinhalte wie im Browser pflegen. Bearbeiten zwei Personen oder ein Agent und der Browser dieselbe Notiz, prüft der Server beim Speichern die Revision. Im Browser kannst du deinen Entwurf mit der inzwischen gespeicherten Fassung abgleichen.

Zum Ausschalten setze `RR_MCP_ENABLED=false` und erstelle den Container mit denselben Daten neu. Für einen Tokenwechsel aktualisiere `RR_MCP_TOKEN` auf Server und Agentengerät.

## Aktualisieren

**Nach dem Schnellstart mit `docker run`** zuerst das neue Image laden. Sobald der Download erfolgreich war, den bisherigen Container stoppen und entfernen.

```sh
docker pull ghcr.io/timbornemann/road-runner:latest
docker stop road-runner
docker rm road-runner
```

Anschließend den Schnellstartbefehl mit **demselben Volumenamen** erneut ausführen. Bei eigenen Port-, Zeitzonen- oder Label-Einstellungen diese ebenfalls übernehmen. Im Volume liegt die Datenbank unter `/data/road-runner.sqlite3`. Ausstehende Datenbankmigrationen laufen beim Start. Vor Versionswechseln kannst du alle Reisen wie unten beschrieben sichern.

**Mit Docker Compose** im Verzeichnis der mitgelieferten `compose.yaml` für den ersten Start und spätere Updates ausführen.

```sh
docker compose up -d --pull always
```

Compose bindet wie bisher das projektgebundene Volume `reisedaten` ein. Verwende beim Update denselben Compose-Projektnamen. Port und Zeitzone kannst du in der Projektdatei `.env` mit `ROAD_RUNNER_PORT=8181` und `ROAD_RUNNER_TZ=Europe/Berlin` anpassen.

**Mit vorhandenem Watchtower** ist Road-Runner über das Label `com.centurylinklabs.watchtower.enable=true` für Updates markiert. Bei Watchtower begrenzt `--label-enable` die Auswahl auf entsprechend markierte Container. Nutzt deine Instanz zusätzlich einen Scope, ergänze beim Road-Runner-Container das Label `com.centurylinklabs.watchtower.scope=<dein-scope>`. [Watchtower-Containerauswahl](https://containrrr.dev/watchtower/container-selection/) · [Watchtower-Scopes](https://containrrr.dev/watchtower/running-multiple-instances/)

### Zwischen Compose und Schnellstart wechseln

Ermittle zuerst den Namen des Volumes am Mountpunkt `/data`. Für eine bestehende Compose-Installation zeigt ihn folgender Befehl im bisherigen Projektverzeichnis an.

```sh
docker inspect --format '{{range .Mounts}}{{println .Destination .Name}}{{end}}' $(docker compose ps --all --quiet road-runner)
```

Stoppe die alte Installation mit `docker compose down`. Verwende den ermittelten Namen im Schnellstartbefehl anstelle von `road-runner_reisedaten`. Ein anderer Name führt zu einem neuen Datenbestand. `docker compose down -v` löscht projektverwaltete Volumes.

Für den Wechsel **vom Schnellstart zu Compose** stoppe den laufenden Container mit `docker stop road-runner` und entferne ihn mit `docker rm road-runner`. Trage das vorhandene Volume in der obersten `volumes`-Sektion der Compose-Datei ein und führe den Compose-Startbefehl aus. Betreibe jeweils eine schreibende Road-Runner-Instanz pro Datenvolume.

```yaml
volumes:
  reisedaten:
    external: true
    name: road-runner_reisedaten
```

## Alle Reisen sichern und wiederherstellen

Die folgenden Befehle verwenden den **Containernamen** `road-runner` aus dem Schnellstart. **Bei Compose** erhältst du die entsprechende Container-ID mit `docker compose ps --all --quiet road-runner`. Setze diese ID bei `exec`, `cp`, `stop`, `--volumes-from` und `start` anstelle des Containernamens ein.

**Sichern.** Bei laufender Anwendung einen konsistenten SQLite-Snapshot erstellen und auf den Host kopieren. Er enthält auch die Fotos und Videos aus allen Reisetagebüchern. Wähle auf dem Host für jede Sicherung einen eigenen Dateinamen.

```sh
docker exec road-runner python -c "import sqlite3; src=sqlite3.connect('file:/data/road-runner.sqlite3?mode=ro',uri=True); dst=sqlite3.connect('/tmp/road-runner-sicherung.sqlite3'); src.backup(dst); dst.close(); src.close()"
docker cp road-runner:/tmp/road-runner-sicherung.sqlite3 ./road-runner-sicherung.sqlite3
```

**Wiederherstellen.** Lege den gewünschten Snapshot als `road-runner-sicherung.sqlite3` ins aktuelle Verzeichnis. Die Wiederherstellung ersetzt alle Reisen im Datenvolume. Stoppe die Anwendung, spiele die Sicherung mit einem temporären Container ein und starte die Anwendung nach erfolgreicher Wiederherstellung. Die Befehle funktionieren in PowerShell und Bash.

```sh
docker stop road-runner
docker run --rm --volumes-from road-runner -v "${PWD}:/sicherung:ro" ghcr.io/timbornemann/road-runner:latest python -c "import sqlite3; src=sqlite3.connect('file:/sicherung/road-runner-sicherung.sqlite3?mode=ro&immutable=1',uri=True); dst=sqlite3.connect('/data/road-runner.sqlite3'); src.backup(dst); dst.close(); src.close()"
docker start road-runner
```

## Lokale Entwicklung

Im Projektstamm lässt sich der eigene Quellstand als Image bauen.

```sh
docker build -t road-runner:dev .
```

Für die Entwicklung mit Python 3.13 und Node.js ab 22.12 die folgenden Backend-Befehle im Projektstamm ausführen.

```sh
python -m pip install -r backend/requirements-test.txt
python -m unittest discover -v -s backend -t .
```

In `frontend` baut `npm ci` gefolgt von `npm run build` die Oberfläche. Im Projektstamm startet `python -m uvicorn backend.app:app --host 0.0.0.0 --port 8080` die Anwendung. Der Vite-Entwicklungsserver (`npm run dev` in `frontend`) leitet API-Aufrufe an Port 8080 weiter. Die API-Dokumentation liegt unter `/docs`.
