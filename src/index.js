import fastify from "fastify";
import cors from "@fastify/cors";
import WebSocket from "ws";

// --- CẤU HÌNH ---
const PORT = 3000;
const WS_URL = "wss://websocket.azhkthg1.net/websocket?token=";
const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJzYW5nZGVwemFpMDlubyIsImJvdCI6MCwiaXNNZXJjaGFudCI6ZmFsc2UsInZlcmlmaWVkQmFua0FjY291bnQiOnRydWUsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MjIxNjQwNjcyLCJhZmZJZCI6IlN1bndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoic3VuLndpbiIsInRpbWVzdGFtcCI6MTc2NTg5MTk3NDM0MywibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOnRydWUsImlwQWRkcmVzcyI6IjExMy4xNzQuNzguMjU1IiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8xNS5wbmciLCJwbGF0Zm9ybUlkIjo0LCJ1c2VySWQiOiI3ODRmNGU0Mi1iZWExLTRiZTUtYjgwNS03MmJlZjY5N2UwMTIiLCJyZWdUaW1lIjoxNzQyMjMyMzQ1MTkxLCJwaG9uZSI6Ijg0ODg2MDI3NzY3IiwiZGVwb3NpdCI6dHJ1ZSwidXNlcm5hbWUiOiJTQ19tc2FuZ3p6MDkifQ.1nEmiJaa9IfHwSbjeDdw90WYqde97BrLsCtUlSYydC8";

// --- GLOBAL STATE ---
let results = [];
let ws = null;
let pingInterval = null;
let reconnectTimeout = null;
let wsConnected = false;
let wsReconnectCount = 0;
let lastUpdateTime = null;
let historyLoaded = false;
let lastProcessedSession = null;

// --- LOẠI CẦU ---
const BRIDGE_TYPES = {
  'cầu đơn tài': { pattern: /t$/, description: '1 kết quả Tài' },
  'cầu đơn xỉu': { pattern: /x$/, description: '1 kết quả Xỉu' },
  'cầu 2 tài': { pattern: /tt$/, description: '2 Tài liên tiếp' },
  'cầu 2 xỉu': { pattern: /xx$/, description: '2 Xỉu liên tiếp' },
  'cầu 3 tài': { pattern: /ttt$/, description: '3 Tài liên tiếp' },
  'cầu 3 xỉu': { pattern: /xxx$/, description: '3 Xỉu liên tiếp' },
  'cầu 4 tài': { pattern: /tttt$/, description: '4 Tài liên tiếp' },
  'cầu 4 xỉu': { pattern: /xxxx$/, description: '4 Xỉu liên tiếp' },
  'cầu 5+ tài': { pattern: /t{5,}$/, description: '5+ Tài liên tiếp' },
  'cầu 5+ xỉu': { pattern: /x{5,}$/, description: '5+ Xỉu liên tiếp' },
  'lưỡng cầu 1-1': { pattern: /(tx|xt)$/, description: 'Đổi chiều mỗi phiên' },
  'lưỡng cầu 2-2': { pattern: /(ttxx|xxtt)$/, description: '2T-2X hoặc 2X-2T' },
  'lưỡng cầu 1-2': { pattern: /(txx|xtt)$/, description: '1T-2X hoặc 1X-2T' },
  'lưỡng cầu 2-1': { pattern: /(ttx|xxt)$/, description: '2T-1X hoặc 2X-1T' },
};

// --- AI CORE ---
class SmartAI {
  constructor() {
    this.history = [];
    this.stats = { total: 0, correct: 0, wrong: 0 };
    this.pendingPrediction = null;
    this.predictionLog = [];
  }

  analyzePattern(history) {
    if (history.length < 10) return null;
    const recent = history.slice(-8).map(h => h.tx.toLowerCase()).join('');
    const fullHistory = history.slice(-30).map(h => h.tx.toLowerCase()).join('');
    let tScore = 0, xScore = 0;
    
    for (let len = 3; len <= 5; len++) {
      if (recent.length < len) continue;
      const pattern = recent.slice(-len);
      for (let i = 0; i <= fullHistory.length - len - 1; i++) {
        if (fullHistory.substr(i, len) === pattern) {
          const next = fullHistory.charAt(i + len);
          if (next === 't') tScore += len;
          else if (next === 'x') xScore += len;
        }
      }
    }
    
    if (tScore > xScore * 1.3) return 'T';
    if (xScore > tScore * 1.3) return 'X';
    return null;
  }

  detectBridge(history) {
    if (history.length < 5) return null;
    const recent = history.slice(-5).map(h => h.tx);
    const last = recent[recent.length - 1];
    let runLength = 1;
    
    for (let i = recent.length - 2; i >= 0; i--) {
      if (recent[i] === last) runLength++;
      else break;
    }
    
    if (runLength >= 2 && runLength <= 3) return last;
    if (runLength >= 4) return last === 'T' ? 'X' : 'T';
    return null;
  }

  analyzeTrend(history) {
    if (history.length < 15) return null;
    const totals = history.slice(-15).map(h => h.total);
    const avg = totals.reduce((a, b) => a + b) / totals.length;
    const recentAvg = totals.slice(-5).reduce((a, b) => a + b) / 5;
    
    if (recentAvg > avg + 0.8) return 'X';
    if (recentAvg < avg - 0.8) return 'T';
    return null;
  }

  predict() {
    if (this.history.length < 10) {
      return { prediction: 'tài', confidence: 50, raw: 'T', reason: 'chưa đủ dữ liệu' };
    }

    const predictions = [];
    const p1 = this.analyzePattern(this.history);
    if (p1) predictions.push({ pred: p1, weight: 2, reason: 'pattern' });
    
    const p2 = this.detectBridge(this.history);
    if (p2) predictions.push({ pred: p2, weight: 1.5, reason: 'bridge' });
    
    const p3 = this.analyzeTrend(this.history);
    if (p3) predictions.push({ pred: p3, weight: 1, reason: 'trend' });
    
    if (predictions.length === 0) {
      return { prediction: 'tài', confidence: 50, raw: 'T', reason: 'no signal' };
    }

    let tVotes = 0, xVotes = 0;
    predictions.forEach(p => {
      if (p.pred === 'T') tVotes += p.weight;
      else xVotes += p.weight;
    });

    const total = tVotes + xVotes;
    const finalPred = tVotes > xVotes ? 'T' : 'X';
    const confidence = Math.round((Math.max(tVotes, xVotes) / total) * 100);

    return {
      prediction: finalPred === 'T' ? 'tài' : 'xỉu',
      confidence: Math.min(95, Math.max(55, confidence)),
      raw: finalPred,
      reason: predictions.map(p => p.reason).join(', ')
    };
  }

  addResult(record) {
    const parsed = {
      session: Number(record.session),
      dice: record.dice,
      total: Number(record.total),
      result: record.result,
      tx: Number(record.total) >= 11 ? 'T' : 'X',
      timestamp: record.timestamp || new Date().toISOString()
    };

    if (this.pendingPrediction && this.pendingPrediction.forSession === parsed.session) {
      this.stats.total++;
      const isCorrect = this.pendingPrediction.raw === parsed.tx;
      
      if (isCorrect) this.stats.correct++;
      else this.stats.wrong++;

      this.predictionLog.push({
        session: parsed.session,
        predicted: this.pendingPrediction.raw,
        actual: parsed.tx,
        correct: isCorrect,
        timestamp: parsed.timestamp
      });

      if (this.predictionLog.length > 100) {
        this.predictionLog = this.predictionLog.slice(-100);
      }

      console.log(`📊 #${parsed.session}: Dự đoán ${this.pendingPrediction.raw} → Thực tế ${parsed.tx} ${isCorrect ? '✅' : '❌'} | ${this.stats.correct}/${this.stats.total} (${Math.round(this.stats.correct/this.stats.total*100)}%)`);
      this.pendingPrediction = null;
    }

    this.history.push(parsed);
    if (this.history.length > 200) {
      this.history = this.history.slice(-150);
    }

    return parsed;
  }

  loadHistory(historyData) {
    this.history = historyData.map(h => ({
      session: Number(h.session),
      dice: h.dice,
      total: Number(h.total),
      result: h.result,
      tx: Number(h.total) >= 11 ? 'T' : 'X',
      timestamp: h.timestamp || new Date().toISOString()
    })).sort((a, b) => a.session - b.session);

    console.log(`📚 Load ${this.history.length} phiên | ${this.history[0]?.session} → ${this.history[this.history.length-1]?.session}`);
  }

  savePredictionForNextSession(currentSession) {
    const pred = this.predict();
    this.pendingPrediction = {
      ...pred,
      forSession: currentSession + 1,
      createdAt: new Date().toISOString()
    };
    console.log(`🔮 Dự đoán #${currentSession + 1}: ${pred.raw} (${pred.prediction})`);
    return pred;
  }

  detectBridgeType() {
    if (this.history.length < 5) return 'chưa đủ dữ liệu';
    const recent = this.history.slice(-5).map(h => h.tx.toLowerCase()).join('');
    
    for (const [name, info] of Object.entries(BRIDGE_TYPES)) {
      if (info.pattern.test(recent)) return `${name} (${info.description})`;
    }
    return 'cầu hỗn hợp';
  }

  getPattern() {
    if (this.history.length < 10) return 'đang thu thập';
    const pattern = this.history.slice(-20).map(h => h.tx).join('');
    const tCount = (pattern.match(/T/g) || []).length;
    const xCount = (pattern.match(/X/g) || []).length;
    return `${pattern} (T:${tCount} X:${xCount})`;
  }

  getDetailedStats() {
    return {
      tong_du_doan: this.stats.total,
      dung: this.stats.correct,
      sai: this.stats.wrong,
      ty_le_dung: this.stats.total > 0 ? `${Math.round((this.stats.correct / this.stats.total) * 100)}%` : '0%',
      ty_le_sai: this.stats.total > 0 ? `${Math.round((this.stats.wrong / this.stats.total) * 100)}%` : '0%',
      recent_10: this.predictionLog.slice(-10).map(p => ({
        phien: p.session,
        du_doan: p.predicted === 'T' ? 'tài' : 'xỉu',
        thuc_te: p.actual === 'T' ? 'tài' : 'xỉu',
        ket_qua: p.correct ? 'đúng' : 'sai'
      }))
    };
  }

  getCurrentPrediction() {
    if (!this.pendingPrediction) return this.predict();
    return this.pendingPrediction;
  }
}

const ai = new SmartAI();

// --- API SERVER ---
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

app.get("/sunwinsew", async () => {
  try {
    const lastResult = results[0];
    
    if (!lastResult) {
      return {
        id: "@minhsangdangcap",
        phien_hien_tai: null,
        phien_du_doan: null,
        du_doan: null,
        ket_qua: null,
        xuc_xac: null,
        tong: null,
        pattern: null,
        loai_cau: null,
        thong_ke: { tong_du_doan: 0, dung: 0, sai: 0, ty_le_dung: "0%" }
      };
    }

    const prediction = ai.getCurrentPrediction();
    const nextSession = lastResult.session + 1;

    return {
      id: "@minhsangdangcap",
      phien_hien_tai: lastResult.session,
      phien_du_doan: nextSession,
      du_doan: prediction.prediction,
      ket_qua: lastResult.result.toLowerCase(),
      xuc_xac: lastResult.dice,
      tong: lastResult.total,
      pattern: ai.getPattern(),
      loai_cau: ai.detectBridgeType(),
      thong_ke: {
        tong_du_doan: ai.stats.total,
        dung: ai.stats.correct,
        sai: ai.stats.wrong,
        ty_le_dung: ai.stats.total > 0 ? `${Math.round((ai.stats.correct / ai.stats.total) * 100)}%` : '0%'
      }
    };
  } catch (error) {
    console.error('❌ API Error:', error);
    return { 
      id: "@minhsangdangcap",
      phien_hien_tai: null,
      phien_du_doan: null,
      du_doan: null,
      ket_qua: null,
      xuc_xac: null,
      tong: null,
      pattern: null,
      loai_cau: null,
      thong_ke: { tong_du_doan: 0, dung: 0, sai: 0, ty_le_dung: "0%" }
    };
  }
});

app.get("/api/taixiu/history", async () => {
  return {
    id: "@minhsangdangcap",
    total: results.length,
    results: results.slice(0, 50).map(r => ({
      phien: r.session,
      xuc_xac: r.dice,
      tong: r.total,
      ket_qua: r.result.toLowerCase(),
      timestamp: r.timestamp
    }))
  };
});

app.get("/api/stats", async () => {
  return {
    id: "@minhsangdangcap",
    websocket: {
      connected: wsConnected,
      reconnect_count: wsReconnectCount,
      last_update: lastUpdateTime,
      history_loaded: historyLoaded
    },
    data: {
      total_results: results.length,
      ai_history: ai.history.length,
      oldest_session: results[results.length - 1]?.session,
      newest_session: results[0]?.session
    },
    ai_stats: ai.getDetailedStats()
  };
});

app.get("/", async () => ({
  id: "@minhsangdangcap",
  name: "Sunwin Tài Xỉu API v3.2",
  version: "3.2",
  status: "online",
  websocket: wsConnected ? "connected" : "disconnected",
  endpoints: {
    main: "/sunwinsew",
    history: "/api/taixiu/history",
    stats: "/api/stats"
  }
}));

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`\n🚀 Server: http://localhost:${PORT}`);
console.log(`📡 Main API: http://localhost:${PORT}/sunwinsew`);
console.log(`📊 Stats: http://localhost:${PORT}/api/stats\n`);

// --- WEBSOCKET IMPROVED ---
function sendPing() {
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify([6, "MiniGame", "taixiuPlugin", { cmd: 1005 }]));
      console.log(`🏓 Ping sent [${new Date().toLocaleTimeString()}]`);
    } catch (e) {
      console.error('❌ Ping error:', e.message);
    }
  }
}

function cleanup() {
  if (ws) {
    ws.removeAllListeners();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
    ws = null;
  }
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  wsConnected = false;
}

function connect() {
  cleanup();
  
  console.log(`🔌 [${new Date().toLocaleTimeString()}] Connecting WebSocket (attempt ${wsReconnectCount + 1})...`);

  ws = new WebSocket(`${WS_URL}${TOKEN}`, {
    handshakeTimeout: 10000,
    perMessageDeflate: false
  });

  let isAlive = true;

  ws.on("open", () => {
    wsConnected = true;
    isAlive = true;
    console.log(`✅ [${new Date().toLocaleTimeString()}] WebSocket CONNECTED!`);
    
    // Auth message
    const authMsg = [1, "MiniGame", "SC_giathinh2133", "thinh211", {
      info: JSON.stringify({
        ipAddress: "2402:800:62cd:b4d1:8c64:a3c9:12bf:c19a",
        wsToken: TOKEN,
        userId: "cdbaf598-e4ef-47f8-b4a6-a4881098db86",
        username: "SC_hellokietne212",
        timestamp: Date.now(),
      }),
      signature: "473ABDDDA6BDD74D8F0B6036223B0E3A002A518203A9BB9F95AD763E3BF969EC2CBBA61ED1A3A9E217B52A4055658D7BEA38F89B806285974C7F3F62A9400066709B4746585887D00C9796552671894F826E69EFD234F6778A5DDC24830CEF68D51217EF047644E0B0EB1CB26942EB34AEF114AEC36A6DF833BB10F7D122EA5E",
      pid: 5,
      subi: true,
    }];
    
    ws.send(JSON.stringify(authMsg));
    console.log('🔐 Auth sent');
    
    // Request data immediately
    setTimeout(() => sendPing(), 500);
    
    // Ping every 2 seconds
    pingInterval = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN && isAlive) {
        sendPing();
      }
    }, 2000);
  });

  ws.on("message", (data) => {
    isAlive = true;
    
    try {
      const raw = data instanceof Buffer ? data.toString('utf8') : data;
      const json = JSON.parse(raw);

      // History data
      if (!historyLoaded && Array.isArray(json) && json[1]?.htr && Array.isArray(json[1].htr)) {
        const history = json[1].htr.map(i => ({
          session: i.sid,
          dice: [i.d1, i.d2, i.d3],
          total: i.d1 + i.d2 + i.d3,
          result: (i.d1 + i.d2 + i.d3) >= 11 ? "Tài" : "Xỉu",
          timestamp: new Date().toISOString()
        })).sort((a, b) => a.session - b.session);

        ai.loadHistory(history);
        results = history.slice(-100).reverse();
        lastUpdateTime = new Date().toISOString();
        historyLoaded = true;
        lastProcessedSession = results[0]?.session;
        
        console.log(`✅ History loaded: ${history.length} sessions`);
        
        if (results[0]) {
          ai.savePredictionForNextSession(results[0].session);
        }
        return;
      }

      // New result - REAL TIME
      if (json.session && json.dice && Array.isArray(json.dice) && json.dice.length === 3) {
        const sessionNum = Number(json.session);
        
        // Skip duplicate
        if (lastProcessedSession && sessionNum <= lastProcessedSession) {
          return;
        }
        
        const record = {
          session: sessionNum,
          dice: json.dice,
          total: json.total || json.dice.reduce((a, b) => a + b, 0),
          result: json.result || (json.total >= 11 ? "Tài" : "Xỉu"),
          timestamp: new Date().toISOString()
        };
        
        console.log(`\n📥 NEW RESULT #${record.session}: ${record.result} (${record.total}) [${record.dice.join('-')}]`);
        
        // Process
        ai.addResult(record);
        results.unshift(record);
        if (results.length > 100) results = results.slice(0, 100);
        
        lastUpdateTime = new Date().toISOString();
        lastProcessedSession = sessionNum;
        
        // Next prediction
        const nextPred = ai.savePredictionForNextSession(record.session);
        console.log(`🎯 Next: ${nextPred.prediction.toUpperCase()}`);
      }
    } catch (e) {
      // Silent
    }
  });

  ws.on("ping", () => {
    isAlive = true;
  });

  ws.on("pong", () => {
    isAlive = true;
  });

  ws.on("close", (code, reason) => {
    console.log(`🔌 [${new Date().toLocaleTimeString()}] WebSocket CLOSED (code: ${code})`);
    cleanup();
    wsReconnectCount++;
    reconnectTimeout = setTimeout(() => connect(), 3000);
  });

  ws.on("error", (err) => {
    console.error(`❌ [${new Date().toLocaleTimeString()}] WS Error:`, err.message);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });
}

connect();
