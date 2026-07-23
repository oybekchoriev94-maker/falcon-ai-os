const FaceCapture = (function () {
  class FaceCapture {
    constructor(options = {}) {
      this.videoEl = options.videoEl || null;
      this.canvasEl = options.canvasEl || null;
      this.statusEl = options.statusEl || null;
      this.challengeEl = options.challengeEl || null;
      this.livenessEl = options.livenessEl || null;
      this.baseUrl = options.baseUrl || '';
      this.onCapture = typeof options.onCapture === 'function' ? options.onCapture : null;
      this.stream = null;
    }

    async init() {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error('Kamera topilmadi');
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: false,
        });
        if (this.videoEl) {
          this.videoEl.srcObject = this.stream;
          this.videoEl.setAttribute('autoplay', '');
          this.videoEl.setAttribute('playsinline', '');
          await this.videoEl.play();
        }
        if (this.canvasEl) {
          this.canvasEl.width = this.videoEl?.videoWidth || 640;
          this.canvasEl.height = this.videoEl?.videoHeight || 480;
        }
        this._setStatus('Tayyor', 'ready');
        this._setLivenessDot('active');
        return true;
      } catch (e) {
        this._setStatus(e.message || 'Kamera xatosi', 'error');
        this._setLivenessDot('inactive');
        return false;
      }
    }

    /**
     * Capture a photo and optionally extract face descriptor via /extract API.
     * 
     * @param {Object} [opts] - Optional overrides
     * @param {boolean} [opts.skipExtract=false] - If true, skip API call, return raw photo only
     * @returns {Promise<string|Object>} 
     *   - If skipExtract: returns base64 data URL string
     *   - If onCapture callback set: calls onCapture(payload), returns payload
     *   - Otherwise: returns { photo_base64, face_descriptor, liveness_score, nonce, timestamp }
     */
    async capture(opts = {}) {
      if (!this.videoEl || !this.canvasEl) {
        this._setStatus('Kamera mavjud emas', 'error');
        return null;
      }
      const canvas = this.canvasEl;
      canvas.width = this.videoEl.videoWidth || 640;
      canvas.height = this.videoEl.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(-1, 0, 0, 1, canvas.width, 0);
      ctx.drawImage(this.videoEl, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const photoBase64 = canvas.toDataURL('image/jpeg', 0.9);

      // If skipExtract, just return the raw photo (legacy mode)
      if (opts.skipExtract) {
        return photoBase64;
      }

      this._setStatus('Yuz tahlil qilinmoqda...', 'loading');
      this._setLivenessDot('progress');

      try {
        const nonce = crypto.randomUUID
          ? crypto.randomUUID()
          : Date.now().toString(36) + '-' + Math.random().toString(36).substring(2);
        const timestamp = Date.now();

        const resp = await fetch(this.baseUrl + '/api/face/extract', {
          method: 'POST',
          headers: this._getAuthHeaders(),
          body: JSON.stringify({
            photo_base64: photoBase64,
            nonce,
            timestamp,
          }),
          signal: AbortSignal.timeout(20000),
        });

        if (!resp.ok) {
          let errMsg = 'Yuz aniqlanmadi';
          try {
            const errData = await resp.json();
            errMsg = errData.error || errMsg;
          } catch (_) {}
          this._setStatus(errMsg, 'error');
          this._setLivenessDot('inactive');
          return null;
        }

        const data = await resp.json();
        if (!data.success || !data.face_descriptor) {
          this._setStatus('Yuz aniqlanmadi', 'error');
          this._setLivenessDot('inactive');
          return null;
        }

        const payload = {
          face_descriptor: data.face_descriptor,
          liveness_score: data.liveness_score ?? 0.5,
          nonce,
          timestamp,
        };

        this._setStatus('✅ Yuz aniqlandi', 'success');
        this._setLivenessDot('active');

        if (this.onCapture) {
          this.onCapture(payload);
        }

        return payload;
      } catch (e) {
        if (e.name === 'AbortError') {
          this._setStatus("So'rov vaqti tugadi", 'error');
        } else {
          this._setStatus('Xatolik: ' + (e.message || 'Serverga ulanmadi'), 'error');
        }
        this._setLivenessDot('inactive');
        return null;
      }
    }

    stop() {
      if (this.stream) {
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
      }
      if (this.videoEl) this.videoEl.srcObject = null;
    }

    _getAuthHeaders() {
      const headers = { 'Content-Type': 'application/json' };
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('falcon_token') : null;
      if (token) headers['Authorization'] = 'Bearer ' + token;
      return headers;
    }

    _setStatus(msg, type) {
      if (this.statusEl) {
        this.statusEl.textContent = msg;
        const colors = {
          ready: 'text-emerald-400',
          error: 'text-red-400',
          loading: 'text-blue-400',
          success: 'text-emerald-400',
          warning: 'text-yellow-400',
        };
        this.statusEl.className = 'text-sm mt-3 ' + (colors[type] || 'opacity-60');
      }
    }

    _setLivenessDot(state) {
      if (this.livenessEl) {
        const dot = this.livenessEl.querySelector('.fc-liveness-dot');
        if (dot) {
          dot.className = 'fc-liveness-dot';
          if (state === 'active') dot.classList.add('active');
          else if (state === 'progress') dot.classList.add('progress');
        }
      }
    }
  }
  return FaceCapture;
})();
