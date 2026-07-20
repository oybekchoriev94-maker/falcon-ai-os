const http = require('http');
const rate = 8000, duration = 1, freq = 440;
const samples = rate * duration;
const buf = Buffer.alloc(44 + samples * 2);
let off = 0;
off = buf.write('RIFF', off); off = buf.writeUInt32LE(36 + samples * 2, off); off = buf.write('WAVE', off);
off = buf.write('fmt ', off); off = buf.writeUInt32LE(16, off); off = buf.writeUInt16LE(1, off);
off = buf.writeUInt16LE(1, off); off = buf.writeUInt32LE(rate, off); off = buf.writeUInt32LE(rate * 2, off);
off = buf.writeUInt16LE(2, off); off = buf.writeUInt16LE(16, off);
off = buf.write('data', off); buf.writeUInt32LE(samples * 2, off);
for (let i = 0; i < samples; i++) {
  buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * i / rate) * 16000), 44 + i * 2);
}
const body = JSON.stringify({ audio_base64: buf.toString('base64'), language: 'uz' });
const req = http.request({ hostname: 'localhost', port: 3000, path: '/api/ai/transcribe', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': 'Bearer test' }}, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => console.log(res.statusCode, JSON.stringify(JSON.parse(data), null, 2)));
});
req.write(body);
req.end();
