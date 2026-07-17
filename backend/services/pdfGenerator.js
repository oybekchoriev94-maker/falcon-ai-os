import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.join(__dirname, '..', '..', 'public', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const LINE_H = 16;

function capitalize(str) {
  if (!str) return '';
  return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function drawHeader(doc, meta) {
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#1e3a5f')
    .text('Falcon Medical Center', MARGIN, MARGIN, { align: 'center', width: CONTENT_WIDTH });
  doc.fontSize(10).font('Helvetica').fillColor('#64748b')
    .text('AI tizimi tomonidan generatsiya qilingan tibbiy hujjat', MARGIN, MARGIN + 22, { align: 'center', width: CONTENT_WIDTH });

  doc.moveTo(MARGIN, MARGIN + 40).lineTo(PAGE_WIDTH - MARGIN, MARGIN + 40).strokeColor('#cbd5e1').stroke();

  const topY = MARGIN + 50;
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#334155');
  doc.text('Bemor:', MARGIN, topY);
  doc.font('Helvetica').fillColor('#0f172a')
    .text(meta.patient_name || 'Noma\'lum', MARGIN + 55, topY);
  doc.font('Helvetica-Bold').fillColor('#334155')
    .text('Ko\'rik sanasi:', MARGIN + 250, topY);
  doc.font('Helvetica').fillColor('#0f172a')
    .text(meta.date || new Date().toLocaleDateString('uz-UZ'), MARGIN + 340, topY);

  doc.font('Helvetica-Bold').fillColor('#334155')
    .text('Shifokor:', MARGIN, topY + LINE_H);
  doc.font('Helvetica').fillColor('#0f172a')
    .text((meta.doctor_name || '') + ' (' + (meta.specialization_label || '') + ')', MARGIN + 55, topY + LINE_H);

  doc.font('Helvetica-Bold').fillColor('#334155')
    .text('Hujjat turi:', MARGIN + 250, topY + LINE_H);
  doc.font('Helvetica').fillColor('#0f172a')
    .text(meta.specialization_label || '-', MARGIN + 340, topY + LINE_H);

  doc.moveTo(MARGIN, topY + 2 * LINE_H + 8).lineTo(PAGE_WIDTH - MARGIN, topY + 2 * LINE_H + 8).strokeColor('#cbd5e1').stroke();
}

function drawSectionTitle(doc, y, title) {
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#1e3a5f')
    .text(title, MARGIN, y);
  return y + 20;
}

function drawField(doc, y, label, value) {
  if (!value || value === '' || value === '-' || value === null || value === undefined) return y;
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#475569')
    .text(label + ':', MARGIN, y);
  doc.font('Helvetica').fillColor('#0f172a')
    .text(String(value), MARGIN + 120, y, { width: CONTENT_WIDTH - 130, align: 'left' });
  return y + Math.max(LINE_H, doc.heightOfString(String(value), { width: CONTENT_WIDTH - 130 }) + 4);
}

function drawObjectTable(doc, y, obj, label) {
  if (!obj || typeof obj !== 'object') return y;
  y = drawSectionTitle(doc, y, label);
  const entries = Object.entries(obj);
  doc.rect(MARGIN, y, CONTENT_WIDTH, entries.length * 22 + 4).fillColor('#f8fafc').fill();
  doc.fontSize(9).font('Helvetica').fillColor('#1e293b');
  entries.forEach(([k, v], i) => {
    const rowY = y + 2 + i * 22;
    doc.fillColor('#475569').text(capitalize(k), MARGIN + 6, rowY + 3, { width: CONTENT_WIDTH * 0.4 });
    doc.fillColor('#0f172a').text(String(v || '-'), MARGIN + CONTENT_WIDTH * 0.4 + 6, rowY + 3, { width: CONTENT_WIDTH * 0.55 });
    if (i < entries.length - 1) {
      doc.moveTo(MARGIN + 4, rowY + 20).lineTo(PAGE_WIDTH - MARGIN - 4, rowY + 20).strokeColor('#e2e8f0').stroke();
    }
  });
  return y + entries.length * 22 + 8;
}

function drawTable(doc, y, columns, rows, colWidths) {
  if (!rows || rows.length === 0) return y;
  const headerH = 24;
  const rowH = 22;

  const totalW = colWidths.reduce((s, w) => s + w, 0);
  const startX = MARGIN + (CONTENT_WIDTH - totalW) / 2;

  doc.rect(startX, y, totalW, headerH).fillColor('#1e3a5f').fill();
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff');
  columns.forEach((col, i) => {
    let x = startX + colWidths.slice(0, i).reduce((s, w) => s + w, 0);
    doc.text(col, x + 4, y + 6, { width: colWidths[i] - 8, align: 'left' });
  });

  let currentY = y + headerH;
  rows.forEach((row, ri) => {
    if (ri % 2 === 0) {
      doc.rect(startX, currentY, totalW, rowH).fillColor('#f8fafc').fill();
    }
    doc.fontSize(9).font('Helvetica').fillColor('#1e293b');
    columns.forEach((col, ci) => {
      let x = startX + colWidths.slice(0, ci).reduce((s, w) => s + w, 0);
      let val = row[col.toLowerCase()] !== undefined ? row[col.toLowerCase()] : row[ci] || '-';
      doc.text(val, x + 4, currentY + 5, { width: colWidths[ci] - 8, align: 'left' });
    });
    currentY += rowH;
  });
  return currentY + 8;
}

function drawArrayTable(doc, y, rows, label) {
  if (!rows || rows.length === 0) return y;
  y = drawSectionTitle(doc, y, label);
  const cols = Object.keys(rows[0]);
  const colWidths = cols.map((_, i) => {
    if (i === 0) return 130;
    if (cols.length === 5) return 80;
    return Math.max(70, (CONTENT_WIDTH - 130) / (cols.length - 1));
  });
  const totalW = colWidths.reduce((s, w) => s + w, 0);
  const startX = MARGIN + (CONTENT_WIDTH - totalW) / 2;

  doc.rect(startX, y, totalW, 24).fillColor('#1e3a5f').fill();
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff');
  cols.forEach((col, i) => {
    let x = startX + colWidths.slice(0, i).reduce((s, w) => s + w, 0);
    doc.text(capitalize(col), x + 4, y + 6, { width: colWidths[i] - 8 });
  });
  let currentY = y + 24;
  rows.forEach((row, ri) => {
    if (ri % 2 === 0) doc.rect(startX, currentY, totalW, 22).fillColor('#f8fafc').fill();
    doc.fontSize(9).font('Helvetica').fillColor('#1e293b');
    cols.forEach((col, ci) => {
      let x = startX + colWidths.slice(0, ci).reduce((s, w) => s + w, 0);
      let val = row[col] !== undefined ? String(row[col]) : '-';
      if (col === 'status' || col === 'holat') {
        const color = val === 'Norma' || val === 'Normal' ? '#16a34a' : val === 'Yuqori' ? '#dc2626' : val === 'Past' ? '#ca8a04' : '#1e293b';
        doc.fillColor(color).font('Helvetica-Bold');
      } else {
        doc.fillColor('#1e293b').font('Helvetica');
      }
      doc.text(val, x + 4, currentY + 5, { width: colWidths[ci] - 8 });
    });
    currentY += 22;
  });
  return currentY + 8;
}

function drawFooter(doc, qrBuffer, reportId) {
  const footerY = PAGE_HEIGHT - MARGIN - 120;
  doc.moveTo(MARGIN, footerY).lineTo(PAGE_WIDTH - MARGIN, footerY).strokeColor('#cbd5e1').stroke();

  const signY = footerY + 12;
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#334155')
    .text('Shifokor imzosi: ______________________', MARGIN, signY);
  doc.fontSize(8).font('Helvetica').fillColor('#94a3b8')
    .text('Elektron imzo bilan tasdiqlangan', MARGIN, signY + 16);

  const qrSize = 80;
  const qrX = PAGE_WIDTH - MARGIN - qrSize;
  const qrY = footerY - qrSize - 8;

  if (qrBuffer) {
    try {
      doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
    } catch (e) {
      console.error('QR qo\'yishda xatolik:', e.message);
    }
  }

  doc.fontSize(7).font('Helvetica').fillColor('#94a3b8')
    .text('Hujjat ID: ' + (reportId || '-'), qrX - 10, qrY + qrSize + 2, { width: qrSize + 20, align: 'center' });
}

function renderBodyBySpecialization(doc, data, specialization) {
  let y = MARGIN + 100;

  const tableGroup = ['uzi', 'endokrinolog', 'kardiolog', 'oftalmolog'];
  const structuralGroup = ['terapevt', 'ginekolog', 'nevrolog', 'pediatr', 'stomatolog'];

  // Skip patient_name — it's in header
  const keys = Object.keys(data).filter(k => k !== 'patient_name');

  if (specialization === 'laborant') {
    y = drawSectionTitle(doc, y, 'Laboratoriya tahlillari');
    if (data.analysis_type) y = drawField(doc, y, 'Tahlil turi', data.analysis_type) + 4;
    if (data.results && Array.isArray(data.results)) {
      y = drawArrayTable(doc, y, data.results, 'Natijalar');
    }
    if (data.conclusion) {
      y = drawSectionTitle(doc, y, 'Xulosa');
      doc.fontSize(10).font('Helvetica-Oblique').fillColor('#334155')
        .text(data.conclusion, MARGIN, y, { width: CONTENT_WIDTH });
    }
    return;
  }

  if (tableGroup.includes(specialization)) {
    for (const key of keys) {
      const val = data[key];
      const label = capitalize(key);
      if (val === null || val === undefined || val === '') continue;
      if (typeof val === 'object' && !Array.isArray(val)) {
        y = drawObjectTable(doc, y, val, label);
      } else if (Array.isArray(val)) {
        y = drawArrayTable(doc, y, val, label);
      } else {
        y = drawField(doc, y, label, val) + 2;
      }
    }
    return;
  }

  if (structuralGroup.includes(specialization)) {
    for (const key of keys) {
      const val = data[key];
      if (val === null || val === undefined || val === '') continue;
      if (typeof val === 'object' && !Array.isArray(val)) {
        y = drawObjectTable(doc, y, val, capitalize(key));
      } else if (Array.isArray(val)) {
        y = drawArrayTable(doc, y, val, capitalize(key));
      } else {
        y = drawSectionTitle(doc, y, capitalize(key));
        doc.fontSize(10).font('Helvetica').fillColor('#1e293b')
          .text(String(val), MARGIN, y, { width: CONTENT_WIDTH });
        y = y + doc.heightOfString(String(val), { width: CONTENT_WIDTH }) + 8;
      }
    }
    return;
  }

  // Fallback: generic render for any unknown specialization
  for (const key of keys) {
    const val = data[key];
    if (val === null || val === undefined || val === '') continue;
    if (typeof val === 'object' && !Array.isArray(val)) {
      y = drawObjectTable(doc, y, val, capitalize(key));
    } else if (Array.isArray(val)) {
      y = drawArrayTable(doc, y, val, capitalize(key));
    } else {
      y = drawField(doc, y, capitalize(key), val) + 2;
    }
  }
}

export async function generateReportPdf(report) {
  return new Promise(async (resolve, reject) => {
    try {
      const { id, patient_name, doctor_name, specialization, specialization_label, data_json, created_at } = report;
      const data = typeof data_json === 'string' ? JSON.parse(data_json) : data_json;

      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        info: {
          Title: 'Tibbiy hisobot - ' + (patient_name || 'Noma\'lum'),
          Author: doctor_name || 'Falcon AI OS',
          Subject: specialization_label || 'Tibbiy hujjat',
          Keywords: ['tibbiyot', 'hisobot', specialization, 'Falcon AI OS']
        }
      });

      const verifyUrl = `https://localhost:3443/api/verify-report/${id}`;
      const qrBuffer = await QRCode.toBuffer(verifyUrl, {
        type: 'png',
        width: 200,
        margin: 1,
        color: { dark: '#1e3a5f', light: '#ffffff' }
      });

      drawHeader(doc, {
        patient_name,
        doctor_name,
        date: created_at ? new Date(created_at).toLocaleDateString('uz-UZ', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleDateString('uz-UZ'),
        specialization_label
      });

      renderBodyBySpecialization(doc, data, specialization);

      drawFooter(doc, qrBuffer, id);

      const filename = `report-${id}.pdf`;
      const filePath = path.join(REPORTS_DIR, filename);
      const writeStream = fs.createWriteStream(filePath);

      writeStream.on('finish', () => {
        resolve({ filename, filePath, url: `/reports/${filename}` });
      });
      writeStream.on('error', reject);

      doc.pipe(writeStream);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ============================================================
// Referral Pass PDF — Raqamli Tibbiy Yo'llanma
// ============================================================
export async function generateReferralPassPdf(referral) {
  return new Promise(async (resolve, reject) => {
    try {
      const filename = `referral-${referral.referral_id || referral.id}.pdf`;
      const filePath = path.join(REPORTS_DIR, filename);

      const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margins: { top: 40, bottom: 40, left: 50, right: 50 } });
      const writeStream = fs.createWriteStream(filePath);
      const W = PAGE_WIDTH - 100;

      // QR kod generatsiya
      const qrLink = `https://t.me/falcon_ai_bot/app?startapp=ref_${referral.referral_id || referral.id}`;
      let qrBuffer = null;
      try {
        qrBuffer = await QRCode.toBuffer(qrLink, { width: 200, margin: 2, color: { dark: '#1e3a5f', light: '#ffffff' } });
      } catch (qrErr) {
        console.warn('[PDF] QR xatosi:', qrErr.message);
      }

      doc.pipe(writeStream);

      // Sarlavha
      const logoY = 50;
      doc.fontSize(22).font('Helvetica-Bold').fillColor('#1e3a5f')
        .text('🏥 Falcon AI OS', 50, logoY, { align: 'center', width: W });
      doc.fontSize(12).font('Helvetica').fillColor('#64748b')
        .text('Raqamli Tibbiy Yo\'llanma (Digital Referral Pass)', 50, logoY + 28, { align: 'center', width: W });

      doc.moveTo(50, logoY + 52).lineTo(PAGE_WIDTH - 50, logoY + 52).strokeColor('#cbd5e1').stroke();

      // Asosiy ma'lumotlar
      let y = logoY + 70;
      const labelColor = '#475569';
      const valColor = '#0f172a';
      const LH = 18;

      doc.fontSize(10).font('Helvetica-Bold').fillColor(labelColor).text('Yo\'llanma ID:', 50, y);
      doc.font('Helvetica').fillColor(valColor).text(referral.referral_id || referral.id, 160, y);
      y += LH;

      doc.font('Helvetica-Bold').fillColor(labelColor).text('Bemor:', 50, y);
      doc.font('Helvetica').fillColor(valColor).text(referral.patient_name || 'Noma\'lum', 160, y);
      y += LH;

      doc.font('Helvetica-Bold').fillColor(labelColor).text('Yo\'naltirgan shifokor:', 50, y);
      doc.font('Helvetica').fillColor(valColor).text(referral.referring_doctor || 'Noma\'lum', 160, y);
      y += LH;

      doc.font('Helvetica-Bold').fillColor(labelColor).text('Muolaja turi:', 50, y);
      doc.font('Helvetica').fillColor(valColor).text(referral.service_required || '-', 160, y);
      y += LH;

      doc.font('Helvetica-Bold').fillColor(labelColor).text('Borish kerak:', 50, y);
      const clinicName = referral.receiver_clinic_id || referral.receiver_clinic_name || 'Belgilangan klinika';
      doc.font('Helvetica').fillColor(valColor).text(clinicName, 160, y);
      y += LH;

      doc.font('Helvetica-Bold').fillColor(labelColor).text('Holati:', 50, y);
      const statusColors = { pending: '#ca8a04', completed: '#16a34a', cancelled: '#dc2626' };
      doc.font('Helvetica').fillColor(statusColors[referral.status] || '#64748b')
        .text((referral.status === 'pending' ? 'Kutilmoqda' : referral.status === 'completed' ? 'Bajarilgan' : 'Bekor qilingan'), 160, y);
      y += LH + 6;

      // Chegirma kartasi
      const discountX = 50;
      const discountY = y;
      const discountW = W;
      const discountH = 60;
      doc.roundedRect(discountX, discountY, discountW, discountH, 10).fillAndStroke('#f0fdf4', '#16a34a');
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#15803d')
        .text('🎉 Siz uchun Maxsus Chegirma!', discountX + 14, discountY + 10, { width: discountW - 28 });
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#16a34a')
        .text('Ushbu yo\'llanma orqali siz 10% chegirma olishingiz mumkin!', discountX + 14, discountY + 32, { width: discountW - 28 });
      y = discountY + discountH + 20;

      // QR kod
      if (qrBuffer) {
        try {
          doc.image(qrBuffer, PAGE_WIDTH / 2 - 100, y, { width: 200, height: 200, align: 'center' });
        } catch (imgErr) {
          doc.fontSize(14).font('Helvetica').fillColor('#1e3a5f')
            .text('QR: ' + qrLink, 50, y, { align: 'center', width: W });
        }
      } else {
        doc.fontSize(10).font('Helvetica').fillColor('#1e3a5f')
          .text('QR kod: ' + qrLink, 50, y, { align: 'center', width: W });
      }
      y += qrBuffer ? 210 : 20;

      // QR ostidagi matn
      doc.fontSize(9).font('Helvetica').fillColor('#64748b')
        .text('Ushbu QR-kodni klinikada skanerlab, yo\'llanmani tasdiqlang.', 50, y, { align: 'center', width: W });
      y += 16;
      doc.fontSize(8).font('Helvetica').fillColor('#94a3b8')
        .text(qrLink, 50, y, { align: 'center', width: W });
      y += 24;

      // Footer
      const footerY = PAGE_HEIGHT - 60;
      doc.moveTo(50, footerY).lineTo(PAGE_WIDTH - 50, footerY).strokeColor('#cbd5e1').stroke();
      doc.fontSize(8).font('Helvetica').fillColor('#94a3b8')
        .text('© Falcon AI OS — Barcha huquqlar himoyalangan', 50, footerY + 8, { align: 'center', width: W });
      doc.fontSize(7).font('Helvetica').fillColor('#cbd5e1')
        .text(`Yaratilgan sana: ${new Date().toLocaleDateString('uz-UZ', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, 50, footerY + 22, { align: 'center', width: W });

      doc.end();
      writeStream.on('finish', () => resolve({ filename, filePath, url: `/reports/${filename}` }));
      writeStream.on('error', reject);
    } catch (e) { reject(e); }
  });
}
