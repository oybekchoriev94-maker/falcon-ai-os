// Kiosk matnlari — o'zbek (asosiy) va rus.
// Bemor o'zi o'qiydi, shuning uchun qisqa va aniq gaplar.

/**
 * Bir tilning matnlar to'plami. `as const` ATAYLAB ishlatilmagan:
 * aks holda har bir satr o'z literal turiga aylanib, ruscha to'plam
 * o'zbekchaga mos kelmay qoladi.
 */
export interface KioskT {
  idleKicker: string; idleStart: string; touch: string; idleTag: string; idleHours: string;

  welcome: string;
  tBook: string; tBookDesc: string;
  tPrices: string; tPricesDesc: string;
  tDoctors: string; tDoctorsDesc: string;
  tQueue: string; tQueueDesc: string;
  tCheckin: string; tCheckinDesc: string;

  step1: string; step2: string; step3: string; step4: string; step5: string;
  stService: string; stDoctor: string; stTime: string; stData: string; stConfirm: string;

  category: string; allServices: string;
  chooseService: string; chooseDoctor: string; chooseTime: string;
  yourData: string; checkData: string;
  service: string; doctor: string;
  noDoctors: string; noSlots: string;
  freeCount: (n: number) => string;
  todayBooked: (n: number) => string;

  fName: string; fNamePh: string; fPhone: string; fPhonePh: string;
  required: string; payment: string;
  payCash: string; payCashHint: string;
  payQr: string; payQrHint: string;
  qrScan: string; qrFallback: string;
  space: string; clear: string; kbHint: string;

  cardFound: string; isThisYou: string; yesItsMe: string; no: string;
  notMe: string; willAddToCard: string; searching: string;

  tInpatient: string; tInpatientDesc: string;
  wardFree: (n: number) => string; wardFull: string;
  inpatientTitle: string; inpatientNote: string;
  inpatientSend: string; inpatientDone: string; inpatientDoneNote: string;
  inpatientNoWards: string; anyWard: string;

  cart: string; addMore: string; addMoreHint: string; finish: string;
  visitN: (n: number) => string; removeVisit: string;
  maxVisits: string;

  total: string; payNote: string; payNoteQr: string; confirmNote: string;
  ticketDone: string; ticketTitle: string; ticketNo: string;
  ticketNote: string; qrNote: string; qrPay: string;

  walkinTitle: string; walkinDesc: string;
  waiting: string; inRoom: string; queueEmpty: string;
  waitApprox: (n: number) => string;

  checkinTitle: string; checkinDesc: string; checkinCodeLabel: string;
  checkinBackspace: string; checkinSubmit: string;
  checkinDoneTitle: string; checkinAlreadyTitle: string;
  checkinDoneNote: (doctor: string) => string;

  back: string; home: string; next: string; confirmBtn: string;
  newBooking: string; print: string;
  fillFields: string; pickOne: string; loading: string; errGeneric: string;
}

export const KIOSK_TEXT: Record<"uz" | "ru", KioskT> = {
  uz: {
    // Ekran-saver
    idleKicker: "Termiz · Surxondaryo",
    idleStart: "Boshlash uchun",
    touch: "EKRANGA TEGING",
    idleTag: "Sog'ligingiz — bizning ishimiz",
    idleHours: "Har kuni 08:00 — 18:00",

    // Bosh sahifa
    welcome: "Xush kelibsiz",
    tBook: "Qabulga yozilish",
    tBookDesc: "Xizmat, shifokor va vaqtni o'zingiz tanlang",
    tPrices: "Narxlar",
    tPricesDesc: "Barcha xizmatlar va ularning narxi",
    tDoctors: "Shifokorlar",
    tDoctorsDesc: "Mutaxassislar va qabul vaqtlari",
    tQueue: "Jonli navbat",
    tQueueDesc: "Bugungi navbat holati",
    tCheckin: "Men keldim",
    tCheckinDesc: "Oldindan yozilgan bo'lsangiz shu yerda tasdiqlang",

    // Bron qadamlari
    step1: "1-qadam",
    step2: "2-qadam",
    step3: "3-qadam",
    step4: "4-qadam",
    step5: "5-qadam",
    stService: "Xizmat",
    stDoctor: "Shifokor",
    stTime: "Vaqt",
    stData: "Ma'lumot",
    stConfirm: "Tasdiqlash",

    category: "Yo'nalish",
    allServices: "Barcha xizmatlar",
    chooseService: "Xizmatni tanlang",
    chooseDoctor: "Shifokorni tanlang",
    chooseTime: "Vaqtni tanlang",
    yourData: "Ma'lumotlaringiz",
    checkData: "Ma'lumotlarni tekshiring",
    service: "Xizmat",
    doctor: "Shifokor",
    noDoctors: "Bu xizmat uchun shifokor topilmadi",
    noSlots: "Bu kunga bo'sh vaqt qolmagan",
    freeCount: (n: number) => `${n} ta bo'sh vaqt`,
    todayBooked: (n: number) => `Bugun ${n} ta qabul`,

    // Forma
    fName: "Ism, familiya",
    fNamePh: "Aliyev Vali",
    fPhone: "Telefon",
    fPhonePh: "90 123 45 67",
    required: "majburiy",
    payment: "To'lov turi",
    payCash: "Naqd (kassada)",
    payCashHint: "Kassaga kod bilan boring",
    payQr: "QR orqali",
    payQrHint: "Telefondan skanerlab to'lang",
    qrScan: "Telefon kamerasi bilan skanerlang",
    qrFallback: "QR tayyorlanmadi — kassada to'lashingiz mumkin",
    space: "Bo'sh joy",
    clear: "Tozalash",
    kbHint: "Maydonni tanlang",

    // Karta topildi
    cardFound: "Kartangiz topildi",
    isThisYou: "Bu sizmisiz?",
    yesItsMe: "Ha, bu men",
    no: "Yo'q",
    notMe: "Bu men emasman",
    willAddToCard: "Tashrif shu kartangizga qo'shiladi",
    searching: "Karta izlanmoqda...",

    // Yakun
    tInpatient: "Yotib davolanish",
    tInpatientDesc: "Statsionarga joy so'rash",
    wardFree: (n: number) => `${n} ta bo'sh joy`,
    wardFull: "Bo'sh joy yo'q",
    inpatientTitle: "Statsionarga joy so'rash",
    inpatientNote:
      "Qaysi palataga yotqizish shifokor qaroriga bog'liq. Siz faqat so'rov qoldirasiz — registratura siz bilan bog'lanadi.",
    inpatientSend: "So'rov yuborish",
    inpatientDone: "So'rovingiz qabul qilindi",
    inpatientDoneNote: "Registraturaga o'ting — hujjatlar rasmiylashtiriladi va palata tayinlanadi.",
    inpatientNoWards: "Hozircha statsionar ma'lumoti yo'q",
    anyWard: "Farqi yo'q",

    cart: "Tanlangan tashriflar",
    addMore: "Yana shifokor qo'shish",
    addMoreHint: "Bir kelishda bir nechta shifokorga yozilishingiz mumkin",
    finish: "Yakunlash",
    visitN: (n: number) => `${n}-tashrif`,
    removeVisit: "O'chirish",
    maxVisits: "Bir kelishda ko'pi bilan 6 ta tashrif",

    total: "Jami to'lov",
    payNote: "To'lovni kassada amalga oshirasiz.",
    payNoteQr: "Tasdiqlagach QR kod chiqadi — telefoningiz bilan skanerlang.",
    confirmNote: "Tasdiqlagach sizga navbat raqami beriladi.",
    ticketDone: "Qabul qilindi",
    ticketTitle: "Navbatingiz rasmiylashtirildi",
    ticketNo: "Navbat kodi",
    ticketNote: "Kassaga o'tib to'lovni amalga oshiring, so'ng shifokor xonasi oldida kuting.",
    qrNote: "Kassada shu kodni ko'rsating",
    qrPay: "To'lov uchun QR",

    // Navbat
    walkinTitle: "Bugungi navbat",
    walkinDesc: "Kassada to'lovi tasdiqlangan bemorlar",
    waiting: "kutmoqda",
    inRoom: "qabulda",
    queueEmpty: "Hozircha navbatda bemor yo'q",
    waitApprox: (n: number) => (n <= 0 ? "navbat sizniki" : `~${n} daqiqa kutish`),

    // Men keldim
    checkinTitle: "Kelganingizni tasdiqlang",
    checkinDesc: "Yozilganda bergan kirish kodini kiriting",
    checkinCodeLabel: "Kirish kodi",
    checkinBackspace: "O'chirish",
    checkinSubmit: "Tasdiqlash",
    checkinDoneTitle: "Xush kelibsiz!",
    checkinAlreadyTitle: "Siz allaqachon kelganingizni belgilagansiz",
    checkinDoneNote: (doctor: string) => `Siz ${doctor} navbatiga qo'shildingiz. Kutish zalida o'tiring.`,

    // Chrome
    back: "Orqaga",
    home: "Bosh sahifa",
    next: "Davom etish",
    confirmBtn: "Tasdiqlash",
    newBooking: "Yangi yozilish",
    print: "Chop etish",
    fillFields: "Ism va telefonni to'ldiring",
    pickOne: "Birini tanlang",
    loading: "Yuklanmoqda...",
    errGeneric: "Xatolik yuz berdi. Registraturaga murojaat qiling.",
  },

  ru: {
    idleKicker: "Термез · Сурхандарья",
    idleStart: "Чтобы начать",
    touch: "КОСНИТЕСЬ ЭКРАНА",
    idleTag: "Ваше здоровье — наша работа",
    idleHours: "Ежедневно 08:00 — 18:00",

    welcome: "Добро пожаловать",
    tBook: "Запись на приём",
    tBookDesc: "Выберите услугу, врача и время",
    tPrices: "Цены",
    tPricesDesc: "Все услуги и их стоимость",
    tDoctors: "Врачи",
    tDoctorsDesc: "Специалисты и часы приёма",
    tQueue: "Живая очередь",
    tQueueDesc: "Состояние очереди на сегодня",
    tCheckin: "Я пришёл",
    tCheckinDesc: "Если вы уже записаны — подтвердите здесь",

    step1: "Шаг 1",
    step2: "Шаг 2",
    step3: "Шаг 3",
    step4: "Шаг 4",
    step5: "Шаг 5",
    stService: "Услуга",
    stDoctor: "Врач",
    stTime: "Время",
    stData: "Данные",
    stConfirm: "Подтверждение",

    category: "Направление",
    allServices: "Все услуги",
    chooseService: "Выберите услугу",
    chooseDoctor: "Выберите врача",
    chooseTime: "Выберите время",
    yourData: "Ваши данные",
    checkData: "Проверьте данные",
    service: "Услуга",
    doctor: "Врач",
    noDoctors: "Для этой услуги врач не найден",
    noSlots: "На этот день свободного времени нет",
    freeCount: (n: number) => `${n} свободных`,
    todayBooked: (n: number) => `Сегодня ${n} приёмов`,

    fName: "Имя, фамилия",
    fNamePh: "Алиев Вали",
    fPhone: "Телефон",
    fPhonePh: "90 123 45 67",
    required: "обязательно",
    payment: "Способ оплаты",
    payCash: "Наличные (касса)",
    payCashHint: "Подойдите в кассу с кодом",
    payQr: "По QR-коду",
    payQrHint: "Отсканируйте телефоном",
    qrScan: "Отсканируйте камерой телефона",
    qrFallback: "QR не создан — можно оплатить в кассе",
    space: "Пробел",
    clear: "Очистить",
    kbHint: "Выберите поле",

    cardFound: "Ваша карта найдена",
    isThisYou: "Это вы?",
    yesItsMe: "Да, это я",
    no: "Нет",
    notMe: "Это не я",
    willAddToCard: "Визит добавится в вашу карту",
    searching: "Поиск карты...",

    tInpatient: "Стационар",
    tInpatientDesc: "Запросить место в стационаре",
    wardFree: (n: number) => `${n} свободных мест`,
    wardFull: "Свободных мест нет",
    inpatientTitle: "Запрос места в стационаре",
    inpatientNote:
      "Палату определяет врач. Вы оставляете только запрос — регистратура свяжется с вами.",
    inpatientSend: "Отправить запрос",
    inpatientDone: "Запрос принят",
    inpatientDoneNote: "Пройдите в регистратуру — оформят документы и назначат палату.",
    inpatientNoWards: "Пока нет данных о стационаре",
    anyWard: "Не важно",

    cart: "Выбранные визиты",
    addMore: "Добавить ещё врача",
    addMoreHint: "За один визит можно записаться к нескольким врачам",
    finish: "Завершить",
    visitN: (n: number) => `Визит ${n}`,
    removeVisit: "Удалить",
    maxVisits: "Не более 6 визитов за раз",

    total: "Итого",
    payNote: "Оплата производится в кассе.",
    payNoteQr: "После подтверждения появится QR-код — отсканируйте телефоном.",
    confirmNote: "После подтверждения вы получите номер очереди.",
    ticketDone: "Принято",
    ticketTitle: "Ваша запись оформлена",
    ticketNo: "Код очереди",
    ticketNote: "Пройдите в кассу для оплаты, затем ожидайте у кабинета врача.",
    qrNote: "Назовите этот код в кассе",
    qrPay: "QR для оплаты",

    walkinTitle: "Очередь на сегодня",
    walkinDesc: "Пациенты с подтверждённой оплатой",
    waiting: "ожидает",
    inRoom: "на приёме",
    queueEmpty: "Пока нет пациентов в очереди",
    waitApprox: (n: number) => (n <= 0 ? "ваша очередь" : `~${n} мин. ожидания`),

    checkinTitle: "Подтвердите прибытие",
    checkinDesc: "Введите код, полученный при записи",
    checkinCodeLabel: "Код входа",
    checkinBackspace: "Стереть",
    checkinSubmit: "Подтвердить",
    checkinDoneTitle: "Добро пожаловать!",
    checkinAlreadyTitle: "Вы уже подтвердили прибытие",
    checkinDoneNote: (doctor: string) => `Вы добавлены в очередь к ${doctor}. Ожидайте в зале.`,

    back: "Назад",
    home: "Главная",
    next: "Продолжить",
    confirmBtn: "Подтвердить",
    newBooking: "Новая запись",
    print: "Печать",
    fillFields: "Заполните имя и телефон",
    pickOne: "Выберите один",
    loading: "Загрузка...",
    errGeneric: "Произошла ошибка. Обратитесь в регистратуру.",
  },
};

export type KioskLang = keyof typeof KIOSK_TEXT;
