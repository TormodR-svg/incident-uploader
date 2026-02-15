import { jwtVerify, createRemoteJWKSet } from "jose";

const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

const cors = (origin) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
});

function badJson(msg, origin, code = 400) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status: code,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origin) }
  });
}

function okJson(obj, origin) {
  return new Response(JSON.stringify({ ok: true, ...obj }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origin) }
  });
}

function clampInt(x, defVal) {
  const n = parseInt(String(x || ""), 10);
  return Number.isFinite(n) ? n : defVal;
}

async function verifyIdToken(idToken, env) {
  const aud = env.GOOGLE_CLIENT_ID;
  if (!aud) throw new Error("MISSING_GOOGLE_CLIENT_ID");
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: aud
  });
  return payload;
}

async function readFormUrlEncoded(req) {
  const text = await req.text();
  const p = new URLSearchParams(text);
  const out = {};
  for (const [k,v] of p.entries()) out[k] = v;
  return out;
}

function toBase64(u8) {
  const CHUNK = 0x8000;
  let s = "";
  for (let i = 0; i < u8.length; i += CHUNK) {
    const sub = u8.subarray(i, i + CHUNK);
    s += String.fromCharCode.apply(null, sub);
  }
  return btoa(s);
}

async function callAppsScript(env, payload) {
  const url = env.APPS_SCRIPT_URL;
  if (!url) throw new Error("MISSING_APPS_SCRIPT_URL");
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const txt = await resp.text();
  let data = {};
  try { data = JSON.parse(txt); } catch { data = { ok:false, error:"BAD_APPS_RESPONSE", raw: txt }; }
  if (!data || data.ok === false) throw new Error(data.error || "APPS_ERROR");
  return data;
}

function isAdminEmail(env, email) {
  const admin = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  return admin && String(email || "").trim().toLowerCase() === admin;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "*";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });

    const url = new URL(request.url);
    const path = url.pathname;

    const maxFileBytes = clampInt(env.MAX_FILE_BYTES, 20 * 1024 * 1024);
    const maxTotalBytes = clampInt(env.MAX_TOTAL_BYTES, 20 * 1024 * 1024);

    if (request.method === "POST" && path === "/config") {
      const { id_token } = await readFormUrlEncoded(request);
      if (!id_token) return badJson("MISSING_ID_TOKEN", origin);

      let payload;
      try { payload = await verifyIdToken(id_token, env); }
      catch { return badJson("INVALID_ID_TOKEN", origin, 401); }

      const email = String(payload.email || "").toLowerCase();
      if (!email || !payload.email_verified) return badJson("EMAIL_NOT_VERIFIED", origin, 403);

      try{
        const data = await callAppsScript(env, { action:"config", senderEmail: email, maxFileBytes, maxTotalBytes });
        return okJson({ config: data.config }, origin);
      }catch(e){
        return badJson(String(e.message || e), origin, 502);
      }
    }

    if (url.pathname === "/submit") {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors(origin) });

  // Просто проксируем тело запроса в Apps Script (stream), без парсинга.
  const upstream = await fetch(env.APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": request.headers.get("Content-Type") || "application/json" },
    body: request.body,
  });

  const txt = await upstream.text();
  return new Response(txt, {
    status: upstream.status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origin) },
  });
}

      if (!ct.includes("multipart/form-data")) return badJson("EXPECTED_MULTIPART", origin);

      const form = await request.formData();
      const idToken = form.get("id_token");
      const text = String(form.get("text") || "");
      const recipientsJson = String(form.get("recipients_json") || "[]");
      const files = form.getAll("files");

      if (!idToken) return badJson("MISSING_ID_TOKEN", origin);
      if (!files.length) return badJson("NO_FILES", origin);

      let payload;
      try { payload = await verifyIdToken(String(idToken), env); }
      catch { return badJson("INVALID_ID_TOKEN", origin, 401); }

      const email = String(payload.email || "").toLowerCase();
      if (!email || !payload.email_verified) return badJson("EMAIL_NOT_VERIFIED", origin, 403);

      let recipients;
      try { recipients = JSON.parse(recipientsJson); } catch { return badJson("BAD_RECIPIENTS_JSON", origin); }
      if (!Array.isArray(recipients) || recipients.length < 1) return badJson("NO_RECIPIENTS", origin);

      let total = 0;
      const outFiles = [];
      for (const f of files) {
        if (!(f instanceof File)) continue;
        if (f.size > maxFileBytes) return badJson("FILE_TOO_LARGE", origin, 413);
        total += f.size;
        if (total > maxTotalBytes) return badJson("TOTAL_TOO_LARGE", origin, 413);
        const bytes = new Uint8Array(await f.arrayBuffer());
        outFiles.push({ name: f.name || "file", mime: f.type || "application/octet-stream", b64: toBase64(bytes) });
      }

      try{
        const data = await callAppsScript(env, { action:"submit", senderEmail: email, text, recipients, files: outFiles });
        return okJson({ sent: data.sent || 1 }, origin);
      }catch(e){
        return badJson(String(e.message || e), origin, 502);
      }
    }

    if (request.method === "POST" && path.startsWith("/admin/")) {
      const { id_token, ...rest } = await readFormUrlEncoded(request);
      if (!id_token) return badJson("MISSING_ID_TOKEN", origin);

      let payload;
      try { payload = await verifyIdToken(id_token, env); }
      catch { return badJson("INVALID_ID_TOKEN", origin, 401); }

      const email = String(payload.email || "").toLowerCase();
      if (!email || !payload.email_verified) return badJson("EMAIL_NOT_VERIFIED", origin, 403);
      if (!isAdminEmail(env, email)) return badJson("NOT_ADMIN", origin, 403);

      const actionMap = {
        "/admin/ping": "admin.ping",
        "/admin/users/list": "admin.users.list",
        "/admin/users/add": "admin.users.add",
        "/admin/users/set_active": "admin.users.set_active",
        "/admin/recipients/list": "admin.recipients.list",
        "/admin/recipients/upsert": "admin.recipients.upsert",
        "/admin/recipients/set_active": "admin.recipients.set_active",
        "/admin/logs/list": "admin.logs.list",
      };
      const action = actionMap[path];
      if (!action) return badJson("NOT_FOUND", origin, 404);

      try{
        const data = await callAppsScript(env, { action, actorEmail: email, ...rest });
        return okJson(data, origin);
      }catch(e){
        return badJson(String(e.message || e), origin, 502);
      }
    }

    return badJson("NOT_FOUND", origin, 404);
  }
};
