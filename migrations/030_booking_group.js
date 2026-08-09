/**
 * Bitta tashrifda bir nechta shifokorga yozilish.
 *
 * Muammo: kioskda bemor ketma-ket 2-3 shifokorga yozilishi mumkin
 * (masalan avval ginekolog, keyin UZI). Har biri alohida appointment
 * yozuvi — chunki har birining o'z vaqti va o'z shifokori bor
 * (appointments_doctor_slot_unique shuni talab qiladi).
 *
 * Lekin ular BIR tashrif: bemor bitta, kassa ularni birga ko'rishi va
 * navbat varaqasi bitta bo'lishi kerak. booking_group_id shu yozuvlarni
 * bog'laydi.
 *
 * access_code har yozuvda o'ziniki bo'lib qoladi — (tenant_id,
 * access_code) unique indeksi bir xil kodni ikki marta yozishga ruxsat
 * bermaydi. Kassa hozirgidek har bir kodni alohida qabul qiladi;
 * guruh identifikatori kelajakda "hammasini birga to'lash" uchun.
 */
export async function up(knex) {
  const has = await knex.schema.hasColumn('appointments', 'booking_group_id');
  if (!has) {
    await knex.schema.alterTable('appointments', (t) => {
      t.uuid('booking_group_id');
      t.index(['tenant_id', 'booking_group_id']);
    });
  }
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('appointments', 'booking_group_id');
  if (has) {
    await knex.schema.alterTable('appointments', (t) => {
      t.dropIndex(['tenant_id', 'booking_group_id']);
      t.dropColumn('booking_group_id');
    });
  }
}
