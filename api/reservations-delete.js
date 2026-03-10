// Vercel Serverless Function: DELETE /api/reservations-delete
// 먼데이 보드에서 예약 아이템 삭제

const BOARD_ID = 18401306495;

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.MONDAY_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'MONDAY_API_TOKEN not configured' });

  try {
    const body = req.body;
    if (!body || !body.itemId) {
      return res.status(400).json({ error: 'itemId is required' });
    }

    const query = `mutation {
      delete_item(item_id: ${body.itemId}) {
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
