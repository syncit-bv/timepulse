"""
Platform definitions: maps URL patterns to activity type labels.

The NAS serves these via GET /api/platforms. The Chrome extension
fetches them on startup and uses them for dynamic URL classification
instead of a hardcoded list in content.js.

Users can add custom platforms via the /api/platforms/custom endpoint.
"""

import json
from db import get_conn

# ── Built-in platform list ────────────────────────────────────────────────────
# Format: { slug, name, urls[], color, category }
# urls: substrings matched against window.location.href

BUILTIN_PLATFORMS = [
    # ── E-mail ────────────────────────────────────────────────────────────────
    {"slug": "gmail",        "name": "Gmail",           "urls": ["mail.google.com"],                                  "color": "#EA4335", "category": "email"},
    {"slug": "outlook",      "name": "Outlook",         "urls": ["outlook.live.com", "outlook.office.com", "outlook.office365.com"], "color": "#0078D4", "category": "email"},

    # ── Project management ────────────────────────────────────────────────────
    {"slug": "jira",         "name": "Jira",            "urls": ["atlassian.net", "/jira/"],                          "color": "#0052CC", "category": "project"},
    {"slug": "linear",       "name": "Linear",          "urls": ["linear.app"],                                       "color": "#5E6AD2", "category": "project"},
    {"slug": "asana",        "name": "Asana",           "urls": ["asana.com"],                                        "color": "#F06A6A", "category": "project"},
    {"slug": "monday",       "name": "Monday.com",      "urls": ["monday.com"],                                       "color": "#FF3D57", "category": "project"},
    {"slug": "clickup",      "name": "ClickUp",         "urls": ["clickup.com"],                                      "color": "#7B68EE", "category": "project"},
    {"slug": "trello",       "name": "Trello",          "urls": ["trello.com"],                                       "color": "#0079BF", "category": "project"},
    {"slug": "basecamp",     "name": "Basecamp",        "urls": ["basecamp.com", "3.basecamp.com"],                   "color": "#1D2D35", "category": "project"},
    {"slug": "notion",       "name": "Notion",          "urls": ["notion.so", "notion.site"],                         "color": "#000000", "category": "project"},
    {"slug": "confluence",   "name": "Confluence",      "urls": ["confluence.atlassian.net", "/wiki/spaces/"],        "color": "#0052CC", "category": "project"},

    # ── Code & dev ────────────────────────────────────────────────────────────
    {"slug": "github",       "name": "GitHub",          "urls": ["github.com"],                                       "color": "#24292F", "category": "development"},
    {"slug": "gitlab",       "name": "GitLab",          "urls": ["gitlab.com"],                                       "color": "#FC6D26", "category": "development"},
    {"slug": "bitbucket",    "name": "Bitbucket",       "urls": ["bitbucket.org"],                                    "color": "#0052CC", "category": "development"},
    {"slug": "vercel",       "name": "Vercel",          "urls": ["vercel.com"],                                       "color": "#000000", "category": "development"},
    {"slug": "netlify",      "name": "Netlify",         "urls": ["netlify.com"],                                      "color": "#00C7B7", "category": "development"},
    {"slug": "stackoverflow", "name": "Stack Overflow", "urls": ["stackoverflow.com"],                                "color": "#F48024", "category": "development"},

    # ── Documents ─────────────────────────────────────────────────────────────
    {"slug": "googleDocs",   "name": "Google Docs",     "urls": ["docs.google.com/document"],                        "color": "#4285F4", "category": "document"},
    {"slug": "googleSheets", "name": "Google Sheets",   "urls": ["docs.google.com/spreadsheets"],                    "color": "#0F9D58", "category": "document"},
    {"slug": "googleSlides", "name": "Google Slides",   "urls": ["docs.google.com/presentation"],                    "color": "#F4B400", "category": "document"},
    {"slug": "googledrive",  "name": "Google Drive",    "urls": ["drive.google.com"],                                 "color": "#4285F4", "category": "document"},
    {"slug": "sharepointDoc","name": "SharePoint",      "urls": ["sharepoint.com/Doc.aspx", "sharepoint.com/:w:"],   "color": "#0078D4", "category": "document"},
    {"slug": "onedrive",     "name": "OneDrive",        "urls": ["onedrive.live.com", "onedrive.com"],                "color": "#0078D4", "category": "document"},
    {"slug": "dropbox",      "name": "Dropbox",         "urls": ["dropbox.com"],                                      "color": "#0061FF", "category": "document"},

    # ── Design ────────────────────────────────────────────────────────────────
    {"slug": "figma",        "name": "Figma",           "urls": ["figma.com"],                                        "color": "#F24E1E", "category": "design"},
    {"slug": "miro",         "name": "Miro",            "urls": ["miro.com"],                                         "color": "#FFD02F", "category": "design"},
    {"slug": "canva",        "name": "Canva",           "urls": ["canva.com"],                                        "color": "#00C4CC", "category": "design"},
    {"slug": "sketch",       "name": "Sketch",          "urls": ["sketch.com"],                                       "color": "#F7B500", "category": "design"},

    # ── Communication ─────────────────────────────────────────────────────────
    {"slug": "slack",        "name": "Slack",           "urls": ["slack.com"],                                        "color": "#4A154B", "category": "communication"},
    {"slug": "teams",        "name": "Microsoft Teams", "urls": ["teams.microsoft.com", "teams.live.com"],            "color": "#6264A7", "category": "communication"},
    {"slug": "zoom",         "name": "Zoom",            "urls": ["zoom.us"],                                          "color": "#2D8CFF", "category": "communication"},
    {"slug": "meet",         "name": "Google Meet",     "urls": ["meet.google.com"],                                  "color": "#00BCD4", "category": "communication"},
    {"slug": "discord",      "name": "Discord",         "urls": ["discord.com"],                                      "color": "#5865F2", "category": "communication"},
    {"slug": "whatsapp",     "name": "WhatsApp Web",    "urls": ["web.whatsapp.com"],                                 "color": "#25D366", "category": "communication"},

    # ── CRM / Sales ───────────────────────────────────────────────────────────
    {"slug": "salesforce",   "name": "Salesforce",      "urls": ["salesforce.com", "lightning.force.com"],            "color": "#00A1E0", "category": "crm"},
    {"slug": "hubspot",      "name": "HubSpot",         "urls": ["hubspot.com", "app.hubspot.com"],                   "color": "#FF7A59", "category": "crm"},
    {"slug": "teamleader",   "name": "Teamleader",      "urls": ["teamleader.eu", "focus.teamleader.eu"],             "color": "#00B0CA", "category": "crm"},
    {"slug": "pipedrive",    "name": "Pipedrive",       "urls": ["pipedrive.com"],                                    "color": "#1A1F36", "category": "crm"},

    # ── Boekhouding ───────────────────────────────────────────────────────────
    {"slug": "exact",        "name": "Exact Online",    "urls": ["exact.com", "start.exactonline.be", "start.exactonline.nl"], "color": "#E31837", "category": "accounting"},
    {"slug": "billtobox",    "name": "BillToBox",       "urls": ["billtobox.be"],                                     "color": "#0D6EFD", "category": "accounting"},
    {"slug": "yuki",         "name": "Yuki",            "urls": ["yuki.nl", "app.yuki.nl"],                           "color": "#E8650A", "category": "accounting"},
    {"slug": "draftit",      "name": "DraftIT",         "urls": ["draftit.be"],                                       "color": "#003087", "category": "accounting"},
    {"slug": "winbooks",     "name": "Winbooks",        "urls": ["winbooks.be"],                                      "color": "#004B8D", "category": "accounting"},

    # ── Tijdsregistratie ──────────────────────────────────────────────────────
    {"slug": "harvest",      "name": "Harvest",         "urls": ["harvestapp.com", "harvest.is"],                     "color": "#F04B23", "category": "timetracking"},
    {"slug": "toggl",        "name": "Toggl",           "urls": ["toggl.com"],                                        "color": "#E57CD8", "category": "timetracking"},
    {"slug": "clockify",     "name": "Clockify",        "urls": ["clockify.me"],                                      "color": "#03A9F4", "category": "timetracking"},

    # ── AI tools ──────────────────────────────────────────────────────────────
    {"slug": "chatgpt",      "name": "ChatGPT",         "urls": ["chatgpt.com", "chat.openai.com"],                   "color": "#00A67E", "category": "ai"},
    {"slug": "claude",       "name": "Claude",          "urls": ["claude.ai"],                                        "color": "#CC785C", "category": "ai"},
    {"slug": "gemini",       "name": "Gemini",          "urls": ["gemini.google.com"],                                "color": "#4285F4", "category": "ai"},
    {"slug": "copilot",      "name": "Microsoft Copilot","urls": ["copilot.microsoft.com"],                           "color": "#0078D4", "category": "ai"},

    # ── Overig ────────────────────────────────────────────────────────────────
    {"slug": "pdf",          "name": "PDF",             "urls": [".pdf"],                                             "color": "#FF0000", "category": "document"},
]


def get_platforms() -> list:
    """Returns merged list: builtins + user-defined custom platforms."""
    custom = _load_custom()
    slugs_custom = {p["slug"] for p in custom}
    merged = [p for p in BUILTIN_PLATFORMS if p["slug"] not in slugs_custom]
    merged.extend(custom)
    return merged


def get_custom_platforms() -> list:
    return _load_custom()


def save_custom_platform(platform: dict):
    custom = _load_custom()
    existing = next((i for i, p in enumerate(custom) if p["slug"] == platform["slug"]), None)
    if existing is not None:
        custom[existing] = platform
    else:
        custom.append(platform)
    _save_custom(custom)


def delete_custom_platform(slug: str):
    custom = [p for p in _load_custom() if p["slug"] != slug]
    _save_custom(custom)


# ── Persistence ───────────────────────────────────────────────────────────────

def _ensure_settings_table():
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)


def _load_custom() -> list:
    _ensure_settings_table()
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = 'custom_platforms'").fetchone()
        if row:
            return json.loads(row["value"])
        return []


def _save_custom(platforms: list):
    _ensure_settings_table()
    with get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('custom_platforms', ?)",
            (json.dumps(platforms),)
        )
