from datetime import datetime
from typing import Optional

SESSION_BREAK_MS = 5 * 60 * 1000   # 5 minuten = nieuw blok
MIN_GAP_MINUTES  = 15               # gaten korter dan 15 min negeren

def build_sessions(heartbeats: list) -> list:
    if not heartbeats:
        return []

    sorted_hb = sorted(heartbeats, key=lambda h: h["timestamp"])

    sessions = []
    current = {
        "start":         sorted_hb[0]["timestamp"],
        "end":           sorted_hb[0]["timestamp"],
        "domains":       {sorted_hb[0]["domain"]} if sorted_hb[0].get("domain") else set(),
        "activityTypes": {sorted_hb[0]["activity_type"]} if sorted_hb[0].get("activity_type") else set(),
    }

    for hb in sorted_hb[1:]:
        gap = hb["timestamp"] - current["end"]
        if gap > SESSION_BREAK_MS:
            sessions.append(_finalize(current))
            current = {
                "start":         hb["timestamp"],
                "end":           hb["timestamp"],
                "domains":       {hb["domain"]} if hb.get("domain") else set(),
                "activityTypes": {hb["activity_type"]} if hb.get("activity_type") else set(),
            }
        else:
            current["end"] = hb["timestamp"]
            if hb.get("domain"):        current["domains"].add(hb["domain"])
            if hb.get("activity_type"): current["activityTypes"].add(hb["activity_type"])

    sessions.append(_finalize(current))
    return sessions

def _finalize(s: dict) -> dict:
    return {
        "start":           s["start"],
        "end":             s["end"],
        "durationMinutes": round((s["end"] - s["start"]) / 60000),
        "domains":         [d for d in s["domains"] if d],
        "activityTypes":   [t for t in s["activityTypes"] if t],
    }

def find_gaps(heartbeats: list, harvest_entries: list) -> list:
    sessions = build_sessions(heartbeats)
    if not sessions:
        return []

    entries_with_times = [
        e for e in harvest_entries
        if e.get("startedTime") and e.get("endedTime")
    ]

    if entries_with_times:
        gaps = _gaps_with_timestamps(sessions, entries_with_times)
    else:
        gaps = _gaps_with_budget(sessions, harvest_entries)

    return [g for g in gaps if (g["end"] - g["start"]) / 60000 >= MIN_GAP_MINUTES]

def _gaps_with_timestamps(sessions: list, entries: list) -> list:
    covered = []
    for e in entries:
        start = _parse_harvest_time(e["spentDate"], e["startedTime"])
        end   = _parse_harvest_time(e["spentDate"], e["endedTime"])
        if start and end:
            covered.append((start, end))

    gaps = []
    for sess in sessions:
        for (start, end) in _subtract_intervals(sess["start"], sess["end"], covered):
            gaps.append({"start": start, "end": end, "domains": sess["domains"]})
    return gaps

def _gaps_with_budget(sessions: list, entries: list) -> list:
    tracked_ms   = sum(e["hours"] * 3_600_000 for e in entries)
    total_active = sum(s["end"] - s["start"] for s in sessions)
    untracked    = max(0, total_active - tracked_ms)

    if untracked < MIN_GAP_MINUTES * 60_000:
        return []

    return [{"start": s["start"], "end": s["end"], "domains": s["domains"]} for s in sessions]

def _subtract_intervals(from_ts: int, to_ts: int, covered: list) -> list:
    relevant = sorted(
        [(s, e) for (s, e) in covered if e > from_ts and s < to_ts],
        key=lambda x: x[0],
    )
    result, cursor = [], from_ts
    for (s, e) in relevant:
        if s > cursor:
            result.append((cursor, min(s, to_ts)))
        cursor = max(cursor, e)
        if cursor >= to_ts:
            break
    if cursor < to_ts:
        result.append((cursor, to_ts))
    return result

def _parse_harvest_time(date_str: Optional[str], time_str: Optional[str]) -> Optional[int]:
    if not date_str or not time_str:
        return None
    try:
        dt = datetime.fromisoformat(f"{date_str}T{time_str}")
        return int(dt.timestamp() * 1000)
    except ValueError:
        return None
