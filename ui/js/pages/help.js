'use strict';
// Довідка: what CarteLink is, how to start, what is new, keys, and what to do
// when something does not work — in plain words.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;

  const STYLE = '<style>' +
    '.pg-help .prose{color:var(--text-2);max-width:72ch}' +
    '.pg-help .prose p{margin:0 0 10px}' +
    '.pg-help .prose b{color:var(--text);font-weight:600}' +
    '.pg-help .steps{display:flex;flex-direction:column}' +
    '.pg-help .step{display:flex;gap:12px;align-items:flex-start;padding:11px 0;border-bottom:var(--border-w) solid var(--line)}' +
    '.pg-help .step:last-child{border-bottom:0}' +
    '.pg-help .step .avatar{width:28px;height:28px}' +
    '.pg-help .step .grow b{display:block;font-weight:600}' +
    '.pg-help .step .grow span{display:block;color:var(--text-2);font-size:12.5px;margin-top:2px}' +
    '.pg-help .new{display:flex;flex-direction:column;gap:9px;margin:0;padding:0;list-style:none}' +
    '.pg-help .new li{display:flex;gap:10px;align-items:flex-start;color:var(--text-2)}' +
    '.pg-help .new li .i{color:var(--accent);margin-top:2px}' +
    '.pg-help .new li b{color:var(--text);font-weight:600}' +
    '.pg-help .keys{display:grid;grid-template-columns:max-content 1fr;gap:10px 16px;align-items:center;margin:0}' +
    '.pg-help .keys dt{white-space:nowrap}' +
    '.pg-help .keys dd{margin:0;color:var(--text-2)}' +
    '.pg-help .trouble .li{align-items:flex-start}' +
    '.pg-help .trouble .li .chip{min-width:48px;justify-content:center;margin-top:1px}' +
    '.pg-help .trouble .li .grow span{white-space:normal}' +
    '</style>';

  CL.page('help', {
    title: 'Довідка', icon: 'help', group: 'manage', order: 110,

    async render(root, ctx) {
      root.classList.add('pg-help');
      root.innerHTML = STYLE +
        '<div class="blocks" data-area="help">' +

        // ---- what it is ----
        '<section class="block card" data-block="about" data-w="7" data-title="Що таке CarteLink">' +
          '<div class="card-h"><div class="card-icon">' + ic('link') + '</div><h2>' + esc(t('Що таке CarteLink')) + '</h2></div>' +
          '<div class="prose">' +
            '<p>' + esc(t('CarteLink — це шлюз до штучного інтелекту, який працює прямо на твоєму комп’ютері. Ти підключаєш до нього свої акаунти й ключі (Google, ChatGPT, Claude, Kimi, xAI, Meta та понад 70 інших сервісів), а він дає всім твоїм програмам одну адресу й один ключ.')) + '</p>' +
            '<p>' + esc(t('Програми думають, що говорять з офіційним сервісом, а CarteLink сам вирішує, який акаунт відповість, чергує їх, коли закінчується ліміт, і підставляє модель, яку ти обрав. Він розуміє мову Anthropic (Claude Code), OpenAI (Codex, Cursor, Cline…) і Gemini.')) + '</p>' +
            '<p class="faint small">' + esc(t('Від YouTube Cartel. Усі дані лишаються на твоєму комп’ютері.')) + '</p>' +
          '</div>' +
          '<div class="row" style="margin-top:6px"><button class="btn" id="hlWizard">' + ic('wand', 'sm') + esc(t('Показати «Швидке налаштування» на Огляді')) + '</button></div>' +
        '</section>' +

        // ---- what's new ----
        '<section class="block card" data-block="new" data-w="5" data-title="Що нового в 3.0">' +
          '<div class="card-h"><div class="card-icon">' + ic('zap') + '</div><h2>' + esc(t('Що нового в 3.0')) + '</h2><span class="grow"></span><span class="chip accent" id="hlVer"></span></div>' +
          '<ul class="new">' +
            nw('Переписано на Rust', 'Одна програма-файл: швидше стартує, менше їсть пам’яті.') +
            nw('10 дизайнів і свій власний', 'Обирай вигляд у Налаштуваннях або створи свої кольори й шрифт.') +
            nw('Усе під себе', 'Будь-який блок можна перетягнути, звузити чи сховати: кнопка «Налаштувати вигляд» угорі або Ctrl+K.') +
            nw('Порядок з акаунтами', 'Видалення кількох акаунтів одразу й автоочищення тих, де вхід відхилено.') +
            nw('Живий потік запитів', 'Кожен запит видно миттєво — на Огляді й у Статистиці.') +
            nw('Перевірка моделі', 'Одна кнопка надсилає короткий запит і показує, чи модель відповідає.') +
            nw('Статистика за ключами', 'Видно, скільки запитів прийшло з кожним API-ключем.') +
            nw('Сам себе лагодить', 'Якщо рушій раптом впаде, CarteLink перезапустить його сам.') +
          '</ul>' +
        '</section>' +

        // ---- how to start ----
        '<section class="block card" data-block="start" data-w="6" data-title="Як почати">' +
          '<div class="card-h"><div class="card-icon">' + ic('flag') + '</div><h2>' + esc(t('Як почати')) + '</h2></div>' +
          '<div class="steps">' +
            step(1, 'Додай акаунт', 'На сторінці «Акаунти» натисни кнопку входу (наприклад, Gemini-Antigravity — це безкоштовно) і увійди у вікні браузера.', 'accounts', 'Акаунти') +
            step(2, 'Обери модель', 'На Огляді або на сторінці «Моделі» вибери модель, яка відповідатиме на всі запити.', 'models', 'Моделі') +
            step(3, 'Підключи програму', 'Обери свою програму й один раз виконай показані кроки — адреса й ключ уже підставлені.', 'connect', 'Інструкції') +
            step(4, 'І забудь', 'Увімкни в Налаштуваннях «Запускати разом із системою» — CarteLink стартуватиме тихо у фоні й завжди буде готовий.', 'settings', 'Налаштування') +
          '</div>' +
        '</section>' +

        // ---- tip ----
        '<section class="block card" data-block="tip" data-w="6" data-title="Порада">' +
          '<div class="card-h"><div class="card-icon">' + ic('bulb') + '</div><h2>' + esc(t('Порада: кілька безкоштовних акаунтів')) + '</h2></div>' +
          '<div class="prose">' +
            '<p>' + esc(t('Кожен звичайний Google-акаунт у Gemini-Antigravity має денні та похвилинні ліміти. Додай 3–5 акаунтів — і коли на одному закінчиться ліміт, CarteLink сам перейде на наступний.')) + '</p>' +
            '<p>' + esc(t('Як саме чергувати — по колу чи спочатку перший — налаштовується на сторінці «Моделі» в блоці «Черговість акаунтів».')) + '</p>' +
            '<p>' + esc(t('Вхід відкривається в окремому тимчасовому вікні браузера: акаунти не змішуються з твоїм звичайним браузером, а вікно після входу закривається саме.')) + '</p>' +
          '</div>' +
        '</section>' +

        // ---- providers ----
        '<section class="block card" data-block="providers" data-w="12" data-title="Провайдери акаунтів">' +
          '<div class="card-h"><div class="card-icon">' + ic('users') + '</div><h2>' + esc(t('Які акаунти можна підключити')) + '</h2><span class="grow"></span><button class="btn sm ghost" data-goto="accounts">' + esc(t('Акаунти')) + ic('arrow', 'sm') + '</button></div>' +
          '<div class="table-wrap"><table class="table"><thead><tr><th>' + esc(t('Сервіс')) + '</th><th>' + esc(t('Що потрібно')) + '</th><th>' + esc(t('Приклади моделей')) + '</th></tr></thead><tbody>' +
            prov('Gemini (Antigravity)', 'ok', 'Безкоштовно', 'звичайний Google-акаунт', 'gemini-3.8-flash-high, claude-sonnet-4-6') +
            prov('Kimi (Moonshot)', 'info', 'Freemium', 'пошта або телефон', 'kimi-k2.8-code') +
            prov('OpenAI Codex', 'warn', 'Підписка', 'ChatGPT Plus або Team', 'gpt-5.5') +
            prov('Claude', 'warn', 'Підписка', 'Pro або Team', 'claude-opus-5-5, claude-sonnet-5-5') +
            prov('Meta AI', 'ok', 'Безкоштовно', 'акаунт Meta (Facebook / Instagram)', 'llama-3.3-70b-instruct') +
            prov('xAI (Grok)', 'warn', 'Підписка', 'X Premium', 'grok-3') +
          '</tbody></table></div>' +
          '<div class="hint" style="margin-top:10px">' + esc(t('Ще більше сервісів (Kiro, GitHub Copilot, Cursor, OpenCode…) — на сторінці «Плагіни». Звичайні API-ключі 70+ сервісів — на сторінці «Провайдери».')) + '</div>' +
        '</section>' +

        // ---- troubleshooting ----
        '<section class="block card" data-block="trouble" data-w="8" data-title="Якщо щось не працює">' +
          '<div class="card-h"><div class="card-icon">' + ic('alert') + '</div><h2>' + esc(t('Якщо щось не працює')) + '</h2><span class="grow"></span><button class="btn sm ghost" data-goto="stats">' + esc(t('Журнал помилок')) + ic('arrow', 'sm') + '</button></div>' +
          '<div class="list trouble">' +
            tr('401', 'bad', 'Невірний ключ', 'Ключ у програмі не збігається з ключем CarteLink. Скопіюй його ще раз з Огляду. Якщо ти згенерував новий ключ — старий більше не діє.') +
            tr('403', 'bad', 'Доступ заборонено', 'Цьому API-ключу не дозволена ця модель або ключ вимкнено. Перевір сторінку «API-ключі».') +
            tr('429', 'warn', 'Ліміт акаунта', 'Акаунт вичерпав ліміт. Зачекай, додай ще акаунтів (вони чергуватимуться) або скинь ліміт у «Статистиці».') +
            tr('503', 'warn', 'Шлюз на паузі', 'Натисни «Запустити» на Огляді. Якщо не допомагає — «Перезапустити».') +
            tr('404', 'info', 'Модель не знайдена', 'Такої моделі немає у твоїх акаунтах. Обери іншу на сторінці «Моделі».') +
            tr('—', '', 'Програма взагалі не з’єднується', 'Перевір, що CarteLink запущено, а адреса в програмі така сама, як на Огляді. На сторінці «Підключити програму» є команда для перевірки з’єднання.') +
          '</div>' +
          '<div class="card-foot" style="flex-wrap:wrap">' +
            '<span class="grow">' + esc(t('Що саме відповів провайдер — у «Журналі помилок» на сторінці «Статистика». Технічний журнал — файл app.log у папці data/cliproxy/logs.')) + '</span>' +
          '</div>' +
          '<div class="row" style="margin-top:12px"><button class="btn sm" data-open="data">' + ic('folder', 'sm') + esc(t('Відкрити папку з даними')) + '</button>' +
            '<button class="btn sm" data-open="logs">' + ic('folder', 'sm') + esc(t('Відкрити папку з журналами')) + '</button></div>' +
          '<div class="hint" id="hlHome" style="margin-top:8px"></div>' +
        '</section>' +

        // ---- keys ----
        '<section class="block card" data-block="keys" data-w="4" data-title="Клавіші">' +
          '<div class="card-h"><div class="card-icon">' + ic('terminal') + '</div><h2>' + esc(t('Клавіші')) + '</h2></div>' +
          '<dl class="keys">' +
            key(['Ctrl', 'K'], 'Швидкий пошук: сторінки, дії, теми й моделі (на Mac — Cmd+K)') +
            key(['Esc'], 'Закрити вікно або вийти з режиму «Налаштувати вигляд»') +
            key(['↑', '↓'], 'Рух по списку в пошуку та виборі моделі') +
            key(['Enter'], 'Вибрати підсвічений пункт') +
            key(['Tab'], 'Перейти до наступної кнопки чи поля') +
          '</dl>' +
        '</section>' +

        '</div>';

      root.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) CL.go(g.dataset.goto); });
      root.querySelector('#hlWizard').addEventListener('click', () => {
        try { localStorage.removeItem('cl.wizardHidden'); } catch (e) { /* ignore */ }
        CL.go('home');
      });
      root.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => CL.ui.busy(b, async () => {
        await CL.api.post('/app/open', { what: b.dataset.open });
        CL.toast('Папку відкрито');
      })));

      const st = CL.status || (await CL.loadStatus().catch(() => null));
      if (!ctx.alive()) return;
      root.querySelector('#hlVer').textContent = 'v' + ((st && st.version) || '3.0.0');
      try {
        const s = await CL.api.get('/app/settings');
        if (ctx.alive() && s && s.home) root.querySelector('#hlHome').textContent = t('Папка даних: {path}', { path: s.home });
      } catch (e) { /* offline */ }
    },
  });

  function nw(title, text) {
    return '<li>' + ic('check', 'sm') + '<div><b>' + esc(t(title)) + '.</b> ' + esc(t(text)) + '</div></li>';
  }

  function step(n, title, text, page, label) {
    return '<div class="step"><span class="avatar">' + n + '</span><div class="grow"><b>' + esc(t(title)) + '</b><span>' + esc(t(text)) + '</span></div>' +
      '<button class="btn sm" data-goto="' + page + '">' + esc(t(label)) + ic('arrow', 'sm') + '</button></div>';
  }

  function prov(name, cls, badge, need, models) {
    return '<tr><td><b>' + esc(name) + '</b></td><td><span class="chip ' + cls + '">' + esc(t(badge)) + '</span> <span class="muted">' + esc(t(need)) + '</span></td><td class="mono small">' + esc(models) + '</td></tr>';
  }

  function tr(code, cls, title, text) {
    return '<div class="li"><span class="chip ' + cls + ' mono">' + esc(code) + '</span><div class="grow"><b>' + esc(t(title)) + '</b><span>' + esc(t(text)) + '</span></div></div>';
  }

  function key(keys, text) {
    return '<dt>' + keys.map((k) => '<kbd>' + esc(k) + '</kbd>').join(' ') + '</dt><dd>' + esc(t(text)) + '</dd>';
  }
})();
