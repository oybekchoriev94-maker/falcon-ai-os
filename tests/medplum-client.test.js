// ============================================================
// Medplum klient — unit testlar (DB'siz, tarmoqsiz)
//
// CI'da MEDPLUM_BASE_URL YO'Q — integratsiya o'chirilgan holatda
// testlanadi: sof FHIR konstruktorlar to'g'ri ishlashi kerak,
// tarmoq funksiyalari esa null qaytarishi (hech narsa buzilmaydi).
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  isMedplumEnabled,
  toFhirPatient,
  toFhirEncounter,
  createFhirResource,
  updateFhirResource,
} from '../backend/services/medplum-client.js';

describe('Medplum gate', () => {
  it('MEDPLUM_BASE_URL bo\'sh bo\'lsa integratsiya o\'chiq', () => {
    expect(isMedplumEnabled()).toBe(false);
  });

  it('o\'chiq holda create/update null qaytaradi (tarmoqqa chiqmaydi)', async () => {
    expect(await createFhirResource('Patient', {})).toBeNull();
    expect(await updateFhirResource('Patient', '123', {})).toBeNull();
  });
});

describe('toFhirPatient', () => {
  it('to\'liq bemor kartasini FHIR R4 Patient\'ga aylantiradi', () => {
    const r = toFhirPatient({
      first_name: 'Vali',
      middle_name: 'Akbar',
      last_name: 'Aliyev',
      phone: '901234567',
      birth_date: '1990-05-12',
      gender: 'erkak',
      passport_number: 'aa1234567',
      medical_record_number: 42,
      region: 'Toshkent',
      district: 'Yunusobod',
      address: 'Amir Temur 1',
    });
    expect(r.resourceType).toBe('Patient');
    expect(r.name[0]).toEqual({ use: 'official', family: 'Aliyev', given: ['Vali', 'Akbar'] });
    expect(r.identifier).toContainEqual({ system: 'urn:falcon:mrn', value: '42' });
    expect(r.identifier).toContainEqual({ system: 'urn:falcon:passport', value: 'AA1234567' });
    expect(r.telecom[0].value).toBe('+998901234567');
    expect(r.birthDate).toBe('1990-05-12');
    expect(r.gender).toBe('male');
    expect(r.address[0].text).toBe('Toshkent, Yunusobod, Amir Temur 1');
  });

  it('minimal bemor: telefon/gender/manzil bo\'lmasa maydonlar chiqmaydi', () => {
    const r = toFhirPatient({ first_name: 'Bemor', last_name: 'B' });
    expect(r.telecom).toBeUndefined();
    expect(r.gender).toBeUndefined();
    expect(r.address).toBeUndefined();
    expect(r.identifier).toEqual([]);
  });

  it('gender variantlari: ayol/female va +998 prefiksli telefon', () => {
    const r = toFhirPatient({ first_name: 'G', last_name: 'X', gender: 'ayol', phone: '+998907654321' });
    expect(r.gender).toBe('female');
    expect(r.telecom[0].value).toBe('+998907654321');
  });
});

describe('toFhirEncounter', () => {
  const base = {
    appointment: {
      status: 'in_progress',
      service_name: 'Terapevt qabuli',
      scheduled_at: '2026-08-26T09:30:00.000Z',
      doctor_name: 'Dr Karimov',
    },
    patientExternalId: 'pat-1',
  };

  it('qabulni FHIR Encounter\'ga aylantiradi (subject = Patient mapping)', () => {
    const r = toFhirEncounter(base);
    expect(r.resourceType).toBe('Encounter');
    expect(r.status).toBe('in-progress');
    expect(r.class.code).toBe('AMB');
    expect(r.subject.reference).toBe('Patient/pat-1');
    expect(r.type[0].text).toBe('Terapevt qabuli');
    expect(r.period.start).toBe('2026-08-26T09:30:00.000Z');
    expect(r.text.div).toContain('Dr Karimov');
  });

  it('status mapping: completed → finished, scheduled → planned, noma\'lum → unknown', () => {
    expect(toFhirEncounter({ ...base, appointment: { ...base.appointment, status: 'completed' } }).status).toBe('finished');
    expect(toFhirEncounter({ ...base, appointment: { ...base.appointment, status: 'scheduled' } }).status).toBe('planned');
    expect(toFhirEncounter({ ...base, appointment: { ...base.appointment, status: 'biror-narsa' } }).status).toBe('unknown');
  });

  it('service_name va doctor bo\'lmasa tegishli maydonlar chiqmaydi', () => {
    const r = toFhirEncounter({ appointment: { status: 'scheduled' }, patientExternalId: 'p' });
    expect(r.type).toBeUndefined();
    expect(r.text).toBeUndefined();
    expect(r.period).toBeUndefined();
  });
});
