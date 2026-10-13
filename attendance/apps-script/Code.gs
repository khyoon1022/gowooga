/**
 * 고우에프앤비 출퇴근 기록 - 서버(Google Apps Script)
 *
 * 시트 구성 (setup() 실행 시 자동 생성)
 *  - 직원: 사번 | 이름 | 매장 | PIN | 사용여부(Y/N)
 *  - 기록: 근무일 | 사번 | 이름 | 매장 | 출근시각 | 퇴근시각 | 근무시간(분)
 *  - 설정: 항목 | 값   (관리자비밀번호)
 *
 * 시각은 모두 서버(구글) 시각으로 기록하므로 휴대폰 시계 조작이 반영되지 않습니다.
 */

var TZ = 'Asia/Seoul';
var SHEET_EMP = '직원';
var SHEET_LOG = '기록';
var SHEET_CFG = '설정';
var TOKEN_TTL = 6 * 60 * 60;        // 로그인 유지 6시간
var OPEN_SHIFT_HOURS = 20;          // 출근 후 20시간 이내 퇴근만 같은 근무로 처리(자정 넘김 대응)
var MAX_FAIL = 5;                   // PIN 연속 실패 허용 횟수
var LOCK_SEC = 10 * 60;             // 초과 시 잠금 10분

/* ---------- 초기 설정 ---------- */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEET_EMP, ['사번', '이름', '매장', 'PIN', '사용여부']);
  ensureSheet_(ss, SHEET_LOG, ['근무일', '사번', '이름', '매장', '출근시각', '퇴근시각', '근무시간(분)']);
  var cfg = ensureSheet_(ss, SHEET_CFG, ['항목', '값']);
  if (cfg.getLastRow() < 2) cfg.appendRow(['관리자비밀번호', 'change-me']);
  // PIN·사번 앞자리 0이 지워지지 않도록 텍스트 서식
  ss.getSheetByName(SHEET_EMP).getRange('A:D').setNumberFormat('@');
  ss.getSheetByName(SHEET_LOG).getRange('A:B').setNumberFormat('@');
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f1f3f4');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ---------- HTTP 진입점 ---------- */

function doPost(e) {
  var res;
  try {
    var req = JSON.parse(e.postData.contents);
    var handlers = {
      login: login_,
      status: status_,
      punch: punch_,
      myRecords: myRecords_,
      adminLogin: adminLogin_,
      adminDay: adminDay_
    };
    var fn = handlers[req.action];
    if (!fn) throw new Error('알 수 없는 요청입니다.');
    res = { ok: true, data: fn(req) };
  } catch (err) {
    res = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(res))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput('OK');
}

/* ---------- 직원 ---------- */

function login_(req) {
  var id = String(req.empId || '').trim();
  var pin = String(req.pin || '').trim();
  var cache = CacheService.getScriptCache();
  var failKey = 'fail_' + id;
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_FAIL) throw new Error('PIN을 ' + MAX_FAIL + '회 틀려 10분간 잠겼습니다.');

  var emp = findEmployee_(id);
  if (!emp || emp.pin !== pin) {
    cache.put(failKey, String(fails + 1), LOCK_SEC);
    throw new Error('사번 또는 PIN이 올바르지 않습니다.');
  }
  cache.remove(failKey);
  var token = Utilities.getUuid();
  cache.put('tok_' + token, emp.id, TOKEN_TTL);
  return { token: token, name: emp.name, store: emp.store, status: currentStatus_(emp.id) };
}

function status_(req) {
  return currentStatus_(requireEmployee_(req.token).id);
}

function punch_(req) {
  var emp = requireEmployee_(req.token);
  var type = req.type; // 'in' | 'out'
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_(SHEET_LOG);
    var now = new Date();
    var open = findOpenShift_(emp.id, now);

    if (type === 'in') {
      if (open) throw new Error('이미 출근 처리되어 있습니다. (' + fmt_(open.inAt, 'MM/dd HH:mm') + ')');
      sh.appendRow([fmt_(now, 'yyyy-MM-dd'), emp.id, emp.name, emp.store, now, '', '']);
      return { type: 'in', at: fmt_(now, 'HH:mm:ss'), status: currentStatus_(emp.id) };
    }
    if (type === 'out') {
      if (!open) throw new Error('출근 기록이 없습니다. 출근을 먼저 눌러 주세요.');
      var minutes = Math.round((now - open.inAt) / 60000);
      sh.getRange(open.row, 6, 1, 2).setValues([[now, minutes]]);
      return { type: 'out', at: fmt_(now, 'HH:mm:ss'), minutes: minutes, status: currentStatus_(emp.id) };
    }
    throw new Error('잘못된 요청입니다.');
  } finally {
    lock.releaseLock();
  }
}

function myRecords_(req) {
  var emp = requireEmployee_(req.token);
  var month = String(req.month || fmt_(new Date(), 'yyyy-MM')); // yyyy-MM
  var rows = logRows_().filter(function (r) {
    return r.empId === emp.id && r.date.indexOf(month) === 0;
  });
  rows.sort(function (a, b) { return b.inAt - a.inAt; });
  var total = 0;
  var list = rows.map(function (r) {
    if (r.minutes) total += r.minutes;
    return {
      date: r.date,
      inAt: fmt_(r.inAt, 'HH:mm'),
      outAt: r.outAt ? fmt_(r.outAt, 'HH:mm') : '',
      outNextDay: r.outAt ? fmt_(r.outAt, 'yyyy-MM-dd') !== r.date : false,
      minutes: r.minutes || 0
    };
  });
  return { month: month, records: list, totalMinutes: total, days: list.length };
}

/* ---------- 관리자 ---------- */

function adminLogin_(req) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('fail_admin') || 0);
  if (fails >= MAX_FAIL) throw new Error('비밀번호를 ' + MAX_FAIL + '회 틀려 10분간 잠겼습니다.');
  if (String(req.password || '') !== getConfig_('관리자비밀번호')) {
    cache.put('fail_admin', String(fails + 1), LOCK_SEC);
    throw new Error('비밀번호가 올바르지 않습니다.');
  }
  cache.remove('fail_admin');
  var token = Utilities.getUuid();
  cache.put('adm_' + token, '1', TOKEN_TTL);
  return { token: token };
}

function adminDay_(req) {
  if (!CacheService.getScriptCache().get('adm_' + req.token)) throw new Error('관리자 로그인이 만료되었습니다.');
  var date = String(req.date || fmt_(new Date(), 'yyyy-MM-dd'));
  var emps = employees_().filter(function (e) { return e.active; });
  var byEmp = {};
  logRows_().forEach(function (r) {
    if (r.date === date) (byEmp[r.empId] = byEmp[r.empId] || []).push(r);
  });

  var list = emps.map(function (e) {
    var recs = (byEmp[e.id] || []).sort(function (a, b) { return a.inAt - b.inAt; });
    var first = recs[0];
    var last = recs[recs.length - 1];
    var status = !first ? 'absent' : (last.outAt ? 'done' : 'working');
    var minutes = recs.reduce(function (s, r) { return s + (r.minutes || 0); }, 0);
    return {
      empId: e.id, name: e.name, store: e.store, status: status,
      inAt: first ? fmt_(first.inAt, 'HH:mm') : '',
      outAt: last && last.outAt ? fmt_(last.outAt, 'HH:mm') : '',
      minutes: minutes
    };
  });
  return { date: date, employees: list };
}

/* ---------- 내부 도우미 ---------- */

function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('"' + name + '" 시트가 없습니다. setup()을 먼저 실행하세요.');
  return sh;
}

function employees_() {
  var v = sheet_(SHEET_EMP).getDataRange().getDisplayValues().slice(1);
  return v.filter(function (r) { return r[0]; }).map(function (r) {
    return {
      id: String(r[0]).trim(), name: r[1], store: r[2],
      pin: String(r[3]).trim(), active: String(r[4]).trim().toUpperCase() !== 'N'
    };
  });
}

function findEmployee_(id) {
  var list = employees_().filter(function (e) { return e.id === id && e.active; });
  return list[0] || null;
}

function requireEmployee_(token) {
  var id = CacheService.getScriptCache().get('tok_' + token);
  var emp = id && findEmployee_(id);
  if (!emp) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
  return emp;
}

function logRows_() {
  var sh = sheet_(SHEET_LOG);
  var v = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < v.length; i++) {
    if (!v[i][1]) continue;
    out.push({
      row: i + 1,
      date: v[i][0] instanceof Date ? fmt_(v[i][0], 'yyyy-MM-dd') : String(v[i][0]),
      empId: String(v[i][1]).trim(),
      inAt: v[i][4] instanceof Date ? v[i][4] : null,
      outAt: v[i][5] instanceof Date ? v[i][5] : null,
      minutes: Number(v[i][6]) || 0
    });
  }
  return out.filter(function (r) { return r.inAt; });
}

// 퇴근하지 않은 가장 최근 출근 기록 (자정을 넘긴 근무 포함)
function findOpenShift_(empId, now) {
  var limit = OPEN_SHIFT_HOURS * 3600 * 1000;
  var rows = logRows_();
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i];
    if (r.empId !== empId) continue;
    if (!r.outAt && now - r.inAt < limit) return r;
    return null; // 해당 직원의 가장 최근 기록만 확인
  }
  return null;
}

function currentStatus_(empId) {
  var open = findOpenShift_(empId, new Date());
  return open ? { working: true, since: fmt_(open.inAt, 'MM/dd HH:mm') } : { working: false };
}

function getConfig_(key) {
  var v = sheet_(SHEET_CFG).getDataRange().getDisplayValues();
  for (var i = 1; i < v.length; i++) if (v[i][0] === key) return String(v[i][1]);
  return '';
}

function fmt_(d, pattern) {
  return Utilities.formatDate(d, TZ, pattern);
}
