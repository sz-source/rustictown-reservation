// Vercel Serverless Function: GET /api/reservations
// 먼데이 보드에서 예약 데이터를 조회하여 프론트엔드 형식으로 변환

const BOARD_ID = 18401306495;

// 먼데이 GraphQL API 호출
async function queryMonday(query, token) {
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

// 타임라인 문자열 → ci/co (3월 기준 day-of-month) 변환
function parseTimeline(timelineStr, baseMonth = 3) {
  if (!timelineStr) return { ci: null, co: null };
  const parts = timelineStr.split(' - ');
  if (parts.length !== 2) return { ci: null, co: null };

  const [startStr, endStr] = parts;
  const start = new Date(startStr + 'T00:00:00+09:00'); // KST
  const end = new Date(endStr + 'T00:00:00+09:00');

  function toDay(d) {
    const month = d.getMonth() + 1; // 1-indexed
    const day = d.getDate();
    if (month === baseMonth) return day;
    if (month === baseMonth + 1) return day + 31;
    if (month === baseMonth - 1) return -(31 - day); // 이전 달
    return day;
  }

  return { ci: toDay(start), co: toDay(end) };
}

// 상태명 공백 제거 (먼데이: "예약 승인 안내" → 프론트: "예약승인안내")
function normalizeStatus(status) {
  if (!status) return '신규';
  return status.replace(/\s/g, '');
}

// 프로그램명 이모지 뒤 공백 삽입
function normalizePgm(pgm) {
  if (!pgm) return '';
  // 이모지 뒤에 공백이 없으면 삽입
  return pgm.replace(/^([\p{Emoji_Presentation}\p{Extended_Pictographic}]+)(\S)/u, '$1 $2').trim();
}

// 전화번호 정규화 (앞자리 0 보정)
function normalizePhone(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10 && !digits.startsWith('0')) return '0' + digits;
  return digits;
}

// 먼데이 아이템 → 프론트엔드 reservation 객체 변환
function transformItem(item) {
  const cols = {};
  // column_values를 id→text 맵으로 변환
  if (item.column_values) {
    item.column_values.forEach(cv => {
      cols[cv.id] = cv.text || '';
    });
  }

  const { ci, co } = parseTimeline(cols['timerange_mkzk428w']);

  // 타임라인이나 숙소가 없으면 스킵
  if (ci === null || co === null || !cols['text_mkzkdbf8']) return null;

  return {
    id: item.id,
    guest: item.name || '',
    room: cols['text_mkzkdbf8'] || '',
    ci,
    co,
    pgm: normalizePgm(cols['text_mm0wsyt1']),
    count: 1,
    status: normalizeStatus(cols['color_mkzk2mps']),
    phone: normalizePhone(cols['phone_mkzkr93j']),
    gender: cols['text_mm0rzwj5'] || '',
    org: cols['text_mkzkgbcs'] || '',
    category: cols['status'] || '',
    extraBedding: cols['text_mm19fjp'] || '',
    d3Sent: cols['boolean_mm0we7jb'] === 'true' || cols['boolean_mm0we7jb'] === 'v',
    d1InsuranceSent: cols['boolean_mm0wxnbd'] === 'true' || cols['boolean_mm0wxnbd'] === 'v',
    d1CheckinSent: cols['boolean_mm0wdpf8'] === 'true' || cols['boolean_mm0wdpf8'] === 'v',
    checkoutD1Sent: cols['boolean_mm0w2bx3'] === 'true' || cols['boolean_mm0w2bx3'] === 'v',
  };
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'MONDAY_API_TOKEN not configured' });
  }

  try {
    // 전체 아이템 조회 (최대 500건, 보드 98건이므로 1회 호출로 충분)
    const query = `query {
      boards(ids: [${BOARD_ID}]) {
        items_page(limit: 500) {
          cursor
          items {
            id
            name
            group { id title }
            column_values {
              id
              text
            }
          }
        }
      }
    }`;

    const data = await queryMonday(query, token);

    if (data.errors) {
      console.error('Monday API errors:', data.errors);
      return res.status(500).json({ error: 'Monday API query failed', details: data.errors });
    }

    const items = data.data?.boards?.[0]?.items_page?.items || [];

    // 변환 + null 필터링
    const reservations = items
      .map(transformItem)
      .filter(r => r !== null);

    // 캐싱: 60초 CDN 캐시, 5분 stale-while-revalidate
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

    return res.status(200).json({
      reservations,
      total: reservations.length,
      fetchedAt: new Date().toISOString()
    });

  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: 'Failed to fetch reservations', message: err.message });
  }
}
