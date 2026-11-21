function selectProofreadStyle(styleKey) {
  if (!PROOFREAD_STYLE_META[styleKey]) return;
  currentProofreadState.activeStyle = styleKey;
  persistProofreadSession();
  renderProofreadView();
}

function selectAnalysisTab(tabKey) {
  if (!['rules', 'grammar', 'page'].includes(tabKey)) return;
  currentProofreadState.activeAnalysisTab = tabKey;
  persistProofreadSession();
  renderProofreadView();
  if (tabKey === 'page') {
    syncActiveTabSelection();
  }
}

function renderGrammarExplanationView() {
  const containerEl = document.getElementById('grammarExplanationContainer');
  const badgeEl = document.getElementById('grammarExplanationTabBadge');
  if (!containerEl) return;

  const grammar = normalizeGrammarExplanationObject(currentProofreadState.grammarExplanation);
  const items = grammar.items || [];

  if (badgeEl) {
    badgeEl.textContent = String(items.length);
  }

  if (currentProofreadState.isLoading || currentProofreadState.isExplainingRules) {
    containerEl.innerHTML = `
      <div class="bg-slate-900/70 border border-slate-800 rounded-xl p-3 text-center text-[11px] text-sky-300 italic">
        ⏳ Аналізую синтаксичну будову, часові форми та граматичні конструкції речення...
      </div>
    `;
    return;
  }

  const hasOverview = Boolean(grammar.sentence_type || grammar.syntax_formula || grammar.tense_and_mood);
  if (!hasOverview && items.length === 0) {
    containerEl.innerHTML = `
      <div class="bg-slate-900/70 border border-slate-800 rounded-xl p-3 text-center text-[11px] text-slate-300">
        ⚡ Натисніть <b class="text-amber-300">«🧬 Поясни граматику»</b> (або «📚 Поясни правила») вище, щоб отримати повний синтаксичний та граматичний розбір речення.
      </div>
    `;
    return;
  }

  const overviewHtml = hasOverview
    ? `
      <div class="grammar-overview-card">
        ${grammar.sentence_type ? `
          <div class="grammar-overview-item">
            <span class="grammar-overview-label">📐 Структура та тип речення</span>
            <div class="grammar-overview-value">${safeEscapeHtml(grammar.sentence_type)}</div>
          </div>
        ` : ''}
        ${grammar.syntax_formula ? `
          <div class="grammar-overview-item">
            <span class="grammar-overview-label">🧩 Синтаксична формула (Structure)</span>
            <div class="grammar-formula-box">${safeEscapeHtml(grammar.syntax_formula)}</div>
          </div>
        ` : ''}
        ${grammar.tense_and_mood ? `
          <div class="grammar-overview-item">
            <span class="grammar-overview-label">⏱️ Час, вид, стан і спосіб (Tense / Aspect / Mood)</span>
            <div class="grammar-overview-value">${safeEscapeHtml(grammar.tense_and_mood)}</div>
          </div>
        ` : ''}
      </div>
    `
    : '';

  const itemsHtml = items.map((item, idx) => `
    <div class="grammar-item-card">
      <div class="sp-rule-top">
        <span class="sp-rule-title">${safeEscapeHtml(item.rule_title || 'Граматичне правило')}</span>
        <span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md border bg-sky-950/90 text-sky-300 border-sky-700/70" style="flex-shrink: 0;">
          #${idx + 1} • ${safeEscapeHtml(item.grammar_role || 'Конструкція')}
        </span>
      </div>
      ${item.fragment ? `<div class="grammar-fragment-chip">${safeEscapeHtml(item.fragment)}</div>` : ''}
      <p class="sp-rule-desc">${safeEscapeHtml(item.explanation || '')}</p>
    </div>
  `).join('');

  containerEl.innerHTML = overviewHtml + itemsHtml;
}

function formatMarkdownInline(rawLine) {
  const codePlaceholders = [];
  let text = safeEscapeHtml(rawLine).replace(/`([^`]+)`/g, (_, code) => {
    const idx = codePlaceholders.length;
    codePlaceholders.push(`<code class="sp-md-code">${code}</code>`);
    return `\u0000CODE${idx}\u0000`;
  });

  text = text
    .replace(/\*\*\*([^\s*](?:.*?[^\s*])?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^\s*](?:.*?[^\s*])?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^\s_](?:.*?[^\s_])?)__/g, '<strong>$1</strong>')
    .replace(/~~([^\s~](?:.*?[^\s~])?)~~/g, '<del>$1</del>')
    .replace(/(^|[\s(«"'])\*([^\s*](?:[^*]*?[^\s*])?)\*(?=$|[\s.,;:!?»"')—–-])/g, '$1<em>$2</em>');

  return text.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codePlaceholders[Number(i)] || '');
}

function renderMarkdownToHtml(rawMarkdown) {
  const src = String(rawMarkdown || '').replace(/\r\n?/g, '\n').trim();
  if (!src) return '';

  const lines = src.split('\n');
  const htmlBlocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Fenced code block ```...```
    if (trimmed.startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      htmlBlocks.push(`<pre class="sp-md-pre"><code>${safeEscapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    // Horizontal rule (---, ***, ___)
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      htmlBlocks.push('<hr class="sp-md-hr">');
      i++;
      continue;
    }

    // Headings (# .. ####)
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const tag = level === 1 ? 'h3' : level === 2 ? 'h4' : level === 3 ? 'h5' : 'h6';
      htmlBlocks.push(`<${tag} class="sp-md-h sp-md-h${level}">${formatMarkdownInline(headingMatch[2])}</${tag}>`);
      i++;
      continue;
    }

    // Blockquote (> ...)
    if (/^>\s?/.test(trimmed)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      const inner = quoteLines.map(l => formatMarkdownInline(l)).join('<br>');
      htmlBlocks.push(`<blockquote class="sp-md-quote">${inner}</blockquote>`);
      continue;
    }

    // Unordered list (•, -, *)
    if (/^(?:[•\-*]|\u2022)\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^(?:[•\-*]|\u2022)\s+/.test(lines[i].trim())) {
        const content = lines[i].trim().replace(/^(?:[•\-*]|\u2022)\s+/, '');
        items.push(`<li>${formatMarkdownInline(content)}</li>`);
        i++;
      }
      htmlBlocks.push(`<ul class="sp-md-ul">${items.join('')}</ul>`);
      continue;
    }

    // Ordered list (1. ...)
    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        const content = lines[i].trim().replace(/^\d+\.\s+/, '');
        items.push(`<li>${formatMarkdownInline(content)}</li>`);
        i++;
      }
      htmlBlocks.push(`<ol class="sp-md-ol">${items.join('')}</ol>`);
      continue;
    }

    // Paragraph (group consecutive plain lines until blank line or next block)
    const paraLines = [];
    while (i < lines.length) {
      const cur = lines[i].trim();
      if (
        !cur ||
        cur.startsWith('```') ||
        /^(?:-{3,}|\*{3,}|_{3,})$/.test(cur) ||
        /^#{1,4}\s+/.test(cur) ||
        /^>\s?/.test(cur) ||
        /^(?:[•\-*]|\u2022)\s+/.test(cur) ||
        /^\d+\.\s+/.test(cur)
      ) {
        break;
      }
      paraLines.push(formatMarkdownInline(cur));
      i++;
    }
    if (paraLines.length > 0) {
      htmlBlocks.push(`<p class="sp-md-p">${paraLines.join('<br>')}</p>`);
    }
  }

  return htmlBlocks.join('');
}

function renderPageAssistantView() {
  const pa = currentProofreadState.pageAssistant || {};
  const metaEl = document.getElementById('pageAssistantContextMeta');
  const selCardEl = document.getElementById('pageAssistantSelectionCard');
  const selPreviewEl = document.getElementById('pageAssistantSelectionPreview');
  const selDotEl = document.getElementById('pageSelectionActiveDot');
  const askBtnEl = document.getElementById('btnAskPageAssistant');
  const resultWrapEl = document.getElementById('pageAssistantResultWrap');
  const answerBoxEl = document.getElementById('pageAssistantAnswerBox');
  const scopeBadgeEl = document.getElementById('pageAssistantScopeBadge');
  const cacheBadgeEl = document.getElementById('pageAssistantCacheBadge');

  const hasActiveSelection = Boolean(pa.selectedText && !pa.ignoreSelection);
  const hasCachedContext = typeof pageContextCache !== 'undefined' && Boolean(pageContextCache.contextData);

  if (cacheBadgeEl) {
    if (hasCachedContext) {
      const qCount = pageContextCache.questionCount || 0;
      const modeTag = pageContextCache.interactionId ? '⚡ Сесія' : '⚡ Кеш';
      cacheBadgeEl.textContent = qCount > 0 ? `${modeTag} (${qCount} пит.)` : '⚡ У кеші';
      cacheBadgeEl.className = 'sp-cache-badge sp-cache-badge-active';
    } else {
      cacheBadgeEl.textContent = '🆕 Без кешу';
      cacheBadgeEl.className = 'sp-cache-badge';
    }
  }

  if (selDotEl) {
    selDotEl.classList.toggle('hidden', !hasActiveSelection);
  }

  if (metaEl) {
    if (pa.pageTitle || pa.pageUrl) {
      let hostLabel = '';
      try {
        hostLabel = pa.pageUrl ? new URL(pa.pageUrl).hostname : '';
      } catch (e) {}
      const titleShort = pa.pageTitle ? pa.pageTitle.slice(0, 68) : hostLabel || 'Поточна сторінка';
      const charsInfo = pa.charCount > 0 ? ` • ${(pa.charCount / 1000).toFixed(1)}k симв.` : '';
      metaEl.innerHTML = `📄 <b class="text-slate-100">${safeEscapeHtml(titleShort)}</b>${hostLabel ? ` <span class="text-slate-400">(${safeEscapeHtml(hostLabel)}${charsInfo})</span>` : ''}`;
    } else {
      metaEl.textContent = '📄 Контекст активної вкладки зчитується автоматично під час запиту';
    }
  }

  if (selCardEl && selPreviewEl) {
    if (hasActiveSelection) {
      selCardEl.classList.remove('hidden');
      selPreviewEl.textContent = `«${pa.selectedText}»`;
    } else {
      selCardEl.classList.add('hidden');
      selPreviewEl.textContent = '';
    }
  }

  if (askBtnEl) {
    if (pa.isLoading) {
      askBtnEl.disabled = true;
      askBtnEl.textContent = hasActiveSelection
        ? '⏳ Аналізую виділений фрагмент на сторінці...'
        : '⏳ Аналізую сторінку та готую відповідь...';
    } else {
      askBtnEl.disabled = false;
      askBtnEl.textContent = hasActiveSelection
        ? '🎯 Запитати про виділений фрагмент'
        : '🤖 Запитати по сторінці';
    }
  }

  if (resultWrapEl && answerBoxEl) {
    if (pa.isLoading) {
      resultWrapEl.classList.remove('hidden');
      answerBoxEl.innerHTML = `<span class="text-slate-400 italic text-xs">ШІ читає ${hasActiveSelection ? 'виділений фрагмент та контекст сторінки' : 'вміст активної сторінки'} і формує відповідь...</span>`;
    } else if (pa.answer) {
      resultWrapEl.classList.remove('hidden');
      answerBoxEl.innerHTML = renderMarkdownToHtml(pa.answer);
      if (scopeBadgeEl) {
        if (pa.answeredScope === 'selection') {
          scopeBadgeEl.textContent = '🎯 Виділений фрагмент';
          scopeBadgeEl.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-950/90 text-amber-300 border border-amber-700/70';
        } else {
          scopeBadgeEl.textContent = '🌐 Уся сторінка';
          scopeBadgeEl.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-700/70';
        }
      }
    } else {
      resultWrapEl.classList.add('hidden');
      answerBoxEl.textContent = '';
    }
  }
}

function renderProofreadView() {
  const resultBoxEl = document.getElementById('proofreadResultBox');
  const rulesContainerEl = document.getElementById('proofreadRulesContainer');
  const rulesTabBadgeEl = document.getElementById('appliedRulesTabBadge');
  const rulesPanelEl = document.getElementById('proofreadRulesPanel');
  const grammarPanelEl = document.getElementById('grammarExplanationPanel');
  const pagePanelEl = document.getElementById('pageAssistantPanel');
  const badgeCountEl = document.getElementById('proofreadChangesCountBadge');
  const timingBadgeEl = document.getElementById('proofreadTimingBadge');
  const summaryEl = document.getElementById('proofreadSummaryText');
  const styleNoteEl = document.getElementById('proofreadStyleNote');
  const styleBarEl = document.getElementById('styleVariantBar');
  const modeSubtitleEl = document.getElementById('spModeSubtitle');
  const btnModeWavy = document.getElementById('btnDiffModeWavy');
  const btnModeInline = document.getElementById('btnDiffModeInline');
  const btnToggleCam = document.getElementById('btnToggleCamC1C2');
  const btnToggleQuick = document.getElementById('btnToggleQuickMode');
  const btnExplainRules = document.getElementById('btnExplainRules');
  const btnExplainGrammar = document.getElementById('btnExplainGrammar');
  const runBtn = document.getElementById('btnRunProofread');

  if (!resultBoxEl || !rulesContainerEl) return;

  const isQuick = currentProofreadState.quickMode !== false;

  if (btnExplainRules) {
    btnExplainRules.disabled = Boolean(currentProofreadState.isLoading || currentProofreadState.isExplainingRules);
    btnExplainRules.textContent = currentProofreadState.isExplainingRules
      ? '⏳ Пояснюю...'
      : '📚 Поясни правила';
  }
  if (btnExplainGrammar) {
    btnExplainGrammar.disabled = Boolean(currentProofreadState.isLoading || currentProofreadState.isExplainingRules);
    btnExplainGrammar.textContent = currentProofreadState.isExplainingRules
      ? '⏳ Пояснюю...'
      : '🧬 Поясни граматику';
  }

  // Варіант 2: "🔍 Стандарт" is the fast default mode; "🎨 +3 Стилі" toggles generation of Short / Formal / Corp
  if (btnToggleQuick) {
    const stylesEnabled = !isQuick;
    btnToggleQuick.classList.toggle('ext-btn-styles-active', stylesEnabled);
    btnToggleQuick.classList.toggle('ext-btn-quick-active', !stylesEnabled);
    btnToggleQuick.setAttribute('aria-pressed', String(stylesEnabled));
    btnToggleQuick.textContent = stylesEnabled ? '🎨 +3 Стилі: ON' : '🎨 +3 Стилі: OFF';
  }
  if (styleBarEl) {
    styleBarEl.classList.toggle('hidden', isQuick);
  }
  if (styleNoteEl) {
    styleNoteEl.classList.toggle('hidden', isQuick || Boolean(currentProofreadState.error));
  }
  if (modeSubtitleEl) {
    modeSubtitleEl.textContent = isQuick
      ? '🔍 Стандарт (Fast) • Граматика • Page AI'
      : '🎨 Стандарт + 3 стилі • Граматика • Page AI';
  }

  // Sync 3-Tab Analysis Switcher (Застосовані правила | Grammar explanation | Page AI)
  const activeTab = currentProofreadState.activeAnalysisTab || 'rules';
  document.querySelectorAll('.sp-analysis-tab').forEach(btn => {
    const tabKey = btn.getAttribute('data-analysis-tab');
    const isSelected = tabKey === activeTab;
    btn.classList.toggle('sp-analysis-tab-active', isSelected);
    btn.setAttribute('aria-selected', String(isSelected));
  });
  if (rulesPanelEl) rulesPanelEl.classList.toggle('hidden', activeTab !== 'rules');
  if (grammarPanelEl) grammarPanelEl.classList.toggle('hidden', activeTab !== 'grammar');
  if (pagePanelEl) pagePanelEl.classList.toggle('hidden', activeTab !== 'page');

  // Always keep Tab 2 and Tab 3 views synced
  renderGrammarExplanationView();
  renderPageAssistantView();

  // Sync Cambridge C1/C2 strict mode toggle button
  if (btnToggleCam) {
    const isStrict = currentProofreadState.strictC1C2 !== false;
    btnToggleCam.classList.toggle('ext-btn-cam-active', isStrict);
    btnToggleCam.setAttribute('aria-pressed', String(isStrict));
    btnToggleCam.textContent = isStrict ? '🎓 C1/C2: ON' : '🎓 C1/C2: OFF';
  }

  // Sync style variant buttons (Default / Short / Formal / Corp)
  document.querySelectorAll('.style-variant-btn').forEach(btn => {
    const key = btn.getAttribute('data-style-variant');
    const isActive = key === currentProofreadState.activeStyle;
    btn.classList.toggle('style-variant-btn-active', isActive);
  });

  // Sync diff display mode buttons
  if (btnModeWavy && btnModeInline) {
    if (currentProofreadState.displayMode === 'wavy') {
      btnModeWavy.className = 'px-2 py-0.5 rounded-md bg-sky-500/20 border border-sky-400/60 text-sky-300 font-bold text-[10px] transition';
      btnModeInline.className = 'px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-slate-400 font-medium text-[10px] transition';
    } else {
      btnModeInline.className = 'px-2 py-0.5 rounded-md bg-sky-500/20 border border-sky-400/60 text-sky-300 font-bold text-[10px] transition';
      btnModeWavy.className = 'px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-slate-400 font-medium text-[10px] transition';
    }
  }

  if (currentProofreadState.isLoading) {
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.textContent = isQuick
        ? '⏳ Швидка перевірка (🔍 Стандарт)...'
        : '⏳ Генерую Стандарт + 3 стилі...';
    }
    if (badgeCountEl) {
      badgeCountEl.textContent = '⏳ Перевірка...';
      badgeCountEl.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700';
    }
    if (timingBadgeEl) {
      timingBadgeEl.classList.add('hidden');
      timingBadgeEl.textContent = '';
    }
    resultBoxEl.innerHTML = `<span class="text-slate-400 italic text-xs">${
      isQuick
        ? 'ШІ миттєво перевіряє текст у режимі «🔍 Стандарт»...'
        : 'ШІ перевіряє текст та готує «🔍 Стандарт» + 3 додаткові стилі (Short / Formal / Corp)...'
    }</span>`;
    return;
  }

  if (runBtn) {
    runBtn.disabled = false;
    runBtn.textContent = '🔍 Перевірити та виправити';
  }

  // Handle API Error State explicitly: never show "Без змін ✓" or fill Результат with unverified text
  if (currentProofreadState.error) {
    if (badgeCountEl) {
      badgeCountEl.textContent = '⚠️ Помилка запиту';
      badgeCountEl.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-950/90 text-rose-300 border border-rose-700/70';
    }
    if (timingBadgeEl) {
      timingBadgeEl.classList.add('hidden');
      timingBadgeEl.textContent = '';
    }
    resultBoxEl.innerHTML = `<span class="text-rose-300 text-xs">❌ Результат не отримано: ${safeEscapeHtml(currentProofreadState.error)}</span>`;
    if (summaryEl) {
      summaryEl.classList.add('hidden');
    }
    rulesContainerEl.innerHTML = `
      <div class="bg-rose-950/90 border border-rose-700/70 rounded-xl p-3 text-center text-[11px] text-rose-300">
        ⚠️ Запит до Gemini API завершився помилкою. Натисніть «Перевірити та виправити» (або Ctrl+Enter), щоб повторити спробу.
      </div>
    `;
    return;
  }

  const orig = currentProofreadState.originalText || '';
  const activeStyleKey = isQuick ? 'default' : currentProofreadState.activeStyle;
  const activeVar = currentProofreadState.variants?.[activeStyleKey]
    || currentProofreadState.variants?.default
    || { text: orig, note: '' };
  const corr = activeVar.text || orig;

  const { html, changeCount } = buildDiffHtml(orig, corr, currentProofreadState.displayMode);
  resultBoxEl.innerHTML = html || '<span class="text-slate-500 italic">Немає тексту для відображення</span>';

  const styleMeta = PROOFREAD_STYLE_META[activeStyleKey] || PROOFREAD_STYLE_META.default;
  if (styleNoteEl && !isQuick) {
    styleNoteEl.innerHTML = `<b class="text-sky-300">${safeEscapeHtml(styleMeta.badge)}:</b> ${safeEscapeHtml(activeVar.note || styleMeta.defaultNote)}`;
  }

  if (badgeCountEl) {
    const countToShow = activeStyleKey === 'default'
      ? (currentProofreadState.appliedRules.length || changeCount)
      : changeCount;
    badgeCountEl.textContent = countToShow > 0
      ? (isQuick ? `${countToShow} виправлень` : `${countToShow} змін (${styleMeta.label})`)
      : 'Без змін ✓';
    badgeCountEl.className = countToShow > 0
      ? 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-950 text-sky-300 border border-sky-700/70'
      : 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-700/70';
  }

  if (timingBadgeEl) {
    if (currentProofreadState.lastElapsedSec && currentProofreadState.lastModelUsed) {
      timingBadgeEl.textContent = `⚡ ${currentProofreadState.lastElapsedSec} с • ${currentProofreadState.lastModelUsed}`;
      timingBadgeEl.classList.remove('hidden');
    } else {
      timingBadgeEl.textContent = '';
      timingBadgeEl.classList.add('hidden');
    }
  }

  if (summaryEl) {
    if (currentProofreadState.summary) {
      summaryEl.textContent = currentProofreadState.summary + (currentProofreadState.usedOfflineFallback && !getProofreadApiKey() ? ' (Демо-режим — додайте API-ключ для довільних текстів)' : '');
      summaryEl.classList.remove('hidden');
    } else {
      summaryEl.classList.add('hidden');
    }
  }

  const rules = currentProofreadState.appliedRules || [];
  if (rulesTabBadgeEl) {
    rulesTabBadgeEl.textContent = String(rules.length);
  }

  if (currentProofreadState.isExplainingRules) {
    rulesContainerEl.innerHTML = `
      <div class="bg-slate-900/70 border border-slate-800 rounded-xl p-3 text-center text-[11px] text-amber-300 italic">
        ⏳ Формую детальні пояснення граматичних правил та синтаксичний розбір речення...
      </div>
    `;
    return;
  }

  if (rules.length === 0) {
    if (changeCount > 0) {
      rulesContainerEl.innerHTML = `
        <div class="bg-slate-900/70 border border-slate-800 rounded-xl p-3 text-center text-[11px] text-slate-300">
          ⚡ Виправлення в режимі «🔍 Стандарт» виконано миттєво. Натисніть <b class="text-amber-300">«📚 Поясни правила»</b> вище, щоб розібрати кожну правку та граматику.
        </div>
      `;
    } else {
      rulesContainerEl.innerHTML = `
        <div class="bg-slate-900/70 border border-slate-800 rounded-xl p-3 text-center text-[11px] text-emerald-300">
          ✨ Текст написаний грамотно! Жодних виправлень не знадобилося. Натисніть <b>«📚 Поясни правила»</b> або перейдіть у <b>🧬 Grammar explanation</b> для розбору будови речення.
        </div>
      `;
    }
    return;
  }

  rulesContainerEl.innerHTML = rules.map((r, idx) => {
    const cat = RULE_CATEGORY_META[r.category] || RULE_CATEGORY_META.grammar;
    const origFrag = r.original_fragment || '—';
    const fixedFrag = r.fixed_fragment || '(видалено)';
    return `
      <div class="proofread-rule-card"
           data-rule-orig="${safeEscapeHtml(String(r.original_fragment || '').toLowerCase())}"
           data-rule-fixed="${safeEscapeHtml(String(r.fixed_fragment || '').toLowerCase())}">
        <div class="sp-rule-top">
          <span class="sp-rule-title">${safeEscapeHtml(r.rule_title || 'Мовне правило')}</span>
          <span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md border ${cat.cls}" style="flex-shrink: 0;">
            #${idx + 1} • ${cat.label}
          </span>
        </div>
        <div class="sp-rule-diff-chip">
          <span class="text-rose-400 line-through mr-1.5">${safeEscapeHtml(origFrag)}</span>
          <span class="text-slate-500 mr-1.5">→</span>
          <span class="text-sky-300 font-semibold underline">${safeEscapeHtml(fixedFrag)}</span>
        </div>
        <p class="sp-rule-desc">${safeEscapeHtml(r.explanation || '')}</p>
      </div>
    `;
  }).join('');

  rulesContainerEl.querySelectorAll('.proofread-rule-card').forEach(card => {
    const highlightMatchingSpans = (active) => {
      const origKey = (card.getAttribute('data-rule-orig') || '').trim();
      const fixedKey = (card.getAttribute('data-rule-fixed') || '').trim();
      resultBoxEl.querySelectorAll('.proofread-diff-span').forEach(span => {
        const spanDel = (span.getAttribute('data-diff-del') || '').trim();
        const spanIns = (span.getAttribute('data-diff-ins') || '').trim();
        const matches =
          (fixedKey && spanIns && (fixedKey.includes(spanIns) || spanIns.includes(fixedKey))) ||
          (origKey && spanDel && (origKey.includes(spanDel) || spanDel.includes(origKey)));
        if (matches) {
          span.classList.toggle('diff-span-active', active);
        }
      });
    };
    card.addEventListener('mouseenter', () => highlightMatchingSpans(true));
    card.addEventListener('mouseleave', () => highlightMatchingSpans(false));
  });
}

async function runProofreadTool(customText = null) {
  const inputEl = document.getElementById('proofreadOriginalInput');
  if (!inputEl) return;

  if (typeof customText === 'string') {
    inputEl.value = customText;
  }

  const textToFix = inputEl.value.trim();
  if (!textToFix) {
    notifyProofreadToast('Введіть або вставте текст у поле «Оригінал»');
    inputEl.focus();
    return;
  }

  currentProofreadState.originalText = textToFix;
  currentProofreadState.error = null;
  currentProofreadState.lastElapsedSec = '';
  currentProofreadState.lastModelUsed = '';
  currentProofreadState.isLoading = true;
  renderProofreadView();

  try {
    const res = await callGeminiProofreadApi(textToFix);
    currentProofreadState.error = null;
    currentProofreadState.detectedLanguage = res.detected_language || 'uk';
    currentProofreadState.summary = res.summary || '';
    currentProofreadState.variants = res.variants;
    currentProofreadState.appliedRules = res.applied_rules || [];
    currentProofreadState.grammarExplanation = normalizeGrammarExplanationObject(res.grammar_explanation);
    currentProofreadState.lastElapsedSec = res.elapsedSec || '';
    currentProofreadState.lastModelUsed = res.modelId || '';
    currentProofreadState.usedOfflineFallback = Boolean(res.usedOfflineFallback);

    if (res.isUnconfiguredCustomText) {
      const detailsEl = document.getElementById('extApiKeyDetails');
      const keyInputEl = document.getElementById('extApiKeyInput');
      if (detailsEl) detailsEl.open = true;
      if (keyInputEl) keyInputEl.focus();
      notifyProofreadToast('🔑 Введіть ваш Gemini API-ключ зверху та натисніть «Зберегти»');
    }
  } catch (err) {
    const errMsg = err?.message || 'Помилка запиту до Gemini API';
    currentProofreadState.error = errMsg;
    currentProofreadState.summary = '';
    currentProofreadState.variants = {
      default: { text: '', note: '' },
      short: { text: '', note: '' },
      formal: { text: '', note: '' },
      corp: { text: '', note: '' }
    };
    currentProofreadState.appliedRules = [];
    currentProofreadState.grammarExplanation = normalizeGrammarExplanationObject(null);
    currentProofreadState.lastElapsedSec = '';
    currentProofreadState.lastModelUsed = '';
    currentProofreadState.usedOfflineFallback = false;
    notifyProofreadToast(`❌ ${errMsg}`);
  } finally {
    currentProofreadState.isLoading = false;
    persistProofreadSession();
    renderProofreadView();
  }
}

async function explainProofreadRulesOnly() {
  const orig = (currentProofreadState.originalText || '').trim();
  const activeVar = getActiveVariantObject();
  const corr = (activeVar.text || orig).trim();

  if (!orig) {
    notifyProofreadToast('Спочатку перевірте текст кнопкою «Перевірити та виправити»');
    return;
  }

  currentProofreadState.isExplainingRules = true;
  renderProofreadView();

  try {
    const res = await callGeminiExplainRulesApi(orig, corr);
    currentProofreadState.summary = res.summary || '';
    currentProofreadState.appliedRules = res.applied_rules || [];
    currentProofreadState.grammarExplanation = normalizeGrammarExplanationObject(res.grammar_explanation);
    persistProofreadSession();
  } catch (err) {
    notifyProofreadToast(`❌ ${err?.message || 'Помилка генерації правил'}`);
  } finally {
    currentProofreadState.isExplainingRules = false;
    renderProofreadView();
  }
}

function applyInitialProofreadData(presetText) {
  const inputEl = document.getElementById('proofreadOriginalInput');
  if (!inputEl) return;
  inputEl.value = presetText;
  const initialResult = simulateProofreadPipeline(presetText);
  currentProofreadState.originalText = presetText;
  currentProofreadState.error = null;
  currentProofreadState.lastElapsedSec = '';
  currentProofreadState.lastModelUsed = '';
  currentProofreadState.detectedLanguage = initialResult.detected_language;
  currentProofreadState.summary = initialResult.summary;
  currentProofreadState.variants = normalizeVariantsObject(initialResult, presetText);
  currentProofreadState.appliedRules = initialResult.applied_rules;
  currentProofreadState.grammarExplanation = normalizeGrammarExplanationObject(initialResult.grammar_explanation);
  renderProofreadView();
}

function initParentToolsUi() {
  const inputEl = document.getElementById('proofreadOriginalInput');
  if (!inputEl || inputEl.dataset.proofreadInitialized === 'true') return;
  inputEl.dataset.proofreadInitialized = 'true';

  // Restore last saved session from localStorage (or initialize default preset on very first launch)
  let restoredSync = false;
  try {
    const rawSaved = localStorage.getItem('chomuchka_proofread_session_v1');
    if (rawSaved) {
      restoredSync = restoreProofreadSessionSnapshot(JSON.parse(rawSaved));
    }
  } catch (e) {}

  if (!restoredSync) {
    applyInitialProofreadData(PROOFREAD_PRESETS.uk_parent_note.text);
  }

  document.getElementById('btnRunProofread')?.addEventListener('click', () => {
    runProofreadTool();
  });

  document.getElementById('btnExplainRules')?.addEventListener('click', () => {
    explainProofreadRulesOnly();
  });

  document.getElementById('btnExplainGrammar')?.addEventListener('click', () => {
    explainProofreadRulesOnly();
  });

  document.getElementById('btnClearOriginal')?.addEventListener('click', () => {
    inputEl.value = '';
    persistProofreadSession();
    inputEl.focus();
  });

  inputEl.addEventListener('input', () => {
    persistProofreadSession();
  });

  const quickToggleBtn = document.getElementById('btnToggleQuickMode');
  if (quickToggleBtn) {
    try {
      const savedQuick = localStorage.getItem('chomuchka_ext_quick_mode');
      if (savedQuick !== null) {
        currentProofreadState.quickMode = savedQuick === 'true';
      }
    } catch (e) {}
    renderProofreadView();

    quickToggleBtn.addEventListener('click', () => {
      currentProofreadState.quickMode = !currentProofreadState.quickMode;
      const isQuick = currentProofreadState.quickMode;
      if (isQuick) {
        currentProofreadState.activeStyle = 'default';
      }
      try {
        localStorage.setItem('chomuchka_ext_quick_mode', String(isQuick));
      } catch (e) {}
      persistProofreadSession();
      renderProofreadView();
      notifyProofreadToast(
        isQuick
          ? '🔍 Режим «Тільки Стандарт» (миттєва перевірка без додаткових стилів)'
          : '🎨 Увімкнено «+3 Стилі» (разом зі Стандарт генеруються Short / Formal / Corp)'
      );
    });
  }

  // 3-Tab Switcher Listeners (Застосовані правила | Grammar explanation | Page AI)
  document.querySelectorAll('.sp-analysis-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabKey = btn.getAttribute('data-analysis-tab') || 'rules';
      selectAnalysisTab(tabKey);
    });
  });

  // Page Assistant Listeners
  const pageInputEl = document.getElementById('pageAssistantInput');
  if (pageInputEl) {
    pageInputEl.addEventListener('input', () => {
      currentProofreadState.pageAssistant.prompt = pageInputEl.value;
      persistProofreadSession();
    });
    pageInputEl.addEventListener('focus', () => {
      syncActiveTabSelection();
    });
    pageInputEl.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runPageAssistantQuery();
      }
    });
  }

  document.getElementById('btnClearPagePrompt')?.addEventListener('click', () => {
    if (pageInputEl) {
      pageInputEl.value = '';
      currentProofreadState.pageAssistant.prompt = '';
      persistProofreadSession();
      pageInputEl.focus();
    }
  });

  document.getElementById('btnAskPageAssistant')?.addEventListener('click', () => {
    runPageAssistantQuery();
  });

  document.getElementById('btnRefreshPageContext')?.addEventListener('click', async () => {
    if (typeof resetPageAssistantCache === 'function') resetPageAssistantCache('manual');
    await extractActiveTabPageContext(true);
    const pa = currentProofreadState.pageAssistant;
    if (pa.selectedText && !pa.ignoreSelection) {
      notifyProofreadToast(`🔄 Кеш скинуто! Зчитано сторінку та виділений фрагмент (${pa.selectedText.length} симв.)`);
    } else {
      notifyProofreadToast('🔄 Кеш сторінки скинуто та оновлено з активної вкладки!');
    }
  });

  document.getElementById('btnClearPageSelectionFocus')?.addEventListener('click', () => {
    currentProofreadState.pageAssistant.ignoreSelection = true;
    persistProofreadSession();
    renderPageAssistantView();
    notifyProofreadToast('🌐 Перемкнено на аналіз усієї сторінки');
  });

  document.querySelectorAll('.page-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const presetPrompt = btn.getAttribute('data-page-preset') || '';
      if (!presetPrompt) return;
      runPageAssistantQuery(presetPrompt);
    });
  });

  document.getElementById('btnCopyPageAnswer')?.addEventListener('click', async () => {
    const answerText = (currentProofreadState.pageAssistant?.answer || '').trim();
    if (!answerText) return;
    try {
      await navigator.clipboard.writeText(answerText);
      notifyProofreadToast('📋 Відповідь Page AI скопійовано у буфер обміну!');
    } catch (e) {
      notifyProofreadToast('Не вдалося скопіювати автоматично — виділіть текст мишкою');
    }
  });
  const camToggleBtn = document.getElementById('btnToggleCamC1C2');
  if (camToggleBtn) {
    try {
      const savedStrict = localStorage.getItem('chomuchka_ext_strict_c1c2');
      if (savedStrict !== null) {
        currentProofreadState.strictC1C2 = savedStrict === 'true';
      }
    } catch (e) {}
    renderProofreadView();

    camToggleBtn.addEventListener('click', () => {
      currentProofreadState.strictC1C2 = !currentProofreadState.strictC1C2;
      const isStrict = currentProofreadState.strictC1C2;
      try {
        localStorage.setItem('chomuchka_ext_strict_c1c2', String(isStrict));
      } catch (e) {}
      if (isChromeExtensionEnv() && chrome.storage?.local) {
        chrome.storage.local.set({ chomuchka_ext_strict_c1c2: isStrict });
      }
      renderProofreadView();
      notifyProofreadToast(
        isStrict
          ? '🎓 Режим Cambridge C1/C2 увімкнено (натисніть Перевірити або Ctrl+Enter)'
          : '✨ Стандартний режим увімкнено (натисніть Перевірити або Ctrl+Enter)'
      );
    });
  }

  const extModelSelect = document.getElementById('extModelSelect');
  if (extModelSelect) {
    try {
      const savedModel = localStorage.getItem('chomuchka_ext_model');
      if (savedModel && !isDeprecatedGeminiModel(savedModel)) {
        extModelSelect.value = savedModel;
      } else {
        extModelSelect.value = 'gemini-3.5-flash-lite';
        localStorage.setItem('chomuchka_ext_model', 'gemini-3.5-flash-lite');
      }
    } catch (e) {}
    extModelSelect.addEventListener('change', () => {
      const m = isDeprecatedGeminiModel(extModelSelect.value) ? 'gemini-3.5-flash-lite' : extModelSelect.value;
      extModelSelect.value = m;
      try {
        localStorage.setItem('chomuchka_ext_model', m);
      } catch (e) {}
      if (isChromeExtensionEnv() && chrome.storage?.local) {
        chrome.storage.local.set({ chomuchka_ext_model: m });
      }
      notifyProofreadToast(`🤖 Обрано модель ${m}`);
    });
  }

  inputEl.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runProofreadTool();
    }
  });

  document.querySelectorAll('.style-variant-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const styleKey = btn.getAttribute('data-style-variant') || 'default';
      selectProofreadStyle(styleKey);
    });
  });

  document.getElementById('btnDiffModeWavy')?.addEventListener('click', () => {
    currentProofreadState.displayMode = 'wavy';
    persistProofreadSession();
    renderProofreadView();
  });

  document.getElementById('btnDiffModeInline')?.addEventListener('click', () => {
    currentProofreadState.displayMode = 'inline';
    persistProofreadSession();
    renderProofreadView();
  });

  document.getElementById('btnCopyProofread')?.addEventListener('click', async () => {
    if (currentProofreadState.error) {
      notifyProofreadToast('⚠️ Немає перевіреного результату через помилку запиту');
      return;
    }
    const activeVar = getActiveVariantObject();
    const textToCopy = activeVar.text || '';
    if (!textToCopy) return;
    const isQuick = currentProofreadState.quickMode !== false;
    const styleLabel = isQuick
      ? 'Виправлений текст'
      : (PROOFREAD_STYLE_META[currentProofreadState.activeStyle]?.label || '');
    try {
      await navigator.clipboard.writeText(textToCopy);
      notifyProofreadToast(`📋 Скопійовано «${styleLabel}» у буфер обміну!`);
    } catch (e) {
      notifyProofreadToast('Не вдалося скопіювати автоматично — виділіть текст у блоці «Результат»');
    }
  });

  document.querySelectorAll('.proofread-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-preset');
      const preset = PROOFREAD_PRESETS[key];
      if (!preset) return;
      if (key === 'uk_parent_note') currentProofreadState.displayMode = 'wavy';
      if (key === 'en_team_note') currentProofreadState.displayMode = 'inline';
      inputEl.value = preset.text;
      persistProofreadSession();
      inputEl.focus();
      notifyProofreadToast('Приклад вставлено — натисніть «Перевірити та виправити» або Ctrl+Enter');
    });
  });

  // Standalone Chrome Side Panel extras (API key bar, active tab selection grabber, context menu sync)
  initChromeSidePanelExtras();
}

function updateExtKeyStatusBadge(hasKey) {
  const badgeEl = document.getElementById('extKeyStatusBadge');
  const detailsEl = document.getElementById('extApiKeyDetails');
  if (badgeEl) {
    badgeEl.textContent = hasKey ? '🟢 Ключ підключено ▾' : '🔴 Ключ не введено ▾';
    badgeEl.className = hasKey
      ? 'text-[10px] text-emerald-300 font-semibold'
      : 'text-[10px] text-amber-300 font-semibold';
  }
  if (detailsEl && hasKey) {
    detailsEl.open = false;
  }
}

function initChromeSidePanelExtras() {
  const extKeyInput = document.getElementById('extApiKeyInput');
  const extSaveKeyBtn = document.getElementById('btnExtSaveKey');
  const extModelSelect = document.getElementById('extModelSelect');
  const extGrabBtn = document.getElementById('btnGrabPageSelection');
  const inputEl = document.getElementById('proofreadOriginalInput');

  if (extModelSelect) {
    try {
      const savedModel = localStorage.getItem('chomuchka_ext_model');
      if (savedModel && Array.from(extModelSelect.options).some(opt => opt.value === savedModel)) {
        extModelSelect.value = savedModel;
      }
    } catch (e) {}
    extModelSelect.addEventListener('change', () => {
      try {
        localStorage.setItem('chomuchka_ext_model', extModelSelect.value);
      } catch (e) {}
    });
  }

  // Auto-sync live selection from the active tab when hovering/focusing Side Panel or periodically
  window.addEventListener('focus', () => syncActiveTabSelection());
  document.body?.addEventListener('mouseenter', () => syncActiveTabSelection());
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      syncActiveTabSelection();
    }
  }, 1200);

  if (isChromeExtensionEnv() && chrome.tabs) {
    chrome.tabs.onActivated?.addListener((activeInfo) => {
      if (typeof pageContextCache !== 'undefined' && pageContextCache.tabId !== null && activeInfo?.tabId !== pageContextCache.tabId) {
        resetPageAssistantCache('tab_switched');
      }
      syncActiveTabSelection();
    });
    chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
      if (typeof pageContextCache !== 'undefined' && changeInfo.url && pageContextCache.tabId === tabId && normalizePageCacheUrl(changeInfo.url) !== pageContextCache.url) {
        resetPageAssistantCache('url_changed');
      }
      if (changeInfo.status === 'complete') {
        if (typeof pageContextCache !== 'undefined' && pageContextCache.tabId === tabId) {
          resetPageAssistantCache('page_reloaded');
        }
        syncActiveTabSelection();
      }
    });
  }

  // Initial sync on open
  syncActiveTabSelection();

  if (extKeyInput) {
    try {
      const savedKey = localStorage.getItem('chomuchka_ext_api_key') || '';
      if (savedKey) {
        extKeyInput.value = savedKey;
        updateExtKeyStatusBadge(true);
      }
    } catch (e) {}

    if (isChromeExtensionEnv() && chrome.storage?.local) {
      (async () => {
        try {
          const res = await chrome.storage.local.get([
            'chomuchka_ext_api_key',
            'chomuchka_proofread_session_v1',
            'pendingProofreadText',
            'pendingPageAiSelection'
          ]);
          if (res.chomuchka_proofread_session_v1 && !localStorage.getItem('chomuchka_proofread_session_v1')) {
            restoreProofreadSessionSnapshot(res.chomuchka_proofread_session_v1);
          }
          if (res.chomuchka_ext_api_key) {
            extKeyInput.value = res.chomuchka_ext_api_key;
            updateExtKeyStatusBadge(true);
            try {
              localStorage.setItem('chomuchka_ext_api_key', res.chomuchka_ext_api_key);
            } catch (e) {}
          } else if (chrome.tabs && chrome.scripting) {
            // Try auto-importing API key from active tab if the user already entered it in the Web App
            try {
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
              if (tab && tab.id && !/^(chrome|edge|about):/i.test(tab.url || '')) {
                const results = await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  func: () => {
                    try {
                      const raw = localStorage.getItem('chomuchka_v3_state');
                      if (!raw) return '';
                      const parsed = JSON.parse(raw);
                      return parsed?.apiKey || '';
                    } catch (e) {
                      return '';
                    }
                  }
                });
                const importedKey = (results?.[0]?.result || '').trim();
                if (importedKey) {
                  extKeyInput.value = importedKey;
                  localStorage.setItem('chomuchka_ext_api_key', importedKey);
                  await chrome.storage.local.set({ chomuchka_ext_api_key: importedKey });
                  updateExtKeyStatusBadge(true);
                }
              }
            } catch (e) {}
          }

          if (res.pendingProofreadText && typeof res.pendingProofreadText === 'string') {
            const text = res.pendingProofreadText.trim();
            await chrome.storage.local.remove('pendingProofreadText');
            if (text && inputEl) {
              inputEl.value = text;
              persistProofreadSession();
              inputEl.focus();
              notifyProofreadToast('📥 Текст вставлено в «Оригінал» — натисніть Перевірити або Ctrl+Enter');
            }
          }

          if (res.pendingPageAiSelection && typeof res.pendingPageAiSelection === 'string') {
            const selText = res.pendingPageAiSelection.trim();
            await chrome.storage.local.remove('pendingPageAiSelection');
            if (selText) {
              currentProofreadState.pageAssistant.selectedText = selText;
              currentProofreadState.pageAssistant.ignoreSelection = false;
              selectAnalysisTab('page');
              document.getElementById('pageAssistantInput')?.focus();
              notifyProofreadToast('🎯 Виділений фрагмент підключено до Page AI — введіть запитання або оберіть шаблон');
            }
          }
        } catch (err) {
          console.error('Failed to read extension storage:', err);
        }
      })();
    }
  }

  if (extSaveKeyBtn && extKeyInput) {
    const saveKeyHandler = async () => {
      const val = extKeyInput.value.trim();
      try {
        localStorage.setItem('chomuchka_ext_api_key', val);
      } catch (e) {}
      if (isChromeExtensionEnv() && chrome.storage?.local) {
        try {
          await chrome.storage.local.set({ chomuchka_ext_api_key: val });
        } catch (e) {}
      }
      updateExtKeyStatusBadge(Boolean(val));
      notifyProofreadToast(val ? '🔑 Gemini API-ключ збережено!' : 'Ключ очищено');
    };
    extSaveKeyBtn.addEventListener('click', saveKeyHandler);
    extKeyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveKeyHandler();
      }
    });
  }

  if (extGrabBtn && isChromeExtensionEnv() && chrome.tabs && chrome.scripting) {
    extGrabBtn.addEventListener('click', async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id || /^(chrome|edge|about):/i.test(tab.url || '')) {
          notifyProofreadToast('На цій системній вкладці браузер не дозволяє читати виділення — вставте текст через Ctrl+V');
          return;
        }
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => window.getSelection().toString().trim()
        });
        const selected = results?.[0]?.result || '';
        if (!selected) {
          notifyProofreadToast('Спочатку виділіть текст мишкою на сторінці');
          return;
        }
        const inputEl = document.getElementById('proofreadOriginalInput');
        if (inputEl) {
          inputEl.value = selected;
          persistProofreadSession();
          inputEl.focus();
        }
        currentProofreadState.pageAssistant.selectedText = selected;
        currentProofreadState.pageAssistant.ignoreSelection = false;
        renderPageAssistantView();
        notifyProofreadToast('📥 Виділений текст вставлено в «Оригінал» та синхронізовано з Page AI');
      } catch (err) {
        notifyProofreadToast('Вставте текст у поле «Оригінал» через Ctrl+V');
      }
    });
  }

  // Listen for live right-click context menu selections while Side Panel is already open
  if (isChromeExtensionEnv() && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || typeof msg.text !== 'string' || !msg.text.trim()) return;
      const cleanText = msg.text.trim();

      if (msg.type === 'PROOFREAD_SELECTION') {
        const inputEl = document.getElementById('proofreadOriginalInput');
        if (inputEl) {
          inputEl.value = cleanText;
          persistProofreadSession();
          inputEl.focus();
        }
        notifyProofreadToast('📥 Текст вставлено в «Оригінал» — натисніть Перевірити або Ctrl+Enter');
      } else if (msg.type === 'PAGE_AI_SELECTION') {
        currentProofreadState.pageAssistant.selectedText = cleanText;
        currentProofreadState.pageAssistant.ignoreSelection = false;
        selectAnalysisTab('page');
        document.getElementById('pageAssistantInput')?.focus();
        notifyProofreadToast('🎯 Виділений фрагмент у пріоритеті Page AI — поставте запитання!');
      }
    });
  }
}

// Auto-initialize when opened directly as chrome_plugin/sidepanel.html
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => {
    if (document.body?.dataset?.sidepanelStandalone === 'true') {
      initParentToolsUi();
    }
  });
} else if (document.body?.dataset?.sidepanelStandalone === 'true') {
  initParentToolsUi();
}
