// Vercel Serverless Function — /api/luma.js
// Fetches events from luma.com/ethcc via the public Luma calendar API
// cal-8bduHTaJ4tgVP7T is the main EthCC[9] aggregator calendar ID

const CALENDAR_ID = 'cal-8bduHTaJ4tgVP7T';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const response = await fetch(
      `https://api.lu.ma/calendar/get-items?calendar_api_id=${CALENDAR_ID}&period=future&pagination_limit=100`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0',
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Luma API returned ${response.status}`);
    }

    const data = await response.json();
    const entries = data.entries || [];
    const events = entries.map(extractEvent).filter(Boolean);

    res.status(200).json({ ok: true, count: events.length, events });

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

function extractEvent(entry) {
  try {
    const ev = entry.event;
    if (!ev?.name) return null;

    // url field is the RSVP link (can be external), slug derived from luma event api_id
    // Use entry.api_id (calev-xxx) is not a slug — use ev.url if it's a luma URL, else build from api_id
    const lumaUrl = ev.url && ev.url.includes('lu.ma') || ev.url && ev.url.includes('luma.com')
      ? ev.url
      : null;
    const slug = lumaUrl
      ? lumaUrl.replace(/^https?:\/\/(luma\.com|lu\.ma)\//, '').split('?')[0]
      : entry.api_id; // fallback to calev-xxx

    // Parse start time (UTC ISO string — convert to local Paris time for display)
    let date = '', time = '';
    if (ev.start_at) {
      // Luma returns UTC; display in Europe/Paris (UTC+1 in March, UTC+2 in April)
      const d = new Date(ev.start_at);
      if (!isNaN(d)) {
        const paris = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Europe/Paris',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false
        }).formatToParts(d);
        const p = Object.fromEntries(paris.map(x => [x.type, x.value]));
        date = `${p.year}-${p.month}-${p.day}`;
        time = `${p.hour}:${p.minute}`;
      }
    }

    // Venue from geo_address_info
    let venue = 'Cannes';
    const geo = ev.geo_address_info;
    if (geo?.address) venue = geo.address;
    else if (geo?.short_address) venue = geo.short_address.split(',')[0].trim();
    else if (geo?.city) venue = geo.city;

    // Host
    const host = ev.host || '';

    // RSVP URL — prefer luma URL, fall back to ev.url
    const url = lumaUrl || ev.url || `https://luma.com/${slug}`;

    return {
      slug,
      name: ev.name,
      host,
      date,
      time,
      venue,
      url,
      desc: ''
    };
  } catch (e) {
    return null;
  }
}
