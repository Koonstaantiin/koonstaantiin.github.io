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
  variants: {
    default: { text: '', note: '' },
    short: { text: '', note: '' },
    formal: { text: '', note: '' },
    corp: { text: '', note: '' }
  },
  appliedRules: [],
  displayMode: 'wavy', // 'wavy' | 'inline'
  strictC1C2: true, // Cambridge CAE/CPE 12-pillar strict mode
  isLoading: false,
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
    'gemini-3.8-flash',
    'gemini-3.5-flash-lite',
    'gemini-4-argon',
    'gemini-4-carbon',
    'gemini-3.1-flash-lite'
  ];
  const extModelEl = document.getElementById('extModelSelect');
  const rawPreferred = (extModelEl && extModelEl.value) || 'gemini-3.8-flash';
  const preferredModel = isDeprecatedGeminiModel(rawPreferred)
    ? 'gemini-3.8-flash'
    : rawPreferred;

  if (extModelEl && isDeprecatedGeminiModel(extModelEl.value)) {
    extModelEl.value = 'gemini-3.8-flash';
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
// SINGLE-QUERY MULTI-STYLE PROMPT & SIMULATION FALLBACK
// =========================================================================

function buildProofreadSystemInstruction(strictC1C2 = true) {
  const cambridgeTaxonomyBlock = strictC1C2
    ? `
2. СУВОРИЙ АУДИТ ЗА 12 РОЗДІЛАМИ CAMBRIDGE C1/C2 (CAE / CPE Use of English):
   Перевір кожне речення за всіма 12 критеріями прескриптивної граматики C1/C2 (не пропускай розмовні спрощення, які вважаються помилкою на іспитах CAE/CPE):
   [1] Unreal Past & Hypothetical Meaning:
       - "It's (high / about) time + somebody + Past Simple" (напр., "It's time we left", НЕ "It's time we go/leave").
       - "would rather / would sooner + інший підмет + Past Simple / Past Perfect" (напр., "I'd rather you didn't mention it").
       - "wish / if only + Past Simple / Past Perfect / would" (заборонено "wish + would" для того самого підмета: "I wish I could", НЕ "I wish I would").
       - "suppose / supposing / what if / imagine / as if / as though + Unreal Past".
   [2] Modal Idioms — Preference vs. Obligation & Past Deduction:
       - Суворо розрізняй "had better" ('d better = нагальна необхідність або попередження про негативні наслідки: "мені конче треба, інакше буде погано") та вираження особистої переваги/бажання ("would rather" / "'d rather", "would just as soon" / "'d just as soon", "would sooner"). Якщо умова вказує на необов'язковість або вибір (напр., "if it's not essential"), вживання "'d better" є помилкою — виправляй на "'d just as soon" або "'d rather".
       - "prefer X to Y" / "would prefer to do X rather than do Y" (НЕ "rather than doing").
       - "needn't have done" (зробив дарма) vs "didn't need to do" (не було потреби).
       - Припущення в минулому: "must have done / can't have done / might have done" (заборонено "mustn't have done" або "can have done").
   [3] Mandative Subjunctive:
       - Після "suggest, recommend, insist, demand, propose, vital, essential, imperative" використовуй "(that) somebody (should) + bare infinitive (V1)" або V-ing. Виправляй типові помилки на кшталт "I suggest you to go" → "I suggest (that) you go" та "insisted that he goes" → "insisted that he go".
   [4] Negative & Restrictive Inversion:
       - Обов'язкова інверсія допоміжного дієслова після винесених на початок заперечних або обмежувальних прислівників: "Never / Seldom / Rarely / Little / Hardly...when / Scarcely...when / No sooner...than / Not only...but also / Under no circumstances / On no account / Not until / Only after / Only when" (напр., "Hardly had I arrived when...", "Not until later did I realize...").
   [5] Advanced, Mixed & Inverted Conditionals:
       - Заборона "will / would" у підрядній частині з "if" (крім ввічливого прохання чи впертої відмови).
       - Перевірка часової логіки змішаних умовних речень (Mixed Conditionals: "If + Past Perfect, would + V1" та "If + Past Simple, would have + V3").
       - Інвертовані умовні конструкції: "Were I to...", "Should you need...", "Had I known...", "But for / Were it not for / Had it not been for".
   [6] Verb Patterns (Gerund vs. Infinitive & Prepositional "to"):
       - Розрізнення зміни значення після "remember, forget, regret, stop, try, mean, go on + to V" vs "+ V-ing".
       - Герундій (V-ing) після прийменникового "to": "look forward to doing", "object to doing", "be used/accustomed to doing", "be committed/dedicated to doing", "with a view to doing".
   [7] Participle Clauses & Dangling Modifiers:
       - Підмет дієприкметникового звороту на початку речення ОБОВ'ЯЗКОВО має збігатися з підметом головного речення (виправляй dangling participles типу "Walking down the street, the rain started").
   [8] Cleft Sentences & Emphasis:
       - Правильне узгодження у "What + clause + is/was (to) V1", "All (that) I did was (to) V1", "It is/was ... that/who...".
   [9] Discourse Markers, Concession & Contrast:
       - "despite / in spite of + Noun / V-ing / the fact that" (КАТЕГОРИЧНО без "of" після despite) vs "although / even though / much as + clause".
       - Інвертована поступка: "Adjective/Adverb + as/though + S + V" (напр., "Hard as he tried...").
   [10] Relative Clauses, Quantifiers & Determiners:
       - Заборона "that" у non-defining relative clauses після коми; різниця між "none of whom" (у єдиному реченні через кому) та "none of them" (нове речення); "few / a few / little / a little"; "no fewer than" (злічувані) vs "no less than" (незлічувані).
   [11] Gradable vs. Non-Gradable (Extreme) Adjectives:
       - Заборона поєднання "very / slightly / a bit" з граничними прикметниками ("exhausted, freezing, furious, impossible, essential, fascinating") — замінюй на "absolutely / utterly / completely".
   [12] L1 Interference, False Friends & Advanced Collocations:
       - Слов'янські та українські кальки прийменників і лексики: "depend on" (не from), "consist of" (не from), "divide into" (не on), "arrive in/at" (не to), "opportunity" vs "possibility", "economic" vs "economical", "historic" vs "historical".`
    : `
2. РЕЖИМ СТАНДАРТНОЇ КОРЕКТУРИ (Everyday Proofreading):
   Виправляй реальні граматичні, орфографічні, пунктуаційні та лексичні помилки, але зберігай природні розмовні конструкції, якщо вони прийнятні в живому спілкуванні.`;

  return `Ти — професійний лінгвіст-редактор${strictC1C2 ? ', екзаменатор рівня Cambridge C1/C2 (CAE/CPE)' : ''} та коректор (рівень Grammarly Pro / LanguageTool для української, англійської та інших мов).
Твоє завдання — за ОДИН запит:
1. Виправити всі граматичні, орфографічні, пунктуаційні, лексичні та семантико-граматичні помилки в оригінальному тексті.${cambridgeTaxonomyBlock}
3. СПОЧАТКУ проведи граматичний аудит і заповни масив "applied_rules" для кожної знайденої помилки між оригіналом і виправленим варіантом.
4. На основі цих правил згенеруй 4 стилістичні варіанти виправленого тексту (тією самою мовою, якою написано оригінал):
   - "default": стандартне виправлення всіх знайдених помилок зі збереженням початкового тону та структури автора.
   - "short": лаконічний, стислий варіант (без зайвих слів і води, максимум суті).
   - "formal": офіційно-діловий, ввічливий та виважений тон.
   - "corp": сучасний корпоративний стиль для робочих месенджерів (Slack, Teams, Jira) або ділових листів.

Поверни ВИКЛЮЧНО валідний JSON-об'єкт (де "applied_rules" заповнюється ПЕРЕД "variants"):
{
  "detected_language": "uk" | "en" | "ru" | "other",
  "applied_rules": [
    {
      "category": "grammar" | "punctuation" | "spelling" | "word_choice" | "style",
      "original_fragment": "точний фрагмент з оригіналу до виправлення",
      "fixed_fragment": "точний фрагмент у виправленому тексті (або порожній рядок, якщо слово видалено)",
      "rule_title": "коротка назва застосованого правила українською мовою",
      "explanation": "чітке й зрозуміле пояснення українською мовою (1–2 речення), чому зроблено це виправлення"
    }
  ],
  "summary": "коротке резюме виправлень українською мовою (1 речення)",
  "variants": {
    "default": {
      "text": "виправлений текст у стандартному стилі автора",
      "note": "коротке пояснення українською, що збережено і що виправлено"
    },
    "short": {
      "text": "короткий і лаконічний варіант",
      "note": "коротке пояснення українською, за рахунок чого скорочено текст"
    },
    "formal": {
      "text": "офіційно-діловий варіант",
      "note": "коротке пояснення українською, які маркери офіційного стилю застосовано"
    },
    "corp": {
      "text": "корпоративний бізнес-варіант",
      "note": "коротке пояснення українською, як адаптовано під корпоративну комунікацію"
    }
  }
}

ВАЖЛИВІ ПРАВИЛА:
1. Не змінюй мову самого тексту: якщо оригінал англійською — усі 4 тексти в "variants" мають бути англійською; якщо українською — українською. Усі пояснення (summary, note, rule_title, explanation) ЗАВЖДИ пиши українською мовою.
2. Кожна помилка між оригіналом і variants.default.text повинна мати запис у масиві applied_rules.
3. КАТЕГОРИЧНО ЗАБОРОНЕНО дублювати привітання чи звертання (наприклад, ніколи не пиши "Hi team — Hi team," або "Please note: Hi team,"). Якщо в оригіналі вже є привітання ("Hi team,"), органічно заміни або інтегруй його відповідно до стилю.`;
}

function simulateProofreadPipeline(rawText) {
  const text = (rawText || '').trim();
  const lower = text.toLowerCase();

  if (lower.includes('привіт олена') || lower.includes('2 зошити на завтрашній урок')) {
    return {
      detected_language: 'uk',
      summary: 'Виправлено кличний відмінок і пунктуацію у звертанні, правопис вставної сполуки, числівник та оформлення однорідних членів речення.',
      variants: {
        default: {
          text: 'Привіт, Олено!\n\nПідкажіть, будь ласка, чи потрібно дитині брати два зошити на завтрашній урок малювання, ліплення або аплікації?',
          note: 'Стандартне виправлення: збережено дружній тон, виправлено кличний відмінок, правопис «будь ласка» та пунктуацію.'
        },
        short: {
          text: 'Привіт, Олено! Чи потрібно брати два зошити на завтрашній урок (малювання, ліплення, аплікація)?',
          note: 'Short: прибрано вставні конструкції та об’єднано речення для швидкого читання в месенджері.'
        },
        formal: {
          text: 'Добрий день, пані Олено!\n\nУточніть, будь ласка, чи необхідно підготувати дитині два зошити для завтрашнього заняття з малювання, ліплення або аплікації?',
          note: 'Formal: застосовано шанобливе звертання «пані Олено» та офіційно-ділову лексику («уточніть», «необхідно підготувати»).'
        },
        corp: {
          text: 'Вітаю, Олено!\n\nПідкажіть, будь ласка, чи потрібні два зошити на завтрашнє заняття (малювання, ліплення або аплікація)? Дякую!',
          note: 'Corp: діловий тон сучасної комунікації з привітанням «Вітаю», чітким запитанням і ввічливим завершенням.'
        }
      },
      applied_rules: [
        {
          category: 'grammar',
          original_fragment: 'Привіт Олена',
          fixed_fragment: 'Привіт, Олено!',
          rule_title: 'Кличний відмінок та кома при звертанні («Олено» замість «Олена»)',
          explanation: 'В українській мові імена у звертаннях вживаються у кличному відмінку («Олено») та обов’язково відокремлюються комою після вітального слова.'
        },
        {
          category: 'spelling',
          original_fragment: 'Підскажіть будь-ласка',
          fixed_fragment: 'Підкажіть, будь ласка,',
          rule_title: 'Нормативне «Підкажіть» (без «с») та правопис «будь ласка»',
          explanation: 'Українською правильно писати «підкажіть» (префікс під-). Вставне словосполучення «будь ласка» завжди пишеться окремо без дефіса і виділяється комами з обох боків.'
        },
        {
          category: 'style',
          original_fragment: '2 зошити',
          fixed_fragment: 'два зошити',
          rule_title: 'Написання простих числівників (1–9) словами у зв’язному тексті',
          explanation: 'За правилами редакційного оформлення текстів, однозначні числівники в нетехнічних реченнях рекомендується писати словами («два»).'
        },
        {
          category: 'punctuation',
          original_fragment: 'малювання / ліплення / аплікації',
          fixed_fragment: 'малювання, ліплення або аплікації',
          rule_title: 'Коми та сполучник «або» замість скісних рисок при переліку',
          explanation: 'У зв’язному питальному реченні однорідні члени розділяються комами, а перед останнім варіантом ставиться розділовий сполучник «або» чи «чи».'
        }
      ]
    };
  }

  if (lower.includes('me and alex has prepared') || lower.includes('discuss about them')) {
    return {
      detected_language: 'en',
      summary: 'Виправлено займенникову конструкцію підмета, узгодження дієслова, числівник та надлишкові прийменники.',
      variants: {
        default: {
          text: 'Hello team,\n\nAlex and I have prepared three new learning games for the kids, and we would like to discuss them tomorrow morning.',
          note: 'Стандартне виправлення: збережено структуру повідомлення, виправлено граматику підмета та перехідність дієслова.'
        },
        short: {
          text: 'Hi team,\n\nAlex and I prepared three new kids’ learning games. Let’s discuss them tomorrow morning.',
          note: 'Short: скорочено модальні звороти ("would like to") до прямого заклику до дії.'
        },
        formal: {
          text: 'Dear Team,\n\nAlex and I have developed three new educational games for the children and would welcome the opportunity to review them with you tomorrow morning.',
          note: 'Formal: підвищено регістр лексики ("developed", "educational games", "would welcome the opportunity to review").'
        },
        corp: {
          text: 'Hi team,\n\nAlex and I have put together three new learning games for the kids — happy to walk through them during tomorrow morning’s sync.',
          note: 'Corp: природний корпоративний стиль для Slack/Teams із лексикою "put together" та "tomorrow morning’s sync".'
        }
      },
      applied_rules: [
        {
          category: 'punctuation',
          original_fragment: 'Hello team',
          fixed_fragment: 'Hello team,',
          rule_title: 'Кома після звертання на початку листа',
          explanation: 'В англійському листуванні після привітання та звертання ставиться кома.'
        },
        {
          category: 'grammar',
          original_fragment: 'Me and Alex has',
          fixed_fragment: 'Alex and I have',
          rule_title: 'Суб’єктний займенник "Alex and I" + множина дієслова "have"',
          explanation: 'У ролі підмета використовується називний відмінок займенника ("I", а не "Me"), який за етикетом ставиться після імені іншої особи ("Alex and I") і вимагає дієслова у множині ("have").'
        },
        {
          category: 'style',
          original_fragment: '3',
          fixed_fragment: 'three',
          rule_title: 'Написання однозначних числівників (1–9) словами',
          explanation: 'За стандартами англійської стилістики числівники від одного до дев’яти в реченнях передаються словами ("three").'
        },
        {
          category: 'grammar',
          original_fragment: 'discuss about them on tomorrow',
          fixed_fragment: 'discuss them tomorrow',
          rule_title: 'Перехідне дієслово "discuss" (без "about") та прислівник часу "tomorrow" (без "on")',
          explanation: 'Дієслово "discuss" в англійській мові є прямоперехідним і не потребує прийменника "about", а перед словами "tomorrow", "today", "yesterday" прийменник "on" не вживається.'
        }
      ]
    };
  }

  if (lower.includes('на протязі') || lower.includes('самі цікаві') || lower.includes('існуючих')) {
    return {
      detected_language: 'uk',
      summary: 'Виправлено чергування У/В, калькований прийменник часу, ступінь порівняння прикметника та активний дієприкметник.',
      variants: {
        default: {
          text: 'Учора протягом дня ми вивчали найцікавіші факти про наявних морських тварин.',
          note: 'Стандартне виправлення: усунено суржикові кальки та дотримано правил милозвучності.'
        },
        short: {
          text: 'Учора ми вивчали найцікавіші факти про морських тварин.',
          note: 'Short: прибрано уточнення часу «протягом дня» та означення «наявних» без втрати головної думки.'
        },
        formal: {
          text: 'Учора впродовж дня ми досліджували найбільш пізнавальні відомості про сучасних представників морської фауни.',
          note: 'Formal: академічний виклад («досліджували відомості», «представників морської фауни»).'
        },
        corp: {
          text: 'Учора протягом дня команда розібрала ключові факти про сучасних морських тварин.',
          note: 'Corp: структурований звітний тон із акцентом на результат.'
        }
      },
      applied_rules: [
        {
          category: 'style',
          original_fragment: 'Вчора',
          fixed_fragment: 'Учора',
          rule_title: 'Чергування у/в на початку речення перед приголосним (милозвучність)',
          explanation: 'На початку речення перед збігом приголосних («ч») для милозвучності української мови нормативно вживається форма «Учора».'
        },
        {
          category: 'grammar',
          original_fragment: 'на протязі дня',
          fixed_fragment: 'протягом дня',
          rule_title: 'Прийменник часу «протягом» або «впродовж» замість «на протязі»',
          explanation: '«На протязі» означає потік повітря у приміщенні. Для позначення часового проміжку вживається слово «протягом» або «впродовж».'
        },
        {
          category: 'grammar',
          original_fragment: 'самі цікаві',
          fixed_fragment: 'найцікавіші',
          rule_title: 'Творення найвищого ступеня порівняння прикметників (префікс най-)',
          explanation: 'В українській мові найвищий ступінь порівняння утворюється за допомогою префікса най- («найцікавіші»), а форма зі словом «самі» є граматичною помилкою.'
        },
        {
          category: 'word_choice',
          original_fragment: 'існуючих',
          fixed_fragment: 'наявних',
          rule_title: 'Уникнення невластивих активних дієприкметників на -уч/-юч',
          explanation: 'Активні дієприкметники теперішнього часу з суфіксом -уч-/-юч- («існуючих») не нормативні в українській мові; правильно замінити на прикметник «наявних» або «сучасних».'
        }
      ]
    };
  }

  if (lower.includes("i'd better skip the meeting") || lower.includes('id better skip the meeting')) {
    return {
      detected_language: 'en',
      summary: "Виправлено модальну ідіому: для вираження особистої переваги за необов'язкової умови замість 'd better (had better) вжито 'd just as soon.",
      variants: {
        default: {
          text: "I'd just as soon skip the meeting if it's not essential.",
          note: "Стандартне виправлення (C1/C2 Modal Idioms): замінено 'd better (сувора необхідність/попередження) на 'd just as soon (особиста перевага)."
        },
        short: {
          text: "I'd rather skip the meeting if it's optional.",
          note: "Short: лаконічне вираження переваги через 'd rather та заміну 'not essential' на 'optional'."
        },
        formal: {
          text: 'I would prefer not to attend the meeting unless my presence is essential.',
          note: 'Formal: офіційно-ділова формула "would prefer not to attend ... unless my presence is essential".'
        },
        corp: {
          text: "I'll sit this meeting out if my attendance isn't critical.",
          note: 'Corp: природний бізнес-ідіоматичний вираз "sit this meeting out" для робочої комунікації.'
        }
      },
      applied_rules: [
        {
          category: 'grammar',
          original_fragment: "I'd better skip",
          fixed_fragment: "I'd just as soon skip",
          rule_title: "Modal Idioms & Preference: «would just as soon / would rather» замість «had better»",
          explanation: "Конструкція «had better» ('d better) виражає нагальну необхідність або попередження про негативні наслідки. Оскільки умова «if it's not essential» вказує на необов'язковість і особисте бажання (preference), правильно вживати «I'd just as soon skip» або «I'd rather skip»."
        }
      ]
    };
  }

  // Custom user text when no API key is configured: never prepend fake prefixes like "Hi team —" or "Please note:"
  const trimmed = text;
  const isUk = /[а-яіїєґ]/i.test(trimmed);
  const noKeyNote = '🔑 Для перевірки власного тексту та генерації стилів введіть ваш Gemini API-ключ у полі зверху і натисніть «Зберегти».';

  return {
    detected_language: isUk ? 'uk' : 'en',
    isUnconfiguredCustomText: true,
    summary: '⚠️ Ключ Gemini API ще не підключено. Вставте ключ AIza... у блок «🔑 Gemini API та модель» зверху.',
    variants: {
      default: {
        text: trimmed,
        note: noKeyNote
      },
      short: {
        text: trimmed,
        note: noKeyNote
      },
      formal: {
        text: trimmed,
        note: noKeyNote
      },
      corp: {
        text: trimmed,
        note: noKeyNote
      }
    },
    applied_rules: []
  };
}

function normalizeVariantsObject(parsed, fallbackText) {
  const baseText = (parsed?.variants?.default?.text || parsed?.corrected_text || fallbackText || '').trim();
  const rawVars = parsed?.variants || {};

  const buildEntry = (key) => {
    const item = rawVars[key];
    if (item && typeof item === 'object' && typeof item.text === 'string' && item.text.trim()) {
      return {
        text: item.text.trim(),
        note: item.note || PROOFREAD_STYLE_META[key].defaultNote
      };
    }
    if (typeof item === 'string' && item.trim()) {
      return {
        text: item.trim(),
        note: PROOFREAD_STYLE_META[key].defaultNote
      };
    }
    return {
      text: baseText,
      note: PROOFREAD_STYLE_META[key].defaultNote
    };
  };

  return {
    default: buildEntry('default'),
    short: buildEntry('short'),
    formal: buildEntry('formal'),
    corp: buildEntry('corp')
  };
}

// Diagnosis-First JSON Schema: `applied_rules` is generated BEFORE `variants`
// so the model performs its C1/C2 grammatical audit before writing the corrected text.
const PROOFREAD_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    detected_language: { type: 'string' },
    applied_rules: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          original_fragment: { type: 'string' },
          fixed_fragment: { type: 'string' },
          rule_title: { type: 'string' },
          explanation: { type: 'string' }
        },
        required: ['category', 'original_fragment', 'fixed_fragment', 'rule_title', 'explanation']
      }
    },
    summary: { type: 'string' },
    variants: {
      type: 'object',
      properties: {
        default: {
          type: 'object',
          properties: { text: { type: 'string' }, note: { type: 'string' } },
          required: ['text', 'note']
        },
        short: {
          type: 'object',
          properties: { text: { type: 'string' }, note: { type: 'string' } },
          required: ['text', 'note']
        },
        formal: {
          type: 'object',
          properties: { text: { type: 'string' }, note: { type: 'string' } },
          required: ['text', 'note']
        },
        corp: {
          type: 'object',
          properties: { text: { type: 'string' }, note: { type: 'string' } },
          required: ['text', 'note']
        }
      },
      required: ['default', 'short', 'formal', 'corp']
    }
  },
  required: ['detected_language', 'applied_rules', 'summary', 'variants']
};

async function callGeminiProofreadApi(originalText, signal = null) {
  const apiKey = getProofreadApiKey();
  const strictMode = currentProofreadState.strictC1C2 !== false;
  if (!apiKey) {
    await new Promise(r => setTimeout(r, 220));
    const sim = simulateProofreadPipeline(originalText);
    return {
      ...sim,
      variants: normalizeVariantsObject(sim, originalText),
      usedOfflineFallback: true
    };
  }

  const modelsToTry = getProofreadModelCandidates();
  const deadline = Date.now() + 24000;
  const modelErrors = [];
  const sysInstruction = buildProofreadSystemInstruction(strictMode);
  const modeHeader = strictMode
    ? '[РЕЖИМ: CAMBRIDGE C1/C2 STRICT EXAMINER — перевір речення за всіма 12 розділами CAE/CPE Use of English (Unreal Past, Modal Idioms, Inversion, Subjunctive, Conditionals, Collocations), спочатку заповни applied_rules, а потім variants]'
    : '[РЕЖИМ: СТАНДАРТНА КОРЕКТУРА]';
  const userPrompt = `${modeHeader}\nПеревір цей текст, спочатку випиши всі застосовані правила в applied_rules, а потім згенеруй всі 4 стилі (default, short, formal, corp) в одному JSON:\n\n"""\n${originalText}\n"""`;

  for (const modelId of modelsToTry) {
    const remainingMs = deadline - Date.now();
    if ((signal && signal.aborted) || remainingMs < 1500) break;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), remainingMs);
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    try {
      // 1. Primary path: Gemini Interactions API (v1beta/interactions, Api-Revision: 2026-05-20)
      // Note: Do not pass deprecated `temperature` parameter on Gemini 3.8 / 4 models
      const interactionsUrl = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(apiKey)}`;
      let response = await fetch(interactionsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
          'Api-Revision': '2026-05-20'
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: modelId,
          system_instruction: sysInstruction,
          input: userPrompt,
          response_format: PROOFREAD_RESPONSE_JSON_SCHEMA
        })
      });

      // 2. Automatic fallback to v1beta/models/{model}:generateContent if endpoint returns 404/400
      if (!response.ok && (response.status === 404 || response.status === 400)) {
        const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        response = await fetch(generateUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: sysInstruction }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: {
              responseMimeType: 'application/json'
            }
          })
        });
      }

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
      const parsed = extractGeminiJsonObject(data);
      const variants = normalizeVariantsObject(parsed, originalText);

      return {
        detected_language: parsed.detected_language || 'uk',
        summary: parsed.summary || '',
        variants,
        applied_rules: Array.isArray(parsed.applied_rules) ? parsed.applied_rules : [],
        usedOfflineFallback: false
      };
    } catch (err) {
      clearTimeout(timeoutId);
      modelErrors.push(`${modelId}: ${err.message || 'помилка'}`);
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  throw new Error(modelErrors[0] || 'Не вдалося виконати запит до Gemini API');
}

// =========================================================================
// WORD & PUNCTUATION LCS DIFF ENGINE
// =========================================================================

function tokenizeWithLeadingSpace(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const tokens = [];
  const regex = /([ \t]*)(\n+|[\p{L}\p{N}_'’-]+|[^\s\p{L}\p{N}_'’-])/gu;
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    tokens.push({
      space: match[1] || '',
      val: match[2],
      isNewline: /^\n+$/.test(match[2]),
      isPunct: !/^\n+$/.test(match[2]) && !/^[\p{L}\p{N}_'’-]+$/u.test(match[2])
    });
  }
  return tokens;
}

function computeWordDiff(originalText, correctedText) {
  const origTokens = tokenizeWithLeadingSpace(originalText);
  const corrTokens = tokenizeWithLeadingSpace(correctedText);
  const n = origTokens.length;
  const m = corrTokens.length;

  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (origTokens[i].val === corrTokens[j].val) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const rawOps = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (origTokens[i].val === corrTokens[j].val) {
      rawOps.push({ type: 'equal', token: corrTokens[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rawOps.push({ type: 'del', token: origTokens[i] });
      i++;
    } else {
      rawOps.push({ type: 'ins', token: corrTokens[j] });
      j++;
    }
  }
  while (i < n) {
    rawOps.push({ type: 'del', token: origTokens[i++] });
  }
  while (j < m) {
    rawOps.push({ type: 'ins', token: corrTokens[j++] });
  }

  const blocks = [];
  let idx = 0;
  while (idx < rawOps.length) {
    if (rawOps[idx].type === 'equal') {
      blocks.push({
        type: 'equal',
        tokens: [rawOps[idx].token]
      });
      idx++;
    } else {
      const delTokens = [];
      const insTokens = [];
      while (idx < rawOps.length && rawOps[idx].type !== 'equal') {
        if (rawOps[idx].type === 'del') {
          delTokens.push(rawOps[idx].token);
        } else {
          insTokens.push(rawOps[idx].token);
        }
        idx++;
      }
      blocks.push({
        type: 'change',
        delTokens,
        insTokens
      });
    }
  }

  return blocks;
}

function joinTokensText(tokens, includeFirstLeadingSpace = false) {
  return tokens
    .map((t, idx) => (idx === 0 && !includeFirstLeadingSpace ? '' : t.space) + t.val)
    .join('');
}

function buildDiffHtml(originalText, correctedText, mode = 'wavy') {
  const blocks = computeWordDiff(originalText, correctedText);
  let changeCount = 0;

  const htmlParts = blocks.map(block => {
    if (block.type === 'equal') {
      const t = block.tokens[0];
      return safeEscapeHtml(t.space + t.val);
    }

    changeCount++;
    const delStr = joinTokensText(block.delTokens, false);
    const insStr = joinTokensText(block.insTokens, false);

    const leadingSpace = block.insTokens.length > 0
      ? block.insTokens[0].space
      : (block.delTokens.length > 0 ? block.delTokens[0].space : '');

    const dataAttrs = `data-diff-del="${safeEscapeHtml(delStr.toLowerCase())}" data-diff-ins="${safeEscapeHtml(insStr.toLowerCase())}"`;

    if (mode === 'wavy') {
      if (!insStr) {
        return '';
      }
      return `${safeEscapeHtml(leadingSpace)}<span class="diff-wavy-added proofread-diff-span" ${dataAttrs}>${safeEscapeHtml(insStr)}</span>`;
    } else {
      let chunk = safeEscapeHtml(leadingSpace);
      if (delStr) {
        chunk += `<span class="diff-inline-del proofread-diff-span" ${dataAttrs}>${safeEscapeHtml(delStr)}</span>`;
      }
      if (insStr) {
        chunk += `<span class="diff-inline-ins proofread-diff-span" ${dataAttrs}>${safeEscapeHtml(insStr)}</span>`;
      }
      return chunk;
    }
  });

  return {
    html: htmlParts.join(''),
    changeCount
  };
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
  const snapshot = {
    originalText: currentProofreadState.originalText,
    draftInputText: inputEl ? inputEl.value : currentProofreadState.originalText,
    detectedLanguage: currentProofreadState.detectedLanguage,
    summary: currentProofreadState.summary,
    activeStyle: currentProofreadState.activeStyle,
    variants: currentProofreadState.variants,
    appliedRules: currentProofreadState.appliedRules,
    displayMode: currentProofreadState.displayMode,
    strictC1C2: currentProofreadState.strictC1C2,
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
  currentProofreadState.originalText = typeof saved.originalText === 'string' ? saved.originalText : '';
  currentProofreadState.detectedLanguage = saved.detectedLanguage || 'uk';
  currentProofreadState.summary = saved.summary || '';
  currentProofreadState.activeStyle = PROOFREAD_STYLE_META[saved.activeStyle] ? saved.activeStyle : 'default';
  currentProofreadState.variants = normalizeVariantsObject({ variants: saved.variants }, currentProofreadState.originalText);
  currentProofreadState.appliedRules = Array.isArray(saved.appliedRules) ? saved.appliedRules : [];
  currentProofreadState.displayMode = saved.displayMode === 'inline' ? 'inline' : 'wavy';
  if (typeof saved.strictC1C2 === 'boolean') {
    currentProofreadState.strictC1C2 = saved.strictC1C2;
  }
  currentProofreadState.usedOfflineFallback = Boolean(saved.usedOfflineFallback);

  if (inputEl) {
    inputEl.value = typeof saved.draftInputText === 'string'
      ? saved.draftInputText
      : currentProofreadState.originalText;
  }
  renderProofreadView();
  return true;
}

function selectProofreadStyle(styleKey) {
  if (!PROOFREAD_STYLE_META[styleKey]) return;
  currentProofreadState.activeStyle = styleKey;
  persistProofreadSession();
  renderProofreadView();
}

function renderProofreadView() {
  const resultBoxEl = document.getElementById('proofreadResultBox');
  const rulesContainerEl = document.getElementById('proofreadRulesContainer');
  const badgeCountEl = document.getElementById('proofreadChangesCountBadge');
  const summaryEl = document.getElementById('proofreadSummaryText');
  const styleNoteEl = document.getElementById('proofreadStyleNote');
  const btnModeWavy = document.getElementById('btnDiffModeWavy');
  const btnModeInline = document.getElementById('btnDiffModeInline');
  const btnToggleCam = document.getElementById('btnToggleCamC1C2');
  const runBtn = document.getElementById('btnRunProofread');

  if (!resultBoxEl || !rulesContainerEl) return;

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
      runBtn.textContent = '⏳ Генерую 4 стилі (Interactions API)...';
    }
    resultBoxEl.innerHTML = `<span class="text-slate-400 italic text-xs">ШІ перевіряє текст та готує варіанти Default / Short / Formal / Corp в 1 запит...</span>`;
    return;
  }

  if (runBtn) {
    runBtn.disabled = false;
    runBtn.textContent = '🔍 Перевірити та виправити';
  }

  const orig = currentProofreadState.originalText || '';
  const activeVar = getActiveVariantObject();
  const corr = activeVar.text || orig;

  const { html, changeCount } = buildDiffHtml(orig, corr, currentProofreadState.displayMode);
  resultBoxEl.innerHTML = html || '<span class="text-slate-500 italic">Немає тексту для відображення</span>';

  const styleMeta = PROOFREAD_STYLE_META[currentProofreadState.activeStyle] || PROOFREAD_STYLE_META.default;
  if (styleNoteEl) {
    styleNoteEl.innerHTML = `<b class="text-sky-300">${safeEscapeHtml(styleMeta.badge)}:</b> ${safeEscapeHtml(activeVar.note || styleMeta.defaultNote)}`;
  }

  if (badgeCountEl) {
    const countToShow = currentProofreadState.activeStyle === 'default'
      ? (currentProofreadState.appliedRules.length || changeCount)
      : changeCount;
    badgeCountEl.textContent = countToShow > 0 ? `${countToShow} змін (${styleMeta.label})` : 'Без змін ✓';
    badgeCountEl.className = countToShow > 0
      ? 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-950 text-sky-300 border border-sky-700/70'
      : 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-700/70';
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
  if (rules.length === 0) {
    rulesContainerEl.innerHTML = `
      <div class="bg-slate-900/70 border border-slate-800 rounded-xl p-3 text-center text-[11px] text-emerald-300">
        ✨ Текст написаний грамотно! Жодних граматичних чи пунктуаційних виправлень не знадобилося.
      </div>
    `;
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
  currentProofreadState.isLoading = true;
  renderProofreadView();

  try {
    const res = await callGeminiProofreadApi(textToFix);
    currentProofreadState.detectedLanguage = res.detected_language || 'uk';
    currentProofreadState.summary = res.summary || '';
    currentProofreadState.variants = res.variants;
    currentProofreadState.appliedRules = res.applied_rules || [];
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
    currentProofreadState.summary = `❌ Помилка API: ${errMsg}`;
    currentProofreadState.variants = normalizeVariantsObject({ corrected_text: textToFix }, textToFix);
    currentProofreadState.appliedRules = [];
    currentProofreadState.usedOfflineFallback = false;
    notifyProofreadToast(`❌ ${errMsg}`);
  } finally {
    currentProofreadState.isLoading = false;
    persistProofreadSession();
    renderProofreadView();
  }
}

function applyInitialProofreadData(presetText) {
  const inputEl = document.getElementById('proofreadOriginalInput');
  if (!inputEl) return;
  inputEl.value = presetText;
  const initialResult = simulateProofreadPipeline(presetText);
  currentProofreadState.originalText = presetText;
  currentProofreadState.detectedLanguage = initialResult.detected_language;
  currentProofreadState.summary = initialResult.summary;
  currentProofreadState.variants = normalizeVariantsObject(initialResult, presetText);
  currentProofreadState.appliedRules = initialResult.applied_rules;
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

  document.getElementById('btnClearOriginal')?.addEventListener('click', () => {
    inputEl.value = '';
    persistProofreadSession();
    inputEl.focus();
  });

  inputEl.addEventListener('input', () => {
    persistProofreadSession();
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
        extModelSelect.value = 'gemini-3.8-flash';
        localStorage.setItem('chomuchka_ext_model', 'gemini-3.8-flash');
      }
    } catch (e) {}
    extModelSelect.addEventListener('change', () => {
      const m = isDeprecatedGeminiModel(extModelSelect.value) ? 'gemini-3.8-flash' : extModelSelect.value;
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
    const activeVar = getActiveVariantObject();
    const textToCopy = activeVar.text || inputEl.value.trim();
    if (!textToCopy) return;
    const styleLabel = PROOFREAD_STYLE_META[currentProofreadState.activeStyle]?.label || '';
    try {
      await navigator.clipboard.writeText(textToCopy);
      notifyProofreadToast(`📋 Скопійовано варіант «${styleLabel}» у буфер обміну!`);
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
  const extGrabBtn = document.getElementById('btnGrabPageSelection');
  const inputEl = document.getElementById('proofreadOriginalInput');

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
            'pendingProofreadText'
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
        notifyProofreadToast('📥 Виділений текст вставлено в «Оригінал» — натисніть Перевірити або Ctrl+Enter');
      } catch (err) {
        notifyProofreadToast('Вставте текст у поле «Оригінал» через Ctrl+V');
      }
    });
  }

  // Listen for live right-click context menu selections while Side Panel is already open
  if (isChromeExtensionEnv() && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'PROOFREAD_SELECTION' && typeof msg.text === 'string' && msg.text.trim()) {
        const inputEl = document.getElementById('proofreadOriginalInput');
        if (inputEl) {
          inputEl.value = msg.text.trim();
          persistProofreadSession();
          inputEl.focus();
        }
        notifyProofreadToast('📥 Текст вставлено в «Оригінал» — натисніть Перевірити або Ctrl+Enter');
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

