# TimePulse

Automatische tijdsregistratie voor freelancers. Volgt je browseractiviteit via een Chrome extensie, analyseert gaten in je Harvest tijdsregistratie, en laat je ontbrekende uren direct toevoegen via een panel in Harvest zelf of via het dashboard op je NAS.

```
Chrome Extension  →  NAS Server (Python)  →  Harvest API
   (tracker)           (database +              (tijds-
                         dashboard)            registratie)
```

## Onderdelen

- **`extension/`** — Chrome extensie (Manifest V3)
- **`server/`** — Python backend + web dashboard voor op Synology NAS

---

## Installatie op Synology NAS

### 1. Packages installeren via Package Center

- **Python 3.12** (of 3.11)
- **Git Server**

### 2. Verbinden via SSH

**Mac:** open Terminal  
**Windows:** open PowerShell

```bash
ssh admin@192.168.1.xxx
```

### 3. Repo clonen

```bash
cd /volume1/docker
git clone https://github.com/syncit-bv/timepulse.git
cd timepulse/server
```

### 4. Python packages installeren

```bash
pip3 install -r requirements.txt
```

### 5. Harvest credentials instellen

```bash
cp .env.example .env
vi .env
```

Druk `i` om te bewerken, vul in:

```env
HARVEST_ACCESS_TOKEN=hvt_jouw_token_hier
HARVEST_ACCOUNT_ID=jouw_account_id_hier
```

Druk `Esc`, typ `:wq`, druk `Enter`.

**Credentials ophalen:**
1. Ga naar https://id.getharvest.com/developers
2. Klik **Create new personal access token**
3. Kopieer token → `HARVEST_ACCESS_TOKEN`
4. Account ID staat op diezelfde pagina → `HARVEST_ACCOUNT_ID`

### 6. Server starten

```bash
python3 main.py
```

Open in browser: `http://192.168.1.xxx:3456`

### 7. Automatisch opstarten na reboot

In DSM → **Configuratiescherm → Taakplanner → Maken → Geactiveerde taak**:

- Naam: `TimePulse`
- Gebeurtenis: **Opstarten**
- Script:
```bash
cd /volume1/docker/timepulse/server && python3 main.py &
```

---

## Chrome extensie installeren

1. Download de repo als ZIP via GitHub → uitpakken
2. Chrome → `chrome://extensions` → Ontwikkelaarsmodus aan
3. **Uitgepakte extensie laden** → selecteer de map `extension/`
4. Klik op het ⏱ icoon → **Instellingen**
5. Vul in: `http://192.168.1.xxx:3456`
6. **Verbinding testen** → groene stip → **Opslaan**

---

## Updates ophalen

```bash
cd /volume1/docker/timepulse
git pull
# Server herstarten via Taakplanner of SSH
```

---

## Gebruik

### Harvest panel

Op `harvestapp.com` verschijnt een **⏱ TimePulse** knop rechtsonder. Klikken opent een sidebar met:

- **Snel boeken** — recent gebruikte project+taak combinaties (2 klikken om te boeken)
- **Browseractiviteit** — sessiekaarten per tijdsblok, klikken klapt formulier open
- **Onderbrekingen** — snelknoppen voor telefoongesprek, lunch, Teams, etc.

### Dashboard

Open `http://jouw-nas-ip:3456` voor een overzicht van de dag met tijdlijn, Harvest registraties en gaten.

---

## Server endpoints

| Methode | Pad | Beschrijving |
|---------|-----|--------------|
| GET | `/api/health` | Serverstatus |
| POST | `/api/heartbeat` | Heartbeat opslaan |
| POST | `/api/heartbeat/bulk` | Gebufferde heartbeats |
| POST | `/api/idle` | Idle-status |
| GET | `/api/today` | Harvest entries vandaag |
| GET | `/api/entries/:date` | Harvest entries voor datum |
| POST | `/api/entries` | Nieuwe Harvest entry |
| GET | `/api/gaps` | Gaten vandaag |
| GET | `/api/gaps/:date` | Gaten voor datum |
| GET | `/api/sessions/:date` | Activiteitssessies |
| GET | `/api/projects` | Harvest projecten |
| GET | `/api/projects/:id/tasks` | Taken per project |
