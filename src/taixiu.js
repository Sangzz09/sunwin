const WebSocket = require('ws');
const express = require('express');
const { encode, decode } = require('@msgpack/msgpack');

const app = express();
const PORT = process.env.PORT || 3000;
const wsUrl = 'wss://websocket.azhkthg1.net/wsbinary?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJib3RydW10b29sdGFpeGkiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50IjpmYWxzZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjozMzgwNTc4MzIsImFmZklkIjoiU3Vud2luIiwiYmFubmVkIjpmYWxzZSwiYnJhbmQiOiJzdW4ud2luIiwiZW1haWwiOiIiLCJ0aW1lc3RhbXAiOjE3NzM0MjY0NDUyMjMsImxvY2tHYW1lcyI6W10sImFtb3VudCI6MCwibG9ja0NoYXQiOmZhbHNlLCJwaG9uZVZlcmlmaWVkIjp0cnVlLCJpcEFkZHJlc3MiOiIxNC4xNzYuMTA4LjE0OSIsIm11dGUiOmZhbHNlLCJhdmF0YXIiOiJodHRwczovL2ltYWdlcy5zd2luc2hvcC5uZXQvaW1hZ2VzL2F2YXRhci9hdmF0YXJfMTAucG5nIiwicGxhdGZvcm1JZCI6NCwidXNlcklkIjoiY2QxZTM1YTItN2M1My00MjljLTkyZDAtNWY4OTEzNTRkZWEzIiwiZW1haWxWZXJpZmllZCI6bnVsbCwicmVnVGltZSI6MTc3MjQ0NjI4MTc3MywicGhvbmUiOiI4NDg4NjAyNzc2NyIsImRlcG9zaXQiOnRydWUsInVzZXJuYW1lIjoiU0NfbWluaHNhbmdwcm8ifQ.3I4bjuTWiwqEGo2X_3NmUD9lD1flYbChL3LmRKVQxgU';

// ===================== STORAGE =====================
const MAX_HISTORY = 200;
let lichSu = [];
let phienHienTai = null;
let ketQuaMoiNhat = null;
let ws = null;
let reconnectTimeout = null;
let reconnectAttempts = 0;
const debugMessages = [];

function pushDebug(entry) {
  debugMessages.unshift(entry);
  if (debugMessages.length > 30) debugMessages.pop();
}

// ===================== HELPERS =====================
function getTaiXiu(tong) {
  if (tong == null) return null;
  return tong >= 11 ? 'Tai' : 'Xiu';
}
function getChanLe(tong) {
  if (tong == null) return null;
  return tong % 2 === 0 ? 'Chan' : 'Le';
}

function themLichSu(record) {
  if (record.phien && lichSu.some(r => r.phien == record.phien)) return;
  lichSu.unshift(record);
  if (lichSu.length > MAX_HISTORY) lichSu.pop();
  ketQuaMoiNhat = record;
  console.log(`Phien ${record.phien} | Xuc xac: ${record.x1}-${record.x2}-${record.x3} | Tong: ${record.tong} | ${record.taiXiu} ${record.chanLe}`);
}

// ===================== PARSE MSGPACK =====================
function handleDecoded(obj, raw) {
  const str = JSON.stringify(obj);
  pushDebug({ time: new Date().toISOString(), decoded: str.slice(0, 400), raw });
  console.log('MSG decoded:', str.slice(0, 200));

  // obj thường là array: [type, data, ...]
  // Dựa vào type (số hoặc string) để xử lý
  if (Array.isArray(obj)) {
    const [type, data] = obj;

    // Type 1 hoặc 'result' = kết quả
    // Thử tìm dice values trong data
    tryExtract(type, data, obj);
  } else if (typeof obj === 'object') {
    tryExtract(null, obj, obj);
  }
}

function tryExtract(type, data, full) {
  if (!data && data !== 0) return;

  // Nếu data là array (nested msgpack array)
  if (Array.isArray(data)) {
    // Thử tìm 3 số liên tiếp trong range 1-6 (xúc xắc)
    const found = findDice(data);
    if (found) {
      const { x1, x2, x3, phien } = found;
      const tong = x1 + x2 + x3;
      themLichSu({ phien, x1, x2, x3, tong, taiXiu: getTaiXiu(tong), chanLe: getChanLe(tong), thoiGian: new Date().toISOString() });
    }
    return;
  }

  if (typeof data === 'object' && data !== null) {
    // Tìm các field phổ biến
    const x1 = data.d1 ?? data.dice1 ?? data.xucXac1 ?? data[1];
    const x2 = data.d2 ?? data.dice2 ?? data.xucXac2 ?? data[2];
    const x3 = data.d3 ?? data.dice3 ?? data.xucXac3 ?? data[3];
    const tong = data.total ?? data.tong ?? data.sum ?? (x1 && x2 && x3 ? x1+x2+x3 : null);
    const phien = data.sessionId ?? data.phien ?? data.id ?? data.roundId ?? phienHienTai;

    if (tong != null && tong >= 3 && tong <= 18) {
      themLichSu({ phien, x1, x2, x3, tong, taiXiu: getTaiXiu(tong), chanLe: getChanLe(tong), thoiGian: new Date().toISOString() });
    }
  }
}

function findDice(arr) {
  // Tìm 3 số liên tiếp trong 1-6
  for (let i = 0; i < arr.length - 2; i++) {
    const a = arr[i], b = arr[i+1], c = arr[i+2];
    if (Number.isInteger(a) && Number.isInteger(b) && Number.isInteger(c) &&
        a >= 1 && a <= 6 && b >= 1 && b <= 6 && c >= 1 && c <= 6) {
      return { x1: a, x2: b, x3: c, phien: arr[0] ?? phienHienTai };
    }
  }
  // Đệ quy tìm trong nested arrays
  for (const item of arr) {
    if (Array.isArray(item)) {
      const found = findDice(item);
      if (found) return found;
    }
  }
  return null;
}

// ===================== WEBSOCKET =====================
function sendMsg(payload) {
  if (!ws || ws.readyState !== 1) return;
  try {
    const buf = Buffer.from(encode(payload));
    ws.send(buf);
    console.log('Sent msgpack:', JSON.stringify(payload));
  } catch(e) {
    console.error('Send error:', e.message);
  }
}

function connect() {
  if (reconnectAttempts > 0) console.error(`Reconnecting (lan ${reconnectAttempts})...`);

  if (ws) { ws.removeAllListeners(); try { ws.close(); } catch {} }
  if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }

  ws = new WebSocket(wsUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Origin': 'https://sun.win',
      'Referer': 'https://sun.win/'
    },
    perMessageDeflate: false
  });

  ws.on('open', () => {
    console.log('WebSocket connected!');
    reconnectAttempts = 0;

    // Gửi subscribe bằng MessagePack (đúng format server yêu cầu)
    setTimeout(() => {
      // Format array phổ biến của Sun.win: [type, data]
      // type thường là số nguyên
      sendMsg([1, { game: 'taixiu' }]);
      sendMsg([2, { game: 'taixiu' }]);
      sendMsg([3, 'taixiu']);
      sendMsg([10, {}]);
      sendMsg([11, {}]);
      // Format Sun.win dùng số + gameId
      sendMsg([1, 1]);
      sendMsg([2, 1]);
      sendMsg([5, 1]);
      // Heartbeat/join
      sendMsg([0]);
      sendMsg([1]);
    }, 500);
  });

  ws.on('message', (data) => {
    try {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const hex = buf.toString('hex');

      // Chỉ log 4 bytes đầu để không spam
      console.log(`MSG ${buf.length}B hex_start: ${hex.slice(0,16)}`);

      // Skip heartbeat 4 bytes
      if (buf.length <= 4) {
        pushDebug({ time: new Date().toISOString(), type: 'heartbeat', hex });
        return;
      }

      // Decode msgpack
      try {
        const decoded = decode(buf);
        handleDecoded(decoded, hex.slice(0, 100));
        return;
      } catch {}

      // Fallback: skip 1-4 byte header rồi decode
      for (let skip = 1; skip <= 6; skip++) {
        try {
          const decoded = decode(buf.slice(skip));
          console.log(`Decoded with skip=${skip}`);
          handleDecoded(decoded, hex.slice(0, 100));
          return;
        } catch {}
      }

      // Fallback JSON
      try {
        const json = JSON.parse(buf.toString('utf8'));
        handleDecoded(json, hex.slice(0, 100));
        return;
      } catch {}

      pushDebug({ time: new Date().toISOString(), type: 'unknown', hex: hex.slice(0, 200) });
    } catch(e) {
      console.error('Parse error:', e.message);
    }
  });

  ws.on('error', (err) => {
    console.error('WS Error:', err.message);
    reconnectAttempts++;
    scheduleReconnect();
  });

  ws.on('close', (code, reason) => {
    console.warn(`WS Closed: ${code} ${reason}`);
    reconnectAttempts++;
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  const delay = Math.min(3000 * reconnectAttempts, 30000);
  reconnectTimeout = setTimeout(connect, delay);
}

// ===================== API =====================
app.get('/debug', (req, res) => {
  res.json({ wsStatus: ws ? (['CONNECTING','OPEN','CLOSING','CLOSED'][ws.readyState]) : 'null', reconnectAttempts, msgs: debugMessages });
});

app.get('/api/taixiu/latest', (req, res) => {
  res.json({ phienHienTai, ketQuaMoiNhat, tongPhienDaLuu: lichSu.length });
});

app.get('/api/taixiu/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, MAX_HISTORY);
  const history = lichSu.slice(0, limit);
  let tai = 0, xiu = 0, chan = 0, le = 0;
  for (const r of history) {
    if (r.taiXiu === 'Tai') tai++;
    if (r.taiXiu === 'Xiu') xiu++;
    if (r.chanLe === 'Chan') chan++;
    if (r.chanLe === 'Le') le++;
  }
  let chuoiHienTai = 0;
  const loaiChuoi = history[0]?.taiXiu;
  for (const r of history) {
    if (r.taiXiu === loaiChuoi) chuoiHienTai++; else break;
  }
  res.json({
    tongPhien: lichSu.length,
    hienThi: history.length,
    thongKe: { tai, xiu, chan, le,
      tiLeTai: history.length ? ((tai/history.length)*100).toFixed(1)+'%' : '0%',
      tiLeXiu: history.length ? ((xiu/history.length)*100).toFixed(1)+'%' : '0%'
    },
    chuoiHienTai: { loai: loaiChuoi || null, soLuong: chuoiHienTai },
    lichSu: history
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: ws && ws.readyState === 1 ? 'healthy' : 'unhealthy',
    websocket: ws ? (['CONNECTING','OPEN','CLOSING','CLOSED'][ws.readyState]) : 'not_initialized',
    reconnectAttempts,
    tongPhienDaLuu: lichSu.length,
    ketQuaMoiNhat: ketQuaMoiNhat ? `${ketQuaMoiNhat.taiXiu} (${ketQuaMoiNhat.tong})` : 'chua co'
  });
});

app.get('/', (req, res) => {
  const wsStatus = ws && ws.readyState === 1;
  const cau = lichSu.slice(0, 20).map(r => r.taiXiu === 'Tai' ? 'T' : 'X').join(' ');
  res.send(`<!DOCTYPE html><html><head><title>Tai Xiu API</title><meta http-equiv="refresh" content="5"><meta charset="utf-8">
  <style>body{font-family:Arial,sans-serif;margin:40px;background:#0d1117;color:#e6edf3}h1{color:#f0883e}.card{border:1px solid #30363d;padding:20px;margin:10px 0;border-radius:8px;background:#161b22}.ok{border-left:4px solid #3fb950}.err{border-left:4px solid #f85149}a{color:#58a6ff}.tai{color:#f85149;font-weight:bold}.xiu{color:#58a6ff;font-weight:bold}</style></head>
  <body><h1>Tai Xiu API - Sun.win</h1>
  <div class="card ${wsStatus?'ok':'err'}"><h3>WebSocket</h3><p>${wsStatus?'Connected':'Disconnected'} | Reconnect: ${reconnectAttempts}</p></div>
  <div class="card ok"><h3>Ket qua moi nhat</h3>${ketQuaMoiNhat?`<p>Phien: <b>${ketQuaMoiNhat.phien||'?'}</b> | Xuc xac: <b>${ketQuaMoiNhat.x1}-${ketQuaMoiNhat.x2}-${ketQuaMoiNhat.x3}</b> | Tong: <b>${ketQuaMoiNhat.tong}</b></p><p>Ket qua: <span class="${ketQuaMoiNhat.taiXiu==='Tai'?'tai':'xiu'}">${ketQuaMoiNhat.taiXiu}</span> | ${ketQuaMoiNhat.chanLe}</p>`:'<p>Chua co</p>'}</div>
  <div class="card"><h3>Cau 20 phien: ${cau||'(chua co)'}</h3><p>Da luu: <b>${lichSu.length}</b> phien</p></div>
  <div class="card"><h3>Endpoints</h3><ul>
  <li><a href="/api/taixiu/history">/api/taixiu/history</a></li>
  <li><a href="/api/taixiu/latest">/api/taixiu/latest</a></li>
  <li><a href="/debug">/debug</a></li>
  <li><a href="/health">/health</a></li>
  </ul></div></body></html>`);
});

app.listen(PORT, () => {
  console.log(`Server chay tren port ${PORT}`);
  connect();
});

process.on('SIGINT', () => {
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  if (ws) try { ws.close(); } catch {}
  process.exit(0);
});
