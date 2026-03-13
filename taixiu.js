const WebSocket = require('ws');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const wsUrl = 'wss://websocket.azhkthg1.net/wsbinary?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJib3RydW10b29sdGFpeGkiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50IjpmYWxzZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjozMzgwNTc4MzIsImFmZklkIjoiU3Vud2luIiwiYmFubmVkIjpmYWxzZSwiYnJhbmQiOiJzdW4ud2luIiwiZW1haWwiOiIiLCJ0aW1lc3RhbXAiOjE3NzM0MjY0NDUyMjMsImxvY2tHYW1lcyI6W10sImFtb3VudCI6MCwibG9ja0NoYXQiOmZhbHNlLCJwaG9uZVZlcmlmaWVkIjp0cnVlLCJpcEFkZHJlc3MiOiIxNC4xNzYuMTA4LjE0OSIsIm11dGUiOmZhbHNlLCJhdmF0YXIiOiJodHRwczovL2ltYWdlcy5zd2luc2hvcC5uZXQvaW1hZ2VzL2F2YXRhci9hdmF0YXJfMTAucG5nIiwicGxhdGZvcm1JZCI6NCwidXNlcklkIjoiY2QxZTM1YTItN2M1My00MjljLTkyZDAtNWY4OTEzNTRkZWEzIiwiZW1haWxWZXJpZmllZCI6bnVsbCwicmVnVGltZSI6MTc3MjQ0NjI4MTc3MywicGhvbmUiOiI4NDg4NjAyNzc2NyIsImRlcG9zaXQiOnRydWUsInVzZXJuYW1lIjoiU0NfbWluaHNhbmdwcm8ifQ.3I4bjuTWiwqEGo2X_3NmUD9lD1flYbChL3LmRKVQxgU';

// ===================== STORAGE =====================
const MAX_HISTORY = 200; // Lưu tối đa 200 phiên

let lichSu = [];         // Mảng lịch sử kết quả
let phienHienTai = null; // Phiên đang chờ kết quả
let ketQuaMoiNhat = null; // Kết quả mới nhất

let ws = null;
let reconnectTimeout = null;
let reconnectAttempts = 0;
let lastRawDebug = null; // Lưu raw data để debug

// ===================== PARSE HELPERS =====================

/**
 * Xác định Tài/Xỉu từ tổng điểm 3 xúc xắc
 * Tài: tổng >= 11, Xỉu: tổng <= 10
 */
function getTaiXiu(tong) {
  if (tong === null || tong === undefined) return null;
  return tong >= 11 ? 'Tài' : 'Xỉu';
}

/**
 * Xác định Chẵn/Lẻ từ tổng điểm
 */
function getChanLe(tong) {
  if (tong === null || tong === undefined) return null;
  return tong % 2 === 0 ? 'Chẵn' : 'Lẻ';
}

/**
 * Thử parse data nhận về từ WebSocket binary
 * Sun.win thường dùng JSON-over-binary hoặc protobuf
 */
function parseMessage(data) {
  try {
    // Chuyển Buffer → string, thử JSON
    const str = data.toString('utf8');
    const json = JSON.parse(str);
    return { type: 'json', data: json };
  } catch {}

  try {
    // Một số server dùng JSON từ offset nhất định
    const str = data.toString('utf8').replace(/[^\x20-\x7E\u00C0-\u024F\u4E00-\u9FFF]/g, '');
    const startIdx = str.indexOf('{');
    if (startIdx !== -1) {
      const json = JSON.parse(str.slice(startIdx));
      return { type: 'json_stripped', data: json };
    }
  } catch {}

  // Trả về raw hex để debug nếu không parse được
  return { type: 'binary', raw: data.toString('hex').slice(0, 200) };
}

/**
 * Trích xuất thông tin Tài Xỉu từ JSON đã parse
 * Hỗ trợ nhiều format khác nhau của Sun.win
 */
function extractTaiXiuData(json) {
  if (!json || typeof json !== 'object') return null;

  // Format 1: { type, data: { phien, xucXac1, xucXac2, xucXac3, tong } }
  if (json.data) {
    const d = json.data;
    const phien = d.phien || d.sessionId || d.gameId || d.id || d.roundId;
    const x1 = d.xucXac1 ?? d.dice1 ?? d.d1 ?? d.dice?.[0];
    const x2 = d.xucXac2 ?? d.dice2 ?? d.d2 ?? d.dice?.[1];
    const x3 = d.xucXac3 ?? d.dice3 ?? d.d3 ?? d.dice?.[2];
    const tong = d.tong ?? d.total ?? d.sum ?? (x1 && x2 && x3 ? x1 + x2 + x3 : null);

    if (tong !== null && tong !== undefined) {
      return { phien, x1, x2, x3, tong };
    }
  }

  // Format 2: flat object { sessionId, dice1, dice2, dice3, total }
  const phien = json.phien || json.sessionId || json.gameId || json.roundId || json.id;
  const x1 = json.xucXac1 ?? json.dice1 ?? json.d1 ?? json.dice?.[0];
  const x2 = json.xucXac2 ?? json.dice2 ?? json.d2 ?? json.dice?.[1];
  const x3 = json.xucXac3 ?? json.dice3 ?? json.d3 ?? json.dice?.[2];
  const tong = json.tong ?? json.total ?? json.sum ?? (x1 && x2 && x3 ? x1 + x2 + x3 : null);

  if (tong !== null && tong !== undefined) {
    return { phien, x1, x2, x3, tong };
  }

  // Format 3: mảng kết quả lịch sử { results: [...] }
  const arr = json.results || json.history || json.list;
  if (Array.isArray(arr) && arr.length > 0) {
    return { isHistory: true, arr };
  }

  return null;
}

/**
 * Thêm kết quả mới vào lịch sử
 */
function themLichSu(record) {
  // Tránh duplicate theo phien
  if (record.phien && lichSu.some(r => r.phien === record.phien)) return;

  lichSu.unshift(record); // Mới nhất lên đầu
  if (lichSu.length > MAX_HISTORY) lichSu.pop();
  ketQuaMoiNhat = record;

  console.log(`✅ Phiên ${record.phien || '?'} | Xúc xắc: ${record.x1}-${record.x2}-${record.x3} | Tổng: ${record.tong} | ${record.taiXiu} ${record.chanLe}`);
}

// ===================== WEBSOCKET =====================

function connect() {
  if (reconnectAttempts > 0) {
    console.error(`🔄 Reconnecting (lần ${reconnectAttempts})...`);
  }

  if (ws) {
    ws.removeAllListeners();
    try { ws.close(); } catch {}
  }

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  ws = new WebSocket(wsUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Origin': 'https://sun.win',
      'Referer': 'https://sun.win/'
    },
    perMessageDeflate: false
  });

  ws.on('open', () => {
    console.log('✅ WebSocket connected!');
    reconnectAttempts = 0;
  });

  ws.on('message', (data) => {
    try {
      const parsed = parseMessage(data);
      lastRawDebug = parsed.type === 'binary' ? parsed.raw : JSON.stringify(parsed.data).slice(0, 300);

      if (parsed.type === 'binary') {
        // Chưa parse được — log để debug
        console.log('🔍 Binary raw (hex):', parsed.raw);
        return;
      }

      const json = parsed.data;

      // --- Lấy phiên hiện tại (đang chờ kết quả) ---
      if (json.type === 'newSession' || json.type === 'new_session' || json.type === 'session') {
        phienHienTai = json.data?.phien || json.data?.sessionId || json.sessionId || json.phien;
        console.log(`🎲 Phiên mới: ${phienHienTai}`);
        return;
      }

      // --- Lấy kết quả ---
      if (json.type === 'result' || json.type === 'gameResult' || json.type === 'game_result' ||
          json.type === 'end' || json.type === 'endGame' || json.type === 'end_game') {
        const info = extractTaiXiuData(json);
        if (info && !info.isHistory) {
          themLichSu({
            phien:    info.phien || phienHienTai,
            x1:       info.x1,
            x2:       info.x2,
            x3:       info.x3,
            tong:     info.tong,
            taiXiu:   getTaiXiu(info.tong),
            chanLe:   getChanLe(info.tong),
            thoiGian: new Date().toISOString()
          });
        }
        return;
      }

      // --- Nhận lịch sử từ server (thường gửi khi mới connect) ---
      if (json.type === 'history' || json.type === 'histories' || json.type === 'getHistory') {
        const info = extractTaiXiuData(json);
        if (info?.isHistory) {
          console.log(`📜 Nhận ${info.arr.length} phiên lịch sử từ server`);
          for (const item of [...info.arr].reverse()) {
            const x1 = item.xucXac1 ?? item.dice1 ?? item.d1 ?? item.dice?.[0];
            const x2 = item.xucXac2 ?? item.dice2 ?? item.d2 ?? item.dice?.[1];
            const x3 = item.xucXac3 ?? item.dice3 ?? item.d3 ?? item.dice?.[2];
            const tong = item.tong ?? item.total ?? item.sum ?? (x1 && x2 && x3 ? x1 + x2 + x3 : null);
            if (tong !== null) {
              themLichSu({
                phien:    item.phien || item.sessionId || item.id,
                x1, x2, x3, tong,
                taiXiu:   getTaiXiu(tong),
                chanLe:   getChanLe(tong),
                thoiGian: item.thoiGian || item.time || item.createdAt || new Date().toISOString()
              });
            }
          }
        }
        return;
      }

      // --- Fallback: thử extract trực tiếp nếu message chứa tổng ---
      const info = extractTaiXiuData(json);
      if (info && !info.isHistory && info.tong) {
        themLichSu({
          phien:    info.phien || phienHienTai,
          x1:       info.x1,
          x2:       info.x2,
          x3:       info.x3,
          tong:     info.tong,
          taiXiu:   getTaiXiu(info.tong),
          chanLe:   getChanLe(info.tong),
          thoiGian: new Date().toISOString()
        });
      }

    } catch (e) {
      console.error('❌ Parse error:', e.message);
    }
  });

  ws.on('error', (err) => {
    console.error('❌ WS Error:', err.message);
    reconnectAttempts++;
    scheduleReconnect();
  });

  ws.on('close', (code, reason) => {
    console.warn(`⚠️  WS Closed: ${code} ${reason}`);
    reconnectAttempts++;
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  const delay = Math.min(3000 * reconnectAttempts, 30000); // tối đa 30s
  reconnectTimeout = setTimeout(connect, delay);
}

// ===================== API =====================

// Kết quả mới nhất
app.get('/api/taixiu/latest', (req, res) => {
  res.json({
    phienHienTai,
    ketQuaMoiNhat,
    tongPhienDaLuu: lichSu.length
  });
});

// Lịch sử cầu
app.get('/api/taixiu/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, MAX_HISTORY);
  const history = lichSu.slice(0, limit);

  // Thống kê chuỗi (cầu)
  let cauTai = 0, cauXiu = 0, cauChan = 0, cauLe = 0;
  for (const r of history) {
    if (r.taiXiu === 'Tài') cauTai++;
    if (r.taiXiu === 'Xỉu') cauXiu++;
    if (r.chanLe === 'Chẵn') cauChan++;
    if (r.chanLe === 'Lẻ') cauLe++;
  }

  // Chuỗi liên tiếp hiện tại
  let chuoiHienTai = 0;
  const loaiChuoi = history[0]?.taiXiu;
  for (const r of history) {
    if (r.taiXiu === loaiChuoi) chuoiHienTai++;
    else break;
  }

  res.json({
    tongPhien: lichSu.length,
    hienThi: history.length,
    thongKe: {
      tai: cauTai,
      xiu: cauXiu,
      chan: cauChan,
      le: cauLe,
      tiLeTai: history.length ? ((cauTai / history.length) * 100).toFixed(1) + '%' : '0%',
      tiLeXiu: history.length ? ((cauXiu / history.length) * 100).toFixed(1) + '%' : '0%',
    },
    chuoiHienTai: {
      loai: loaiChuoi || null,
      soLuong: chuoiHienTai
    },
    lichSu: history
  });
});

// Health check (Render dùng cái này để giữ server sống)
app.get('/health', (req, res) => {
  res.json({
    status: ws && ws.readyState === 1 ? 'healthy' : 'unhealthy',
    websocket: ws ? (['CONNECTING','OPEN','CLOSING','CLOSED'][ws.readyState] || 'unknown') : 'not_initialized',
    reconnectAttempts,
    tongPhienDaLuu: lichSu.length,
    ketQuaMoiNhat: ketQuaMoiNhat ? `${ketQuaMoiNhat.taiXiu} (${ketQuaMoiNhat.tong})` : 'chưa có',
    debug_lastRaw: lastRawDebug
  });
});

// Trang chủ
app.get('/', (req, res) => {
  const wsStatus = ws && ws.readyState === 1;
  const cau = lichSu.slice(0, 20).map(r => r.taiXiu === 'Tài' ? '🔴' : '🔵').join(' ');

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Tài Xỉu API - Sun.win</title>
        <meta http-equiv="refresh" content="5">
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; background: #0d1117; color: #e6edf3; }
          h1 { color: #f0883e; }
          .card { border: 1px solid #30363d; padding: 20px; margin: 10px 0; border-radius: 8px; background: #161b22; }
          .ok { border-left: 4px solid #3fb950; }
          .err { border-left: 4px solid #f85149; }
          code { background: #21262d; padding: 2px 6px; border-radius: 4px; }
          a { color: #58a6ff; }
          .tai { color: #f85149; font-weight: bold; }
          .xiu { color: #58a6ff; font-weight: bold; }
          .cau { font-size: 22px; letter-spacing: 4px; }
        </style>
      </head>
      <body>
        <h1>🎲 Tài Xỉu API - Sun.win</h1>

        <div class="card ${wsStatus ? 'ok' : 'err'}">
          <h3>🔌 WebSocket</h3>
          <p>${wsStatus ? '✅ Đang kết nối' : '❌ Mất kết nối'} &nbsp;|&nbsp; Reconnect: ${reconnectAttempts} lần</p>
        </div>

        <div class="card ok">
          <h3>🎯 Kết quả mới nhất</h3>
          ${ketQuaMoiNhat ? `
            <p>Phiên: <strong>${ketQuaMoiNhat.phien || '?'}</strong></p>
            <p>Xúc xắc: <strong>${ketQuaMoiNhat.x1} - ${ketQuaMoiNhat.x2} - ${ketQuaMoiNhat.x3}</strong> &nbsp;|&nbsp; Tổng: <strong>${ketQuaMoiNhat.tong}</strong></p>
            <p>Kết quả: <span class="${ketQuaMoiNhat.taiXiu === 'Tài' ? 'tai' : 'xiu'}">${ketQuaMoiNhat.taiXiu}</span> &nbsp;|&nbsp; ${ketQuaMoiNhat.chanLe}</p>
          ` : '<p>Chưa có kết quả</p>'}
        </div>

        <div class="card">
          <h3>📊 Cầu 20 phiên gần nhất</h3>
          <div class="cau">${cau || '(chưa có dữ liệu)'}</div>
          <p style="font-size:12px; color:#8b949e">🔴 Tài &nbsp; 🔵 Xỉu</p>
          <p>Đã lưu: <strong>${lichSu.length}</strong> phiên</p>
        </div>

        <div class="card">
          <h3>📡 Endpoints</h3>
          <ul>
            <li><a href="/api/taixiu/history">/api/taixiu/history</a> — Lịch sử + thống kê cầu</li>
            <li><a href="/api/taixiu/history?limit=100">/api/taixiu/history?limit=100</a> — 100 phiên gần nhất</li>
            <li><a href="/api/taixiu/latest">/api/taixiu/latest</a> — Kết quả mới nhất</li>
            <li><a href="/health">/health</a> — Health check + debug</li>
          </ul>
        </div>
      </body>
    </html>
  `);
});

// ===================== KHỞI ĐỘNG =====================
app.listen(PORT, () => {
  console.log(`🚀 Server chạy trên port ${PORT}`);
  console.log(`🎲 API: http://localhost:${PORT}/api/taixiu/history`);
  console.log(`🏥 Health: http://localhost:${PORT}/health`);
  connect();
});

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  if (ws) try { ws.close(); } catch {}
  process.exit(0);
});
