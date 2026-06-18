// Vercel Serverless Function: GET /api/cleaning-list
// Upstash Redis Hash에서 청소 일정 조회 (race condition 방지)
// Hash 구조: cleaning -> { "{room}::{date}": '{"person":"...","done":true|false}' }

import { applyCors, checkOrigin } from './_lib/security.js';

export default async function handler(req, res) {
  const cors = applyCors(req, res, 'GET');
  if (!cors.ok) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!checkOrigin(req)) {
    return res.status(403).json({ error: 'Forbidden: invalid origin' });
  }

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
    // Hash 조회
    const r = await fetch(`${url}/hgetall/cleaning`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) throw new Error(`Redis error: ${r.status}`);
    const data = await r.json();
    const arr = data.result || [];

    const items = parseHashResult(arr);

    // 마이그레이션: Hash 비어있고 legacy String 키에 데이터 있으면 이전
    if (items.length === 0) {
      const migrated = await migrateLegacy(url, token);
      if (migrated.length > 0) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
          cleaningSchedule: migrated,
          count: migrated.length,
          migrated: true,
          fetchedAt: new Date().toISOString()
        });
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      cleaningSchedule: items,
      count: items.length,
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Cleaning list error:', err);
    return res.status(500).json({ error: 'Failed to fetch cleaning schedule', message: err.message });
  }
}

// HGETALL 결과(배열 또는 객체) → 정렬된 청소 일정 배열로 변환
function parseHashResult(raw) {
  const items = [];
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i += 2) {
      pushFromField(items, raw[i], raw[i + 1]);
    }
  } else if (raw && typeof raw === 'object') {
    for (const [field, value] of Object.entries(raw)) {
      pushFromField(items, field, value);
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.room.localeCompare(b.room));
  return items;
}

function pushFromField(items, field, value) {
  try {
    const sep = field.indexOf('::');
    if (sep < 0) return;
    const room = field.substring(0, sep);
    const date = field.substring(sep + 2);
    const props = typeof value === 'string' ? JSON.parse(value) : value;
    items.push({ room, date, person: props.person || '미정', done: !!props.done });
  } catch (e) {
    console.warn('Skipped invalid field:', field);
  }
}

// 기존 String 키(`cleaningSchedule`) → Hash 키(`cleaning`)로 일회성 마이그레이션
async function migrateLegacy(url, token) {
  try {
    const r = await fetch(`${url}/get/cleaningSchedule`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) return [];
    const data = await r.json();
    if (!data.result) return [];
    const legacy = JSON.parse(data.result);
    if (!Array.isArray(legacy) || legacy.length === 0) return [];

    const cmds = legacy.map(c => [
      'HSET',
      'cleaning',
      `${c.room}::${c.date}`,
      JSON.stringify({ person: c.person || '미정', done: !!c.done })
    ]);
    await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds)
    });
    console.log(`Migrated ${legacy.length} items from String to Hash`);
    // 마이그레이션 완료 후 정렬된 결과 반환
    return legacy
      .map(c => ({ room: c.room, date: c.date, person: c.person || '미정', done: !!c.done }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.room.localeCompare(b.room));
  } catch (e) {
    console.warn('Legacy migration failed:', e.message);
    return [];
  }
}
