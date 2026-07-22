const FaceCapture = (function () {
  class FaceCapture {
    constructor(options = {}) {
      this.videoEl = options.videoEl || null;
      this.canvasEl = options.canvasEl || null;
      this.statusEl = options.statusEl || null;
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
        return true;
      } catch (e) {
        this._setStatus(e.message || 'Kamera xatosi', 'error');
        return false;
      }
    }

    capture() {
      if (!this.videoEl || !this.canvasEl) return null;
      const canvas = this.canvasEl;
      canvas.width = this.videoEl.videoWidth || 640;
      canvas.height = this.videoEl.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(-1, 0, 0, 1, canvas.width, 0);
      ctx.drawImage(this.videoEl, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.9);
    }

    stop() {
      if (this.stream) {
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
      }
      if (this.videoEl) this.videoEl.srcObject = null;
    }

    _setStatus(msg, type) {
      if (this.statusEl) {
        this.statusEl.textContent = msg;
        const colors = { ready: 'text-emerald-400', error: 'text-red-400', loading: 'text-blue-400' };
        this.statusEl.className = 'text-sm mt-3 ' + (colors[type] || 'opacity-60');
      }
    }
  }
  return FaceCapture;
})();
