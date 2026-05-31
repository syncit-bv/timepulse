"""
Platform definitions: maps URL patterns to activity type labels.

Custom platforms are now stored per-user in PostgreSQL (db.py).
This module only exposes the built-in platform list.
"""

import json
from typing import Optional

_CA = "https://cdn.clockassist.com/icons"  # ClockAssist icon CDN

# ── Built-in platform list ────────────────────────────────────────────────────
# Format: { slug, name, urls[], categories[], color, icon? }
# categories: list — a platform can belong to multiple categories
# urls: substrings matched against window.location.href

BUILTIN_PLATFORMS = [
    # ── E-mail ────────────────────────────────────────────────────────────────
    {"slug": "gmail",         "name": "Gmail",             "urls": ["mail.google.com"],                                       "categories": ["email"],                              "color": "#EA4335", "icon": "https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico"},
    {"slug": "outlook",       "name": "Outlook",           "urls": ["outlook.live.com", "outlook.office.com", "outlook.office365.com"], "categories": ["email"],               "color": "#0078D4", "icon": "https://res-1.cdn.office.net/elf/prod/shared/resources/prod/favicons/outlook/favicon.ico"},

    # ── NL/BE all-in-one tools (tijdregistratie + CRM + project) ─────────────
    {"slug": "simplicate",    "name": "Simplicate",        "urls": ["simplicate.app", "simplicate.com", "simplicate.nl"],    "categories": ["timetracking", "crm", "project"],     "color": "#FF6B35", "icon": f"{_CA}/simplicate.png"},
    {"slug": "teamleader",    "name": "Teamleader",        "urls": ["focus.teamleader.eu", "teamleader.eu"],                 "categories": ["timetracking", "crm", "project"],     "color": "#00B0CA", "icon": f"{_CA}/teamleader.png"},
    {"slug": "gripp",         "name": "Gripp",             "urls": ["gripp.com"],                                            "categories": ["timetracking", "crm", "project"],     "color": "#FF6600", "icon": f"{_CA}/gripp.png"},
    {"slug": "admin_pulse",   "name": "AdminPulse",        "urls": ["app.adminpulse.nl", "app.adminpulse.be"],               "categories": ["timetracking", "crm", "project"],     "color": "#005B96", "icon": f"{_CA}/admin_pulse.png"},
    {"slug": "yoobi",         "name": "Yoobi",             "urls": ["yoobi.nl/vue"],                                         "categories": ["timetracking", "crm", "project"],     "color": "#FF4F00", "icon": f"{_CA}/yoobi.png"},
    {"slug": "tribe",         "name": "TribeCRM",          "urls": ["app.tribecrm.nl"],                                      "categories": ["timetracking", "crm"],                "color": "#E8344A", "icon": f"{_CA}/tribe.png"},
    {"slug": "fid_manager",   "name": "FID-manager",       "urls": ["fid-manager.be"],                                       "categories": ["timetracking", "crm"],                "color": "#1A3A6B", "icon": f"{_CA}/fid_manager.png"},

    # ── Tijdregistratie + project ─────────────────────────────────────────────
    {"slug": "harvest",       "name": "Harvest",           "urls": ["harvestapp.com", "harvest.is"],                         "categories": ["timetracking", "project"],            "color": "#F04B23", "icon": f"{_CA}/harvest.png"},
    {"slug": "productive",    "name": "Productive",        "urls": ["app.productive.io"],                                    "categories": ["timetracking", "project"],            "color": "#7B4FBF", "icon": f"{_CA}/productive.png"},
    {"slug": "teamwork",      "name": "Teamwork",          "urls": ["teamwork.com/app"],                                     "categories": ["timetracking", "project"],            "color": "#F06A35", "icon": f"{_CA}/teamwork.png"},
    {"slug": "click_up",      "name": "ClickUp",           "urls": ["app.clickup.com"],                                      "categories": ["timetracking", "project"],            "color": "#7B68EE", "icon": f"{_CA}/click_up.png"},
    {"slug": "radar360",      "name": "Radar",             "urls": ["web.radarcloud.nl"],                                    "categories": ["timetracking", "project"],            "color": "#004B87", "icon": f"{_CA}/radar360.png"},
    {"slug": "fortes",        "name": "FortesMilestones",  "urls": ["fortesmilestones.com"],                                 "categories": ["timetracking", "project"],            "color": "#003865", "icon": f"{_CA}/fortes.png"},
    {"slug": "timechimp",     "name": "TimeChimp",         "urls": ["app.timechimp.com"],                                    "categories": ["timetracking", "project"],            "color": "#00C4A7", "icon": f"{_CA}/timechimp.png"},
    {"slug": "zoho",          "name": "Zoho Projects",     "urls": ["projects.zoho.com", "projects.zoho.eu"],                "categories": ["timetracking", "project"],            "color": "#E42527", "icon": f"{_CA}/zoho.png"},
    {"slug": "clio",          "name": "Clio",              "urls": ["app.clio.com"],                                         "categories": ["timetracking", "crm"],                "color": "#00B388", "icon": f"{_CA}/clio.png"},
    {"slug": "wrike",         "name": "Wrike",             "urls": ["app.wrike.com"],                                        "categories": ["timetracking", "project"],            "color": "#00C875", "icon": f"{_CA}/wrike.png"},

    # ── Tijdregistratie + boekhouding ─────────────────────────────────────────
    {"slug": "exact",         "name": "Exact Online",      "urls": ["start.exactonline.nl", "start.exactonline.be"],         "categories": ["timetracking", "accounting"],         "color": "#E31837", "icon": f"{_CA}/exact.png"},
    {"slug": "afas",          "name": "AFAS",              "urls": ["afasinsite.nl"],                                        "categories": ["timetracking", "accounting"],         "color": "#EE3124", "icon": f"{_CA}/afas.png"},
    {"slug": "xero",          "name": "Xero",              "urls": ["go.xero.com"],                                          "categories": ["timetracking", "accounting"],         "color": "#13B5EA", "icon": f"{_CA}/xero.png"},
    {"slug": "visma_advisor", "name": "Visma Advisor",     "urls": ["advisor.vismaonline.com"],                              "categories": ["timetracking", "accounting"],         "color": "#004C97", "icon": f"{_CA}/visma_advisor.png"},

    # ── Tijdregistratie only ──────────────────────────────────────────────────
    {"slug": "toggl",         "name": "Toggl",             "urls": ["toggl.com"],                                            "categories": ["timetracking"],                       "color": "#E57CD8", "icon": "https://toggl.com/favicon.ico"},
    {"slug": "clockify",      "name": "Clockify",          "urls": ["clockify.me"],                                          "categories": ["timetracking"],                       "color": "#03A9F4", "icon": "https://clockify.me/favicon.ico"},

    # ── Project management ────────────────────────────────────────────────────
    {"slug": "jira",          "name": "Jira",              "urls": ["atlassian.net", "/jira/"],                              "categories": ["project"],                            "color": "#0052CC", "icon": "https://wac-cdn.atlassian.com/assets/img/favicons/atlassian/favicon.png"},
    {"slug": "linear",        "name": "Linear",            "urls": ["linear.app"],                                           "categories": ["project"],                            "color": "#5E6AD2", "icon": "https://linear.app/favicon.ico"},
    {"slug": "asana",         "name": "Asana",             "urls": ["asana.com"],                                            "categories": ["project"],                            "color": "#F06A6A", "icon": "https://app.asana.com/favicon.ico"},
    {"slug": "monday",        "name": "Monday.com",        "urls": ["monday.com"],                                           "categories": ["project", "crm"],                     "color": "#FF3D57", "icon": "https://monday.com/static/img/favicons/favicon-32x32.png"},
    {"slug": "trello",        "name": "Trello",            "urls": ["trello.com"],                                           "categories": ["project"],                            "color": "#0079BF", "icon": "https://trello.com/favicon.ico"},
    {"slug": "basecamp",      "name": "Basecamp",          "urls": ["basecamp.com", "3.basecamp.com"],                       "categories": ["project"],                            "color": "#1D2D35", "icon": "https://basecamp.com/favicon.ico"},
    {"slug": "notion",        "name": "Notion",            "urls": ["notion.so", "notion.site"],                             "categories": ["project", "document"],                "color": "#000000", "icon": "https://www.notion.so/images/favicon.ico"},
    {"slug": "confluence",    "name": "Confluence",        "urls": ["confluence.atlassian.net", "/wiki/spaces/"],            "categories": ["project", "document"],                "color": "#0052CC", "icon": "https://wac-cdn.atlassian.com/assets/img/favicons/atlassian/favicon.png"},

    # ── Code & dev ────────────────────────────────────────────────────────────
    {"slug": "github",        "name": "GitHub",            "urls": ["github.com"],                                           "categories": ["development"],                        "color": "#24292F", "icon": "https://github.githubassets.com/favicons/favicon.svg"},
    {"slug": "gitlab",        "name": "GitLab",            "urls": ["gitlab.com"],                                           "categories": ["development"],                        "color": "#FC6D26", "icon": "https://gitlab.com/assets/favicon-72a2cad5025aa931d6ea56c3201d1f18e68a8cd39788c7c80d5b2b82aa5143ef.png"},
    {"slug": "bitbucket",     "name": "Bitbucket",         "urls": ["bitbucket.org"],                                        "categories": ["development"],                        "color": "#0052CC", "icon": "https://bitbucket.org/favicon.ico"},
    {"slug": "vercel",        "name": "Vercel",            "urls": ["vercel.com"],                                           "categories": ["development"],                        "color": "#000000", "icon": "https://assets.vercel.com/image/upload/front/favicon/vercel/favicon.ico"},
    {"slug": "netlify",       "name": "Netlify",           "urls": ["netlify.com"],                                          "categories": ["development"],                        "color": "#00C7B7", "icon": "https://www.netlify.com/favicon/icon.png"},
    {"slug": "stackoverflow", "name": "Stack Overflow",    "urls": ["stackoverflow.com"],                                    "categories": ["development"],                        "color": "#F48024", "icon": "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico"},

    # ── Documenten ────────────────────────────────────────────────────────────
    {"slug": "googleDocs",    "name": "Google Docs",       "urls": ["docs.google.com/document"],                            "categories": ["document"],                           "color": "#4285F4", "icon": "https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico"},
    {"slug": "googleSheets",  "name": "Google Sheets",     "urls": ["docs.google.com/spreadsheets"],                        "categories": ["document"],                           "color": "#0F9D58", "icon": "https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico"},
    {"slug": "googleSlides",  "name": "Google Slides",     "urls": ["docs.google.com/presentation"],                        "categories": ["document"],                           "color": "#F4B400", "icon": "https://ssl.gstatic.com/docs/presentations/images/favicon5.ico"},
    {"slug": "googledrive",   "name": "Google Drive",      "urls": ["drive.google.com"],                                    "categories": ["document"],                           "color": "#4285F4", "icon": "https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png"},
    {"slug": "sharepointDoc", "name": "SharePoint",        "urls": ["sharepoint.com/Doc.aspx", "sharepoint.com/:w:"],       "categories": ["document"],                           "color": "#0078D4", "icon": "https://res.cdn.office.net/elf/prod/shared/resources/prod/favicons/sharepoint/favicon.ico"},
    {"slug": "onedrive",      "name": "OneDrive",          "urls": ["onedrive.live.com", "onedrive.com"],                   "categories": ["document"],                           "color": "#0078D4", "icon": "https://res.cdn.office.net/elf/prod/shared/resources/prod/favicons/onedrive/favicon.ico"},
    {"slug": "dropbox",       "name": "Dropbox",           "urls": ["dropbox.com"],                                         "categories": ["document"],                           "color": "#0061FF", "icon": "https://cfl.dropboxstatic.com/static/images/favicon.ico"},

    # ── Design ────────────────────────────────────────────────────────────────
    {"slug": "figma",         "name": "Figma",             "urls": ["figma.com"],                                           "categories": ["design"],                             "color": "#F24E1E", "icon": "https://static.figma.com/app/icon/1/favicon.ico"},
    {"slug": "miro",          "name": "Miro",              "urls": ["miro.com"],                                            "categories": ["design", "project"],                  "color": "#FFD02F", "icon": "https://miro.com/favicon.ico"},
    {"slug": "canva",         "name": "Canva",             "urls": ["canva.com"],                                           "categories": ["design"],                             "color": "#00C4CC", "icon": "https://static.canva.com/web/images/favicon.ico"},
    {"slug": "sketch",        "name": "Sketch",            "urls": ["sketch.com"],                                          "categories": ["design"],                             "color": "#F7B500", "icon": "https://www.sketch.com/favicon.ico"},

    # ── Communicatie ──────────────────────────────────────────────────────────
    {"slug": "slack",         "name": "Slack",             "urls": ["slack.com"],                                           "categories": ["communication"],                      "color": "#4A154B", "icon": "https://a.slack-edge.com/80588/marketing/img/meta/favicon-32.png"},
    {"slug": "teams",         "name": "Microsoft Teams",   "urls": ["teams.microsoft.com", "teams.live.com"],               "categories": ["communication"],                      "color": "#6264A7", "icon": "https://res.cdn.office.net/elf/prod/shared/resources/prod/favicons/teams/favicon.ico"},
    {"slug": "zoom",          "name": "Zoom",              "urls": ["zoom.us"],                                             "categories": ["communication"],                      "color": "#2D8CFF", "icon": "https://zoom.us/favicon.ico"},
    {"slug": "meet",          "name": "Google Meet",       "urls": ["meet.google.com"],                                     "categories": ["communication"],                      "color": "#00BCD4", "icon": "https://ssl.gstatic.com/meet/favicon.ico"},
    {"slug": "discord",       "name": "Discord",           "urls": ["discord.com"],                                         "categories": ["communication"],                      "color": "#5865F2", "icon": "https://discord.com/assets/favicon.ico"},
    {"slug": "whatsapp",      "name": "WhatsApp Web",      "urls": ["web.whatsapp.com"],                                    "categories": ["communication"],                      "color": "#25D366", "icon": "https://static.whatsapp.net/rsrc.php/v3/yP/r/rYZqPCBaG70.png"},

    # ── CRM / Sales ───────────────────────────────────────────────────────────
    {"slug": "salesforce",    "name": "Salesforce",        "urls": ["salesforce.com"],                                      "categories": ["crm"],                                "color": "#00A1E0", "icon": "https://www.salesforce.com/favicon.ico"},
    {"slug": "hubspot",       "name": "HubSpot",           "urls": ["hubspot.com", "app.hubspot.com"],                      "categories": ["crm"],                                "color": "#FF7A59", "icon": "https://www.hubspot.com/favicon.ico"},
    {"slug": "pipedrive",     "name": "Pipedrive",         "urls": ["pipedrive.com"],                                       "categories": ["crm"],                                "color": "#1A1F36", "icon": "https://www.pipedrive.com/favicon.ico"},

    # ── Boekhouding ───────────────────────────────────────────────────────────
    {"slug": "billtobox",     "name": "BillToBox",         "urls": ["billtobox.be"],                                        "categories": ["accounting"],                         "color": "#0D6EFD", "icon": "https://www.billtobox.be/favicon.ico"},
    {"slug": "yuki",          "name": "Yuki",              "urls": ["yuki.nl", "app.yuki.nl"],                              "categories": ["accounting"],                         "color": "#E8650A", "icon": "https://app.yuki.nl/favicon.ico"},
    {"slug": "winbooks",      "name": "Winbooks",          "urls": ["winbooks.be"],                                         "categories": ["accounting"],                         "color": "#004B8D", "icon": "https://www.winbooks.be/favicon.ico"},

    # ── AI tools ──────────────────────────────────────────────────────────────
    {"slug": "chatgpt",       "name": "ChatGPT",           "urls": ["chatgpt.com", "chat.openai.com"],                      "categories": ["ai"],                                 "color": "#00A67E", "icon": "https://chatgpt.com/favicon.ico"},
    {"slug": "claude",        "name": "Claude",            "urls": ["claude.ai"],                                           "categories": ["ai"],                                 "color": "#CC785C", "icon": "https://claude.ai/favicon.ico"},
    {"slug": "gemini",        "name": "Gemini",            "urls": ["gemini.google.com"],                                   "categories": ["ai"],                                 "color": "#4285F4", "icon": "https://www.gstatic.com/lamda/images/gemini_favicon_f069958c85030456e93de685481c559f160ea06.svg"},
    {"slug": "copilot",       "name": "Microsoft Copilot", "urls": ["copilot.microsoft.com"],                               "categories": ["ai"],                                 "color": "#0078D4", "icon": "https://copilot.microsoft.com/favicon.ico"},

    # ── Overig ────────────────────────────────────────────────────────────────
    {"slug": "pdf",           "name": "PDF",               "urls": [".pdf"],                                                "categories": ["document"],                           "color": "#FF0000"},
]


def _logo_dev_url(platform: dict) -> str:
    """Derive logo.dev fallback URL from the first URL pattern."""
    if not platform.get("urls"):
        return None
    domain = platform["urls"][0].lstrip("/").split("/")[0]
    return f"https://img.logo.dev/{domain}?token=pk_free"


def get_builtin_platforms() -> list:
    """Returns built-in platform list with normalised categories and logo_dev URLs."""
    platforms = []
    for p in BUILTIN_PLATFORMS:
        p = dict(p)
        if "categories" not in p:
            p["categories"] = [p.get("category", "custom")]
        if "logo_dev" not in p:
            p["logo_dev"] = _logo_dev_url(p)
        platforms.append(p)
    return platforms
