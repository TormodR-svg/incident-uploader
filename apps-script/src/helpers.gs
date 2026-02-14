function prop_(k, req) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  if (req && (!v || String(v).trim()==="")) throw new Error("Missing Script Property: " + k);
  return v;
}

function cfg_() {
  var maxEmail = parseInt(prop_("MAX_EMAIL_BYTES", false) || String(20*1024*1024), 10);
  var subj = prop_("SUBJECT_PREFIX", false) || "Web → Email";
  return {
    INTERNAL_SECRET: prop_("INTERNAL_SECRET", true),
    ADMIN_EMAIL: String(prop_("ADMIN_EMAIL", true)).toLowerCase(),
    SPREADSHEET_ID: prop_("SPREADSHEET_ID", true),
    MAX_EMAIL_BYTES: isNaN(maxEmail) ? (20*1024*1024) : maxEmail,
    SUBJECT_PREFIX: subj
  };
}

function nowIso_(){ return new Date().toISOString(); }

function jsonOut_(obj) {
  var out = ContentService.createTextOutput(JSON.stringify(obj));
  out.setMimeType(ContentService.MimeType.JSON);
  return out;
}

function packBlobs_(items, limitBytes) {
  var batches = [];
  var current = [];
  var sum = 0;
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (it.bytes > limitBytes) return { error: "ONE_FILE_TOO_LARGE", file: it };
    if (sum + it.bytes > limitBytes && current.length) {
      batches.push(current);
      current = [];
      sum = 0;
    }
    current.push(it);
    sum += it.bytes;
  }
  if (current.length) batches.push(current);
  return { batches: batches };
}
