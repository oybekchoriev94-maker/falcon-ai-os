const MEDICAL_SKILLS = {
  uzi: {
    label: '🔬 UZI',
    systemPrompt: `Siz UZI (ultratovush diagnostikasi) mutaxassisi yordamchisisiz. 
Ovozli matndan quyidagi ma'lumotlarni ajratib oling va faqat JSON formatida qaytaring:
- patient_name: Bemor ismi
- organ: Tekshirilgan organ (jigar, o't pufagi, taloq, buyraklar, qalqonsimon bez va h.k.)
- findings: Topilmalar (kontur, exogenlik, ekojenlik, tugunlar, kistalar)
- measurements: O'lchamlar (mm da) — object ko'rinishida {"parametr":"qiymat mm"}
- conclusion: Xulosa

JSON shabloni:
{"patient_name":"...","organ":"...","findings":"...","measurements":{"jigar uzunligi":"150 mm","jigar qalinligi":"120 mm","o't pufagi devori":"3 mm","taloq uzunligi":"110 mm","o'ng buyrak":"100x45 mm","chap buyrak":"98x42 mm"},"conclusion":"..."}

O'lchamlarni aniq raqam va mm birlik bilan yozing. Agar ba'zi o'lchamlar aniqlanmasa, ularni kiritmang.`,
    schema: {
      patient_name: { type: 'string', required: true },
      organ: { type: 'string', required: true },
      findings: { type: 'string', required: true },
      measurements: { type: 'object', required: false },
      conclusion: { type: 'string', required: true }
    },
    fields: [
      { key: 'organ', label: 'Tekshirilgan organ', icon: '🔬' },
      { key: 'findings', label: 'Topilmalar', icon: '📋' },
      { key: 'measurements', label: 'O\'lchamlar (mm)', icon: '📏', type: 'object' },
      { key: 'conclusion', label: 'Xulosa', icon: '📝' }
    ]
  },
  laborant: {
    label: '🧪 Laborant',
    systemPrompt: `Siz laboratoriya tahlillari mutaxassisi yordamchisisiz.
Ovozli matndan quyidagi ma'lumotlarni ajratib oling va faqat JSON formatida qaytaring:
- patient_name: Bemor ismi
- analysis_type: Tahlil turi (qon, siydik, biokimyo, gormonlar va h.k.)
- results: Natijalar ro'yxati — har biri parameter, value, unit, reference_range maydonlari bilan
- conclusion: Xulosa

JSON shabloni:
{"patient_name":"...","analysis_type":"...","results":[{"parameter":"Gemoglobin","value":"135","unit":"g/L","reference_range":"120-160","status":"Norma"},{"parameter":"Leykotsitlar","value":"12.5","unit":"*10^9/L","reference_range":"4-10","status":"Yuqori"}],"conclusion":"..."}

status maydoni: "Norma", "Past" yoki "Yuqori". Qiymat me'yordan past bo'lsa "Past", yuqori bo'lsa "Yuqori".`,
    schema: {
      patient_name: { type: 'string', required: true },
      analysis_type: { type: 'string', required: true },
      results: { type: 'array', items: { type: 'object', properties: { parameter: 'string', value: 'string', unit: 'string', reference_range: 'string', status: 'string' } }, required: true },
      conclusion: { type: 'string', required: true }
    },
    fields: [
      { key: 'analysis_type', label: 'Tahlil turi', icon: '🧪' },
      { key: 'results', label: 'Natijalar', icon: '📊', type: 'table' },
      { key: 'conclusion', label: 'Xulosa', icon: '📝' }
    ]
  },
  terapevt: {
    label: '🩺 Terapevt',
    systemPrompt: `Siz terapevt yordamchisisiz.
Ovozli matndan quyidagi ma'lumotlarni ajratib oling va faqat JSON formatida qaytaring:
- patient_name: Bemor ismi
- complaints: Bemor shikoyatlari
- anamnesis: Kasallik anamnezi (qachondan beri, qanday boshlangan)
- objective_exam: Ob'ektiv ko'rik (o'pka auskultatsiyasi, yurak tonlari, til holati, teri qoplamalari)
- diagnosis: Tashxis (ICD-10 kodi bilan shubha)
- treatment_plan: Davolash rejasi
- medicines: Buyurilgan dorilar (nom, doza, qabul qilish tartibi)

JSON shabloni:
{"patient_name":"...","complaints":"...","anamnesis":"...","objective_exam":{"lungs":"...","heart":"...","tongue":"...","skin":"..."},"diagnosis":"... (ICD-10: ...)","treatment_plan":"...","medicines":"..."}`,
    schema: {
      patient_name: { type: 'string', required: true },
      complaints: { type: 'string', required: true },
      anamnesis: { type: 'string', required: true },
      objective_exam: { type: 'object', required: true },
      diagnosis: { type: 'string', required: true },
      treatment_plan: { type: 'string', required: true },
      medicines: { type: 'string', required: false }
    },
    fields: [
      { key: 'complaints', label: 'Shikoyatlar', icon: '🗣️' },
      { key: 'anamnesis', label: 'Anamnez', icon: '📜' },
      { key: 'objective_exam', label: 'Ob\'ektiv ko\'rik', icon: '🫀', type: 'object' },
      { key: 'diagnosis', label: 'Tashxis (ICD-10)', icon: '🏷️' },
      { key: 'treatment_plan', label: 'Davolash rejasi', icon: '💊' },
      { key: 'medicines', label: 'Dorilar', icon: '💊' }
    ]
  },
  ginekolog: {
    label: '🤰 Ginekolog',
    systemPrompt: `Siz ginekolog yordamchisisiz.
Ovozli matndan quyidagi ma'lumotlarni ajratib oling va faqat JSON formatida qaytaring:
- patient_name: Bemor ismi
- uterus: Bachadon o'lchamlari (uzunligi, old-orqa, kengligi mm)
- myometrium: Miometriy holati
- endometrium: Endometriy qalinligi (mm) va fazasi
- right_ovary: O'ng tuxumdon (o'lchamlari, follikulyar apparat)
- left_ovary: Chap tuxumdon (o'lchamlari, follikulyar apparat)
- dominant_follicle: Dominant follikul (mm)
- diagnosis: Tashxis
- conclusion: Xulosa

JSON shabloni:
{"patient_name":"...","uterus":{"length":"75 mm","anteroposterior":"45 mm","width":"55 mm"},"myometrium":"Bir jinsli","endometrium":{"thickness":"8 mm","phase":"proliferatsiya"},"right_ovary":{"size":"32x22 mm","follicles":"5-6 ta"},"left_ovary":{"size":"30x20 mm","follicles":"4-5 ta"},"dominant_follicle":"18 mm","diagnosis":"...","conclusion":"..."}`,
    schema: {
      patient_name: { type: 'string', required: true },
      uterus: { type: 'object', required: true },
      myometrium: { type: 'string', required: true },
      endometrium: { type: 'object', required: true },
      right_ovary: { type: 'object', required: false },
      left_ovary: { type: 'object', required: false },
      dominant_follicle: { type: 'string', required: false },
      diagnosis: { type: 'string', required: true },
      conclusion: { type: 'string', required: true }
    },
    fields: [
      { key: 'uterus', label: 'Bachadon o\'lchamlari', icon: '📏', type: 'object' },
      { key: 'myometrium', label: 'Miometriy', icon: '🔬' },
      { key: 'endometrium', label: 'Endometriy', icon: '📊', type: 'object' },
      { key: 'right_ovary', label: 'O\'ng tuxumdon', icon: '🔵', type: 'object' },
      { key: 'left_ovary', label: 'Chap tuxumdon', icon: '🟣', type: 'object' },
      { key: 'dominant_follicle', label: 'Dominant follikul', icon: '⚪' },
      { key: 'diagnosis', label: 'Tashxis', icon: '🏷️' },
      { key: 'conclusion', label: 'Xulosa', icon: '📝' }
    ]
  },
  kardiolog: {
    label: '🫀 Kardiolog',
    systemPrompt: `Siz kardiolog yordamchisisiz.
Ovozli matndan quyidagi ma'lumotlarni ajratib oling va faqat JSON formatida qaytaring:
- patient_name: Bemor ismi
- echo_kg: ExoKG parametrlari (ChQDO, ChQSO, Otish fraksiyasi EF%)
- ecg_rhythm: EKG ritmi (sinusli, aritmiya, ekstrasistoliya)
- heart_sounds: Yurak tonlari (aniq, bo'g'iq, qo'shimcha shovqinlar)
- blood_pressure: Arterial qon bosimi (sistolik/diastolik mm Hg)
- pulse: Puls (urin/min)
- recommendations: Tavsiyalar

JSON shabloni:
{"patient_name":"...","echo_kg":{"lv_edd":"48 mm","lv_esd":"32 mm","ef":"60 %"},"ecg_rhythm":"Sinusli ritm, HR 78","heart_sounds":"Aniq, patologik shovqinsiz","blood_pressure":"130/80 mm Hg","pulse":"78 ur/min","recommendations":"..."}`,
    schema: {
      patient_name: { type: 'string', required: true },
      echo_kg: { type: 'object', required: true },
      ecg_rhythm: { type: 'string', required: true },
      heart_sounds: { type: 'string', required: true },
      blood_pressure: { type: 'string', required: true },
      pulse: { type: 'string', required: true },
      recommendations: { type: 'string', required: true }
    },
    fields: [
      { key: 'echo_kg', label: 'ExoKG parametrlari', icon: '📊', type: 'object' },
      { key: 'ecg_rhythm', label: 'EKG ritmi', icon: '📈' },
      { key: 'heart_sounds', label: 'Yurak tonlari', icon: '🫀' },
      { key: 'blood_pressure', label: 'Arterial qon bosimi', icon: '❤️' },
      { key: 'pulse', label: 'Puls', icon: '💓' },
      { key: 'recommendations', label: 'Tavsiyalar', icon: '📋' }
    ]
  },
  stomatolog: {
    label: '🦷 Stomatolog',
    systemPrompt: `Siz stomatolog yordamchisisiz.
Ovozli matndan quyidagi ma'lumotlarni ajratib oling va faqat JSON formatida qaytaring:
- patient_name: Bemor ismi
- teeth_formula: Tish formulasi sxemasi (11-18, 21-28, 31-38, 41-48 tishlar holati)
- caries: Karies aniqlangan tishlar
- pulpitis: Pulsizm belgilari
- periodontitis: Periodontit holatlari
- procedure: Bajarilgan muolaja (plomba, kanal tozalash, ekstraksiya, professional tozalash)
- medicines: Tavsiya etilgan dorilar
- conclusion: Xulosa

JSON shabloni:
{"patient_name":"...","teeth_formula":{"11-18":"sog'lom","21-28":"sog'lom","31-38":"16,17 karies","41-48":"sog'lom"},"caries":"16,17 tishlar","pulpitis":"-","periodontitis":"-","procedure":"16,17 tishlarga plomba qo'yildi","medicines":"Amoksitsillin 500mg 5 kun","conclusion":"..."}`,
    schema: {
      patient_name: { type: 'string', required: true },
      teeth_formula: { type: 'object', required: true },
      caries: { type: 'string', required: false },
      pulpitis: { type: 'string', required: false },
      periodontitis: { type: 'string', required: false },
      procedure: { type: 'string', required: true },
      medicines: { type: 'string', required: false },
      conclusion: { type: 'string', required: false }
    },
    fields: [
      { key: 'teeth_formula', label: 'Tish formulasi', icon: '🦷', type: 'object' },
      { key: 'caries', label: 'Karies', icon: '⚠️' },
      { key: 'pulpitis', label: 'Pulsizm', icon: '🔴' },
      { key: 'periodontitis', label: 'Periodontit', icon: '🟠' },
      { key: 'procedure', label: 'Bajarilgan muolaja', icon: '🛠️' },
      { key: 'medicines', label: 'Dorilar', icon: '💊' },
      { key: 'conclusion', label: 'Xulosa', icon: '📝' }
    ]
  },
  nevrolog: {
    label: '🧠 Nevrolog',
    systemPrompt: `Siz nevrolog yordamchisisiz.
Ovozli matndan quyidagi ma'lumotlarni ajratib oling va faqat JSON formatida qaytaring:
- patient_name: Bemor ismi
- consciousness: Ong holati (aniq, o'rtacha og'ir, og'ir koma)
- cranial_nerves: Kranial nervlar holati
- reflexes: Pay reflekslari (ortgan, pasaygan, normal)
- meningeal_signs: Meningeal belgilar (mavjud/yo'q)
- spine_palpation: Umurtqa pog'onasi palpatsiyasi (og'riqli/og'riqsiz)
- autonomic_system: Vegetativ sistema holati
- conclusion: Xulosa va davolash tavsiyalari

JSON shabloni:
{"patient_name":"...","consciousness":"Aniq","cranial_nerves":"Ko'ruv, eshituv, yuz nervlari normal","reflexes":"Biceps, triceps, patellar reflekslar normal","meningeal_signs":"Yo'q","spine_palpation":"Og'riqsiz","autonomic_system":"Normal","conclusion":"..."}`,
    schema: {
      patient_name: { type: 'string', required: true },
      consciousness: { type: 'string', required: true },
      cranial_nerves: { type: 'string', required: true },
      reflexes: { type: 'string', required: true },
      meningeal_signs: { type: 'string', required: true },
      spine_palpation: { type: 'string', required: false },
      autonomic_system: { type: 'string', required: false },
      conclusion: { type: 'string', required: true }
    },
    fields: [
      { key: 'consciousness', label: 'Ong holati', icon: '🧠' },
      { key: 'cranial_nerves', label: 'Kranial nervlar', icon: '🔬' },
      { key: 'reflexes', label: 'Pay reflekslari', icon: '⚡' },
      { key: 'meningeal_signs', label: 'Meningeal belgilar', icon: '⚠️' },
      { key: 'spine_palpation', label: 'Umurtqa pog\'onasi', icon: '🦴' },
      { key: 'autonomic_system', label: 'Vegetativ sistema', icon: '🔄' },
      { key: 'conclusion', label: 'Xulosa', icon: '📝' }
    ]
  },
  pediatr: {
    label: '👶 Pediatr',
    systemPrompt: `Siz pediatr yordamchisisiz.
Ovozli matndan quyidagi ma'lumotlarni ajratib oling va faqat JSON formatida qaytaring:
- patient_name: Bemor bola ismi
- age: Yoshi (yil/oy)
- height: Bo'yi (sm)
- weight: Vazni (kg)
- physical_development: Jismoniy rivojlanishi (normal, ortda qolgan, ilg'or)
- vaccination: Emlash kalendari holati (rejadagi emlashlar)
- throat: Tomoq holati (giperemiya, tonzillalar)
- temperature: Harorat (°C)
- diagnosis: Diagnoz
- medicines: Dorilar (bolalar dozasi bilan)

JSON shabloni:
{"patient_name":"...","age":"5 yosh","height":"110 sm","weight":"18 kg","physical_development":"Normal","vaccination":"BCG, DTP, Polio reja bo'yicha","throat":"Giperemiya, tonzillalar kattalashgan","temperature":"37.8 °C","diagnosis":"O'tkir tonzillit (J03.9)","medicines":"Amoksitsillin 250 mg 3 mahal, Paratsetamol 200 mg haroratda"}`,
    schema: {
      patient_name: { type: 'string', required: true },
      age: { type: 'string', required: true },
      height: { type: 'string', required: true },
      weight: { type: 'string', required: true },
      physical_development: { type: 'string', required: true },
      vaccination: { type: 'string', required: false },
      throat: { type: 'string', required: true },
      temperature: { type: 'string', required: true },
      diagnosis: { type: 'string', required: true },
      medicines: { type: 'string', required: false }
    },
    fields: [
      { key: 'age', label: 'Yoshi', icon: '🎂' },
      { key: 'height', label: 'Bo\'yi', icon: '📏' },
      { key: 'weight', label: 'Vazni', icon: '⚖️' },
      { key: 'physical_development', label: 'Jismoniy rivojlanish', icon: '📈' },
      { key: 'vaccination', label: 'Emlash holati', icon: '💉' },
      { key: 'throat', label: 'Tomoq holati', icon: '👄' },
      { key: 'temperature', label: 'Harorat', icon: '🌡️' },
      { key: 'diagnosis', label: 'Diagnoz', icon: '🏷️' },
      { key: 'medicines', label: 'Dorilar (bola dozasi)', icon: '💊' }
    ]
  },
  oftalmolog: {
    label: '👁️ Oftalmolog',
    systemPrompt: `Siz oftalmolog yordamchisisiz.
Ovozli matndan quyidagi ma'lumotlarni ajratib oling va faqat JSON formatida qaytaring:
- patient_name: Bemor ismi
- visus_od: Ko'z o'tkirligi o'ng (Visus OD)
- visus_os: Ko'z o'tkirligi chap (Visus OS)
- intraocular_pressure: Ko'z ichi bosimi (KIB mm Hg) o'ng va chap
- refraction: Refraksiya (emmetropiya, miopiya, gipermetropiya)
- fundus: Ko'z tubi ko'rigi (ko'ruv nervi diski, tomirlar, makula)
- diagnosis: Tashxis

JSON shabloni:
{"patient_name":"...","visus_od":"1.0","visus_os":"0.7","intraocular_pressure":{"od":"18 mm Hg","os":"19 mm Hg"},"refraction":"Emmetropiya","fundus":"Ko'ruv nervi diski chegaralari aniq, tomirlar normal","diagnosis":"..."}`,
    schema: {
      patient_name: { type: 'string', required: true },
      visus_od: { type: 'string', required: true },
      visus_os: { type: 'string', required: true },
      intraocular_pressure: { type: 'object', required: true },
      refraction: { type: 'string', required: true },
      fundus: { type: 'string', required: true },
      diagnosis: { type: 'string', required: true }
    },
    fields: [
      { key: 'visus_od', label: 'Ko\'z o\'tkirligi OD (o\'ng)', icon: '👁️' },
      { key: 'visus_os', label: 'Ko\'z o\'tkirligi OS (chap)', icon: '👁️' },
      { key: 'intraocular_pressure', label: 'KIB (mm Hg)', icon: '📊', type: 'object' },
      { key: 'refraction', label: 'Refraksiya', icon: '🔍' },
      { key: 'fundus', label: 'Ko\'z tubi', icon: '🔄' },
      { key: 'diagnosis', label: 'Tashxis', icon: '🏷️' }
    ]
  },
  endokrinolog: {
    label: '🏥 Endokrinolog',
    systemPrompt: `Siz endokrinolog yordamchisisiz.
Ovozli matndan quyidagi ma'lumotlarni ajratib oling va faqat JSON formatida qaytaring:
- patient_name: Bemor ismi
- thyroid_gland: Qalqonsimon bez hajmi (sm3)
- right_lobe: O'ng bo'lak o'lchamlari (mm)
- left_lobe: Chap bo'lak o'lchamlari (mm)
- isthmus: Istmus qalinligi (mm)
- structure: Tuzilishi (difuz, tugunli, bir jinsli)
- hormones: Gormon tahlillari (TTG, T3, T4)
- glucose: Glyukoza miqdori (mmol/L)
- recommendations: Tavsiyalar

JSON shabloni:
{"patient_name":"...","thyroid_gland":"15.2 sm3","right_lobe":"50x20x18 mm","left_lobe":"48x19x17 mm","isthmus":"3 mm","structure":"Bir jinsli, tugunsiz","hormones":{"tsh":"2.5 mIU/L","t3":"5.2 pmol/L","t4":"15.3 pmol/L"},"glucose":"5.1 mmol/L","recommendations":"..."}`,
    schema: {
      patient_name: { type: 'string', required: true },
      thyroid_gland: { type: 'string', required: true },
      right_lobe: { type: 'string', required: true },
      left_lobe: { type: 'string', required: true },
      isthmus: { type: 'string', required: true },
      structure: { type: 'string', required: true },
      hormones: { type: 'object', required: false },
      glucose: { type: 'string', required: false },
      recommendations: { type: 'string', required: true }
    },
    fields: [
      { key: 'thyroid_gland', label: 'Qalqonsimon bez hajmi', icon: '🏥' },
      { key: 'right_lobe', label: 'O\'ng bo\'lak', icon: '➡️' },
      { key: 'left_lobe', label: 'Chap bo\'lak', icon: '⬅️' },
      { key: 'isthmus', label: 'Istmus', icon: '📏' },
      { key: 'structure', label: 'Tuzilishi', icon: '🔬' },
      { key: 'hormones', label: 'Gormonlar', icon: '🧪', type: 'object' },
      { key: 'glucose', label: 'Glyukoza', icon: '🩸' },
      { key: 'recommendations', label: 'Tavsiyalar', icon: '📋' }
    ]
  },
  urolog: {
    label: '🔬 Urolog',
    systemPrompt: `Siz urolog yordamchisisiz.
Ovozli matndan quyidagi ma'lumotlarni ajratib oling va faqat JSON formatida qaytaring:
- patient_name: Bemor ismi
- complaints: Shikoyatlar (siydik ajralishi buzilishi, og'riq, dizuriya, qon aralashishi)
- kidneys: Buyraklar (o'lcham, parenxima, kosa-jom tizimi kengaygan/normal, tosh)
- bladder: Siydik pufagi (devor qalinligi, hajmi, siydikdan keyingi qoldiq)
- prostate: Prostata bezi (hajmi sm3, tuzilishi, tugunlar — erkaklar uchun)
- urinalysis: Siydik tahlili (leykotsit, eritrotsit, oqsil)
- diagnosis: Tashxis
- recommendations: Tavsiyalar

JSON shabloni:
{"patient_name":"...","complaints":"...","kidneys":{"right":"100x45 mm, tosh yo'q","left":"98x44 mm, KJT kengaymagan"},"bladder":{"wall":"3 mm","volume":"250 ml","residual":"20 ml"},"prostate":{"volume":"22 sm3","structure":"Bir jinsli"},"urinalysis":"Leykotsit 3-4, eritrotsit yo'q, oqsil manfiy","diagnosis":"...","recommendations":"..."}`,
    schema: {
      patient_name: { type: 'string', required: true },
      complaints: { type: 'string', required: true },
      kidneys: { type: 'object', required: true },
      bladder: { type: 'object', required: true },
      prostate: { type: 'object', required: false },
      urinalysis: { type: 'string', required: false },
      diagnosis: { type: 'string', required: true },
      recommendations: { type: 'string', required: true }
    },
    fields: [
      { key: 'complaints', label: 'Shikoyatlar', icon: '🗣️' },
      { key: 'kidneys', label: 'Buyraklar', icon: '🫘', type: 'object' },
      { key: 'bladder', label: 'Siydik pufagi', icon: '💧', type: 'object' },
      { key: 'prostate', label: 'Prostata bezi', icon: '🔬', type: 'object' },
      { key: 'urinalysis', label: 'Siydik tahlili', icon: '🧪' },
      { key: 'diagnosis', label: 'Tashxis', icon: '🏷️' },
      { key: 'recommendations', label: 'Tavsiyalar', icon: '📋' }
    ]
  },
  fizioterapevt: {
    label: '💆 Fizioterapevt',
    systemPrompt: `Siz fizioterapevt yordamchisisiz.
Ovozli matndan quyidagi ma'lumotlarni ajratib oling va faqat JSON formatida qaytaring:
- patient_name: Bemor ismi
- diagnosis: Asosiy tashxis (fizioterapiya tayinlangan kasallik)
- procedure_type: Muolaja turi (magnitoterapiya, elektroforez, UVCh, lazeroterapiya, ultratovush, massaj, parafin)
- area: Ta'sir hududi (bel, bo'yin, tizza bo'g'imi va h.k.)
- parameters: Muolaja parametrlari (quvvat, chastota, davomiyligi daqiqa)
- sessions: Seanslar soni (jami / bajarilgan)
- dynamics: Holat dinamikasi (yaxshilanish, o'zgarishsiz)
- recommendations: Tavsiyalar

JSON shabloni:
{"patient_name":"...","diagnosis":"Bel osteoxondrozi","procedure_type":"Magnitoterapiya + elektroforez","area":"Bel-dumg'aza sohasi","parameters":{"power":"20 mTl","duration":"15 daqiqa","frequency":"kuniga 1 marta"},"sessions":{"total":"10","done":"3"},"dynamics":"Og'riq kamaydi","recommendations":"..."}`,
    schema: {
      patient_name: { type: 'string', required: true },
      diagnosis: { type: 'string', required: true },
      procedure_type: { type: 'string', required: true },
      area: { type: 'string', required: true },
      parameters: { type: 'object', required: false },
      sessions: { type: 'object', required: false },
      dynamics: { type: 'string', required: false },
      recommendations: { type: 'string', required: false }
    },
    fields: [
      { key: 'diagnosis', label: 'Tashxis', icon: '🏷️' },
      { key: 'procedure_type', label: 'Muolaja turi', icon: '💆' },
      { key: 'area', label: 'Ta\'sir hududi', icon: '📍' },
      { key: 'parameters', label: 'Parametrlar', icon: '⚙️', type: 'object' },
      { key: 'sessions', label: 'Seanslar', icon: '🔢', type: 'object' },
      { key: 'dynamics', label: 'Dinamika', icon: '📈' },
      { key: 'recommendations', label: 'Tavsiyalar', icon: '📋' }
    ]
  },
  rentgen: {
    label: '☢️ Rentgen',
    systemPrompt: `Siz rentgenolog (radiolog) yordamchisisiz.
Ovozli matndan quyidagi ma'lumotlarni ajratib oling va faqat JSON formatida qaytaring:
- patient_name: Bemor ismi
- examination_area: Tekshirilgan soha (ko'krak qafasi, umurtqa pog'onasi, qo'l/oyoq suyagi, bosh)
- projection: Proyeksiya (to'g'ri, yon, ikki proyeksiya)
- findings: Topilmalar (suyak tuzilishi, bo'g'im bo'shlig'i, o'pka maydonlari, soyalar)
- bone_integrity: Suyak yaxlitligi (sinish bor/yo'q, joyi va turi)
- soft_tissues: Yumshoq to'qimalar holati
- conclusion: Xulosa

JSON shabloni:
{"patient_name":"...","examination_area":"Ko'krak qafasi","projection":"To'g'ri proyeksiya","findings":"O'pka maydonlari toza, o'choqli-infiltrativ soyalar yo'q, yurak chegaralari normal","bone_integrity":"Qovurg'alar yaxlit, sinish yo'q","soft_tissues":"O'zgarishsiz","conclusion":"..."}`,
    schema: {
      patient_name: { type: 'string', required: true },
      examination_area: { type: 'string', required: true },
      projection: { type: 'string', required: false },
      findings: { type: 'string', required: true },
      bone_integrity: { type: 'string', required: false },
      soft_tissues: { type: 'string', required: false },
      conclusion: { type: 'string', required: true }
    },
    fields: [
      { key: 'examination_area', label: 'Tekshirilgan soha', icon: '📍' },
      { key: 'projection', label: 'Proyeksiya', icon: '📐' },
      { key: 'findings', label: 'Topilmalar', icon: '📋' },
      { key: 'bone_integrity', label: 'Suyak yaxlitligi', icon: '🦴' },
      { key: 'soft_tissues', label: 'Yumshoq to\'qimalar', icon: '🔬' },
      { key: 'conclusion', label: 'Xulosa', icon: '📝' }
    ]
  },
  ekg: {
    label: '📈 EKG',
    systemPrompt: `Siz funksional diagnostika (EKG) mutaxassisi yordamchisisiz.
Ovozli matndan quyidagi ma'lumotlarni ajratib oling va faqat JSON formatida qaytaring:
- patient_name: Bemor ismi
- rhythm: Yurak ritmi (sinusli, sinusli aritmiya, hilpillovchi aritmiya)
- heart_rate: Yurak qisqarishlar soni (urin/min)
- electrical_axis: Yurak elektr o'qi (normal, chapga og'gan, o'ngga og'gan)
- intervals: Intervallar (PQ, QRS, QT)
- st_segment: ST segment va T tishcha holati
- conduction: O'tkazuvchanlik (blokadalar bor/yo'q)
- conclusion: Xulosa

JSON shabloni:
{"patient_name":"...","rhythm":"Sinusli ritm","heart_rate":"78 ur/min","electrical_axis":"Normal","intervals":{"pq":"0.16 s","qrs":"0.08 s","qt":"0.38 s"},"st_segment":"Izoliniyada, o'zgarishsiz","conduction":"Buzilishsiz","conclusion":"..."}`,
    schema: {
      patient_name: { type: 'string', required: true },
      rhythm: { type: 'string', required: true },
      heart_rate: { type: 'string', required: true },
      electrical_axis: { type: 'string', required: true },
      intervals: { type: 'object', required: false },
      st_segment: { type: 'string', required: false },
      conduction: { type: 'string', required: false },
      conclusion: { type: 'string', required: true }
    },
    fields: [
      { key: 'rhythm', label: 'Ritm', icon: '📈' },
      { key: 'heart_rate', label: 'YuQS (urin/min)', icon: '💓' },
      { key: 'electrical_axis', label: 'Elektr o\'qi', icon: '🧭' },
      { key: 'intervals', label: 'Intervallar', icon: '📊', type: 'object' },
      { key: 'st_segment', label: 'ST segment', icon: '📉' },
      { key: 'conduction', label: 'O\'tkazuvchanlik', icon: '⚡' },
      { key: 'conclusion', label: 'Xulosa', icon: '📝' }
    ]
  }
};

const VALID_SPECIALIZATIONS = Object.keys(MEDICAL_SKILLS);

/** UI uchun yengil ro'yxat (prompt/schema yuborilmaydi) */
function listSpecializations() {
  return VALID_SPECIALIZATIONS.map((key) => ({
    key,
    label: MEDICAL_SKILLS[key].label,
    fields: MEDICAL_SKILLS[key].fields.map((f) => ({ key: f.key, label: f.label, icon: f.icon, type: f.type || 'text' })),
  }));
}

/** Mutaxassislik kalitini tekshiradi; noto'g'ri bo'lsa null */
function resolveSpecialization(key) {
  const k = String(key || '').trim().toLowerCase();
  return MEDICAL_SKILLS[k] ? k : null;
}

export { MEDICAL_SKILLS, VALID_SPECIALIZATIONS, listSpecializations, resolveSpecialization };
