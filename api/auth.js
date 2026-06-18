// Vercel Serverless Function: POST /api/auth
// 로그인 인증 — 자격증명을 환경변수에서 검증

import { applyCors, checkOrigin } from './_lib/security.js';

export default async function handler(req, res) {
  const cors = applyCors(req, res, 'POST');
  if (!cors.ok) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!checkOrigin(req)) {
    return res.status(403).json({ error: 'Forbidden: invalid origin' });
  }

  try {
    const { id, pw } = req.body || {};
    if (!id || !pw) {
      return res.status(400).json({ error: 'id and pw are required' });
    }

    // 환경변수에서 계정 정보 조회
    // ADMIN_ID, ADMIN_PW, CLEANER_ID, CLEANER_PW
    const accounts = [];

    if (process.env.ADMIN_ID && process.env.ADMIN_PW) {
      accounts.push({ id: process.env.ADMIN_ID, pw: process.env.ADMIN_PW, role: 'admin' });
    }
    if (process.env.CLEANER_ID && process.env.CLEANER_PW) {
      accounts.push({ id: process.env.CLEANER_ID, pw: process.env.CLEANER_PW, role: 'cleaning' });
    }

    // 환경변수 미설정 시 인증 건너뜀 (하위 호환)
    if (accounts.length === 0) {
      return res.status(200).json({ success: false, error: 'Auth not configured' });
    }

    const match = accounts.find(a => a.id === id && a.pw === pw);
    if (match) {
      return res.status(200).json({ success: true, role: match.role });
    } else {
      return res.status(200).json({ success: false, error: 'Invalid credentials' });
    }

  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ error: 'Auth failed', message: err.message });
  }
}
