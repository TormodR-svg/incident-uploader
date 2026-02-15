// v3 rebuild: JSON submit + client-side batching (no multipart parsing in Worker)
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
  wrap.classList.remove("hidden");
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  bar.style.width = p + "%";
  txt.textContent = label ? (p + "% • " + label) : (p + "%");
}

function hideProgress(){
  const wrap = $("progressWrap");
  wrap.classList.add("hidden");
  $("progressBar").style.width = "0%";
  $("progressText").textContent = "0%";
}

function decodeJwtPayload(jwt){
  try{
    const payload = jwt.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  }catch{ return null; }
}

function totalSelectedBytes(){ return selectedFiles.reduce((s,f)=>s+(f.size||0),0); }

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

function renderFiles(){
  const list = $("fileList");
  list.innerHTML = "";

  const maxFile = config?.maxFileBytes ?? (10*1024*1024);
  const maxPack = config?.maxTotalBytes ?? (10*1024*1024);
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

  const plan = makeBatches(selectedFiles, maxPack);
  if (plan.error) {
    setStatus(`Файл "${plan.file.name}" (${humanBytes(plan.file.size)}) больше лимита на файл ${humanBytes(maxFile)}. Уменьшите/сожмите.`, "err");
  } else if (selectedFiles.length && total > maxPack) {
    setStatus(`Суммарно ${humanBytes(total)}. Будет отправлено пакетами: ${plan.batches.length}.`, "");
  } else {
    if (selectedFiles.length) setStatus("");
  }

  $("sendBtn").disabled = (selectedFiles.length === 0 || selectedFiles.some(f=>f.size>maxFile));
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

    $("limPack").textContent = humanBytes(config.maxTotalBytes);
    $("limFile").textContent = humanBytes(config.maxFileBytes);

    renderRecipients(config.recipients || []);

    $("loginBox").classList.add("hidden");
    $("appBox").classList.remove("hidden");
    setStatus("");
    renderFiles();
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

function fileToB64(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      const i = s.indexOf("base64,");
      resolve(i >= 0 ? s.slice(i + 7) : "");
    };
    r.onerror = () => reject(new Error("FILE_READ_ERROR"));
    r.readAsDataURL(file);
  });
}

async function sendBatchJSON(filesBatch, recipients, text, batchIndex, batchTotal){
  const payloadFiles = [];

  for (let i=0;i<filesBatch.length;i++){
    const f = filesBatch[i];
    const pct = ((batchIndex / batchTotal) * 100) + ((i / filesBatch.length) * (100 / batchTotal) * 0.8);
    setProgress(pct, `подготовка ${batchIndex+1}/${batchTotal}`);
    const b64 = await fileToB64(f);
    payloadFiles.push({ name: f.name, mime: f.type || "application/octet-stream", b64 });
  }

  const payload = {
    id_token: idToken,
    text,
    recipients,
    files: payloadFiles
  };

  const res = await fetch(WORKER_BASE_URL + "/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(()=>({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || ("HTTP_" + res.status));
  }
  return data.sent || 1;
}

async function submit(){
  hideProgress();

  if (!idToken) return setStatus("Нет токена входа. Перезайдите.", "err");

  const recipients = getSelectedRecipients();
  if (!recipients.length) return setStatus("Выберите хотя бы одного получателя.", "err");
  if (!selectedFiles.length) return setStatus("Добавьте файлы.", "err");

  const maxFile = config?.maxFileBytes ?? (10*1024*1024);
  const maxPack = config?.maxTotalBytes ?? (10*1024*1024);
  if (selectedFiles.some(f => f.size > maxFile)) {
    return setStatus("Есть файл больше лимита. Уменьшите/сожмите файл.", "err");
  }

  const plan = makeBatches(selectedFiles, maxPack);
  if (plan.error) {
    return setStatus(`Файл "${plan.file.name}" слишком большой.`, "err");
  }

  const batches = plan.batches;
  const baseText = $("text").value || "";
  $("sendBtn").disabled = true;

  let totalSentEmails = 0;

  try{
    setStatus(`Отправляю… пакетов: ${batches.length}`);
    for (let b=0;b<batches.length;b++){
      const partText = (batches.length > 1) ? `${baseText}\n\nПакет ${b+1}/${batches.length}` : baseText;
      setProgress((b / batches.length) * 100, `пакет ${b+1}/${batches.length}`);
      const sent = await sendBatchJSON(batches[b], recipients, partText, b, batches.length);
      totalSentEmails += sent;
    }

    setProgress(100, "готово");
    setStatus(`Готово. Пакетов: ${batches.length}. Писем отправлено: ${totalSentEmails}.`, "ok");

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
