// =========================================================================
// 4. SELECTION-AWARE PAGE ASSISTANT (CONTEXT CACHE, AUTO-INVALIDATION & Q&A)
// Chrome Side Panel Extension (chrome_plugin/sidepanel.html)
// =========================================================================

let pageContextCache = {
  tabId: null,
  url: '',
  title: '',
  charCount: 0,
  contentHash: '',
  contextData: null,
  interactionId: null,
  modelId: '',
  questionCount: 0,
  history: []
};

function computeFastTextHash(str) {
  const s = String(str || '');
  let h = 2166136261;
  const len = s.length;
  // Hash up to 28,000 characters so it matches cleanBody and runs in <0.3ms
  const limit = Math.min(len, 28000);
  for (let i = 0; i < limit; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${len}:${(h >>> 0).toString(36)}`;
}

function normalizePageCacheUrl(rawUrl) {
  return String(rawUrl || '').trim();
}

function isPageCacheValidFor(tabId, url, title, charCount, contentHash = '') {
  if (!pageContextCache.contextData) return false;
  if (tabId !== null && pageContextCache.tabId !== null && tabId !== pageContextCache.tabId) {
    return false;
  }
  const normUrl = normalizePageCacheUrl(url);
  if (normUrl && pageContextCache.url && normUrl !== pageContextCache.url) {
    return false;
  }
  // Exact content hash check: catches even a single changed sentence on the same URL (e.g., in-place quiz/SPA)
  if (contentHash && pageContextCache.contentHash && contentHash !== pageContextCache.contentHash) {
    return false;
  }
  if (title && pageContextCache.title && title !== pageContextCache.title) {
    return false;
  }
  if (typeof charCount === 'number' && pageContextCache.charCount > 0) {
    const diff = Math.abs(charCount - pageContextCache.charCount);
    const ratio = diff / Math.max(pageContextCache.charCount, 1);
    if (diff > 2500 && ratio > 0.35) {
      return false;
    }
  }
  return true;
}

function resetPageAssistantCache(reason = '') {
  const hadCache = Boolean(pageContextCache.contextData || pageContextCache.interactionId);
  pageContextCache = {
    tabId: null,
    url: '',
    title: '',
    charCount: 0,
    contentHash: '',
    contextData: null,
    interactionId: null,
    modelId: '',
    questionCount: 0,
    history: []
  };
  if ((hadCache || reason === 'manual') && typeof renderPageAssistantView === 'function') {
    renderPageAssistantView();
  }
}

async function syncActiveTabSelection(forceResetIgnore = false) {
  const pa = currentProofreadState.pageAssistant;
  if (!pa) return;

  if (isChromeExtensionEnv() && chrome.tabs && chrome.scripting) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id || /^(chrome|edge|about|chrome-extension):/i.test(tab.url || '')) {
        return;
      }
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const sel = (window.getSelection ? window.getSelection().toString() : '').trim();
          const mainRoot = document.querySelector('article, main, [role="main"]') || document.body;
          const rawBody = (mainRoot ? mainRoot.innerText : document.body?.innerText) || '';
          const cleanBody = rawBody.replace(/\n{3,}/g, '\n\n').trim().slice(0, 28000);
          let h = 2166136261;
          for (let i = 0; i < cleanBody.length; i++) {
            h ^= cleanBody.charCodeAt(i);
            h = Math.imul(h, 16777619);
          }
          const contentHash = `${cleanBody.length}:${(h >>> 0).toString(36)}`;
          return {
            selectedText: sel.slice(0, 6000),
            title: document.title || '',
            url: location.href || '',
            charCount: rawBody.length,
            contentHash
          };
        }
      });
      const info = results?.[0]?.result;
      if (!info) return;

      // Auto-invalidate page context cache if tab, URL, query params, or in-place page text hash changed
      if (pageContextCache.contextData && !isPageCacheValidFor(tab.id, info.url, info.title, info.charCount, info.contentHash)) {
        resetPageAssistantCache('page_changed');
      }

      let changed = false;
      if (info.title && info.title !== pa.pageTitle) {
        pa.pageTitle = info.title;
        changed = true;
      }
      if (info.url && info.url !== pa.pageUrl) {
        pa.pageUrl = info.url;
        changed = true;
      }
      if (typeof info.charCount === 'number' && info.charCount !== pa.charCount) {
        pa.charCount = info.charCount;
        changed = true;
      }

      const liveSel = (info.selectedText || '').trim();
      if (liveSel !== pa.selectedText) {
        pa.selectedText = liveSel;
        if (liveSel) {
          // Automatically prioritize newly selected text on the page
          pa.ignoreSelection = false;
        }
        changed = true;
      } else if (forceResetIgnore && liveSel) {
        pa.ignoreSelection = false;
        changed = true;
      }

      if (changed && typeof renderPageAssistantView === 'function') {
        renderPageAssistantView();
      }
    } catch (e) {
      // Tab may block scripting (e.g., Chrome Web Store); ignore silently
    }
    return;
  }

  // Fallback for standalone preview in browser tab
  const localSel = (window.getSelection ? window.getSelection().toString() : '').trim();
  const activeEl = document.activeElement;
  const isInternalSelection = activeEl && (activeEl.id === 'proofreadOriginalInput' || activeEl.id === 'pageAssistantInput');
  if (!isInternalSelection && localSel && localSel !== pa.selectedText) {
    pa.selectedText = localSel;
    pa.ignoreSelection = false;
    if (typeof renderPageAssistantView === 'function') {
      renderPageAssistantView();
    }
  }
}

async function extractActiveTabPageContext(forceRefresh = false) {
  const pa = currentProofreadState.pageAssistant;

  if (forceRefresh) {
    resetPageAssistantCache('manual');
  }

  if (isChromeExtensionEnv() && chrome.tabs && chrome.scripting) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id && !/^(chrome|edge|about|chrome-extension):/i.test(tab.url || '')) {
        // 1. Fast probe: check live selection, URL, title, and FNV-1a contentHash first
        const probeRes = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const selObj = window.getSelection ? window.getSelection() : null;
            const selectedText = (selObj ? selObj.toString() : '').trim();
            let selectionSurrounding = '';
            if (selObj && selObj.rangeCount > 0 && selectedText) {
              let node = selObj.getRangeAt(0).commonAncestorContainer;
              if (node && node.nodeType === 3) node = node.parentElement;
              const blockEl = node?.closest?.('p, li, td, article, section, div') || node;
              if (blockEl && typeof blockEl.innerText === 'string') {
                selectionSurrounding = blockEl.innerText.replace(/\s+/g, ' ').trim().slice(0, 2500);
              }
            }
            const mainRoot = document.querySelector('article, main, [role="main"]') || document.body;
            const rawBody = (mainRoot ? mainRoot.innerText : document.body?.innerText) || '';
            const cleanBody = rawBody.replace(/\n{3,}/g, '\n\n').trim().slice(0, 28000);
            let h = 2166136261;
            for (let i = 0; i < cleanBody.length; i++) {
              h ^= cleanBody.charCodeAt(i);
              h = Math.imul(h, 16777619);
            }
            const contentHash = `${cleanBody.length}:${(h >>> 0).toString(36)}`;
            return {
              title: document.title || '',
              url: location.href || '',
              selectedText: selectedText.slice(0, 6000),
              selectionSurrounding,
              charCount: rawBody.length,
              contentHash
            };
          }
        });

        const probe = probeRes?.[0]?.result;
        if (probe) {
          // Update live selection state
          if (probe.selectedText && probe.selectedText !== pa.selectedText) {
            pa.selectedText = probe.selectedText;
            pa.ignoreSelection = false;
          } else if (!probe.selectedText && pa.selectedText && !pa.ignoreSelection) {
            probe.selectedText = pa.selectedText;
          }

          // Check if our cached page context is still valid for this tab, URL & exact contentHash
          if (!forceRefresh && isPageCacheValidFor(tab.id, probe.url, probe.title, probe.charCount, probe.contentHash)) {
            pa.pageTitle = pageContextCache.contextData.title || probe.title;
            pa.pageUrl = pageContextCache.contextData.url || probe.url;
            pa.charCount = pageContextCache.contextData.charCount || probe.charCount;
            return {
              ...pageContextCache.contextData,
              selectedText: probe.selectedText,
              selectionSurrounding: probe.selectionSurrounding,
              fromCache: true
            };
          }

          // Cache miss or page changed -> reset old cache and scrape full page DOM
          if (pageContextCache.contextData) {
            resetPageAssistantCache('page_changed');
          }
        }

        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const selObj = window.getSelection ? window.getSelection() : null;
            const selectedText = (selObj ? selObj.toString() : '').trim();

            let selectionSurrounding = '';
            if (selObj && selObj.rangeCount > 0 && selectedText) {
              let node = selObj.getRangeAt(0).commonAncestorContainer;
              if (node && node.nodeType === 3) node = node.parentElement;
              const blockEl = node?.closest?.('p, li, td, article, section, div') || node;
              if (blockEl && typeof blockEl.innerText === 'string') {
                selectionSurrounding = blockEl.innerText.replace(/\s+/g, ' ').trim().slice(0, 2500);
              }
            }

            const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
            const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
              .map(h => (h.innerText || '').replace(/\s+/g, ' ').trim())
              .filter(Boolean)
              .slice(0, 25);

            const mainRoot = document.querySelector('article, main, [role="main"]') || document.body;
            const rawBody = (mainRoot ? mainRoot.innerText : document.body?.innerText) || '';
            const cleanBody = rawBody.replace(/\n{3,}/g, '\n\n').trim().slice(0, 28000);
            let h = 2166136261;
            for (let i = 0; i < cleanBody.length; i++) {
              h ^= cleanBody.charCodeAt(i);
              h = Math.imul(h, 16777619);
            }
            const contentHash = `${cleanBody.length}:${(h >>> 0).toString(36)}`;

            return {
              title: document.title || '',
              url: location.href || '',
              metaDescription: metaDesc.trim(),
              selectedText: selectedText.slice(0, 6000),
              selectionSurrounding,
              headings,
              bodyText: cleanBody,
              charCount: rawBody.length,
              contentHash
            };
          }
        });

        const ctx = results?.[0]?.result;
        if (ctx) {
          if (ctx.selectedText && ctx.selectedText !== pa.selectedText) {
            pa.selectedText = ctx.selectedText;
            pa.ignoreSelection = false;
          } else if (!ctx.selectedText && pa.selectedText && !pa.ignoreSelection) {
            ctx.selectedText = pa.selectedText;
          }
          pa.pageTitle = ctx.title || tab.title || '';
          pa.pageUrl = ctx.url || tab.url || '';
          pa.charCount = ctx.charCount || ctx.bodyText.length;

          // Populate static page cache for subsequent questions on this page
          pageContextCache.tabId = tab.id;
          pageContextCache.url = normalizePageCacheUrl(pa.pageUrl);
          pageContextCache.title = pa.pageTitle;
          pageContextCache.charCount = pa.charCount;
          pageContextCache.contentHash = ctx.contentHash || computeFastTextHash(ctx.bodyText);
          pageContextCache.contextData = {
            title: pa.pageTitle,
            url: pa.pageUrl,
            metaDescription: ctx.metaDescription,
            headings: ctx.headings,
            bodyText: ctx.bodyText,
            charCount: pa.charCount
          };
          pageContextCache.interactionId = null;
          pageContextCache.questionCount = 0;
          pageContextCache.history = [];

          if (typeof renderPageAssistantView === 'function') {
            renderPageAssistantView();
          }
          return {
            ...ctx,
            fromCache: false
          };
        }
      }
    } catch (e) {}
  }

  // Fallback context (when opened directly or on a browser system page)
  const editorText = (document.getElementById('proofreadOriginalInput')?.value || currentProofreadState.originalText || '').trim();
  const effectiveSel = (!pa.ignoreSelection && pa.selectedText) ? pa.selectedText : '';
  const fallbackUrl = pa.pageUrl || location.href || 'local://editor';
  const fallbackTitle = pa.pageTitle || document.title || 'Поточна вкладка / Редактор';
  const fallbackBody = editorText || document.body?.innerText?.slice(0, 12000) || '';
  const fallbackHash = computeFastTextHash(fallbackBody);

  if (!forceRefresh && isPageCacheValidFor(null, fallbackUrl, fallbackTitle, fallbackBody.length, fallbackHash)) {
    return {
      ...pageContextCache.contextData,
      selectedText: effectiveSel,
      selectionSurrounding: '',
      fromCache: true
    };
  }

  pageContextCache.tabId = null;
  pageContextCache.url = normalizePageCacheUrl(fallbackUrl);
  pageContextCache.title = fallbackTitle;
  pageContextCache.charCount = fallbackBody.length;
  pageContextCache.contentHash = fallbackHash;
  pageContextCache.contextData = {
    title: fallbackTitle,
    url: fallbackUrl,
    metaDescription: '',
    headings: [],
    bodyText: fallbackBody,
    charCount: fallbackBody.length
  };
  pageContextCache.interactionId = null;
  pageContextCache.questionCount = 0;
  pageContextCache.history = [];
  if (typeof renderPageAssistantView === 'function') {
    renderPageAssistantView();
  }

  return {
    ...pageContextCache.contextData,
    selectedText: effectiveSel,
    selectionSurrounding: '',
    fromCache: false
  };
}

const PAGE_ASSISTANT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    answered_scope: { type: 'string' }
  },
  required: ['answer', 'answered_scope']
};

async function callGeminiPageAssistantApi(userQuestion, pageContext, signal = null) {
  const apiKey = getProofreadApiKey();
  const pa = currentProofreadState.pageAssistant;
  const activeSelection = (!pa.ignoreSelection && pageContext.selectedText)
    ? pageContext.selectedText.trim()
    : '';
  const hasPrioritySelection = Boolean(activeSelection);

  if (!apiKey) {
    await new Promise(r => setTimeout(r, 200));
    pageContextCache.questionCount = (pageContextCache.questionCount || 0) + 1;
    const cacheStatusText = pageContext.fromCache
      ? `⚡ Використано закешований контекст сторінки (запит #${pageContextCache.questionCount} без повторного сканування DOM)`
      : `🆕 Контекст сторінки зчитано та збережено в кеш (запит #1)`;
    const scopeLabel = hasPrioritySelection
      ? `🎯 Пріоритетний виділений фрагмент (${activeSelection.length} симв.):\n«${activeSelection.slice(0, 350)}${activeSelection.length > 350 ? '...' : ''}»`
      : `🌐 Контекст сторінки: «${pageContext.title || 'Поточна вкладка'}» (${pageContext.bodyText.length} симв.)`;
    return {
      answered_scope: hasPrioritySelection ? 'selection' : 'page',
      answer: `🔑 Для отримання відповідей Page AI підключіть ваш Gemini API-ключ у верхньому блоці «🔑 Gemini API та модель» і натисніть «Зберегти».\n\n${cacheStatusText}\n${scopeLabel}\n\nВаш запит: «${userQuestion}»`
    };
  }

  const sysInstruction = `Ти — розумний ШІ-асистент по вебсторінці (Page Assistant) у бічній панелі браузера.
Твоє завдання — дати точну, вичерпну та добре структуровану відповідь на запитання або промпт користувача на основі переданого контексту поточної сторінки.

ГОЛОВНЕ ПРАВИЛО ПРІОРИТЕТУ ВИДІЛЕНОГО ТЕКСТУ:
1. Якщо передано непорожній блок [ВИДІЛЕНИЙ КОРИСТУВАЧЕМ ТЕКСТ НА СТОРІНЦІ (НАЙВИЩИЙ ПРІОРИТЕТ)] — користувач спеціально виділив цей фрагмент мишкою! Ти ОБОВ'ЯЗКОВО маєш відповідати на запитання/промпт насамперед про цей виділений фрагмент, розбираючи саме його зміст, терміни, граматику чи питання в ньому.
2. Весь інший текст сторінки [ПОВНИЙ ТЕКСТ СТОРІНКИ] використовуй як фоновий контекст (щоб розуміти загальну тему статті, розшифровувати займенники чи зв'язок із сусідніми абзацами).
3. Якщо виділеного тексту немає — відповідай на запитання за всім вмістом сторінки.
4. Відповідай тією мовою, якою написано запитання користувача (за замовчуванням — українською). Використовуй зручні абзаци та списки (• або 1., 2.) для легкості читання.
5. Поверни JSON-об'єкт: { "answer": "текст відповіді", "answered_scope": "selection" | "page" }.`;

  // STATIC PREFIX FIRST (100% identical across all questions on the same page for Gemini Implicit Context Caching)
  const headingsBlock = Array.isArray(pageContext.headings) && pageContext.headings.length > 0
    ? `[Заголовки сторінки]: ${pageContext.headings.join(' | ')}\n`
    : '';

  const staticPagePrefix = `=== 📄 СТАТИЧНИЙ КОНТЕКСТ СТОРІНКИ (КЕШОВАНИЙ ПРЕФІКС) ===
[Сторінка]: ${pageContext.title || 'Без назви'}
[URL]: ${pageContext.url || '—'}
${pageContext.metaDescription ? `[Опис]: ${pageContext.metaDescription}\n` : ''}${headingsBlock}"""
${pageContext.bodyText || '(Текст сторінки порожній)'}
"""`;

  // DYNAMIC SUFFIX (History + Active Selection + Current Question)
  const historyBlock = Array.isArray(pageContextCache.history) && pageContextCache.history.length > 0
    ? `\n=== 💬 ПОПЕРЕДНІ ЗАПИТАННЯ ПО ЦІЙ СТОРІНЦІ ===\n` +
      pageContextCache.history
        .slice(-3)
        .map((turn, idx) => `Питання #${idx + 1}: ${turn.question}\nВідповідь #${idx + 1}: ${turn.answer.slice(0, 600)}`)
        .join('\n---\n') +
      '\n'
    : '';

  const selectionBlock = hasPrioritySelection
    ? `\n=== 🎯 ВИДІЛЕНИЙ КОРИСТУВАЧЕМ ТЕКСТ НА СТОРІНЦІ (НАЙВИЩИЙ ПРІОРИТЕТ — ВІДПОВІДАЙ НАСАМПЕРЕД ПРО ЦЕЙ ФРАГМЕНТ) ===\n"""\n${activeSelection}\n"""\n${pageContext.selectionSurrounding ? `[Сусідній абзац навколо виділення]:\n"""\n${pageContext.selectionSurrounding}\n"""\n` : ''}`
    : '\n[Виділеного фрагмента наразі немає — відповідай за змістом усієї сторінки]\n';

  const dynamicQuestionSuffix = `${selectionBlock}\n=== ❓ ПОТОЧНЕ ЗАПИТАННЯ / ПРОМПТ КОРИСТУВАЧА ===\n${userQuestion}`;
  const fullUserPrompt = `${staticPagePrefix}\n${historyBlock}${dynamicQuestionSuffix}`;

  const modelsToTry = getProofreadModelCandidates();
  const perCallTimeoutMs = 45000;
  const modelErrors = [];

  const getThinkingLevel = (id) => (
    typeof getFastThinkingLevelForModel === 'function'
      ? getFastThinkingLevelForModel(id)
      : (String(id || '').includes('lite') || id === 'gemini-3.6-flash' ? 'minimal' : 'low')
  );

  const buildPageInteractionPayload = (modelId, inputPrompt, prevId = null) => JSON.stringify({
    model: modelId,
    store: true,
    ...(prevId ? { previous_interaction_id: prevId } : {}),
    system_instruction: sysInstruction,
    input: inputPrompt,
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: PAGE_ASSISTANT_JSON_SCHEMA
    },
    generation_config: {
      thinking_level: getThinkingLevel(modelId),
      thinking_summaries: 'none'
    }
  });

  const buildPageGeneratePayload = (modelId, includeThinking = true) => {
    const generationConfig = {
      responseMimeType: 'application/json'
    };
    if (includeThinking) {
      generationConfig.thinkingConfig = {
        thinkingLevel: getThinkingLevel(modelId).toUpperCase()
      };
    }
    return JSON.stringify({
      systemInstruction: { parts: [{ text: sysInstruction }] },
      contents: [{ role: 'user', parts: [{ text: fullUserPrompt }] }],
      generationConfig
    });
  };

  for (const modelId of modelsToTry) {
    if (signal && signal.aborted) break;

    try {
      const interactionsUrl = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(apiKey)}`;
      const interactionsHeaders = {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        'Api-Revision': '2026-05-20'
      };
      let response = null;

      // 1A. Stateful Multi-Turn Follow-up via Interactions API (`previous_interaction_id`):
      // Avoids resending the 28,000-character page text on 2nd, 3rd, Nth questions for the same page!
      if (pageContextCache.interactionId && pageContextCache.modelId === modelId) {
        response = await fetchWithAttemptTimeout(
          interactionsUrl,
          {
            method: 'POST',
            headers: interactionsHeaders,
            body: buildPageInteractionPayload(modelId, dynamicQuestionSuffix, pageContextCache.interactionId)
          },
          perCallTimeoutMs,
          signal
        );

        if (!response.ok) {
          // Session expired or unsupported -> clear interactionId and fall back to full Static-Prefix-First request
          pageContextCache.interactionId = null;
          response = null;
        }
      }

      // 1B. Initial Interaction (or when previous_interaction_id was not used): send Static-Prefix-First prompt
      if (!response) {
        response = await fetchWithAttemptTimeout(
          interactionsUrl,
          {
            method: 'POST',
            headers: interactionsHeaders,
            body: buildPageInteractionPayload(modelId, fullUserPrompt, null)
          },
          perCallTimeoutMs,
          signal
        );
      }

      // 2. Fallback to generateContent (automatically benefits from Static-Prefix-First Implicit Context Caching)
      if (!response.ok && (response.status === 404 || response.status === 400)) {
        const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        response = await fetchWithAttemptTimeout(
          generateUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: buildPageGeneratePayload(modelId, true)
          },
          perCallTimeoutMs,
          signal
        );

        // If this model rejects thinkingConfig with 400, retry once without thinkingConfig
        if (!response.ok && response.status === 400) {
          response = await fetchWithAttemptTimeout(
            generateUrl,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: buildPageGeneratePayload(modelId, false)
            },
            perCallTimeoutMs,
            signal
          );
        }
      }

      if (!response.ok) {
        let apiErrDetail = '';
        try {
          const errObj = await response.json();
          apiErrDetail = errObj?.error?.message || '';
        } catch (e) {}
        const msg = `HTTP ${response.status} (${modelId})${apiErrDetail ? ': ' + apiErrDetail : ''}`;
        modelErrors.push(msg);
        if (response.status === 404 || response.status === 503 || response.status === 429) continue;
        throw new Error(msg);
      }

      const data = await response.json();
      if (typeof data?.id === 'string' && data.id.trim()) {
        pageContextCache.interactionId = data.id.trim();
        pageContextCache.modelId = modelId;
      }

      const parsed = extractGeminiJsonObject(data);
      const finalAnswer = (parsed.answer || '').trim() || 'Модель не повернула текст відповіді.';
      const finalScope = hasPrioritySelection
        ? 'selection'
        : (parsed.answered_scope === 'selection' ? 'selection' : 'page');

      pageContextCache.questionCount = (pageContextCache.questionCount || 0) + 1;
      pageContextCache.history.push({
        question: userQuestion,
        answer: finalAnswer,
        scope: finalScope
      });
      if (pageContextCache.history.length > 6) {
        pageContextCache.history = pageContextCache.history.slice(-6);
      }

      return {
        answer: finalAnswer,
        answered_scope: finalScope
      };
    } catch (err) {
      const errText = err?.message || 'помилка';
      modelErrors.push(`${modelId}: ${errText}`);
      if (/HTTP (401|403)\b|Запит скасовано/i.test(errText)) break;
    }
  }

  throw new Error(modelErrors[0] || 'Не вдалося виконати запит до Gemini API');
}

async function runPageAssistantQuery(customPrompt = null) {
  const inputEl = document.getElementById('pageAssistantInput');
  const pa = currentProofreadState.pageAssistant;
  if (!inputEl || !pa) return;

  if (typeof customPrompt === 'string' && customPrompt.trim()) {
    inputEl.value = customPrompt.trim();
  }

  // First sync live page context & selection right before sending
  const pageContext = await extractActiveTabPageContext();
  const hasPrioritySelection = Boolean(pageContext.selectedText && !pa.ignoreSelection);

  let question = inputEl.value.trim();
  if (!question) {
    if (hasPrioritySelection) {
      question = 'Поясни детально зміст, головну думку та ключові деталі цього виділеного фрагмента.';
      inputEl.value = question;
    } else {
      notifyProofreadToast('Введіть запитання або оберіть швидкий промпт вище');
      inputEl.focus();
      return;
    }
  }

  pa.prompt = question;
  pa.answeredScope = hasPrioritySelection ? 'selection' : 'page';
  pa.isLoading = true;
  if (typeof renderPageAssistantView === 'function') {
    renderPageAssistantView();
  }

  try {
    const res = await callGeminiPageAssistantApi(question, pageContext);
    pa.answer = res.answer;
    pa.answeredScope = res.answered_scope || (hasPrioritySelection ? 'selection' : 'page');
  } catch (err) {
    const errMsg = err?.message || 'Помилка запиту до Gemini API';
    pa.answer = `❌ Помилка API: ${errMsg}`;
    notifyProofreadToast(`❌ ${errMsg}`);
  } finally {
    pa.isLoading = false;
    persistProofreadSession();
    if (typeof renderPageAssistantView === 'function') {
      renderPageAssistantView();
    }
  }
}
