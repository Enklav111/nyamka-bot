# Инструкция для VPS — бот НямКа

Краткая шпаргалка: как поднять бота с нуля или восстановить после сбоя VPS (JustHost и аналоги, Ubuntu).

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
во время установки Node.js просто жать ОК
```bash
apt install -y curl git build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp
node -v && npm -v && yt-dlp --version
```

Должно показать Node.js `v20.x`, npm и **свежую** версию yt-dlp (год 2025–2026, **не** 2022).

> **Важно:** `apt install yt-dlp` ставит древнюю версию (2022), YouTube с ней не работает. Используйте команду `curl` выше.

Если появятся фиолетовые окна (kernel upgrade / restart services) — нажмите **Enter**, затем **Tab** → **Enter** на `<Ok>`.

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
```

Опционально, если YouTube всё равно не играет:

```env
YOUTUBE_COOKIES_FILE=/opt/nyamka-bot/cookies.txt
```

Сохранить: **Ctrl+O** → Enter → **Ctrl+X**

```bash
chmod 600 .env
```

**Где взять значения:**
- `DISCORD_TOKEN` — Discord Developer Portal → вкладка «Бот» → Reset Token
- ID каналов — режим разработчика в Discord → ПКМ по каналу → «Копировать ID»
- `VOICE_CHANNEL_ID` — только **голосовой** канал

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

---

## 7. Обновить бота (новый код на GitHub)

Когда на ПК изменили код и залили на GitHub:

```bash
pm2 stop nyamka
cd /opt/nyamka-bot
git pull
npm install
pm2 start nyamka  \или\ npm start
```

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

Вставьте те же переменные, что были в `.env` (храните копию `.env` на ПК в надёжном месте).

```bash
chmod 600 .env
pm2 start index.js --name nyamka
pm2 save
```

---

## 9. Discord — что должно быть включено

1. Developer Portal → **Бот** → **MESSAGE CONTENT INTENT** — включён
2. Бот приглашён на сервер с правами: отправка, чтение истории, **управление сообщениями**, подключение, говорить
3. На приватных каналах — боту выдан доступ отдельно

---

## 10. YouTube не играет

Бот использует **yt-dlp** для YouTube-ссылок. Проверка на сервере:

```bash
yt-dlp -f bestaudio -o - --no-playlist "https://www.youtube.com/watch?v=dQw4w9WgXcQ" | head -c 1000
```

Если ошибка — YouTube блокирует IP VPS. Варианты:

1. Попробовать SoundCloud-ссылку (через play-dl)
2. Экспортировать cookies YouTube с ПК → файл `cookies.txt` на сервер → `YOUTUBE_COOKIES_FILE` в `.env`
3. Обновить yt-dlp:
   ```bash
   curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
   chmod a+rx /usr/local/bin/yt-dlp
   yt-dlp --version
   ```

---

## 11. Полезные команды

```bash
# где бот
cd /opt/nyamka-bot

# свободная память
free -h

# работает ли бот
pm2 status

# последние ошибки
pm2 logs nyamka --err --lines 50
```

---

## Шпаргалка одной строкой

```
PuTTY → apt install (curl git build-essential yt-dlp) → Node.js → git clone → npm install → nano .env → pm2 start
```

Обновление: `pm2 stop` → `git pull` → `npm install` → `pm2 start`
