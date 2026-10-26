    // =========================================================================
    // 7. PUSH-TO-TALK RECORDING (WITH VOICE GUIDANCE FOR 5YO)
    // =========================================================================
    function blobToBase64(blob) {
      return new Promise((resolve) => {
        try {
          const reader = new FileReader();
          const timer = setTimeout(() => resolve(null), 2000);
          reader.onloadend = () => {
            clearTimeout(timer);
            const dataUrl = reader.result || '';
            const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
            resolve(base64 || null);
          };
          reader.onerror = () => {
            clearTimeout(timer);
            resolve(null);
          };
          reader.readAsDataURL(blob);
        } catch (e) {
          resolve(null);
        }
      });
    }

    function stopMicLevelMeter() {
      if (micAnalyserInterval) {
        clearInterval(micAnalyserInterval);
        micAnalyserInterval = null;
      }
      if (recordingTimerInterval) {
        clearInterval(recordingTimerInterval);
        recordingTimerInterval = null;
      }
      if (listeningSilenceHintTimer) {
        clearTimeout(listeningSilenceHintTimer);
        listeningSilenceHintTimer = null;
      }
      const wrap = document.getElementById('micLevelWrapper');
      if (wrap) wrap.classList.add('hidden');
    }

    function startVisualMicMeter() {
      stopMicLevelMeter();
      const wrap = document.getElementById('micLevelWrapper');
      const bar = document.getElementById('micLevelBar');
      if (!wrap || !bar) return;
      wrap.classList.remove('hidden');
      let tick = 0;
      micAnalyserInterval = setInterval(() => {
        tick++;
        const wave = 25 + Math.round(Math.abs(Math.sin(tick * 0.45)) * 65);
        bar.style.width = wave + '%';
      }, 110);
    }

    function cleanupMediaResources() {
      stopMicLevelMeter();
      actualRecordingStartTime = 0;
      isStartingMic = false;
      if (maxRecordTimer) {
        clearTimeout(maxRecordTimer);
        maxRecordTimer = null;
      }
      if (speechRecognition) {
        try { speechRecognition.stop(); } catch (e) {}
        speechRecognition = null;
      }
      if (activeStream) {
        try { activeStream.getTracks().forEach(t => t.stop()); } catch (e) {}
        activeStream = null;
      }
    }

    function pickSupportedAudioMimeType() {
      if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
        return '';
      }
      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus'
      ];
      for (const mime of candidates) {
        try {
          if (MediaRecorder.isTypeSupported(mime)) return mime;
        } catch (e) {}
      }
      return '';
    }

    async function startRecording() {
      if (isRecording || isStartingMic || isProcessingTurn || isActionLocked('ptt')) return;

      const quickEl = document.getElementById('quickApiKeyInput');
      if (quickEl && quickEl.value.trim().length >= 10) {
        syncApiKeyInputs(quickEl.value, true);
      } else {
        updateDiagnosticsBar(true);
      }

      const hasKey = Boolean(getActiveApiKey());

      if (!hasKey) {
        document.getElementById('lastAiText').textContent = `«${SYSTEM_PROMPT_TEXTS.NO_KEY}»`;
        await playSystemPrompt('NO_KEY', { interruptCurrent: true });
        return;
      }

      saveState();

      stopAllSpeech();
      isStartingMic = true;
      actualRecordingStartTime = 0;
      const mySessionId = ++recordingSessionId;
      liveInterimTranscript = '';
      audioChunks = [];
      sfxStartListening();
      setWalkieState('listening', 'Вмикаю мікрофон...');

      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (recordingSessionId !== mySessionId) {
            stream.getTracks().forEach(t => t.stop());
            isStartingMic = false;
            return;
          }

          activeStream = stream;
          const chosenMime = pickSupportedAudioMimeType();
          mediaRecorder = chosenMime
            ? new MediaRecorder(stream, { mimeType: chosenMime })
            : new MediaRecorder(stream);

          mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              audioChunks.push(e.data);
            }
          };

          mediaRecorder.onstart = () => {
            isStartingMic = false;
            isRecording = true;
            actualRecordingStartTime = Date.now();
            startVisualMicMeter();
            setWalkieState('listening', '🔴 Запис 0:00 — Кажи і тисни ЧЕРВОНУ кнопку!');
            document.getElementById('lastChildText').textContent = '🔴 Слухаю тебе! Скажи своє питання і натисни велику ЧЕРВОНУ кнопку!';
            recordingTimerInterval = setInterval(() => {
              if (!isRecording || !actualRecordingStartTime) return;
              const sec = Math.floor((Date.now() - actualRecordingStartTime) / 1000);
              const labelEl = document.getElementById('statusLabel');
              if (labelEl) labelEl.textContent = `🔴 Запис 0:${sec < 10 ? '0' + sec : sec} — Тисни ЧЕРВОНУ кнопку, коли скажеш!`;
            }, 400);
          };

          maxRecordTimer = setTimeout(() => {
            if (isRecording && recordingSessionId === mySessionId) {
              stopRecording();
            }
          }, 14000);

          mediaRecorder.start(250);
          return;
        } catch (err) {
          mediaRecorder = null;
          isStartingMic = false;
          isRecording = false;
          setMainErrorBanner(`⚠️ Не вдалося увімкнути мікрофон (${err.name || 'доступ заборонено'}). Дозвольте доступ до мікрофона або скористайтеся тестовими кнопками нижче.`);
          setWalkieState('idle', 'Рація готова. Натисни жовту кнопку!');
          return;
        }
      }

      isStartingMic = false;
      isRecording = false;
      setWalkieState('idle', 'Рація готова. Натисни жовту кнопку!');
    }

    async function stopRecording() {
      if (!isRecording || isStartingMic) return;

      if (actualRecordingStartTime > 0 && (Date.now() - actualRecordingStartTime < 650)) {
        return;
      }

      isRecording = false;
      lastPttActionTimestamp = Date.now();
      const stoppedSessionId = recordingSessionId;
      // Locks controls during the gap until processChildTurn takes over (blob flush + base64 can take ~3 s)
      setWalkieState('finishing', '⏳ Обробляю запис...');
      sfxStopListening();
      stopMicLevelMeter();

      if (maxRecordTimer) {
        clearTimeout(maxRecordTimer);
        maxRecordTimer = null;
      }
      if (speechRecognition) {
        try { speechRecognition.stop(); } catch (e) {}
        speechRecognition = null;
      }

      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        let handled = false;
        const rec = mediaRecorder;
        mediaRecorder = null;

        const finishFromChunks = async () => {
          if (handled || stoppedSessionId !== recordingSessionId) return;
          handled = true;
          const mimeType = rec.mimeType || 'audio/webm';
          const blob = new Blob(audioChunks, { type: mimeType });
          cleanupMediaResources();
          const base64Audio = blob.size > 0 ? await blobToBase64(blob) : null;
          await processChildTurn({
            base64Audio,
            mimeType,
            textInput: liveInterimTranscript
          });
        };

        const fallbackTimer = setTimeout(finishFromChunks, 1300);

        rec.onstop = async () => {
          clearTimeout(fallbackTimer);
          await finishFromChunks();
        };

        try {
          try { rec.requestData(); } catch (e) {}
          rec.stop();
        } catch (e) {
          clearTimeout(fallbackTimer);
          await finishFromChunks();
        }
      } else {
        cleanupMediaResources();
        await processChildTurn({
          base64Audio: null,
          mimeType: null,
          textInput: liveInterimTranscript
        });
      }
    }

