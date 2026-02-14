# Variant B v2 (UI + Admin + Progress)

GitHub Pages (UI) → Cloudflare Worker (Auth + CORS + Admin) → Google Apps Script (Sheets whitelist + Gmail)

- frontend/: пользовательская форма + админка + прогресс
- worker/: Cloudflare Worker
- apps-script/: Apps Script (Sheets + Gmail)

Промежуточного хранения файлов нет (без Drive).
