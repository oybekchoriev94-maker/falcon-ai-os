// ============================================================
// Login cheklovi LOGIN NOMI bo'yicha ishlashi kerak, IP bo'yicha emas.
//
// NEGA TEST: production'da butun klinika tizimga kira olmay qoldi.
// Sabab — cheklov IP bo'yicha edi, klinikaning barcha xodimlari esa
// bitta internet ulanishi orqali ishlaydi (tashqi IP bir xil). Bitta
// xodim parolni bir necha marta xato tersa, registratura, shifokorlar
// va kassa BIRDANIGA bloklanardi.
//
// Bu testlar shu holat qaytmasligini kafolatlaydi.
// ============================================================
import { describe, it, expect } from 'vitest';
import { ipKeyGenerator } from 'express-rate-limit';

/**
 * server.js dagi authLimiter.keyGenerator bilan AYNAN bir xil mantiq.
 * Nusxa: limiter Express ilovasiga bog'langan va uni alohida import
 * qilib bo'lmaydi. Mantiq o'zgarsa bu yerda ham o'zgarishi kerak.
 */
const authKey = (req) => {
  const uname = String(req.body?.username || '').toLowerCase().trim();
  return uname ? `user:${uname}` : `ip:${ipKeyGenerator(req.ip)}`;
};

describe('authLimiter kaliti', () => {
  it('bir xil IP dagi TURLI xodimlar alohida hisoblanadi', () => {
    // Klinikadagi holat: hamma bitta tashqi IP orqali chiqadi
    const ip = '84.54.90.10';
    const doctor = authKey({ ip, body: { username: 'bobokulova' } });
    const reception = authKey({ ip, body: { username: 'registratura' } });
    expect(doctor).not.toBe(reception);
  });

  it('bir xodim turli qurilmadan kirsa BIR XIL hisoblanadi', () => {
    // Hujumchi IP almashtirib cheklovni aylanib o'tolmasin
    const a = authKey({ ip: '84.54.90.10', body: { username: 'bobokulova' } });
    const b = authKey({ ip: '195.158.1.1', body: { username: 'bobokulova' } });
    expect(a).toBe(b);
  });

  it('login nomi registri va bo\'shliqlari ahamiyatsiz', () => {
    const a = authKey({ ip: '1.1.1.1', body: { username: 'Bobokulova' } });
    const b = authKey({ ip: '1.1.1.1', body: { username: '  bobokulova  ' } });
    expect(a).toBe(b);
  });

  it('login nomi yo\'q so\'rov (refresh/logout) IP bo\'yicha hisoblanadi', () => {
    const k = authKey({ ip: '84.54.90.10', body: {} });
    expect(k.startsWith('ip:')).toBe(true);
  });

  it('body umuman bo\'lmasa ham yiqilmaydi', () => {
    expect(() => authKey({ ip: '84.54.90.10' })).not.toThrow();
  });

  it('IPv6 manzillar guruhlanadi (bitta foydalanuvchi = bitta kalit)', () => {
    // Provayder bitta mijozga /64 blok beradi; har so'rovda oxirgi
    // qism o'zgarsa, cheklov umuman ishlamay qolardi.
    const a = authKey({ ip: '2001:db8:1234:5678:1::1', body: {} });
    const b = authKey({ ip: '2001:db8:1234:5678:2::9', body: {} });
    expect(a).toBe(b);
  });
});
