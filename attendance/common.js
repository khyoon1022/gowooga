// 서버(Apps Script) 호출 공통 함수
// Content-Type을 지정하지 않아 text/plain으로 전송 → CORS 사전요청 없이 동작
async function api(action, payload) {
  const url = window.ATTENDANCE_API_URL;
  if (!url || url.indexOf('PASTE_') === 0) {
    throw new Error('config.js에 서버 주소가 설정되지 않았습니다.');
  }
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(Object.assign({ action }, payload || {}))
    });
  } catch (e) {
    throw new Error('네트워크 연결을 확인해 주세요.');
  }
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || '처리 중 오류가 발생했습니다.');
  return json.data;
}

function fmtMinutes(min) {
  if (!min) return '-';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}시간 ${m}분` : `${m}분`;
}

function todayStr() {
  const d = new Date(Date.now() + 9 * 3600 * 1000); // KST
  return d.toISOString().slice(0, 10);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
