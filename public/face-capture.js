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
     * Capture a single video frame as a JPEG.
     *
     * Server-authoritative model: the browser NEVER runs face ML and NEVER
     * receives the descriptor. It only sends this photo to the photo-based
     * endpoints (/verify-photo, /register-patient-photo, /register-photo),
     * where the server extracts the descriptor, checks liveness and matches.
     * This removes the descriptor-substitution / liveness-forgery attack.
     *
     * @returns {{ photo_base64: string, nonce: string, timestamp: number } | null}
     *   Also invokes the onCapture callback with the same payload when set.
     */
    capture() {
      if (!this.videoEl || !this.canvasEl) {
        this._setStatus('Kamera mavjud emas', 'error');
        return null;
      }
      if (!this.videoEl.videoWidth) {
        this._setStatus('Kamera hali tayyor emas, biroz kuting', 'error');
        return null;
      }
      const canvas = this.canvasEl;
      canvas.width = this.videoEl.videoWidth;
      canvas.height = this.videoEl.videoHeight;
      const ctx = canvas.getContext('2d');
      // Ko'zguga o'xshab ko'rsatilgani uchun saqlashda ham gorizontal aylantiramiz
      ctx.setTransform(-1, 0, 0, 1, canvas.width, 0);
      ctx.drawImage(this.videoEl, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const photoBase64 = canvas.toDataURL('image/jpeg', 0.9);

      const nonce =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : Date.now().toString(36) + '-' + Math.random().toString(36).substring(2);
      const timestamp = Date.now();
      const payload = { photo_base64: photoBase64, nonce, timestamp };

      if (this.onCapture) this.onCapture(payload);
      return payload;
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
