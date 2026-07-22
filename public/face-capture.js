/**
 * Face Capture Pipeline v3.0 — Medical AIOS
 * Liveness Detection: Challenge-Response + Motion Analysis + Texture Analysis
 *
 * 1. WebRTC kamera oqimi
 * 2. Yuz deteksiyasi (face-api.js)
 * 3. Random challenge (blink, head turn, move closer)
 * 4. Liveness score (challenges + motion + texture)
 * 5. Serverga yuborish
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FaceCapture = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
  const MIN_FACE_SIZE = 160;
  const MIN_CONFIDENCE = 0.7;

  const CHALLENGES = [
    { id: 'BLINK',        label: 'Ko\'zingizni qisib oching',      uz: 'Ko\'zingizni qisib oching',        duration: 4000, weight: 0.35 },
    { id: 'HEAD_LEFT',    label: 'Boshingizni chapga buring',      uz: 'Boshingizni chapga sekin buring',   duration: 4000, weight: 0.25 },
    { id: 'HEAD_RIGHT',   label: 'Boshingizni o\'ngga buring',     uz: 'Boshingizni o\'ngga sekin buring',  duration: 4000, weight: 0.25 },
    { id: 'MOVE_CLOSER',  label: 'Yuzingizni kameraga yaqinlashtiring', uz: 'Yuzingizni kameraga yaqinlashtiring', duration: 4000, weight: 0.15 }
  ];

  class FaceCapture {
    constructor(options = {}) {
      this.videoEl = options.videoEl || null;
      this.canvasEl = options.canvasEl || null;
      this.statusEl = options.statusEl || null;
      this.challengeEl = options.challengeEl || null;
      this.livenessEl = options.livenessEl || null;
      this.onCapture = options.onCapture || null;
      this.onError = options.onError || null;
      this.baseUrl = options.baseUrl || '';
      this.authToken = options.authToken || '';
      this.stream = null;
      this.faceApi = null;
      this.animationId = null;
      this.lastDescriptor = null;
      this.busy = false;

      // Liveness state
      this._frameBuffer = [];
      this._landmarkHistory = [];
      this._challengeResults = [];
      this._currentChallenge = null;
      this._challengeStart = 0;
      this._challengeActive = false;
      this._blinkCount = 0;
      this._eyeWasClosed = false;
      this._faceStartRatio = 0;
      this._headNeutralX = 0;
      this._livenessScore = 0;
      this._textureScores = [];
      this._deviceId = this._getDeviceId();
    }

    _getDeviceId() {
      try {
        let id = localStorage.getItem('fc_device_id');
        if (!id) {
          id = 'fc-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 10);
          localStorage.setItem('fc_device_id', id);
        }
        return id;
      } catch(e) { return 'unknown-' + Date.now(); }
    }

    async init() {
      try {
        this._setStatus('Yuklanmoqda...', 'loading');

        const module = await import('https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/dist/face-api.esm.js');
        this.faceApi = module;

        await this.faceApi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        await this.faceApi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        await this.faceApi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

        this._setStatus('Kamera sozlanmoqda...', 'loading');
        await this._startCamera();
        this._setStatus('Tayyor', 'ready');
        this._startDetectionLoop();
        return true;
      } catch (e) {
        this._handleError(e);
        return false;
      }
    }

    async _startCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Kamera qurilmasi topilmadi. Iltimos, kamerali qurilmadan foydalaning.');
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user', frameRate: { ideal: 30 } },
        audio: false
      });
      if (!this.videoEl) {
        this.videoEl = document.createElement('video');
        this.videoEl.setAttribute('autoplay', '');
        this.videoEl.setAttribute('playsinline', '');
        this.videoEl.style.cssText = 'width:100%;max-width:640px;border-radius:12px';
      }
      this.videoEl.srcObject = this.stream;
      return new Promise((resolve) => {
        this.videoEl.onloadedmetadata = () => {
          this.videoEl.play();
          if (this.canvasEl) {
            this.canvasEl.width = this.videoEl.videoWidth;
            this.canvasEl.height = this.videoEl.videoHeight;
          }
          resolve();
        };
      });
    }

    _startDetectionLoop() {
      let frameCount = 0;
      const detect = async () => {
        if (!this.videoEl || !this.faceApi) return;
        frameCount++;

        const options = new this.faceApi.TinyFaceDetectorOptions({ inputSize: MIN_FACE_SIZE, scoreThreshold: 0.5 });
        const result = await this.faceApi
          .detectSingleFace(this.videoEl, options)
          .withFaceLandmarks()
          .withFaceDescriptor();

        this._drawOverlay(result);

        if (result) {
          this.lastDescriptor = Array.from(result.descriptor);
          this._trackFrame(result);

          if (this._challengeActive) {
            this._evaluateChallenge(result);
          }

          const quality = this._assessQuality(result);
          this._setStatus(
            quality.valid
              ? (this._challengeActive ? this._currentChallenge?.uz || 'Harakatni bajaring' : 'Yuz aniqlandi')
              : quality.message,
            quality.valid ? (this._challengeActive ? 'challenge' : 'face-ok') : 'face-warn'
          );
        } else {
          if (!this._challengeActive) this._setStatus('Yuz topilmadi — kameraga qarating', 'waiting');
        }

        this.animationId = requestAnimationFrame(detect);
      };
      detect();
    }

    /** Har bir freymda landmarklarni va teksturani saqlash */
    _trackFrame(result) {
      const box = result.detection.box;
      const landmarks = result.landmarks;

      // Landmark history (head pose uchun)
      const nose = landmarks.getNose();
      const noseTip = nose[3]; // landmark 30 — burun uchi
      const leftEye = landmarks.getLeftEye();
      const rightEye = landmarks.getRightEye();

      const ear = this._eyeAspectRatio(leftEye, rightEye);
      const headX = noseTip.x / (this.videoEl?.videoWidth || 640);
      const interEyeDist = this._dist(leftEye[0], rightEye[3]);
      const faceWidth = box.width;

      this._landmarkHistory.push({
        t: Date.now(),
        ear,
        headX,
        interEyeRatio: interEyeDist / (faceWidth || 1),
        faceRatio: (box.width * box.height) / ((this.videoEl?.videoWidth || 640) * (this.videoEl?.videoHeight || 480)),
        boxWidth: box.width,
        boxX: box.x,
        score: result.detection.score
      });

      // Oxirgi 30 freymni saqlash
      if (this._landmarkHistory.length > 90) this._landmarkHistory.shift();

      // Blink detection (real-time)
      if (ear < 0.2 && !this._eyeWasClosed) {
        this._blinkCount++;
        this._eyeWasClosed = true;
      } else if (ear >= 0.22) {
        this._eyeWasClosed = false;
      }

      // Texture analysis (har 5-freymda)
      if (this._landmarkHistory.length % 5 === 0 && this.canvasEl) {
        this._sampleTexture();
      }
    }

    /** Freymdagi piksel o'zgaruvchanligini o'lchash (teksturani tahlil) */
    _sampleTexture() {
      const ctx = this.canvasEl?.getContext('2d');
      if (!ctx) return;
      try {
        const w = this.canvasEl.width;
        const h = this.canvasEl.height;
        const imageData = ctx.getImageData(Math.floor(w * 0.3), Math.floor(h * 0.2), Math.floor(w * 0.4), Math.floor(h * 0.6));
        const pixels = imageData.data;
        let sum = 0, sumSq = 0, count = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const gray = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
          sum += gray;
          sumSq += gray * gray;
          count++;
        }
        const mean = sum / count;
        const variance = sumSq / count - mean * mean;
        this._textureScores.push(Math.min(1, variance / 4000));
        if (this._textureScores.length > 10) this._textureScores.shift();
      } catch (e) { /* canvas tainted — skip */ }
    }

    // ===============================================================
    //  CHALLENGE-RESPONSE SYSTEM
    // ===============================================================

    /** Tasodifiy 2 ta challenge tanlash va ularni ketma-ket bajarish */
    async runChallenges() {
      if (this.busy) return false;
      this.busy = true;
      this._challengeResults = [];
      this._blinkCount = 0;
      this._landmarkHistory = [];

      // Tasodifiy 2 ta challenge (BLINK + bitta random)
      const candidates = CHALLENGES.filter(c => c.id !== 'BLINK');
      const shuffled = candidates.sort(() => Math.random() - 0.5);
      const selected = [CHALLENGES.find(c => c.id === 'BLINK'), shuffled[0]];

      for (const challenge of selected) {
        const ok = await this._runSingleChallenge(challenge);
        this._challengeResults.push({ id: challenge.id, completed: ok });
        if (!ok) {
          // Agar bitta challenge bajarilmasa, yana bir imkoniyat
          const retry = await this._runSingleChallenge(challenge);
          if (!retry) {
            this._challengeResults[this._challengeResults.length - 1].completed = false;
          } else {
            this._challengeResults[this._challengeResults.length - 1].completed = true;
          }
        }
      }

      this.busy = false;
      this._calculateLivenessScore();
      return this._livenessScore >= 0.5;
    }

    _runSingleChallenge(challenge) {
      return new Promise((resolve) => {
        this._currentChallenge = challenge;
        this._challengeActive = true;
        this._challengeStart = Date.now();
        this._challengeData = { done: false, startHistory: [...this._landmarkHistory] };

        // UI da challenge ko'rsatish
        this._showChallenge(challenge);

        // Challenge timeout
        const timeout = setTimeout(() => {
          this._challengeActive = false;
          this._currentChallenge = null;
          this._hideChallenge();
          resolve(this._challengeData.done);
        }, challenge.duration + 1000);

        // Challenge monitoring
        const check = () => {
          if (this._challengeData.done) {
            clearTimeout(timeout);
            this._challengeActive = false;
            this._currentChallenge = null;
            this._hideChallenge();
            resolve(true);
            return;
          }
          if (Date.now() - this._challengeStart < challenge.duration) {
            requestAnimationFrame(check);
          }
        };
        requestAnimationFrame(check);
      });
    }

    _evaluateChallenge(result) {
      if (!this._currentChallenge || this._challengeData.done) return;

      const history = this._landmarkHistory;
      const startIdx = history.findIndex(h => h.t >= this._challengeStart);
      const recent = startIdx >= 0 ? history.slice(startIdx) : history;
      if (recent.length < 3) return;

      const id = this._currentChallenge.id;

      if (id === 'BLINK') {
        // Challenge boshidan beri blinks soni
        const blinksDuring = this._blinkCount;
        if (blinksDuring >= 1) {
          this._challengeData.done = true;
        }
      }

      else if (id === 'HEAD_LEFT' || id === 'HEAD_RIGHT') {
        const first = recent[0];
        const last = recent[recent.length - 1];
        const deltaX = last.headX - first.headX;
        const dir = id === 'HEAD_LEFT' ? -0.04 : 0.04;
        if (Math.abs(deltaX) > 0.03 && Math.sign(deltaX) === Math.sign(dir)) {
          this._challengeData.done = true;
        }
      }

      else if (id === 'MOVE_CLOSER') {
        const first = recent[0];
        const last = recent[recent.length - 1];
        const ratioDelta = last.faceRatio - first.faceRatio;
        if (ratioDelta > 0.03) {
          this._challengeData.done = true;
        }
      }
    }

    _showChallenge(challenge) {
      if (this.challengeEl) {
        this.challengeEl.innerHTML = `
          <div class="fc-challenge-icon">${challenge.id === 'BLINK' ? '👁️' : challenge.id === 'MOVE_CLOSER' ? '📷' : '🔄'}</div>
          <div class="fc-challenge-text">${challenge.uz}</div>
          <div class="fc-challenge-timer"><div class="fc-challenge-bar" id="fc-challenge-bar"></div></div>`;
        this.challengeEl.classList.remove('hidden');
      }
      if (this.livenessEl) {
        this.livenessEl.innerHTML = `<span class="fc-liveness-dot progress"></span> Challenge ${this._challengeResults.length + 1}/2...`;
      }
    }

    _hideChallenge() {
      if (this.challengeEl) this.challengeEl.classList.add('hidden');
    }

    // ===============================================================
    //  LIVENESS SCORE CALCULATION
    // ===============================================================

    _calculateLivenessScore() {
      // 1. Challenge score (0.4 weight)
      const challengeScore = this._challengeResults.length > 0
        ? this._challengeResults.filter(r => r.completed).length / this._challengeResults.length
        : 0;

      // 2. Motion score (0.3 weight) — landmark stability vs natural movement
      const history = this._landmarkHistory;
      let motionScore = 0;
      if (history.length > 10) {
        const earVals = history.map(h => h.ear);
        const headXVals = history.map(h => h.headX);
        const earStd = this._stdDev(earVals);
        const headStd = this._stdDev(headXVals);
        // Natural movement = moderate variation (not zero, not chaotic)
        motionScore = Math.min(1, Math.max(0, (earStd * 10 + headStd * 50) / 2));
        // Static photo = near-zero variation
        if (motionScore < 0.05) motionScore = 0;
      }

      // 3. Texture score (0.3 weight) — live video has pixel noise
      const textureScore = this._textureScores.length > 0
        ? this._textureScores.reduce((a, b) => a + b, 0) / this._textureScores.length
        : 0;

      // Blink bonus: at least 1 blink during challenges
      const blinkBonus = this._blinkCount >= 1 ? 1 : (this._blinkCount > 0 ? 0.5 : 0);

      // Final score
      this._livenessScore =
        (challengeScore * 0.35) +
        (motionScore * 0.25) +
        (textureScore * 0.20) +
        (blinkBonus * 0.20);

      // Clamp
      this._livenessScore = Math.max(0, Math.min(1, this._livenessScore));

      this._setLivenessUI();
    }

    /** Rasm orqali aldashni aniqlash: challenge bajarilmagan + motion/texture past */
    isSpoof() {
      return this._livenessScore < 0.85;
    }

    // ===============================================================
    //  CAPTURE
    // ===============================================================

    async capture() {
      if (this.busy) return null;
      if (!this.lastDescriptor) {
        this._setStatus('Yuz aniqlanmadi — kameraga qarating', 'error');
        return null;
      }

      this._setStatus('Liveness tekshiruvi...', 'loading');

      // 1. Challenge-larni bajarish
      const challengesOk = await this.runChallenges();
      if (!challengesOk && this._livenessScore < 0.5) {
        this._setStatus('⚠️ Liveness tekshiruvi o\'tmadi. Qayta urinib ko\'ring.', 'error');
        return null;
      }

      // 2. Yakuniy sifat tekshiruvi
      this._setStatus('Yakuniy tekshiruv...', 'loading');
      const quality = await this._finalQualityCheck();
      if (!quality.ok) {
        this._setStatus(quality.message, 'error');
        return null;
      }

      const payload = {
        face_descriptor: this.lastDescriptor,
        liveness_score: parseFloat(this._livenessScore.toFixed(3)),
        nonce: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 10) + '-' + Math.random().toString(36).substring(2, 6),
        timestamp: Date.now(),
        device_id: this._deviceId
      };

      this._setStatus('✅ Tekshiruv muvaffaqiyatli', 'success');
      if (this.onCapture) this.onCapture(payload);
      return payload;
    }

    async _finalQualityCheck() {
      if (!this.faceApi || !this.videoEl) return { ok: false, message: 'Kamera ishga tushmagan' };
      const options = new this.faceApi.TinyFaceDetectorOptions({ inputSize: MIN_FACE_SIZE, scoreThreshold: 0.5 });
      const result = await this.faceApi.detectSingleFace(this.videoEl, options).withFaceLandmarks().withFaceDescriptor();
      if (!result) return { ok: false, message: 'Yuz topilmadi, qayta urinib ko\'ring' };
      const quality = this._assessQuality(result);
      if (!quality.valid) return { ok: false, message: quality.message };
      const allResults = await this.faceApi.detectAllFaces(this.videoEl, options).withFaceLandmarks();
      if (allResults.length > 1) return { ok: false, message: 'Kadrda bir nechta yuz bor — faqat o\'zingiz turing' };
      this.lastDescriptor = Array.from(result.descriptor);
      return { ok: true };
    }

    // ===============================================================
    //  API CALLS
    // ===============================================================

    async verify(extra = {}) {
      const payload = await this.capture();
      if (!payload) return null;
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (this.authToken) headers['Authorization'] = 'Bearer ' + this.authToken;
        const resp = await fetch(`${this.baseUrl}/api/face/verify`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...payload, ...extra })
        });
        return { ok: resp.ok, status: resp.status, data: await resp.json() };
      } catch (e) {
        this._handleError(e);
        return null;
      }
    }

    async registerPatient(patientInfo, extra = {}) {
      const payload = await this.capture();
      if (!payload) return null;
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (this.authToken) headers['Authorization'] = 'Bearer ' + this.authToken;
        const resp = await fetch(`${this.baseUrl}/api/face/register-patient`, {
          method: 'POST', headers,
          body: JSON.stringify({ ...patientInfo, ...payload, ...extra })
        });
        return { ok: resp.ok, status: resp.status, data: await resp.json() };
      } catch (e) {
        this._handleError(e);
        return null;
      }
    }

    getLivenessScore() { return this._livenessScore; }

    // ===============================================================
    //  QUALITY & UTILITY
    // ===============================================================

    _assessQuality(result) {
      const box = result.detection.box;
      const score = result.detection.score;
      const width = this.videoEl?.videoWidth || 640;
      const height = this.videoEl?.videoHeight || 480;
      const faceRatio = (box.width * box.height) / (width * height);
      if (faceRatio < 0.08) return { valid: false, message: 'Yuz juda kichik — yaqinroq keling', label: 'kichik' };
      if (faceRatio > 0.6) return { valid: false, message: 'Yuz juda katta — uzoqroq turing', label: 'katta' };
      if (score < MIN_CONFIDENCE) return { valid: false, message: 'Yuz aniq emas — kameraga to\'g\'ri qarang', label: 'aniq emas' };
      const cx = (box.x + box.width / 2) / width;
      const cy = (box.y + box.height / 2) / height;
      if (cx < 0.2 || cx > 0.8 || cy < 0.15 || cy > 0.75) return { valid: false, message: 'Yuzni markazga oling', label: 'chetda' };
      return { valid: true, message: '', label: 'yaxshi' };
    }

    _eyeAspectRatio(leftEye, rightEye) {
      if (!leftEye || !rightEye) return 0.3;
      const ear = (this._ear(leftEye) + this._ear(rightEye)) / 2;
      return ear;
    }

    _ear(eye) {
      const v1 = this._dist(eye[1], eye[5]);
      const v2 = this._dist(eye[2], eye[4]);
      const h = this._dist(eye[0], eye[3]);
      return (v1 + v2) / (2 * h || 1);
    }

    _dist(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }

    _stdDev(arr) {
      if (arr.length < 2) return 0;
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      return Math.sqrt(arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (arr.length - 1));
    }

    // ===============================================================
    //  OVERLAY
    // ===============================================================

    _drawOverlay(result) {
      if (!this.canvasEl) return;
      const ctx = this.canvasEl.getContext('2d');
      ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
      if (!result) return;

      const box = result.detection.box;
      const quality = this._assessQuality(result);
      const color = quality.valid ? '#3fb950' : '#f85149';
      const score = (result.detection.score * 100).toFixed(0);

      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.strokeRect(box.x, box.y, box.width, box.height);

      ctx.fillStyle = color;
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText(` ${score}%`, box.x + 4, box.y - 6);

      if (result.landmarks) {
        const positions = result.landmarks.positions;
        ctx.fillStyle = 'rgba(88, 166, 255, 0.6)';
        for (const p of positions) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // Head pose arrow
        const nose = result.landmarks.getNose();
        if (nose && nose[3]) {
          const tip = nose[3];
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(tip.x, tip.y);
          ctx.lineTo(tip.x + 20, tip.y - 20);
          ctx.stroke();
        }
      }
    }

    // ===============================================================
    //  UI HELPERS
    // ===============================================================

    _setStatus(msg, type) {
      if (this.statusEl) {
        this.statusEl.textContent = msg;
        this.statusEl.className = 'fc-status fc-status-' + type;
      }
    }

    _setLivenessUI() {
      if (!this.livenessEl) return;
      const pct = (this._livenessScore * 100).toFixed(0);
      const passed = this._livenessScore >= 0.85;
      const cls = passed ? 'active' : (this._livenessScore >= 0.5 ? 'progress' : '');
      this.livenessEl.innerHTML = `
        <span class="fc-liveness-dot ${cls}"></span>
        Liveness: <strong>${pct}%</strong>
        ${this._challengeResults.map(r => r.completed ? '✅' : '❌').join(' ')}
        ${passed ? '✅ Ishonchli' : (this._livenessScore < 0.5 ? '❌ Shubhali' : '⚠️ Yetarli emas')}`;
    }

    _handleError(e) {
      let msg = e.message || 'Noma\'lum xatolik';
      if (msg.includes('Permission') || msg.includes('permission')) msg = 'Kamera ruxsati berilmagan. Brauzer sozlamalarida kameraga ruxsat bering.';
      else if (msg.includes('NotFound') || msg.includes('not found')) msg = 'Kamera qurilmasi topilmadi.';
      else if (msg.includes('NotAllowed')) msg = 'Kamera ruxsati rad etildi. Sahifani qayta yuklab, ruxsat bering.';
      this._setStatus('⚠️ ' + msg, 'error');
      if (this.onError) this.onError(new Error(msg));
    }

    stop() {
      if (this.animationId) { cancelAnimationFrame(this.animationId); this.animationId = null; }
      if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
      if (this.videoEl) this.videoEl.srcObject = null;
    }

    destroy() { this.stop(); this.faceApi = null; }
  }

  return FaceCapture;
});
