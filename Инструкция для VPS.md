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
```

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
nano .env
```

Вставьте те же переменные из сохранённой копии `.env`.

Залейте `cookies-youtube.txt` заново (раздел 10).

```bash
chmod 600 .env
chmod 600 cookies-youtube.txt
chmod 600 cookies-vk.txt
pm2 start index.js --name nyamka
pm2 save
```

---

## 9. Discord — что должно быть включено

1. Developer Portal → **Бот** → **MESSAGE CONTENT INTENT** — включён
2. Бот приглашён на сервер с правами: отправка, чтение истории, **управление сообщениями**, подключение, говорить
3. На приватных каналах — боту выдан доступ отдельно

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

**Вариант А — PowerShell на ПК:**

```powershell
scp C:\Users\Enklav111\Desktop\cookies-youtube.txt root@89.125.248.187:/opt/nyamka-bot/cookies-youtube.txt
```

Подставьте свой IP и путь к файлу.

**Вариант Б — WinSCP:**

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

Что делать:
1. Заново экспортировать `cookies-youtube.txt` с ПК
2. Залить на сервер (заменить старый файл)
3. `pm2 restart nyamka` или перезапустить `npm start`

> **Не заливайте** `cookies-*.txt` и `.env` в GitHub — там ваши секреты.

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
```

**Обновление cookies YouTube:**
```
экспорт с ПК → scp cookies-youtube.txt → pm2 restart nyamka
```

**Обновление cookies VK:**
```
экспорт с vk.com → scp cookies-vk.txt → pm2 restart nyamka
```
