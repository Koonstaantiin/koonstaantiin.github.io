    // =========================================================================
    // 2. WEB AUDIO API + DIRECT ./audio/*.wav LOADER & PLAYER (24kHz 16-BIT HD)
    // =========================================================================
    let audioCtx = null;

    function ensureAudioCtx() {
      try {
        if (!audioCtx) {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (Ctx) audioCtx = new Ctx();
        }
        if (audioCtx) {
          if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
          }
          const silentBuf = audioCtx.createBuffer(1, 1, 22050);
          const src = audioCtx.createBufferSource();
          src.buffer = silentBuf;
          src.connect(audioCtx.destination);
          src.start(0);
        }
      } catch (e) {}
    }

    function playTone(freq, durationMs, type = 'sine', gainVal = 0.12, delayMs = 0) {
      if (state.sfxMuted) return;
      try {
        ensureAudioCtx();
        if (!audioCtx) return;
        const startAt = audioCtx.currentTime + delayMs / 1000;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, startAt);
        gain.gain.setValueAtTime(gainVal, startAt);
        gain.gain.exponentialRampToValueAtTime(0.001, startAt + durationMs / 1000);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(startAt);
        osc.stop(startAt + durationMs / 1000);
      } catch (e) {}
    }

    function sfxStartListening() {
      if (navigator.vibrate) navigator.vibrate(40);
      playTone(587.33, 90, 'sine', 0.14, 0);
      playTone(880.0, 120, 'sine', 0.14, 95);
    }

    function sfxStopListening() {
      if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
      playTone(784.0, 80, 'triangle', 0.12, 0);
      playTone(523.25, 110, 'triangle', 0.12, 85);
    }

    function sfxAnswerReady() {
      playTone(523.25, 80, 'sine', 0.12, 0);
      playTone(659.25, 100, 'sine', 0.12, 85);
      playTone(783.99, 140, 'sine', 0.12, 175);
    }

    function sfxClarificationNeeded() {
      playTone(440, 140, 'sine', 0.15, 0);
      playTone(349.23, 220, 'sine', 0.15, 150);
    }

    // Soft "wait" cue for taps on a locked control — a silent dead button looks broken to a 5-year-old
    function sfxBusy() {
      if (navigator.vibrate) navigator.vibrate(25);
      playTone(330, 110, 'sine', 0.08, 0);
    }

    function startThinkingTicks() {
      stopThinkingTicks();
      thinkingTimer = setInterval(() => {
        playTone(660, 45, 'sine', 0.05, 0);
      }, 650);
    }

    function stopThinkingTicks() {
      if (thinkingTimer) {
        clearInterval(thinkingTimer);
        thinkingTimer = null;
      }
    }

    function base64ToRawPcmBytes(b64) {
      const binary = atob(b64);
      const isAlreadyRiffWav = binary.length > 44 && binary.slice(0, 4) === 'RIFF' && binary.slice(8, 12) === 'WAVE';
      const startOffset = isAlreadyRiffWav ? 44 : 0;
      const rawLen = binary.length - startOffset;
      const evenLen = rawLen - (rawLen % 2);
      const out = new Uint8Array(Math.max(0, evenLen));
      for (let i = 0; i < out.length; i++) {
        out[i] = binary.charCodeAt(startOffset + i);
      }
      return out;
    }

    function encodePcm24kInt16ToBase64(pcm24kBytes) {
      if (!pcm24kBytes || pcm24kBytes.byteLength === 0) return '';
      let binary = '';
      const chunkSize = 8192;
      for (let offset = 0; offset < pcm24kBytes.length; offset += chunkSize) {
        const slice = pcm24kBytes.subarray(offset, offset + chunkSize);
        binary += String.fromCharCode.apply(null, slice);
      }
      return btoa(binary);
    }

    // Loads static ./audio/*.wav files directly when hosted on GitHub Pages (No IndexedDB needed!)
    async function preloadStaticAudioFolderWavs() {
      // First load any baked Base64 prompts if present
      if (window.__BAKED_HD_PROMPTS_24K__) {
        Object.keys(window.__BAKED_HD_PROMPTS_24K__).forEach(k => {
          if (window.__BAKED_HD_PROMPTS_24K__[k]) {
            wavPcmBank24k[k] = base64ToRawPcmBytes(window.__BAKED_HD_PROMPTS_24K__[k]);
          }
        });
      }

      // Then fetch static ./audio/*.wav files directly if running over http/https (e.g., GitHub Pages)
      if (!location.protocol.startsWith('http')) {
        updateVoiceBankUiStatus();
        return;
      }

      const keys = Object.keys(SYSTEM_PROMPT_WAV_PATHS);
      await Promise.all(keys.map(async (k) => {
        if (wavPcmBank24k[k]) return;
        try {
          const res = await fetch('./' + SYSTEM_PROMPT_WAV_PATHS[k]);
          if (!res.ok) return;
          const arrayBuf = await res.arrayBuffer();
          if (arrayBuf.byteLength > 44) {
            const bytes = new Uint8Array(arrayBuf);
            const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
            wavPcmBank24k[k] = isRiff ? bytes.subarray(44) : bytes;
          }
        } catch (e) {}
      }));
      updateVoiceBankUiStatus();
    }

    // Plays one of the 6 system prompts directly from ./audio/*.wav (wavPcmBank24k) in 0.00s!
    async function playSystemPrompt(promptKey, { interruptCurrent = true, onEnded = null } = {}) {
      const text = SYSTEM_PROMPT_TEXTS[promptKey] || '';
      if (!text) {
        if (onEnded) onEnded();
        return;
      }

      if (interruptCurrent) {
        stopAllSpeech();
      }
      const myGenId = currentSpeechGenId;
      ensureAudioCtx();

      // 1. Instant 0.00s playback from loaded ./audio/*.wav PCM buffer (24 kHz, 16-bit HD)
      const pcmBytes = wavPcmBank24k[promptKey];
      if (pcmBytes && pcmBytes.byteLength > 0 && audioCtx) {
        try {
          if (audioCtx.state === 'suspended') await audioCtx.resume().catch(() => {});
          const audioBuf = pcmBytesToAudioBufferSync(pcmBytes, 24000);
          if (audioBuf) {
            const source = audioCtx.createBufferSource();
            source.buffer = audioBuf;
            source.connect(audioCtx.destination);

            activeAudioSources.push(source);
            const stopBtn = document.getElementById('btnStopSpeaking');
            if (stopBtn) stopBtn.classList.remove('hidden');

            source.onended = () => {
              if (myGenId === currentSpeechGenId) {
                if (stopBtn && appPhase === 'idle') stopBtn.classList.add('hidden');
                if (onEnded) onEnded();
              }
            };
            source.start(0);
            return;
          }
        } catch (e) {}
      }

      // 2. If not yet loaded from ./audio/*.wav and we have an API key, synthesize in 24kHz HD once!
      const apiKey = getActiveApiKey();
      if (apiKey && promptKey !== 'THINKING_FILLER') {
        const res = await fetchSegmentPcmWithStream(text, apiKey, myGenId, null);
        if (res.ok && res.pcmBytes && res.pcmBytes.byteLength > 0) {
          wavPcmBank24k[promptKey] = res.pcmBytes;
          updateVoiceBankUiStatus();
          if (myGenId === currentSpeechGenId) {
            return playSystemPrompt(promptKey, { interruptCurrent: false, onEnded });
          }
          return;
        }
      }

      // 3. Offline fallback if neither ./audio/*.wav nor API key is present
      sfxClarificationNeeded();
      if ('speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
          const utter = new SpeechSynthesisUtterance(text);
          utter.lang = 'uk-UA';
          utter.rate = 0.94;
          utter.pitch = 1.08;
          utter.onend = () => { if (onEnded) onEnded(); };
          utter.onerror = () => { if (onEnded) onEnded(); };
          window.speechSynthesis.speak(utter);
          return;
        } catch (e) {}
      }
      if (onEnded) onEnded();
    }

    function updateVoiceBankUiStatus() {
      const keys = Object.keys(SYSTEM_PROMPT_TEXTS);
      const readyCount = keys.filter(k => Boolean(wavPcmBank24k[k])).length;
      const statusEl = document.getElementById('voiceBankStatusText');

      if (statusEl) {
        if (readyCount === keys.length) {
          statusEl.textContent = `✅ Усі ${readyCount}/6 WAV-файлів (24 кГц, 16-біт HD) готові! Натисніть «🎵 Скачати 6 .wav файлів окремо», щоб покласти їх у папку audio/.`;
          statusEl.className = 'text-[11px] text-emerald-300 font-semibold mt-0.5';
        } else {
          statusEl.textContent = `🔊 Готово у пам'яті: ${readyCount}/6 WAV-файлів (24 кГц, 16-біт). Натисніть «🎙️ Озвучити 6 фраз у банк» перед скачуванням для GitHub.`;
          statusEl.className = 'text-[11px] text-amber-200 mt-0.5';
        }
      }

      document.querySelectorAll('.prompt-preview-btn').forEach(btn => {
        const k = btn.getAttribute('data-prompt-key');
        const hasAudio = Boolean(wavPcmBank24k[k]);
        btn.classList.toggle('border-emerald-600/80', hasAudio);
        btn.classList.toggle('bg-emerald-950/50', hasAudio);
      });
    }

    async function ensureSystemVoiceBankPopulated(playReadyIntroWhenDone = false, fullAllSix = false) {
      const apiKey = getActiveApiKey();
      if (!apiKey || isGeneratingVoiceBank) return;

      const targetList = fullAllSix
        ? ['READY_INTRO', 'THINKING_FILLER', 'NEXT_ACTION_HINT', 'LISTENING_HINT', 'NO_KEY', 'DAILY_LIMIT']
        : ['READY_INTRO', 'THINKING_FILLER', 'NEXT_ACTION_HINT'];

      const missingKeys = targetList.filter(k => !wavPcmBank24k[k]);
      updateVoiceBankUiStatus();

      if (missingKeys.length === 0) {
        if (playReadyIntroWhenDone) {
          playSystemPrompt('READY_INTRO', { interruptCurrent: true });
        }
        return;
      }

      isGeneratingVoiceBank = true;
      const genBtn = document.getElementById('btnGenerateVoiceBankNow');
      if (genBtn) genBtn.textContent = '⏳ Генерую 24 кГц WAV...';

      try {
        for (let i = 0; i < missingKeys.length; i++) {
          const k = missingKeys[i];
          const text = SYSTEM_PROMPT_TEXTS[k];
          // null genId: playing/stopping speech (voice test, prompt preview) must not abort the bank
          const res = await fetchSegmentPcmWithStream(text, apiKey, null, null);
          if (res.ok && res.pcmBytes && res.pcmBytes.byteLength > 0) {
            wavPcmBank24k[k] = res.pcmBytes;
            updateVoiceBankUiStatus();

            if (k === 'READY_INTRO' && playReadyIntroWhenDone && appPhase === 'idle') {
              playSystemPrompt('READY_INTRO', { interruptCurrent: true });
            }
          }
          await new Promise(r => setTimeout(r, 250));
        }
      } finally {
        isGeneratingVoiceBank = false;
        const doneCount = Object.keys(SYSTEM_PROMPT_TEXTS).filter(k => Boolean(wavPcmBank24k[k])).length;
        if (genBtn) genBtn.textContent = doneCount === 6 ? '✅ 6/6 WAV готові' : `🎙️ Озвучити 6 фраз у банк (${doneCount}/6)`;
        updateVoiceBankUiStatus();
      }
    }

    // =========================================================================
    // 2B. GITHUB PAGES + PWA + ./audio/*.wav EXPORTER (INDIVIDUAL FILES)
    // =========================================================================
    function buildPwaIconSvgString() {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="115" fill="#0f172a"/>
  <rect x="96" y="88" width="320" height="360" rx="56" fill="#1e293b" stroke="#f59e0b" stroke-width="16"/>
  <rect x="148" y="28" width="36" height="68" rx="18" fill="#f59e0b"/>
  <circle cx="256" cy="280" r="88" fill="#f59e0b"/>
  <path d="M256 226a26 26 0 0 0-26 26v36a26 26 0 0 0 52 0v-36a26 26 0 0 0-26-26zm46 62a46 46 0 0 1-92 0m46 46v24m-24 0h48" stroke="#0f172a" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="204" cy="148" r="10" fill="#34d399"/>
  <circle cx="256" cy="148" r="10" fill="#34d399"/>
  <circle cx="308" cy="148" r="10" fill="#34d399"/>
</svg>`;
    }

    function buildPwaManifestJsonString() {
      return JSON.stringify({
        name: "Чомучка-Рація — Дитячий голосовий помічник",
        short_name: "Чомучка",
        description: "Безекранна голосова рація для дитини 5 років із віковими запобіжниками",
        start_url: "./index.html",
        scope: "./",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0f172a",
        theme_color: "#0f172a",
        lang: "uk",
        icons: [
          {
            src: "./icon.svg",
            sizes: "192x192 512x512",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      }, null, 2);
    }

    // Static app files next to index.html (styles, scripts, fonts) — included in GitHub exports
    const APP_ASSET_PATHS = [
      'css/utilities.css',
      'css/styles.css',
      'js/state.js',
      'js/audio.js',
      'js/api.js',
      'js/tts.js',
      'js/gemini.js',
      'js/pipeline.js',
      'js/recording.js',
      'js/ui.js',
      'fonts/inter-latin-wght-normal.woff2',
      'fonts/inter-cyrillic-wght-normal.woff2'
    ];

    async function fetchAppAssetBytes(path) {
      const res = await fetch('./' + path);
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    }

    function buildPwaServiceWorkerJsString() {
      return `const CACHE_NAME = 'chomuchka-pwa-v5';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './css/utilities.css',
  './css/styles.css',
  './js/state.js',
  './js/audio.js',
  './js/api.js',
  './js/tts.js',
  './js/gemini.js',
  './js/pipeline.js',
  './js/recording.js',
  './js/ui.js',
  './fonts/inter-latin-wght-normal.woff2',
  './fonts/inter-cyrillic-wght-normal.woff2',
  './audio/no_key.wav',
  './audio/ready_intro.wav',
  './audio/listening_hint.wav',
  './audio/thinking_filler.wav',
  './audio/next_action_hint.wav',
  './audio/daily_limit.wav'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
`;
    }

    function buildCleanIndexHtmlBytesForGithub() {
      const clone = document.documentElement.cloneNode(true);
      const quickIn = clone.querySelector('#quickApiKeyInput');
      if (quickIn) quickIn.value = '';
      const settingsIn = clone.querySelector('#apiKeyInput');
      if (settingsIn) settingsIn.value = '';
      const bakedScript = clone.querySelector('#bakedConfigScript');
      if (bakedScript) {
        // Strip API key and inline Base64 so GitHub index.html is 100% clean & safe and loads ./audio/*.wav directly!
        bakedScript.textContent = `\n    window.__BAKED_API_KEY__ = "";\n    window.__BAKED_HD_PROMPTS_24K__ = {};\n  `;
      }
      const htmlStr = '<!DOCTYPE html>\n' + clone.outerHTML;
      return new TextEncoder().encode(htmlStr);
    }

    function triggerBlobDownload(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 6000);
    }

    async function downloadSixWavFilesIndividually() {
      const apiKey = getActiveApiKey();
      const readyCount = Object.keys(SYSTEM_PROMPT_TEXTS).filter(k => Boolean(wavPcmBank24k[k])).length;
      if (apiKey && readyCount < 6) {
        showToast('⏳ Спочатку генерую всі 6 WAV-файлів у 24 кГц HD...');
        await ensureSystemVoiceBankPopulated(false, true);
      }

      const keys = Object.keys(SYSTEM_PROMPT_WAV_PATHS);
      let downloaded = 0;
      for (const k of keys) {
        if (!wavPcmBank24k[k]) continue;
        const wavBuf = pcmBytesToWavArrayBuffer(wavPcmBank24k[k], 24000);
        const fileName = SYSTEM_PROMPT_WAV_PATHS[k].split('/').pop();
        triggerBlobDownload(new Blob([wavBuf], { type: 'audio/wav' }), fileName);
        downloaded++;
        await new Promise(r => setTimeout(r, 550));
      }
      if (downloaded > 0) {
        showToast(`✅ Скачано ${downloaded} файлів .wav! Покладіть їх у папку audio/ вашого репозиторію.`);
      } else {
        showToast('Спочатку введіть API-ключ і натисніть «🎙️ Озвучити 6 фраз у банк»');
      }
    }

    async function downloadPwaCoreFilesOnly() {
      const enc = new TextEncoder();
      triggerBlobDownload(new Blob([buildCleanIndexHtmlBytesForGithub()], { type: 'text/html;charset=utf-8' }), 'index.html');
      await new Promise(r => setTimeout(r, 450));
      triggerBlobDownload(new Blob([enc.encode(buildPwaManifestJsonString())], { type: 'application/json' }), 'manifest.json');
      await new Promise(r => setTimeout(r, 450));
      triggerBlobDownload(new Blob([enc.encode(buildPwaServiceWorkerJsString())], { type: 'application/javascript' }), 'sw.js');
      await new Promise(r => setTimeout(r, 450));
      triggerBlobDownload(new Blob([enc.encode(buildPwaIconSvgString())], { type: 'image/svg+xml' }), 'icon.svg');
      showToast('✅ Скачано index.html (без ключа), manifest.json, sw.js та icon.svg!');
    }

    async function exportSelfBakedHtmlFile() {
      const apiKey = getActiveApiKey();
      const readyCount = Object.keys(SYSTEM_PROMPT_TEXTS).filter(k => Boolean(wavPcmBank24k[k])).length;
      if (apiKey && readyCount < 6) {
        showToast('⏳ Догенеровую всі 6 фраз у 24 кГц HD перед вшиванням...');
        await ensureSystemVoiceBankPopulated(false, true);
      }

      const b64Map = {};
      Object.keys(wavPcmBank24k).forEach(k => {
        if (wavPcmBank24k[k]) {
          b64Map[k] = encodePcm24kInt16ToBase64(wavPcmBank24k[k]);
        }
      });

      const bakedScriptEl = document.getElementById('bakedConfigScript');
      if (bakedScriptEl) {
        bakedScriptEl.textContent = `\n    window.__BAKED_API_KEY__ = ${JSON.stringify(apiKey || '')};\n    window.__BAKED_HD_PROMPTS_24K__ = ${JSON.stringify(b64Map)};\n  `;
      }

      // Inline ./css/*.css (with fonts as data URIs) and ./js/*.js so the downloaded HTML stays a single self-contained file
      const clone = document.documentElement.cloneNode(true);
      const dec = new TextDecoder();
      for (const linkEl of clone.querySelectorAll('link[rel="stylesheet"][href^="./css/"]')) {
        let cssText = dec.decode(await fetchAppAssetBytes(linkEl.getAttribute('href').slice(2)));
        for (const fontPath of APP_ASSET_PATHS.filter(p => p.startsWith('fonts/'))) {
          const fontBytes = await fetchAppAssetBytes(fontPath);
          let bin = '';
          for (let i = 0; i < fontBytes.length; i += 0x8000) {
            bin += String.fromCharCode.apply(null, fontBytes.subarray(i, i + 0x8000));
          }
          cssText = cssText.split(`../${fontPath}`).join(`data:font/woff2;base64,${btoa(bin)}`);
        }
        const styleEl = document.createElement('style');
        styleEl.textContent = cssText;
        linkEl.replaceWith(styleEl);
      }
      for (const scriptEl of clone.querySelectorAll('script[src^="./js/"]')) {
        const inlineEl = document.createElement('script');
        inlineEl.textContent = dec.decode(await fetchAppAssetBytes(scriptEl.getAttribute('src').slice(2)));
        scriptEl.replaceWith(inlineEl);
      }

      const fullHtml = '<!DOCTYPE html>\n' + clone.outerHTML;
      triggerBlobDownload(new Blob([fullHtml], { type: 'text/html;charset=utf-8' }), 'chomuchka_walkie_talkie_local_full.html');
      showToast('✅ Локальний HTML-файл (із вшитим ключем та голосами) збережено!');
    }

    function pcmBytesToWavArrayBuffer(pcmBytes, sampleRate = 24000) {
      const pcmLen = pcmBytes.byteLength - (pcmBytes.byteLength % 2);
      const wavBuffer = new ArrayBuffer(44 + pcmLen);
      const view = new DataView(wavBuffer);

      function writeStr(offset, str) {
        for (let i = 0; i < str.length; i++) {
          view.setUint8(offset + i, str.charCodeAt(i));
        }
      }

      writeStr(0, 'RIFF');
      view.setUint32(4, 36 + pcmLen, true);
      writeStr(8, 'WAVE');
      writeStr(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeStr(36, 'data');
      view.setUint32(40, pcmLen, true);

      const dest = new Uint8Array(wavBuffer, 44);
      dest.set(pcmBytes.subarray(0, pcmLen));
      return wavBuffer;
    }

    function concatPcmByteArrays(arrays, silenceGapMs = 70, sampleRate = 24000) {
      if (!arrays.length) return new Uint8Array(0);
      if (arrays.length === 1) return arrays[0];
      const gapSamples = Math.floor((sampleRate * silenceGapMs) / 1000);
      const gapBytes = gapSamples * 2;
      let totalLen = 0;
      for (let i = 0; i < arrays.length; i++) {
        totalLen += arrays[i].byteLength;
        if (i < arrays.length - 1) totalLen += gapBytes;
      }
      const merged = new Uint8Array(totalLen);
      let offset = 0;
      for (let i = 0; i < arrays.length; i++) {
        merged.set(arrays[i], offset);
        offset += arrays[i].byteLength;
        if (i < arrays.length - 1) {
          offset += gapBytes;
        }
      }
      return merged;
    }

    function pcmBytesToAudioBufferSync(pcmBytes, sampleRate = 24000) {
      ensureAudioCtx();
      if (!audioCtx) return null;
      const numSamples = Math.floor(pcmBytes.byteLength / 2);
      if (numSamples <= 0) return null;
      const audioBuffer = audioCtx.createBuffer(1, numSamples, sampleRate);
      const channelData = audioBuffer.getChannelData(0);
      const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
      for (let i = 0; i < numSamples; i++) {
        const int16 = view.getInt16(i * 2, true);
        channelData[i] = int16 / 32768.0;
      }
      return audioBuffer;
    }

