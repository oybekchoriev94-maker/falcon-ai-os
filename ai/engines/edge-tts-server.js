// ============================================================
// Edge-TTS Server — Microsoft Edge TTS uchun HTTP wrapper
// Bepul, Uzbek tilida gapiradi (uz-UZ-MadinaNeural)
// Port: 50081 — ai/engines/tts.js shu portdan ovoz oladi
// ============================================================
// O'rnatish: npm install edge-tts
// Ishga tushirish: node ai/engines/edge-tts-server.js
// ============================================================

import http from 'http';
import { URL } from 'url';

const PORT = parseInt(process.env.EDGE_TTS_PORT || '50081');
const TIMEOUT = 30000;

let ttsModule;
try {
  ttsModule = await import('edge-tts');
} catch {
  console.error('============================================');
  console.error('  edge-tts npm paketi topilmadi!');
  console.error('  O\'rnatish: npm install edge-tts');
  console.error('============================================');
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    if (path === '/api/speak' && req.method === 'GET') {
      const text = url.searchParams.get('text');
      const voice = url.searchParams.get('voice') || 'uz-UZ-MadinaNeural';
      const rate = url.searchParams.get('rate') || '+0%';

      if (!text) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'text parametri kerak' }));
      }

      // Edge-TTS orqali ovoz generatsiya
      const tts = new ttsModule.default();
      const audioChunks = [];

      for await (const chunk of tts.tts(text, voice, rate)) {
        audioChunks.push(chunk);
      }

      const audioBuffer = Buffer.concat(audioChunks);
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length
      });
      return res.end(audioBuffer);

    } else if (path === '/api/voices' && req.method === 'GET') {
      // Mavjud ovozlar ro'yxati
      const tts = new ttsModule.default();
      const voices = [
        { name: 'uz-UZ-MadinaNeural', locale: 'uz-UZ', gender: 'Female', description: 'O\'zbek (O\'zbekiston) — Madina' },
        { name: 'ru-RU-DariyaNeural', locale: 'ru-RU', gender: 'Female', description: 'Rus (Rossiya) — Dariya' },
        { name: 'ru-RU-SvetlanaNeural', locale: 'ru-RU', gender: 'Female', description: 'Rus (Rossiya) — Svetlana' },
        { name: 'en-US-AriaNeural', locale: 'en-US', gender: 'Female', description: 'English (US) — Aria' },
      ];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ voices }));

    } else if (path === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', provider: 'edge-tts', uzbek: 'uz-UZ-MadinaNeural' }));

    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not Found. Endpoints: GET /api/speak?text=...&voice=...' }));
    }
  } catch (e) {
    console.error('[Edge-TTS] Xatolik:', e.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => {
  console.log(`✅ Edge-TTS server http://localhost:${PORT}`);
  console.log(`   Ovozlar: uz-UZ-MadinaNeural (O'zbek), ru-RU-SvetlanaNeural (Rus)`);
  console.log(`   Test: curl "http://localhost:${PORT}/api/speak?text=Salom&voice=uz-UZ-MadinaNeural"`);
});

process.on('SIGINT', () => { server.close(); process.exit(0); });
process.on('SIGTERM', () => { server.close(); process.exit(0); });
