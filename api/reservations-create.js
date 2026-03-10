// Vercel Serverless Function: POST /api/reservations-create
// 프론트엔드 폼 데이터를 먼데이 보드에 새 아이템으로 생성

const BOARD_ID = 18401306495;
const DEFAULT_GROUP = 'group_title'; // "승인 완료" 그룹

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.MONDAY_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'MONDAY_API_TOKEN not configured' });

  try {
    const body = req.body;
    if (!body || !body.name) {
      return res.status(400).json({ error: 'name is required' });
    }

    // 프론트엔드 → 먼데이 컬럼값 매핑
    const columnValues = {};

    // 배정 숙소
    if (body.room) columnValues['text_mkzkdbf8'] = body.room;

    // 타임라인 (입실일/퇴실일)
    if (body.checkin && body.checkout) {
      columnValues['timerange_mkzk428w'] = { from: body.checkin, to: body.checkout };
    }

    // 상태 (기본: 신규)
    columnValues['color_mkzk2mps'] = { label: body.status || '신규' };

    // 분류 (프로그램 카테고리)
    if (body.category) {
      columnValues['status'] = { label: body.category };
    }

    // 전화번호
    if (body.phone) {
      columnValues['phone_mkzkr93j'] = { phone: body.phone, countryShortName: 'KR' };
    }

    // 성별
    if (body.gender) columnValues['text_mm0rzwj5'] = body.gender;

    // 소속
    if (body.org) columnValues['text_mkzkgbcs'] = body.org;

    // 프로그램명 (이모지 뒤 공백 제거하여 저장)
    if (body.program) {
      columnValues['text_mm0wsyt1'] = body.program;
      // 이모지만 추출하여 "사람" 컬럼에 저장
      const emojiMatch = body.program.match(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+/u);
      if (emojiMatch) columnValues['text_mm166wwj'] = emojiMatch[0];
    }

    // 추가침구
    if (body.extraBedding) columnValues['text_mm19fjp'] = body.extraBedding;

    // 보험가입
    if (body.insurance) columnValues['color_mm0wz1p8'] = { label: body.insurance };

    const columnValuesStr = JSON.stringify(JSON.stringify(columnValues));
    const groupId = body.groupId || DEFAULT_GROUP;

    const query = `mutation {
      create_item(
        board_id: ${BOARD_ID},
        group_id: "${groupId}",
        item_name: "${body.name.replace(/"/g, '\\"')}",
        column_values: ${columnValuesStr}
      ) {
        id
        name
      }
    }`;

    const data = await mutateMonday(query, token);

    if (data.errors) {
      console.error('Monday mutation errors:', data.errors);
      return res.status(500).json({ error: 'Failed to create item', details: data.errors });
    }

    return res.status(201).json({
      success: true,
      item: data.data?.create_item
    });

  } catch (err) {
    console.error('Create error:', err);
    return res.status(500).json({ error: 'Failed to create reservation', message: err.message });
  }
}
