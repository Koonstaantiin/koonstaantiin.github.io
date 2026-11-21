// =========================================================================
// SHARED AI EDITOR & MULTI-STYLE PROOFREADER ("ВИПРАВЛЕННЯ" + СТИЛІ)
// Works in both:
//   1. Main Web App (index.html -> #parentTabTools)
//   2. Standalone Chrome Side Panel Extension (chrome_plugin/sidepanel.html)
// =========================================================================

const PROOFREAD_STYLE_META = {
  default: {
    key: 'default',
    label: '🔍 Стандартний',
    badge: 'Виправлення (базовий стиль)',
    defaultNote: 'Виправлено граматичні, орфографічні та пунктуаційні помилки зі збереженням вашого авторського тону.'
  },
  short: {
    key: 'short',
    label: '⚡ Short',
    badge: 'Лаконічний стиль (Short)',
    defaultNote: 'Скорочено зайві вставні конструкції та повтори без втрати змісту.'
  },
  formal: {
    key: 'formal',
    label: '🎩 Formal',
    badge: 'Офіційно-діловий стиль (Formal)',
    defaultNote: 'Адаптовано у ввічливий офіційний тон із нормативною діловою лексикою.'
  },
  corp: {
    key: 'corp',
    label: '💼 Corp',
    badge: 'Корпоративний стиль (Corp)',
    defaultNote: 'Сучасний бізнес-стиль для робочого листування (Slack, Teams, Jira, Email).'
  }
};

const PROOFREAD_PRESETS = {
  uk_parent_note: {
    label: '🇺🇦 Повідомлення вчителю',
    text: 'Привіт Олена\n\nПідскажіть будь-ласка чи потрібно дитині брати 2 зошити на завтрашній урок малювання / ліплення / аплікації?'
  },
  en_team_note: {
    label: '🇬🇧 Лист англійською',
    text: 'Hello team\n\nMe and Alex has prepared 3 new learning games for the kids, and we would like to discuss about them on tomorrow morning.'
  },
  uk_story: {
    label: '🇺🇦 Пізнавальна нотатка',
    text: 'Вчора на протязі дня ми вивчали самі цікаві факти про існуючих морських тварин.'
  }
};

const RULE_CATEGORY_META = {
  grammar: {
    label: 'Граматика',
    cls: 'bg-sky-950/90 text-sky-300 border-sky-700/70'
  },
  punctuation: {
    label: 'Пунктуація',
    cls: 'bg-amber-950/90 text-amber-300 border-amber-700/70'
  },
  spelling: {
    label: 'Орфографія',
    cls: 'bg-rose-950/90 text-rose-300 border-rose-700/70'
  },
  word_choice: {
    label: 'Лексика та сполучуваність',
    cls: 'bg-emerald-950/90 text-emerald-300 border-emerald-700/70'
  },
  style: {
    label: 'Стилістика',
    cls: 'bg-purple-950/90 text-purple-300 border-purple-700/70'
  }
};

let currentProofreadState = {
  originalText: PROOFREAD_PRESETS.uk_parent_note.text,
  detectedLanguage: 'uk',
  summary: '',
  activeStyle: 'default', // 'default' | 'short' | 'formal' | 'corp'
  activeAnalysisTab: 'rules', // 'rules' | 'grammar' | 'page'
  variants: {
    default: { text: '', note: '' },
    short: { text: '', note: '' },
    formal: { text: '', note: '' },
    corp: { text: '', note: '' }
  },
  appliedRules: [],
  grammarExplanation: {
    sentence_type: '',
    syntax_formula: '',
    tense_and_mood: '',
    items: []
  },
  pageAssistant: {
    prompt: '',
    answer: '',
    answeredScope: 'page', // 'selection' | 'page'
    selectedText: '',
    ignoreSelection: false,
    pageTitle: '',
    pageUrl: '',
    charCount: 0,
    isLoading: false
  },
  displayMode: 'wavy', // 'wavy' | 'inline'
  strictC1C2: true, // Cambridge CAE/CPE 12-pillar strict mode
  quickMode: true, // true = Instant Quick Mode (only corrected_text), false = 4 Styles + rules
  lastElapsedSec: '',
  lastModelUsed: '',
  error: null,
  isLoading: false,
  isExplainingRules: false,
  usedOfflineFallback: false
};

// =========================================================================
// ENVIRONMENT ADAPTER (WEB APP vs CHROME EXTENSION SIDE PANEL)
// =========================================================================

function isChromeExtensionEnv() {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime && chrome.runtime.id);
}

function safeEscapeHtml(str) {
  if (typeof escapeHtml === 'function') return escapeHtml(str);
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function notifyProofreadToast(msg) {
  if (typeof showToast === 'function') {
    showToast(msg);
    return;
  }
  const banner = document.getElementById('extToastBanner') || document.getElementById('toastBanner');
  if (!banner) return;
  banner.textContent = msg;
  banner.classList.remove('hidden');
  clearTimeout(banner._hideTimer);
  banner._hideTimer = setTimeout(() => banner.classList.add('hidden'), 2800);
}

function getProofreadApiKey() {
  if (typeof getActiveApiKey === 'function') {
    const k = getActiveApiKey();
    if (k) return k;
  }
  const extInput = document.getElementById('extApiKeyInput');
  if (extInput && extInput.value.trim()) {
    return extInput.value.trim();
  }
  try {
    return localStorage.getItem('chomuchka_ext_api_key') || '';
  } catch (e) {
    return '';
  }
}

function isDeprecatedGeminiModel(modelId) {
  if (!modelId) return true;
  return (
    modelId.startsWith('gemini-2.5') ||
    modelId.startsWith('gemini-2.0') ||
    modelId.startsWith('gemini-1.5')
  );
}

function getProofreadModelCandidates() {
  const currentModels = [
    'gemini-3.1-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.8-flash',
    'gemini-4-argon'
  ];
  const extModelEl = document.getElementById('extModelSelect');
  const rawPreferred = (extModelEl && extModelEl.value) || 'gemini-3.1-flash-lite';
  const preferredModel = isDeprecatedGeminiModel(rawPreferred)
    ? 'gemini-3.1-flash-lite'
    : rawPreferred;

  if (extModelEl && isDeprecatedGeminiModel(extModelEl.value)) {
    extModelEl.value = 'gemini-3.1-flash-lite';
  }

  return [...new Set([preferredModel, ...currentModels])].filter(
    m => m && !isDeprecatedGeminiModel(m)
  );
}

function extractGeminiJsonObject(data) {
  let rawText = '';

  // 1. Gemini Interactions API response format (v1beta/interactions, Api-Revision: 2026-05-20)
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    rawText = data.output_text.trim();
  } else if (Array.isArray(data?.steps)) {
    for (let i = data.steps.length - 1; i >= 0; i--) {
      const step = data.steps[i];
      if (step?.type === 'model_output' && Array.isArray(step.content)) {
        const textBlocks = step.content.filter(
          c => c?.type === 'text' && typeof c.text === 'string' && c.text.trim()
        );
        if (textBlocks.length > 0) {
          rawText = textBlocks[textBlocks.length - 1].text.trim();
          break;
        }
      }
    }
  } else if (Array.isArray(data?.outputs)) {
    const textOut = data.outputs.find(o => typeof o?.text === 'string' && o.text.trim());
    if (textOut) rawText = textOut.text.trim();
  }

  // 2. Fallback: generateContent response format (candidates[0].content.parts)
  if (!rawText) {
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const nonThoughtParts = parts.filter(
      p => !p.thought && typeof p.text === 'string' && p.text.trim().length > 0
    );
    const targetPart = nonThoughtParts.length > 0
      ? nonThoughtParts[nonThoughtParts.length - 1]
      : parts.find(p => typeof p.text === 'string' && p.text.includes('{'));
    if (targetPart?.text) {
      rawText = targetPart.text.trim();
    }
  }

  if (!rawText) {
    throw new Error('Модель не повернула текстовий JSON');
  }

  let raw = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    raw = raw.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(raw);
}

// =========================================================================
// SESSION PERSISTENCE & UI RENDERING
// =========================================================================

function getActiveVariantObject() {
  const key = currentProofreadState.activeStyle || 'default';
  return currentProofreadState.variants?.[key]
    || currentProofreadState.variants?.default
    || { text: currentProofreadState.originalText, note: '' };
}

function persistProofreadSession() {
  const inputEl = document.getElementById('proofreadOriginalInput');
  const pageInputEl = document.getElementById('pageAssistantInput');
  const snapshot = {
    originalText: currentProofreadState.originalText,
    draftInputText: inputEl ? inputEl.value : currentProofreadState.originalText,
    detectedLanguage: currentProofreadState.detectedLanguage,
    summary: currentProofreadState.summary,
    activeStyle: currentProofreadState.activeStyle,
    activeAnalysisTab: currentProofreadState.activeAnalysisTab,
    variants: currentProofreadState.variants,
    appliedRules: currentProofreadState.appliedRules,
    grammarExplanation: currentProofreadState.grammarExplanation,
    pageAssistant: {
      prompt: pageInputEl ? pageInputEl.value : (currentProofreadState.pageAssistant?.prompt || ''),
      answer: currentProofreadState.pageAssistant?.answer || '',
      answeredScope: currentProofreadState.pageAssistant?.answeredScope || 'page',
      selectedText: currentProofreadState.pageAssistant?.selectedText || '',
      ignoreSelection: Boolean(currentProofreadState.pageAssistant?.ignoreSelection),
      pageTitle: currentProofreadState.pageAssistant?.pageTitle || '',
      pageUrl: currentProofreadState.pageAssistant?.pageUrl || '',
      charCount: currentProofreadState.pageAssistant?.charCount || 0
    },
    displayMode: currentProofreadState.displayMode,
    strictC1C2: currentProofreadState.strictC1C2,
    quickMode: currentProofreadState.quickMode,
    lastElapsedSec: currentProofreadState.lastElapsedSec || '',
    lastModelUsed: currentProofreadState.lastModelUsed || '',
    error: currentProofreadState.error,
    usedOfflineFallback: currentProofreadState.usedOfflineFallback
  };
  try {
    localStorage.setItem('chomuchka_proofread_session_v1', JSON.stringify(snapshot));
  } catch (e) {}
  if (isChromeExtensionEnv() && chrome.storage?.local) {
    chrome.storage.local.set({ chomuchka_proofread_session_v1: snapshot });
  }
}

function restoreProofreadSessionSnapshot(saved) {
  if (!saved || typeof saved !== 'object' || !saved.variants) return false;
  const inputEl = document.getElementById('proofreadOriginalInput');
  const pageInputEl = document.getElementById('pageAssistantInput');
  currentProofreadState.originalText = typeof saved.originalText === 'string' ? saved.originalText : '';
  currentProofreadState.detectedLanguage = saved.detectedLanguage || 'uk';
  currentProofreadState.summary = saved.summary || '';
  currentProofreadState.activeStyle = PROOFREAD_STYLE_META[saved.activeStyle] ? saved.activeStyle : 'default';
  currentProofreadState.activeAnalysisTab = ['rules', 'grammar', 'page'].includes(saved.activeAnalysisTab)
    ? saved.activeAnalysisTab
    : 'rules';
  currentProofreadState.variants = normalizeVariantsObject({ variants: saved.variants }, currentProofreadState.originalText);
  currentProofreadState.appliedRules = Array.isArray(saved.appliedRules) ? saved.appliedRules : [];

  if (saved.grammarExplanation && (saved.grammarExplanation.sentence_type || (saved.grammarExplanation.items && saved.grammarExplanation.items.length > 0))) {
    currentProofreadState.grammarExplanation = normalizeGrammarExplanationObject(saved.grammarExplanation);
  } else {
    const fallbackSim = simulateProofreadPipeline(currentProofreadState.originalText);
    currentProofreadState.grammarExplanation = normalizeGrammarExplanationObject(fallbackSim.grammar_explanation);
  }

  if (saved.pageAssistant && typeof saved.pageAssistant === 'object') {
    currentProofreadState.pageAssistant = {
      ...currentProofreadState.pageAssistant,
      prompt: typeof saved.pageAssistant.prompt === 'string' ? saved.pageAssistant.prompt : '',
      answer: typeof saved.pageAssistant.answer === 'string' ? saved.pageAssistant.answer : '',
      answeredScope: saved.pageAssistant.answeredScope === 'selection' ? 'selection' : 'page',
      selectedText: typeof saved.pageAssistant.selectedText === 'string' ? saved.pageAssistant.selectedText : '',
      ignoreSelection: Boolean(saved.pageAssistant.ignoreSelection),
      pageTitle: typeof saved.pageAssistant.pageTitle === 'string' ? saved.pageAssistant.pageTitle : '',
      pageUrl: typeof saved.pageAssistant.pageUrl === 'string' ? saved.pageAssistant.pageUrl : '',
      charCount: Number(saved.pageAssistant.charCount) || 0,
      isLoading: false
    };
  }

  currentProofreadState.displayMode = saved.displayMode === 'inline' ? 'inline' : 'wavy';
  if (typeof saved.strictC1C2 === 'boolean') {
    currentProofreadState.strictC1C2 = saved.strictC1C2;
  }
  if (typeof saved.quickMode === 'boolean') {
    currentProofreadState.quickMode = saved.quickMode;
  }
  currentProofreadState.lastElapsedSec = typeof saved.lastElapsedSec === 'string' ? saved.lastElapsedSec : '';
  currentProofreadState.lastModelUsed = typeof saved.lastModelUsed === 'string' ? saved.lastModelUsed : '';
  currentProofreadState.error = typeof saved.error === 'string' && saved.error ? saved.error : null;
  currentProofreadState.usedOfflineFallback = Boolean(saved.usedOfflineFallback);

  if (inputEl) {
    inputEl.value = typeof saved.draftInputText === 'string'
      ? saved.draftInputText
      : currentProofreadState.originalText;
  }
  if (pageInputEl && currentProofreadState.pageAssistant.prompt) {
    pageInputEl.value = currentProofreadState.pageAssistant.prompt;
  }
  renderProofreadView();
  return true;
}
