    // =========================================================================
    // 6. PROCESSING PIPELINE & UI UPDATES (WITH ./audio/*.wav VOICE CUES)
    // =========================================================================
    // Phases in which each child-facing action is blocked (checked by UI handlers and startRecording)
    const ACTION_LOCKED_IN_PHASES = {
      ptt: ['finishing', 'thinking'],
      repeat: ['recording', 'finishing', 'thinking', 'speaking'],
      hint: ['recording', 'finishing', 'thinking', 'speaking'],
      simulate: ['recording', 'finishing', 'thinking', 'speaking'],
      parent: ['recording', 'finishing', 'thinking']
    };
    const ACTION_CONTROL_SELECTORS = {
      ptt: '#btnPushToTalk',
      repeat: '#btnRepeatAnswer',
      hint: '#btnPlayIntroHint',
      simulate: '.sim-preset-btn, #btnRunCustomSim, #customSimInput',
      parent: '#btnParentLock'
    };
    // Yellow may interrupt an answer, but not in its first second (accidental double taps)
    const PTT_INTERRUPT_GRACE_MS = 1000;

    function isActionLocked(action) {
      if (action === 'ptt' && appPhase === 'speaking') {
        return Date.now() - phaseEnteredAt < PTT_INTERRUPT_GRACE_MS;
      }
      return (ACTION_LOCKED_IN_PHASES[action] || []).includes(appPhase);
    }

    function applyControlLocks() {
      Object.keys(ACTION_CONTROL_SELECTORS).forEach(action => {
        const locked = (ACTION_LOCKED_IN_PHASES[action] || []).includes(appPhase);
        document.querySelectorAll(ACTION_CONTROL_SELECTORS[action]).forEach(el => {
          el.classList.toggle('is-locked', locked);
          el.setAttribute('aria-disabled', locked ? 'true' : 'false');
        });
      });

      // Stop doubles as "cancel question" while thinking, so it must stay reachable then
      const stopBtn = document.getElementById('btnStopSpeaking');
      if (stopBtn) {
        if (appPhase === 'thinking' || appPhase === 'speaking') stopBtn.classList.remove('hidden');
        else if (appPhase !== 'idle') stopBtn.classList.add('hidden');
      }
    }

    function setWalkieState(mode, message) {
      const phase = mode === 'listening' ? 'recording' : mode;
      if (phase !== appPhase) {
        appPhase = phase;
        phaseEnteredAt = Date.now();
      }

      const dot = document.getElementById('statusDot');
      const label = document.getElementById('statusLabel');
      const btn = document.getElementById('btnPushToTalk');
      const mainTxt = document.getElementById('pttMainText');
      const subTxt = document.getElementById('pttSubText');

      label.textContent = message;
      btn.classList.remove('ptt-listening', 'from-rose-500', 'to-rose-600', 'from-amber-400', 'to-amber-600', 'from-sky-400', 'to-sky-600');

      if (mode === 'listening') {
        dot.className = 'w-3 h-3 rounded-full bg-rose-500 shadow-[0_0_12px_#f43f5e]';
        btn.classList.add('ptt-listening', 'from-rose-500', 'to-rose-600');
        mainTxt.textContent = 'Слухаю тебе...';
        subTxt.textContent = '🔴 Тисни ЧЕРВОНУ кнопку, коли договориш';
      } else if (mode === 'thinking' || mode === 'finishing') {
        dot.className = 'w-3 h-3 rounded-full bg-sky-400 shadow-[0_0_12px_#38bdf8]';
        btn.classList.add('from-sky-400', 'to-sky-600');
        mainTxt.textContent = 'Думаю...';
        subTxt.textContent = '🛰️ Запитую у супутника';
      } else if (mode === 'speaking') {
        dot.className = 'w-3 h-3 rounded-full bg-amber-400 shadow-[0_0_12px_#fbbf24]';
        btn.classList.add('from-amber-400', 'to-amber-600');
        mainTxt.textContent = 'Рація говорить';
        subTxt.textContent = '🟡 Натисни жовту, щоб спитати знову';
      } else {
        dot.className = 'w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]';
        btn.classList.add('from-amber-400', 'to-amber-600');
        mainTxt.textContent = 'Натисни і питай';
        subTxt.textContent = '🟡 Жовта — говори • 🔴 Червона — відповідь';
      }

      applyControlLocks();
    }

    // Stop while thinking: drop the question entirely — abort the model request and never speak its answer
    function cancelCurrentTurn() {
      if (appPhase === 'thinking') {
        currentTurnId++;
        if (activeTurnAbortController) activeTurnAbortController.abort();
        stopThinkingTicks();
        isProcessingTurn = false;
      }
      stopAllSpeech();
    }

    async function handleProcessedResult(resultObj) {
      stopThinkingTicks();
      isProcessingTurn = false;

      const childTextEl = document.getElementById('lastChildText');
      const aiTextEl = document.getElementById('lastAiText');

      if (resultObj.safety_status === 'NOISE_OR_EMPTY') {
        sfxClarificationNeeded();
        childTextEl.textContent = resultObj.flagged_word_or_reason || 'Не вдалося розпізнати слова з мікрофона';
        aiTextEl.textContent = `«${SYSTEM_PROMPT_TEXTS.READY_INTRO}»`;
        await playSystemPrompt('READY_INTRO', { interruptCurrent: true });
        return;
      }

      state.usedToday = Math.min(state.dailyLimit, state.usedToday + 1);

      const now = new Date();
      const timeStr = now.toTimeString().slice(0, 5);
      state.logs.unshift({
        id: 'log-' + Date.now(),
        time: timeStr,
        heard: resultObj.heard_transcript,
        reconstructed: resultObj.reconstructed_intent,
        lang: resultObj.detected_language,
        status: resultObj.safety_status,
        flaggedReason: resultObj.flagged_word_or_reason || null,
        response: resultObj.spoken_response
      });
      if (state.logs.length > 50) state.logs.pop();
      saveState();
      renderStarsAndCounters();
      renderLogsList();

      if (resultObj.safety_status === 'UNCLEAR_OR_ADULT_MISHEARD') {
        sfxClarificationNeeded();
        childTextEl.textContent = '🛡️ Спрацював запобіжник: нечітке слово (перепитуємо без повторення слова)';
      } else if (resultObj.safety_status === 'SENSITIVE_TOPIC') {
        sfxClarificationNeeded();
        childTextEl.textContent = '👨‍👩‍👧 Чутлива тема (перенаправлено до батьків)';
      } else {
        sfxAnswerReady();
        childTextEl.textContent = `Дитина: «${resultObj.reconstructed_intent || resultObj.heard_transcript}»`;
      }
      aiTextEl.textContent = `«${resultObj.spoken_response}»`;

      await speakText(resultObj.spoken_response, resultObj.detected_language, false, true);
    }

    async function processChildTurn({ base64Audio = null, mimeType = null, textInput = '', presetKey = null }) {
      if (isProcessingTurn) return;
      isProcessingTurn = true;
      // Each turn gets an id; a result that arrives after its turn was superseded (watchdog fired) is dropped
      const myTurnId = ++currentTurnId;
      const turnAbort = new AbortController();
      activeTurnAbortController = turnAbort;

      updateDiagnosticsBar(true);

      if (state.usedToday >= state.dailyLimit) {
        isProcessingTurn = false;
        setWalkieState('idle', 'Рація відпочиває до завтра');
        document.getElementById('lastAiText').textContent = `«${SYSTEM_PROMPT_TEXTS.DAILY_LIMIT}»`;
        await playSystemPrompt('DAILY_LIMIT', { interruptCurrent: true });
        return;
      }

      setWalkieState('thinking', '🛰️ Рація питає у космічного супутника...');

      // Immediately play ./audio/thinking_filler.wav in 0.00s while Gemini API thinks!
      if (wavPcmBank24k.THINKING_FILLER) {
        playSystemPrompt('THINKING_FILLER', { interruptCurrent: true });
      } else {
        startThinkingTicks();
      }

      const hasKey = Boolean(getActiveApiKey());
      const hadRawAudio = Boolean(base64Audio);

      const turnWatchdog = setTimeout(() => {
        if (isProcessingTurn && myTurnId === currentTurnId) {
          currentTurnId++;
          turnAbort.abort();
          stopThinkingTicks();
          isProcessingTurn = false;
          const fallback = simulateGuardrailPipeline(textInput, presetKey, hadRawAudio);
          handleProcessedResult(fallback);
        }
      }, 24000);

      try {
        let result;
        if (presetKey && !hasKey) {
          await new Promise(r => setTimeout(r, 350));
          result = simulateGuardrailPipeline(textInput, presetKey, false);
        } else if (hasKey && (base64Audio || textInput || presetKey)) {
          result = await callGeminiApi({
            base64Audio,
            mimeType,
            textInput: textInput || '',
            signal: turnAbort.signal
          });
        } else {
          await new Promise(r => setTimeout(r, 350));
          result = simulateGuardrailPipeline(textInput, presetKey, hadRawAudio);
        }
        clearTimeout(turnWatchdog);
        if (myTurnId !== currentTurnId) return;
        await handleProcessedResult(result);
      } catch (err) {
        clearTimeout(turnWatchdog);
        if (myTurnId !== currentTurnId) return;
        stopThinkingTicks();
        isProcessingTurn = false;
        const detail = err.message || 'невідома помилка';
        lastTtsDiagnosticMsg = `❌ Деталі помилки API: ${detail}`;
        setMainErrorBanner(`⚠️ Помилка Gemini API: ${detail}`);
        updateDiagnosticsBar(false);
        showToast(`Помилка API: ${detail.slice(0, 90)}`);
        const fallback = simulateGuardrailPipeline(textInput, presetKey, hadRawAudio);
        await handleProcessedResult(fallback);
      }
    }

