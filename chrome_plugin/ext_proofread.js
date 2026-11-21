// =========================================================================
// SINGLE-QUERY MULTI-STYLE PROMPT & SIMULATION FALLBACK
// =========================================================================

function buildProofreadSystemInstruction(strictC1C2 = true, quickMode = true) {
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

  if (quickMode) {
    const compactC1C2Rule = strictC1C2
      ? 'Apply strict Cambridge C1/C2 (CAE/CPE) grammar: Unreal Past (It\'s time we left, I\'d rather you didn\'t, wish/if only), Modal Idioms (had better = urgent warning vs would rather / would just as soon = preference, needn\'t have done), Mandative Subjunctive (suggest that smb do), Inversion (Hardly had I..., Not until... did I), Mixed/Inverted Conditionals, Prepositional to+V-ing, Participle alignment, Despite (no "of"), Extreme adjectives (absolutely exhausted), and Slavic/Ukrainian L1 preposition/collocation fixes.'
      : 'Fix grammar, spelling, punctuation, and natural wording while keeping the author\'s original tone.';

    return `You are an ultra-fast expert proofreader and editor.
Fix all errors in the text while preserving its original language, tone, and structure.
${compactC1C2Rule}
Return ONLY compact JSON: {"detected_language":"uk|en|ru|other","corrected_text":"..."}
Never translate the text or add commentary.`;
  }

  return `Ти — професійний лінгвіст-редактор${strictC1C2 ? ', екзаменатор рівня Cambridge C1/C2 (CAE/CPE)' : ''} та коректор (рівень Grammarly Pro / LanguageTool для української, англійської та інших мов).
Твоє завдання — за ОДИН запит:
1. Виправити всі граматичні, орфографічні, пунктуаційні, лексичні та семантико-граматичні помилки в оригінальному тексті.${cambridgeTaxonomyBlock}
3. Згенерувати базове виправлення ("default" = Стандарт) та 3 додаткові стилістичні варіанти ("short", "formal", "corp") тією самою мовою, якою написано оригінал:
   - "default": стандартне виправлення всіх знайдених помилок зі збереженням початкового тону та структури автора.
   - "short": лаконічний, стислий варіант (без зайвих слів і води, максимум суті).
   - "formal": офіційно-діловий, ввічливий та виважений тон.
   - "corp": сучасний корпоративний стиль для робочих месенджерів (Slack, Teams, Jira) або ділових листів.

Поверни ВИКЛЮЧНО валідний JSON-об'єкт:
{
  "detected_language": "uk" | "en" | "ru" | "other",
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
1. Не змінюй мову самого тексту: якщо оригінал англійською — усі 4 тексти в "variants" мають бути англійською; якщо українською — українською. Усі нотатки (note) ЗАВЖДИ пиши українською мовою.
2. КАТЕГОРИЧНО ЗАБОРОНЕНО дублювати привітання чи звертання (наприклад, ніколи не пиши "Hi team — Hi team," або "Please note: Hi team,"). Якщо в оригіналі вже є привітання ("Hi team,"), органічно заміни або інтегруй його відповідно до стилю.`;
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

// Styles Mode Schema (Стандарт + 3 extra styles: Short / Formal / Corp, without heavy rules)
const PROOFREAD_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    detected_language: { type: 'string' },
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
  required: ['detected_language', 'variants']
};

// Ultra-Lean Instant Standard (Fast) Mode Schema (only corrected_text — ~90% fewer output tokens, sub-second response)
const QUICK_PROOFREAD_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    detected_language: { type: 'string' },
    corrected_text: { type: 'string' }
  },
  required: ['detected_language', 'corrected_text']
};

// On-Demand Rules & Grammar Explanation Schema (triggered by "📚 Поясни правила" / "🧬 Поясни граматику" buttons)
const EXPLAIN_RULES_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
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
  required: ['summary', 'applied_rules', 'grammar_explanation']
};

function buildExplainRulesSystemInstruction(strictC1C2 = true) {
  return `Ти — професійний лінгвіст-викладач${strictC1C2 ? ' та екзаменатор Cambridge C1/C2 (CAE/CPE)' : ''}.
Порівняй текст "ОРИГІНАЛ" та "ВИПРАВЛЕНИЙ ТЕКСТ":
1. У масиві "applied_rules" поясни українською мовою кожне граматичне, пунктуаційне, орфографічне або стилістичне правило, яке було застосовано (якщо виправлень не було — поверни порожній масив []).
2. В об'єкті "grammar_explanation" дай повний граматичний і синтаксичний розбір "ВИПРАВЛЕНОГО ТЕКСТУ" (sentence_type, syntax_formula, tense_and_mood та 3–5 ключових конструкцій у масиві items).
Поверни ВИКЛЮЧНО валідний JSON за схемою.`;
}

async function fetchWithAttemptTimeout(url, options, timeoutMs, externalSignal = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(new Error('Час очікування відповіді від моделі вичерпано (таймаут)')),
    timeoutMs
  );
  const onExternalAbort = () => controller.abort(new Error('Запит скасовано'));
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      throw new Error('Запит скасовано');
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError' || String(err?.message || '').includes('aborted')) {
      throw new Error('Час очікування відповіді вичерпано — спробуйте ще раз або оберіть ⚡ Швидкий режим');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

function getFastThinkingLevelForModel(modelId) {
  const id = String(modelId || '');
  // Official docs: *-lite and gemini-3.6-flash support 'minimal'; gemini-3.8-flash & gemini-4-argon require 'low'
  if (id.includes('lite') || id === 'gemini-3.6-flash') return 'minimal';
  return 'low';
}

function buildInteractionsRequestBody(modelId, sysInstruction, userPrompt, jsonSchema, previousInteractionId = null) {
  return JSON.stringify({
    model: modelId,
    store: Boolean(previousInteractionId), ...(previousInteractionId ? { previous_interaction_id: previousInteractionId } : {}),
    system_instruction: sysInstruction,
    input: userPrompt,
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: jsonSchema
    },
    generation_config: {
      thinking_level: getFastThinkingLevelForModel(modelId),
      thinking_summaries: 'none'
    }
  });
}

function buildGenerateContentFallbackBody(modelId, sysInstruction, userPrompt, includeThinking = true) {
  const generationConfig = {
    responseMimeType: 'application/json'
  };
  if (includeThinking) {
    generationConfig.thinkingConfig = {
      thinkingLevel: getFastThinkingLevelForModel(modelId).toUpperCase()
    };
  }
  return JSON.stringify({
    systemInstruction: { parts: [{ text: sysInstruction }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig
  });
}

const cachedProofreadEndpointByModel = {};

async function callGeminiProofreadApi(originalText, signal = null) {
  const apiKey = getProofreadApiKey();
  const strictMode = currentProofreadState.strictC1C2 !== false;
  const isQuick = currentProofreadState.quickMode !== false;

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

  const allModels = getProofreadModelCandidates();
  // Always honor the exact model selected in the dropdown (no silent fallback to another model)
  const modelsToTry = [allModels[0]];
  const modelErrors = [];
  const sysInstruction = buildProofreadSystemInstruction(strictMode, isQuick);
  const perCallTimeoutMs = isQuick ? 12000 : 25000;

  const modeHeader = strictMode
    ? '[CAMBRIDGE C1/C2 STRICT]'
    : '[STANDARD PROOFREAD]';

  const userPrompt = isQuick
    ? `${modeHeader}\nFix all errors and return ONLY JSON {"detected_language":"...","corrected_text":"..."}:\n\n"""\n${originalText}\n"""`
    : `${modeHeader}\nFix text in default style and generate short, formal, corp in JSON {"detected_language":"...","variants":{...}}:\n\n"""\n${originalText}\n"""`;

  for (const modelId of modelsToTry) {
    if (signal && signal.aborted) break;

    try {
      const startedAt = performance.now();
      const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const cachedMode = cachedProofreadEndpointByModel[modelId];
      let usedMode = cachedMode || 'generateContent';

      // Direct single-hop :generateContent call (eliminates /v1beta/interactions 400 double-hop latency)
      let response = await fetchWithAttemptTimeout(
        generateUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: buildGenerateContentFallbackBody(
            modelId,
            sysInstruction,
            userPrompt,
            usedMode !== 'generateContent_plain'
          )
        },
        perCallTimeoutMs,
        signal
      );

      // If this model rejects thinkingConfig with 400, retry once without thinkingConfig and cache it
      if (!response.ok && response.status === 400 && usedMode !== 'generateContent_plain') {
        usedMode = 'generateContent_plain';
        response = await fetchWithAttemptTimeout(
          generateUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: buildGenerateContentFallbackBody(modelId, sysInstruction, userPrompt, false)
          },
          perCallTimeoutMs,
          signal
        );
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

      cachedProofreadEndpointByModel[modelId] = usedMode;
      const data = await response.json();
      const parsed = extractGeminiJsonObject(data);
      const variants = normalizeVariantsObject(parsed, originalText);
      const grammarExplanation = normalizeGrammarExplanationObject(parsed.grammar_explanation);
      const elapsedSec = ((performance.now() - startedAt) / 1000).toFixed(2);

      return {
        detected_language: parsed.detected_language || 'uk',
        summary: parsed.summary || '',
        variants,
        applied_rules: Array.isArray(parsed.applied_rules) ? parsed.applied_rules : [],
        grammar_explanation: grammarExplanation,
        elapsedSec,
        modelId,
        usedOfflineFallback: false
      };
    } catch (err) {
      const errText = err?.message || 'помилка';
      modelErrors.push(`${modelId}: ${errText}`);
      // Fail fast on auth/bad-request/timeout instead of burning another 12-25s on extra models
      if (/HTTP (400|401|403)\b|таймаут|вичерпано/i.test(errText)) break;
    }
  }

  throw new Error(modelErrors[0] || 'Не вдалося виконати запит до Gemini API');
}

async function callGeminiExplainRulesApi(originalText, correctedText) {
  const apiKey = getProofreadApiKey();
  if (!apiKey) {
    const sim = simulateProofreadPipeline(originalText);
    return {
      summary: sim.summary || '',
      applied_rules: Array.isArray(sim.applied_rules) ? sim.applied_rules : [],
      grammar_explanation: normalizeGrammarExplanationObject(sim.grammar_explanation)
    };
  }

  const strictMode = currentProofreadState.strictC1C2 !== false;
  const sysInstruction = buildExplainRulesSystemInstruction(strictMode);
  const userPrompt = `ОРИГІНАЛ:\n"""\n${originalText}\n"""\n\nВИПРАВЛЕНИЙ ТЕКСТ:\n"""\n${correctedText}\n"""\n\nПоясни кожне застосоване правило між оригіналом і виправленим текстом у масиві applied_rules та дай граматичний розбір речення у grammar_explanation.`;
  const modelsToTry = getProofreadModelCandidates();
  const modelErrors = [];

  for (const modelId of modelsToTry) {
    try {
      const interactionsUrl = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(apiKey)}`;
      let response = await fetchWithAttemptTimeout(
        interactionsUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
            'Api-Revision': '2026-05-20'
          },
          body: buildInteractionsRequestBody(modelId, sysInstruction, userPrompt, EXPLAIN_RULES_JSON_SCHEMA)
        },
        24000
      );

      if (!response.ok && (response.status === 404 || response.status === 400)) {
        const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        response = await fetchWithAttemptTimeout(
          generateUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: buildGenerateContentFallbackBody(modelId, sysInstruction, userPrompt)
          },
          24000
        );
      }

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
        summary: parsed.summary || '',
        applied_rules: Array.isArray(parsed.applied_rules) ? parsed.applied_rules : [],
        grammar_explanation: normalizeGrammarExplanationObject(parsed.grammar_explanation)
      };
    } catch (err) {
      modelErrors.push(`${modelId}: ${err.message || 'помилка'}`);
    }
  }

  throw new Error(modelErrors[0] || 'Не вдалося згенерувати пояснення правил');
}
