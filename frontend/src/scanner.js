export const API_URL = (import.meta.env?.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');

export function cleanTrailerId(value) {
  return value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32);
}

export function mergeScans(records, scans, source, capturedAt = new Date().toISOString()) {
  const next = [...records];
  let added = 0;

  for (const scan of scans) {
    const trailerId = cleanTrailerId(scan.trailer_id || '');
    if (!trailerId) continue;
    const found = next.find((record) => record.trailer_id.toUpperCase() === trailerId);
    if (found) {
      if ((scan.confidence ?? 0) > (found.confidence ?? 0)) found.confidence = scan.confidence;
      continue;
    }
    next.unshift({
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      trailer_id: trailerId,
      captured_at: capturedAt,
      source,
      confidence: scan.confidence ?? null,
      notes: '',
    });
    added += 1;
  }
  return { records: next, added };
}

export function timeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

export async function responseMessage(response) {
  try {
    const payload = await response.json();
    return payload.detail || payload.error || 'The request could not be completed.';
  } catch {
    return 'The scanner service could not complete the request.';
  }
}
