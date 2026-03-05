
Luma · JS
Copy

// Vercel Serverless Function — /api/luma.js
// Fetches and parses events from luma.com/ethcc
// No API key needed — scrapes the public calendar page

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    // Fetch the Luma calendar page
    const response = await fetch('https://luma.com/ethcc', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    });

    if (!response.ok) {
      throw new Error(`Luma returned ${response.status}`);
    }

    const html = await response.text();
    const events = parseEvents(html);

    res.status(200).json({ ok: true, count: events.length, events });

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

function parseEvents(html) {
  const events = [];

  // Extract __NEXT_DATA__ JSON which contains all event data
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);

  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      // Drill into Next.js page props to find event entries
      const entries = findEntries(data);
      entries.forEach(entry => {
        const ev = extractEvent(entry);
        if (ev) events.push(ev);
      });
      if (events.length > 0) return events;
    } catch (e) {
      // Fall through to regex parsing
    }
  }

  // Fallback: regex parse event names + slugs from HTML
  const nameRe = /href="\/([a-zA-Z0-9_-]+)"[^>]*>\s*<[^>]+>\s*([^<]{5,120})<\/[^>]+>/g;
  const seen = new Set();
  let m;
  while ((m = nameRe.exec(html)) !== null) {
    const slug = m[1];
    const name = m[2].trim();
    if (seen.has(slug)) continue;
    if (['ethcc','discover','signin','signup','pricing'].includes(slug)) continue;
    if (name.length < 5 || name.length > 120) continue;
    seen.add(slug);
    events.push({
      slug,
      name,
      host: '',
      date: '',
      time: '',
      venue: 'Cannes',
      url: `https://luma.com/${slug}`,
      desc: ''
    });
  }

  return events;
}

function findEntries(obj, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return [];
  
  // Look for arrays that contain event-like objects
  if (Array.isArray(obj)) {
    if (obj.length > 0 && obj[0]?.event?.name) return obj;
    return obj.flatMap(item => findEntries(item, depth + 1));
  }

  // Check common Luma data keys
  for (const key of ['entries', 'events', 'items', 'calendarEntries']) {
    if (obj[key] && Array.isArray(obj[key]) && obj[key].length > 0) {
      return obj[key];
    }
  }

  return Object.values(obj).flatMap(v => findEntries(v, depth + 1));
}

function extractEvent(entry) {
  try {
    const ev = entry.event || entry;
    if (!ev?.name) return null;

    const slug = ev.url || ev.slug || (ev.api_id ? ev.api_id : null);
    if (!slug) return null;

    // Parse start time
    let date = '', time = '';
    if (ev.start_at) {
      const d = new Date(ev.start_at);
      date = d.toISOString().split('T')[0];
      time = d.toTimeString().slice(0, 5);
    }

    // Get venue
    let venue = 'Cannes';
    if (ev.geo_address_info?.full_address) venue = ev.geo_address_info.full_address.split(',')[0];
    else if (ev.location) venue = ev.location;

    // Get host
    let host = '';
    if (entry.hosts?.length > 0) host = entry.hosts.map(h => h.name).join(', ');
    else if (ev.organizer?.name) host = ev.organizer.name;

    return {
      slug: slug.replace('https://luma.com/', ''),
      name: ev.name,
      host,
      date,
      time,
      venue,
      url: `https://luma.com/${slug.replace('https://luma.com/', '')}`,
      desc: ev.description ? ev.description.slice(0, 120).replace(/\n/g, ' ') : ''
    };
  } catch (e) {
    return null;
  }
}
