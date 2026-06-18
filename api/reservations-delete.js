// Vercel Serverless Function: DELETE /api/reservations-delete
// 먼데이 보드에서 예약 아이템 삭제

import { applyCors, checkOrigin } from './_lib/security.js';

// delete_item은 board_id 없이 item_id만으로 동작하므로 board-agnostic

// GraphQL 인젝션 방어: 숫자 검증
function sanitizeInt(val) {
  const n = parseInt(val, 10);
  if (isNaN(n) || n <= 0) throw new Error('Invalid ID');
  return n;
}

async function mutateMonday(query, token) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token,
      'API-Version': '2024-10'
    },
    body: JSON.stringify({ query })
  });
  if (!res.ok) throw new Error(`Monday API error: ${res.status}`);
  return res.json();
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, 'DELETE');
  if (!cors.ok) return;
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  // Origin 체크: 외부 도메인에서 mutation 차단
  if (!checkOrigin(req)) {
    return res.status(403).json({ error: 'Forbidden: invalid origin' });
  }

  // API 키 인증
  const apiSecret = process.env.API_SECRET_KEY;
  if (apiSecret && req.headers['x-api-key'] !== apiSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = process.env.MONDAY_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'MONDAY_API_TOKEN not configured' });

  try {
    const body = req.body;
    if (!body || !body.itemId) {
      return res.status(400).json({ error: 'itemId is required' });
    }

    const safeItemId = sanitizeInt(body.itemId);

    const query = `mutation {
      delete_item(item_id: ${safeItemId}) {
        id
      }
    }`;

    const data = await mutateMonday(query, token);

    if (data.errors) {
      console.error('Monday mutation errors:', data.errors);
      return res.status(500).json({ error: 'Failed to delete item', details: data.errors });
    }

    return res.status(200).json({
      success: true,
      deletedId: data.data?.delete_item?.id
    });

  } catch (err) {
    console.error('Delete error:', err);
    return res.status(500).json({ error: 'Failed to delete reservation', message: err.message });
  }
}
