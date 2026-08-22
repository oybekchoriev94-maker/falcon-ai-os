/**
 * Mavjud shifokorga tizimga kirish huquqini beradi.
 *
 * NEGA KERAK: shifokorlar `users` emas, `doctors` jadvali orqali kiradi
 * (backend/routes/auth.js:59) va buning uchun `username` + `password_hash`
 * shart. Migratsiya bilan qo'shilgan shifokorlarda bu maydonlar bo'sh —
 * ular bronda ko'rinadi, lekin ish stoliga kira olmaydi.
 *
 * Interfeysda MAVJUD shifokorga login berish imkoni yo'q:
 * /api/auth/register-doctor faqat YANGI yozuv yaratadi, ya'ni undan
 * foydalanish dublikat shifokor paydo qilardi.
 *
 * ISHLATISH (VPS'da, /opt/falcon-ai-os ichidan):
 *
 *   # Kimda login bor, kimda yo'q — ko'rish
 *   docker compose run --rm app node scripts/doctor-login.js --list
 *
 *   # Login berish (parol ko'rsatilmasa tasodifiy yaratiladi va chiqariladi)
 *   docker compose run --rm app node scripts/doctor-login.js \
 *       --name "Qurbonov Xoltoji" --username qurbonov
 *
 *   # Parolni o'zingiz belgilash
 *   docker compose run --rm app node scripts/doctor-login.js \
 *       --id <uuid> --username qurbonov --password "Parol123"
 *
 * XAVFSIZLIK: parol faqat ekranga chiqadi, hech qayerda saqlanmaydi.
 * Bazaga bcrypt hash yoziladi. Parolni shifokorga berib, birinchi
 * kirishda o'zgartirishni so'rang.
 */
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgresql://falcon:falcon-secret@db:5432/falcon_ai_os',
});

/** --key value ko'rinishidagi argumentlarni o'qiydi */
function args() {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    const k = a[i].slice(2);
    const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
    out[k] = v;
  }
  return out;
}

/** O'qish oson, lekin taxmin qilish qiyin parol (chalkash belgilarsiz) */
function randomPassword() {
  const abc = 'abcdefghijkmnpqrstuvwxyz';   // l va o yo'q
  const NUM = '23456789';                   // 0 va 1 yo'q
  const pick = (s) => s[crypto.randomInt(s.length)];
  return [
    pick(abc.toUpperCase()),
    ...Array.from({ length: 5 }, () => pick(abc)),
    ...Array.from({ length: 3 }, () => pick(NUM)),
  ].join('');
}

async function list() {
  const { rows } = await pool.query(
    `SELECT d.id, d.first_name, d.last_name, d.specialization, d.username,
            (d.password_hash IS NOT NULL) AS has_password, t.name AS clinic
       FROM doctors d
       LEFT JOIN tenants t ON t.id = d.tenant_id
      WHERE d.status IS NULL OR d.status = 'Faol'
      ORDER BY t.name, d.last_name, d.first_name`
  );
  if (!rows.length) return console.log('Faol shifokor topilmadi.');

  console.log('\nKIRISH  SHIFOKOR                      YO\'NALISH        USERNAME');
  console.log('─'.repeat(78));
  for (const r of rows) {
    const ok = r.username && r.has_password;
    const name = `${r.last_name || ''} ${r.first_name}`.trim();
    console.log(
      `  ${ok ? '✓' : '✗'}    ${name.padEnd(28).slice(0, 28)} ` +
      `${String(r.specialization || '—').padEnd(16).slice(0, 16)} ` +
      `${r.username || '—'}`
    );
  }
  const missing = rows.filter((r) => !(r.username && r.has_password)).length;
  console.log('─'.repeat(78));
  console.log(`Jami ${rows.length} ta, kira olmaydigan: ${missing} ta\n`);
  if (missing) {
    console.log('Login berish uchun:');
    console.log('  node scripts/doctor-login.js --name "Familiya Ism" --username <login>\n');
  }
}

async function setLogin({ id, name, username, password }) {
  if (!username) throw new Error('--username majburiy');
  if (!id && !name) throw new Error('--id yoki --name majburiy');

  // Shifokorni topamiz
  let doc;
  if (id) {
    doc = (await pool.query('SELECT * FROM doctors WHERE id = $1', [id])).rows[0];
    if (!doc) throw new Error(`id=${id} bo'yicha shifokor topilmadi`);
  } else {
    const { rows } = await pool.query(
      `SELECT * FROM doctors
        WHERE lower(last_name || ' ' || first_name) = lower($1)
           OR lower(first_name || ' ' || last_name) = lower($1)`,
      [String(name).trim()]
    );
    if (!rows.length) throw new Error(`"${name}" topilmadi. --list bilan ro'yxatni ko'ring.`);
    // Bir odam bir nechta yo'nalishda ro'yxatdan o'tgan bo'lishi mumkin
    // (har ixtisosga alohida yozuv) — bunda qaysi biri kerakligini
    // aytish kerak, chunki login BITTA yozuvga bog'lanadi.
    if (rows.length > 1) {
      console.log(`\n"${name}" bo'yicha ${rows.length} ta yozuv bor (har yo'nalishga alohida):`);
      for (const r of rows) console.log(`  --id ${r.id}   ${r.specialization || '—'}`);
      throw new Error('Qaysi biri ekanini --id bilan ko\'rsating');
    }
    doc = rows[0];
  }

  // Username band emasligini tekshiramiz (jadvalda unique, lekin oldindan
  // aniq xato berish yaxshiroq)
  const taken = (await pool.query(
    'SELECT id FROM doctors WHERE username = $1 AND id <> $2', [username, doc.id]
  )).rows[0];
  if (taken) throw new Error(`"${username}" username boshqa shifokorda band`);

  const pwd = password && password !== true ? String(password) : randomPassword();
  if (pwd.length < 6) throw new Error('Parol kamida 6 belgi bo\'lishi kerak');

  await pool.query(
    'UPDATE doctors SET username = $1, password_hash = $2 WHERE id = $3',
    [username, await bcrypt.hash(pwd, 10), doc.id]
  );

  const full = `${doc.last_name || ''} ${doc.first_name}`.trim();
  console.log('\n✓ Login berildi\n');
  console.log(`  Shifokor:  ${full}`);
  console.log(`  Yo'nalish: ${doc.specialization || '—'}`);
  console.log(`  Username:  ${username}`);
  console.log(`  Parol:     ${pwd}`);
  console.log('\nParolni shifokorga bering. U hech qayerda saqlanmadi —');
  console.log('yo\'qolsa bu skriptni qayta ishlatib yangisini bering.\n');
}

const a = args();
try {
  if (a.list) await list();
  else await setLogin(a);
} catch (e) {
  console.error(`\n✗ ${e.message}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
