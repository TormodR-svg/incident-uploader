function ss_() {
  var c = cfg_();
  return SpreadsheetApp.openById(c.SPREADSHEET_ID);
}

function sh_(name) { return ss_().getSheetByName(name); }

function ensureSheets_() {
  var s = ss_();
  var need = {
    "users": ["email","role","active","added_at","last_seen_at"],
    "recipients": ["label","email","active","added_at"],
    "logs": ["ts","sender_email","recipients","files_count","total_bytes","status","error","request_id"]
  };
  Object.keys(need).forEach(function(n){
    var sh = s.getSheetByName(n);
    if (!sh) sh = s.insertSheet(n);
    var want = need[n];
    var headers = sh.getRange(1,1,1,want.length).getValues()[0];
    if (!headers[0]) sh.getRange(1,1,1,want.length).setValues([want]);
  });
}

function getAll_(sheetName) {
  var sh = sh_(sheetName);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(String);
  var out = [];
  for (var i=1;i<values.length;i++){
    var row = {};
    for (var j=0;j<headers.length;j++) row[headers[j]] = values[i][j];
    out.push({ rowIndex: i+1, row: row });
  }
  return out;
}

function findBy_(sheetName, key, valueLower) {
  var rows = getAll_(sheetName);
  for (var i=0;i<rows.length;i++){
    var v = String(rows[i].row[key] || "").toLowerCase();
    if (v === valueLower) return rows[i];
  }
  return null;
}

function upsert_(sheetName, key, obj) {
  var sh = sh_(sheetName);
  var values = sh.getDataRange().getValues();
  var headers = values[0].map(String);
  var vKey = String(obj[key] || "").toLowerCase();

  var found = findBy_(sheetName, key, vKey);
  var rowIndex = found ? found.rowIndex : (sh.getLastRow()+1);

  var base = found ? found.row : {};
  var outObj = {};
  headers.forEach(function(h){ outObj[h] = base[h]; });
  Object.keys(obj).forEach(function(k){ outObj[k] = obj[k]; });

  var row = headers.map(function(h){ return outObj[h] || ""; });
  sh.getRange(rowIndex,1,1,headers.length).setValues([row]);
  return rowIndex;
}

function setActive_(sheetName, key, valueLower, active) {
  var found = findBy_(sheetName, key, valueLower);
  if (!found) return false;
  var sh = sh_(sheetName);
  var values = sh.getDataRange().getValues();
  var headers = values[0].map(String);
  var idx = headers.indexOf("active");
  if (idx < 0) return false;
  sh.getRange(found.rowIndex, idx+1).setValue(active ? true : false);
  return true;
}

function appendLog_(obj) {
  var sh = sh_("logs");
  sh.appendRow([
    obj.ts || nowIso_(),
    obj.sender_email || "",
    obj.recipients || "",
    obj.files_count || 0,
    obj.total_bytes || 0,
    obj.status || "",
    obj.error || "",
    obj.request_id || ""
  ]);
}
