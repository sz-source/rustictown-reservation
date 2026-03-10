// Vercel Serverless Function: GET /api/reservations
// 먼데이 보드에서 예약 데이터를 조회하여 프론트엔드 형식으로 변환

const BOARD_ID = 18401306495;

// GraphQL 인젝션 방어: 커서 문자열 검증 (영숫자+기본 특수문자만 허용)
function sanitizeCursor(cursor) {
  if (typeof cursor !== 'string') return null;
  if (!/^[a-zA-Z0-9+/=_\-]+$/.test(cursor)) return null;
  return cursor;
}

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

// 타임라인 문자열 → ci/co day offset 변환 (March 1, 2026 기준)
// 프론트엔드의 toDayOffset()과 동일한 로직
function parseTimeline(timelineStr) {
  if (!timelineStr) return { ci: null, co: null };
  const parts = timelineStr.split(' - ');
  if (parts.length !== 2) return { ci: null, co: null };

  const [startStr, endStr] = parts;

  // 날짜 문자열에서 직접 숫자 추출 (서버 타임존 무관하게 안전)
  function parseDateStr(str) {
    const [y, m, d] = str.trim().split('-').map(Number);
    return { year: y, month: m, day: d };
  }

  // March 1, 2026 기준 day offset (프론트엔드와 동일)
  function toDayOffset(y, m, d) {
    const base = new Date(Date.UTC(2026, 2, 1)); // March 1, 2026
    const target = new Date(Date.UTC(y, m - 1, d));
    return Math.round((target - base) / 86400000) + 1;
  }

  const s = parseDateStr(startStr);
  const e = parseDateStr(endStr);

  return {
    ci: toDayOffset(s.year, s.month, s.day),
    co: toDayOffset(e.year, e.month, e.day)
  };
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // API 키 인증
  const apiSecret = process.env.API_SECRET_KEY;
  if (apiSecret && req.headers['x-api-key'] !== apiSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'MONDAY_API_TOKEN not configured' });
  }

  try {
    // 1차 조회 (최대 500건)
    const firstQuery = `query {
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

    const data = await queryMonday(firstQuery, token);

    if (data.errors) {
      console.error('Monday API errors:', data.errors);
      return res.status(500).json({ error: 'Monday API query failed', details: data.errors });
    }

    const itemsPage = data.data?.boards?.[0]?.items_page;
    const items = [...(itemsPage?.items || [])];
    let cursor = itemsPage?.cursor;

    // 커서가 있으면 다음 페이지 반복 조회 (500건 초과 시)
    while (cursor) {
      const safeCursor = sanitizeCursor(cursor);
      if (!safeCursor) break; // 비정상 커서는 중단
      const nextQuery = `query {
        next_items_page(limit: 500, cursor: "${safeCursor}") {
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
      }`;
      const nextData = await queryMonday(nextQuery, token);
      if (nextData.errors) break;
      const nextPage = nextData.data?.next_items_page;
      if (nextPage?.items) items.push(...nextPage.items);
      cursor = nextPage?.cursor || null;
    }

    // 변환 + null 필터링 + 환불/취소 제외
    const reservations = items
      .map(transformItem)
      .filter(r => r !== null)
      .filter(r => r.status !== '환불/취소');

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
