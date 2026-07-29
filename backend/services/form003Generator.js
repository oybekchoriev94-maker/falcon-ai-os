// ============================================================
// FALCON AI OS — 003-forma A4 chop etish (barcha bo'limlar).
// Yotqizishning to'liq statsionar kartasini PDF qilib yig'adi.
// ============================================================
import PDFDocument from 'pdfkit';

const MARGIN = 40;
const FONT_REG = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';

function ln(doc, y, thick = 0.5) {
  doc.moveTo(MARGIN, y).lineTo(doc.page.width - MARGIN, y).lineWidth(thick).stroke();
  return y + 4;
}
function heading(doc, y, text) {
  if (y > doc.page.height - 100) { doc.addPage(); y = MARGIN; }
  doc.font(FONT_BOLD).fontSize(11).fillColor('#000').text(text, MARGIN, y);
  y = doc.y + 2;
  return ln(doc, y, 1);
}
function label(doc, y, k, v) {
  if (v == null || v === '') return y;
  if (y > doc.page.height - 80) { doc.addPage(); y = MARGIN; }
  doc.font(FONT_BOLD).fontSize(9).text(`${k}: `, MARGIN, y, { continued: true });
  doc.font(FONT_REG).text(String(v));
  return doc.y + 2;
}
function para(doc, y, text) {
  if (!text) return y;
  if (y > doc.page.height - 80) { doc.addPage(); y = MARGIN; }
  doc.font(FONT_REG).fontSize(9).text(String(text), MARGIN, y, { width: doc.page.width - 2 * MARGIN });
  return doc.y + 4;
}
function tinyPara(doc, y, text) {
  if (!text) return y;
  if (y > doc.page.height - 60) { doc.addPage(); y = MARGIN; }
  doc.font(FONT_REG).fontSize(8).fillColor('#333').text(String(text), MARGIN, y, { width: doc.page.width - 2 * MARGIN });
  doc.fillColor('#000');
  return doc.y + 2;
}
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtSum(n) {
  if (n == null) return '0';
  return new Intl.NumberFormat('uz-UZ').format(Number(n));
}

/**
 * Yotqizish bo'yicha 003-forma PDF yig'adi.
 * Kirish: { tenant, patient, admission, intakes[], epis[], daily_notes[],
 *          prescriptions[], executions[], labs[], services[], consents[],
 *          contracts[], acts[], discharge }
 */
export async function generateForm003Pdf(payload) {
  return new Promise((resolve, reject) => {
    try {
      const {
        tenant = {}, patient = {}, admission = {},
        intakes = [], epis = [], daily_notes = [],
        prescriptions = [], executions = [], labs = [],
        services = [], consents = [], contracts = [], acts = [], discharge = null,
      } = payload;

      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        info: {
          Title: `003-forma — ${patient.first_name || ''} ${patient.last_name || ''}`,
          Author: tenant.name || 'Falcon AI OS',
        },
      });

      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── SAHIFA 1: MUQOVA ──
      doc.font(FONT_BOLD).fontSize(14).text(
        (tenant.legal_name || tenant.name || 'Klinika').toUpperCase(),
        { align: 'center' }
      );
      doc.moveDown(0.3);
      doc.font(FONT_REG).fontSize(9).text(tenant.legal_address || '', { align: 'center' });
      doc.moveDown(0.5);
      doc.font(FONT_BOLD).fontSize(13).text('BEMORNING TIBBIY KARTASI', { align: 'center' });
      doc.font(FONT_REG).fontSize(10).text(
        `№ ${patient.medical_record_number || '—'}`,
        { align: 'center' }
      );
      doc.moveDown(1);

      let y = doc.y;
      y = ln(doc, y, 1);
      y = heading(doc, y, '1. Bemor');
      y = label(doc, y, 'F.I.O',
        [patient.last_name, patient.first_name, patient.middle_name].filter(Boolean).join(' '));
      y = label(doc, y, "Tug'ilgan sana", fmtDate(patient.birth_date));
      y = label(doc, y, 'Jinsi', patient.gender);
      y = label(doc, y, 'Telefon', patient.phone);
      y = label(doc, y, 'Manzil', [patient.region, patient.district, patient.address].filter(Boolean).join(', '));
      y = label(doc, y, 'Passport', patient.passport_number);
      y = label(doc, y, 'MRN', patient.medical_record_number);
      y = label(doc, y, 'Qon guruhi', patient.blood_group ? `${patient.blood_group} ${patient.rh_factor || ''}` : null);
      y = label(doc, y, 'Allergiya', patient.allergies);
      y = label(doc, y, 'Kasbi', patient.occupation);
      y = label(doc, y, 'Ish joyi', patient.workplace);
      y = label(doc, y, 'Nogironlik', patient.disability_group);
      if (patient.emergency_contact_name) {
        y = label(doc, y, 'Yaqin qarindosh',
          `${patient.emergency_contact_name} (${patient.emergency_contact_relation || ''}) ${patient.emergency_contact_phone || ''}`);
      }

      y = heading(doc, y, '2. Yotqizish');
      y = label(doc, y, 'Yotqizilgan', fmtDateTime(admission.admission_date));
      y = label(doc, y, 'Chiqarilgan', admission.discharge_date ? fmtDateTime(admission.discharge_date) : '—');
      y = label(doc, y, 'Bo\'lim / palata', [admission.ward_name, admission.bed_number].filter(Boolean).join(' · '));
      y = label(doc, y, 'Yotqizish turi', admission.admission_type);
      y = label(doc, y, 'Boshlang\'ich tashxis', admission.diagnosis_initial);
      y = label(doc, y, 'Davolovchi shifokor', admission.attending_doctor_name);
      y = label(doc, y, 'Parhez stoli', admission.diet_number != null ? `№ ${admission.diet_number}` : null);

      // ── BIRLAMCHI KO'RIK ──
      if (intakes.length > 0) {
        y = heading(doc, y, '3. Birlamchi qabul ko\'rigi');
        for (const it of intakes) {
          y = label(doc, y, 'Sana', fmtDateTime(it.examined_at));
          y = label(doc, y, 'Shifokor', it.doctor_name);
          y = label(doc, y, 'Keltirilishi', it.brought_by);
          if (it.complaint_pain) y = para(doc, y, `Shikoyat: ${it.complaint_pain}`);
          if (it.anamnesis_morbi) y = para(doc, y, `Anamnez morbi: ${it.anamnesis_morbi}`);
          if (it.status_praesens) y = para(doc, y, `Status praesens: ${it.status_praesens}`);
          if (it.preliminary_diagnosis) y = label(doc, y, 'Taxminiy tashxis', it.preliminary_diagnosis);
          y += 4;
        }
      }

      // ── EPI-ANAMNEZ ──
      if (epis.length > 0) {
        y = heading(doc, y, '4. Epi-anamnez (SanPIN)');
        for (const ep of epis) {
          y = label(doc, y, 'Sana', fmtDateTime(ep.collected_at));
          const flags = [];
          if (ep.infection_contact) flags.push('kontakt');
          if (ep.travel_last_month) flags.push('sayohat');
          if (ep.had_transfusion) flags.push('gemotransfuziya');
          if (ep.had_surgery_6mo) flags.push('6oy jarrohlik');
          if (ep.parenteral_procedures) flags.push('parenteral');
          if (ep.cosmetic_services) flags.push('maishiy xizmat');
          if (flags.length > 0) y = label(doc, y, 'Risklar', flags.join(', '));
          if (ep.epi_diagnosis) y = label(doc, y, 'Tashxis', ep.epi_diagnosis);
          if (ep.management_plan) y = label(doc, y, 'Reja', ep.management_plan);
          y += 4;
        }
      }

      // ── OBHOD JURNALI ──
      if (daily_notes.length > 0) {
        y = heading(doc, y, '5. Kundalik (obhod)');
        for (const n of daily_notes) {
          if (y > doc.page.height - 80) { doc.addPage(); y = MARGIN; }
          const header = `${fmtDate(n.date)} ${n.shift || ''} — ${n.doctor_name || ''}`;
          doc.font(FONT_BOLD).fontSize(9).text(header, MARGIN, y);
          y = doc.y;
          const vitals = [];
          if (n.temperature != null) vitals.push(`t° ${n.temperature}`);
          if (n.blood_pressure) vitals.push(`A/D ${n.blood_pressure}`);
          if (n.pulse != null) vitals.push(`PS ${n.pulse}`);
          if (n.saturation != null) vitals.push(`SpO2 ${n.saturation}%`);
          if (vitals.length > 0) y = para(doc, y, vitals.join('  ·  '));
          if (n.ai_summary) y = tinyPara(doc, y, n.ai_summary);
          else {
            if (n.complaints) y = tinyPara(doc, y, `Shikoyat: ${n.complaints}`);
            if (n.treatment_plan) y = tinyPara(doc, y, `Reja: ${n.treatment_plan}`);
          }
          y += 4;
        }
      }

      // ── DORILAR ──
      if (prescriptions.length > 0) {
        y = heading(doc, y, '6. Buyurilgan dori-vositalari');
        for (const p of prescriptions) {
          const line = `${p.medicine_name}  ·  ${p.dosage || ''}  ·  ${p.route || ''}  ·  ${p.frequency || ''}`;
          y = para(doc, y, line);
          const ex = executions.filter((e) => e.prescription_id === p.id);
          if (ex.length > 0) {
            y = tinyPara(doc, y, `Bajarilishlar: ${ex.length} marta`);
          }
        }
      }

      // ── LABORATORIYA ──
      if (labs.length > 0) {
        y = heading(doc, y, '7. Laborator tekshiruvlar');
        for (const lb of labs) {
          const line = `${lb.test_type}  ${lb.test_name ? '· ' + lb.test_name : ''}  — ${lb.status}`;
          y = label(doc, y, fmtDate(lb.ordered_at), line);
          if (lb.result_conclusion) y = tinyPara(doc, y, lb.result_conclusion);
        }
      }

      // ── XIZMATLAR ──
      if (services.length > 0) {
        y = heading(doc, y, '8. Ko\'rsatilgan xizmatlar');
        let totalSum = 0;
        for (const s of services) {
          const sum = Number(s.total) || (Number(s.quantity || 1) * Number(s.price || 0));
          totalSum += sum;
          y = para(doc, y, `${fmtDate(s.date)}  ${s.service_name}  ×${s.quantity || 1}  =  ${fmtSum(sum)} so'm`);
        }
        y = label(doc, y, 'Jami', `${fmtSum(totalSum)} so'm`);
      }

      // ── ROZILIKLAR ──
      if (consents.length > 0) {
        y = heading(doc, y, '9. Bemor roziligi');
        for (const c of consents) {
          y = label(doc, y, fmtDateTime(c.signed_at), c.title || c.kind);
        }
      }

      // ── SHARTNOMA VA AKT ──
      if (contracts.length > 0 || acts.length > 0) {
        y = heading(doc, y, '10. Shartnoma va akt');
        for (const ct of contracts) {
          y = label(doc, y, `Shartnoma ${ct.contract_number}`,
            `${fmtDate(ct.contract_date)} — jami ${fmtSum(ct.total_amount)} so'm`);
        }
        for (const a of acts) {
          y = label(doc, y, `Akt ${a.act_number}`,
            `${fmtDate(a.act_date)} — jami ${fmtSum(a.total_amount)} · to'landi ${fmtSum(a.paid_amount)}`);
        }
      }

      // ── CHIQARISH EPIKRIZI ──
      if (discharge) {
        y = heading(doc, y, '11. Chiqarish epikrizi');
        y = label(doc, y, 'Chiqarilgan', fmtDateTime(discharge.discharge_date));
        y = label(doc, y, 'Turi', discharge.discharge_type);
        if (discharge.diagnosis_final) y = para(doc, y, `Yakuniy tashxis: ${discharge.diagnosis_final}`);
        if (discharge.recommendations) y = para(doc, y, `Tavsiyalar: ${discharge.recommendations}`);
        if (discharge.epicrisis_text) y = para(doc, y, discharge.epicrisis_text);
      }

      // Imzolar
      if (y > doc.page.height - 140) { doc.addPage(); y = MARGIN; }
      y = heading(doc, y, 'Imzolar');
      const imzo = (t) => {
        doc.font(FONT_REG).fontSize(9).text(`${t}: ______________________________`, MARGIN, y);
        y = doc.y + 8;
      };
      imzo('Davolovchi shifokor');
      imzo("Bo'lim mudiri");
      imzo('Bosh shifokor muovini');

      doc.end();
    } catch (e) { reject(e); }
  });
}
