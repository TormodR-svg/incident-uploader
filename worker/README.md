# Worker (Cloudflare)

Endpoints:
- POST /config
- POST /submit
- POST /admin/* (только ADMIN_EMAIL)

Vars/secrets:
- GOOGLE_CLIENT_ID
- APPS_SCRIPT_URL  (включая ?k=INTERNAL_SECRET)
- ADMIN_EMAIL
- MAX_FILE_BYTES
- MAX_TOTAL_BYTES
