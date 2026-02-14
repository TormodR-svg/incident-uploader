function doPost(e) {
  var c = cfg_();
  ensureSheets_();

  var k = (e && e.parameter) ? e.parameter.k : null;
  if (!k || String(k) !== String(c.INTERNAL_SECRET)) {
    return jsonOut_({ ok:false, error:"FORBIDDEN" });
  }

  var payload;
  try { payload = JSON.parse(e.postData.contents); }
  catch(err){ return jsonOut_({ ok:false, error:"BAD_JSON" }); }

  var action = String(payload.action || "").trim();
  if (!action) return jsonOut_({ ok:false, error:"NO_ACTION" });

  try {
    if (action === "config") return jsonOut_(handleConfig_(payload));
    if (action === "submit") return jsonOut_(handleSubmit_(payload));
    if (action.indexOf("admin.") === 0) return jsonOut_(handleAdmin_(payload));
    return jsonOut_({ ok:false, error:"UNKNOWN_ACTION" });
  } catch (err2) {
    return jsonOut_({ ok:false, error:"EXCEPTION", details:String(err2.message || err2) });
  }
}

function userAllowed_(emailLower) {
  var u = findBy_("users", "email", emailLower);
  if (!u) return { ok:false, error:"NOT_IN_WHITELIST" };
  var active = String(u.row.active).toLowerCase();
  if (active === "false" || active === "0" || active === "") return { ok:false, error:"USER_BLOCKED" };
  upsert_("users", "email", { email: emailLower, last_seen_at: nowIso_() });
  return { ok:true };
}

function activeRecipients_() {
  var all = getAll_("recipients").map(function(x){ return x.row; });
  return all.filter(function(r){
    var a = String(r.active).toLowerCase();
    return !(a === "false" || a === "0" || a === "");
  }).map(function(r){ return { label:String(r.label||""), email:String(r.email||"").toLowerCase() }; });
}

function handleConfig_(p) {
  var sender = String(p.senderEmail || "").toLowerCase();
  if (!sender) return { ok:false, error:"MISSING_SENDER" };

  var ua = userAllowed_(sender);
  if (!ua.ok) return ua;

  var maxFile = parseInt(p.maxFileBytes || "", 10);
  var maxTotal = parseInt(p.maxTotalBytes || "", 10);
  if (!maxFile || isNaN(maxFile)) maxFile = 20*1024*1024;
  if (!maxTotal || isNaN(maxTotal)) maxTotal = 20*1024*1024;

  return {
    ok:true,
    config: { email: sender, recipients: activeRecipients_(), maxFileBytes: maxFile, maxTotalBytes: maxTotal }
  };
}

function recipientsAllowed_(emailsLower) {
  var allow = {};
  activeRecipients_().forEach(function(r){ allow[r.email] = true; });
  for (var i=0;i<emailsLower.length;i++){
    if (!allow[String(emailsLower[i]).toLowerCase()]) return false;
  }
  return true;
}

function handleSubmit_(p) {
  var c = cfg_();
  var sender = String(p.senderEmail || "").toLowerCase();
  var text = String(p.text || "");
  var recipients = p.recipients || [];
  var files = p.files || [];

  if (!sender) return { ok:false, error:"MISSING_SENDER" };
  var ua = userAllowed_(sender);
  if (!ua.ok) return ua;

  if (!Array.isArray(recipients) || recipients.length < 1) return { ok:false, error:"NO_RECIPIENTS" };
  var rcps = recipients.map(function(x){ return String(x).toLowerCase(); });
  if (!recipientsAllowed_(rcps)) return { ok:false, error:"RECIPIENT_NOT_ALLOWED" };

  if (!Array.isArray(files) || files.length < 1) return { ok:false, error:"NO_FILES" };

  var items = [];
  var totalBytes = 0;
  for (var i=0;i<files.length;i++){
    var f = files[i];
    var name = String(f.name || ("file_" + i));
    var mime = String(f.mime || "application/octet-stream");
    var b64 = String(f.b64 || "");
    if (!b64) return { ok:false, error:"BAD_FILE" };

    var bytes = Utilities.base64Decode(b64);
    var blob = Utilities.newBlob(bytes, mime, name);
    var sz = bytes.length;
    totalBytes += sz;
    items.push({ name:name, mime:mime, bytes:sz, blob:blob });
  }

  var packed = packBlobs_(items, c.MAX_EMAIL_BYTES);
  var reqId = Utilities.getUuid();

  if (packed.error) {
    appendLog_({ ts: nowIso_(), sender_email: sender, recipients: rcps.join(","), files_count: items.length, total_bytes: totalBytes, status: "error", error: "ONE_FILE_TOO_LARGE", request_id: reqId });
    return { ok:false, error:"ONE_FILE_TOO_LARGE", details:{ name: packed.file.name, size: packed.file.bytes, limit: c.MAX_EMAIL_BYTES } };
  }

  var subjectBase = c.SUBJECT_PREFIX + " " + (new Date()).toLocaleString();
  var body = (text ? text : "(без текста)") + "\n\nОтправитель: " + sender + "\nReqId: " + reqId;
  var toLine = rcps.join(",");

  try {
    for (var b=0;b<packed.batches.length;b++){
      var part = (packed.batches.length > 1) ? (" [" + (b+1) + "/" + packed.batches.length + "]") : "";
      var subject = subjectBase + part;
      var attachments = packed.batches[b].map(function(x){ return x.blob; });
      GmailApp.sendEmail(toLine, subject, body, { attachments: attachments, replyTo: sender });
    }
    appendLog_({ ts: nowIso_(), sender_email: sender, recipients: rcps.join(","), files_count: items.length, total_bytes: totalBytes, status: "ok", error: "", request_id: reqId });
    return { ok:true, sent: packed.batches.length, request_id: reqId };
  } catch (err) {
    appendLog_({ ts: nowIso_(), sender_email: sender, recipients: rcps.join(","), files_count: items.length, total_bytes: totalBytes, status: "error", error: String(err.message || err), request_id: reqId });
    return { ok:false, error:"SEND_FAILED" };
  }
}

function requireAdmin_(actorEmailLower) {
  var c = cfg_();
  if (!actorEmailLower || String(actorEmailLower).toLowerCase() !== c.ADMIN_EMAIL) throw new Error("NOT_ADMIN");
}

function handleAdmin_(p) {
  var act = String(p.action||"");
  var actor = String(p.actorEmail||"").toLowerCase();
  requireAdmin_(actor);

  if (act === "admin.ping") return { ok:true };

  if (act === "admin.users.list") {
    var users = getAll_("users").map(function(x){
      var r = x.row;
      return { email:String(r.email||""), role:String(r.role||"user"), active: !!r.active, added_at:String(r.added_at||""), last_seen_at:String(r.last_seen_at||"") };
    });
    return { ok:true, users: users };
  }

  if (act === "admin.users.add") {
    var email = String(p.email||"").toLowerCase();
    if (!email) return { ok:false, error:"MISSING_EMAIL" };
    upsert_("users", "email", { email: email, role: "user", active: true, added_at: nowIso_() });
    return { ok:true };
  }

  if (act === "admin.users.set_active") {
    var email2 = String(p.email||"").toLowerCase();
    var active = String(p.active||"") === "1";
    if (!email2) return { ok:false, error:"MISSING_EMAIL" };
    var ok = setActive_("users", "email", email2, active);
    if (!ok) return { ok:false, error:"NOT_FOUND" };
    return { ok:true };
  }

  if (act === "admin.recipients.list") {
    var rec = getAll_("recipients").map(function(x){
      var r=x.row;
      return { label:String(r.label||""), email:String(r.email||"").toLowerCase(), active: !!r.active, added_at:String(r.added_at||"") };
    });
    return { ok:true, recipients: rec };
  }

  if (act === "admin.recipients.upsert") {
    var email3 = String(p.email||"").toLowerCase();
    var label = String(p.label||"");
    if (!email3) return { ok:false, error:"MISSING_EMAIL" };
    upsert_("recipients", "email", { email: email3, label: label, active: true, added_at: nowIso_() });
    return { ok:true };
  }

  if (act === "admin.recipients.set_active") {
    var email4 = String(p.email||"").toLowerCase();
    var active2 = String(p.active||"") === "1";
    if (!email4) return { ok:false, error:"MISSING_EMAIL" };
    var ok2 = setActive_("recipients", "email", email4, active2);
    if (!ok2) return { ok:false, error:"NOT_FOUND" };
    return { ok:true };
  }

  if (act === "admin.logs.list") {
    var all = getAll_("logs");
    var rows = all.slice(Math.max(0, all.length-200)).reverse().map(function(x){
      var r=x.row;
      return {
        ts:String(r.ts||""),
        sender_email:String(r.sender_email||""),
        recipients:String(r.recipients||""),
        files_count:r.files_count || 0,
        total_bytes:r.total_bytes || 0,
        status:String(r.status||""),
        error:String(r.error||""),
        request_id:String(r.request_id || "")
      };
    });
    return { ok:true, logs: rows };
  }

  return { ok:false, error:"UNKNOWN_ADMIN_ACTION" };
}
