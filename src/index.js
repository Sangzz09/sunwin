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
let intervalCmd = null;
let wsConnected = false;
let wsReconnectCount = 0;
let lastUpdateTime = null;
let historyLoaded = false;

// --- LOẠI CẦU THỰC TẾ ---
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
    this.pendingPrediction = null; // Dự đoán đang chờ kết quả
    this.predictionLog = [];
  }

  // Thuật toán 1: Phân tích Pattern
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

  // Thuật toán 2: Phát hiện cầu
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

  // Thuật toán 3: Xu hướng tổng điểm
  analyzeTrend(history) {
    if (history.length < 15) return null;
    
    const totals = history.slice(-15).map(h => h.total);
    const avg = totals.reduce((a, b) => a + b) / totals.length;
    const recentAvg = totals.slice(-5).reduce((a, b) => a + b) / 5;
    
    if (recentAvg > avg + 0.8) return 'X';
    if (recentAvg < avg - 0.8) return 'T';
    
    return null;
  }

  // Dự đoán CHO PHIÊN TIẾP THEO
  predict() {
    if (this.history.length < 10) {
      return { prediction: 'tài', confidence: 50, raw: 'T', reason: 'chưa đủ dữ liệu' };
    }

    const predictions = [];
    
    const p1 = this.analyzePattern(this.history);
    if (p1) predictions.push({ pred: p1, weight: 2, reason: 'pattern matching' });
    
    const p2 = this.detectBridge(this.history);
    if (p2) predictions.push({ pred: p2, weight: 1.5, reason: 'bridge detection' });
    
    const p3 = this.analyzeTrend(this.history);
    if (p3) predictions.push({ pred: p3, weight: 1, reason: 'trend analysis' });
    
    if (predictions.length === 0) {
      return { prediction: 'tài', confidence: 50, raw: 'T', reason: 'không có tín hiệu rõ ràng' };
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

  // Thêm kết quả MỚI và kiểm tra prediction trước đó
  addResult(record) {
    const parsed = {
      session: Number(record.session),
      dice: record.dice,
      total: Number(record.total),
      result: record.result,
      tx: Number(record.total) >= 11 ? 'T' : 'X',
      timestamp: record.timestamp || new Date().toISOString()
    };

    // Kiểm tra nếu có pending prediction cho phiên này
    if (this.pendingPrediction && this.pendingPrediction.forSession === parsed.session) {
      this.stats.total++;
      const isCorrect = this.pendingPrediction.raw === parsed.tx;
      
      if (isCorrect) {
        this.stats.correct++;
      } else {
        this.stats.wrong++;
      }

      // Log prediction
      this.predictionLog.push({
        session: parsed.session,
        predicted: this.pendingPrediction.raw,
        actual: parsed.tx,
        correct: isCorrect,
        timestamp: parsed.timestamp
      });

      // Giữ 100 log gần nhất
      if (this.predictionLog.length > 100) {
        this.predictionLog = this.predictionLog.slice(-100);
      }

      console.log(`📊 Phiên ${parsed.session}: Dự đoán ${this.pendingPrediction.raw} - Thực tế ${parsed.tx} - ${isCorrect ? '✅ ĐÚNG' : '❌ SAI'} | Tỷ lệ: ${this.stats.correct}/${this.stats.total}`);
      
      // Clear pending
      this.pendingPrediction = null;
    }

    // Thêm vào history
    this.history.push(parsed);
    if (this.history.length > 200) {
      this.history = this.history.slice(-150);
    }

    return parsed;
  }

  // Load lịch sử (chỉ dùng 1 lần khi khởi động)
  loadHistory(historyData) {
    this.history = historyData.map(h => ({
      session: Number(h.session),
      dice: h.dice,
      total: Number(h.total),
      result: h.result,
      tx: Number(h.total) >= 11 ? 'T' : 'X',
      timestamp: h.timestamp || new Date().toISOString()
    })).sort((a, b) => a.session - b.session);

    console.log(`📚 Đã load ${this.history.length} kết quả vào AI | Phiên: ${this.history[0]?.session} → ${this.history[this.history.length-1]?.session}`);
  }

  // Lưu prediction cho phiên TIẾP THEO
  savePredictionForNextSession(currentSession) {
    const pred = this.predict();
    this.pendingPrediction = {
      ...pred,
      forSession: currentSession + 1, // Dự đoán cho phiên tiếp theo
      createdAt: new Date().toISOString()
    };
    console.log(`🔮 Lưu dự đoán cho phiên ${currentSession + 1}: ${pred.raw} (${pred.prediction})`);
    return pred;
  }

  // Phát hiện loại cầu
  detectBridgeType() {
    if (this.history.length < 5) return 'chưa đủ dữ liệu';
    
    const recent = this.history.slice(-5).map(h => h.tx.toLowerCase()).join('');
    
    for (const [name, info] of Object.entries(BRIDGE_TYPES)) {
      if (info.pattern.test(recent)) {
        return `${name} (${info.description})`;
      }
    }
    
    return 'cầu hỗn hợp';
  }

  // Lấy pattern chi tiết
  getPattern() {
    if (this.history.length < 10) return 'đang thu thập dữ liệu';
    
    const pattern = this.history.slice(-20).map(h => h.tx).join('');
    const tCount = (pattern.match(/T/g) || []).length;
    const xCount = (pattern.match(/X/g) || []).length;
    
    return `${pattern} (T:${tCount} X:${xCount})`;
  }

  // Lấy thống kê chi tiết
  getDetailedStats() {
    return {
      tong_du_doan: this.stats.total,
      dung: this.stats.correct,
      sai: this.stats.wrong,
      ty_le_dung: this.stats.total > 0 
        ? `${Math.round((this.stats.correct / this.stats.total) * 100)}%` 
        : '0%',
      ty_le_sai: this.stats.total > 0 
        ? `${Math.round((this.stats.wrong / this.stats.total) * 100)}%` 
        : '0%',
      recent_10: this.predictionLog.slice(-10).map(p => ({
        phien: p.session,
        du_doan: p.predicted === 'T' ? 'tài' : 'xỉu',
        thuc_te: p.actual === 'T' ? 'tài' : 'xỉu',
        ket_qua: p.correct ? 'đúng' : 'sai'
      }))
    };
  }

  // Get prediction hiện tại (cho phiên tiếp theo)
  getCurrentPrediction() {
    if (!this.pendingPrediction) {
      return this.predict();
    }
    return this.pendingPrediction;
  }
}

const ai = new SmartAI();

// --- API SERVER ---
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

// GET /sunwinsew - Endpoint chính
app.get("/sunwinsew", async () => {
  try {
    const lastResult = results[0];
    
    if (!lastResult) {
      return {
        id: "@minhsangdangcap",
        phien: null,
        ket_qua: null,
        xuc_xac: null,
        tong: null,
        du_doan: null,
        pattern: null,
        loai_cau: null,
        thong_ke: {
          tong_du_doan: 0,
          dung: 0,
          sai: 0,
          ty_le_dung: "0%"
        }
      };
    }

    const prediction = ai.getCurrentPrediction();

    return {
      id: "@minhsangdangcap",
      phien: lastResult.session,
      ket_qua: lastResult.result.toLowerCase(),
      xuc_xac: lastResult.dice,
      tong: lastResult.total,
      du_doan: prediction.prediction,
      du_doan_cho_phien: lastResult.session + 1,
      pattern: ai.getPattern(),
      loai_cau: ai.detectBridgeType(),
      thong_ke: {
        tong_du_doan: ai.stats.total,
        dung: ai.stats.correct,
        sai: ai.stats.wrong,
        ty_le_dung: ai.stats.total > 0 
          ? `${Math.round((ai.stats.correct / ai.stats.total) * 100)}%` 
          : '0%'
      }
    };
  } catch (error) {
    console.error('❌ API Error:', error);
    return { 
      id: "@minhsangdangcap", 
      phien: null,
      ket_qua: null,
      xuc_xac: null,
      tong: null,
      du_doan: null,
      pattern: null,
      loai_cau: null,
      thong_ke: {
        tong_du_doan: 0,
        dung: 0,
        sai: 0,
        ty_le_dung: "0%"
      }
    };
  }
});

// GET /api/taixiu/history
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

// GET /api/stats
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

// GET /
app.get("/", async () => ({
  id: "@minhsangdangcap",
  name: "Sunwin Tài Xỉu API Fixed",
  version: "3.1",
  status: "online",
  websocket: wsConnected ? "connected" : "disconnected",
  endpoints: {
    main: "/sunwinsew",
    history: "/api/taixiu/history",
    stats: "/api/stats"
  }
}));

// --- SERVER START ---
await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`\n🚀 Server đang chạy tại http://localhost:${PORT}`);
console.log(`📡 API chính: http://localhost:${PORT}/sunwinsew`);
console.log(`📊 Thống kê: http://localhost:${PORT}/api/stats`);
console.log(`📚 Lịch sử: http://localhost:${PORT}/api/taixiu/history\n`);

// --- WEBSOCKET ---
function sendCmd() {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify([6, "MiniGame", "taixiuPlugin", { cmd: 1005 }]));
  }
}

function connect() {
  console.log(`🔌 [${new Date().toLocaleTimeString()}] Đang kết nối WebSocket... (lần ${wsReconnectCount + 1})`);
  
  if (ws) {
    ws.removeAllListeners();
    ws.close();
  }
  clearInterval(intervalCmd);
  wsConnected = false;

  ws = new WebSocket(`${WS_URL}${TOKEN}`);

  ws.on("open", () => {
    wsConnected = true;
    console.log(`✅ [${new Date().toLocaleTimeString()}] WebSocket connected!`);
    
    // Auth
    ws.send(JSON.stringify([1, "MiniGame", "SC_giathinh2133", "thinh211", {
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
    }]));
    
    // Request data ngay lập tức
    sendCmd();
    
    // Ping mỗi 3s
    intervalCmd = setInterval(sendCmd, 3000);
  });

  ws.on("message", (data) => {
    try {
      const json = typeof data === "string" 
        ? JSON.parse(data) 
        : JSON.parse(new TextDecoder().decode(data));

      // ✅ LỊCH SỬ - Load trước tiên
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
        
        console.log(`📚 ✅ Load xong ${history.length} kết quả | Phiên: ${history[0].session} → ${history[history.length-1].session}`);
        
        // Tạo prediction cho phiên tiếp theo
        if (results[0]) {
          ai.savePredictionForNextSession(results[0].session);
        }
        return;
      }

      // ✅ KẾT QUẢ MỚI - Xử lý NGAY LẬP TỨC
      if (json.session && json.dice && Array.isArray(json.dice)) {
        const record = {
          session: json.session,
          dice: json.dice,
          total: json.total,
          result: json.result,
          timestamp: new Date().toISOString()
        };
        
        // Kiểm tra duplicate
        if (results[0] && results[0].session === record.session) {
          return; // Bỏ qua kết quả trùng
        }
        
        // Thêm vào AI (sẽ tự động kiểm tra prediction)
        const parsed = ai.addResult(record);
        
        // Thêm vào results
        results.unshift(record);
        if (results.length > 100) results = results.slice(0, 100);

        lastUpdateTime = new Date().toISOString();

        // Tạo prediction cho phiên tiếp theo
        const nextPred = ai.savePredictionForNextSession(record.session);
        
        console.log(`\n📥 Phiên ${record.session}: ${record.result} (${record.total}) | ${parsed.tx}`);
        console.log(`🔮 Dự đoán phiên ${record.session + 1}: ${nextPred.prediction.toUpperCase()}`);
        console.log(`📈 Thống kê: ${ai.stats.correct}/${ai.stats.total} đúng (${ai.stats.total > 0 ? Math.round(ai.stats.correct/ai.stats.total*100) : 0}%)`);
      }
    } catch (e) {
      // Bỏ qua lỗi parse
    }
  });

  ws.on("close", (code) => {
    wsConnected = false;
    console.log(`🔌 [${new Date().toLocaleTimeString()}] WebSocket đã ngắt (code: ${code}). Kết nối lại sau 3s...`);
    clearInterval(intervalCmd);
    wsReconnectCount++;
    setTimeout(connect, 3000);
  });

  ws.on("error", (err) => {
    wsConnected = false;
    console.error(`❌ [${new Date().toLocaleTimeString()}] WebSocket error:`, err.message);
  });
}

// Khởi động WebSocket
connect();
