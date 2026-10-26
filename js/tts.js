    // =========================================================================
    // 4. HYBRID STREAMING + SENTENCE PIPELINE TTS ENGINE (24 kHz 16-BIT HD)
    // =========================================================================
    function clearSpeechWatchdog() {
      if (speechWatchdogTimer) {
        clearTimeout(speechWatchdogTimer);
        speechWatchdogTimer = null;
      }
    }

    // Safety net: if a source's onended never fires (e.g. iOS suspends the AudioContext),
    // the 'speaking' phase would keep controls locked forever — force idle shortly after playback should end.
    function armSpeakingWatchdog(remainingSec, myGenId) {
      clearSpeechWatchdog();
      speechWatchdogTimer = setTimeout(() => {
        speechWatchdogTimer = null;
        if (myGenId !== currentSpeechGenId || appPhase !== 'speaking') return;
        const stopBtn = document.getElementById('btnStopSpeaking');
        if (stopBtn) stopBtn.classList.add('hidden');
        setWalkieState('idle', '🟡 Жовта — нове питання • 🔵 Синя — повторити');
      }, (Math.max(0, remainingSec) + 3) * 1000);
    }

    function abortActiveTtsRequests() {
      while (activeTtsAbortControllers.length > 0) {
        const ctrl = activeTtsAbortControllers.pop();
        try { ctrl.abort(); } catch (e) {}
      }
    }

    // Silences every audio output (Web Audio sources, both <audio> players, browser TTS)
    // without touching generation ids or UI — so exactly one voice can be heard at a time.
    function stopActivePlayback(exceptEl = null) {
      while (activeAudioSources.length > 0) {
        const src = activeAudioSources.pop();
        try {
          src.onended = null;
          src.stop();
        } catch (e) {}
      }

      HTML_AUDIO_PLAYER_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (!el || el === exceptEl) return;
        try {
          el.onended = null;
          el.pause();
          el.currentTime = 0;
        } catch (e) {}
      });
      if (activeHtmlAudio !== exceptEl) activeHtmlAudio = null;

      if ('speechSynthesis' in window) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }
    }

    function stopAllSpeech({ except = null } = {}) {
      currentSpeechGenId++;
      clearSpeechWatchdog();
      abortActiveTtsRequests();
      stopActivePlayback(except);

      const stopBtn = document.getElementById('btnStopSpeaking');
      if (stopBtn) stopBtn.classList.add('hidden');
      if (!isRecording && !isProcessingTurn && appPhase !== 'finishing') {
        setWalkieState('idle', 'Рація готова. Натисни жовту кнопку!');
      }
    }

    function splitTextForHybridPipeline(text) {
      const cleaned = (text || '').trim().replace(/\s+/g, ' ');
      if (cleaned.length <= 65) {
        return [cleaned];
      }

      const rawSentences = cleaned.split(/(?<=[.!?…])\s+/).map(s => s.trim()).filter(Boolean);
      if (rawSentences.length <= 1) {
        const commaMatch = cleaned.slice(20, 75).search(/[,;—–-]\s/);
        if (commaMatch !== -1) {
          const splitIdx = 20 + commaMatch + 1;
          return [cleaned.slice(0, splitIdx).trim(), cleaned.slice(splitIdx).trim()];
        }
        return [cleaned];
      }

      let firstChunk = rawSentences[0];
      let restStartIdx = 1;

      if (firstChunk.length < 14 && rawSentences.length > 2 && (firstChunk.length + rawSentences[1].length) < 65) {
        firstChunk = firstChunk + ' ' + rawSentences[1];
        restStartIdx = 2;
      }

      const remaining = rawSentences.slice(restStartIdx).join(' ').trim();
      if (!remaining) return [firstChunk];

      return [firstChunk, remaining];
    }

    async function fetchSegmentPcmWithStream(segmentText, apiKey, myGenId, onStreamChunkPcm = null) {
      const candidates = getCandidateTtsConfigs();
      const errors = [];
      // myGenId === null: background synthesis (voice bank) that must survive speech interruptions
      const isCancelled = () => myGenId !== null && myGenId !== currentSpeechGenId;

      for (const cfg of candidates) {
        if (isCancelled()) return { ok: false, aborted: true };

        const controller = new AbortController();
        if (myGenId !== null) activeTtsAbortControllers.push(controller);
        const timer = setTimeout(() => controller.abort(), 14000);
        const collectedPcmParts = [];
        let streamedToPlayer = false;
        const emitChunk = (pcm) => {
          collectedPcmParts.push(pcm);
          if (onStreamChunkPcm) {
            streamedToPlayer = true;
            onStreamChunkPcm(pcm, cfg.modelName);
          }
        };

        try {
          const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.modelName)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
          const res = await fetch(streamUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: segmentText }] }],
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: { voiceConfig: cfg.vConfig }
              }
            })
          });

          if (!res.ok) {
            clearTimeout(timer);
            let errBody = '';
            try {
              const errJson = await res.json();
              errBody = errJson?.error?.message || '';
            } catch (e) {}
            errors.push(`${cfg.modelName}: HTTP ${res.status}${errBody ? ' (' + errBody.slice(0, 55) + ')' : ''}`);
            if (cachedWorkingTtsConfig && cachedWorkingTtsConfig.modelName === cfg.modelName) {
              cachedWorkingTtsConfig = null;
            }
            continue;
          }

          if (res.body && typeof res.body.getReader === 'function') {
            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let sseBuffer = '';

            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              if (isCancelled()) {
                try { reader.cancel(); } catch (e) {}
                clearTimeout(timer);
                return { ok: false, aborted: true };
              }
              sseBuffer += decoder.decode(value, { stream: true });
              const lines = sseBuffer.split(/\r?\n/);
              sseBuffer = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const jsonStr = trimmed.slice(5).trim();
                if (!jsonStr || jsonStr === '[DONE]') continue;
                try {
                  const frame = JSON.parse(jsonStr);
                  const parts = frame?.candidates?.[0]?.content?.parts || [];
                  for (const p of parts) {
                    if (p.inlineData && p.inlineData.data) {
                      const pcm = base64ToRawPcmBytes(p.inlineData.data);
                      if (pcm.byteLength > 0) emitChunk(pcm);
                    }
                  }
                } catch (parseErr) {}
              }
            }
          } else {
            const rawText = await res.text();
            const lines = rawText.split(/\r?\n/);
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const jsonStr = trimmed.slice(5).trim();
              try {
                const frame = JSON.parse(jsonStr);
                const parts = frame?.candidates?.[0]?.content?.parts || [];
                for (const p of parts) {
                  if (p.inlineData && p.inlineData.data) {
                    const pcm = base64ToRawPcmBytes(p.inlineData.data);
                    if (pcm.byteLength > 0) emitChunk(pcm);
                  }
                }
              } catch (e) {}
            }
          }

          clearTimeout(timer);

          if (collectedPcmParts.length > 0) {
            cachedWorkingTtsConfig = cfg;
            const mergedPcm = concatPcmByteArrays(collectedPcmParts, 0);
            return { ok: true, pcmBytes: mergedPcm, modelName: cfg.modelName };
          }
        } catch (e) {
          clearTimeout(timer);
          if (isCancelled()) return { ok: false, aborted: true };
          // Part of this segment is already playing — retrying with another model would repeat it
          if (streamedToPlayer) {
            return { ok: true, partial: true, pcmBytes: concatPcmByteArrays(collectedPcmParts, 0), modelName: cfg.modelName };
          }
          errors.push(`${cfg.modelName}: ${e.message || 'помилка потоку'}`);
        }
      }

      return { ok: false, error: errors.slice(0, 2).join(' | ') || 'TTS моделі недоступні' };
    }

    async function playGeminiTtsAudio(text, appendNextActionHint = false) {
      const apiKey = getActiveApiKey();
      if (!apiKey) return { ok: false, error: 'Ключ API не введено' };

      // Invalidate the previous answer's in-flight TTS; its audio keeps playing (e.g. the thinking filler)
      // until this answer's first chunk is ready, then stopActivePlayback() cuts it.
      const myGenId = ++currentSpeechGenId;
      abortActiveTtsRequests();
      clearSpeechWatchdog();
      const startTimestamp = performance.now();
      ensureAudioCtx();

      const stopBtn = document.getElementById('btnStopSpeaking');
      const mainPlayer = document.getElementById('mainAudioPlayerEl');
      const previewWrap = document.getElementById('ttsAudioPreviewContainer');
      const playerEl = document.getElementById('ttsAudioPlayerEl');

      const scheduleTrailingNextActionHint = (afterTime) => {
        if (!appendNextActionHint || !wavPcmBank24k.NEXT_ACTION_HINT || !audioCtx) return false;
        const hintBuf = pcmBytesToAudioBufferSync(wavPcmBank24k.NEXT_ACTION_HINT, 24000);
        if (!hintBuf) return false;

        const hintSource = audioCtx.createBufferSource();
        hintSource.buffer = hintBuf;
        hintSource.connect(audioCtx.destination);

        activeAudioSources.push(hintSource);
        const hintStartAt = Math.max(audioCtx.currentTime + 0.05, afterTime + 0.45);
        hintSource.onended = () => {
          if (myGenId === currentSpeechGenId) {
            stopBtn.classList.add('hidden');
            setWalkieState('idle', '🟡 Жовта — нове питання • 🔵 Синя — повторити');
          }
        };
        hintSource.start(hintStartAt);
        return hintStartAt + hintBuf.duration;
      };

      // 0. Check instant in-memory replay cache
      if (ttsReplayCache.has(text)) {
        const cached = ttsReplayCache.get(text);
        const audioBuf = pcmBytesToAudioBufferSync(cached.pcmBytes, 24000);
        if (mainPlayer) mainPlayer.src = cached.blobUrl;
        if (audioBuf && audioCtx) {
          if (audioCtx.state === 'suspended') await audioCtx.resume().catch(() => {});
          if (myGenId !== currentSpeechGenId) return { ok: false, aborted: true };
          stopActivePlayback();
          const src = audioCtx.createBufferSource();
          src.buffer = audioBuf;
          src.connect(audioCtx.destination);
          activeAudioSources.push(src);
          stopBtn.classList.remove('hidden');
          setWalkieState('speaking', '⚡ Рація відповідає (з миттєвого кешу 0.01 с)...');

          const endAt = audioCtx.currentTime + audioBuf.duration;
          const hintEndAt = scheduleTrailingNextActionHint(endAt);
          const hasTrailingHint = Boolean(hintEndAt);
          armSpeakingWatchdog((hintEndAt || endAt) - audioCtx.currentTime, myGenId);

          src.onended = () => {
            if (!hasTrailingHint && myGenId === currentSpeechGenId) {
              stopBtn.classList.add('hidden');
              setWalkieState('idle', '🟡 Жовта — нове питання • 🔵 Синя — повторити');
            }
          };
          src.start(0);
          return { ok: true };
        }
      }

      // 1. Split text into [shortFirstSentence, remainingSentences]
      const segments = splitTextForHybridPipeline(text);
      let nextPlayTime = 0;
      let firstAudioStarted = false;
      let usedModelName = cachedWorkingTtsConfig?.modelName || 'gemini-3.8-flash-lite-tts';
      let scheduledSourcesCount = 0;
      let finishedSourcesCount = 0;
      let allSegmentsDispatched = false;

      const checkAllPlaybackFinished = () => {
        if (myGenId !== currentSpeechGenId) return;
        if (allSegmentsDispatched && finishedSourcesCount >= scheduledSourcesCount) {
          stopBtn.classList.add('hidden');
          setWalkieState('idle', '🟡 Жовта — нове питання • 🔵 Синя — повторити');
        }
      };

      const schedulePcmImmediately = (pcmBytes, modelLabel) => {
        if (myGenId !== currentSpeechGenId || !pcmBytes || pcmBytes.byteLength === 0) return false;
        usedModelName = modelLabel || usedModelName;
        const audioBuf = pcmBytesToAudioBufferSync(pcmBytes, 24000);
        if (!audioBuf || !audioCtx) return false;

        if (!firstAudioStarted) {
          firstAudioStarted = true;
          stopActivePlayback();
          lastFirstAudioLatencySec = ((performance.now() - startTimestamp) / 1000).toFixed(1);
          stopBtn.classList.remove('hidden');
          setWalkieState('speaking', `⚡ Рація говорить (старт за ${lastFirstAudioLatencySec} с)...`);
          lastTtsDiagnosticMsg = `⚡ Гібридний потік (${usedModelName}): перший звук за ${lastFirstAudioLatencySec} с!`;
          updateDiagnosticsBar(false);
        }

        const now = audioCtx.currentTime;
        const startAt = Math.max(now + 0.02, nextPlayTime);
        nextPlayTime = startAt + audioBuf.duration;

        const source = audioCtx.createBufferSource();
        source.buffer = audioBuf;
        source.connect(audioCtx.destination);
        scheduledSourcesCount++;
        activeAudioSources.push(source);

        source.onended = () => {
          finishedSourcesCount++;
          checkAllPlaybackFinished();
        };

        source.start(startAt);
        return true;
      };

      let seg2Promise = null;
      if (segments.length > 1 && cachedWorkingTtsConfig) {
        seg2Promise = new Promise(resolve => setTimeout(resolve, 35)).then(() =>
          fetchSegmentPcmWithStream(segments[1], apiKey, myGenId, null)
        );
      }

      const seg1Res = await fetchSegmentPcmWithStream(segments[0], apiKey, myGenId, (pcmChunk, modelLabel) => {
        schedulePcmImmediately(pcmChunk, modelLabel);
      });

      if (myGenId !== currentSpeechGenId) return { ok: false, aborted: true };
      if (!seg1Res.ok) {
        // Some audio is already audible — falling back to browser TTS would read the answer twice
        if (firstAudioStarted) {
          allSegmentsDispatched = true;
          armSpeakingWatchdog(nextPlayTime - audioCtx.currentTime, myGenId);
          checkAllPlaybackFinished();
          return { ok: true, partial: true };
        }
        return { ok: false, error: seg1Res.error || 'Помилка синтезу фрази 1' };
      }
      let isCompleteAudio = !seg1Res.partial;

      if (segments.length > 1 && !seg2Promise) {
        seg2Promise = fetchSegmentPcmWithStream(segments[1], apiKey, myGenId, null);
      }

      const allSegmentPcms = [seg1Res.pcmBytes];

      if (seg2Promise) {
        nextPlayTime += 0.065;
        let seg2Res = await seg2Promise;
        if (myGenId !== currentSpeechGenId) return { ok: false, aborted: true };

        if (!seg2Res.ok && !seg2Res.aborted) {
          await new Promise(r => setTimeout(r, 250));
          seg2Res = await fetchSegmentPcmWithStream(segments[1], apiKey, myGenId, null);
        }

        if (seg2Res.ok && seg2Res.pcmBytes && seg2Res.pcmBytes.byteLength > 0) {
          allSegmentPcms.push(seg2Res.pcmBytes);
          schedulePcmImmediately(seg2Res.pcmBytes, seg2Res.modelName);
        } else {
          isCompleteAudio = false;
        }
      }

      // Schedule local ./audio/next_action_hint.wav right after the answer finishes!
      if (appendNextActionHint && wavPcmBank24k.NEXT_ACTION_HINT && audioCtx) {
        const hintBuf = pcmBytesToAudioBufferSync(wavPcmBank24k.NEXT_ACTION_HINT, 24000);
        if (hintBuf) {
          const startAt = Math.max(audioCtx.currentTime + 0.05, nextPlayTime + 0.5);
          nextPlayTime = startAt + hintBuf.duration;
          const hintSrc = audioCtx.createBufferSource();
          hintSrc.buffer = hintBuf;
          hintSrc.connect(audioCtx.destination);
          scheduledSourcesCount++;
          activeAudioSources.push(hintSrc);
          hintSrc.onended = () => {
            finishedSourcesCount++;
            checkAllPlaybackFinished();
          };
          hintSrc.start(startAt);
        }
      }

      allSegmentsDispatched = true;
      if (firstAudioStarted) armSpeakingWatchdog(nextPlayTime - audioCtx.currentTime, myGenId);

      const fullPcm = concatPcmByteArrays(allSegmentPcms, 65, 24000);
      const fullWavBuffer = pcmBytesToWavArrayBuffer(fullPcm, 24000);
      const wavBlob = new Blob([fullWavBuffer], { type: 'audio/wav' });
      const blobUrl = URL.createObjectURL(wavBlob);

      // Don't cache a truncated answer — the next replay should re-synthesize it fully
      if (isCompleteAudio) {
        if (ttsReplayCache.size >= 10) {
          const oldestKey = ttsReplayCache.keys().next().value;
          ttsReplayCache.delete(oldestKey);
        }
        ttsReplayCache.set(text, { pcmBytes: fullPcm, blobUrl });
      }

      // The child screen keeps its <audio> player hidden (blue button replays); the settings preview stays visible
      if (mainPlayer) mainPlayer.src = blobUrl;
      if (previewWrap && playerEl) {
        previewWrap.classList.remove('hidden');
        playerEl.src = blobUrl;
      }

      if (!firstAudioStarted && mainPlayer) {
        stopActivePlayback();
        activeHtmlAudio = mainPlayer;
        setWalkieState('speaking', 'Рація відповідає...');
        armSpeakingWatchdog(fullPcm.byteLength / (24000 * 2), myGenId);
        stopBtn.classList.remove('hidden');
        mainPlayer.onended = () => {
          activeHtmlAudio = null;
          stopBtn.classList.add('hidden');
          setWalkieState('idle', '🟡 Жовта — нове питання • 🔵 Синя — повторити');
        };
        await mainPlayer.play().catch(() => {});
      } else {
        checkAllPlaybackFinished();
      }

      return { ok: true };
    }

    function pickCyrillicCapableVoice(targetLangPrefix = 'uk') {
      if (!('speechSynthesis' in window)) {
        return { voice: null, quality: 'none', label: 'WebView без системних голосів' };
      }
      const voices = window.speechSynthesis.getVoices() || [];
      if (!voices.length) {
        return { voice: null, quality: 'webview_empty', label: 'Android WebView (використовуйте Gemini TTS)' };
      }

      const exact = voices.find(v => v.lang && v.lang.toLowerCase().startsWith(targetLangPrefix));
      if (exact) return { voice: exact, quality: 'native', label: `${exact.name} (${exact.lang})` };

      if (targetLangPrefix === 'uk' || targetLangPrefix === 'ru') {
        const cyrillicFallbacks = ['uk', 'ru', 'bg', 'sr', 'mk', 'be', 'pl', 'cs', 'sk'];
        for (const code of cyrillicFallbacks) {
          const found = voices.find(v => v.lang && v.lang.toLowerCase().startsWith(code));
          if (found) return { voice: found, quality: 'fallback', label: `${found.name} (${found.lang})` };
        }
      }

      const defaultVoice = voices.find(v => v.default) || voices[0];
      return {
        voice: defaultVoice || null,
        quality: 'latin_only',
        label: defaultVoice ? `${defaultVoice.name} (${defaultVoice.lang})` : 'системний голос'
      };
    }

    function transliterateUkToPhoneticLatin(text) {
      const map = {
        'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ye','ж':'zh','з':'z',
        'и':'y','і':'ee','ї':'yi','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p',
        'р':'r','с':'s','т':'t','у':'oo','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch',
        'ь':'','ю':'yu','я':'ya','ы':'y','э':'e','ё':'yo','ъ':'',
        'А':'A','Б':'B','В':'V','Г':'H','Ґ':'G','Д':'D','Е':'E','Є':'Ye','Ж':'Zh','З':'Z',
        'И':'Y','І':'Ee','Ї':'Yi','Й':'Y','К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P',
        'Р':'R','С':'S','Т':'T','У':'Oo','Ф':'F','Х':'Kh','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Shch',
        'Ь':'','Ю':'Yu','Я':'Ya','Ы':'Y','Э':'E','Ё':'Yo','Ъ':''
      };
      return String(text).split('').map(ch => (ch in map ? map[ch] : ch)).join('');
    }

    function updateDiagnosticsBar(allowCollapseQuickCard = false) {
      const voiceEl = document.getElementById('diagVoiceStatus');
      const apiEl = document.getElementById('diagApiStatus');
      const infoBox = document.getElementById('browserVoicesInfo');
      const quickCard = document.getElementById('quickApiKeyCard');
      const quickInput = document.getElementById('quickApiKeyInput');
      const quickHint = document.getElementById('quickApiKeyHint');
      const quickBtn = document.getElementById('btnQuickSaveKey');
      const connectedPill = document.getElementById('connectedKeyPill');
      const connectedLabel = document.getElementById('connectedKeyLabel');

      const activeKey = getActiveApiKey();
      const hasKey = Boolean(activeKey);

      if (quickCard && connectedPill) {
        if (hasKey) {
          const masked = activeKey.slice(0, 6) + '•••' + activeKey.slice(-3);
          if (connectedLabel) {
            connectedLabel.textContent = `✅ Ключ (${masked}) • ${state.model}`;
          }
          const inputHasFocus = (document.activeElement === quickInput);
          if (allowCollapseQuickCard || (!inputHasFocus && !isEditingKeyManually)) {
            if (inputHasFocus && quickInput) quickInput.blur();
            quickCard.classList.add('hidden');
            connectedPill.classList.remove('hidden');
          } else {
            if (quickHint) {
              quickHint.textContent = `✅ Ключ підхоплено (${masked})! Натисніть «Підключити», щоб увімкнути озвучку рації:`;
              quickHint.className = 'text-xs font-bold text-emerald-300 mb-1.5';
            }
            if (quickBtn) {
              quickBtn.textContent = '✅ Підключити';
            }
          }
        } else {
          quickCard.classList.remove('hidden');
          connectedPill.classList.add('hidden');
          if (quickHint) {
            quickHint.textContent = '🔑 Вставте ключ Gemini API і натисніть «Підключити» (на GitHub Pages зберігається в localStorage назавжди):';
            quickHint.className = 'text-xs font-bold text-amber-200 mb-1.5';
          }
          if (quickBtn) {
            quickBtn.textContent = 'Підключити';
          }
        }
      }

      const bankReadyCount = Object.keys(SYSTEM_PROMPT_TEXTS).filter(k => Boolean(wavPcmBank24k[k])).length;
      apiEl.textContent = hasKey
        ? `🔑 API активний • Файлів audio/*.wav: ${bankReadyCount}/6`
        : `🔑 Очікування ключа • audio/*.wav: ${bankReadyCount}/6`;
      apiEl.className = hasKey ? 'text-emerald-400 font-medium' : 'text-amber-300 font-semibold';

      const picked = pickCyrillicCapableVoice('uk');
      const safeLabel = picked.label || 'системний';
      if (hasKey && state.ttsEngine !== 'browser_tts') {
        const speedTag = lastFirstAudioLatencySec ? ` (${lastFirstAudioLatencySec} с)` : '';
        voiceEl.textContent = `🔊 Студійний 24 кГц WAV + Потік${speedTag}`;
        voiceEl.className = 'text-emerald-400 font-medium';
      } else if (picked.quality === 'native') {
        voiceEl.textContent = `🔊 Голос: Український (${safeLabel})`;
        voiceEl.className = 'text-emerald-400';
      } else {
        voiceEl.textContent = `🔈 Голос: ${safeLabel}`;
        voiceEl.className = 'text-amber-300';
      }

      if (infoBox) {
        let html = '';
        if (lastTtsDiagnosticMsg) {
          html += `<div class="p-2.5 rounded-lg bg-slate-800 border border-slate-600 text-amber-200 font-medium leading-relaxed">${escapeHtml(lastTtsDiagnosticMsg)}</div>`;
        }
        html += `<div>ℹ️ <b>Архітектура для GitHub Pages + PWA:</b> Службові фрази завантажуються напряму з <code>./audio/*.wav</code> (24 кГц, 16-біт WAV без жодної <code>IndexedDB</code>) і кешуються Service Worker-ом (<code>sw.js</code>) для миттєвої роботи офлайн.</div>`;
        infoBox.innerHTML = html;
      }
      updateVoiceBankUiStatus();
    }

    async function speakText(text, langHint = 'uk', isSettingsTest = false, appendNextActionHint = false) {
      if (!text) return;
      lastSpokenResponse = text;

      const stopBtn = document.getElementById('btnStopSpeaking');
      const testBtn = document.getElementById('btnTestVoiceInSettings');

      const apiKey = getActiveApiKey();
      if (apiKey && state.ttsEngine !== 'browser_tts') {
        if (testBtn && isSettingsTest) {
          testBtn.textContent = '⏳ Потоковий синтез (Гібридний конвеєр)...';
        }
        const geminiRes = await playGeminiTtsAudio(text, appendNextActionHint);
        if (geminiRes.ok || geminiRes.aborted) {
          if (testBtn && isSettingsTest && geminiRes.ok) {
            testBtn.textContent = `✅ Озвучено за ${lastFirstAudioLatencySec || '0.9'} с! (Ще раз)`;
          }
          return;
        } else {
          lastTtsDiagnosticMsg = `⚠️ Gemini TTS: ${geminiRes.error}.`;
          updateDiagnosticsBar(false);
        }
      }

      if (testBtn && isSettingsTest) {
        testBtn.textContent = '🔊 Перевірити озвучення зараз';
      }

      if (!('speechSynthesis' in window)) {
        sfxAnswerReady();
        setWalkieState('idle', 'Відповідь готова!');
        return;
      }

      try {
        const myGenId = currentSpeechGenId;
        clearSpeechWatchdog();
        if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
          window.speechSynthesis.cancel();
          await new Promise(r => setTimeout(r, 60));
        }
        if (myGenId !== currentSpeechGenId) return;
        stopActivePlayback();
        window.speechSynthesis.resume();

        const targetLang = state.languagePolicy === 'always_uk'
          ? 'uk-UA'
          : (langHint === 'ru' ? 'ru-RU' : (langHint === 'en' ? 'en-US' : 'uk-UA'));
        const langPrefix = targetLang.slice(0, 2).toLowerCase();

        const picked = pickCyrillicCapableVoice(langPrefix);
        const hasCyrillicChars = /[а-яіїєґА-ЯІЇЄҐ]/.test(text);

        const utterText = (picked.quality === 'latin_only' && hasCyrillicChars)
          ? transliterateUkToPhoneticLatin(text)
          : text;

        const utter = new SpeechSynthesisUtterance(utterText);
        utter.rate = 0.92;
        utter.pitch = 1.05;

        if (picked.voice) {
          utter.voice = picked.voice;
          utter.lang = picked.voice.lang || targetLang;
        } else {
          utter.lang = targetLang;
        }

        stopBtn.classList.remove('hidden');
        setWalkieState('speaking', 'Рація відповідає...');

        const estimatedMs = Math.min(14000, Math.max(2500, utterText.length * 75));
        speechWatchdogTimer = setTimeout(() => {
          stopBtn.classList.add('hidden');
          setWalkieState('idle', 'Рація готова. Натисни жовту кнопку!');
        }, estimatedMs);

        utter.onend = () => {
          clearSpeechWatchdog();
          stopBtn.classList.add('hidden');
          setWalkieState('idle', 'Рація готова. Натисни жовту кнопку!');
        };
        utter.onerror = () => {
          clearSpeechWatchdog();
          stopBtn.classList.add('hidden');
          setWalkieState('idle', 'Рація готова. Натисни жовту кнопку!');
        };

        window.speechSynthesis.speak(utter);
      } catch (e) {
        clearSpeechWatchdog();
        stopBtn.classList.add('hidden');
        setWalkieState('idle', 'Рація готова. Натисни жовту кнопку!');
      }
    }

