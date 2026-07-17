// ============================================================
// Falcon AI OS — Swagger/OpenAPI 3.0 Documentation
// Auto-generated spec defining all API endpoints
// ============================================================

export const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Falcon AI OS API',
    version: '1.0.0',
    description: `Falcon AI OS — Klinikalar uchun yaxlit AI ekotizim (DB + AI Agent Orchestrator + Botlar + API).

**Capabilities:**
- Face ID biometrik autentifikatsiya
- AI Scribe (ovozli matn → tibbiy hisobot)
- Inventar boshqaruvi (FEFO partiyaviy)
- Bemor qabul va navbat tizimi
- B2B referral/yo'llanma (QR kod)
- To'lov va loyallik ballari
- AI Agent Orchestrator (pipeline)
- Telegram bot integratsiyasi`,
    contact: {
      name: 'Falcon AI OS',
      url: 'https://github.com/falcon-ai-os'
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT'
    }
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Development server'
    },
    {
      url: 'https://{hostname}',
      description: 'Production server',
      variables: {
        hostname: {
          default: 'falcon-ai-os.example.com',
          description: 'Production hostname'
        }
      }
    }
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token (signToken dan olingan). Header: Authorization: Bearer <token>'
      }
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: { type: 'string', example: 'Xatolik yuz berdi' }
        }
      },
      Success: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true }
        }
      },
      LoginRequest: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', example: 'admin' },
          password: { type: 'string', example: 'admin-change-me-now' }
        }
      },
      LoginResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          token: { type: 'string' },
          user: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              username: { type: 'string' },
              role: { type: 'string', enum: ['ceo', 'admin', 'receptionist', 'doctor'] },
              name: { type: 'string' }
            }
          }
        }
      },
      AppointmentCreate: {
        type: 'object',
        required: ['patient_name'],
        properties: {
          patient_name: { type: 'string', example: 'Ali Valiyev' },
          phone: { type: 'string', example: '+998901234567' },
          doctor_name: { type: 'string', example: 'Dr. Sardor' },
          department: { type: 'string', example: 'therapy' },
          notes: { type: 'string' },
          source: { type: 'string', enum: ['reception', 'api', 'telegram'], example: 'api' }
        }
      },
      B2BReferral: {
        type: 'object',
        required: ['patient_name', 'service'],
        properties: {
          sender_clinic: { type: 'string' },
          sender_doctor: { type: 'string' },
          receiver_clinic: { type: 'string' },
          patient_name: { type: 'string' },
          service: { type: 'string' },
          amount: { type: 'number' },
          idempotency_key: { type: 'string' }
        }
      },
      InventoryAdd: {
        type: 'object',
        required: ['name', 'sku', 'quantity', 'unit'],
        properties: {
          name: { type: 'string', example: 'Kompozit plomba Filtek' },
          sku: { type: 'string', example: 'PL-001' },
          category: { type: 'string' },
          quantity: { type: 'number', example: 50 },
          unit: { type: 'string', example: 'gr' },
          cost_price: { type: 'number' },
          min_stock: { type: 'number' },
          batch_number: { type: 'string' },
          expiration_date: { type: 'string', format: 'date' }
        }
      },
      InventoryConsume: {
        type: 'object',
        required: ['item_id', 'quantity'],
        properties: {
          item_id: { type: 'integer' },
          quantity: { type: 'number', example: 5 },
          performed_by: { type: 'string' },
          reason: { type: 'string', example: 'Muolaja uchun' }
        }
      },
      FaceRegister: {
        type: 'object',
        required: ['doctor_id', 'face_descriptor', 'nonce', 'timestamp'],
        properties: {
          doctor_id: { type: 'string' },
          face_descriptor: { type: 'array', items: { type: 'number' }, description: '128-512 float array' },
          device_id: { type: 'string' },
          nonce: { type: 'string' },
          timestamp: { type: 'integer' }
        }
      },
      FaceVerify: {
        type: 'object',
        required: ['face_descriptor', 'nonce', 'timestamp'],
        properties: {
          face_descriptor: { type: 'array', items: { type: 'number' } },
          liveness_score: { type: 'number', minimum: 0, maximum: 1 },
          device_id: { type: 'string' },
          nonce: { type: 'string' },
          timestamp: { type: 'integer' }
        }
      },
      AIExecute: {
        type: 'object',
        required: ['agent', 'input'],
        properties: {
          agent: { type: 'string', example: 'receptionist' },
          input: { type: 'object' }
        }
      },
      AIPipeline: {
        type: 'object',
        required: ['steps'],
        properties: {
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                agent: { type: 'string' },
                input: { type: 'object' }
              }
            }
          }
        }
      },
      BillingRedeem: {
        type: 'object',
        required: ['patient_id', 'base_cost', 'points_to_redeem'],
        properties: {
          patient_id: { type: 'string' },
          booking_id: { type: 'integer' },
          base_cost: { type: 'number' },
          points_to_redeem: { type: 'number' },
          idempotency_key: { type: 'string' }
        }
      }
    }
  },
  security: [
    { BearerAuth: [] }
  ],
  tags: [
    { name: 'Auth', description: 'Autentifikatsiya va ruxsat boshqaruvi' },
    { name: 'Face', description: 'Face ID biometrik tizimi' },
    { name: 'Reception', description: 'Qabul va navbat tizimi' },
    { name: 'Scribe', description: 'AI Scribe — ovozli matn va tibbiy hisobot' },
    { name: 'Inventory', description: 'Inventar boshqaruvi (FEFO partiyaviy)' },
    { name: 'Doctors', description: 'Shifokorlarni boshqarish' },
    { name: 'Appointments', description: 'Uchrashuv va bron qilish' },
    { name: 'Billing', description: 'To\'lov va loyallik ballari' },
    { name: 'B2B', description: 'B2B referral va yo\'llanmalar' },
    { name: 'Referrals', description: 'Yo\'llanma (QR kod) tizimi' },
    { name: 'AI', description: 'AI Agent Orchestrator' },
    { name: 'Health', description: 'Server holati va tayyorlik tekshiruvi' }
  ],
  paths: {
    // ================================================================
    // AUTH
    // ================================================================
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Standart foydalanuvchi logini',
        description: 'users jadvalidagi 4 rol (ceo, admin, receptionist, doctor) uchun login',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } }
        },
        responses: {
          200: { description: 'Muvaffaqiyatli login', content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } } } },
          400: { description: 'Validatsiya xatosi', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { description: 'Login yoki parol noto\'g\'ri' },
          429: { description: 'Juda ko\'p urinish' }
        }
      }
    },
    '/api/auth/doctor-login': {
      post: {
        tags: ['Auth'],
        summary: 'Shifokor logini (doctors jadvali)',
        description: 'Account lockout bilan (5 ta xato urinishdan keyin 15 daqiqa blok)',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } }
        },
        responses: {
          200: { description: 'Muvaffaqiyatli login', content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } } } },
          401: { description: 'Login yoki parol noto\'g\'ri' },
          429: { description: 'Hisob bloklangan' }
        }
      }
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Joriy tokenni tekshirish',
        description: 'JWT yoki Telegram auth orqali joriy foydalanuvchi ma\'lumotlari',
        responses: {
          200: { description: 'Foydalanuvchi ma\'lumotlari' },
          401: { description: 'Token noto\'g\'ri yoki muddati o\'tgan' }
        }
      }
    },
    '/api/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Token muddatini uzaytirish',
        responses: {
          200: { description: 'Yangi token' },
          401: { description: 'Auth zarur' }
        }
      }
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Tokenni bekor qilish',
        description: 'JTI ni token_blacklist ga qo\'shadi',
        responses: {
          200: { description: 'Chiqish bajarildi' },
          401: { description: 'Auth zarur' }
        }
      }
    },
    '/api/auth/register-doctor': {
      post: {
        tags: ['Auth', 'Doctors'],
        summary: 'Admin yangi shifokor qo\'shadi',
        security: [{ BearerAuth: ['admin'] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'username', 'password', 'specialization'],
                properties: {
                  name: { type: 'string', example: 'Akmal Karimov' },
                  username: { type: 'string', example: 'dr_akmal' },
                  password: { type: 'string', format: 'password' },
                  specialization: { type: 'string', example: 'doctor' }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'Shifokor yaratildi' },
          400: { description: 'Validatsiya xatosi' },
          401: { description: 'Auth zarur' },
          403: { description: 'Ruxsat yo\'q' }
        }
      }
    },

    // ================================================================
    // FACE
    // ================================================================
    '/api/face/register': {
      post: {
        tags: ['Face'],
        summary: 'Shifokorning yuz modelini ro\'yxatdan o\'tkazish',
        security: [{ BearerAuth: ['admin'] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/FaceRegister' } } }
        },
        responses: {
          200: { description: 'Yuz modeli saqlandi' },
          400: { description: 'Validatsiya xatosi' },
          401: { description: 'Auth zarur' },
          403: { description: 'Admin huquqi talab qilinadi' },
          409: { description: 'Nonce takrori' }
        }
      }
    },
    '/api/face/verify': {
      post: {
        tags: ['Face'],
        summary: 'Yuzni tekshirish (verify)',
        description: 'Doctor va patient jadvallarida qidiradi. Liveness tekshiruvi bilan.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/FaceVerify' } } }
        },
        responses: {
          200: { description: 'Natija — matched yoki unmatched' },
          400: { description: 'Validatsiya xatosi' },
          403: { description: 'Liveness tekshiruvi o\'tmadi' },
          409: { description: 'Nonce takrori' }
        }
      }
    },
    '/api/face/register-patient': {
      post: {
        tags: ['Face'],
        summary: 'Bemorni yuz orqali ro\'yxatdan o\'tkazish',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['first_name', 'face_descriptor', 'nonce', 'timestamp'],
                properties: {
                  first_name: { type: 'string' },
                  last_name: { type: 'string' },
                  phone: { type: 'string' },
                  face_descriptor: { type: 'array', items: { type: 'number' } },
                  liveness_score: { type: 'number' },
                  nonce: { type: 'string' },
                  timestamp: { type: 'integer' },
                  device_id: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'Bemor ro\'yxatdan o\'tdi' },
          400: { description: 'Validatsiya xatosi' },
          403: { description: 'Liveness tekshiruvi o\'tmadi / Spoof' },
          409: { description: 'Bu yuz oldin ro\'yxatdan o\'tgan' }
        }
      }
    },
    '/api/face/attendance': {
      get: {
        tags: ['Face'],
        summary: 'Bugungi kelgan shifokorlar (attendance)',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Davomat ro\'yxati' }
        }
      }
    },
    '/api/face/patient-checkins': {
      get: {
        tags: ['Face'],
        summary: 'Bugungi bemor check-in loglari',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Check-in loglari' } }
      }
    },
    '/api/face/patients': {
      get: {
        tags: ['Face'],
        summary: 'Bemorlarni qidirish/ro\'yxati',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Qidirish (ism, familiya, telefon)' }
        ],
        responses: { 200: { description: 'Bemorlar ro\'yxati' } }
      }
    },
    '/api/face/doctors': {
      get: {
        tags: ['Face'],
        summary: 'Face ID tizimiga ulangan shifokorlar',
        security: [{ BearerAuth: ['admin', 'ceo'] }],
        responses: { 200: { description: 'Shifokorlar ro\'yxati' } }
      }
    },
    '/api/face/logs': {
      get: {
        tags: ['Face'],
        summary: 'Bugungi face loglari',
        security: [{ BearerAuth: ['admin', 'ceo'] }],
        responses: { 200: { description: 'Loglar ro\'yxati' } }
      }
    },
    '/api/face/doctors/status': {
      get: {
        tags: ['Face'],
        summary: 'Shifokorlarning biometrik statusi',
        security: [{ BearerAuth: ['admin', 'ceo'] }],
        responses: { 200: { description: 'Biometrik status' } }
      }
    },
    '/api/face/doctors/{id}/block': {
      post: {
        tags: ['Face'],
        summary: 'Shifokorning biometrik kirishini bloklash',
        security: [{ BearerAuth: ['admin'] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Bloklandi' }, 404: { description: 'Shifokor topilmadi' } }
      }
    },
    '/api/face/doctors/{id}/unblock': {
      post: {
        tags: ['Face'],
        summary: 'Shifokorning biometrik kirishini faollashtirish',
        security: [{ BearerAuth: ['admin'] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Faollashtirildi' }, 404: { description: 'Shifokor topilmadi' } }
      }
    },
    '/api/face/doctors/{id}/face': {
      delete: {
        tags: ['Face'],
        summary: 'Shifokorning yuz modelini o\'chirish',
        security: [{ BearerAuth: ['admin'] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Yuz modeli o\'chirildi' }, 404: { description: 'Shifokor topilmadi' } }
      }
    },
    '/api/face/consent': {
      post: {
        tags: ['Face', 'Health'],
        summary: 'Biometrik rozilik berish (GDPR/O\'zbekiston)',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['user_type', 'user_id'],
                properties: {
                  user_type: { type: 'string', enum: ['doctor', 'patient'] },
                  user_id: { type: 'string' },
                  consent_text: { type: 'string' }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Rozilik berildi / avval berilgan' }, 400: { description: 'Validatsiya xatosi' } }
      }
    },
    '/api/face/consent/{userType}/{userId}': {
      get: {
        tags: ['Face'],
        summary: 'Rozilik holatini tekshirish',
        security: [{ BearerAuth: ['admin'] }],
        parameters: [
          { name: 'userType', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: { 200: { description: 'Rozilik ma\'lumoti' } }
      }
    },
    '/api/face/forget/doctor/{id}': {
      delete: {
        tags: ['Face'],
        summary: 'Right to be forgotten — shifokor biometrik ma\'lumotlarini o\'chirish',
        security: [{ BearerAuth: ['admin'] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Ma\'lumotlar o\'chirildi' }, 404: { description: 'Topilmadi' } }
      }
    },
    '/api/face/forget/patient/{id}': {
      delete: {
        tags: ['Face'],
        summary: 'Right to be forgotten — bemor biometrik ma\'lumotlarini o\'chirish',
        security: [{ BearerAuth: ['admin'] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Ma\'lumotlar o\'chirildi' }, 404: { description: 'Topilmadi' } }
      }
    },

    // ================================================================
    // RECEPTION
    // ================================================================
    '/api/patient/report/{id}': {
      get: {
        tags: ['Reception'],
        summary: 'Tibbiy hisobotni olish (bemor uchun)',
        security: [],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Hisobot ID' }],
        responses: {
          200: { description: 'Hisobot ma\'lumotlari' },
          404: { description: 'Hisobot topilmadi' }
        }
      }
    },
    '/api/verify-report/{id}': {
      get: {
        tags: ['Reception'],
        summary: 'QR kod orqali hisobotni tekshirish',
        security: [],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'HTML sahifa yoki JSON' },
          404: { description: 'Hisobot topilmadi' }
        }
      }
    },

    // ================================================================
    // SCRIBE
    // ================================================================
    '/api/scribe/transcribe': {
      post: {
        tags: ['Scribe'],
        summary: 'Ovozli yozuvni transkripsiya qilish',
        description: 'Audio faylni matnga aylantiradi, AI tibbiy tahlil qiladi va inventarni avtomatik sarflaydi',
        security: [{ BearerAuth: ['doctor', 'admin'] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  audio: { type: 'string', format: 'binary', description: 'Audio fayl (webm, mp3, wav)' },
                  doctor_id: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'Transkripsiya + AI tahlil + inventar sarfi' },
          400: { description: 'Audio fayl majburiy' },
          401: { description: 'Auth zarur' },
          500: { description: 'Server xatosi' }
        }
      }
    },
    '/api/scribe/upload': {
      post: {
        tags: ['Scribe'],
        summary: 'AI Scribe — specialization bo\'yicha hisobot yaratish',
        description: 'Audio yuklash, transkripsiya, AI tahlil, PDF+QR generatsiya, Telegram xabarnoma',
        security: [{ BearerAuth: ['doctor'] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  audio: { type: 'string', format: 'binary' },
                  telegram_id: { type: 'string', description: 'Bemorga Telegram xabar yuborish uchun' },
                  doctor_id: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'AI hisobot + PDF + QR' },
          400: { description: 'Audio majburiy' },
          401: { description: 'Auth zarur' },
          403: { description: 'Balans yetarli emas' }
        }
      }
    },
    '/api/scribe/history': {
      get: {
        tags: ['Scribe'],
        summary: 'Konsultatsiyalar tarixi',
        security: [{ BearerAuth: ['doctor', 'admin'] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }
        ],
        responses: { 200: { description: 'Konsultatsiyalar ro\'yxati' } }
      }
    },

    // ================================================================
    // INVENTORY
    // ================================================================
    '/api/inventory/status': {
      get: {
        tags: ['Inventory'],
        summary: 'Inventar holati (barcha materiallar)',
        description: 'Low-stock, batch count, total value bilan birga',
        security: [{ BearerAuth: ['admin', 'ceo'] }],
        responses: { 200: { description: 'Inventar ro\'yxati' } }
      }
    },
    '/api/inventory/add': {
      post: {
        tags: ['Inventory'],
        summary: 'Yangi material qo\'shish yoki mavjudini to\'ldirish',
        description: 'FEFO partiyaviy boshqaruv bilan. SKU orqali avtomatik update.',
        security: [{ BearerAuth: ['admin'] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/InventoryAdd' } } }
        },
        responses: {
          200: { description: 'Material qo\'shildi/yangilandi' },
          400: { description: 'Validatsiya xatosi' },
          401: { description: 'Auth zarur' },
          403: { description: 'Admin ruxsati kerak' }
        }
      }
    },
    '/api/inventory/consume': {
      post: {
        tags: ['Inventory'],
        summary: 'Material sarflash (FEFO batch consumption)',
        description: 'Avval muddati yaqin partiyadan sarflaydi',
        security: [{ BearerAuth: ['admin', 'warehouseman'] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/InventoryConsume' } } }
        },
        responses: { 200: { description: 'Sarflandi' } }
      }
    },
    '/api/inventory/search': {
      get: {
        tags: ['Inventory'],
        summary: 'Material qidirish',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Nomi yoki SKU bo\'yicha qidirish' }
        ],
        responses: { 200: { description: 'Topilgan materiallar' } }
      }
    },
    '/api/inventory/transactions': {
      get: {
        tags: ['Inventory'],
        summary: 'Inventar tranzaksiyalar tarixi',
        security: [{ BearerAuth: ['admin', 'ceo'] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } }
        ],
        responses: { 200: { description: 'Tranzaksiyalar' } }
      }
    },
    '/api/inventory/batches': {
      get: {
        tags: ['Inventory'],
        summary: 'FEFO partiyalar ro\'yxati',
        security: [{ BearerAuth: ['admin', 'ceo'] }],
        parameters: [
          { name: 'item_id', in: 'query', schema: { type: 'integer' }, description: 'Material ID filtr' }
        ],
        responses: { 200: { description: 'Partiyalar' } }
      }
    },
    '/api/inventory/norms': {
      get: {
        tags: ['Inventory'],
        summary: 'Material-me\'yor normasini olish',
        responses: { 200: { description: 'Normativlar' } }
      },
      post: {
        tags: ['Inventory'],
        summary: 'Muolaja uchun material normasini o\'rnatish',
        security: [{ BearerAuth: ['admin'] }],
        responses: { 200: { description: 'Norma saqlandi' } }
      }
    },
    '/api/inventory/voice-add': {
      post: {
        tags: ['Inventory'],
        summary: 'Ovozli buyruq orqali material qo\'shish',
        security: [{ BearerAuth: ['admin'] }],
        requestBody: {
          content: { 'multipart/form-data': { schema: { type: 'object', properties: { audio: { type: 'string', format: 'binary' } } } } }
        },
        responses: { 200: { description: 'Natija' } }
      }
    },
    '/api/reports/inventory-waste': {
      get: {
        tags: ['Inventory'],
        summary: 'Inventar chiqindi hisoboti',
        security: [{ BearerAuth: ['admin', 'ceo'] }],
        responses: { 200: { description: 'Chiqindi hisoboti' } }
      }
    },
    '/api/reports/limits': {
      get: {
        tags: ['Inventory'],
        summary: 'Oylik limitlar hisoboti',
        security: [{ BearerAuth: ['admin', 'ceo'] }],
        responses: { 200: { description: 'Limit hisoboti' } }
      }
    },

    // ================================================================
    // DOCTORS
    // ================================================================
    '/api/doctors': {
      get: {
        tags: ['Doctors'],
        summary: 'Barcha shifokorlar ro\'yxati (public)',
        security: [],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }
        ],
        responses: { 200: { description: 'Shifokorlar ro\'yxati' } }
      }
    },
    '/api/doctor/my-patients': {
      get: {
        tags: ['Doctors'],
        summary: 'Shifokorning bemorlari va uchrashuvlari',
        security: [{ BearerAuth: ['doctor'] }],
        responses: { 200: { description: 'Bemor va uchrashuvlar' } }
      }
    },
    '/api/doctor/my-stats': {
      get: {
        tags: ['Doctors'],
        summary: 'Shifokorning statistikasi',
        security: [{ BearerAuth: ['doctor'] }],
        responses: { 200: { description: 'Statistika' } }
      }
    },

    // ================================================================
    // APPOINTMENTS
    // ================================================================
    '/api/appointments': {
      get: {
        tags: ['Appointments'],
        summary: 'Uchrashuvlar ro\'yxati (sana bo\'yicha)',
        security: [{ BearerAuth: ['receptionist', 'admin', 'doctor'] }],
        parameters: [
          { name: 'date', in: 'query', schema: { type: 'string', format: 'date' }, description: 'YYYY-MM-DD (default: today)' }
        ],
        responses: { 200: { description: 'Uchrashuvlar' } }
      },
      post: {
        tags: ['Appointments'],
        summary: 'Yangi uchrashuv yaratish (public booking)',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AppointmentCreate' } } }
        },
        responses: { 200: { description: 'Uchrashuv yaratildi' }, 400: { description: 'Validatsiya xatosi' }, 429: { description: 'Limitdan oshdi' } }
      }
    },
    '/api/appointments/complete': {
      post: {
        tags: ['Appointments'],
        summary: 'Uchrashuvni yakunlash',
        security: [{ BearerAuth: ['doctor', 'admin'] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['appointment_id'],
                properties: {
                  appointment_id: { type: 'string' },
                  duration_minutes: { type: 'integer' },
                  doctor_id: { type: 'string' }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Yakunlandi + doktor analitikasi yangilandi' }, 404: { description: 'Uchrashuv topilmadi' } }
      }
    },
    '/api/appointments/doctors': {
      get: {
        tags: ['Appointments'],
        summary: 'Faol shifokorlar ro\'yxati (Mini App uchun)',
        security: [],
        responses: { 200: { description: 'Shifokorlar' } }
      }
    },
    '/api/appointments/slots': {
      get: {
        tags: ['Appointments'],
        summary: 'Shifokorning bo\'sh vaqtlari (slotlar)',
        security: [],
        parameters: [
          { name: 'doctor_id', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'date', in: 'query', required: true, schema: { type: 'string', format: 'date' }, description: 'YYYY-MM-DD' }
        ],
        responses: { 200: { description: 'Slotlar' }, 400: { description: 'Parametr xatosi' } }
      }
    },
    '/api/appointments/book': {
      post: {
        tags: ['Appointments'],
        summary: 'Vaqtni bron qilish',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['doctor_id', 'patient_name', 'appointment_date', 'appointment_time'],
                properties: {
                  doctor_id: { type: 'string' },
                  patient_name: { type: 'string' },
                  telegram_id: { type: 'string' },
                  appointment_date: { type: 'string', format: 'date' },
                  appointment_time: { type: 'string', example: '09:30' }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Bron qilindi' }, 400: { description: 'Slot band' } }
      }
    },
    '/api/appointments/cancel': {
      post: {
        tags: ['Appointments'],
        summary: 'Bronni bekor qilish',
        security: [],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['booking_id'],
                properties: { booking_id: { type: 'integer' } }
              }
            }
          }
        },
        responses: { 200: { description: 'Bekor qilindi' } }
      }
    },

    // ================================================================
    // BILLING
    // ================================================================
    '/api/billing/redeem': {
      post: {
        tags: ['Billing'],
        summary: 'Loyallik ballarini yechish (cashback redeem)',
        description: 'Bemor o\'z cashback ballarini to\'lovga qo\'llashi mumkin',
        security: [{ BearerAuth: ['admin', 'patient'] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/BillingRedeem' } } }
        },
        responses: { 200: { description: 'Ballar yechildi' }, 400: { description: 'Yetarli ball mavjud emas' }, 403: { description: 'Ruxsat yo\'q' } }
      }
    },
    '/api/billing/loyalty': {
      get: {
        tags: ['Billing'],
        summary: 'Loyallik ledger tarixi',
        security: [{ BearerAuth: ['admin'] }],
        responses: { 200: { description: 'Ledger yozuvlari' } }
      }
    },
    '/api/billing/invoices': {
      get: {
        tags: ['Billing'],
        summary: 'Invoice/cheklar ro\'yxati',
        security: [{ BearerAuth: ['admin', 'ceo'] }],
        responses: { 200: { description: 'Invoicelar' } }
      }
    },

    // ================================================================
    // B2B
    // ================================================================
    '/api/b2b/referral': {
      post: {
        tags: ['B2B'],
        summary: 'B2B yo\'llanma yaratish (reception → shifokor)',
        description: 'Yangi referral yaratib, QR kod va moliyaviy split hisoblaydi',
        security: [{ BearerAuth: ['admin', 'doctor'] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/B2BReferral' } } }
        },
        responses: { 200: { description: 'Referral yaratildi' }, 400: { description: 'Validatsiya xatosi' }, 403: { description: 'Ruxsat yo\'q' } }
      }
    },
    '/api/b2b/stats': {
      get: {
        tags: ['B2B'],
        summary: 'B2B statistika',
        security: [{ BearerAuth: ['admin', 'ceo'] }],
        responses: { 200: { description: 'Statistika' } }
      }
    },
    '/api/b2b/referrals': {
      get: {
        tags: ['B2B'],
        summary: 'Barcha yo\'llanmalar ro\'yxati (pagination)',
        security: [{ BearerAuth: ['admin', 'ceo'] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Filter: pending/completed/cancelled' }
        ],
        responses: { 200: { description: 'Yo\'llanmalar' } }
      }
    },

    // ================================================================
    // REFERRALS
    // ================================================================
    '/api/referral/generate': {
      post: {
        tags: ['Referrals'],
        summary: 'Hamkor uchun referral QR kod yaratish',
        security: [{ BearerAuth: ['admin', 'ceo'] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['partner_name'],
                properties: {
                  partner_name: { type: 'string' },
                  partner_phone: { type: 'string' },
                  notes: { type: 'string' }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Partner + QR yaratildi' } }
      }
    },
    '/api/referral/convert': {
      post: {
        tags: ['Referrals'],
        summary: 'Face ID orqali kelgan bemor referalini konvertatsiya qilish',
        security: [{ BearerAuth: ['admin', 'receptionist'] }],
        responses: { 200: { description: 'Konvertatsiya qilindi' } }
      }
    },
    '/api/referral/adjust-balance': {
      post: {
        tags: ['Referrals'],
        summary: 'Hamkor balansini boshqarish (topup/payout)',
        security: [{ BearerAuth: ['admin', 'ceo'] }],
        responses: { 200: { description: 'Balans yangilandi' } }
      }
    },
    '/api/referral/partners': {
      get: {
        tags: ['Referrals'],
        summary: 'Hamkorlar ro\'yxati',
        security: [{ BearerAuth: ['admin', 'ceo'] }],
        responses: { 200: { description: 'Hamkorlar' } }
      }
    },
    '/api/referral/stats': {
      get: {
        tags: ['Referrals'],
        summary: 'Referral tizim statistkasi',
        security: [{ BearerAuth: ['admin', 'ceo'] }],
        responses: { 200: { description: 'Statistika' } }
      }
    },
    '/api/referral/partner/{id}': {
      get: {
        tags: ['Referrals'],
        summary: 'Hamkor detallari (tranzaksiya va referral tarixi)',
        security: [{ BearerAuth: ['admin', 'ceo'] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Partner ma\'lumoti' }, 404: { description: 'Topilmadi' } }
      }
    },
    '/api/referral/qr/{token}': {
      get: {
        tags: ['Referrals'],
        summary: 'QR token orqali hamkor ma\'lumoti (public)',
        security: [],
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Partner ma\'lumoti' }, 404: { description: 'Topilmadi' } }
      }
    },
    '/api/referrals/qr/{token}': {
      get: {
        tags: ['Referrals'],
        summary: 'QR kod orqali yo\'llanma ma\'lumoti (public)',
        security: [],
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Yo\'llanma ma\'lumoti' }, 404: { description: 'Topilmadi' } }
      }
    },
    '/api/referrals/redeem': {
      post: {
        tags: ['Referrals'],
        summary: 'Yo\'llanmani tasdiqlash (redeem)',
        security: [{ BearerAuth: ['admin', 'receptionist'] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['referral_id'],
                properties: {
                  referral_id: { type: 'string' },
                  receiver_clinic_id: { type: 'string' },
                  idempotency_key: { type: 'string' }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Tasdiqlandi' }, 400: { description: 'Status noto\'g\'ri' }, 404: { description: 'Topilmadi' } }
      }
    },
    '/api/referrals/agent-create': {
      post: {
        tags: ['Referrals', 'AI'],
        summary: 'AI agent orqali yo\'llanma yaratish',
        security: [{ BearerAuth: ['admin'] }],
        responses: { 200: { description: 'Agent natijasi' } }
      }
    },
    '/api/referrals/pipeline': {
      post: {
        tags: ['Referrals', 'AI'],
        summary: 'Reception → B2B pipeline (bir ketma-ketlikda)',
        security: [{ BearerAuth: ['admin'] }],
        responses: { 200: { description: 'Pipeline natijasi' } }
      }
    },
    '/api/referrals/details/{id}': {
      get: {
        tags: ['Referrals'],
        summary: 'Yo\'llanma detallari',
        security: [],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Yo\'llanma ma\'lumoti' }, 404: { description: 'Topilmadi' } }
      }
    },
    '/api/referrals/{id}/download-pdf': {
      get: {
        tags: ['Referrals'],
        summary: 'Yo\'llanma PDF yuklab olish',
        security: [],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'PDF fayl' }, 404: { description: 'Topilmadi' } }
      }
    },
    '/api/referrals/{id}/qr': {
      get: {
        tags: ['Referrals'],
        summary: 'Yo\'llanma QR kod (Base64)',
        security: [],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'QR kod data URL' }, 404: { description: 'Topilmadi' } }
      }
    },

    // ================================================================
    // AI
    // ================================================================
    '/api/ai/status': {
      get: {
        tags: ['AI'],
        summary: 'AI Orchestrator va agentlar holati',
        security: [],
        responses: { 200: { description: 'Tizim holati' } }
      }
    },
    '/api/ai/agents': {
      get: {
        tags: ['AI'],
        summary: 'Barcha AI agentlar ro\'yxati',
        security: [],
        parameters: [
          { name: 'category', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } }
        ],
        responses: { 200: { description: 'Agentlar ro\'yxati' } }
      }
    },
    '/api/ai/execute': {
      post: {
        tags: ['AI'],
        summary: 'Agentni ishga tushirish',
        security: [{ BearerAuth: ['admin', 'doctor'] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AIExecute' } } }
        },
        responses: { 200: { description: 'Agent natijasi' }, 400: { description: 'Validatsiya xatosi' }, 429: { description: 'AI limitdan oshdi' } }
      }
    },
    '/api/ai/pipeline': {
      post: {
        tags: ['AI'],
        summary: 'Ko\'p agentli pipeline ishga tushirish',
        security: [{ BearerAuth: ['admin'] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AIPipeline' } } }
        },
        responses: { 200: { description: 'Pipeline natijasi' }, 400: { description: 'Validatsiya xatosi' } }
      }
    },
    '/api/ai/logs': {
      get: {
        tags: ['AI'],
        summary: 'Agent ijro loglari',
        security: [{ BearerAuth: ['admin'] }],
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }],
        responses: { 200: { description: 'Loglar' } }
      }
    },
    '/api/ai/transcribe': {
      post: {
        tags: ['AI'],
        summary: 'Audio transkripsiya (Whisper)',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['audio_base64'],
                properties: {
                  audio_base64: { type: 'string' },
                  language: { type: 'string', default: 'uz' },
                  filename: { type: 'string' }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Transkripsiya natijasi' }, 400: { description: 'audio_base64 talab qilinadi' } }
      }
    },
    '/api/ai/llm': {
      post: {
        tags: ['AI'],
        summary: 'Pure LLM query',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['system_prompt', 'user_text'],
                properties: {
                  system_prompt: { type: 'string' },
                  user_text: { type: 'string' },
                  temperature: { type: 'number' },
                  max_tokens: { type: 'integer' }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'LLM javobi' } }
      }
    },
    '/api/ai/tts': {
      post: {
        tags: ['AI'],
        summary: 'Text-to-Speech (matndan ovoz)',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['text'],
                properties: {
                  text: { type: 'string' },
                  voice: { type: 'string', default: 'alloy' },
                  speed: { type: 'number', default: 1.0 }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'MP3 audio' }, 400: { description: 'text talab qilinadi' }, 503: { description: 'TTS mavjud emas' } }
      }
    },

    // ================================================================
    // HEALTH
    // ================================================================
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'Server holati',
        description: 'DB status, agent soni, uptime, node_version bilan birga',
        security: [],
        responses: {
          200: {
            description: 'Server holati',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['ok', 'degraded'] },
                    service: { type: 'string' },
                    version: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    uptime: { type: 'number' },
                    node_version: { type: 'string' },
                    agents: { type: 'integer' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/health/ready': {
      get: {
        tags: ['Health'],
        summary: 'Readiness probe',
        security: [],
        responses: { 200: { description: 'Tayyorlik holati' } }
      }
    },
    '/api/health/live': {
      get: {
        tags: ['Health'],
        summary: 'Liveness probe',
        security: [],
        responses: { 200: { description: '"alive" matni' } }
      }
    },

    // ================================================================
    // INTERNAL
    // ================================================================
    '/api/internal/send-telegram': {
      post: {
        tags: ['Reception'],
        summary: 'Internal — Telegram xabar yuborish (x-internal-secret bilan)',
        security: [],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['chat_id', 'text'],
                properties: {
                  chat_id: { type: 'string' },
                  text: { type: 'string' },
                  parse_mode: { type: 'string' }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Xabar yuborildi' } }
      }
    }
  }
};
