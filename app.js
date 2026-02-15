// v2 frontend (+ small progress)
const WORKER_BASE_URL = "https://whitelist-upload-proxy.upb-cap-rem.workers.dev";

let idToken = null;
let config = null;
let selectedFiles = [];

function $(id){ return document.getElementById(id); }

function humanBytes(n){
  const u = ["B","KB","MB","GB"];
  let i=0, x=n;
  while(x>=1024 && i<u.length-1){ x/=1024; i++; }
  return (Math.round(x*100)/100) + " " + u[i];
}

function makeBatches(files, limitBytes){
  const batches = [];
  let cur = [];
  let sum = 0;

  for (const f of files){
    if (f.size > limitBytes){
      return { error: "ONE_FILE_TOO_LARGE_FOR_BATCH", file: f };
    }
    if (sum + f.size > limitBytes && cur.length){
      batches.push(cur);
      cur = [];
      sum = 0;
    }
    cur.push(f);
    sum += f.size;
  }
  if (cur.length) batches.push(cur);
  return { batches };
}



function setStatus(msg, kind){
  const el = $("status");
  el.textContent = msg || "";
  el.classList.remove("err","ok");
  if (kind === "err") el.classList.add("err");
  if (kind === "ok") el.classList.add("ok");
}

function setLoginStatus(msg){ $("loginStatus").textContent = msg || ""; }

function setProgress(pct, label){
  const wrap = $("progressWrap");
  const bar = $("progressBar");
  const txt = $("progressText");
  if (!wrap || !bar || !txt) return;
  wrap.classList.remove("hidden");
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  bar.style.width = p + "%";
  txt.textContent = label ? (p + "% • " + label) : (p + "%");
}

function hideProgress(){
  const wrap = $("progressWrap");
  const bar = $("progressBar");
  const txt = $("progressText");
  if (!wrap || !bar || !txt) return;
  wrap.classList.add("hidden");
  bar.style.width = "0%";
  txt.textContent = "0%";
}

function decodeJwtPayload(jwt){
  try{
    const payload = jwt.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  }catch{ return null; }
}

function totalSelectedBytes(){ return selectedFiles.reduce((s,f)=>s+(f.size||0),0); }

function renderFiles(){
  const list = $("fileList");
  list.innerHTML = "";
  const maxFile = config?.maxFileBytes ?? (20*1024*1024);
  const maxTotal = config?.maxTotalBytes ?? (20*1024*1024);
  const total = totalSelectedBytes();

  $("totalSize").textContent = humanBytes(total);

  for (let idx=0; idx<selectedFiles.length; idx++){
    const f = selectedFiles[idx];
    const row = document.createElement("div");
    row.className = "fileItem";

    const meta = document.createElement("div");
    meta.className = "fileMeta";

    const name = document.createElement("div");
    name.className = "fileName";
    name.textContent = f.name;

    const sub = document.createElement("div");
    sub.className = "fileSub";
    sub.textContent = `${humanBytes(f.size)} • ${f.type || "file"}`;

    meta.appendChild(name);
    meta.appendChild(sub);

    const actions = document.createElement("div");
    actions.className = "fileActions";

    const badge = document.createElement("span");
    badge.className = "badge " + ((f.size > maxFile) ? "bad" : "ok");
    badge.textContent = (f.size > maxFile) ? "слишком большой" : "ок";

    const rm = document.createElement("button");
    rm.className = "xbtn";
    rm.type = "button";
    rm.textContent = "✕";
    rm.addEventListener("click", ()=>{
      selectedFiles.splice(idx,1);
      renderFiles();
    });

    actions.appendChild(badge);
    actions.appendChild(rm);

    row.appendChild(meta);
    row.appendChild(actions);

    list.appendChild(row);
  }

  if (total > maxTotal) {
    setStatus(`Суммарный размер ${humanBytes(total)} больше лимита ${humanBytes(maxTotal)}. Уменьшите количество/размер.`, "err");
  } else {
    if (selectedFiles.length) setStatus("");
  }

  $("sendBtn").disabled = (selectedFiles.length === 0 || total > maxTotal || selectedFiles.some(f=>f.size>maxFile));
}

function renderRecipients(list){
  const wrap = $("recipients");
  wrap.innerHTML = "";
  if (!list?.length) { wrap.textContent = "Список получателей пуст."; return; }
  for (const r of list){
    const div = document.createElement("div");
    div.className = "recipient";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = r.email;
    cb.id = "rcp_" + r.email;

    const left = document.createElement("div");
    const t = document.createElement("div");
    t.className = "recTitle";
    t.textContent = r.label || r.email;
    const e = document.createElement("div");
    e.className = "recEmail";
    e.textContent = r.email;

    left.appendChild(t);
    left.appendChild(e);

    div.appendChild(cb);
    div.appendChild(left);

    wrap.appendChild(div);
  }
}

function filterRecipients(){
  const q = ($("rcpSearch").value || "").trim().toLowerCase();
  const items = $("recipients").querySelectorAll(".recipient");
  items.forEach(it=>{
    const txt = it.textContent.toLowerCase();
    it.style.display = txt.includes(q) ? "" : "none";
  });
}

function getSelectedRecipients(){
  const inputs = $("recipients").querySelectorAll("input[type=checkbox]");
  const out = [];
  inputs.forEach(i=>{ if (i.checked) out.push(i.value); });
  return out;
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
  if (!idToken) return setLoginStatus("Не удалось получить токен входа.");
  setLoginStatus("Вход выполнен. Загружаю настройки…");

  try {
    const { res, data } = await postForm("/config", { id_token: idToken });
    if (!res.ok || !data.ok) throw new Error(data.error || "CONFIG_FAILED");

    config = data.config;

    const payload = decodeJwtPayload(idToken);
    const email = payload?.email || config.email || "";
    $("topUser").textContent = email;
    $("topUser").classList.remove("hidden");

    $("limTotal").textContent = humanBytes(config.maxTotalBytes);
    $("limFile").textContent = humanBytes(config.maxFileBytes);

    renderRecipients(config.recipients || []);

    $("loginBox").classList.add("hidden");
    $("appBox").classList.remove("hidden");
    setStatus("");
  } catch (e) {
    console.error(e);
    setLoginStatus("Ошибка доступа. Проверьте whitelist или настройки.");
  }
};

function addFiles(fileList){
  const arr = Array.from(fileList || []);
  if (!arr.length) return;
  for (const f of arr){
    const key = f.name + "|" + f.size + "|" + f.lastModified;
    const exists = selectedFiles.some(x => (x.name + "|" + x.size + "|" + x.lastModified) === key);
    if (!exists) selectedFiles.push(f);
  }
  renderFiles();
}

async function submit(){
  hideProgress();

  if (!idToken) return setStatus("Нет токена входа. Перезайдите.", "err");
  const recipients = getSelectedRecipients();
  if (!recipients.length) return setStatus("Выберите хотя бы одного получателя.", "err");
  if (!selectedFiles.length) return setStatus("Добавьте файлы.", "err");

  const maxFile = config?.maxFileBytes ?? (20*1024*1024);
  const maxTotal = config?.maxTotalBytes ?? (20*1024*1024);
  const total = totalSelectedBytes();

  if (selectedFiles.some(f=>f.size>maxFile)) return setStatus("Есть файл больше лимита.", "err");
  if (total > maxTotal) return setStatus("Суммарный размер больше лимита.", "err");

  setStatus("Отправляю…");
  setProgress(5, "подготовка");
  $("sendBtn").disabled = true;

  const fd = new FormData();
  fd.append("id_token", idToken);
  fd.append("text", $("text").value || "");
  fd.append("recipients_json", JSON.stringify(recipients));
  for (const f of selectedFiles) fd.append("files", f, f.name);

  try{
    const data = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", WORKER_BASE_URL + "/submit", true);
      xhr.responseType = "json";

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const ratio = e.total ? (e.loaded / e.total) : 0;
        const pct = 10 + ratio * 70; // 10..80
        setProgress(pct, "загрузка");
      };

      xhr.onload = () => {
        const resp = xhr.response || {};
        if (xhr.status >= 200 && xhr.status < 300 && resp.ok) {
          setProgress(100, "готово");
          resolve(resp);
        } else {
          const err = (resp && resp.error) ? resp.error : ("HTTP_" + xhr.status);
          reject(new Error(err));
        }
      };

      xhr.onerror = () => reject(new Error("NETWORK_ERROR"));
      xhr.onabort = () => reject(new Error("ABORTED"));

      xhr.send(fd);
      setProgress(10, "загрузка");
      setProgress(85, "обработка");
    });

    setStatus(`Готово. Писем отправлено: ${data.sent || 1}`, "ok");
    selectedFiles = [];
    $("files").value = "";
    renderFiles();
  }catch(e){
    console.error(e);
    setStatus("Ошибка отправки: " + (e.message || e), "err");
  }finally{
    $("sendBtn").disabled = false;
    setTimeout(()=> hideProgress(), 1200);
  }
}

function clearDraft(){
  $("text").value = "";
  selectedFiles = [];
  $("files").value = "";
  renderFiles();
  hideProgress();
  setStatus("");
  $("textCount").textContent = "0";
}

function logout(){
  idToken = null;
  config = null;
  clearDraft();
  $("topUser").textContent = "";
  $("topUser").classList.add("hidden");
  setLoginStatus("");
  $("appBox").classList.add("hidden");
  $("loginBox").classList.remove("hidden");
}

function bind(){
  $("sendBtn").addEventListener("click", submit);
  $("clearBtn").addEventListener("click", clearDraft);
  $("logoutBtn").addEventListener("click", logout);

  $("rcpSearch").addEventListener("input", filterRecipients);
  $("rcpClear").addEventListener("click", ()=>{ $("rcpSearch").value=""; filterRecipients(); });

  $("rcpSelectAll").addEventListener("click", ()=>{
    $("recipients").querySelectorAll("input[type=checkbox]").forEach(i=> i.checked = true);
  });
  $("rcpUnselectAll").addEventListener("click", ()=>{
    $("recipients").querySelectorAll("input[type=checkbox]").forEach(i=> i.checked = false);
  });

  $("text").addEventListener("input", ()=>{
    const t = $("text").value || "";
    $("textCount").textContent = String(t.length);
  });

  $("files").addEventListener("change", (e)=> addFiles(e.target.files));

  const drop = $("drop");
  ["dragenter","dragover"].forEach(ev => drop.addEventListener(ev, (e)=>{ e.preventDefault(); drop.classList.add("drag"); }));
  ["dragleave","drop"].forEach(ev => drop.addEventListener(ev, (e)=>{ e.preventDefault(); drop.classList.remove("drag"); }));
  drop.addEventListener("drop", (e)=> addFiles(e.dataTransfer.files));

  renderFiles();
}
bind();
