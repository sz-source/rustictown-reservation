// Vercel Serverless Function: GET/PUT /api/settings
// 팀 공용 설정(사용불가 숙소, 프로그램 색상·일정, 숙소 정보)을 Upstash Redis Hash에 저장
// Hash: settings-samgi -> { field: JSON }   (GET=전체, PUT {field, value}=한 필드)

import { applyCors, checkOrigin } from './_lib/security.js';

const KEY = 'settings-simcheong';
const FIELDS = ['disabledRooms', 'pgmColors', 'pgmColorsDeleted', 'roomTypes'];

export default async function handler(req, res) {
  const cors = applyCors(req, res, 'GET, PUT');
  if (!cors.ok) return;
  if (req.method !== 'GET' && req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden: invalid origin' });

  const apiSecret = process.env.API_SECRET_KEY;
  if (apiSecret && req.headers['x-api-key'] !== apiSecret) return res.status(401).json({ error: 'Unauthorized' });

  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return res.status(500).json({ error: 'Redis not configured' });
  const auth = { 'Authorization': `Bearer ${token}` };

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${url}/hgetall/${KEY}`, { headers: auth });
      if (!r.ok) throw new Error(`Redis error: ${r.status}`);
      const arr = (await r.json()).result || [];
      const settings = {};
      for (let i = 0; i + 1 < arr.length; i += 2) {
        try { let v = JSON.parse(arr[i + 1]); if (typeof v === 'string') v = JSON.parse(v); settings[arr[i]] = v; } catch (e) { /* skip invalid */ }
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ settings });
    }
    const { field, value } = req.body || {};
    if (!FIELDS.includes(field) || value === undefined) return res.status(400).json({ error: 'field/value required' });
    const r = await fetch(`${url}/hset/${KEY}/${field}`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(value), // Upstash REST: body 원문이 값으로 저장됨
    });
    if (!r.ok) throw new Error(`Redis error: ${r.status}`);
    return res.status(200).json({ success: true, field });
  } catch (err) {
    console.error('Settings error:', err);
    return res.status(500).json({ error: 'Settings failed', message: err.message });
  }
}
