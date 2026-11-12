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
5. Заповни об'єкт "grammar_explanation" — ПОВНИЙ граматичний та синтаксичний розбір речення (або речень) на основі граматично правильного варіанта ("default"):
   - "sentence_type": тип речення за структурою та метою висловлювання (просте ускладнене, складносурядне, складнопідрядне, умовне тощо) та його загальна будова.
   - "syntax_formula": наочна структурна формула речення (напр., "[Main Clause: Subject + Present Perfect] + [Conjunction: and] + [Clause 2: Subject + Modal + Infinitive + Object + Time Adverbial]").
   - "tense_and_mood": детальний аналіз часових форм, виду, стану та способу дієслів (Tense, Aspect, Voice, Mood) і чому саме вони тут вживаються.
   - "items": масив усіх граматичних конструкцій, членів речення та правил, з яких побудовано це речення (навіть якщо в реченні не було помилок, обов'язково розбери 3–6 ключових граматичних конструкцій цього речення: підмет і присудок, часову форму, модальні конструкції, керування дієслів/прийменників, підрядні частини, звороти).

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
  },
  "grammar_explanation": {
    "sentence_type": "тип і синтаксична характеристика речення українською мовою",
    "syntax_formula": "структурна схема / формула речення",
    "tense_and_mood": "пояснення часів, виду, стану та способу дієслів у реченні",
    "items": [
      {
        "fragment": "точна конструкція або словосполучення з речення",
        "grammar_role": "синтаксична роль або граматична категорія (напр., Subject + Present Perfect, Modal Idiom, Conditional Clause, Кличний відмінок)",
        "rule_title": "назва граматичного правила або конструкції українською мовою",
        "explanation": "детальне пояснення українською мовою: як працює ця граматична конструкція, її формула та роль у реченні"
      }
    ]
  }
}

ВАЖЛИВІ ПРАВИЛА:
1. Не змінюй мову самого тексту: якщо оригінал англійською — усі 4 тексти в "variants" мають бути англійською; якщо українською — українською. Усі пояснення (summary, note, rule_title, explanation, grammar_explanation) ЗАВЖДИ пиши українською мовою.
2. Кожна помилка між оригіналом і variants.default.text повинна мати запис у масиві applied_rules.
3. Об'єкт grammar_explanation ЗАВЖДИ має містити повний розбір структури речення та не менше 3–5 детальних елементів у масиві items, навіть якщо в реченні не було жодної помилки.
4. КАТЕГОРИЧНО ЗАБОРОНЕНО дублювати привітання чи звертання (наприклад, ніколи не пиши "Hi team — Hi team," або "Please note: Hi team,"). Якщо в оригіналі вже є привітання ("Hi team,"), органічно заміни або інтегруй його відповідно до стилю.`;
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
      ],
      grammar_explanation: {
        sentence_type: 'Складнопідрядне питальне речення зі з’ясувальною підрядною частиною, ускладнене звертанням («Олено»), вставною сполукою («будь ласка») та однорідними непрямими додатками.',
        syntax_formula: '[Привітання + Звертання (Кл. в.)] + [Головна частина: Наказовий спосіб V + Вставна сполука] + [Підрядна з’ясувальна: сполучна частка «чи» + Безособовий предикатив + Д. в. + Інфінітив + Зн. в. + Однорідні означення в Р. в.]',
        tense_and_mood: 'Головна частина — наказовий спосіб дієслова доконаного виду 2-ї особи множини («Підкажіть»); підрядна частина — безособово-предикативна конструкція модальності («потрібно брати») у теперішньому часі.',
        items: [
          {
            fragment: 'Привіт, Олено!',
            grammar_role: 'Вокативне речення / Звертання (Кличний відмінок)',
            rule_title: 'Кличний відмінок іменників І відміни твердих груп (-о)',
            explanation: 'Іменники І відміни твердої групи (Олена) у кличному відмінку однини мають закінчення -о («Олено») і відокремлюються комою від вигукового слова привітання.'
          },
          {
            fragment: 'Підкажіть, будь ласка,',
            grammar_role: 'Головна частина ( присудок у наказовому способі + вставна конструкція)',
            rule_title: 'Односкладне означено-особове речення з ввічливим імперативом',
            explanation: 'Дієслово «підкажіть» виступає головним членом означено-особового речення (форма 2-ї особи множини для ввічливого звертання), ускладненого етикетною вставною сполукою «будь ласка».'
          },
          {
            fragment: 'чи потрібно дитині брати два зошити',
            grammar_role: 'Підрядна з’ясувальна частина (Subordinate Object Clause)',
            rule_title: 'Безособова предикативна конструкція «потрібно + інфінітив» + давальний суб’єкта',
            explanation: 'Підрядна частина приєднується питальною часткою-сполучником «чи». Граматичний центр — предикативне слово «потрібно» в поєднанні з інфінітивом «брати», при якому логічний суб’єкт стоїть у давальному відмінку («дитині»), а прямий додаток — у знахідному («два зошити»).'
          },
          {
            fragment: 'на завтрашній урок малювання, ліплення або аплікації',
            grammar_role: 'Обставина мети/часу + Однорідні неузгоджені означення',
            rule_title: 'Керування прийменника «на» + Зн. в. та ряд однорідних іменників у Р. в.',
            explanation: 'Прийменниково-іменникова група «на завтрашній урок» керує низкою однорідних іменників у родовому відмінку («малювання, ліплення або аплікації»), поєднаних безсполучниково та розділовим сполучником «або».'
          }
        ]
      }
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
      ],
      grammar_explanation: {
        sentence_type: 'Compound Sentence (складносурядне речення з двох незалежних частин, з’єднаних сурядним сполучником "and").',
        syntax_formula: '[Clause 1: Compound Subject (Alex and I) + Present Perfect (have prepared) + Direct Object + Prep. Phrase (for the kids)] + [, and] + [Clause 2: Subject (we) + Modal Expression (would like) + Infinitive Phrase (to discuss them) + Time Adverbial (tomorrow morning)]',
        tense_and_mood: 'Clause 1: Present Perfect Active ("have prepared") — підкреслює наявний результат завершеної дії на теперішній момент. Clause 2: Modal Polite Desire ("would like to discuss") — ввічливе вираження наміру та побажання щодо майбутньої дії.',
        items: [
          {
            fragment: 'Alex and I have prepared',
            grammar_role: 'Compound Subject + Present Perfect Active Predicate',
            rule_title: 'Узгодження складеного підмета (N + and + Subject Pronoun "I") з Present Perfect',
            explanation: 'Складений підмет "Alex and I" завжди граматично дорівнює множині ("we"), тому допоміжне дієслово у Present Perfect має форму "have" + Past Participle (V3 "prepared"). Займенник першої особи ставиться на друге місце за правилом ввічливості.'
          },
          {
            fragment: 'three new learning games for the kids',
            grammar_role: 'Direct Object (Noun Phrase) + Prepositional Beneficiary Phrase',
            rule_title: 'Порядок слів в іменниковій групі (Determiner + Adjective + Noun Adjunct + Head Noun)',
            explanation: 'В англійській іменниковій групі числівник ("three") стоїть перед оцінним прикметником ("new") та класифікуючим означенням ("learning"), які описують головний іменник ("games"). Прийменник "for" вказує на адресата/отримувача.'
          },
          {
            fragment: 'and we would like to discuss them',
            grammar_role: 'Coordinated Independent Clause + Verb Pattern (would like + to-infinitive)',
            rule_title: 'Конструкція "would like + to V1" та прямоперехідне дієслово "discuss"',
            explanation: 'Після "would like" завжди вживається повний інфінітив з часткою "to" ("to discuss"). Саме дієслово "discuss" є прямоперехідним (transitive verb) і приєднує прямий додаток ("them") без жодного прийменника.'
          },
          {
            fragment: 'tomorrow morning',
            grammar_role: 'Adverbial Modifier of Time (Обставина часу)',
            rule_title: 'Безприйменникове вживання дейктичних обставин часу (tomorrow / today / yesterday)',
            explanation: 'Складені обставини часу зі словами "tomorrow", "today", "yesterday", "next", "last", "this" приєднуються до дієслова напряму без прийменників "on" або "in".'
          }
        ]
      }
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
      ],
      grammar_explanation: {
        sentence_type: 'Просте двоскладне поширене розповідне речення (Simple Extended Declarative Sentence).',
        syntax_formula: '[Обставина часу: Учора протягом дня] + [Підмет: ми] + [Присудок: вивчали (Past Imperfective)] + [Прямий додаток із означенням: найцікавіші факти] + [Непрямий додаток: про наявних морських тварин]',
        tense_and_mood: 'Дієслово-присудок «вивчали» стоїть у дійсному способі минулого часу недоконаного виду (множина) — передає тривалий процес дії, що відбувався впродовж певного часового проміжку в минулому.',
        items: [
          {
            fragment: 'Учора протягом дня',
            grammar_role: 'Обставина часу (прислівник + прийменникова сполука з Р. в.)',
            rule_title: 'Похідний прийменник часу «протягом / впродовж» + родовий відмінок',
            explanation: 'Похідні прийменники «протягом» і «впродовж» завжди керують родовим відмінком іменника («протягом дня / року / тижня») і позначають часову тривалість.'
          },
          {
            fragment: 'ми вивчали',
            grammar_role: 'Граматична основа речення (Підмет + Простий дієслівний присудок)',
            rule_title: 'Узгодження особового займенника 1-ї особи множини з дієсловом минулого часу',
            explanation: 'У минулому часі українські дієслова змінюються за родами в однині та мають спільне закінчення -и у множині («ми вивчали»). Недоконаний вид узгоджується з обставиною тривалості «протягом дня».'
          },
          {
            fragment: 'найцікавіші факти',
            grammar_role: 'Узгоджене означення (найвищий ступінь) + Прямий додаток (Зн. в.)',
            rule_title: 'Проста форма найвищого ступеня порівняння якісних прикметників',
            explanation: 'Проста форма найвищого ступеня утворюється додаванням префікса най- до форми вищого ступеня («цікавіші» → «найцікавіші») і узгоджується з іменником «факти» у знахідному відмінку множини.'
          },
          {
            fragment: 'про наявних морських тварин',
            grammar_role: 'Непрямий додаток із узгодженими означеннями (Прийменник «про» + Зн. в.)',
            rule_title: 'Керування прийменника «про» та категорія істоти у знахідному відмінку множини',
            explanation: 'Прийменник «про» вимагає знахідного відмінка; оскільки іменник «тварини» належить до категорії істот, у знахідному відмінку множини його форма збігається з родовим відмінком («наявних морських тварин»).'
          }
        ]
      }
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
      ],
      grammar_explanation: {
        sentence_type: 'Complex Conditional Sentence (складнопідрядне речення з підрядним умови 1-го типу та модальною ідіомою переваги у головній частині).',
        syntax_formula: "[Main Clause: Subject (I) + Modal Idiom ('d just as soon / 'd rather) + Bare Infinitive (skip) + Direct Object (the meeting)] + [Conditional Clause: if + Subject (it) + Present Simple Copula ('s not) + Predicative Adjective (essential)]",
        tense_and_mood: "Головна частина: Modal Preference ('d just as soon + V1) — виражає особисте бажання щодо теперішньої/майбутньої ситуації. Підрядна частина: Present Simple ('is not') після умовного сполучника 'if' для реальної умови.",
        items: [
          {
            fragment: "I'd just as soon skip",
            grammar_role: 'Subject + Modal Idiom of Preference + Bare Infinitive (V1)',
            rule_title: "Конструкція «would just as soon / would rather + bare infinitive» (рівень C1/C2)",
            explanation: "Коли підмет головної дії не змінюється (мовець каже про власну дію), після модальних ідіом переваги «would rather / would sooner / would just as soon» завжди вживається голий інфінітив без частки 'to' ('skip')."
          },
          {
            fragment: 'the meeting',
            grammar_role: 'Direct Object (Definite Noun Phrase)',
            rule_title: 'Визначений артикль «the» перед конкретною відомою співрозмовникам подією',
            explanation: 'Артикль "the" вказує на конкретну зустріч, про яку вже знають обидва учасники діалогу.'
          },
          {
            fragment: "if it's not essential",
            grammar_role: 'Subordinate Conditional Clause (Real Condition)',
            rule_title: 'Підрядне речення реальної умови (if + Present Simple) з граничним прикметником',
            explanation: 'У підрядних реченнях реальної умови після "if" вживається Present Simple ("it is not"), навіть коли мова йде про майбутню зустріч. Прикметник "essential" (критично важливий, обов’язковий) логічно задає необов’язковість присутності.'
          }
        ]
      }
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
    applied_rules: [],
    grammar_explanation: {
      sentence_type: '🔑 Потрібен ключ Gemini API для повного граматичного аналізу довільних речень.',
      syntax_formula: 'Введіть ключ AIza... у верхньому блоці «🔑 Gemini API та модель» і натисніть «Зберегти».',
      tense_and_mood: 'Після підключення ключа натисніть «🔍 Перевірити та виправити», щоб отримати повний синтаксичний і граматичний розбір будь-якого речення.',
      items: []
    }
  };
}

function normalizeGrammarExplanationObject(rawGrammar) {
  const g = rawGrammar && typeof rawGrammar === 'object' ? rawGrammar : {};
  return {
    sentence_type: typeof g.sentence_type === 'string' ? g.sentence_type.trim() : '',
    syntax_formula: typeof g.syntax_formula === 'string' ? g.syntax_formula.trim() : '',
    tense_and_mood: typeof g.tense_and_mood === 'string' ? g.tense_and_mood.trim() : '',
    items: Array.isArray(g.items)
      ? g.items.map(it => ({
          fragment: typeof it?.fragment === 'string' ? it.fragment.trim() : '',
          grammar_role: typeof it?.grammar_role === 'string' ? it.grammar_role.trim() : 'Граматична конструкція',
          rule_title: typeof it?.rule_title === 'string' ? it.rule_title.trim() : 'Граматичне правило',
          explanation: typeof it?.explanation === 'string' ? it.explanation.trim() : ''
        }))
      : []
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
// so the model performs its C1/C2 grammatical audit before writing the corrected text,
// followed by `grammar_explanation` in the same 1-query response.
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
    },
    grammar_explanation: {
      type: 'object',
      properties: {
        sentence_type: { type: 'string' },
        syntax_formula: { type: 'string' },
        tense_and_mood: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              fragment: { type: 'string' },
              grammar_role: { type: 'string' },
              rule_title: { type: 'string' },
              explanation: { type: 'string' }
            },
            required: ['fragment', 'grammar_role', 'rule_title', 'explanation']
          }
        }
      },
      required: ['sentence_type', 'syntax_formula', 'tense_and_mood', 'items']
    }
  },
  required: ['detected_language', 'applied_rules', 'summary', 'variants', 'grammar_explanation']
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
      grammar_explanation: normalizeGrammarExplanationObject(sim.grammar_explanation),
      usedOfflineFallback: true
    };
  }

  const modelsToTry = getProofreadModelCandidates();
  const deadline = Date.now() + 24000;
  const modelErrors = [];
  const sysInstruction = buildProofreadSystemInstruction(strictMode);
  const modeHeader = strictMode
    ? '[РЕЖИМ: CAMBRIDGE C1/C2 STRICT EXAMINER — перевір речення за всіма 12 розділами CAE/CPE Use of English (Unreal Past, Modal Idioms, Inversion, Subjunctive, Conditionals, Collocations), спочатку заповни applied_rules, потім variants, і обов’язково повний граматичний розбір речення в grammar_explanation]'
    : '[РЕЖИМ: СТАНДАРТНА КОРЕКТУРА + ПОВНИЙ ГРАМАТИЧНИЙ РОЗБІР РЕЧЕННЯ]';
  const userPrompt = `${modeHeader}\nПеревір цей текст, спочатку випиши всі застосовані правила в applied_rules, потім згенеруй всі 4 стилі (default, short, formal, corp) та повний розбір граматичної будови речення в grammar_explanation в одному JSON:\n\n"""\n${originalText}\n"""`;

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
      const grammarExplanation = normalizeGrammarExplanationObject(parsed.grammar_explanation);

      return {
        detected_language: parsed.detected_language || 'uk',
        summary: parsed.summary || '',
        variants,
        applied_rules: Array.isArray(parsed.applied_rules) ? parsed.applied_rules : [],
        grammar_explanation: grammarExplanation,
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

  if (currentProofreadState.isLoading) {
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
      <div class="bg-slate-900/70 border border-slate-800 rounded-xl p-3 text-center text-[11px] text-slate-400">
        Натисніть «🔍 Перевірити та виправити», щоб отримати повний розбір граматики та структури речення.
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

  const hasActiveSelection = Boolean(pa.selectedText && !pa.ignoreSelection);

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
      answerBoxEl.textContent = pa.answer;
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
  const summaryEl = document.getElementById('proofreadSummaryText');
  const styleNoteEl = document.getElementById('proofreadStyleNote');
  const btnModeWavy = document.getElementById('btnDiffModeWavy');
  const btnModeInline = document.getElementById('btnDiffModeInline');
  const btnToggleCam = document.getElementById('btnToggleCamC1C2');
  const runBtn = document.getElementById('btnRunProofread');

  if (!resultBoxEl || !rulesContainerEl) return;

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
      runBtn.textContent = '⏳ Генерую 4 стилі + граматику (Interactions API)...';
    }
    resultBoxEl.innerHTML = `<span class="text-slate-400 italic text-xs">ШІ перевіряє текст, будує 4 стилі та повний граматичний розбір речення в 1 запит...</span>`;
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
  if (rulesTabBadgeEl) {
    rulesTabBadgeEl.textContent = String(rules.length);
  }

  if (rules.length === 0) {
    rulesContainerEl.innerHTML = `
      <div class="bg-slate-900/70 border border-slate-800 rounded-xl p-3 text-center text-[11px] text-emerald-300">
        ✨ Текст написаний грамотно! Жодних граматичних чи пунктуаційних виправлень не знадобилося. Перейдіть на вкладку <b>🧬 Grammar explanation</b>, щоб побачити повний розбір будови речення.
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

// =========================================================================
// TAB 3: SELECTION-AWARE PAGE ASSISTANT (CONTEXT EXTRACTION & GEMINI Q&A)
// =========================================================================

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
          const bodyText = document.body ? document.body.innerText || '' : '';
          return {
            selectedText: sel.slice(0, 6000),
            title: document.title || '',
            url: location.href || '',
            charCount: bodyText.length
          };
        }
      });
      const info = results?.[0]?.result;
      if (!info) return;

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

      if (changed) {
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
    renderPageAssistantView();
  }
}

async function extractActiveTabPageContext() {
  const pa = currentProofreadState.pageAssistant;

  if (isChromeExtensionEnv() && chrome.tabs && chrome.scripting) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id && !/^(chrome|edge|about|chrome-extension):/i.test(tab.url || '')) {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const selObj = window.getSelection ? window.getSelection() : null;
            const selectedText = (selObj ? selObj.toString() : '').trim();

            // Also capture immediate surrounding paragraph/block around the selection
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

            return {
              title: document.title || '',
              url: location.href || '',
              metaDescription: metaDesc.trim(),
              selectedText: selectedText.slice(0, 6000),
              selectionSurrounding,
              headings,
              bodyText: cleanBody,
              charCount: rawBody.length
            };
          }
        });

        const ctx = results?.[0]?.result;
        if (ctx) {
          if (ctx.selectedText && ctx.selectedText !== pa.selectedText) {
            pa.selectedText = ctx.selectedText;
            pa.ignoreSelection = false;
          } else if (!ctx.selectedText && pa.selectedText && !pa.ignoreSelection) {
            // Keep previously captured selection if user clicked inside Side Panel and page lost selection focus
            ctx.selectedText = pa.selectedText;
          }
          pa.pageTitle = ctx.title || tab.title || '';
          pa.pageUrl = ctx.url || tab.url || '';
          pa.charCount = ctx.charCount || ctx.bodyText.length;
          return ctx;
        }
      }
    } catch (e) {}
  }

  // Fallback context (when opened directly or on a browser system page)
  const editorText = (document.getElementById('proofreadOriginalInput')?.value || currentProofreadState.originalText || '').trim();
  const effectiveSel = (!pa.ignoreSelection && pa.selectedText) ? pa.selectedText : '';
  return {
    title: pa.pageTitle || document.title || 'Поточна вкладка / Редактор',
    url: pa.pageUrl || location.href || '',
    metaDescription: '',
    selectedText: effectiveSel,
    selectionSurrounding: '',
    headings: [],
    bodyText: editorText || document.body?.innerText?.slice(0, 12000) || '',
    charCount: (editorText || '').length
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
    const scopeLabel = hasPrioritySelection
      ? `🎯 Пріоритетний виділений фрагмент (${activeSelection.length} симв.):\n«${activeSelection.slice(0, 350)}${activeSelection.length > 350 ? '...' : ''}»`
      : `🌐 Контекст сторінки: «${pageContext.title || 'Поточна вкладка'}» (${pageContext.bodyText.length} симв.)`;
    return {
      answered_scope: hasPrioritySelection ? 'selection' : 'page',
      answer: `🔑 Для отримання відповідей Page AI підключіть ваш Gemini API-ключ у верхньому блоці «🔑 Gemini API та модель» і натисніть «Зберегти».\n\nЩо вже успішно зчитано для вашого запиту:\n${scopeLabel}\n\nВаш запит: «${userQuestion}»`
    };
  }

  const sysInstruction = `Ти — розумний ШІ-асистент по вебсторінці (Page Assistant) у бічній панелі браузера.
Твоє завдання — дати точну, вичерпну та добре структуровану відповідь на запитання або промпт користувача на основі переданого контексту поточної сторінки.

ГОЛОВНЕ ПРАВИЛО ПРІОРИТЕТУ ВИДІЛЕНОГО ТЕКСТУ:
1. Якщо передано непорожній блок [ВИДІЛЕНИЙ КОРИСТУВАЧЕМ ТЕКСТ НА СТОРІНЦІ (НАЙВИЩИЙ ПРІОРИТЕТ)] — користувач спеціально виділив цей фрагмент мишкою! Ти ОБОВ'ЯЗКОВО маєш відповідати на запитання/промпт насамперед про цей виділений фрагмент, розбираючи саме його зміст, терміни, граматику чи питання в ньому.
2. Весь інший текст сторінки [ПОВНИЙ ТЕКСТ СТОРІНКИ (ДОПОМІЖНИЙ КОНТЕКСТ)] використовуй як фоновий контекст (щоб розуміти загальну тему статті, розшифровувати займенники чи зв'язок із сусідніми абзацами).
3. Якщо виділеного тексту немає — відповідай на запитання за всім вмістом сторінки.
4. Відповідай тією мовою, якою написано запитання користувача (за замовчуванням — українською). Використовуй зручні абзаци та списки (• або 1., 2.) для легкості читання.
5. Поверни JSON-об'єкт: { "answer": "текст відповіді", "answered_scope": "selection" | "page" }.`;

  const selectionBlock = hasPrioritySelection
    ? `\n=== 🎯 ВИДІЛЕНИЙ КОРИСТУВАЧЕМ ТЕКСТ НА СТОРІНЦІ (НАЙВИЩИЙ ПРІОРИТЕТ — ВІДПОВІДАЙ НАСАМПЕРЕД ПРО ЦЕЙ ФРАГМЕНТ) ===\n"""\n${activeSelection}\n"""\n${pageContext.selectionSurrounding ? `\n[Сусідній абзац навколо виділення]:\n"""\n${pageContext.selectionSurrounding}\n"""\n` : ''}`
    : '\n[Виділеного фрагмента немає — аналізуй усю сторінку]\n';

  const headingsBlock = Array.isArray(pageContext.headings) && pageContext.headings.length > 0
    ? `\n[Заголовки сторінки]: ${pageContext.headings.join(' | ')}\n`
    : '';

  const userPrompt = `[Сторінка]: ${pageContext.title || 'Без назви'}
[URL]: ${pageContext.url || '—'}
${pageContext.metaDescription ? `[Опис]: ${pageContext.metaDescription}\n` : ''}${headingsBlock}${selectionBlock}
=== 📄 ПОВНИЙ ТЕКСТ СТОРІНКИ (${hasPrioritySelection ? 'ДОПОМІЖНИЙ КОНТЕКСТ' : 'ОСНОВНИЙ КОНТЕКСТ'}) ===
"""
${pageContext.bodyText || '(Текст сторінки порожній)'}
"""

=== ❓ ЗАПИТАННЯ / ПРОМПТ КОРИСТУВАЧА ===
${userQuestion}`;

  const modelsToTry = getProofreadModelCandidates();
  const deadline = Date.now() + 26000;
  const modelErrors = [];

  for (const modelId of modelsToTry) {
    const remainingMs = deadline - Date.now();
    if ((signal && signal.aborted) || remainingMs < 1500) break;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), remainingMs);
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    try {
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
          response_format: PAGE_ASSISTANT_JSON_SCHEMA
        })
      });

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
      return {
        answer: (parsed.answer || '').trim() || 'Модель не повернула текст відповіді.',
        answered_scope: hasPrioritySelection ? 'selection' : (parsed.answered_scope === 'selection' ? 'selection' : 'page')
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
  pa.isLoading = true;
  renderPageAssistantView();

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
    renderPageAssistantView();
  }
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
    currentProofreadState.grammarExplanation = normalizeGrammarExplanationObject(res.grammar_explanation);
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
    currentProofreadState.grammarExplanation = normalizeGrammarExplanationObject(null);
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

  document.getElementById('btnClearOriginal')?.addEventListener('click', () => {
    inputEl.value = '';
    persistProofreadSession();
    inputEl.focus();
  });

  inputEl.addEventListener('input', () => {
    persistProofreadSession();
  });

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
    await syncActiveTabSelection(true);
    const pa = currentProofreadState.pageAssistant;
    if (pa.selectedText && !pa.ignoreSelection) {
      notifyProofreadToast(`🎯 Зчитано виділений фрагмент (${pa.selectedText.length} симв.)`);
    } else {
      notifyProofreadToast('📄 Контекст активної сторінки оновлено!');
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

  // Auto-sync live selection from the active tab when hovering/focusing Side Panel or periodically
  window.addEventListener('focus', () => syncActiveTabSelection());
  document.body?.addEventListener('mouseenter', () => syncActiveTabSelection());
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      syncActiveTabSelection();
    }
  }, 1200);

  if (isChromeExtensionEnv() && chrome.tabs) {
    chrome.tabs.onActivated?.addListener(() => syncActiveTabSelection());
    chrome.tabs.onUpdated?.addListener((_tabId, changeInfo) => {
      if (changeInfo.status === 'complete') syncActiveTabSelection();
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

