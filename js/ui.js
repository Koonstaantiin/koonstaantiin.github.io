    // =========================================================================
    // 8. UI RENDERING & EVENT LISTENERS
    // =========================================================================
    function renderStarsAndCounters() {
      const remaining = Math.max(0, state.dailyLimit - state.usedToday);
      const starsEl = document.getElementById('starsContainer');
      const badgeEl = document.getElementById('questionsLeftBadge');
      const displayStars = Math.min(5, Math.ceil((remaining / Math.max(1, state.dailyLimit)) * 5));
      let html = '';
      for (let i = 0; i < 5; i++) {
        html += `<span class="${i < displayStars ? 'opacity-100' : 'opacity-25'}">⭐</span>`;
      }
      starsEl.innerHTML = html;
      badgeEl.textContent = `${remaining} / ${state.dailyLimit}`;

      const transcriptBox = document.getElementById('audioTranscriptBox');
      if (state.showScreenText) {
        transcriptBox.classList.remove('hidden');
      } else {
        transcriptBox.classList.add('hidden');
      }

      document.getElementById('sfxIcon').textContent = state.sfxMuted ? '🔇 Тихо' : '🔊 Звук';
      updateDiagnosticsBar(false);
    }

    function renderLogsList() {
      const container = document.getElementById('logsListContainer');
      document.getElementById('logCountBadge').textContent = String(state.logs.length);

      if (!state.logs.length) {
        container.innerHTML = `<div class="bg-slate-800/50 border border-slate-700/60 rounded-2xl p-6 text-center text-xs text-slate-400">Журнал порожній. Поставте запитання голосом або натисніть одну з тестових кнопок унизу!</div>`;
        return;
      }

      const statusBadgeMap = {
        CLEAR_SAFE: { label: '✅ Безпечно (Відповіли)', cls: 'bg-emerald-950 text-emerald-300 border-emerald-700/70' },
        UNCLEAR_OR_ADULT_MISHEARD: { label: '🛡️ Запобіжник STT (Перепитали)', cls: 'bg-amber-950 text-amber-300 border-amber-700/70' },
        SENSITIVE_TOPIC: { label: '👨‍👩‍👧 Стоп-тема (До батьків)', cls: 'bg-rose-950 text-rose-300 border-rose-700/70' },
        NOISE_OR_EMPTY: { label: '🌬️ Шум / Порожньо', cls: 'bg-slate-800 text-slate-300 border-slate-600' }
      };

      container.innerHTML = state.logs.map(item => {
        const st = statusBadgeMap[item.status] || statusBadgeMap.CLEAR_SAFE;
        return `
          <div class="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-3.5 space-y-1.5">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${st.cls}">${st.label}</span>
              <span class="text-[11px] text-slate-400 font-mono">${item.time} • Мова: ${(item.lang || 'uk').toUpperCase()}</span>
            </div>
            <p class="text-xs text-slate-300"><b>Почуто STT:</b> <span class="italic text-slate-400">${escapeHtml(item.heard || '')}</span></p>
            ${item.flaggedReason ? `<p class="text-xs text-amber-300 bg-amber-950/50 border border-amber-800/50 rounded-xl px-2.5 py-1"><b>Примітка безпеки:</b> ${escapeHtml(item.flaggedReason)}</p>` : ''}
            <p class="text-xs text-emerald-200 bg-slate-900/70 rounded-xl p-2"><b>Відповідь рації:</b> «${escapeHtml(item.response || '')}»</p>
          </div>
        `;
      }).join('');
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function switchParentTab(tabName) {
      const tabs = {
        logs: { view: 'parentTabLogs', btn: 'tabBtnLogs' },
        settings: { view: 'parentTabSettings', btn: 'tabBtnSettings' },
        guardrails: { view: 'parentTabGuardrails', btn: 'tabBtnGuardrails' }
      };
      Object.keys(tabs).forEach(k => {
        const v = document.getElementById(tabs[k].view);
        const b = document.getElementById(tabs[k].btn);
        if (k === tabName) {
          v.classList.remove('hidden');
          b.className = 'px-3.5 py-1.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs transition';
        } else {
          v.classList.add('hidden');
          b.className = 'px-3.5 py-1.5 rounded-xl bg-slate-800 text-slate-300 hover:text-white font-semibold text-xs transition';
        }
      });
      updateDiagnosticsBar(false);
    }

    window.addEventListener('DOMContentLoaded', async () => {
      document.getElementById('apiKeyInput').value = lockedApiKey || state.apiKey || '';
      document.getElementById('quickApiKeyInput').value = lockedApiKey || state.apiKey || '';
      document.getElementById('modelSelect').value = state.model || 'gemini-3.8-flash';
      document.getElementById('ttsEngineSelect').value = state.ttsEngine || 'auto';
      document.getElementById('languagePolicySelect').value = state.languagePolicy || 'always_uk';
      document.getElementById('childAgeSelect').value = state.childAge || '5';
      document.getElementById('dailyLimitInput').value = state.dailyLimit || 15;
      document.getElementById('toggleScreenText').checked = state.showScreenText !== false;
      document.getElementById('familyCustomNote').value = state.familyNote || '';

      if ('speechSynthesis' in window) {
        window.speechSynthesis.getVoices();
        window.speechSynthesis.onvoiceschanged = () => {
          updateDiagnosticsBar(false);
        };
      }

      generateNewMathChallenge();
      renderStarsAndCounters();
      renderLogsList();

      // Load ./audio/*.wav directly when hosted on GitHub Pages
      await preloadStaticAudioFolderWavs();

      if (getActiveApiKey()) {
        probeApiKeyAndModels(false);
      } else {
        document.getElementById('lastAiText').textContent = `«${SYSTEM_PROMPT_TEXTS.NO_KEY}»`;
      }

      document.body.addEventListener('pointerdown', () => {
        if (!hasPlayedStartupGreeting) {
          hasPlayedStartupGreeting = true;
          ensureAudioCtx();
          if (!getActiveApiKey() && wavPcmBank24k.NO_KEY) {
            playSystemPrompt('NO_KEY', { interruptCurrent: false });
          } else if (getActiveApiKey() && wavPcmBank24k.READY_INTRO && !isRecording && !isProcessingTurn) {
            playSystemPrompt('READY_INTRO', { interruptCurrent: false });
          }
        }
      }, { once: true });

      const quickInputEl = document.getElementById('quickApiKeyInput');
      quickInputEl.addEventListener('focus', () => {
        isEditingKeyManually = true;
      });
      quickInputEl.addEventListener('input', (e) => {
        syncApiKeyInputs(e.target.value, false);
      });

      document.getElementById('btnPasteKeyClipboard').addEventListener('click', async () => {
        ensureAudioCtx();
        try {
          const clipText = await navigator.clipboard.readText();
          if (clipText && clipText.trim().length >= 10) {
            quickInputEl.value = clipText.trim();
            syncApiKeyInputs(clipText.trim(), true);
            await probeApiKeyAndModels(true);
            showToast('✅ Ключ вставлено з буфера та озвучено у 24 кГц HD!');
          } else {
            showToast('Буфер обміну порожній — вставте ключ у поле');
          }
        } catch (e) {
          quickInputEl.focus();
          showToast('Утримуйте палець у полі вводу та натисніть «Вставити»');
        }
      });

      document.getElementById('btnQuickSaveKey').addEventListener('click', async () => {
        ensureAudioCtx();
        const val = quickInputEl.value;
        quickInputEl.blur();
        syncApiKeyInputs(val, true);
        if (getActiveApiKey()) {
          await probeApiKeyAndModels(true);
          showToast('⚡ Ключ підключено! Готую WAV-озвучку 24 кГц HD...');
        } else {
          showToast('Вставте ключ AIza... у поле');
        }
      });

      document.getElementById('btnChangeKeyQuick').addEventListener('click', () => {
        isEditingKeyManually = true;
        document.getElementById('quickApiKeyCard').classList.remove('hidden');
        document.getElementById('connectedKeyPill').classList.add('hidden');
        quickInputEl.focus();
        quickInputEl.select();
      });

      document.getElementById('btnPlayIntroHint').addEventListener('click', () => {
        ensureAudioCtx();
        if (getActiveApiKey()) {
          document.getElementById('lastAiText').textContent = `«${SYSTEM_PROMPT_TEXTS.READY_INTRO}»`;
          playSystemPrompt('READY_INTRO', { interruptCurrent: true });
        } else {
          document.getElementById('lastAiText').textContent = `«${SYSTEM_PROMPT_TEXTS.NO_KEY}»`;
          playSystemPrompt('NO_KEY', { interruptCurrent: true });
        }
      });

      document.getElementById('btnDownloadBakedHtml').addEventListener('click', () => {
        ensureAudioCtx();
        exportSelfBakedHtmlFile();
      });

      document.getElementById('btnDownloadAllWavFiles').addEventListener('click', () => {
        ensureAudioCtx();
        downloadSixWavFilesIndividually();
      });

      document.getElementById('btnDownloadPwaFilesOnly').addEventListener('click', () => {
        ensureAudioCtx();
        downloadPwaCoreFilesOnly();
      });

      document.getElementById('btnGenerateVoiceBankNow').addEventListener('click', async () => {
        ensureAudioCtx();
        if (!getActiveApiKey()) {
          showToast('Спочатку введіть API-ключ');
          return;
        }
        await ensureSystemVoiceBankPopulated(true, true);
      });

      document.querySelectorAll('.prompt-preview-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          ensureAudioCtx();
          const k = btn.getAttribute('data-prompt-key');
          playSystemPrompt(k, { interruptCurrent: true });
        });
      });

      const pttBtn = document.getElementById('btnPushToTalk');

      pttBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (Date.now() - lastPttActionTimestamp < 450) return;
        ensureAudioCtx();
        if (!isRecording && !isStartingMic) {
          lastPttActionTimestamp = Date.now();
          startRecording();
        } else if (isRecording) {
          stopRecording();
        }
      });

      pttBtn.addEventListener('pointerup', () => {
        if (isRecording && actualRecordingStartTime > 0 && (Date.now() - actualRecordingStartTime > 1300)) {
          stopRecording();
        }
      });

      document.getElementById('btnRepeatAnswer').addEventListener('click', () => {
        ensureAudioCtx();
        speakText(lastSpokenResponse, 'uk', false, false);
      });

      document.getElementById('btnStopSpeaking').addEventListener('click', () => {
        stopAllSpeech();
      });

      document.getElementById('btnMuteSfx').addEventListener('click', () => {
        state.sfxMuted = !state.sfxMuted;
        saveState();
        renderStarsAndCounters();
      });

      document.querySelectorAll('.sim-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          ensureAudioCtx();
          const preset = btn.getAttribute('data-sim');
          const defaultTexts = {
            apple: 'Чому яблуко називається яблуком?',
            phonetic: 'Чому либа плаває у воді?',
            adult_misheard: 'Чому [нерозбірливо / доросле слово] так швидко бігає?',
            sensitive: 'А звідки беруться діти?'
          };
          processChildTurn({ textInput: defaultTexts[preset] || '', presetKey: preset });
        });
      });

      document.getElementById('btnRunCustomSim').addEventListener('click', () => {
        ensureAudioCtx();
        const input = document.getElementById('customSimInput');
        const val = input.value.trim();
        if (!val) {
          showToast('Введіть тестову фразу дитини');
          return;
        }
        input.value = '';
        processChildTurn({ textInput: val });
      });

      document.getElementById('customSimInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          document.getElementById('btnRunCustomSim').click();
        }
      });

      document.getElementById('btnToggleSim').addEventListener('click', () => {
        const ctrl = document.getElementById('simulatorControls');
        const btn = document.getElementById('btnToggleSim');
        const isHidden = ctrl.classList.toggle('hidden');
        btn.textContent = isHidden ? 'Показати панель' : 'Сховати панель';
      });

      document.getElementById('btnParentLock').addEventListener('click', () => {
        generateNewMathChallenge();
        document.getElementById('gateAnswerInput').value = '';
        document.getElementById('gateErrorMsg').classList.add('hidden');
        document.getElementById('parentGateModal').classList.remove('hidden');
        document.getElementById('gateAnswerInput').focus();
      });

      document.getElementById('btnCloseGate').addEventListener('click', () => {
        document.getElementById('parentGateModal').classList.add('hidden');
      });

      document.getElementById('btnVerifyGate').addEventListener('click', () => {
        const ans = parseInt(document.getElementById('gateAnswerInput').value.trim(), 10);
        if (ans === currentMathExpected) {
          document.getElementById('parentGateModal').classList.add('hidden');
          document.getElementById('childView').classList.add('hidden');
          document.getElementById('parentView').classList.remove('hidden');
          renderLogsList();
          updateDiagnosticsBar(false);
        } else {
          generateNewMathChallenge();
          document.getElementById('gateAnswerInput').value = '';
          document.getElementById('gateErrorMsg').classList.remove('hidden');
        }
      });

      document.getElementById('gateAnswerInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('btnVerifyGate').click();
      });

      document.getElementById('btnBackToChild').addEventListener('click', () => {
        document.getElementById('parentView').classList.add('hidden');
        document.getElementById('childView').classList.remove('hidden');
        updateDiagnosticsBar(true);
      });

      document.getElementById('tabBtnLogs').addEventListener('click', () => switchParentTab('logs'));
      document.getElementById('tabBtnSettings').addEventListener('click', () => switchParentTab('settings'));
      document.getElementById('tabBtnGuardrails').addEventListener('click', () => switchParentTab('guardrails'));

      document.getElementById('apiKeyInput').addEventListener('input', (e) => {
        syncApiKeyInputs(e.target.value, false);
      });

      document.getElementById('btnSaveApiKey').addEventListener('click', async () => {
        const settingsEl = document.getElementById('apiKeyInput');
        settingsEl.blur();
        syncApiKeyInputs(settingsEl.value, true);
        if (getActiveApiKey()) {
          await probeApiKeyAndModels(true);
          showToast('Ключ збережено та перевірено!');
        } else {
          setMainErrorBanner('');
          showToast('Введіть валідний API-ключ');
        }
      });

      document.getElementById('modelSelect').addEventListener('change', (e) => {
        state.model = e.target.value;
        saveState();
        updateDiagnosticsBar(false);
      });

      document.getElementById('ttsEngineSelect').addEventListener('change', (e) => {
        state.ttsEngine = e.target.value;
        saveState();
        updateDiagnosticsBar(false);
      });

      document.getElementById('btnTestVoiceInSettings').addEventListener('click', () => {
        ensureAudioCtx();
        speakText('Привіт! Це швидкий потоковий голос рації Чомучки. Мені п\'ять рочків!', 'uk', true, false);
      });

      document.getElementById('languagePolicySelect').addEventListener('change', (e) => {
        state.languagePolicy = e.target.value;
        saveState();
        showToast('Мовну політику оновлено');
      });

      document.getElementById('childAgeSelect').addEventListener('change', (e) => {
        state.childAge = e.target.value;
        saveState();
      });

      document.getElementById('dailyLimitInput').addEventListener('change', (e) => {
        state.dailyLimit = Math.max(1, parseInt(e.target.value, 10) || 15);
        saveState();
        renderStarsAndCounters();
      });

      document.getElementById('btnResetDailyCount').addEventListener('click', () => {
        state.usedToday = 0;
        saveState();
        renderStarsAndCounters();
        showToast('Зірочки на сьогодні поновлено!');
      });

      document.getElementById('toggleScreenText').addEventListener('change', (e) => {
        state.showScreenText = e.target.checked;
        saveState();
        renderStarsAndCounters();
      });

      document.getElementById('btnClearLogs').addEventListener('click', () => {
        state.logs = [];
        saveState();
        renderLogsList();
        showToast('Журнал запитань очищено');
      });

      document.getElementById('familyCustomNote').addEventListener('input', (e) => {
        state.familyNote = e.target.value;
        saveState();
      });

      document.querySelectorAll('.topic-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
          const checked = [];
          document.querySelectorAll('.topic-checkbox:checked').forEach(el => {
            checked.push(el.getAttribute('data-topic'));
          });
          state.sensitiveTopics = checked;
          saveState();
        });
      });
    });
