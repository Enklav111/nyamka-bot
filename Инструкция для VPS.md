# Инструкция для VPS — бот НямКа

Краткая шпаргалка: как поднять бота с нуля или восстановить после сбоя VPS (JustHost и аналоги, Ubuntu).
cd /opt/nyamka-bot
git pull
npm start

---

## 1. Подключиться к серверу через PuTTY

1. Скачайте [PuTTY](https://www.putty.org/) (если ещё нет).
2. Запустите PuTTY.
3. В поле **Host Name** введите IP сервера, например: `89.125.248.187`
4. Port: `22`, Connection type: **SSH**
5. Нажмите **Open**
6. Логин: `root` (или тот, что выдали в панели хостинга)
7. Введите пароль (при вводе символы не отображаются — это нормально)

После входа строка выглядит так: `root@имя-сервера:~#`

---

## 2. Установить нужное ПО (без обновления системы)

> Команды `apt update` и полное обновление системы **не выполняем**.  
> Во время установки Node.js в фиолетовых окнах просто жмите **Enter** → **Tab** → **Enter**.

```bash
apt install -y curl git build-essential
apt install -y ffmpeg
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp
apt remove -y yt-dlp 2>/dev/null; hash -r
node -v && npm -v && yt-dlp --version && ffmpeg -version | head -1
```

Должно показать Node.js `v20.x`, npm, **свежую** версию yt-dlp и **ffmpeg** (не «command not found»).

> **Обязательно: ffmpeg** — без него бот **не играет** VK, SoundCloud и Spotify.  
> Команда: `apt install -y ffmpeg`  
> Проверка: `ffmpeg -version` → путь `/usr/bin/ffmpeg`  
> При старте бота должно быть: `ffmpeg: /usr/bin/ffmpeg` (не предупреждение «НЕ НАЙДЕН»).

> **Важно:** нужен **системный ffmpeg** (`apt install ffmpeg`). Встроенный ffmpeg-static из npm на VPS иногда падает (SIGSEGV) на VK-потоках.  
> Не скачивайте файл `yt-dlp` (скрипт) — на Ubuntu он может тянуть старый модуль.  
> Нужен именно **`yt-dlp_linux`** (готовый бинарник).

---

## 3. Скачать бота с GitHub (первая установка)

```bash
cd /opt
git clone https://github.com/Enklav111/nyamka-bot.git
cd nyamka-bot
npm install
git update-index --skip-worktree cookies-youtube.txt cookies-vk.txt 2>/dev/null
```

> Строка `skip-worktree` — чтобы `git pull` не конфликтовал с cookies на сервере (раздел 7.1).

---

## 4. Настроить `.env`

```bash
nano .env
```

Вставьте (свои значения, без кавычек):

```env
DISCORD_TOKEN=токен_бота_из_Developer_Portal
VOICE_CHANNEL_ID=ID_голосового_канала
LINKS_CHANNEL_ID=ID_канала_со_ссылками
PLAYED_CHANNEL_ID=ID_канала_с_логом
YOUTUBE_COOKIES_FILE=/opt/nyamka-bot/cookies-youtube.txt
VK_COOKIES_FILE=/opt/nyamka-bot/cookies-vk.txt
```

`VK_COOKIES_FILE` — опционально, только если VK-видео/музыка не играют без входа (раздел 11).

Сохранить: **Ctrl+O** → Enter → **Ctrl+X**

```bash
chmod 600 .env
```

**Где взять значения:**
- `DISCORD_TOKEN` — Discord Developer Portal → вкладка «Бот» → Reset Token
- ID каналов — режим разработчика в Discord → ПКМ по каналу → «Копировать ID»
- `VOICE_CHANNEL_ID` — только **голосовой** канал
- `YOUTUBE_COOKIES_FILE` — cookies YouTube (раздел 10)
- `VK_COOKIES_FILE` — cookies ВКонтакте, если нужно (раздел 11)

> **Храните копию `.env` на ПК** в надёжном месте (не в GitHub).

---

## 5. Запустить бота (тест)

```bash
cd /opt/nyamka-bot
npm start
```

Успех: `Бот запущен как НямКа#...`, в Discord бот **онлайн**.

Остановить: **Ctrl+C**

---

## 6. Запуск 24/7 через PM2

pm2 start npm --name nyamka -- start
Фоновый запуск 24/7

pm2 stop nyamka
Остановка

pm2 restart nyamka
Перезапуск

```bash
npm install -g pm2
cd /opt/nyamka-bot
pm2 start index.js --name nyamka
pm2 save
pm2 startup
```

Выполните строку, которую выдаст `pm2 startup`.

| Команда | Действие |
|---------|----------|
| `pm2 status` | статус |
| `pm2 logs nyamka` | логи |
| `pm2 restart nyamka` | перезапуск |
| `pm2 stop nyamka` | остановка |

Если PM2 не установлен — используйте `npm start` (бот остановится при закрытии PuTTY).

---

## 7. Обновить бота (новый код на GitHub)

Когда на ПК изменили код и залили на GitHub:

```bash
pm2 stop nyamka
cd /opt/nyamka-bot
git pull
npm install
pm2 start nyamka
```

Без PM2: **Ctrl+C** → `git pull` → `npm install` → `npm start`

Проверка: `pm2 logs nyamka --lines 30`

### 7.1. Ошибка `git pull`: cookies-youtube.txt would be overwritten

**Почему:** на VPS cookies обновляются через `!cookies` или scp, а файл **когда-то попал в GitHub**. Git видит локальные изменения и блокирует pull.

**Сейчас (разово) — сохранить cookies и подтянуть код:**

```bash
cd /opt/nyamka-bot
cp cookies-youtube.txt /tmp/cookies-youtube-backup.txt
cp cookies-vk.txt /tmp/cookies-vk-backup.txt 2>/dev/null
git stash push -m "cookies" -- cookies-youtube.txt cookies-vk.txt 2>/dev/null || true
git pull
cp /tmp/cookies-youtube-backup.txt cookies-youtube.txt
cp /tmp/cookies-vk-backup.txt cookies-vk.txt 2>/dev/null
chmod 600 cookies-youtube.txt cookies-vk.txt 2>/dev/null
pm2 restart nyamka
```

**Навсегда на VPS — сказать git «не трогай cookies»:**

Выполните **один раз** после clone/pull:

```bash
cd /opt/nyamka-bot
git update-index --skip-worktree cookies-youtube.txt
git update-index --skip-worktree cookies-vk.txt
```

После этого `git pull` **не будет** ругаться на cookies — git проигнорирует локальные изменения этих файлов.

Проверка:

```bash
git ls-files -v | grep cookies
```

Должно быть `S cookies-youtube.txt` (буква **S** = skip-worktree).

> Cookies и `.env` **никогда не коммитьте** в GitHub. На ПК они уже в `.gitignore`.  
> Если cookies снова попали в репозиторий — удалите их из git на ПК:  
> `git rm --cached cookies-youtube.txt cookies-vk.txt` → commit → push.

---

## 8. VPS упал / всё сломалось — установка заново

```bash
pm2 stop nyamka
pm2 delete nyamka
rm -rf /opt/nyamka-bot
cd /opt
git clone https://github.com/Enklav111/nyamka-bot.git
cd nyamka-bot
npm install
git update-index --skip-worktree cookies-youtube.txt cookies-vk.txt 2>/dev/null
nano .env
```

Вставьте те же переменные из сохранённой копии `.env`.

Залейте `cookies-youtube.txt` заново (раздел 10.2 — Discord `!cookies` или scp/WinSCP).

```bash
chmod 600 .env
chmod 600 cookies-youtube.txt
chmod 600 cookies-vk.txt
pm2 start index.js --name nyamka
pm2 save
```

---

## 9. Discord — токен, интенты и права бота

### 9.1. После смены токена

1. Developer Portal → приложение бота → вкладка **Бот** → **Reset Token** → скопировать новый токен
2. На VPS в `.env` заменить `DISCORD_TOKEN=...`
3. Перезапустить бота: `pm2 restart nyamka`

> Старый токен после Reset **перестаёт работать**. Если бот «офлайн» после смены токена — почти всегда не обновили `.env` на сервере.

### 9.2. Интент (обязательно)

Developer Portal → **Бот** → раздел **Privileged Gateway Intents**:

| Интент | Нужен? |
|--------|--------|
| **MESSAGE CONTENT INTENT** | **Да** — без него бот не читает текст ссылок и команд (`!skip`, `!cookies` и т.д.) |
| SERVER MEMBERS INTENT | Нет |
| PRESENCE INTENT | Нет |

Сохранить изменения внизу страницы.

### 9.3. Права при приглашении бота (OAuth2)

Developer Portal → **OAuth2** → **URL Generator**:

**Scopes (области):**
- `bot`

**Bot Permissions** — отметить **только эти** галочки:

| Раздел | Право (как в Discord) | Зачем |
|--------|------------------------|-------|
| Основные | **Просматривать каналы** | Видеть каналы сервера |
| Текстовые | **Отправлять сообщения** | Ответы на команды, лог «сейчас играет» |
| Текстовые | **Управлять сообщениями** | Удаление не-ссылок, очистка канала |
| Текстовые | **Закреплять сообщения** | Закреп справки `!help` (**с 2026 отдельное право!**) |
| Текстовые | **Читать историю сообщений** | Чтение ссылок и команд в канале |
| Голосовые | **Подключаться** | Заход в голосовой канал |
| Голосовые | **Говорить** | Воспроизведение музыки |

**Не включайте «Администратор»** у бота — это лишнее.  
Право **Administrator** нужно **вам** (человеку), чтобы пользоваться командой `!cookies` — это не право бота.

**Числовой код прав (Permissions Integer):** `2251799816908800`

> **Важно (2026):** Discord вынес **«Закреплять сообщения»** из «Управлять сообщениями».  
> Если в логах `Missing Permissions` при закрепе справки — не хватает именно **Pin Messages**, а не других прав.

Скопируйте сгенерированную ссылку внизу страницы и откройте в браузере → выберите сервер → **Авторизовать**.

Пример ссылки (подставьте свой `client_id` с вкладки **OAuth2 → General**):

```
https://discord.com/api/oauth2/authorize?client_id=ВАШ_CLIENT_ID&permissions=2251799816908800&scope=bot
```

Если бот **уже на сервере**, но без прав — **Настройки сервера → Роли** → роль **НямКа** → включите **Закреплять сообщения** (и остальные 6 прав), либо пригласите заново по ссылке выше.

Discord может показать баннер в **Настройки сервера → Роли** с кнопкой автоматического обновления прав после изменения Pin Messages — нажмите её.

### 9.4. Приватные каналы

Если каналы ссылок, лога или голосовой **закрыты для @everyone**:

1. Настройки канала → **Права доступа**
2. Добавьте роль бота (или самого бота)
3. Разрешите: **Просматривать канал**, **Отправлять сообщения**, **Читать историю**, **Управлять сообщениями**, **Закреплять сообщения** (для текстовых); **Подключаться**, **Говорить** (для голосового)

### 9.5. Быстрая проверка

| Симптом | Что проверить |
|---------|----------------|
| Бот не видит ссылки | MESSAGE CONTENT INTENT |
| Не удаляет лишние сообщения | Управлять сообщениями |
| `Missing Permissions` при закрепе справки | **Закреплять сообщения** (Pin Messages) — с 2026 отдельно от Manage Messages |
| Не заходит в голосовой | Подключаться + Говорить + `VOICE_CHANNEL_ID` |
| `!cookies` — «Нет прав» | У **вашего** аккаунта Administrator на сервере |
| Бот офлайн после Reset Token | Новый токен в `.env` на VPS + `pm2 restart nyamka` |
| Одна ссылка → два «Сейчас играет» | Два процесса бота — см. раздел 9.6 |

### 9.6. Дубли «Сейчас играет» (два процесса бота)

Если одна ссылка даёт **два** одинаковых сообщения в канале лога — почти всегда запущено **два экземпляра** бота (например, `pm2` + `npm start` одновременно).

На VPS:

```bash
pm2 list
ps aux | grep "node.*index.js"
```

Должен быть **один** процесс. Лишнее:

```bash
pm2 stop nyamka
pm2 delete nyamka
pkill -f "node.*nyamka-bot"    # убить зависшие npm start
cd /opt/nyamka-bot
pm2 start index.js --name nyamka
pm2 save
```

Не запускайте `npm start` в PuTTY, если бот уже работает через PM2.

---

## 10. YouTube: cookies (если bgutil не хватит)

YouTube часто блокирует IP серверов (`Sign in to confirm you're not a bot`).  
Сначала попробуйте **bgutil** (раздел 10a) — часто работает **без cookies**.  
Cookies — запасной путь, если bgutil не помог или нужны приватные/возрастные видео.

### 10.0. Если забыли ffmpeg (бот пишет «ffmpeg НЕ НАЙДЕН»)

```bash
apt install -y ffmpeg
ffmpeg -version
cd /opt/nyamka-bot
npm start
```

При старте: `ffmpeg: /usr/bin/ffmpeg`

---

### 10a. YouTube: bgutil (обход бот-чека без Google-аккаунта)

По мотивам [гайда про обход бот-чека](https://github.com/mikedigriz/YT/blob/main/docs/how-to/05-obhod-bot-cheka.md).

**1. Сервер токенов (Docker):**

```bash
docker run --name bgutil-provider -d --restart unless-stopped \
  -p 127.0.0.1:4416:4416 \
  brainicism/bgutil-ytdlp-pot-provider
curl -s 127.0.0.1:4416/ping
```

**2. Плагин для yt-dlp:**

```bash
mkdir -p ~/.config/yt-dlp/plugins
cd ~/.config/yt-dlp/plugins
curl -L -o bgutil-ytdlp-pot-provider.zip \
  https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/latest/download/bgutil-ytdlp-pot-provider.zip
```

**3. Проверка:**

```bash
yt-dlp -v --simulate "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>&1 | grep -i pot
```

Должны быть строки про `bgutil` / `pot`.

**4. Вернуться к боту:**

```bash
cd /opt/nyamka-bot
npm start
```

> Cookies (раздел 10.1 ниже) — **запасной путь**, если bgutil не помог.  
> Если ошибка `429` с первого запроса — бан IP VPS, не помогут ни bgutil, ни cookies.

---

### 10.1. YouTube: cookies (запасной путь)

1. Установите расширение **«Get cookies.txt LOCALLY»** в Chrome  
   (именно с словом LOCALLY — оно не отправляет данные в интернет)
2. Откройте **youtube.com** и войдите в аккаунт  
   > Рекомендуется **отдельный** Google-аккаунт, не основной
3. Нажмите иконку расширения → **Export** → сохраните как `cookies-youtube.txt`  
   Например: `C:\Users\ВАШ_ЛОГИН\Desktop\cookies-youtube.txt`

### 10.2. Залить cookies на сервер

**Вариант А — команда в Discord (удобнее всего):**

1. Экспортируйте `cookies-youtube.txt` на ПК (раздел 10.1)
2. В Discord, в канале **ссылок** или **лога**, отправьте сообщение:
   - `!cookies` — обновить YouTube cookies
   - `!cookies vk` — обновить VK cookies
3. **Прикрепите** файл `.txt` к этому сообщению (перетащите файл в поле ввода)
4. Бот ответит `✅ YouTube cookies обновлены` и удалит сообщение с файлом через 10 секунд

> **Важно:** команду может использовать только участник с правом **Administrator** на сервере.  
> **Перезапуск бота не нужен** — новые cookies подхватятся со следующего трека.  
> Старый файл сохраняется как `cookies-youtube.txt.bak` на сервере.

**Вариант Б — PowerShell на ПК:**

```powershell
scp C:\Users\Enklav111\Desktop\cookies-youtube.txt root@89.125.248.187:/opt/nyamka-bot/cookies-youtube.txt
```

Подставьте свой IP и путь к файлу.

**Вариант В — WinSCP:**

1. Подключиться к серверу (IP, root, пароль)
2. Перетащить `cookies-youtube.txt` в папку `/opt/nyamka-bot/`

**На сервере:**

```bash
chmod 600 /opt/nyamka-bot/cookies-youtube.txt
```

### 10.3. Прописать в `.env`

```bash
nano /opt/nyamka-bot/.env
```

Должна быть строка:

```env
YOUTUBE_COOKIES_FILE=/opt/nyamka-bot/cookies-youtube.txt
```

### 10.4. Проверить до запуска бота

```bash
yt-dlp --cookies /opt/nyamka-bot/cookies-youtube.txt -f bestaudio -o - --no-playlist "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>&1 | head -10
```

| Результат | Что делать |
|-----------|------------|
| `Downloading...` без `ERROR` | cookies работают → `npm start` |
| `Sign in to confirm you're not a bot` | экспортируйте cookies заново (заново зайдите на YouTube в браузере) |

### 10.5. Запустить бота и проверить

```bash
cd /opt/nyamka-bot
npm start
```

Киньте **новую** YouTube-ссылку в канал ссылок.

### 10.6. Cookies протухли

Симптомы: снова `⚠️ Не удалось воспроизвести` или ошибка `Sign in to confirm` в PuTTY.

**Быстрый способ (Discord):**

1. Заново зайдите на **youtube.com** в браузере (на ПК)
2. Экспортируйте свежий `cookies-youtube.txt` (раздел 10.1)
3. В Discord: `!cookies` + прикрепите файл (раздел 10.2, вариант А)
4. Киньте **новую** YouTube-ссылку в канал — перезапуск бота **не нужен**

**Через сервер (scp / WinSCP):**

1. Заново экспортировать `cookies-youtube.txt` с ПК
2. Залить на сервер (заменить старый файл) — раздел 10.2, варианты Б или В
3. `pm2 restart nyamka` не обязателен, но можно для спокойствия

> **Не заливайте** `cookies-*.txt` и `.env` в GitHub — там ваши секреты.

### 10.7. Команда `!cookies` — справка

| Команда | Что делает |
|---------|------------|
| `!cookies` | Заменить YouTube cookies (`YOUTUBE_COOKIES_FILE`) |
| `!cookies vk` | Заменить VK cookies (`VK_COOKIES_FILE`) |
| `!куки`, `!печеньки` | То же, что `!cookies` |

**Требования:**
- Право **Administrator** на Discord-сервере
- Файл `.txt` в формате Netscape (расширение «Get cookies.txt LOCALLY»)
- Размер до 1 МБ
- В файле должны быть cookies для `youtube.com` / `google.com` (или `vk.com` для VK)

**Что делает бот:**
1. Скачивает вложение и проверяет формат
2. Сохраняет старый файл как `.bak`
3. Записывает новый файл по пути из `.env`
4. Удаляет ваше сообщение с файлом и свой ответ через 10 секунд

**Если ошибка «В `.env` не задан `YOUTUBE_COOKIES_FILE`»** — добавьте строку в `.env` (раздел 10.3) и перезапустите бота один раз.

---

## 11. VK Видео и VK Музыка

Бот воспроизводит ссылки ВКонтакте через **yt-dlp**.

### Какие ссылки работают

| Тип | Пример ссылки |
|-----|----------------|
| Видео | `https://vk.com/video-123456_789012` |
| Видео (vkvideo) | `https://vkvideo.ru/video-123456_789012` |
| Трек | `https://vk.com/audio123456_789012` |
| Трек (с минусом) | `https://vk.com/audio-123456_789012` |
| Плейлист | `https://vk.com/music/playlist/-123_45` — играет **первый** трек |

Скопируйте ссылку через **Поделиться** или **Копировать ссылку** в VK.

### Cookies для VK (обычно не нужны)

Публичные видео и треки часто работают **без cookies**.

Если ошибка `only available for registered users` или `badbrowser`:

1. На ПК: расширение **«Get cookies.txt LOCALLY»** в Chrome
2. Зайдите на **vk.com** под своим аккаунтом
3. Export → `cookies-vk.txt`
4. Залить на сервер:
   - **Discord:** `!cookies vk` + прикрепить файл (раздел 10.2)
   - **или scp:**

```powershell
scp C:\Users\Enklav111\Desktop\cookies-vk.txt root@89.125.248.187:/opt/nyamka-bot/cookies-vk.txt
```

5. В `.env`:

```env
VK_COOKIES_FILE=/opt/nyamka-bot/cookies-vk.txt
```

```bash
chmod 600 /opt/nyamka-bot/cookies-vk.txt
```

### Проверка VK до запуска бота

Видео:

```bash
yt-dlp --user-agent "Mozilla/5.0" --referer "https://vk.com/" -f bestaudio -o - --no-playlist "ССЫЛКА_НА_VK_ВИДЕО" 2>&1 | head -10
```

Музыка:

```bash
yt-dlp --user-agent "Mozilla/5.0" --referer "https://vk.com/" -f bestaudio -o - --no-playlist "ССЫЛКА_НА_VK_AUDIO" 2>&1 | head -10
```

С cookies добавьте: `--cookies /opt/nyamka-bot/cookies-vk.txt`

---

## 12. Spotify

Spotify **не стримит напрямую** — так устроен сервис.

Бот при ссылке на **трек** (`open.spotify.com/track/...`):
1. Читает название через публичный API Spotify (авторизация **не нужна**)
2. Ищет тот же трек на **SoundCloud** (приоритет)
3. Если не нашёл — ищет на **YouTube**

**Не поддерживается:** ссылки на альбом или плейлист Spotify — только один трек.

Если нашёл на YouTube, а YouTube не играет — нужны cookies YouTube (раздел 10).

---

## 13. YouTube: обновить yt-dlp

Если версия старая (2022) или бот пишет ошибки yt-dlp:

```bash
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp
apt remove -y yt-dlp 2>/dev/null; hash -r
yt-dlp --version
```

Должна быть версия **2024+** или **2026+**, не 2022.

---

## 14. Полезные команды

```bash
cd /opt/nyamka-bot
free -h
pm2 status
pm2 logs nyamka --err --lines 50
which yt-dlp
yt-dlp --version
ffmpeg -version | head -1
```

---

## Шпаргалка

**Первая установка:**
```
PuTTY → apt install ffmpeg → Node.js + yt-dlp_linux → git clone → npm install → bgutil (YouTube) → nano .env → npm start
```

**Обновление кода:**
```
pm2 stop → git pull → npm install → pm2 start
(если pull ругается на cookies — раздел 7.1)
```

**Обновление cookies YouTube (Discord):**
```
экспорт с ПК → в Discord: !cookies + файл cookies-youtube.txt
```

**Обновление cookies YouTube (scp):**
```
экспорт с ПК → scp cookies-youtube.txt → (перезапуск не обязателен)
```

**Обновление cookies VK (Discord):**
```
экспорт с vk.com → в Discord: !cookies vk + файл cookies-vk.txt
```

**Обновление cookies VK (scp):**
```
экспорт с vk.com → scp cookies-vk.txt → (перезапуск не обязателен)
```
