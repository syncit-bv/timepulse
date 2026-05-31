"""
Platform definitions: maps URL patterns to activity type labels.

The NAS serves these via GET /api/platforms. The Chrome extension
fetches them on startup and uses them for dynamic URL classification
instead of a hardcoded list in content.js.

Users can add custom platforms via the /api/platforms/custom endpoint.
"""

import json
from db import get_conn

_CA = "https://cdn.clockassist.com/icons"  # ClockAssist icon CDN

# ── Built-in platform list ────────────────────────────────────────────────────
# Format: { slug, name, urls[], color, category, icon? }
# urls: substrings matched against window.location.href

BUILTIN_PLATFORMS = [
    # ── E-mail ────────────────────────────────────────────────────────────────
    {"slug": "gmail",          "name": "Gmail",             "urls": ["mail.google.com"],                                      "color": "#EA4335", "category": "email"},
    {"slug": "outlook",        "name": "Outlook",           "urls": ["outlook.live.com", "outlook.office.com", "outlook.office365.com"], "color": "#0078D4", "category": "email"},

    # ── Project / CRM / tijdregistratie (NL/BE — brondata: ClockAssist) ───────
    {"slug": "simplicate",     "name": "Simplicate",        "urls": ["simplicate.app", "simplicate.com", "simplicate.nl"],   "color": "#FF6B35", "category": "timetracking", "icon": f"{_CA}/simplicate.png"},
    {"slug": "harvest",        "name": "Harvest",           "urls": ["harvestapp.com", "harvest.is"],                        "color": "#F04B23", "category": "timetracking", "icon": f"{_CA}/harvest.png"},
    {"slug": "teamleader",     "name": "Teamleader",        "urls": ["focus.teamleader.eu", "teamleader.eu"],                "color": "#00B0CA", "category": "crm",          "icon": f"{_CA}/teamleader.png"},
    {"slug": "exact",          "name": "Exact Online",      "urls": ["start.exactonline.nl", "start.exactonline.be"],        "color": "#E31837", "category": "accounting",   "icon": f"{_CA}/exact.png"},
    {"slug": "gripp",          "name": "Gripp",             "urls": ["gripp.com"],                                           "color": "#FF6600", "category": "timetracking", "icon": f"{_CA}/gripp.png"},
    {"slug": "admin_pulse",    "name": "AdminPulse",        "urls": ["app.adminpulse.nl", "app.adminpulse.be"],              "color": "#005B96", "category": "timetracking", "icon": f"{_CA}/admin_pulse.png"},
    {"slug": "timechimp",      "name": "TimeChimp",         "urls": ["app.timechimp.com"],                                   "color": "#00C4A7", "category": "timetracking", "icon": f"{_CA}/timechimp.png"},
    {"slug": "yoobi",          "name": "Yoobi",             "urls": ["yoobi.nl/vue"],                                        "color": "#FF4F00", "category": "timetracking", "icon": f"{_CA}/yoobi.png"},
    {"slug": "productive",     "name": "Productive",        "urls": ["app.productive.io"],                                   "color": "#7B4FBF", "category": "timetracking", "icon": f"{_CA}/productive.png"},
    {"slug": "afas",           "name": "AFAS",              "urls": ["afasinsite.nl"],                                       "color": "#EE3124", "category": "timetracking", "icon": f"{_CA}/afas.png"},
    {"slug": "radar360",       "name": "Radar",             "urls": ["web.radarcloud.nl"],                                   "color": "#004B87", "category": "timetracking", "icon": f"{_CA}/radar360.png"},
    {"slug": "fortes",         "name": "FortesMilestones",  "urls": ["fortesmilestones.com"],                                "color": "#003865", "category": "timetracking", "icon": f"{_CA}/fortes.png"},
    {"slug": "fid_manager",    "name": "FID-manager",       "urls": ["fid-manager.be"],                                      "color": "#1A3A6B", "category": "timetracking", "icon": f"{_CA}/fid_manager.png"},
    {"slug": "tribe",          "name": "TribeCRM",          "urls": ["app.tribecrm.nl"],                                     "color": "#E8344A", "category": "crm",          "icon": f"{_CA}/tribe.png"},
    {"slug": "visma_advisor",  "name": "Visma Advisor",     "urls": ["advisor.vismaonline.com"],                             "color": "#004C97", "category": "accounting",   "icon": f"{_CA}/visma_advisor.png"},
    {"slug": "teamwork",       "name": "Teamwork",          "urls": ["teamwork.com/app"],                                    "color": "#F06A35", "category": "timetracking", "icon": f"{_CA}/teamwork.png"},
    {"slug": "xero",           "name": "Xero",              "urls": ["go.xero.com"],                                         "color": "#13B5EA", "category": "accounting",   "icon": f"{_CA}/xero.png"},
    {"slug": "zoho",           "name": "Zoho Projects",     "urls": ["projects.zoho.com", "projects.zoho.eu"],               "color": "#E42527", "category": "timetracking", "icon": f"{_CA}/zoho.png"},
    {"slug": "clio",           "name": "Clio",              "urls": ["app.clio.com"],                                        "color": "#00B388", "category": "timetracking", "icon": f"{_CA}/clio.png"},
    {"slug": "click_up",       "name": "ClickUp",           "urls": ["app.clickup.com"],                                     "color": "#7B68EE", "category": "project",      "icon": f"{_CA}/click_up.png"},

    # ── Overige project management ────────────────────────────────────────────
    {"slug": "jira",           "name": "Jira",              "urls": ["atlassian.net", "/jira/"],                             "color": "#0052CC", "category": "project"},
    {"slug": "linear",         "name": "Linear",            "urls": ["linear.app"],                                          "color": "#5E6AD2", "category": "project"},
    {"slug": "asana",          "name": "Asana",             "urls": ["asana.com"],                                           "color": "#F06A6A", "category": "project"},
    {"slug": "monday",         "name": "Monday.com",        "urls": ["monday.com"],                                          "color": "#FF3D57", "category": "project"},
    {"slug": "trello",         "name": "Trello",            "urls": ["trello.com"],                                          "color": "#0079BF", "category": "project"},
    {"slug": "basecamp",       "name": "Basecamp",          "urls": ["basecamp.com", "3.basecamp.com"],                      "color": "#1D2D35", "category": "project"},
    {"slug": "notion",         "name": "Notion",            "urls": ["notion.so", "notion.site"],                            "color": "#000000", "category": "project"},
    {"slug": "confluence",     "name": "Confluence",        "urls": ["confluence.atlassian.net", "/wiki/spaces/"],           "color": "#0052CC", "category": "project"},
    {"slug": "wrike",          "name": "Wrike",             "urls": ["app.wrike.com"],                                       "color": "#00C875", "category": "project",      "icon": f"{_CA}/wrike.png"},

    # ── Code & dev ────────────────────────────────────────────────────────────
    {"slug": "github",         "name": "GitHub",            "urls": ["github.com"],                                          "color": "#24292F", "category": "development"},
    {"slug": "gitlab",         "name": "GitLab",            "urls": ["gitlab.com"],                                          "color": "#FC6D26", "category": "development"},
    {"slug": "bitbucket",      "name": "Bitbucket",         "urls": ["bitbucket.org"],                                       "color": "#0052CC", "category": "development"},
    {"slug": "vercel",         "name": "Vercel",            "urls": ["vercel.com"],                                          "color": "#000000", "category": "development"},
    {"slug": "netlify",        "name": "Netlify",           "urls": ["netlify.com"],                                         "color": "#00C7B7", "category": "development"},
    {"slug": "stackoverflow",  "name": "Stack Overflow",    "urls": ["stackoverflow.com"],                                   "color": "#F48024", "category": "development"},

    # ── Documenten ────────────────────────────────────────────────────────────
    {"slug": "googleDocs",     "name": "Google Docs",       "urls": ["docs.google.com/document"],                           "color": "#4285F4", "category": "document"},
    {"slug": "googleSheets",   "name": "Google Sheets",     "urls": ["docs.google.com/spreadsheets"],                       "color": "#0F9D58", "category": "document"},
    {"slug": "googleSlides",   "name": "Google Slides",     "urls": ["docs.google.com/presentation"],                       "color": "#F4B400", "category": "document"},
    {"slug": "googledrive",    "name": "Google Drive",      "urls": ["drive.google.com"],                                    "color": "#4285F4", "category": "document"},
    {"slug": "sharepointDoc",  "name": "SharePoint",        "urls": ["sharepoint.com/Doc.aspx", "sharepoint.com/:w:"],      "color": "#0078D4", "category": "document"},
    {"slug": "onedrive",       "name": "OneDrive",          "urls": ["onedrive.live.com", "onedrive.com"],                   "color": "#0078D4", "category": "document"},
    {"slug": "dropbox",        "name": "Dropbox",           "urls": ["dropbox.com"],                                         "color": "#0061FF", "category": "document"},

    # ── Design ────────────────────────────────────────────────────────────────
    {"slug": "figma",          "name": "Figma",             "urls": ["figma.com"],                                           "color": "#F24E1E", "category": "design"},
    {"slug": "miro",           "name": "Miro",              "urls": ["miro.com"],                                            "color": "#FFD02F", "category": "design"},
    {"slug": "canva",          "name": "Canva",             "urls": ["canva.com"],                                           "color": "#00C4CC", "category": "design"},
    {"slug": "sketch",         "name": "Sketch",            "urls": ["sketch.com"],                                          "color": "#F7B500", "category": "design"},

    # ── Communicatie ──────────────────────────────────────────────────────────
    {"slug": "slack",          "name": "Slack",             "urls": ["slack.com"],                                           "color": "#4A154B", "category": "communication"},
    {"slug": "teams",          "name": "Microsoft Teams",   "urls": ["teams.microsoft.com", "teams.live.com"],               "color": "#6264A7", "category": "communication"},
    {"slug": "zoom",           "name": "Zoom",              "urls": ["zoom.us"],                                             "color": "#2D8CFF", "category": "communication"},
    {"slug": "meet",           "name": "Google Meet",       "urls": ["meet.google.com"],                                     "color": "#00BCD4", "category": "communication"},
    {"slug": "discord",        "name": "Discord",           "urls": ["discord.com"],                                         "color": "#5865F2", "category": "communication"},
    {"slug": "whatsapp",       "name": "WhatsApp Web",      "urls": ["web.whatsapp.com"],                                    "color": "#25D366", "category": "communication"},

    # ── CRM / Sales ───────────────────────────────────────────────────────────
    {"slug": "salesforce",     "name": "Salesforce",        "urls": ["salesforce.com"],                                      "color": "#00A1E0", "category": "crm"},
    {"slug": "hubspot",        "name": "HubSpot",           "urls": ["hubspot.com", "app.hubspot.com"],                      "color": "#FF7A59", "category": "crm"},
    {"slug": "pipedrive",      "name": "Pipedrive",         "urls": ["pipedrive.com"],                                       "color": "#1A1F36", "category": "crm"},

    # ── Boekhouding (overig) ──────────────────────────────────────────────────
    {"slug": "billtobox",      "name": "BillToBox",         "urls": ["billtobox.be"],                                        "color": "#0D6EFD", "category": "accounting"},
    {"slug": "yuki",           "name": "Yuki",              "urls": ["yuki.nl", "app.yuki.nl"],                              "color": "#E8650A", "category": "accounting"},
    {"slug": "winbooks",       "name": "Winbooks",          "urls": ["winbooks.be"],                                         "color": "#004B8D", "category": "accounting"},

    # ── Overige tijdregistratie ───────────────────────────────────────────────
    {"slug": "toggl",          "name": "Toggl",             "urls": ["toggl.com"],                                           "color": "#E57CD8", "category": "timetracking"},
    {"slug": "clockify",       "name": "Clockify",          "urls": ["clockify.me"],                                         "color": "#03A9F4", "category": "timetracking"},

    # ── AI tools ──────────────────────────────────────────────────────────────
    {"slug": "chatgpt",        "name": "ChatGPT",           "urls": ["chatgpt.com", "chat.openai.com"],                      "color": "#00A67E", "category": "ai"},
    {"slug": "claude",         "name": "Claude",            "urls": ["claude.ai"],                                           "color": "#CC785C", "category": "ai"},
    {"slug": "gemini",         "name": "Gemini",            "urls": ["gemini.google.com"],                                   "color": "#4285F4", "category": "ai"},
    {"slug": "copilot",        "name": "Microsoft Copilot", "urls": ["copilot.microsoft.com"],                               "color": "#0078D4", "category": "ai"},

    # ── Overig ────────────────────────────────────────────────────────────────
    {"slug": "pdf",            "name": "PDF",               "urls": [".pdf"],                                                "color": "#FF0000", "category": "document"},
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
