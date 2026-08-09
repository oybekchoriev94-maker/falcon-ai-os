/**
 * Xizmat nomlarini o'zbek tiliga (lotin) o'tkazish.
 *
 * Muammo: services_catalog dagi nomlar aralash edi — bir qismi ruscha
 * ("Билирубин общий", "Ударно-волновая терапия"), bir qismi o'zbekcha
 * kirill ("Рентген: бел умуртқаси"). Kioskda bemor o'z tilida o'qiy
 * olmasdi.
 *
 * Yondashuv: eski nom bo'yicha aniq moslik (exact match) bilan
 * yangilanadi. Bu migratsiyani qayta ishga tushirish xavfsiz —
 * allaqachon o'zgargan qator ikkinchi marta topilmaydi.
 *
 * Tibbiy qisqartmalar (ALT, AST, hCG, IgG, PSA, CA 125) xalqaro
 * standart, shuning uchun tarjima qilinmaydi — faqat kirilldan
 * lotinga o'giriladi va qavs ichidagi izoh o'zbekchalashtiriladi.
 */

const RENAMES = [
  // ── Diagnostika ──
  ['ЭКГ', 'EKG (elektrokardiogramma)'],

  // ── Fizioterapiya ──
  ['Парафинотерапия', 'Parafinoterapiya'],
  ['УЗД терапия', 'Ultratovushli (UZD) terapiya'],
  ['Ударно-волновая терапия', "Zarbli-to'lqinli terapiya"],
  ['Электрофорез', 'Elektroforez'],

  // ── Laboratoriya (umumiy) ──
  ['Сийдикнинг умумий таҳлили', 'Siydikning umumiy tahlili'],
  ['Қон гуруҳи ва резус-фактор', 'Qon guruhi va rezus-faktor'],
  ['Қоннинг умумий таҳлили', 'Qonning umumiy tahlili'],

  // ── Laboratoriya · Bioximiya ──
  ['АЛТ (аланинаминотрансфераза)', 'ALT (alaninaminotransferaza)'],
  ['АСТ (аспартатаминотрансфераза)', 'AST (aspartataminotransferaza)'],
  ['Билирубин непрямой', 'Bilvosita bilirubin'],
  ['Билирубин общий', 'Umumiy bilirubin'],
  ['Билирубин прямой', "To'g'ridan-to'g'ri bilirubin"],
  ['Железо (Fe)', 'Temir (Fe)'],
  ['Калий (K)', 'Kaliy (K)'],
  ['Кальций (Ca)', 'Kalsiy (Ca)'],
  ['Креатинин', 'Kreatinin'],
  ['Мочевина', 'Karbamid (mochevina)'],
  ['Общий белок', 'Umumiy oqsil'],
  ['Сахар (глюкоза)', 'Qand (glyukoza)'],
  ['Холестерин', 'Xolesterin'],

  // ── Laboratoriya · Gormonlar ──
  ['Гонадотропин (hCG)', 'Gonadotropin (hCG)'],
  ['ЛГ / LH (лютеинизирующий)', 'LG / LH (lyuteinlovchi gormon)'],
  ['Прогестерон', 'Progesteron'],
  ['Пролактин (PRL)', 'Prolaktin (PRL)'],
  ['Тестостерон', 'Testosteron'],
  ['Тироксин общий (T4)', 'Umumiy tiroksin (T4)'],
  ['Трийодтиронин общий (T3)', 'Umumiy triyodtironin (T3)'],
  ['ФСГ / FSH (фолликулостимулирующий)', 'FSG / FSH (follikulstimullovchi gormon)'],
  ['Эстрадиол (E2)', 'Estradiol (E2)'],

  // ── Laboratoriya · Immunoferment ──
  ['RW (экспресс-тест)', 'RW — zaxm (ekspress-test)'],
  ['ВИЧ / ОИВ (экспресс-тест)', 'OIV / VICH (ekspress-test)'],
  ['Гепатит B HBsAg (экспресс-тест)', 'Gepatit B — HBsAg (ekspress-test)'],
  ['Гепатит C anti-HCV (экспресс-тест)', 'Gepatit C — anti-HCV (ekspress-test)'],

  // ── Laboratoriya · Koagulogramma ──
  ['АЧТВ (активированное частичное тромбопластиновое время)',
   'AChTV (aktivlashgan qisman tromboplastin vaqti)'],
  ['Время свёртываемости (ВСК)', 'Qon ivish vaqti (QIV)'],
  ['МНО (международное нормализованное отношение)',
   'MNO (xalqaro normallashgan nisbat)'],
  ['Протромбиновое время', 'Protrombin vaqti'],
  ['Протромбиновый индекс', 'Protrombin indeksi'],
  ['Тромбиновое время (ТТ)', 'Trombin vaqti (TV)'],
  ['Фибриноген', 'Fibrinogen'],

  // ── Laboratoriya · Onkomarker ──
  ['SCC (маркер рака шейки матки)', "SCC (bachadon bo'yni saratoni markeri)"],
  ['Белок HE4 (маркер рака яичника)', 'HE4 oqsili (tuxumdon saratoni markeri)'],
  ['ПСА общий (простат-специфический антиген)',
   'Umumiy PSA (prostata-spetsifik antigen)'],
  ['РЭА / CEA (онкомаркер внутренних органов)',
   "REA / CEA (ichki a'zolar onkomarkeri)"],
  ['СА 125 (онкомаркер яичников)', 'CA 125 (tuxumdon onkomarkeri)'],
  ['СА 15-3 (онкомаркер молочной железы)', 'CA 15-3 (sut bezi onkomarkeri)'],

  // ── Laboratoriya · Revmaproba ──
  ['Антистрептолизин О', 'Antistreptolizin O (ASL-O)'],
  ['Ревматоидный фактор', 'Revmatoid faktor (RF)'],

  // ── Laboratoriya · TORCH ──
  ['Герпес 1-2 IgG', 'Gerpes 1-2 IgG'],
  ['Рубелла IgG', 'Qizilcha (rubella) IgG'],
  ['Токсоплазма IgG', 'Toksoplazma IgG'],
  ['Уреаплазма IgG', 'Ureaplazma IgG'],
  ['Хламидия IgG', 'Xlamidiya IgG'],
  ['Цитомегаловирус IgG', 'Sitomegalovirus IgG'],

  // ── Rentgen (kirill -> lotin) ──
  ['Рентген: бел умуртқаси', 'Rentgen: bel umurtqasi'],
  ['Рентген: болдир суяги', 'Rentgen: boldir suyagi'],
  ['Рентген: бош', 'Rentgen: bosh'],
  ['Рентген: бурун бўшлиғи', "Rentgen: burun bo'shlig'i"],
  ['Рентген: бўйин умуртқаси', "Rentgen: bo'yin umurtqasi"],
  ['Рентген: елка бўғими', "Rentgen: yelka bo'g'imi"],
  ['Рентген: кафт суяклари', 'Rentgen: kaft suyaklari'],
  ['Рентген: кўкрак қафаси', "Rentgen: ko'krak qafasi"],
  ['Рентген: ошиқ-болдир бўғими', "Rentgen: oshiq-boldir bo'g'imi"],
  ['Рентген: оёқ кафти', 'Rentgen: oyoq kafti'],
  ['Рентген: сон-чаноқ бўғими', "Rentgen: son-chanoq bo'g'imi"],
  ['Рентген: тизза бўғими', "Rentgen: tizza bo'g'imi"],
  ['Рентген: тирсак', 'Rentgen: tirsak'],
  ['Рентген: ўмров суяги', "Rentgen: o'mrov suyagi"],
  ['Рентген: қорин бўшлиғи', "Rentgen: qorin bo'shlig'i"],

  // ── Rentgen · Kontrastli ──
  ['Антеградная рентгенография', 'Anterograd rentgenografiya'],
  ['Гистеросальпингография', 'Gisterosalpingografiya'],
  ['Контрастная урография', 'Kontrastli urografiya'],
  ['Микционная урография', 'Miksion urografiya'],
  ['Фистулография', 'Fistulografiya'],

  // ── UZI ──
  ['UZI 1 орган', "UZI: 1 a'zo"],
  ['UZI Беременность', 'UZI: homiladorlik'],
  ['UZI Беременность (двойня)', 'UZI: homiladorlik (egizak)'],
  ['UZI Беременность (тройня)', 'UZI: homiladorlik (uchtalik)'],
  ['UZI Беременность + доплер', 'UZI: homiladorlik + dopler'],
  ['UZI Брюшная полость', "UZI: qorin bo'shlig'i"],
  ['UZI Малый таз', 'UZI: kichik chanoq'],
  ['UZI Молочная железа', 'UZI: sut bezi'],
  ['UZI Простата', 'UZI: prostata'],
  ['UZI Фолликулометрия', 'UZI: follikulometriya'],
  ['UZI Щитовидная железа', 'UZI: qalqonsimon bez'],

  // ── Qabul ──
  ['Urolog Qabuli', 'Urolog qabuli'],
];

export async function up(knex) {
  for (const [from, to] of RENAMES) {
    await knex('services_catalog').where({ name: from }).update({ name: to });
  }

  // "Urolog qabuli" kategoriyasiz qolgan edi — kioskda kategoriya bo'yicha
  // guruhlanganda "boshqa"ga tushib ketardi.
  await knex('services_catalog')
    .where({ name: 'Urolog qabuli' })
    .whereNull('category')
    .update({ category: 'Shifokor qabuli' });
}

export async function down(knex) {
  for (const [from, to] of RENAMES) {
    await knex('services_catalog').where({ name: to }).update({ name: from });
  }
  await knex('services_catalog')
    .where({ name: 'Urolog Qabuli', category: 'Shifokor qabuli' })
    .update({ category: null });
}
