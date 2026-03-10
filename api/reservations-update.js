// Vercel Serverless Function: PUT /api/reservations-update
// 기존 먼데이 아이템의 컬럼값 수정 (상태 변경, 숙소 재배정 등)

const BOARD_ID = 18401306495;

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });

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

    const columnValues = {};

    // 상태 변경
    if (body.status) {
      // 프론트엔드 상태 → 먼데이 라벨 (공백 복원)
      const statusMap = {
        '신규': '신규',
        '예약승인안내': '예약 승인 안내',
        '3일전안내': '3일 전 안내',
        '1일전안내': '1일 전 안내',
        '이용중': '이용 중',
        '퇴실완료': '퇴실 완료',
        '환불/취소': '환불/취소'
      };
      columnValues['color_mkzk2mps'] = { label: statusMap[body.status] || body.status };
    }

    // 숙소 재배정
    if (body.room) columnValues['text_mkzkdbf8'] = body.room;

    // 타임라인 변경
    if (body.checkin && body.checkout) {
      columnValues['timerange_mkzk428w'] = { from: body.checkin, to: body.checkout };
    }

    // 전화번호 변경 (숫자만 추출, 유효한 경우만 설정)
    if (body.phone) {
      const digits = body.phone.replace(/\D/g, '');
      if (digits.length >= 8) {
        columnValues['phone_mkzkr93j'] = { phone: digits, countryShortName: 'KR' };
      }
    }

    // 기타 텍스트 필드
    if (body.gender) columnValues['text_mm0rzwj5'] = body.gender;
    if (body.org) columnValues['text_mkzkgbcs'] = body.org;
    if (body.program) columnValues['text_mm0wsyt1'] = body.program;
    if (body.extraBedding) columnValues['text_mm19fjp'] = body.extraBedding;

    // 보험가입
    if (body.insurance) columnValues['color_mm0wz1p8'] = { label: body.insurance };

    if (Object.keys(columnValues).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const columnValuesStr = JSON.stringify(JSON.stringify(columnValues));
    const safeItemId = sanitizeInt(body.itemId);

    const query = `mutation {
      change_multiple_column_values(
        board_id: ${BOARD_ID},
        item_id: ${safeItemId},
        column_values: ${columnValuesStr}
      ) {
        id
        name
      }
    }`;

    const data = await mutateMonday(query, token);

    if (data.errors) {
      console.error('Monday mutation errors:', data.errors);
      return res.status(500).json({ error: 'Failed to update item', details: data.errors });
    }

    return res.status(200).json({
      success: true,
      item: data.data?.change_multiple_column_values
    });

  } catch (err) {
    console.error('Update error:', err);
    return res.status(500).json({ error: 'Failed to update reservation', message: err.message });
  }
}
