// 공통 보안 유틸: Origin 체크 및 CORS 헤더 결정
// 환경변수 ALLOWED_ORIGINS에 쉼표 구분 도메인 추가 가능 (예: "https://foo.com,https://bar.com")

const DEFAULT_ALLOWED = [
  'https://rustictown-reservation.vercel.app',
  'http://localhost:3003',
  'http://localhost:3000',
];

export function getAllowedOrigins() {
  const env = process.env.ALLOWED_ORIGINS;
  if (env && env.trim().length > 0) {
    return env.split(',').map(s => s.trim()).filter(Boolean);
  }
  return DEFAULT_ALLOWED;
}

// Origin/Referer 헤더가 허용 도메인에서 온 것인지 검사
export function checkOrigin(req) {
  const allowed = getAllowedOrigins();
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  if (origin && allowed.includes(origin)) return true;
  // Origin이 없거나 매칭 안 될 때 Referer로 fallback
  if (referer && allowed.some(o => referer.startsWith(o + '/') || referer === o)) return true;
  return false;
}

// CORS Access-Control-Allow-Origin 값 결정
// 화이트리스트에 있는 origin이면 그대로 반환, 아니면 기본 도메인
export function corsAllowOrigin(req) {
  const allowed = getAllowedOrigins();
  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) return origin;
  return allowed[0];
}

// 표준 CORS 헤더 설정 + Origin 체크 (mutation API용)
// 반환값: { ok: boolean, error?: string }
export function applyCors(req, res, methods) {
  res.setHeader('Access-Control-Allow-Origin', corsAllowOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', `${methods}, OPTIONS`);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return { ok: false, preflight: true };
  }
  return { ok: true };
}
