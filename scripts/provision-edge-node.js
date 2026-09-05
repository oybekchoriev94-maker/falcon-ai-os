// ============================================================
// Bir martalik: Vision Edge node provisioning (admin API'ni HTTP
// orqali chaqirish o'rniga to'g'ridan-to'g'ri, JWT talab qilinmaydi —
// operatorda admin login bo'lmasa ham VPS'da ishga tushiriladi).
//
// backend/routes/edge.js -> POST /nodes ROUTE'I BILAN BIR XIL MANTIQ.
//
// Ishlatish: node scripts/provision-edge-node.js <node_id> <clinic_id> <display_name>
// ============================================================
import 'dotenv/config';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import {
  generateEdgeSigningSecret,
  encryptEdgeSigningSecret,
} from '../backend/services/edge-crypto.js';

const [, , nodeId, clinicId, ...nameParts] = process.argv;
const displayName = nameParts.join(' ');

if (!nodeId || !clinicId || !displayName) {
  console.error('Ishlatish: node scripts/provision-edge-node.js <node_id> <clinic_id> <display_name>');
  process.exit(1);
}
const SCOPE_RE = /^[a-z0-9][a-z0-9_-]{2,63}$/;
if (!SCOPE_RE.test(nodeId) || !SCOPE_RE.test(clinicId)) {
  console.error('node_id/clinic_id: kichik harf/raqam, 3-64 belgi, faqat "-" va "_"');
  process.exit(1);
}

const connectionString = process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL yoki PLATFORM_DATABASE_URL talab qilinadi');

const pool = new pg.Pool({ connectionString, max: 1 });

try {
  const client = await pool.connect();
  try {
    const tenants = await client.query('SELECT id, name FROM tenants ORDER BY created_at LIMIT 5');
    if (tenants.rowCount === 0) throw new Error('Hech qanday tenant topilmadi');
    if (tenants.rowCount > 1) {
      console.error('Bir nechta tenant topildi — qaysi biri kerakligini aniq belgilash lozim:');
      for (const t of tenants.rows) console.error(`  ${t.id}  (${t.name})`);
      process.exit(1);
    }
    const tenantId = tenants.rows[0].id;

    const signingKey = generateEdgeSigningSecret();
    const keyId = `edge-${randomUUID()}`;
    const ciphertext = encryptEdgeSigningSecret(signingKey);

    const result = await client.query(
      `INSERT INTO edge_nodes (
         id, tenant_id, clinic_id, node_id, display_name, key_id, signing_secret_ciphertext
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, tenant_id, clinic_id, node_id, display_name, key_id, status, created_at`,
      [randomUUID(), tenantId, clinicId, nodeId, displayName, keyId, ciphertext]
    );

    console.log('\n=== Edge node yaratildi ===');
    console.log(JSON.stringify(result.rows[0], null, 2));
    console.log('\n=== FALCON_KEY_ID / FALCON_SIGNING_KEY (bir marta ko\'rsatiladi) ===');
    console.log(`FALCON_TENANT_ID=${tenantId}`);
    console.log(`FALCON_CLINIC_ID=${clinicId}`);
    console.log(`FALCON_NODE_ID=${nodeId}`);
    console.log(`FALCON_KEY_ID=${keyId}`);
    console.log(`FALCON_SIGNING_KEY=${signingKey}`);
    console.log('\nUshbu qatorlarni klinika kompyuteridagi vision-edge-client/.env fayliga ko\'chiring.');
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
