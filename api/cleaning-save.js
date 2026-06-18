// Vercel Serverless Function: POST /api/cleaning-save
// 청소 일정 전체를 Upstash Redis에 저장 (덮어쓰기)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
    const body = req.body || {};
    const cleaningSchedule = body.cleaningSchedule;
    if (!Array.isArray(cleaningSchedule)) {
      return res.status(400).json({ error: 'cleaningSchedule must be an array' });
    }

    const payload = JSON.stringify(cleaningSchedule);
    // 크기 제한: 1MB
    if (payload.length > 1024 * 1024) {
      return res.status(413).json({ error: 'Payload too large' });
    }

    const r = await fetch(`${url}/set/cleaningSchedule`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: payload
    });
    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`Redis error: ${errText}`);
    }

    return res.status(200).json({
      success: true,
      count: cleaningSchedule.length,
      savedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Cleaning save error:', err);
    return res.status(500).json({ error: 'Failed to save cleaning schedule', message: err.message });
  }
}
