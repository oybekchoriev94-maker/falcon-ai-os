// ============================================================
// Telegram Mini App — initData imzo tekshiruvi.
//
// NEGA BU TEST BOR: bu yerda bir marta jiddiy xato qilingan —
// `signature` maydoni data_check_string'dan chiqarib tashlangan va
// natijada production'da HAR BIR so'rov 403 bilan rad etilgan.
// Sababi: Bot API 8.0 ikkita alohida tekshiruv beradi va ularning
// qoidalari ARALASHTIRIB YUBORILGAN:
//   hash      (HMAC, bot tokeni bilan) -> faqat `hash` chiqariladi
//   signature (Ed25519, ochiq kalit)   -> `hash` VA `signature` chiqariladi
// Quyidagi "eski qoida bilan imzolangan payload rad etilsin" testi
// aynan o'sha xatoni ushlab qoladi.
// ============================================================
import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';

const TOKEN = '123456789:AAHtest-token-abcdefghijklmnop';
let verifyTelegramInitData;

beforeAll(async () => {
  process.env.NODE_ENV = 'production';        // dev bypass'ni o'chiramiz
  process.env.TELEGRAM_TOKEN_PATIENT = TOKEN;
  ({ verifyTelegramInitData } = await import('../backend/shared.js'));
});

/** Telegram kabi kodlaydi: encodeURIComponent (bo'sh joy -> %20, "+" -> %2B) */
function encodeInitData(fields) {
  return Object.keys(fields)
    .map((k) => `${k}=${encodeURIComponent(fields[k])}`)
    .join('&');
}

/** TO'G'RI qoida bo'yicha imzolaydi: `hash`dan tashqari hamma maydon */
function signCorrectly(fields) {
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  return encodeInitData({ ...fields, hash });
}

/** Middleware'ni ishga tushirib, qabul qilindimi yo'qmi qaytaradi */
function runAuth(initData) {
  return new Promise((resolve) => {
    const req = { headers: { 'x-telegram-init-data': initData } };
    const res = {
      status(code) { this._code = code; return this; },
      json() { resolve({ accepted: false, code: this._code }); },
    };
    verifyTelegramInitData(req, res, () => resolve({ accepted: true, user: req.telegramUser }));
  });
}

const now = () => String(Math.floor(Date.now() / 1000));

describe('verifyTelegramInitData', () => {
  it('Bot API 8.0+ payloadini qabul qiladi (signature hashga kiradi)', async () => {
    const r = await runAuth(signCorrectly({
      auth_date: now(),
      query_id: 'AAEAExl1AAAAAAATGXWa9ehR',
      user: JSON.stringify({ id: 1964577536, first_name: 'Oybek Choriev' }),
      signature: 'UiSe6JH1tmTbUrIh-Q-R_TKu4d-X7fIgzPo',
    }));
    expect(r.accepted).toBe(true);
    expect(r.user.id).toBe(1964577536);
  });

  it('eski mijozni ham qabul qiladi (signature maydoni yo\'q)', async () => {
    const r = await runAuth(signCorrectly({
      auth_date: now(),
      user: JSON.stringify({ id: 42, first_name: 'Vali' }),
    }));
    expect(r.accepted).toBe(true);
  });

  // REGRESSIYA: URLSearchParams "+" ni bo'sh joyga aylantiradi va hashni
  // buzadi. Qo'lda decodeURIComponent bilan ajratish shuni oldini oladi.
  it('qiymatida "+" bo\'lgan payloadni qabul qiladi', async () => {
    const r = await runAuth(signCorrectly({
      auth_date: now(),
      user: JSON.stringify({ id: 7, first_name: 'A+B Ismi' }),
    }));
    expect(r.accepted).toBe(true);
    expect(r.user.first_name).toBe('A+B Ismi');
  });

  it('buzuq hashni rad etadi', async () => {
    const good = signCorrectly({ auth_date: now(), user: JSON.stringify({ id: 1 }) });
    const r = await runAuth(good.replace(/hash=[a-f0-9]+/, 'hash=deadbeef'));
    expect(r.accepted).toBe(false);
    expect(r.code).toBe(403);
  });

  // ASOSIY REGRESSIYA TESTI — production'ni buzgan aynan shu holat.
  it('signature CHIQARIB imzolangan payloadni rad etadi (noto\'g\'ri qoida)', async () => {
    const fields = {
      auth_date: now(),
      user: JSON.stringify({ id: 1964577536, first_name: 'Oybek' }),
      signature: 'UiSe6JH1tmTbUrIh-Q-R_TKu4d-X7fIgzPo',
    };
    // Ed25519 qoidasi (signature ham chiqariladi) — HMAC uchun NOTO'G'RI
    const wrongDcs = Object.keys(fields)
      .filter((k) => k !== 'signature')
      .sort().map((k) => `${k}=${fields[k]}`).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
    const wrongHash = crypto.createHmac('sha256', secret).update(wrongDcs).digest('hex');

    const r = await runAuth(encodeInitData({ ...fields, hash: wrongHash }));
    expect(r.accepted).toBe(false);
  });

  it('muddati o\'tgan auth_date ni rad etadi', async () => {
    const old = String(Math.floor(Date.now() / 1000) - 90000);   // 25 soat
    const r = await runAuth(signCorrectly({ auth_date: old, user: JSON.stringify({ id: 1 }) }));
    expect(r.accepted).toBe(false);
  });

  it('initData umuman bo\'lmasa 401 qaytaradi', async () => {
    const r = await new Promise((resolve) => {
      const req = { headers: {} };
      const res = {
        status(code) { this._code = code; return this; },
        json() { resolve({ accepted: false, code: this._code }); },
      };
      verifyTelegramInitData(req, res, () => resolve({ accepted: true }));
    });
    expect(r.accepted).toBe(false);
    expect(r.code).toBe(401);
  });
});
