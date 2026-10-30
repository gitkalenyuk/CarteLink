# CarteLink для macOS — встановлення через ШІ

**Для людини.** Відкрий Claude Code, Codex, Cursor (Agent) або іншого ШІ-агента, який може
виконувати команди в Терміналі на твоєму Mac. Скопіюй **увесь текст під лінією** і встав
агенту. Якщо `.dmg` уже завантажено — допиши в кінці, де лежить файл.
Агент сам визначить процесор, встановить потрібну версію й перевірить, що вона працює.
Увійти через Telegram доведеться тобі самому — це агент за тебе не робить.

Звичайна (ручна) інструкція — [`INSTALL-MACOS.md`](INSTALL-MACOS.md).

---

Встанови мені програму **CarteLink** (локальний AI-шлюз YouTube Cartel) на цей Mac.
Виконуй кроки по черзі командами в Терміналі, не питай підтвердження на кожен крок.
Відповідай мовою, якою я пишу. Зупиняйся й питай мене лише там, де це сказано нижче.

Правила:
- Беру `.dmg` лише з місць, названих у кроці 2. Нічого іншого не завантажуй і не встановлюй.
- Не видаляй і не змінюй папку `~/Library/Application Support/CarteLink` — там мої акаунти й
  налаштування, нова версія підхопить їх сама.
- Не вводь за мене паролі й не входь в акаунти. Вхід у CarteLink через Telegram я зроблю сам.

**1. Перевір систему.**

```bash
sw_vers -productVersion
sysctl -n hw.optional.arm64 2>/dev/null || echo 0
```

- Версія macOS має бути **13 або вища**. Якщо нижча — зупинись і скажи мені, що CarteLink
  потребує macOS 13 Ventura або новішої (Системні параметри → Загальні → Оновлення ПЗ).
- `1` → Apple Silicon (M1–M5): `VARIANT=apple-silicon`. Інакше Intel: `VARIANT=intel`.
  Ця перевірка правильна, навіть якщо Термінал працює через Rosetta (на відміну від `uname -m`).

**2. Знайди інсталятор `.dmg`** (у такому порядку):

1. Якщо я вказав шлях до `.dmg` — бери його.
2. Шукай у `~/Downloads` і `~/Desktop`: спершу `CarteLink-<версія>-$VARIANT.dmg`, потім
   universal `CarteLink-<версія>.dmg` (без суфікса — підходить будь-якому Mac). З кількох
   версій бери найновішу. **Не бери `.dmg` іншої архітектури** (`-intel` на Apple Silicon чи
   `-apple-silicon` на Intel).

   ```bash
   find ~/Downloads ~/Desktop -maxdepth 1 -name "CarteLink-*-$VARIANT.dmg" 2>/dev/null
   find ~/Downloads ~/Desktop -maxdepth 1 -name 'CarteLink-*.dmg' 2>/dev/null | grep -E '/CarteLink-[0-9.]+\.dmg$'
   ```

3. Якщо не знайшов, а `gh` увійшов в акаунт із доступом до приватного репозиторію
   `gitkalenyuk/CarteLink` (команда `gh release list --repo gitkalenyuk/CarteLink` працює) —
   завантаж останній macOS-реліз:

   ```bash
   TAG=$(gh release list --repo gitkalenyuk/CarteLink --limit 50 --json tagName \
     --jq '[.[] | select(.tagName | endswith("-mac"))][0].tagName')
   gh release download "$TAG" --repo gitkalenyuk/CarteLink \
     --pattern "CarteLink-*-$VARIANT.dmg" --dir ~/Downloads --clobber
   ```

4. Інакше — **зупинись і попроси мене** завантажити файл `CarteLink-<версія>-$VARIANT.dmg`
   (назви мені правильний варіант для мого процесора) і сказати, де він лежить.

**3. Закрий і прибери стару версію.**

```bash
osascript -e 'quit app id "cartel.link"' 2>/dev/null; sleep 2
[ -d /Applications/CarteLink.app ] && mv /Applications/CarteLink.app ~/.Trash/CarteLink-old-$(date +%Y%m%d%H%M%S).app
```

Стара версія йде в Кошик (не видаляється назавжди).

**4. Встанови з `.dmg`** (`DMG` — шлях із кроку 2):

```bash
MNT=$(mktemp -d)
hdiutil attach -nobrowse -readonly -mountpoint "$MNT" "$DMG"
ditto "$MNT/CarteLink.app" /Applications/CarteLink.app
hdiutil detach "$MNT"
```

Якщо запису в `/Applications` немає (не адміністратор) — встанови в `~/Applications`
(`mkdir -p ~/Applications`) і далі використовуй цей шлях.

**5. Дозволь запуск.** Збірка не нотаризована Apple, тому без цього macOS не відкриє її
(«неможливо перевірити розробника» / «пошкоджено»):

```bash
xattr -dr com.apple.quarantine /Applications/CarteLink.app
lipo -archs /Applications/CarteLink.app/Contents/MacOS/cartelink
codesign --verify --deep --strict /Applications/CarteLink.app && echo signature OK
```

`lipo` має показати `arm64` (Apple Silicon), `x86_64` (Intel) або обидва (universal) — і
архітектура мого Mac має бути серед них.

**6. Запусти й перевір.**

```bash
open /Applications/CarteLink.app
for i in $(seq 1 15); do sleep 1; curl -s --max-time 2 http://127.0.0.1:8317/api/status | grep -o '"version":"[^"]*"' | tail -1 && break; done
```

- Має вивести `"version":"…"` — це версія CarteLink. Якщо нічого: порт 8317 могла зайняти
  інша програма — подивись `lsof -nP -iTCP -sTCP:LISTEN | grep -i cartelink` і перевір
  `/api/status` на тому порту.
- Якщо вікно не з'явилось або є помилка — покажи мені останні 50 рядків
  `~/Library/Application Support/CarteLink/data/cliproxy/logs/app.log` і поясни, що не так.

**7. Підсумуй мені:**
- яку версію й варіант (Apple Silicon / Intel / universal) встановлено і куди;
- що мені зробити далі у вікні CarteLink:
  1. **«Увійти через Telegram»** — доступ лише для учасників групи Secret YT_cartel 🧠
     (не учасник — кнопка «Отримати доступ»);
  2. **Акаунти** або **Провайдери** — підключити акаунти / API-ключі;
  3. **Підключити програму** → вкладка **macOS / Linux** — готові команди для моєї програми
     (Claude Code, Codex, Cursor…). Адреса шлюзу `http://127.0.0.1:8317`, ключ — на «Огляді»;
- що на Mac закриття вікна повністю вимикає шлюз (трею немає), а автозапуск вмикається в
  Налаштуваннях → «Запускати разом із системою».
