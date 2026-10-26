    // =========================================================================
    // 3. API KEY DIAGNOSTICS, MODEL DISCOVERY & HD VOICE BANK INITIALIZATION
    // =========================================================================
    async function probeApiKeyAndModels(playIntroVoice = false) {
      const apiKey = getActiveApiKey();
      if (!apiKey) {
        lastTtsDiagnosticMsg = 'Ключ не введено.';
        updateDiagnosticsBar(false);
        return;
      }

      lastTtsDiagnosticMsg = '⏳ Перевіряю ключ та готую студійні голосові підказки (24 кГц, 16-біт)...';
      updateDiagnosticsBar(false);

      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
        if (!res.ok) {
          let errMsg = `HTTP ${res.status}`;
          try {
            const errJson = await res.json();
            if (errJson?.error?.message) errMsg += `: ${errJson.error.message}`;
          } catch (e) {}
          lastTtsDiagnosticMsg = `❌ Помилка перевірки ключа (${errMsg}).`;
          setMainErrorBanner(lastTtsDiagnosticMsg);
          updateDiagnosticsBar(false);
          return;
        }

        const data = await res.json();
        const models = (data.models || []).map(m => (m.name || '').replace(/^models\//, ''));
        discoveredTtsModels = models.filter(m => m.includes('tts'));
        discoveredTextModels = models.filter(m =>
          m.startsWith('gemini-') &&
          !m.includes('tts') &&
          !m.includes('image') &&
          !m.includes('embedding') &&
          !m.includes('veo') &&
          !m.startsWith('gemini-2.0')
        );

        const selectEl = document.getElementById('modelSelect');
        if (selectEl && discoveredTextModels.length > 0) {
          const preferred = ['gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];
          const availablePreferred = preferred.filter(p => discoveredTextModels.includes(p));
          const listToUse = availablePreferred.length ? availablePreferred : discoveredTextModels.slice(0, 6);
          if (!listToUse.includes(state.model)) {
            state.model = listToUse[0];
            saveState();
          }
          selectEl.innerHTML = listToUse.map(m => `<option value="${escapeHtml(m)}" ${m === state.model ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('');
        }

        setMainErrorBanner('');
        lastTtsDiagnosticMsg = `✅ Ключ перевірено! Робоча модель: ${state.model}. Доступні TTS: ${discoveredTtsModels.join(', ') || 'gemini-3.8-flash-lite-tts'}.`;
        updateDiagnosticsBar(true);

        await ensureSystemVoiceBankPopulated(playIntroVoice, false);
      } catch (e) {
        lastTtsDiagnosticMsg = `❌ Мережева помилка при перевірці моделей: ${e.message}`;
        updateDiagnosticsBar(false);
      }
    }

    function getCandidateTtsConfigs() {
      if (cachedWorkingTtsConfig) {
        return [cachedWorkingTtsConfig];
      }
      const defaultTtsList = [
        'gemini-3.8-flash-lite-tts',
        'gemini-3.8-flash-tts',
        'gemini-3.1-flash-tts-preview',
        'gemini-2.5-flash-preview-tts'
      ];
      const models = discoveredTtsModels.length > 0
        ? [...new Set([...discoveredTtsModels, ...defaultTtsList])]
        : defaultTtsList;

      const list = [];
      for (const m of models) {
        const is38 = m.includes('3.8');
        if (is38) {
          list.push({ modelName: m, vConfig: { voice: 'Kore' } });
          list.push({ modelName: m, vConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } });
        } else {
          list.push({ modelName: m, vConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } });
          list.push({ modelName: m, vConfig: { voice: 'Kore' } });
        }
      }
      return list;
    }

