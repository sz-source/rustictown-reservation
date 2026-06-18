// Vercel Serverless Function: GET /api/cleaning-list
// Upstash Redis에서 청소 일정 조회

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // API 키 인증
  const apiSecret = process.env.API_SECRET_KEY;
  if (apiSecret && req.headers['x-api-key'] !== apiSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    return res.status(500).json({ error: 'Redis not configured' });
  }

  try {
    const r = await fetch(`${url}/get/cleaningSchedule`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) throw new Error(`Redis error: ${r.status}`);
    const data = await r.json();
    const cleaningSchedule = data.result ? JSON.parse(data.result) : [];

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      cleaningSchedule,
      count: cleaningSchedule.length,
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Cleaning list error:', err);
    return res.status(500).json({ error: 'Failed to fetch cleaning schedule', message: err.message });
  }
}
