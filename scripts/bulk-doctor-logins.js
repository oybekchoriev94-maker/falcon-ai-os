/**
 * Klinikaning BARCHA shifokorlariga bir yo'la login/parol beradi.
 *
 * NEGA KERAK: migratsiya bilan qo'shilgan shifokorlarda username va
 * password_hash bo'sh — ular bronlarda ko'rinadi, lekin /doctor ish
 * stoliga kira olmaydi. Ularni bittalab qo'lda sozlash uzoq.
 *
 * NIMA QILADI:
 *  - Faqat LOGINI YO'Q shifokorlarga tegadi. Mavjud loginlar va
 *    parollar O'ZGARMAYDI (--force bilan majburlash mumkin).
 *  - Login familiyadan yasaladi (lotin transliteratsiya bilan),
 *    band bo'lsa raqam qo'shiladi.
 *  - Parol tasodifiy: o'qish oson, taxmin qilish qiyin.
 *  - Natija jadval bo'lib chiqadi — chop etib shifokorlarga bering.
 *
 * BIR ODAM BIR NECHTA YO'NALISHDA bo'lsa (bazada har ixtisosga alohida
 * yozuv), har yozuvga ALOHIDA login beriladi va bu jadvalda ko'rinadi.
 * Sabab: navbat `appointments.doctor_id = login qilgan yozuv id` bo'yicha
 * chiqadi, ya'ni bitta login bilan faqat bitta yo'nalish navbati ko'rinadi.
 *
 * ISHLATISH (VPS'da, /opt/falcon-ai-os ichidan):
 *
 *   # Avval NIMA BO'LISHINI ko'rish (hech narsa o'zgarmaydi)
 *   docker compose run --rm app node scripts/bulk-doctor-logins.js --clinic "Oqtosh Klinikasi" --dry-run
 *
 *   # Haqiqiy yaratish
 *   docker compose run --rm app node scripts/bulk-doctor-logins.js --clinic "Oqtosh Klinikasi"
 *
 * XAVFSIZLIK: parollar faqat EKRANGA chiqadi, hech qayerda saqlanmaydi.
 * Bazaga bcrypt hash yoziladi. Ro'yxatni saqlab qo'ying yoki darhol
 * tarqating — qaytadan ko'rsatib bo'lmaydi.
 */
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgresql://falcon:falcon-secret@db:5432/falcon_ai_os',
});

function args() {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    const k = a[i].slice(2);
    out[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
  }
  return out;
}

/** O'zbek lotin harflarini login uchun yaroqli ko'rinishga keltiradi */
function toLogin(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[''`ʻʼ‘’]/g, '')            // o'zbek apostroflari
    .replace(/[àáâã]/g, 'a').replace(/[èéê]/g, 'e')
    .replace(/[ìí]/g, 'i').replace(/[òóô]/g, 'o').replace(/[ùú]/g, 'u')
    .replace(/ç/g, 'ch').replace(/ş/g, 'sh').replace(/ğ/g, 'g')
    .replace(/[^a-z0-9]/g, '');            // qolgan hamma narsa olib tashlanadi
}

/** O'qish oson parol: chalkash belgilar (l, 1, o, 0) ishlatilmaydi */
function randomPassword() {
  const abc = 'abcdefghijkmnpqrstuvwxyz';
  const NUM = '23456789';
  const pick = (s) => s[crypto.randomInt(s.length)];
  return [
    pick(abc.toUpperCase()),
    ...Array.from({ length: 5 }, () => pick(abc)),
    ...Array.from({ length: 3 }, () => pick(NUM)),
  ].join('');
}

async function main() {
  const a = args();
  const clinic = typeof a.clinic === 'string' ? a.clinic : null;
  const dryRun = !!a['dry-run'];
  const force = !!a.force;

  // Klinikani aniqlaymiz. Ko'rsatilmasa — bazada bitta bo'lsa o'sha,
  // bir nechta bo'lsa to'xtaymiz (noto'g'ri klinikaga parol qo'ymaslik uchun).
  const { rows: tenants } = await pool.query(
    clinic ? 'SELECT id, name FROM tenants WHERE name = $1' : 'SELECT id, name FROM tenants',
    clinic ? [clinic] : []
  );
  if (!tenants.length) throw new Error(clinic ? `"${clinic}" topilmadi` : 'Klinika topilmadi');
  if (tenants.length > 1) {
    console.log('\nBazada bir nechta klinika bor. --clinic bilan tanlang:');
    for (const t of tenants) console.log(`  --clinic "${t.name}"`);
    throw new Error('Klinika ko\'rsatilmagan');
  }
  const tenant = tenants[0];

  const { rows: docs } = await pool.query(
    `SELECT id, first_name, last_name, specialization, username,
            (password_hash IS NOT NULL) AS has_password
       FROM doctors
      WHERE tenant_id = $1 AND (status IS NULL OR status = 'Faol')
      ORDER BY last_name, first_name, specialization`,
    [tenant.id]
  );
  if (!docs.length) throw new Error('Faol shifokor topilmadi');

  const targets = force ? docs : docs.filter((d) => !(d.username && d.has_password));
  const skipped = docs.length - targets.length;

  console.log(`\nKlinika: ${tenant.name}`);
  console.log(`Faol shifokorlar: ${docs.length} ta`);
  if (skipped) console.log(`Logini bor (tegilmaydi): ${skipped} ta`);
  console.log(`${dryRun ? 'YARATILADI (sinov rejimi)' : 'Yaratilmoqda'}: ${targets.length} ta\n`);
  if (!targets.length) { console.log('Hammasida login bor. Ish yo\'q.\n'); return; }

  // Band loginlar — yangi yasalayotganlar bilan to'qnashmasin
  const taken = new Set(
    (await pool.query('SELECT lower(username) AS u FROM doctors WHERE username IS NOT NULL')).rows
      .map((r) => r.u)
  );

  const created = [];
  for (const d of targets) {
    // Mavjud login bo'lsa saqlaymiz (--force bilan faqat parol yangilanadi)
    let login = d.username || null;
    if (!login) {
      const base = toLogin(d.last_name) || toLogin(d.first_name) || 'shifokor';
      login = base;
      let n = 1;
      while (taken.has(login)) login = `${base}${++n}`;
      taken.add(login);
    }
    const pwd = randomPassword();
    if (!dryRun) {
      await pool.query(
        'UPDATE doctors SET username = $1, password_hash = $2 WHERE id = $3 AND tenant_id = $4',
        [login, await bcrypt.hash(pwd, 10), d.id, tenant.id]
      );
    }
    created.push({
      name: `${d.last_name || ''} ${d.first_name}`.trim(),
      spec: d.specialization || '—',
      login, pwd,
    });
  }

  const w1 = Math.max(20, ...created.map((c) => c.name.length));
  const w2 = Math.max(14, ...created.map((c) => c.spec.length));
  const w3 = Math.max(10, ...created.map((c) => c.login.length));
  console.log(
    'SHIFOKOR'.padEnd(w1) + '  ' + 'YONALISH'.padEnd(w2) + '  ' +
    'LOGIN'.padEnd(w3) + '  PAROL'
  );
  console.log('-'.repeat(w1 + w2 + w3 + 16));
  for (const c of created) {
    console.log(
      c.name.padEnd(w1) + '  ' + c.spec.padEnd(w2) + '  ' +
      c.login.padEnd(w3) + '  ' + c.pwd
    );
  }
  console.log('-'.repeat(w1 + w2 + w3 + 16));

  if (dryRun) {
    console.log('\nSINOV REJIMI — bazaga hech narsa yozilmadi.');
    console.log('Haqiqiy yaratish uchun --dry-run ni olib tashlang.\n');
  } else {
    console.log('\nParollar HECH QAYERDA saqlanmadi — bu ro\'yxatni saqlab qo\'ying');
    console.log('yoki darhol tarqating. Qaytadan ko\'rsatib bo\'lmaydi.');
    console.log('Yo\'qolsa: scripts/doctor-login.js bilan yangisini bering.\n');
  }
}

try {
  await main();
} catch (e) {
  console.error(`\nXATO: ${e.message}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
