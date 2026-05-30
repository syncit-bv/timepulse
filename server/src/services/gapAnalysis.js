// Gap analysis: find periods with browser activity not covered by Harvest entries.

const SESSION_BREAK_MS = 5 * 60 * 1000;  // 5 min gap between heartbeats = new session
const MIN_GAP_MINUTES = 15;               // only flag gaps ≥ 15 minutes

/**
 * Groups raw heartbeats into continuous activity sessions.
 * A session ends when there's a gap > SESSION_BREAK_MS between heartbeats.
 */
export function buildSessions(heartbeats) {
  if (heartbeats.length === 0) return [];

  const sorted = [...heartbeats].sort((a, b) => a.timestamp - b.timestamp);
  const sessions = [];
  let current = {
    start: sorted[0].timestamp,
    end: sorted[0].timestamp,
    domains: new Set([sorted[0].domain]),
    activityTypes: new Set([sorted[0].activity_type || sorted[0].activityType].filter(Boolean))
  };

  for (let i = 1; i < sorted.length; i++) {
    const hb = sorted[i];
    const gap = hb.timestamp - current.end;

    if (gap > SESSION_BREAK_MS) {
      sessions.push(finalizeSession(current));
      current = {
        start: hb.timestamp,
        end: hb.timestamp,
        domains: new Set([hb.domain]),
        activityTypes: new Set([hb.activity_type || hb.activityType].filter(Boolean))
      };
    } else {
      current.end = hb.timestamp;
      if (hb.domain) current.domains.add(hb.domain);
      const type = hb.activity_type || hb.activityType;
      if (type) current.activityTypes.add(type);
    }
  }
  sessions.push(finalizeSession(current));

  return sessions;
}

function finalizeSession(s) {
  return {
    start: s.start,
    end: s.end,
    durationMinutes: Math.round((s.end - s.start) / 60000),
    domains: [...s.domains].filter(Boolean),
    activityTypes: [...s.activityTypes].filter(Boolean)
  };
}

/**
 * Finds gaps: activity sessions not (or only partially) covered by Harvest entries.
 *
 * Harvest entries often only have hours (no start/end time), so we use a
 * time-budget approach: we subtract tracked hours from the day total and
 * flag remaining activity windows as gaps.
 */
export function findGaps(heartbeats, harvestEntries) {
  const sessions = buildSessions(heartbeats);
  if (sessions.length === 0) return [];

  // Build Harvest coverage: if entries have start/end times, use them.
  // Otherwise fall back to flagging all active sessions as potential gaps
  // and subtracting the total tracked hours as an estimate.
  const entriesWithTimes = harvestEntries.filter(e => e.startedTime && e.endedTime);

  let gaps;
  if (entriesWithTimes.length > 0) {
    gaps = findGapsWithTimestamps(sessions, entriesWithTimes);
  } else {
    gaps = findGapsWithBudget(sessions, harvestEntries);
  }

  return gaps.filter(g => (g.end - g.start) / 60000 >= MIN_GAP_MINUTES);
}

function findGapsWithTimestamps(sessions, entries) {
  // Build covered intervals from Harvest start/end times
  const covered = entries.map(e => ({
    start: parseHarvestTime(e.spentDate, e.startedTime),
    end: parseHarvestTime(e.spentDate, e.endedTime)
  })).filter(i => i.start && i.end);

  const gaps = [];
  for (const session of sessions) {
    const uncovered = subtractIntervals(session.start, session.end, covered);
    for (const [start, end] of uncovered) {
      gaps.push({ start, end, domains: session.domains });
    }
  }
  return gaps;
}

function findGapsWithBudget(sessions, harvestEntries) {
  // No timestamps on entries — mark all active sessions as gaps,
  // but trim the most recent ones to account for tracked hours.
  const trackedMs = harvestEntries.reduce((s, e) => s + e.hours * 3600000, 0);
  const totalActiveMs = sessions.reduce((s, sess) => s + (sess.end - sess.start), 0);
  const untrackedMs = Math.max(0, totalActiveMs - trackedMs);

  if (untrackedMs < MIN_GAP_MINUTES * 60000) return [];

  // Return all sessions as gaps (user has to decide which ones to log)
  return sessions.map(sess => ({
    start: sess.start,
    end: sess.end,
    domains: sess.domains
  }));
}

/**
 * Subtracts covered intervals [start,end][] from the range [from, to].
 * Returns uncovered sub-ranges as [start, end][] pairs.
 */
function subtractIntervals(from, to, covered) {
  const relevant = covered
    .filter(i => i.end > from && i.start < to)
    .sort((a, b) => a.start - b.start);

  const result = [];
  let cursor = from;

  for (const interval of relevant) {
    if (interval.start > cursor) {
      result.push([cursor, Math.min(interval.start, to)]);
    }
    cursor = Math.max(cursor, interval.end);
    if (cursor >= to) break;
  }

  if (cursor < to) result.push([cursor, to]);
  return result;
}

function parseHarvestTime(date, timeStr) {
  if (!date || !timeStr) return null;
  try {
    return new Date(`${date}T${timeStr}`).getTime();
  } catch {
    return null;
  }
}
