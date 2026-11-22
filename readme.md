# Road-Runner

Road-Runner ist ein deutschsprachiger Reiseplaner für Solo-Reisende. Eine Docker-Instanz stellt die Weboberfläche und die SQLite-Datenbank für alle Geräte im lokalen Netz bereit.

## Start und Zugriff

Docker mit Compose installieren und im Projektverzeichnis ausführen.

```sh
docker compose up -d --build
docker compose ps
```

Am Host öffnest du [Road-Runner auf Port 8080](http://localhost:8080). Am Handy verwendest du im selben Netz `http://<LAN-IP-des-Hosts>:8080`. Die LAN-IP steht unter Windows bei `ipconfig` am WLAN- oder Ethernet-Adapter. Der Port wird auf allen Host-Schnittstellen veröffentlicht. Falls der Host eine Firewall verwendet, erlaube eingehendes TCP auf diesem Port für dein privates Netz. Jedes Gerät mit Zugriff auf die Adresse kann die Reisen lesen und bearbeiten.

Der Host-Port lässt sich mit `ROAD_RUNNER_PORT` ändern. Dafür im Projektverzeichnis eine `.env` mit beispielsweise `ROAD_RUNNER_PORT=8181` anlegen und Compose erneut starten. Das Serverdatum verwendet standardmäßig die Zeitzone `Europe/Berlin`. Über `ROAD_RUNNER_TZ` lässt sie sich anpassen.

Bei der ersten Initialisierung steht die gekennzeichnete Beispielreise „Dolomiten-Roadtrip“ bereit. Über **Neue Reise** legst du eine leere Reise an. Im Reiseumschalter kannst du Reisen öffnen, bearbeiten und die Beispielreise löschen.

## Unterwegs

- **Route & Orte** – Für einen neuen Stopp genügt ein Name. In der **Routenfolge** kannst du flexible Stopps und feste Termine mischen und per Pfeil oder Ziehen umsortieren. Ein Datum lässt sich später ergänzen oder entfernen. Die Tagesansicht ordnet feste Termine nach Datum und zeigt flexible Ziele separat. Die Merkliste sammelt Ideen, bis du sie in die Route übernimmst. Orte lassen sich auf der Karte markieren, Schlafplätze mit An- und Abreise versehen und Ziele in Google Maps öffnen. Für Kartenkacheln und externe Navigation wird Internet benötigt. Listen und Formulare funktionieren bei erreichbarem Docker-Host auch bei Ausfall des Kartendiensts.
- **Anschaffungen** – Gegenstände, Mengen und geplante Kosten erfassen. Beim Kauf den tatsächlichen Betrag eintragen und die Anschaffung abhaken.
- **Vorräte & Einkauf** – Lebensmittel je Reise führen und Verbrauch abbuchen. Einen Einkauf mit ausgewählten Artikeln und tatsächlichen Teilmengen abschließen. Der Kassenbon erscheint einmal im Ausgabenbuch, der Restbedarf bleibt auf der Liste.
- **Auto & Verkehr** – Tankstopps mit Litern und Kilometerstand, Fähr- und Bahnfahrten mit Start, Ziel und Zeiten sowie Parken, Maut und weitere Verkehrskosten dokumentieren.
- **Finanzen** – Bezahlte und geplante Ausgaben ergeben gemeinsam mit dem Budget den verfügbaren Betrag. Eine Ausgabe kann mit Originalbetrag, Landeswährung und Kurs erfasst werden. Der Kurs gibt den Wert **einer Einheit der Landeswährung in der Basiswährung** an. Bei einer Zahlung aktualisiert die App die zugehörige Buchung.

### Mit Tags filtern und gruppieren

Jeder Stopp, jede Anschaffung, jeder Vorrats- oder Einkaufsartikel, jede Fahrt und jede Ausgabe kann mehrere eigene Tags tragen, etwa **Schlafen**, **Camping** oder **Elektronik**. Im Formular trennst du die Tags mit Kommas oder wählst einen Vorschlag aus derselben Reise. Der Tagfilter grenzt die jeweilige Liste ein. **Nach Tags gruppieren** zeigt einen mehrfach gekennzeichneten Eintrag in jeder passenden Gruppe. Mengen und Kosten werden einmal gezählt. **Ohne Tag** zeigt Einträge, denen du noch Tags geben kannst.

Anschaffungen und Fahrten teilen ihre Tags mit der verknüpften Finanzbuchung. Beim Lebensmitteleinkauf übernimmt der Vorrat die Artikel-Tags und der neue Bon erhält die Tags der gekauften Artikel zusammen.

## Daten und Updates

Die Datenbank liegt unter `/data/road-runner.sqlite3` im benannten Compose-Volume `reisedaten`. Compose ordnet dieses Volume dem Projekt zu. Bei einem Update im selben Projektverzeichnis bleiben Daten und IDs erhalten. Für einen Versionswechsel den gewünschten neuen Quellstand bereitstellen und ausführen:

```sh
docker compose up -d --build
```

Beim Start prüft die App die Datenbankversion und führt ausstehende Migrationen aus. Vor einem Update empfiehlt sich eine Sicherung. `docker compose down -v` löscht die Volumes des Projekts einschließlich der Reisedaten.

### Eine Reise exportieren

Im Seitenmenü **Reise exportieren** wählen. Exportformat 2 enthält `schema_version`, den Exportzeitpunkt und alle Einträge der gewählten Reise einschließlich IDs, Tags, Kaufpositionen, Finanzverknüpfungen und Wechselkursen. Für Routenstopps bestimmt `position` die Besuchsreihenfolge. `date: null` kennzeichnet einen offenen Termin, `saved: true` einen Ort auf der Merkliste. Das Format ist für den Import in eine spätere App vorgesehen. Eine vollständige Systemsicherung umfasst die SQLite-Datenbank.

### Alle Reisen sichern

Der folgende Befehl erzeugt bei laufender Anwendung einen konsistenten SQLite-Snapshot im Container. Kopiere ihn anschließend auf den Host. Verwende für jede Sicherung einen eigenen Dateinamen.

```sh
docker compose exec -T road-runner python -c "import sqlite3; src=sqlite3.connect('file:/data/road-runner.sqlite3?mode=ro',uri=True); dst=sqlite3.connect('/tmp/road-runner-sicherung.sqlite3'); src.backup(dst); dst.close(); src.close()"
docker compose cp road-runner:/tmp/road-runner-sicherung.sqlite3 ./road-runner-sicherung.sqlite3
```

### Sicherung wiederherstellen

Lege die gewünschte Sicherung als `road-runner-sicherung.sqlite3` ins Projektverzeichnis. Die Wiederherstellung ersetzt den aktuellen Datenbestand durch den Snapshot. Sichere den aktuellen Stand bei Bedarf zuvor. Folgende Befehle funktionieren in PowerShell und Bash.

```sh
docker compose stop road-runner
docker compose run --rm --no-deps -v "${PWD}:/sicherung:ro" road-runner python -c "import sqlite3; src=sqlite3.connect('file:/sicherung/road-runner-sicherung.sqlite3?mode=ro&immutable=1',uri=True); dst=sqlite3.connect('/data/road-runner.sqlite3'); src.backup(dst); dst.close(); src.close()"
docker compose up -d
```

## Lokale Entwicklung

Im Projektstamm mit Python 3.13 oder neuer die Backend-Abhängigkeiten installieren und die Tests ausführen.

```sh
python -m pip install -r backend/requirements-test.txt
python -m unittest -v backend.test_app
```

In `frontend` mit Node.js 22.12 oder neuer `npm ci` und `npm run build` ausführen. Anschließend startet im Projektstamm `python -m uvicorn backend.app:app --host 0.0.0.0 --port 8080` die komplette Anwendung. Für Frontend-Entwicklung startet `npm run dev` in `frontend` einen Vite-Server mit API-Proxy auf Port 8080. `RR_DATA_DIR` legt das lokale Datenverzeichnis fest, `RR_STATIC_DIR` den Pfad zur gebauten Oberfläche. Die API-Dokumentation ist unter `/docs` verfügbar.
