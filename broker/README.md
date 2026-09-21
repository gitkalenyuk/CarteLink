# CarteLink — Telegram OAuth Брокер

Цей мікросервіс надає CarteLink нативну авторизацію через Telegram з вибором акаунта та живою перевіркою підписки на спільноту **Secret YT_cartel 🧠**.

---

## Крок 1. Налаштування @BotFather

1. Відкрийте бота **@BotFather** у Telegram.
2. Введіть `/mybots` і оберіть вашого бота (наприклад, `@cartelcodebot` або новий бот).
3. Перейдіть: **Bot Settings → Login Widget** (або Telegram Login).
4. Натисніть **Show Client Secret** і скопіюйте значення. Це `TG_OAUTH_CLIENT_SECRET`.
5. Додайте дозволені адреси (Allowed URLs):
   - `https://<ВАШ_ДОМЕН_БРОКЕРА>`
   - `https://<ВАШ_ДОМЕН_БРОКЕРА>/api/auth/app-oidc`

---

## Крок 2. Додавання бота в групу Secret YT_cartel 🧠

1. Відкрийте закриту групу **Secret YT_cartel 🧠**.
2. Додайте вашого бота в групу як **Адміністратора**.
3. Дозволу достатньо стандартного: читання/управління учасниками, щоб бот міг викликати метод `getChatMember`.
4. Дізнайтеся цифровий ID групи (починається з `-100...`). Це значення для `TG_GROUPS`.

---

## Крок 3. Деплой брокера на Vercel

```bash
cd broker
npx vercel --prod
```

У налаштуваннях проєкту Vercel (**Project → Settings → Environment Variables**) додайте змінні:

| Змінна | Приклад значення | Опис |
|---|---|---|
| `TG_BOT_TOKEN` | `<TG_BOT_TOKEN>` | Токен Telegram-бота |
| `TG_OAUTH_CLIENT_SECRET` | `...` | Секрет із Bot Settings → Login Widget |
| `TG_GROUPS` | `-100xxxxxxxxxx` | ID групи Secret YT_cartel |
| `SESSION_SECRET` | `випадковий_32_символьний_ключ` | Ключ для підпису HMAC сесій |
| `PUBLIC_URL` | `https://ваш-проєкт.vercel.app` | Повний URL цього ж деплою на Vercel |
| `BRAND` | `CarteLink` | Назва на екранах авторизації |

Після додавання змінних натисніть **Redeploy**.

---

## Перевірка працездатності

Відкрийте в браузері: `https://ваш-проєкт.vercel.app/healthz`
Має повернутися JSON:
```json
{
  "ok": true,
  "brand": "CarteLink",
  "configured": true,
  "missing": [],
  "groups": 1
}
```
