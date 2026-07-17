import { speak, speakStreaming } from './tts.js';

const TTS_CHUNK_BOUNDARY = /[.?!,\n]/;

export class FalconTTSStreamer {
  constructor(options = {}) {
    this.ttsProvider = options.ttsProvider || 'openai';
    this.voice = options.voice || 'alloy';
    this.speed = options.speed || 1.0;
    this.model = options.model || 'tts-1';
  }

  async *processTextChunks(textGenerator) {
    let buffer = '';

    for await (const textChunk of textGenerator) {
      buffer += textChunk;

      if (TTS_CHUNK_BOUNDARY.test(textChunk)) {
        const clean = buffer.trim();
        if (clean) {
          const audioChunk = await this._generateAudioChunk(clean);
          if (audioChunk) yield audioChunk;
          buffer = '';
        }
      }
    }

    if (buffer.trim()) {
      const audioChunk = await this._generateAudioChunk(buffer.trim());
      if (audioChunk) yield audioChunk;
    }
  }

  async _generateAudioChunk(text) {
    return speak(text, {
      voice: this.voice,
      speed: this.speed,
      model: this.model,
      format: 'mp3'
    });
  }
}

export async function* agentTextToSpeech(agentResponseGenerator, options = {}) {
  const streamer = new FalconTTSStreamer(options);
  yield* streamer.processTextChunks(agentResponseGenerator);
}
