const WORKER_BASE_URL = "https://whitelist-upload-proxy.upb-cap-rem.workers.dev";
let idToken = null;

function $(id){ return document.getElementById(id); }

function setStatus(msg, kind){
  const el = $("status");
  el.textContent = msg || "";
  el.classList.remove("err","ok");
  if (kind === "err") el.classList.add("err");
  if (kind === "ok") el.classList.add("ok");
}

function setLoginStatus(msg){ $("loginStatus").textContent = msg || ""; }

function decodeJwtPayload(jwt){
  try{
    const payload = jwt.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  }catch{ return null; }
}

async function postForm(endpoint, params){
  const body = new URLSearchParams(params);
  const res = await fetch(WORKER_BASE_URL + endpoint, {
    method:"POST",
    headers: {"Content-Type":"application/x-www-form-urlencoded"},
    body
  });
  const data = await res.json().catch(()=>({}));
  return { res, data };
}

window.onGoogleCredential = async function(response){
  idToken = response.credential;
  if (!idToken) return setLoginStatus("Не удалось получить токен.");

  setLoginStatus("Проверяю доступ…");
  try{
    const { res, data } = await postForm("/admin/ping", { id_token: idToken });
    if (!res.ok || !data.ok) throw new Error(data.error || "NOT_ADMIN");

    const payload = decodeJwtPayload(idToken);
    $("topUser").textContent = payload?.email || "admin";
    $("topUser").classList.remove("hidden");

    $("loginBox").classList.add("hidden");
    $("adminBox").classList.remove("hidden");

    setStatus("Готово.", "ok");
    await refreshAll();
  }catch(e){
    console.error(e);
    setLoginStatus("Доступ запрещён.");
  }
};

function switchTab(name){
  document.querySelectorAll(".tab").forEach(b=> b.classList.toggle("active", b.dataset.tab === name));
  ["users","recipients","logs"].forEach(t=>{
    const pane = $("tab_" + t);
    pane.classList.toggle("hidden", t !== name);
  });
}

function renderTable(containerId, cols, rows){
  const el = $(containerId);
  if (!rows?.length){
    el.innerHTML = "<div class='muted'>Нет данных.</div>";
    return;
  }
  let html = "<table><thead><tr>";
  for (const c of cols) html += `<th>${c.label}</th>`;
  html += "<th></th></tr></thead><tbody>";

  for (const r of rows){
    html += "<tr>";
    for (const c of cols){
      const v = (r[c.key] ?? "");
      html += `<td>${String(v)}</td>`;
    }
    html += `<td class="actions">${r._actions || ""}</td>`;
    html += "</tr>";
  }
  html += "</tbody></table>";
  el.innerHTML = html;
}

async function listUsers(){
  const { res, data } = await postForm("/admin/users/list", { id_token: idToken });
  if (!res.ok || !data.ok) throw new Error(data.error || "LIST_USERS_FAILED");

  const users = data.users || [];
  const rows = users.map(u=>{
    const active = String(u.active).toLowerCase() === "true";
    const btn = active
      ? `<button class="small secondary" data-act="block" data-email="${u.email}">Блок</button>`
      : `<button class="small secondary" data-act="unblock" data-email="${u.email}">Разблок</button>`;
    return { ...u, _actions: btn };
  });

  renderTable("usersTable",
    [
      {key:"email", label:"Email"},
      {key:"role", label:"Роль"},
      {key:"active", label:"Active"},
      {key:"added_at", label:"Добавлен"},
      {key:"last_seen_at", label:"Last seen"},
    ],
    rows
  );

  $("usersTable").querySelectorAll("button[data-act]").forEach(b=>{
    b.addEventListener("click", async ()=>{
      const act = b.dataset.act;
      const email = b.dataset.email;
      await setUserActive(email, act === "unblock");
    });
  });
}

async function addUser(){
  const email = ($("newUserEmail").value || "").trim();
  if (!email) return setStatus("Введите email.", "err");
  const { res, data } = await postForm("/admin/users/add", { id_token: idToken, email });
  if (!res.ok || !data.ok) return setStatus("Ошибка: " + (data.error || "ADD_FAILED"), "err");
  $("newUserEmail").value = "";
  setStatus("Пользователь добавлен/обновлён.", "ok");
  await listUsers();
}

async function setUserActive(email, active){
  const { res, data } = await postForm("/admin/users/set_active", { id_token: idToken, email, active: active ? "1" : "0" });
  if (!res.ok || !data.ok) return setStatus("Ошибка: " + (data.error || "SET_ACTIVE_FAILED"), "err");
  setStatus("Готово.", "ok");
  await listUsers();
}

async function listRecipients(){
  const { res, data } = await postForm("/admin/recipients/list", { id_token: idToken });
  if (!res.ok || !data.ok) throw new Error(data.error || "LIST_RECIPIENTS_FAILED");

  const rec = data.recipients || [];
  const rows = rec.map(r=>{
    const active = String(r.active).toLowerCase() === "true";
    const btn = active
      ? `<button class="small secondary" data-act="disable" data-email="${r.email}">Выключить</button>`
      : `<button class="small secondary" data-act="enable" data-email="${r.email}">Включить</button>`;
    return { ...r, _actions: btn };
  });

  renderTable("recipientsTable",
    [
      {key:"label", label:"Label"},
      {key:"email", label:"Email"},
      {key:"active", label:"Active"},
      {key:"added_at", label:"Добавлен"},
    ],
    rows
  );

  $("recipientsTable").querySelectorAll("button[data-act]").forEach(b=>{
    b.addEventListener("click", async ()=>{
      const act = b.dataset.act;
      const email = b.dataset.email;
      await setRecipientActive(email, act === "enable");
    });
  });
}

async function upsertRecipient(){
  const label = ($("rcpLabel").value || "").trim();
  const email = ($("rcpEmail").value || "").trim();
  if (!email) return setStatus("Введите email получателя.", "err");

  const { res, data } = await postForm("/admin/recipients/upsert", { id_token: idToken, label, email });
  if (!res.ok || !data.ok) return setStatus("Ошибка: " + (data.error || "UPSERT_FAILED"), "err");

  $("rcpLabel").value = "";
  $("rcpEmail").value = "";
  setStatus("Получатель сохранён.", "ok");
  await listRecipients();
}

async function setRecipientActive(email, active){
  const { res, data } = await postForm("/admin/recipients/set_active", { id_token: idToken, email, active: active ? "1" : "0" });
  if (!res.ok || !data.ok) return setStatus("Ошибка: " + (data.error || "SET_RCP_ACTIVE_FAILED"), "err");
  setStatus("Готово.", "ok");
  await listRecipients();
}

async function listLogs(){
  const { res, data } = await postForm("/admin/logs/list", { id_token: idToken });
  if (!res.ok || !data.ok) throw new Error(data.error || "LIST_LOGS_FAILED");
  const logs = data.logs || [];
  const rows = logs.map(x=> ({...x, _actions:""}));

  renderTable("logsTable",
    [
      {key:"ts", label:"Время"},
      {key:"sender_email", label:"Отправитель"},
      {key:"recipients", label:"Кому"},
      {key:"files_count", label:"Файлы"},
      {key:"total_bytes", label:"Bytes"},
      {key:"status", label:"Статус"},
      {key:"error", label:"Ошибка"},
      {key:"request_id", label:"ReqId"},
    ],
    rows
  );
}

async function refreshAll(){
  await listUsers();
  await listRecipients();
  await listLogs();
}

function logout(){
  idToken = null;
  $("adminBox").classList.add("hidden");
  $("loginBox").classList.remove("hidden");
  $("topUser").classList.add("hidden");
  $("topUser").textContent = "";
  setLoginStatus("");
  setStatus("");
}

function bind(){
  document.querySelectorAll(".tab").forEach(b=>{
    b.addEventListener("click", ()=> switchTab(b.dataset.tab));
  });
  $("logoutBtn").addEventListener("click", logout);
  $("addUserBtn").addEventListener("click", addUser);
  $("saveRcpBtn").addEventListener("click", upsertRecipient);
  $("refreshLogsBtn").addEventListener("click", async ()=>{ setStatus("Обновляю…"); await listLogs(); setStatus("Готово.", "ok"); });
}
bind();
