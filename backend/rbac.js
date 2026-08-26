// ============================================================
// Falcon AI OS — Markazlashtirilgan RBAC (ruxsatlar matritsasi)
//
// Muammo: 93 ta checkRole(...) chaqiruvi har joyda o'z rol ro'yxatini
// yozadi ('admin','ceo' yoki 'ceo','admin' — bir xil narsa ikki xil
// tartibda). Yangi rol qo'shish yoki siyosatni audit qilish uchun bitta
// markaziy nuqta kerak.
//
// Yechim: PERMISSIONS matritsasi — har bir amaliyot uchun ruxsat etilgan
// rollar to'plami. requirePermission(...) middleware yangi endpointlarda
// ishlatiladi; checkRole(...) eski endpointlarda o'zgarishsiz qoladi
// (ikkalasi bir xil req.user.role ga tayanadi).
//
// Qoidalar:
//   1. superadmin — platforma darajasi, barcha ruxsatlardan ustun.
//   2. AI agent hech qachon yakuniy qaror bermaydi (tashxis, retsept,
//      pul qaytarish, ombordan chiqarish) — bu yo'nalish roadmap PR #14.
//   3. Matritsani o'zgartirish = xavfsizlik siyosatini o'zgartirish:
//      faqat PR orqali, test bilan.
// ============================================================

export const ROLES = Object.freeze([
  'superadmin',   // platforma egasi (tenantlararo)
  'ceo',          // klinika egasi / direktor
  'admin',        // klinika administratori
  'doctor',       // shifokor
  'receptionist', // registrator
  'cashier',      // kassir
]);

// Har bir ruxsat — o'ziga xos amal (domain.action). Ro'yxatda yo'q rol
// bu amalga kira olmaydi.
export const PERMISSIONS = Object.freeze({
  // Bemorlar
  'patients.read':   ['ceo', 'admin', 'doctor', 'receptionist'],
  'patients.write':  ['ceo', 'admin', 'receptionist'],

  // Qabul va navbat
  'appointments.read':  ['ceo', 'admin', 'doctor', 'receptionist'],
  'appointments.write': ['ceo', 'admin', 'doctor', 'receptionist'],

  // Tibbiy ma'lumot (konsultatsiya, epikriz, retsept)
  'medical.read':  ['ceo', 'admin', 'doctor'],
  'medical.write': ['doctor', 'admin'],

  // Moliya: to'lov, qaytarish, hisobot
  'finance.read':  ['ceo', 'admin', 'cashier'],
  'finance.write': ['ceo', 'admin', 'cashier', 'receptionist'],

  // Ombor va dorixona
  'inventory.read':  ['ceo', 'admin'],
  'inventory.write': ['ceo', 'admin'],

  // Xodimlar: ko'rish vs yaratish/parol berish
  'staff.read':   ['ceo', 'admin', 'doctor', 'receptionist'],
  'staff.manage': ['ceo', 'admin'],

  // Xodim vazifalari: belgilash rahbarda, bajarib belgilash hamma xodimda
  'tasks.read':  ['ceo', 'admin', 'doctor', 'receptionist'],
  'tasks.write': ['ceo', 'admin', 'doctor', 'receptionist'],

  // Hujjat elektronlashtirish (PR #8): o'qish hamma klinik xodimda,
  // yuklash/tuzatish/tasdiqlash — shifokor, admin, rahbar, registratura
  'documents.read':  ['ceo', 'admin', 'doctor', 'receptionist'],
  'documents.write': ['ceo', 'admin', 'doctor', 'receptionist'],

  // Klinika sozlamalari
  'settings.manage': ['ceo', 'admin'],

  // Filial/klinika tuzilmasi (roadmap PR #4)
  'structure.manage': ['ceo', 'admin'],

  // Audit jurnali
  'audit.read': ['superadmin', 'ceo', 'admin'],

  // Platforma (tenantlararo) — faqat superadmin
  'platform.manage': ['superadmin'],
});

/**
 * Foydalanuvchi ruxsatga ega bo'lsa true qaytaradi.
 * superadmin uchun alohida tekshiruv kerak bo'lsa hasPermission o'zi yetadi.
 */
export function hasPermission(user, permission) {
  if (!user?.role) return false;
  if (user.role === 'superadmin') return true;
  const allowed = PERMISSIONS[permission];
  if (!allowed) return false;
  return allowed.includes(user.role);
}

/**
 * Express middleware: barcha berilgan ruxsatlar bo'lsa o'tkazadi.
 * 401 — token yo'q; 403 — roli yetarli emas.
 */
export function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Autentifikatsiya talab qilinadi' });
    const missing = permissions.filter((p) => !hasPermission(req.user, p));
    if (missing.length > 0) {
      return res.status(403).json({
        error: 'Ruxsat yetarli emas',
        missing_permissions: missing,
      });
    }
    next();
  };
}
