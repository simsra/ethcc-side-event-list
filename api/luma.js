// Vercel Serverless Function — /api/luma.js
// Fetches and parses events from luma.com/ethcc
// No API key needed — parses Schema.org JSON-LD from the public calendar page

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
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

  // Luma now embeds events as Schema.org JSON-LD
  const ldRe = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = ldRe.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        // Top-level event
        if (item['@type'] === 'Event') {
          const ev = extractFromJsonLd(item);
          if (ev) events.push(ev);
        }
        // Events nested inside an Organization or ItemList
        const nested = item.event || item.subEvent || item.itemListElement || [];
        for (const sub of (Array.isArray(nested) ? nested : [nested])) {
          const target = sub.item || sub;
          if (target?.['@type'] === 'Event') {
            const ev = extractFromJsonLd(target);
            if (ev) events.push(ev);
          }
        }
      }
    } catch (e) {
      // skip malformed block
    }
  }

  return events;
}

function extractFromJsonLd(ev) {
  try {
    // Get slug/url from @id (e.g. "https://luma.com/beast_mode")
    const id = ev['@id'] || '';
    const slug = id.replace(/^https?:\/\/(luma\.com|lu\.ma)\//, '').split('?')[0];
    if (!slug || !ev.name) return null;

    // Parse start time
    let date = '', time = '';
    if (ev.startDate) {
      const d = new Date(ev.startDate);
      if (!isNaN(d)) {
        date = d.toISOString().split('T')[0];
        time = d.toTimeString().slice(0, 5);
      }
    }

    // Venue
    let venue = 'Cannes';
    if (ev.location?.name && ev.location.name !== 'Register to See Address') {
      venue = ev.location.name.split(',')[0].trim();
    } else if (ev.location?.address && ev.location.address !== 'Register to See Address') {
      venue = ev.location.address.split(',')[0].trim();
    }

    // Host from organizer or performer
    const hostSources = [].concat(ev.organizer || [], ev.performer || []);
    const host = hostSources
      .map(h => h.name || '')
      .filter(Boolean)
      .join(', ');

    // Description
    const desc = ev.description
      ? ev.description.slice(0, 120).replace(/\n/g, ' ')
      : '';

    return {
      slug,
      name: ev.name,
      host,
      date,
      time,
      venue,
      url: `https://luma.com/${slug}`,
      desc
    };
  } catch (e) {
    return null;
  }
}
