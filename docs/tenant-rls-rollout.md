# Tenant Row-Level Security rollout

Falcon AI OS tenant himoyasi ikki qatlamdan iborat:

1. Ilova so'rovlaridagi aniq `tenant_id` predikatlari va tenant SQL guard.
2. PostgreSQL Row-Level Security (RLS) policy'lari.

`008_enable_tenant_row_level_security.js` migratsiyasi `public` sxemasidagi
`tenant_id` ustuniga ega barcha jadvallarni avtomatik topadi, RLS'ni yoqadi va
`falcon_tenant_isolation` policy'sini yaratadi. Policy `app.tenant_id` session
setting mavjud bo'lmasa fail-closed ishlaydi.

## Muhim deployment talabi

PostgreSQL jadval egasi odatda RLS'ni chetlab o'tadi. Shu sabab production
application connection migratsiyalarni bajargan owner roldan alohida,
`BYPASSRLS` huquqiga ega bo'lmagan DB role bilan ishlashi shart.

Production activation quyidagi tartibda ishlaydi:

- owner connection faqat migration va boshqariladigan platform operatsiyalari uchun;
- application connection oddiy non-owner role uchun;
- autentifikatsiyadan keyingi har bir tenant operatsiyasi
  `withTenantTransaction(tenantId, callback)` orqali transaction-local contextda;
- login, superadmin va background joblar uchun alohida, audit qilinadigan yo'l;
- application role'ga o'tishdan oldin barcha API integration testlari shu role bilan.

## Request context checkpoint

`request-tenant-context.js` autentifikatsiyadan keyingi tenantni
`AsyncLocalStorage` orqali shu requestning barcha async DB operatsiyalariga
bog'laydi. Tenant-aware pool oddiy query uchun qisqa transaction ochadi,
`app.tenant_id` ni `SET LOCAL` semantikasi bilan o'rnatadi va connectionni faqat
commit/rollbackdan keyin poolga qaytaradi. Mavjud `pool.query('BEGIN')` oqimlari
ham request doirasida bitta clientga pin qilinadi; tugallanmagan transaction
response yakunida avtomatik rollback qilinadi.

## Non-owner application role

Productionda uchta ulanish vazifasi ajratiladi:

- `DATABASE_URL`: `falcon_app` non-owner runtime role; RLS majburiy;
- `PLATFORM_DATABASE_URL`: login, webhook lookup, superadmin, cron va backup;
- `MIGRATION_DATABASE_URL`: faqat schema migrationlari uchun owner ulanishi.

`node scripts/provision-app-role.js` migratsiyalardan keyin `falcon_app` rolini
yaratadi yoki yangilaydi va faqat runtime jadvallariga kerakli grantlarni beradi.
`RLS_ENFORCE_APP_ROLE=true` bo'lsa, ilova superuser, `BYPASSRLS` yoki RLS jadval
egasi bilan ishga tushishga urinsa startup fail-closed to'xtaydi. Platform
ulanishi ham cross-tenant operatsiyalar uchun yetarli huquqqa ega bo'lmasa
startup rad etiladi.
