# Share Messenger

React + TypeScript + Vite + Supabase. Сообщения шифруются на клиенте (AES-256-GCM) до отправки в БД.

## 1. Supabase (SQL)

1. Открой проект → **SQL Editor** → New query  
2. Вставь весь файл `supabase/schema.sql` → **Run**  
3. **Authentication → Providers → Email**: выключи **Confirm email** (для теста), иначе регистрация потребует письмо  
4. **Authentication → URL Configuration**: добавь `http://localhost:5173` и URL деплоя  
5. (Опционально) **Project Settings → API**: перевыпусти anon/publishable key — старый был в чате

## 2. Локально

```bash
npm install
# опционально .env:
# VITE_SUPABASE_URL=https://xxx.supabase.co
# VITE_SUPABASE_ANON_KEY=sb_publishable_...
npm run dev
```

Зарегистрируй **два** аккаунта (два браузера / инкогнито) и переписывайся — realtime + галочки прочтения.

## 3. Бесплатный деплой (Vercel)

1. Залей репозиторий на GitHub  
2. [vercel.com](https://vercel.com) → Import project  
3. Framework: Vite  
4. Environment Variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy → получишь `https://xxx.vercel.app`  
6. В Supabase Auth → Redirect URLs добавь этот домен  

Альтернативы бесплатно: **Netlify**, **Cloudflare Pages** (то же: build `npm run build`, out `dist`).

## 4. Безопасность

- В БД только **ciphertext + iv**, не plaintext  
- RLS: сообщения видят только участники диалога  
- Пароли — через Supabase Auth (не храним сами)  
- Publishable/anon ключ можно в фронте; **service_role никогда не в клиент**  
- Ключ шифрования чата выводится из пары username (PBKDF2). Это защита от утечки БД; полный E2E (Signal) — следующий этап  
- Смени `APP_PEPPER` в `src/lib/crypto.ts` перед продом  

## 5. Структура SQL (кратко)

| Таблица | Назначение |
|--------|------------|
| profiles | username, имя, online, last_seen |
| conversations | диалоги |
| conversation_members | кто в диалоге |
| messages | ciphertext, iv, content_type |
| message_reads | кто прочитал |

Функции: `get_or_create_dm`, `set_online`.
