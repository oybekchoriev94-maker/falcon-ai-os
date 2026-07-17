// ============================================================
// Falcon AI OS — DOCX + PDF Proposal Generator
// Usage: node scripts/generate-proposal.js
// Output: C:\Projects\falcon-ai-os\proposal.docx
//         C:\Projects\falcon-ai-os\proposal.pdf
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType,
  ShadingType, PageNumber, Footer, Header, PageBreak,
  TabStopPosition, TabStopType, LevelFormat,
  convertInchesToTwip, ExternalHyperlink,
  UnderlineType
} from 'docx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── COLORS ─────────────────────────────────────────
const INDIGO = '4338CA';
const DARK = '0F0C29';
const MID = '302B63';
const WHITE = 'FFFFFF';
const GRAY = '6B7280';
const LIGHT_BG = 'F8F9FF';
const GREEN = '059669';
const BORDER = 'E5E7EB';
const ACCENT = '6366F1';

// ─── HELPERS ────────────────────────────────────────
function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ text, heading: level, spacing: { before: 400, after: 200 } });
}

function subheading(text) {
  return new Paragraph({
    children: [
      new TextRun({ text: text.toUpperCase(), font: 'Inter', size: 14, color: ACCENT, bold: true })
    ],
    spacing: { before: 300, after: 60 }
  });
}

function body(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Inter', size: 22, color: DARK, ...opts })],
    spacing: { after: opts.after || 120 },
    ...opts
  });
}

function boldBody(text) {
  return body(text, { bold: true });
}

function spacer(size = 120) {
  return new Paragraph({ spacing: { after: size }, children: [] });
}

// Table helper
function makeTable(headers, rows, colWidths = null) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => new TableCell({
      width: colWidths ? { size: colWidths[i], type: WidthType.PERCENTAGE } : undefined,
      shading: { type: ShadingType.SOLID, color: LIGHT_BG },
      children: [new Paragraph({
        children: [new TextRun({ text: h, font: 'Inter', size: 20, bold: true, color: DARK })],
        spacing: { before: 80, after: 80 }
      })]
    }))
  });

  const dataRows = rows.map(row =>
    new TableRow({
      children: row.map((cell, i) => new TableCell({
        width: colWidths ? { size: colWidths[i], type: WidthType.PERCENTAGE } : undefined,
        children: [new Paragraph({
          children: [new TextRun({ text: String(cell), font: 'Inter', size: 20, color: DARK })],
          spacing: { before: 60, after: 60 }
        })]
      }))
    })
  );

  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: BORDER },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: BORDER },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: BORDER },
    }
  });
}

// Highlight box
function highlightBox(text) {
  return new Table({
    rows: [new TableRow({
      children: [new TableCell({
        shading: { type: ShadingType.SOLID, color: 'EEF2FF' },
        children: [new Paragraph({
          children: [new TextRun({ text, font: 'Inter', size: 22, color: DARK, bold: true })],
          spacing: { before: 120, after: 120 }
        })]
      })]
    })],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// ─── BUILD DOCUMENT ─────────────────────────────────
async function buildDocx() {
  const doc = new Document({
    title: 'Falcon AI OS — Tijorat Taklifi',
    description: 'Klinikalar uchun sun\'iy intellekt ekotizimi',
    styles: {
      default: {
        document: { font: 'Inter', size: 22, color: DARK },
        heading1: { font: 'Inter', size: 52, bold: true, color: DARK },
        heading2: { font: 'Inter', size: 36, bold: true, color: DARK },
        heading3: { font: 'Inter', size: 28, bold: true, color: DARK },
      }
    },
    sections: [
      // ═══════ COVER PAGE ═══════
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          }
        },
        children: [
          spacer(2000),
          new Paragraph({
            children: [new TextRun({
              text: '✦ TIJORAT TAKLIFI v1.0',
              font: 'Inter', size: 18, color: ACCENT, bold: true
            })],
            spacing: { after: 200 }
          }),
          new Paragraph({
            children: [new TextRun({
              text: 'Falcon AI OS',
              font: 'Inter', size: 72, bold: true, color: INDIGO
            })],
            spacing: { after: 60 }
          }),
          new Paragraph({
            children: [new TextRun({
              text: 'Klinikalar uchun sun\'iy intellekt ekotizimi',
              font: 'Inter', size: 32, color: MID
            })],
            spacing: { after: 400 }
          }),
          makeTable(
            ['', ''],
            [
              ['Sana', '2026-yil iyun'],
              ['Amal qilish muddati', '30 kun'],
              ['Tayyorladi', 'Falcon AI Team'],
            ],
            [30, 70]
          ),
        ]
      },

      // ═══════ SECTION 1 ═══════
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          }
        },
        children: [
          subheading('01'),
          heading('Qisqacha mazmun'),
          body('Falcon AI OS — bu klinikalar uchun mo\'ljallangan, to\'liq lokal ishlaydigan sun\'iy intellekt ekotizimi. Tizim 9 ta AI agent, Face ID biometriya, aqlli ombor boshqaruvi va B2B yo\'llanma tizimini o\'z ichiga oladi.'),
          body('Barcha AI modellar klinikaning o\'z serverida ishlaydi. Internet talab qilmaydi. Bemor ma\'lumotlari hech qachon tashqariga chiqmaydi. Oylik cloud to\'lovlari yo\'q.'),
          spacer(200),

          makeTable(
            ['Ko\'rsatkich', 'Qiymat'],
            [
              ['AI agentlar soni', '9 ta'],
              ['LLM javob tezligi', '80–150 ms'],
              ['Face ID aniqlik', '99.2%'],
              ['STT aniqlik (o\'zbek)', '90–93%'],
              ['STT aniqlik (rus)', '96–98%'],
              ['Offline ishlash', '100% lokal'],
              ['Klinika sig\'imi', '50 kishigacha'],
            ],
            [55, 45]
          ),
        ]
      },

      // ═══════ SECTION 2 ═══════
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          }
        },
        children: [
          subheading('02'),
          heading('Muammo va yechim'),
          body('Klinikalarda eng ko\'p uchraydigan 6 ta muammo va ularning Falcon AI OS yechimi:'),
          spacer(100),

          makeTable(
            ['#', 'Muammo', 'Yo\'qotish', 'Yechim'],
            [
              ['1', 'Bemorlarni qo\'lda ro\'yxatga olish', '30–60 daqiqa', 'Face ID kiosk, 0.5s'],
              ['2', 'Shifokor diktantini yozish', '15–20 daqiqa/bemor', 'AI Scribe, 3–5s'],
              ['3', 'Dori-darmon hisobi', '20–40 daqiqa/kun', 'Smart Inventory'],
              ['4', 'Telefon orqali band qilish', '40+ daqiqa/kun', 'AI Receptionist 24/7'],
              ['5', 'Klinikalararo yo\'llanma', '2–3 kun', 'B2B Referral'],
              ['6', 'Statistika va hisobot', '1–2 soat/hafta', 'Analytics'],
            ],
            [8, 35, 25, 32]
          ),
        ]
      },

      // ═══════ SECTION 3 ═══════
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          }
        },
        children: [
          subheading('03'),
          heading('Imkoniyatlar'),

          new Paragraph({
            children: [new TextRun({ text: '🫵 Face ID — Yuz orqali identifikatsiya', font: 'Inter', size: 28, bold: true, color: DARK })],
            spacing: { before: 200, after: 100 }
          }),
          body('Bemor va xodimlarni yuz orqali aniqlash. Liveness detection. Ma\'lumotlar AES-256-GCM shifrlangan.'),
          spacer(100),
          makeTable(
            ['Imkoniyat', 'Tavsif'],
            [
              ['Ro\'yxatga olish', '1 marta kameraga qarash, 0.5s'],
              ['Tekshirish', '0.3s, 99.2% aniqlik'],
              ['Liveness', 'Odam ekanligini tekshiradi'],
              ['Davomat', 'Kirish/chiqish vaqti avtomatik'],
              ['GDPR', 'Rozilik, o\'chirish huquqi'],
            ],
            [35, 65]
          ),

          new Paragraph({
            children: [new TextRun({ text: '🎙️ AI Scribe — Shifokor yordamchisi', font: 'Inter', size: 28, bold: true, color: DARK })],
            spacing: { before: 300, after: 100 }
          }),
          body('Shifokor diktantini avtomatik ICD-10 kodlari, dori nomlari va vital signallar bilan to\'ldirilgan tibbiy qaydga aylantiradi.'),
          highlightBox('"Bemor 45 yosh, 2-tip diabet... → Diagnoz: E11.9 · HbA1C 8.2% · Metformin 850mg"'),

          new Paragraph({
            children: [new TextRun({ text: '🤖 AI Receptionist — 24/7 Ovozli operator', font: 'Inter', size: 28, bold: true, color: DARK })],
            spacing: { before: 300, after: 100 }
          }),
          body('Bemor qo\'ng\'iroq qiladi → AI operator shifokor grafigini tekshiradi → bo\'sh vaqtlarni aytadi → band qiladi. Telegram orqali eslatma.'),

          new Paragraph({
            children: [new TextRun({ text: '📦 Smart Inventory — Aqlli ombor', font: 'Inter', size: 28, bold: true, color: DARK })],
            spacing: { before: 300, after: 100 }
          }),
          makeTable(
            ['Funksiya', 'Tavsif'],
            [
              ['FEFO boshqaruvi', 'First Expiry First Out'],
              ['Normativlar', 'Minimal qoldiq avtomatik'],
              ['Ovozli boshqaruv', '"5 ampuladan foydalandim"'],
              ['Muddati yaqin', '7 kunlik ogohlantirish'],
            ],
            [35, 65]
          ),

          new Paragraph({
            children: [new TextRun({ text: '📊 Analytics — Hisobot va tahlil', font: 'Inter', size: 28, bold: true, color: DARK })],
            spacing: { before: 300, after: 100 }
          }),
          body('Shifokor KPI, bemor statistikasi, moliyaviy hisobot. Bir tugma bilan PDF/Excel eksport.'),

          new Paragraph({
            children: [new TextRun({ text: '🔄 B2B Referral — Klinikalararo yo\'llanma', font: 'Inter', size: 28, bold: true, color: DARK })],
            spacing: { before: 300, after: 100 }
          }),
          body('Split-to\'lov: 40% birinchi klinikaga, 20% ikkinchisiga, 2000 so\'m tizimga.'),
        ]
      },

      // ═══════ SECTION 4 ═══════
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          }
        },
        children: [
          subheading('04'),
          heading('Nega aynan Falcon AI OS?'),
          spacer(100),

          makeTable(
            ['Mezon', 'Boshqa CRM lar', 'Falcon AI OS ⭐', 'Qo\'lda ish'],
            [
              ['100% lokal', '❌ Cloud', '✅ Lokal', 'N/A'],
              ['Internet', 'Kerak', 'Kerak emas', 'Kerak emas'],
              ['Oylik to\'lov', '$50–500/oy', '$0/oy', 'Ish haqi'],
              ['Face ID', '❌', '✅', '❌'],
              ['AI Scribe', '❌', '✅', '❌'],
              ['AI Receptionist', '❌', '✅ (ovozli)', '❌'],
              ['O\'zbek tili', '❌', '✅', '✅'],
              ['O\'rnatish', '1–4 hafta', '1 kun', '0'],
            ],
            [20, 25, 30, 25]
          ),
          spacer(200),

          highlightBox('Yillik tejam: ~$9,600 — bir klinika uchun. Oylik $1,000 (qo\'lda ish) → $200 (Falcon AI OS).'),
        ]
      },

      // ═══════ SECTION 5 ═══════
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          }
        },
        children: [
          subheading('05'),
          heading('Texnik talablar'),
          spacer(100),

          makeTable(
            ['Komponent', 'Minimal', 'Tavsiya qilingan'],
            [
              ['GPU', '8 GB VRAM', '12 GB VRAM (RTX 5070)'],
              ['RAM', '16 GB', '32 GB DDR5'],
              ['CPU', '4 yadro', '6+ yadro'],
              ['Disk', '256 GB SSD', '512 GB NVMe SSD'],
              ['OS', 'Windows 11 / Ubuntu 22', 'Windows 11 Pro'],
              ['Kameralar', '2 dona', '3 dona'],
            ],
            [30, 35, 35]
          ),
          spacer(200),

          body('Tarmoq talablari:', { bold: true }),
          body('• LAN: 100 Mbps+ (1 Gb tavsiya)'),
          body('• Wi-Fi: majburiy emas'),
          body('• Internet: faqat Telegram bot uchun (ixtiyoriy)'),
          body('• Kameralar: USB 3.0 portlar'),
        ]
      },

      // ═══════ SECTION 6 ═══════
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          }
        },
        children: [
          subheading('06'),
          heading('O\'rnatish va ishga tushirish rejasi'),
          spacer(100),

          body('1-kun: O\'rnatish', { bold: true }),
          makeTable(
            ['Vaqt', 'Ish'],
            [
              ['09:00', 'Server o\'rnatish (GPU drayver, CUDA)'],
              ['10:00', 'Falcon AI OS sozlash'],
              ['10:15', 'AI modellarni yuklash (20 daqiqa)'],
              ['11:00', 'Face ID xodimlarni ro\'yxatga olish'],
              ['11:30', 'Ombor ma\'lumotlarini kiritish'],
              ['13:30', 'Xodimlarni o\'qitish (2 soat)'],
              ['15:30', 'Sinov rejimi (real bemorlar)'],
              ['17:00', 'To\'liq ishga tushirish'],
            ],
            [25, 75]
          ),
          spacer(200),
          body('2–14 kun: Masofaviy kuzatuv, xatoliklarni tuzatish'),
          body('15-kun: Topshirish — hisobot, qo\'llanma, texnik hujjatlar'),
        ]
      },

      // ═══════ SECTION 7 ═══════
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          }
        },
        children: [
          subheading('07'),
          heading('Narxlar va to\'lov shartlari'),
          spacer(100),

          body('🏥 Boshlang\'ich — Kichik klinika (5–15 xodim)', { bold: true, size: 26 }),
          makeTable(
            ['Xizmat', 'Narx (USD)'],
            [
              ['Litsenziya (cheksiz muddat)', '$2,500'],
              ['O\'rnatish va sozlash', '$500'],
              ['O\'qitish (1 kun)', '$300'],
              ['1 yil texnik qo\'llab-quvvatlash', '$600/yl'],
              ['1-yil JAMI', '$3,900'],
              ['Keyingi yillar', '$600/yl'],
            ],
            [65, 35]
          ),
          spacer(200),

          body('🏥🏥 Standart — O\'rta klinika (15–50 xodim)', { bold: true, size: 26 }),
          makeTable(
            ['Xizmat', 'Narx (USD)'],
            [
              ['Litsenziya (cheksiz muddat)', '$4,500'],
              ['O\'rnatish va sozlash', '$700'],
              ['O\'qitish (2 kun)', '$500'],
              ['1 yil texnik qo\'llab-quvvatlash (24/7)', '$1,000/yl'],
              ['1-yil JAMI', '$6,700'],
              ['Keyingi yillar', '$1,000/yl'],
            ],
            [65, 35]
          ),
          spacer(200),

          body('🏢 Korporativ — Klinikalar tarmog\'i (50+ xodim)', { bold: true, size: 26 }),
          makeTable(
            ['Xizmat', 'Narx (USD)'],
            [
              ['Litsenziya (cheksiz muddat)', '$9,000'],
              ['Har bir filialga o\'rnatish', '$500/filial'],
              ['O\'qitish', '$300/filial'],
              ['1 yil prioritet support', '$2,000/yl'],
              ['1-yil JAMI', '$12,000+'],
              ['Keyingi yillar', '$2,000/yl'],
            ],
            [65, 35]
          ),
          spacer(100),

          body('Server bilan birga (ixtiyoriy):', { bold: true }),
          body('• S-01: RTX 5070 + i5 + 32GB + 512GB = $2,500'),
          body('• S-02: RTX 5070 Ti + i7 + 64GB + 1TB = $3,800'),
          body('• S-03: Maxsus server (2×GPU, RAID, UPS) — kelishilgan'),
          spacer(200),

          body('To\'lov shartlari:', { bold: true }),
          body('• 30% — Shartnoma imzolanganda'),
          body('• 50% — O\'rnatish tugagach (1-kun)'),
          body('• 20% — Qabul qilinganda (15-kun)'),
          body('So\'m ekvivalentida to\'lash mumkin (USD kursi bo\'yicha).'),
        ]
      },

      // ═══════ SECTION 8 ═══════
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          }
        },
        children: [
          subheading('08'),
          heading('Kafolat va qo\'llab-quvvatlash'),
          spacer(100),

          makeTable(
            ['Komponent', 'Muddat'],
            [
              ['Dasturiy ta\'minot', '12 oy (bepul yangilanishlar)'],
              ['Server (biz yetkazgan bo\'lsak)', '24 oy'],
              ['Kameralar', '12 oy'],
            ],
            [55, 45]
          ),
          spacer(200),

          body('Texnik qo\'llab-quvvatlash:', { bold: true }),
          makeTable(
            ['Kanal', 'Javob vaqti', 'Vaqt'],
            [
              ['📞 Telefon', '30 daqiqa', '09:00–18:00'],
              ['📱 Telegram', '15 daqiqa', '09:00–22:00'],
              ['📧 Email', '2 soat', 'Ish vaqti'],
              ['🆘 Favqulodda', '10 daqiqa', '24/7'],
            ],
            [30, 30, 40]
          ),
          spacer(200),

          body('Yangilanishlar:', { bold: true }),
          body('• Kritik xavfsizlik patch\'lari — 24 soat ichida'),
          body('• Kichik yangilanishlar (bug fix) — har 2 hafta'),
          body('• Katta yangilanishlar (yangi funksiya) — har 3 oy'),
          body('• Backup — avtomatik, kunlik'),
        ]
      },

      // ═══════ SECTION 9 + FOOTER ═══════
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          }
        },
        children: [
          subheading('09'),
          heading('Biz bilan bog\'lanish'),
          spacer(100),

          makeTable(
            ['Kanal', 'Ma\'lumot'],
            [
              ['📱 Telegram', '@falconai_uz'],
              ['📞 Telefon', '+998 XX XXX XX XX'],
              ['📧 Email', 'falcon@ai-clinic.uz'],
              ['🌐 Veb-sayt', 'tayyorlanmoqda'],
            ],
            [30, 70]
          ),
          spacer(400),

          new Paragraph({
            children: [new TextRun({
              text: 'Falcon AI OS — klinikangizni AI bilan quvvatlang. 100% lokal, maxfiy, tez.',
              font: 'Inter', size: 20, color: GRAY, italics: true
            })],
            alignment: AlignmentType.CENTER,
          }),
          spacer(100),
          new Paragraph({
            children: [new TextRun({
              text: 'Ushbu taklif 30 kun davomida amal qiladi. Narxlar oldindan ogohlantirilmasdan o\'zgarishi mumkin.',
              font: 'Inter', size: 16, color: GRAY
            })],
            alignment: AlignmentType.CENTER,
          }),
        ]
      },
    ],
  });

  // DOCX
  const altPath = path.join(ROOT, 'falcon-ai-os-tijorat-taklifi.docx');
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(altPath, buffer);
  console.log(`✅ DOCX: ${altPath}`);
  return altPath;
}

// ─── PDF via Edge Headless ──────────────────────────
function generatePdf(htmlPath) {
  const pdfPath = path.join(ROOT, 'falcon-ai-os-tijorat-taklifi.pdf');
  
  // Windows'da Edge borligini tekshirish
  const edgePaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    // PATH dagi msedge
  ];

  let edgePath = null;
  for (const p of edgePaths) {
    if (fs.existsSync(p)) { edgePath = p; break; }
  }
  if (!edgePath) {
    try {
      execSync('where msedge', { stdio: 'pipe' });
      edgePath = 'msedge';
    } catch {
      // Chrome ham yo'qligini tekshirish
      try {
        execSync('where chrome', { stdio: 'pipe' });
        edgePath = 'chrome';
      } catch {
        return null; // PDF generatsiya qilib bo'lmadi
      }
    }
  }

  try {
    execSync(
      `"${edgePath}" --headless --disable-gpu --print-to-pdf="${pdfPath}" --no-margins "file:///${htmlPath.replace(/\\/g, '/')}"`,
      { timeout: 30000, stdio: 'pipe' }
    );
    console.log(`✅ PDF: ${pdfPath}`);
    return pdfPath;
  } catch (e) {
    console.error('PDF xatolik:', e.message);
    return null;
  }
}

// ─── MAIN ───────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  Falcon AI OS — Proposal Generator');
  console.log('═══════════════════════════════════════════\n');

  // 1. DOCX
  console.log('[1/2] DOCX generatsiya qilinmoqda...');
  const docxPath = await buildDocx();

  // 2. PDF
  console.log('[2/2] PDF generatsiya qilinmoqda...');
  const htmlPath = path.join(ROOT, 'proposal.html');
  const pdfPath = generatePdf(htmlPath);

  if (!pdfPath) {
    console.log('⚠ PDF ni brauzerda ochib, Ctrl+P → Save as PDF qiling:');
    console.log(`  file:///${htmlPath.replace(/\\/g, '/')}`);
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('✅ Tayyor!');
  console.log(`  📄 HTML:  ${htmlPath}`);
  console.log(`  📄 DOCX:  ${docxPath}`);
  if (pdfPath) console.log(`  📄 PDF:   ${pdfPath}`);
  console.log('═══════════════════════════════════════════');
}

main().catch(console.error);
