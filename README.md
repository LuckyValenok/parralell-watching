# Parallel Watching

Совместный просмотр сериалов и фильмов на [HDRezka](https://hdrezka.ag) с друзьями в реальном времени.

Когда один участник нажимает play, pause или перематывает — у остальных плеер синхронизируется автоматически.

## Возможности

- Синхронизация play / pause / seek
- Переключение серий у хоста — гости переходят на ту же серию
- Чат комнаты с реакциями
- Автоподключение хоста через веб-сессию
- Поддержка зеркал HDRezka (`rezka.*`, `hdrezka.*`, `rezka-ua.*`)

## Быстрый старт

### 1. Установка

```bash
npm install
cp .env.example .env   # опционально
```

### 2. Разработка

```bash
npm run dev
```

- Веб-интерфейс: http://localhost:5173
- Сервер синхронизации: http://localhost:3001

### 3. Расширение

```bash
npm run build:extension
```

1. Откройте `chrome://extensions/`
2. Включите «Режим разработчика»
3. «Загрузить распакованное расширение» → папка `extension/dist`

Либо установите готовый архив `extension/parallel-watching-extension-v*.zip`.

### 4. Совместный просмотр

1. Создайте комнату на http://localhost:5173
2. Отправьте код комнаты друзьям
3. Хост вставляет ссылку на фильм/серию с HDRezka
4. Все открывают эту ссылку на HDRezka
5. Гости вводят код комнаты в popup расширения (хост подключается сам)
6. Смотрите вместе

## Структура проекта

```
├── server/       # WebSocket-сервер (Express + Socket.IO)
├── web/          # Веб-интерфейс комнат (React + Vite)
├── extension/    # Расширение Chrome (MV3)
├── shared/       # Общие типы, чат, провайдеры видеосайтов
└── deploy/       # Примеры деплоя (nginx, systemd)
```

## Переменные окружения

См. [`.env.example`](.env.example).

| Переменная | По умолчанию | Описание |
|---|---|---|
| `PORT` | `3001` | Порт сервера |
| `CORS_ORIGINS` | `http://localhost:5173,...` | Разрешённые origins для CORS |
| `VITE_SERVER_URL` | `http://localhost:3001` | URL сервера для веб-приложения |
| `EXTENSION_SERVER_URL` | `http://localhost:3001` | URL сервера в сборке расширения |
| `EXTENSION_WEB_ORIGINS` | — | Origins веб-приложения для автоподключения (через запятую) |

## Продакшен

### Сервер и веб

```bash
npm run build --workspace=server
VITE_SERVER_URL=https://your-domain.example npm run build --workspace=web
```

Пример деплоя на VPS: [`deploy/deploy.sh`](deploy/deploy.sh) (нужны `DEPLOY_HOST` и `DEPLOY_DOMAIN`).

### Расширение

При деплое на свой домен пересоберите расширение с вашими URL:

```bash
EXTENSION_SERVER_URL=https://your-domain.example \
EXTENSION_WEB_ORIGINS=https://your-domain.example \
npm run build:extension
```

### Релизы расширения (GitHub)

Создайте и запушьте тег — версия в `manifest.json` подставится автоматически при сборке:

```bash
git tag extension-v1.0.1
git push origin extension-v1.0.1
```

GitHub Actions соберёт zip и опубликует его в [Releases](https://github.com/LuckyValenok/parralell-watching/releases).

Сборка использует GitHub Environment **`extension`**. Добавьте туда variables (или secrets):

| Variable | Пример | Описание |
|---|---|---|
| `EXTENSION_SERVER_URL` | `https://watch.luckyvalenok.ru` | URL sync-сервера в сборке |
| `EXTENSION_WEB_ORIGINS` | `https://watch.luckyvalenok.ru` | Origins веб-приложения (через запятую) |

Settings → Environments → **extension** → Environment variables.

Расширение само проверяет обновления через GitHub Releases API (каждые 6 часов) и показывает баннер в popup.

## Архитектура провайдеров

Новые видеосайты добавляются в `shared/providers/` — селекторы плеера и правила навигации. Сейчас реализован **HDRezka**.

## Ограничения

- Все участники должны смотреть одну и ту же серию/фильм
- Расширение — только Chromium (Chrome, Edge, Brave)
- При большой задержке сети возможен рассинхрон до ~2 секунд

## Лицензия

[MIT](LICENSE)
