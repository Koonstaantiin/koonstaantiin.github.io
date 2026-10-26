    // =========================================================================
    // 5. GEMINI 3.8 MULTIMODAL & TEXT GUARDRAIL ENGINE
    // =========================================================================
    function buildSystemInstruction() {
      const langRule = state.languagePolicy === 'always_uk'
        ? 'Дитина може говорити українською, російською, англійською або суржиком. Ти розумієш усі три мови, але в полі spoken_response ЗАВЖДИ відповідай теплою, простою УКРАЇНСЬКОЮ мовою.'
        : (state.languagePolicy === 'bilingual_en'
          ? 'Відповідай українською мовою, але в кінці відповіді грайливо додай одне просте англійське слово по темі запитання з перекладом.'
          : 'Відповідай тією мовою (UA, RU або EN), якою запитала дитина.');

      return `Ти — доброзичлива «Чомучка-Рація» для дитини віком ${state.childAge} років.
Проаналізуй аудіо або текст дитини, застосуй вікові запобіжники і поверни ВИКЛЮЧНО валідний JSON-об'єкт з такими полями:
{
  "heard_transcript": "що буквально почулося",
  "reconstructed_intent": "як ти зрозумів дитячий задум",
  "detected_language": "uk" | "ru" | "en" | "mixed",
  "safety_status": "CLEAR_SAFE" | "UNCLEAR_OR_ADULT_MISHEARD" | "SENSITIVE_TOPIC" | "NOISE_OR_EMPTY",
  "flagged_word_or_reason": "причина спрацювання запобіжника або порожній рядок",
  "spoken_response": "готова відповідь для озвучення дитині (2-3 коротких речення)"
}

ПРАВИЛА ДЛЯ ШВИДКОГО КОНВЕЄРНОГО ОЗВУЧЕННЯ (ВАЖЛИВО):
- Перше речення у полі spoken_response ЗАВЖДИ роби дуже коротким та живим (3–5 слів зі знаком оклику, наприклад: «Ого, яке чудове питання!», «Зараз відкрию тобі секрет!», «Ой, рація трохи зашуміла!»), щоб перший голосовий чанк згенерувався миттєво менш ніж за секунду!
- Після першого короткого речення напиши 1–2 прості речення пояснення.

ПРАВИЛА ЗАПОБІЖНИКІВ (GUARDRAILS):
1. ФОНЕТИЧНИЙ РЯТІВНИК (CLEAR_SAFE): У ${state.childAge} років діти часто замінюють звуки («либа»=«риба», «сяпка»=«шапка», «колябель»=«корабель», або змішують UA/RU/EN слова). Якщо з контексту зрозуміло, яке невинне дитяче слово мала на увазі дитина — став статус "CLEAR_SAFE", запиши реконструйоване питання в reconstructed_intent і дай просту, образну відповідь.
2. НЕЗРОЗУМІЛЕ АБО ДОРОСЛЕ СЛОВО (UNCLEAR_OR_ADULT_MISHEARD): Якщо ключове слово звучить нерозбірливо, безглуздо в контексті АБО схоже на доросле/лайливе/вульгарне слово (через помилку дикції чи STT):
   - Став статус "UNCLEAR_OR_ADULT_MISHEARD".
   - КАТЕГОРИЧНО ЗАБОРОНЕНО повторювати підозріле чи доросле слово в полі spoken_response!
   - У spoken_response грайливо скажи, що рація трохи зашуміла на словечку, і попроси дитину описати предмет іншими словами (наприклад, якого він кольору, де живе або що робить), спираючись на зрозумілу частину речення.
3. ЧУТЛИВА ТЕМА (SENSITIVE_TOPIC): Якщо дитина прямо запитує про теми зі списку батьків (${state.sensitiveTopics.join(', ')}):
   - Став статус "SENSITIVE_TOPIC".
   - У spoken_response тепло скажи, що це дуже важливе питання, про яке найкраще запитати маму чи тата, і запропонуй цікавий безпечний факт.
4. ТИША АБО ШУМ (NOISE_OR_EMPTY): Якщо чути лише шурхіт або менше одного слова — став "NOISE_OR_EMPTY" і попроси спробувати ще раз.

МОВНА ПОЛІТИКА: ${langRule}
ДОДАТКОВІ ПРАВИЛА СІМ'Ї: ${state.familyNote || 'Немає'}`;
    }

    function parseGeminiJsonFromData(data) {
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const nonThoughtParts = parts.filter(p => !p.thought && typeof p.text === 'string' && p.text.trim().length > 0);
      const targetPart = nonThoughtParts.length > 0
        ? nonThoughtParts[nonThoughtParts.length - 1]
        : parts.find(p => typeof p.text === 'string' && p.text.includes('{'));

      if (!targetPart || !targetPart.text) {
        throw new Error('Модель не повернула текстовий JSON');
      }

      let raw = targetPart.text.trim();
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const firstBrace = raw.indexOf('{');
      const lastBrace = raw.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        raw = raw.slice(firstBrace, lastBrace + 1);
      }
      return JSON.parse(raw);
    }

    async function callGeminiApi({ base64Audio, mimeType, textInput }) {
      const apiKey = getActiveApiKey();
      const parts = [];
      if (base64Audio) {
        parts.push({
          inlineData: {
            mimeType: (mimeType || 'audio/webm').split(';')[0],
            data: base64Audio
          }
        });
        parts.push({ text: 'Проаналізуй це голосове запитання дитини та поверни JSON.' });
      } else {
        parts.push({ text: `Транскрипція запитання дитини: "${textInput}". Проаналізуй та поверни JSON.` });
      }

      const defaultChain = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];
      const modelsToTry = [...new Set([state.model, ...discoveredTextModels, ...defaultChain])].filter(m => m && !m.startsWith('gemini-2.0'));

      const modelErrors = [];
      for (const modelId of modelsToTry) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 22000);
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: buildSystemInstruction() }] },
              contents: [{ role: 'user', parts }],
              generationConfig: {
                temperature: 0.4,
                responseMimeType: 'application/json'
              }
            })
          });

          clearTimeout(timeoutId);
          if (!response.ok) {
            let apiErrDetail = '';
            try {
              const errObj = await response.json();
              apiErrDetail = errObj?.error?.message || '';
            } catch (e) {}
            const msg = `HTTP ${response.status} (${modelId})${apiErrDetail ? ': ' + apiErrDetail : ''}`;
            modelErrors.push(msg);
            if (response.status === 404 || response.status === 503) continue;
            throw new Error(msg);
          }

          const data = await response.json();
          const parsed = parseGeminiJsonFromData(data);
          if (state.model !== modelId) {
            state.model = modelId;
            saveState();
            const sel = document.getElementById('modelSelect');
            if (sel) sel.value = modelId;
          }
          setMainErrorBanner('');
          return {
            heard_transcript: parsed.heard_transcript || textInput || '(голос з мікрофона)',
            reconstructed_intent: parsed.reconstructed_intent || parsed.heard_transcript || '',
            detected_language: parsed.detected_language || 'uk',
            safety_status: parsed.safety_status || 'CLEAR_SAFE',
            flagged_word_or_reason: parsed.flagged_word_or_reason || '',
            spoken_response: parsed.spoken_response || 'Яке цікаве запитання!'
          };
        } catch (err) {
          clearTimeout(timeoutId);
          modelErrors.push(`${modelId}: ${err.message || 'помилка'}`);
        }
      }

      throw new Error(modelErrors[0] || 'Не вдалося виконати запит до Gemini API');
    }

    function simulateGuardrailPipeline(rawInput, presetKey = null, hadRawAudioBlob = false) {
      const text = (rawInput || '').trim();
      const lower = text.toLowerCase();

      if (presetKey === 'apple' || lower.includes('яблук') || lower.includes('яблок') || lower.includes('apple')) {
        return {
          heard_transcript: text || 'Чому яблуко називається яблуком?',
          reconstructed_intent: 'Чому яблуко має таку назву?',
          detected_language: 'uk',
          safety_status: 'CLEAR_SAFE',
          flagged_word_or_reason: '',
          spoken_response: 'Ого, яке смачне питання! Слово «яблуко» дуже давнє і колись означало просто «круглий соковитий плід» на гілочці. А тобі більше смакують червоні чи зелені яблучка?'
        };
      }

      if (presetKey === 'phonetic' || lower.includes('либа') || lower.includes('либка') || lower.includes('риба') || lower.includes('рибка')) {
        return {
          heard_transcript: text || 'Чому либа плаває у воді?',
          reconstructed_intent: 'Фонетична реконструкція: «либа» → «риба» (Чому риба плаває у воді?)',
          detected_language: 'uk',
          safety_status: 'CLEAR_SAFE',
          flagged_word_or_reason: 'Розпізнано дитячу заміну звуку Л→Р («либа» → «риба»)',
          spoken_response: 'Зараз відкрию тобі секрет! Рибка має плавники, схожі на маленькі весла, і хвостик-кермо, яким вона відштовхується від водички. А ще всередині неї є невидима повітряна кулька, яка тримає її на плаву!'
        };
      }

      if (presetKey === 'adult_misheard' || /(бля|хрєн|срак|дуп|секс|порн|хуй|пізд|фак|fuck|shit|біткоїн|іпотек|доросле)/i.test(lower)) {
        return {
          heard_transcript: text || 'Чому [схоже на доросле/нечітке слово] так швидко бігає?',
          reconstructed_intent: 'Спрацював віковий/акустичний фільтр — потрібне уточнення без повторення слова',
          detected_language: 'uk',
          safety_status: 'UNCLEAR_OR_ADULT_MISHEARD',
          flagged_word_or_reason: 'STT розпізнав доросле або нетипове для 5 років слово. Пряму відповідь заблоковано.',
          spoken_response: 'Ой, рація трохи зашуміла! Ти питаєш про когось, хто швидко бігає — це якась пухнаста тваринка чи швидка машинка? Розкажи мені іншими словами!'
        };
      }

      if (presetKey === 'sensitive' || /(звідки беруться діти|помирає|смерть|війна|вбиває|бог|гроші)/i.test(lower)) {
        return {
          heard_transcript: text || 'А звідки беруться діти?',
          reconstructed_intent: 'Запитання зі списку чутливих сімейних тем',
          detected_language: 'uk',
          safety_status: 'SENSITIVE_TOPIC',
          flagged_word_or_reason: 'Чутлива сімейна тема (налаштування батьків) — перенаправлено до мами й тата',
          spoken_response: 'Ого, яке важливе питання! Про це найкраще і найтепліше розкажуть мама або тато — обов\'язково спитай їх сьогодні. А хочеш, я поки розповім, як народжуються зірочки в космосі?'
        };
      }

      if (!text || text.length < 2) {
        return {
          heard_transcript: '',
          reconstructed_intent: '',
          detected_language: 'uk',
          safety_status: 'NOISE_OR_EMPTY',
          flagged_word_or_reason: hadRawAudioBlob
            ? 'Запис занадто короткий (натисніть жовту кнопку -> скажіть фразу -> натисніть червону кнопку).'
            : 'Мікрофон не передав аудіо (перевірте дозвіл мікрофона або натисніть жовту кнопку -> скажіть фразу -> натисніть червону).',
          spoken_response: SYSTEM_PROMPT_TEXTS.READY_INTRO
        };
      }

      if (lower.includes('небо') || lower.includes('сонц') || lower.includes('хмар')) {
        return {
          heard_transcript: text,
          reconstructed_intent: text,
          detected_language: 'uk',
          safety_status: 'CLEAR_SAFE',
          flagged_word_or_reason: '',
          spoken_response: 'Яке гарне сонячне питання! Сонечко світить високо в небі, як величезний теплий ліхтарик, а його промінчики фарбують повітря у блакитний колір. А ти любиш дивитися на пухнасті хмаринки?'
        };
      }

      if (lower.includes('dog') || lower.includes('cat') || lower.includes('пес') || lower.includes('кіт') || lower.includes('собак')) {
        return {
          heard_transcript: text,
          reconstructed_intent: `Мультимовне запитання про тваринку: ${text}`,
          detected_language: /[a-z]/i.test(text) ? 'mixed' : 'uk',
          safety_status: 'CLEAR_SAFE',
          flagged_word_or_reason: /[a-z]/i.test(text) ? 'Дитина змішала українські та англійські слова (білінгвальний режим)' : '',
          spoken_response: 'О, питання про пухнастиків! Песики гавкають, бо це їхня власна мова, якою вони кажуть «Привіт, давай гратися!». А як каже маленьке кошенятко?'
        };
      }

      const hasEnglish = /[a-zA-Z]{2,}/.test(text);
      const hasRussian = /[ыэъё]|почему|зачем/i.test(text);
      const detectedLang = hasEnglish ? 'mixed' : (hasRussian ? 'ru' : 'uk');

      return {
        heard_transcript: text,
        reconstructed_intent: `Пізнавальне запитання (${detectedLang.toUpperCase()}): ${text}`,
        detected_language: detectedLang,
        safety_status: 'CLEAR_SAFE',
        flagged_word_or_reason: hasRussian && state.languagePolicy === 'always_uk'
          ? 'Запитання російською — відповідь м\'яко надано українською згідно з політикою сім\'ї'
          : '',
        spoken_response: `Ого, яке чудове питання! У світі все влаштовано дуже розумно, ніби великий конструктор, де кожна деталька допомагає іншій працювати. А як ти сам думаєш, чому воно саме таке?`
      };
    }

