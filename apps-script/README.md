# Apps Script (v2)

Хранит whitelist и логи в Google Sheets, отправляет Gmail.

## Script Properties
- INTERNAL_SECRET
- ADMIN_EMAIL
- SPREADSHEET_ID
- MAX_EMAIL_BYTES (например 20971520)
- SUBJECT_PREFIX

## Deploy Web App
Deploy → New deployment → Web app
- Execute as: Me
- Who has access: Anyone

Worker будет обращаться по URL:
`https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?k=<INTERNAL_SECRET>`
