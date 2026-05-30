# TimePulse

Automatische tijdsregistratie voor freelancers. Volgt je browseractiviteit via een Chrome extensie, analyseert gaten in je Harvest tijdsregistratie, en laat je ontbrekende uren direct toevoegen via een dashboard op je NAS.

```
Chrome Extension  →  NAS Server (Docker)  →  Harvest API
   (tracker)            (database +              (tijds-
                         dashboard)            registratie)
```

## Onderdelen

- **`extension/`** — Chrome extensie (Manifest V3)
- **`server/`** — Node.js backend + web dashboard voor op Synology NAS

---

## Snelstart

### 1. Server opzetten (Synology NAS)

```bash
cd server
cp .env.example .env
# Vul .env in met je Harvest credentials (zie hieronder)
docker compose up -d
```

De server draait nu op `http://jouw-nas-ip:3456`.

### Harvest credentials ophalen

1. Ga naar [https://id.getharvest.com/developers](https://id.getharvest.com/developers)
2. Klik **Create new personal access token**
3. Kopieer de token naar `HARVEST_ACCESS_TOKEN` in `.env`
4. Kopieer het **Account ID** (staat op dezelfde pagina) naar `HARVEST_ACCOUNT_ID`

```env
HARVEST_ACCESS_TOKEN=hvt_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
HARVEST_ACCOUNT_ID=1234567
```

### 2. Chrome extensie installeren

1. Open Chrome → `chrome://extensions/`
2. Zet **Ontwikkelaarsmodus** aan (rechtsboven)
3. Klik **Uitgepakte extensie laden**
4. Selecteer de map `extension/`

### 3. Extensie configureren

1. Klik op het TimePulse icoon in de werkbalk
2. Ga naar **Instellingen**
3. Vul de **NAS server URL** in, bijv. `http://192.168.1.100:3456`
4. Klik **Verbinding testen** — je ziet een groene stip als het werkt
5. Klik **Opslaan**

---

## Gebruik

### Chrome extensie popup

- **Nu bijgehouden** — welke website actief is op dit moment
- **Vandaag in Harvest** — totaal geregistreerde uren + overzicht per project
- **Gaten** — periodes met browseractiviteit maar geen Harvest registratie

Klik op een gat → je gaat direct naar het dashboard met het gat voorgeselecteerd.

### Dashboard (NAS)

Open `http://jouw-nas-ip:3456` in de browser.

- **Tijdlijn** — blauw = browseractiviteit, groen = Harvest registraties, oranje = gaten
- **Harvest registraties** — wat er al geregistreerd staat voor die dag
- **Gaten** — klik **Toevoegen aan Harvest** om een gat in te vullen

### Gat toevoegen aan Harvest

1. Klik op een gat (in popup of dashboard)
2. Pas begin/eindtijd aan indien nodig
3. Selecteer project en taak
4. Voeg optioneel notities toe
5. Klik **Toevoegen aan Harvest**

---

## Hoe werkt de gatenanalyse?

1. De extensie stuurt elke **30 seconden** een heartbeat naar de server met de actieve URL
2. Heartbeats worden gegroepeerd tot **sessies** (activiteitblokken, max 5 min onderbreking)
3. De server haalt **Harvest entries** op voor die dag
4. Sessies zonder overeenkomende Harvest entry (≥ 15 min) worden als **gat** gemarkeerd
5. Bij elke sessie worden de bezochte domeinen bijgehouden als context

### Offline werking

Als de NAS niet bereikbaar is (bijv. werken vanuit café), buffert de extensie heartbeats lokaal. Zodra de server weer bereikbaar is, worden alle gebufferde heartbeats automatisch doorgestuurd.

---

## Technische details

### Server endpoints

| Methode | Pad | Beschrijving |
|---------|-----|--------------|
| GET | `/api/health` | Serverstatus + Harvest configuratie |
| POST | `/api/heartbeat` | Enkele heartbeat opslaan |
| POST | `/api/heartbeat/bulk` | Gebufferde heartbeats opslaan |
| POST | `/api/idle` | Idle-status wijziging |
| GET | `/api/today` | Harvest entries voor vandaag |
| GET | `/api/entries/:date` | Harvest entries voor datum |
| POST | `/api/entries` | Nieuwe Harvest entry aanmaken |
| GET | `/api/gaps` | Gaten voor vandaag |
| GET | `/api/gaps/:date` | Gaten voor datum |
| GET | `/api/sessions/:date` | Activiteitssessies voor datum |
| GET | `/api/projects` | Actieve Harvest projecten |
| GET | `/api/projects/:id/tasks` | Taken per project |

### Database

SQLite op `/data/timepulse.db` (binnen Docker volume).

- `heartbeats` — ruwe browseractiviteit (url, domain, title, timestamp)
- `idle_events` — idle/active overgangen

### Externe toegang via DDNS

Om het dashboard ook buiten je thuisnetwerk te gebruiken, stel je op de Synology een DDNS-adres in via **Configuratiescherm → Externe toegang → DDNS**. Gebruik dat adres als server URL in de extensie.
