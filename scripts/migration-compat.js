import { readdir } from 'node:fs/promises';

export const KNOWN_LEGACY_PRODUCTION_MIGRATIONS = Object.freeze([
  '007_services_and_receipts.js',
  '008_prevent_booking_conflicts.js',
  '009_appointment_services.js',
  '010_appointment_address.js',
  '011_patient_linking.js',
  '012_doctor_workflow.js',
  '013_inpatient_linking.js',
  '014_patient_card_fields.js',
  '015_intake_and_epi.js',
  '016_lab_orders.js',
  '017_prescription_executions.js',
  '018_consents_contracts_acts.js',
  '019_full_form003_fields.js',
  '020_doctor_forwarding.js',
  '021_workflow_glue.js',
  '022_ai_alerts.js',
  '023_time_saver_ai.js',
  '024_patient_notifications.js',
  '025_business_insights.js',
  '026_ai_action_proposals.js',
  '027_patient_chatbot.js',
  '028_kiosk_devices.js',
  '029_services_uzbek_names.js',
  '030_booking_group.js',
  '031_attendance.js',
  '032_appointment_checkin.js',
  '033_oqtosh_doctors_services.js',
  '034_consultation_section.js',
  '035_voice_recordings.js',
]);

const knownLegacySet = new Set(KNOWN_LEGACY_PRODUCTION_MIGRATIONS);

export function findMissingAppliedMigrations(appliedNames, availableNames) {
  const available = new Set(availableNames);
  return [...new Set(appliedNames)].filter((name) => !available.has(name)).sort();
}

export function assertKnownLegacyMigrationHistory(missingNames) {
  const unknown = missingNames.filter((name) => !knownLegacySet.has(name));

  if (unknown.length > 0) {
    throw new Error(
      `Migration history contains unknown missing files: ${unknown.join(', ')}`,
    );
  }

  return missingNames.length > 0;
}

export async function resolveMigrationOptions(db, baseOptions = {}) {
  const tableName = baseOptions.tableName || 'knex_migrations';
  const historyExists = await db.schema.hasTable(tableName);

  if (!historyExists) return { ...baseOptions };

  const [rows, files] = await Promise.all([
    db(tableName).select('name'),
    readdir(new URL('../migrations/', import.meta.url)),
  ]);
  const appliedNames = rows.map(({ name }) => name);
  const availableNames = files.filter((name) => name.endsWith('.js'));
  const missingNames = findMissingAppliedMigrations(appliedNames, availableNames);

  if (!assertKnownLegacyMigrationHistory(missingNames)) return { ...baseOptions };

  console.warn(
    `[MIGRATE] Accepting ${missingNames.length} explicitly known legacy migration records`,
  );
  return {
    ...baseOptions,
    disableMigrationsListValidation: true,
  };
}
