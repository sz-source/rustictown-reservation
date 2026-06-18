// Vercel Serverless Function: POST /api/cleaning-update
// 청소 일정 부분 업데이트 (sets / dels). Race condition 방지를 위해 전체 덮어쓰기 대신 변경된 항목만 처리.
// Body: { sets: [{room, date, person, done}], dels: [{room, date}] }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
    const sets = Array.isArray(body.sets) ? body.sets : [];
    const dels = Array.isArray(body.dels) ? body.dels : [];

    if (sets.length === 0 && dels.length === 0) {
      return res.status(400).json({ error: 'sets or dels required' });
    }

    // 크기 제한 (남용 방지)
    const MAX_OPS = 500;
    if (sets.length + dels.length > MAX_OPS) {
      return res.status(413).json({ error: `Too many operations (max ${MAX_OPS})` });
    }

    // 입력 검증
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const CONTROL_RE = /[\x00-\x1f\x7f]/;
    const MAX_ROOM_LEN = 50;
    const MAX_PERSON_LEN = 50;
    const isValid = (item) => (
      item && typeof item.room === 'string' && typeof item.date === 'string'
      && item.room.length > 0 && item.room.length <= MAX_ROOM_LEN
      && !CONTROL_RE.test(item.room) && !item.room.includes('::')
      && DATE_RE.test(item.date)
    );

    const cmds = [];
    for (const item of sets) {
      if (!isValid(item)) continue;
      const field = `${item.room}::${item.date}`;
      const personStr = (typeof item.person === 'string' ? item.person : '미정').slice(0, MAX_PERSON_LEN);
      const value = JSON.stringify({ person: personStr || '미정', done: !!item.done });
      cmds.push(['HSET', 'cleaning', field, value]);
    }
    for (const item of dels) {
      if (!isValid(item)) continue;
      const field = `${item.room}::${item.date}`;
      cmds.push(['HDEL', 'cleaning', field]);
    }

    if (cmds.length === 0) {
      return res.status(400).json({ error: 'No valid operations' });
    }

    const r = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds)
    });
    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`Redis pipeline error: ${errText}`);
    }

    return res.status(200).json({
      success: true,
      sets: sets.length,
      dels: dels.length,
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Cleaning update error:', err);
    return res.status(500).json({ error: 'Failed to update cleaning schedule', message: err.message });
  }
}
