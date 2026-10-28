# CRM школы танцев

Веб-приложение на React + Vite + Supabase. Хостинг: GitHub Pages.

## 1. Подключение к Supabase
Откройте `src/config.ts` и подставьте два значения из Supabase (Project Settings -> API):
- `SUPABASE_URL` — Project URL;
- `SUPABASE_ANON_KEY` — ключ **anon public**.

Ключ `service_role` сюда вставлять нельзя. Защита данных работает на сервере (RLS),
anon-ключ публичный по замыслу.

## 2. Публикация на GitHub Pages
1. Создайте **публичный** репозиторий и загрузите в него все файлы проекта
   (включая папку `.github`; на Mac показать скрытые папки: Cmd+Shift+.).
2. Репозиторий -> Settings -> Pages -> Build and deployment -> Source: **GitHub Actions**.
3. Вкладка Actions: дождитесь зелёной галочки у «Публикация на GitHub Pages» (1-2 минуты).
4. Адрес сайта: `https://<логин>.github.io/<репозиторий>/`.

После каждого изменения файлов в ветке `main` сайт пересобирается автоматически.

## 3. Запуск на своём компьютере (необязательно)
Нужен Node.js 20+.
```
npm install
npm run dev
```

## 4. Чтобы бесплатный проект Supabase не засыпал
1. Выполните в Supabase (SQL Editor) файл `migrations/005_ping.sql`.
2. В репозитории: Settings -> Secrets and variables -> Actions -> вкладка **Variables** -> New repository variable.
   Создайте две переменные: `SUPABASE_URL` (Project URL) и `SUPABASE_ANON_KEY` (anon public key).
3. Вкладка Actions -> «Пинг Supabase» -> Run workflow. Должна появиться зелёная галочка.
4. Дальше пинг идёт сам дважды в неделю.
Если в репозитории 60 дней нет изменений, GitHub отключает расписание. Тогда на вкладке Actions
нажмите «Enable workflow» или внесите любое изменение в репозиторий.
