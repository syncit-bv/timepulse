import fetch from 'node-fetch';

const BASE_URL = 'https://api.harvestapp.com/v2';

function headers() {
  return {
    'Authorization': `Bearer ${process.env.HARVEST_ACCESS_TOKEN}`,
    'Harvest-Account-Id': process.env.HARVEST_ACCOUNT_ID,
    'User-Agent': 'TimePulse/1.0',
    'Content-Type': 'application/json'
  };
}

async function request(method, path, body) {
  const resp = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Harvest API ${resp.status}: ${text}`);
  }

  return resp.status === 204 ? null : resp.json();
}

export async function getTimeEntries(date) {
  const data = await request('GET', `/time_entries?from=${date}&to=${date}&per_page=100`);
  return data.time_entries.map(e => ({
    id: e.id,
    hours: e.hours,
    notes: e.notes || '',
    project: e.project?.name || '',
    projectId: e.project?.id,
    task: e.task?.name || '',
    taskId: e.task?.id,
    spentDate: e.spent_date,
    // Harvest stores hours but not start/end times unless timer is used
    // We approximate from created_at when no timer data present
    startedTime: e.started_time || null,
    endedTime: e.ended_time || null,
    createdAt: e.created_at
  }));
}

export async function createTimeEntry({ spentDate, hours, projectId, taskId, notes }) {
  return request('POST', '/time_entries', {
    spent_date: spentDate,
    hours: Math.round(hours * 100) / 100,
    project_id: projectId,
    task_id: taskId,
    notes: notes || ''
  });
}

export async function getProjects() {
  const data = await request('GET', '/projects?is_active=true&per_page=100');
  return data.projects.map(p => ({
    id: p.id,
    name: p.name,
    clientName: p.client?.name || ''
  }));
}

export async function getTaskAssignments(projectId) {
  const data = await request('GET', `/projects/${projectId}/task_assignments?is_active=true&per_page=100`);
  return data.task_assignments.map(ta => ({
    id: ta.task?.id,
    name: ta.task?.name || ''
  }));
}

export function isConfigured() {
  return !!(process.env.HARVEST_ACCESS_TOKEN && process.env.HARVEST_ACCOUNT_ID);
}
