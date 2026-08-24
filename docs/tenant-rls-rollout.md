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

To'liq production activation keyingi rollout checkpointida bajariladi:

- owner connection faqat migration va boshqariladigan platform operatsiyalari uchun;
- application connection oddiy non-owner role uchun;
- autentifikatsiyadan keyingi har bir tenant operatsiyasi
  `withTenantTransaction(tenantId, callback)` orqali transaction-local contextda;
- login, superadmin va background joblar uchun alohida, audit qilinadigan yo'l;
- application role'ga o'tishdan oldin barcha API integration testlari shu role bilan.

Hozirgi checkpoint policy va transaction helperni qo'shadi, ammo application
connectionni hali non-owner role'ga almashtirmaydi. Bu mavjud endpointlarni
birdan fail-closed holatga tushirib, production xizmatini uzib qo'ymaslik uchun
ataylab bosqichlangan.

## Request context checkpoint

`request-tenant-context.js` autentifikatsiyadan keyingi tenantni
`AsyncLocalStorage` orqali shu requestning barcha async DB operatsiyalariga
bog'laydi. Tenant-aware pool oddiy query uchun qisqa transaction ochadi,
`app.tenant_id` ni `SET LOCAL` semantikasi bilan o'rnatadi va connectionni faqat
commit/rollbackdan keyin poolga qaytaradi. Mavjud `pool.query('BEGIN')` oqimlari
ham request doirasida bitta clientga pin qilinadi; tugallanmagan transaction
response yakunida avtomatik rollback qilinadi.
