// ============================================================
// Falcon AI OS — Medplum (FHIR) klienti (roadmap PR #5)
//
// Klinik ma'lumotning asosiy manbasi Medplum/FHIR bo'ladi
// (PLATFORM-ROADMAP modul 2). Falcon — integratsiya markazi:
// bemor kartasi va qabullar Medplumga push qilinadi.
//
// STT/TTS bilan bir xil falsafa:
//   - MEDPLUM_BASE_URL bo'sh bo'lsa integratsiya O'CHIQ —
//     hech qanday oqim buzilmaydi, endpoint aniq kod qaytaradi
//   - Tarmoq xatosida null — Falcon o'z ishini davom ettiradi,
//     sinhronizatsiya keyin qayta uriniladi (mapping jadvali bor)
//   - Sof FHIR konstruktorlar DB'siz unit-test qilinadi
//
// Autentifikatsiya: Medplum Access Token (Bearer). Keyin kerak
// bo'lsa OAuth2 client_credentials qo'shiladi.
// ============================================================

const MEDPLUM_BASE_URL = (process.env.MEDPLUM_BASE_URL || '').replace(/\/+$/, '');
const MEDPLUM_ACCESS_TOKEN = process.env.MEDPLUM_ACCESS_TOKEN || '';

export function isMedplumEnabled() {
  return !!MEDPLUM_BASE_URL;
}

/** O'zbek telefonini E.164 ko'rinishiga keltiradi (FHIR telecom uchun) */
function e164(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 9) return `+998${d}`;
  if (d.length === 12 && d.startsWith('998')) return `+${d}`;
  return `+${d}`;
}

/**
 * Falcon bemorini FHIR R4 Patient resursiga aylantiradi (SOF).
 * @param {Object} p patients jadvali satri
 * @returns {Object} FHIR Patient
 */
export function toFhirPatient(p) {
  const given = [p.first_name, p.middle_name].filter(Boolean).map(String);
  const identifiers = [];
  if (p.medical_record_number) {
    identifiers.push({
      system: 'urn:falcon:mrn',
      value: String(p.medical_record_number),
    });
  }
  if (p.passport_number) {
    identifiers.push({
      system: 'urn:falcon:passport',
      value: String(p.passport_number).toUpperCase(),
    });
  }
  const phone = e164(p.phone);
  const genderRaw = String(p.gender || '').toLowerCase();
  const resource = {
    resourceType: 'Patient',
    name: [{
      use: 'official',
      family: String(p.last_name || ''),
      given,
    }],
    identifier: identifiers,
  };
  if (phone) {
    resource.telecom = [{ system: 'phone', value: phone, use: 'mobile' }];
  }
  if (p.birth_date) {
    // 'YYYY-MM-DD' yoki '1990' kabi qisqa qiymatlarni o'tkazamiz
    resource.birthDate = String(p.birth_date).slice(0, 10);
  }
  if (genderRaw === 'male' || genderRaw === 'erkak' || genderRaw === 'm') resource.gender = 'male';
  else if (genderRaw === 'female' || genderRaw === 'ayol' || genderRaw === 'f') resource.gender = 'female';
  const addressParts = [p.region, p.district, p.address].filter(Boolean).map(String);
  if (addressParts.length) {
    resource.address = [{ text: addressParts.join(', ') }];
  }
  return resource;
}

/** Appointment statusini FHIR Encounter statusiga o'tkazadi */
const ENCOUNTER_STATUS = {
  scheduled: 'planned',
  confirmed: 'planned',
  in_progress: 'in-progress',
  completed: 'finished',
  cancelled: 'cancelled',
  no_show: 'cancelled',
};

/**
 * Falcon qabulini FHIR R4 Encounter resursiga aylantiradi (SOF).
 * @param {Object} opts { appointment, patientExternalId }
 * @returns {Object} FHIR Encounter
 */
export function toFhirEncounter({ appointment, patientExternalId }) {
  const a = appointment;
  const resource = {
    resourceType: 'Encounter',
    status: ENCOUNTER_STATUS[a.status] || 'unknown',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
    subject: { reference: `Patient/${patientExternalId}` },
  };
  if (a.service_name) {
    resource.type = [{ text: String(a.service_name) }];
  }
  if (a.scheduled_at) {
    resource.period = { start: new Date(a.scheduled_at).toISOString() };
  }
  if (a.doctor_name) {
    // Medplum Practitioner hali sinhronlanmagan — shifokor nomini
    // matn blokida saqlaymiz (keyin Practitioner resursiga almashtiriladi)
    resource.text = { status: 'generated', div: `<div xmlns="http://www.w3.org/1999/xhtml">${a.doctor_name}</div>` };
  }
  return resource;
}

/**
 * FHIR resursini Medplumga yuboradi (create).
 * @returns {Promise<{id:string, versionId:string|null}|null>}
 */
export async function createFhirResource(resourceType, resource) {
  if (!isMedplumEnabled()) return null;
  try {
    const res = await fetch(`${MEDPLUM_BASE_URL}/fhir/R4/${resourceType}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/fhir+json',
        'Authorization': `Bearer ${MEDPLUM_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(resource),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`[MEDPLUM] ${resourceType} yaratish xatosi: HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    return { id: data.id, versionId: data.meta?.versionId || null };
  } catch (e) {
    console.warn('[MEDPLUM] Ulanish xatosi:', e.message);
    return null;
  }
}

/**
 * FHIR resursini yangilaydi (update by id).
 * @returns {Promise<{id:string, versionId:string|null}|null>}
 */
export async function updateFhirResource(resourceType, externalId, resource) {
  if (!isMedplumEnabled()) return null;
  try {
    const res = await fetch(`${MEDPLUM_BASE_URL}/fhir/R4/${resourceType}/${externalId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/fhir+json',
        'Authorization': `Bearer ${MEDPLUM_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ ...resource, id: externalId }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`[MEDPLUM] ${resourceType}/${externalId} yangilash xatosi: HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    return { id: data.id || externalId, versionId: data.meta?.versionId || null };
  } catch (e) {
    console.warn('[MEDPLUM] Ulanish xatosi:', e.message);
    return null;
  }
}
