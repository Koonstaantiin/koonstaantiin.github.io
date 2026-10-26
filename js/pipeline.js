    // =========================================================================
    // 6. PROCESSING PIPELINE & UI UPDATES (WITH ./audio/*.wav VOICE CUES)
    // =========================================================================
    function setWalkieState(mode, message) {
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
      } else if (mode === 'thinking') {
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

      updateDiagnosticsBar(true);

      if (state.usedToday >= state.dailyLimit) {
        isProcessingTurn = false;
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
        if (isProcessingTurn) {
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
            textInput: textInput || ''
          });
        } else {
          await new Promise(r => setTimeout(r, 350));
          result = simulateGuardrailPipeline(textInput, presetKey, hadRawAudio);
        }
        clearTimeout(turnWatchdog);
        await handleProcessedResult(result);
      } catch (err) {
        clearTimeout(turnWatchdog);
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

