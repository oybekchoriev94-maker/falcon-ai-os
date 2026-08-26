// ============================================================
// TTS klient — unit testlar (DB'siz, tarmoqsiz)
//
// CI'da TTS xizmati YO'Q — shuning uchun isTtsEnabled() false va
// synthesize() null qaytarishi tekshiriladi: navbat ekrani TTS'siz
// ham ishlashi kerak (deterministik fallback).
// ============================================================

import { describe, it, expect } from 'vitest';
import { isTtsEnabled, synthesize, concatWavBuffers } from '../backend/services/tts-client.js';

// Minimal 44 baytli WAV boshi (24kHz mono 16-bit PCM) + data
function fakeWav(dataLen, fill = 1) {
  const b = Buffer.alloc(44 + dataLen);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + dataLen, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);        // fmt chunk o'lchami
  b.writeUInt16LE(1, 20);         // PCM
  b.writeUInt16LE(1, 22);         // mono
  b.writeUInt32LE(24000, 24);     // sample rate
  b.writeUInt32LE(48000, 28);     // byte rate
  b.writeUInt16LE(2, 32);         // block align
  b.writeUInt16LE(16, 34);        // bit depth
  b.write('data', 36);
  b.writeUInt32LE(dataLen, 40);
  b.fill(fill, 44);
  return b;
}

describe('tts-client — TTS o\'chiq holati (CI fallback)', () => {
  it('TTS_URL bo\'sh bo\'lsa xizmat o\'chirilgan hisoblanadi', () => {
    expect(isTtsEnabled()).toBe(false);
  });

  it('synthesize o\'chiq holda null qaytaradi — oqim buzilmaydi', async () => {
    expect(await synthesize('Hurmatli Aliyev V., marhamat.')).toBeNull();
  });
});

describe('concatWavBuffers — e\'lon audiolarini birlashtirish', () => {
  it('bo\'sh ro\'yxat bo\'sh buffer qaytaradi', () => {
    expect(concatWavBuffers([]).length).toBe(0);
    expect(concatWavBuffers([null, Buffer.alloc(10)]).length).toBe(0);
  });

  it('bitta buffer o\'zgarishsiz qaytadi', () => {
    const w = fakeWav(100);
    expect(concatWavBuffers([w])).toBe(w);
  });

  it('ikki audio birlashadi va bosh o\'lchamlari yangilanadi', () => {
    const a = fakeWav(100, 1);
    const b = fakeWav(200, 2);
    const out = concatWavBuffers([a, b]);
    expect(out.length).toBe(44 + 300);
    expect(out.readUInt32LE(4)).toBe(36 + 300);   // RIFF o'lchami
    expect(out.readUInt32LE(40)).toBe(300);       // data o'lchami
    // Format birinchidan olinadi
    expect(out.readUInt32LE(24)).toBe(24000);
    // Data ketma-ketligi saqlanadi
    expect(out.subarray(44, 144).every((x) => x === 1)).toBe(true);
    expect(out.subarray(144).every((x) => x === 2)).toBe(true);
  });

  it('juda qisqa (boshi yo\'q) bufferlar tashlab yuboriladi', () => {
    const out = concatWavBuffers([fakeWav(100), Buffer.alloc(20)]);
    expect(out.length).toBe(44 + 100);
  });
});
