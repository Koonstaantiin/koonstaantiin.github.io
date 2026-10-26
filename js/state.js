    // =========================================================================
    // 1. STATE, PERSISTENCE & DIRECT ./audio/*.wav FILE MAPPING (NO INDEXEDDB)
    // =========================================================================
    const STORAGE_KEY = 'chomuchka_app_state_v4';

    // 6 Child-Friendly Voice Prompts & their static ./audio/*.wav paths on GitHub Pages
    const SYSTEM_PROMPT_TEXTS = {
      NO_KEY: 'Привіт, малюк! Поклич, будь ласка, маму або тата, щоб вони увімкнули мені чарівний ключик!',
      READY_INTRO: 'Привіт! Я Чомучка! Натисни велику жовту кнопку, спитай мене що хочеш, а потім натисни червону кнопку!',
      LISTENING_HINT: 'Я слухаю тебе! Кажи своє питання і тисни велику червону кнопку!',
      THINKING_FILLER: 'Ого, яке цікаве питання! Хвилиночку, рація вже питає у космічного супутника...',
      NEXT_ACTION_HINT: 'Хочеш послухати ще раз — натисни синю кнопку знизу. А щоб спитати нове — тисни велику жовту кнопку!',
      DAILY_LIMIT: 'Ой, мої батарейки на сьогодні вже втомилися і лягають спати! Пограємося завтра!'
    };

    const SYSTEM_PROMPT_WAV_PATHS = {
      NO_KEY: 'audio/no_key.wav',
      READY_INTRO: 'audio/ready_intro.wav',
      LISTENING_HINT: 'audio/listening_hint.wav',
      THINKING_FILLER: 'audio/thinking_filler.wav',
      NEXT_ACTION_HINT: 'audio/next_action_hint.wav',
      DAILY_LIMIT: 'audio/daily_limit.wav'
    };

    // Holds raw 24 kHz 16-bit PCM Uint8Arrays loaded directly from ./audio/*.wav (or generated in Canvas)
    const wavPcmBank24k = {};
    let isGeneratingVoiceBank = false;
    let hasPlayedStartupGreeting = false;
    let listeningSilenceHintTimer = null;

    // Register Service Worker when hosted on GitHub Pages (http/https)
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.protocol === 'http:')) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }

    const defaultState = {
      apiKey: window.__BAKED_API_KEY__ || '',
      model: 'gemini-3.8-flash',
      ttsEngine: 'auto',
      languagePolicy: 'always_uk',
      childAge: '5',
      dailyLimit: 15,
      usedToday: 0,
      showScreenText: true,
      sfxMuted: false,
      familyNote: '',
      sensitiveTopics: [
        'Анатомія 18+ та звідки беруться діти',
        'Смерть, хвороби та страшилки',
        'Війна, зброя та насильство',
        'Релігія, політика та гроші сім\'ї'
      ],
      logs: []
    };

    let lockedApiKey = window.__BAKED_API_KEY__ || window.__CHOMUCHKA_KEY__ || '';
    let isEditingKeyManually = false;

    let state = loadStateSync();
    if (state.apiKey && state.apiKey.length >= 10) {
      lockedApiKey = state.apiKey;
      window.__CHOMUCHKA_KEY__ = lockedApiKey;
    }

    let isRecording = false;
    let isStartingMic = false;
    let recordingSessionId = 0;
    let actualRecordingStartTime = 0;
    let lastPttActionTimestamp = 0;
    let recordingTimerInterval = null;
    let isProcessingTurn = false;
    let currentTurnId = 0;
    let activeTurnAbortController = null;
    // Walkie phase drives control locks: idle | recording | finishing | thinking | speaking
    let appPhase = 'idle';
    let phaseEnteredAt = 0;
    let mediaRecorder = null;
    let activeStream = null;
    let audioChunks = [];
    let speechRecognition = null;
    let liveInterimTranscript = '';
    let thinkingTimer = null;
    let speechWatchdogTimer = null;
    let maxRecordTimer = null;
    let micAnalyserInterval = null;

    let currentSpeechGenId = 0;
    let activeAudioSources = [];
    let activeTtsAbortControllers = [];
    let activeHtmlAudio = null;
    const HTML_AUDIO_PLAYER_IDS = ['mainAudioPlayerEl', 'ttsAudioPlayerEl'];
    let cachedWorkingTtsConfig = null;
    let lastFirstAudioLatencySec = null;
    const ttsReplayCache = new Map();

    let lastTtsDiagnosticMsg = '';
    let discoveredTtsModels = [];
    let discoveredTextModels = [];
    let lastSpokenResponse = SYSTEM_PROMPT_TEXTS.READY_INTRO;

    let currentMathExpected = 42;
    let lastMathPair = '';

    function generateNewMathChallenge() {
      let a = 6;
      let b = 7;
      for (let attempt = 0; attempt < 12; attempt++) {
        a = Math.floor(Math.random() * 7) + 3;
        b = Math.floor(Math.random() * 7) + 3;
        const pairKey = `${a}x${b}`;
        if (pairKey !== lastMathPair) {
          lastMathPair = pairKey;
          break;
        }
      }
      currentMathExpected = a * b;
      const el = document.getElementById('mathChallengeText');
      if (el) el.textContent = `${a} × ${b} = ?`;
    }

    function loadStateSync() {
      let raw = null;
      try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
      if (!raw) {
        try { raw = sessionStorage.getItem(STORAGE_KEY); } catch (e) {}
      }
      if (!raw && window.name && window.name.startsWith('{')) {
        raw = window.name;
      }
      if (!raw) return JSON.parse(JSON.stringify(defaultState));
      try {
        const parsed = Object.assign({}, JSON.parse(JSON.stringify(defaultState)), JSON.parse(raw));
        if (!parsed.model || parsed.model.startsWith('gemini-2.')) {
          parsed.model = 'gemini-3.8-flash';
        }
        if (!parsed.apiKey && window.__BAKED_API_KEY__) {
          parsed.apiKey = window.__BAKED_API_KEY__;
        }
        return parsed;
      } catch (e) {
        return JSON.parse(JSON.stringify(defaultState));
      }
    }

    function saveState() {
      if (!state.apiKey && lockedApiKey) {
        state.apiKey = lockedApiKey;
      }
      const serialized = JSON.stringify(state);
      try { localStorage.setItem(STORAGE_KEY, serialized); } catch (e) {}
      try { sessionStorage.setItem(STORAGE_KEY, serialized); } catch (e) {}
      try { window.name = serialized; } catch (e) {}
    }

    function getActiveApiKey() {
      const quickEl = document.getElementById('quickApiKeyInput');
      const settingsEl = document.getElementById('apiKeyInput');
      const fromQuick = quickEl ? quickEl.value.replace(/[\s"']/g, '') : '';
      const fromSettings = settingsEl ? settingsEl.value.replace(/[\s"']/g, '') : '';

      const candidate = (fromQuick.length >= 10 ? fromQuick : '') ||
                        (fromSettings.length >= 10 ? fromSettings : '') ||
                        lockedApiKey ||
                        (window.__BAKED_API_KEY__ || '') ||
                        (state.apiKey || '').replace(/[\s"']/g, '');

      if (candidate && candidate.length >= 10) {
        lockedApiKey = candidate;
        window.__CHOMUCHKA_KEY__ = candidate;
        if (state.apiKey !== candidate) {
          state.apiKey = candidate;
          saveState();
        }
        if (quickEl && !isEditingKeyManually && quickEl.value !== candidate) {
          quickEl.value = candidate;
        }
        if (settingsEl && !isEditingKeyManually && settingsEl.value !== candidate) {
          settingsEl.value = candidate;
        }
      }
      return lockedApiKey || '';
    }

    function syncApiKeyInputs(newKey, collapseQuickCard = false) {
      const cleaned = (newKey || '').replace(/[\s"']/g, '');

      if (cleaned.length < 10 && lockedApiKey) {
        const quickEl = document.getElementById('quickApiKeyInput');
        const settingsEl = document.getElementById('apiKeyInput');
        if (quickEl && !isEditingKeyManually) quickEl.value = lockedApiKey;
        if (settingsEl && !isEditingKeyManually) settingsEl.value = lockedApiKey;
        if (collapseQuickCard) {
          isEditingKeyManually = false;
        }
        updateDiagnosticsBar(collapseQuickCard);
        return;
      }

      if (cleaned.length >= 10) {
        if (lockedApiKey !== cleaned) {
          cachedWorkingTtsConfig = null;
        }
        lockedApiKey = cleaned;
        window.__CHOMUCHKA_KEY__ = cleaned;
        state.apiKey = cleaned;
      }

      const quickEl = document.getElementById('quickApiKeyInput');
      const settingsEl = document.getElementById('apiKeyInput');
      if (quickEl && quickEl.value !== cleaned && cleaned.length >= 10) quickEl.value = cleaned;
      if (settingsEl && settingsEl.value !== cleaned && cleaned.length >= 10) settingsEl.value = cleaned;
      saveState();

      if (lockedApiKey) {
        setMainErrorBanner('');
      }

      if (collapseQuickCard) {
        isEditingKeyManually = false;
      }
      updateDiagnosticsBar(collapseQuickCard);
    }

    function showToast(msg) {
      const el = document.getElementById('toastBanner');
      el.textContent = msg;
      el.classList.remove('hidden');
      setTimeout(() => el.classList.add('hidden'), 4200);
    }

    function setMainErrorBanner(msg) {
      const el = document.getElementById('mainErrorBanner');
      if (!el) return;
      if (!msg) {
        el.classList.add('hidden');
        el.textContent = '';
      } else {
        el.textContent = msg;
        el.classList.remove('hidden');
      }
    }

