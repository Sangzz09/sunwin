import fastify from "fastify";
import cors from "@fastify/cors";
import WebSocket from "ws";

// --- CẤU HÌNH ---
const PORT = 3000;
const WS_URL = "wss://websocket.azhkthg1.net/websocket?token=";
const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJzc2NoaWNobWVtIiwiYm90IjowLCJpc01lcmNoYW50IjpmYWxzZSwidmVyaWZpZWRCYW5rQWNjb3VudCI6ZmFsc2UsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MzI2OTA1OTg1LCJhZmZJZCI6InN1bndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoic3VuLndpbiIsInRpbWVzdGFtcCI6MTc2NTQ2OTYxNjg3MCwibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOmZhbHNlLCJpcEFkZHJlc3MiOiIyNDAyOjgwMDo2ZjVmOmNiYzU6ODRjMTo2YzQzOjhmZGQ6NDdkYSIsIm11dGUiOmZhbHNlLCJhdmF0YXIiOiJodHRwczovL2ltYWdlcy5zd2luc2hvcC5uZXQvaW1hZ2VzL2F2YXRhci9hdmF0YXJfMTkucG5nIiwicGxhdGZvcm1JZCI6MiwidXNlcklkIjoiOWQyMTliNGYtMjQxYS00ZmU2LTkyNDItMDQ5MWYxYzRhMDVjIiwicmVnVGltZSI6MTc2MzcyNzkwNzk0MCwicGhvbmUiOiIiLCJkZXBvc2l0IjpmYWxzZSwidXNlcm5hbWUiOiJTQ19naWF0aGluaDIxMzMifQ.XGiELjKKAgIc-0dKYjZFOlDeH2e-LC_PvrvrzPcdY1U";

// --- GLOBAL STATE ---
let results = [];
let ws = null;
let intervalCmd = null;

// --- LOẠI CẦU THỰC TẾ ---
const BRIDGE_TYPES = {
  'cầu đơn': { pattern: /^(t|x)$/, description: '1 kết quả' },
  'cầu 2': { pattern: /^(tt|xx)$/, description: '2 liên tiếp' },
  'cầu 3': { pattern: /^(ttt|xxx)$/, description: '3 liên tiếp' },
  'cầu 4': { pattern: /^(tttt|xxxx)$/, description: '4 liên tiếp' },
  'cầu 5+': { pattern: /^(t{5,}|x{5,})$/, description: '5+ liên tiếp' },
  'lưỡng cầu 1-1': { pattern: /^(tx|xt)$/, description: 'Đổi chiều mỗi phiên' },
  'lưỡng cầu 2-2': { pattern: /^(ttxx|xxtt)$/, description: '2T-2X hoặc ngược lại' },
  'lưỡng cầu 1-2': { pattern: /^(txx|xtt)$/, description: '1-2 hoặc 2-1' },
};

// --- AI CORE ---
class SmartAI {
  constructor() {
    this.history = [];
    this.stats = { total: 0, correct: 0, wrong: 0 };
    this.lastPrediction = null;
  }

  // Thuật toán 1: Phân tích Pattern
  analyzePattern(history) {
    if (history.length < 10) return null;
    
    const recent = history.slice(-8).map(h => h.tx.toLowerCase()).join('');
    const fullHistory = history.slice(-30).map(h => h.tx.toLowerCase()).join('');
    
    // Đếm pattern matching
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
    
    // Theo cầu nếu độ dài 2-3
    if (runLength >= 2 && runLength <= 3) return last;
    
    // Bẻ cầu nếu độ dài >= 4
    if (runLength >= 4) return last === 'T' ? 'X' : 'T';
    
    return null;
  }

  // Thuật toán 3: Xu hướng tổng điểm
  analyzeTrend(history) {
    if (history.length < 15) return null;
    
    const totals = history.slice(-15).map(h => h.total);
    const avg = totals.reduce((a, b) => a + b) / totals.length;
    const recentAvg = totals.slice(-5).reduce((a, b) => a + b) / 5;
    
    if (recentAvg > avg + 0.8) return 'X'; // Xu hướng giảm
    if (recentAvg < avg - 0.8) return 'T'; // Xu hướng tăng
    
    return null;
  }

  // Dự đoán
  predict() {
    if (this.history.length < 10) {
      return { prediction: 'tài', confidence: 50, raw: 'T' };
    }

    const predictions = [];
    
    const p1 = this.analyzePattern(this.history);
    if (p1) predictions.push({ pred: p1, weight: 2 });
    
    const p2 = this.detectBridge(this.history);
    if (p2) predictions.push({ pred: p2, weight: 1.5 });
    
    const p3 = this.analyzeTrend(this.history);
    if (p3) predictions.push({ pred: p3, weight: 1 });
    
    if (predictions.length === 0) {
      return { prediction: 'tài', confidence: 50, raw: 'T' };
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
      raw: finalPred
    };
  }

  // Thêm kết quả
  addResult(record) {
    const parsed = {
      session: Number(record.session),
      dice: record.dice,
      total: Number(record.total),
      result: record.result,
      tx: Number(record.total) >= 11 ? 'T' : 'X'
    };

    // Cập nhật thống kê
    if (this.lastPrediction) {
      this.stats.total++;
      if (this.lastPrediction === parsed.tx) {
        this.stats.correct++;
      } else {
        this.stats.wrong++;
      }
    }

    this.history.push(parsed);
    if (this.history.length > 200) {
      this.history = this.history.slice(-150);
    }

    return parsed;
  }

  // Load lịch sử
  loadHistory(historyData) {
    this.history = historyData.map(h => ({
      session: Number(h.session),
      dice: h.dice,
      total: Number(h.total),
      result: h.result,
      tx: Number(h.total) >= 11 ? 'T' : 'X'
    })).sort((a, b) => a.session - b.session);
  }

  // Phát hiện loại cầu
  detectBridgeType() {
    if (this.history.length < 5) return 'chưa đủ dữ liệu';
    
    const recent = this.history.slice(-5).map(h => h.tx.toLowerCase()).join('');
    
    for (const [name, info] of Object.entries(BRIDGE_TYPES)) {
      if (info.pattern.test(recent)) {
        return name;
      }
    }
    
    return 'cầu hỗn hợp';
  }

  // Lấy pattern
  getPattern() {
    if (this.history.length < 10) return 'đang thu thập';
    return this.history.slice(-15).map(h => h.tx).join('');
  }

  // Lưu prediction
  savePrediction(pred) {
    this.lastPrediction = pred;
  }
}

const ai = new SmartAI();

// --- API SERVER ---
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

// GET /api/taixiu/sunwin
app.get("/api/taixiu/sunwin", async () => {
  try {
    const lastResult = results[0];
    if (!lastResult) {
      return {
        id: "@minhsangdangcap",
        status: "đang chờ dữ liệu",
        phien: null,
        ket_qua: null,
        xuc_xac: null,
        tong: null,
        du_doan: null,
        pattern: null,
        loai_cau: null,
        thong_ke: ai.stats
      };
    }

    const prediction = ai.predict();
    ai.savePrediction(prediction.raw);

    return {
      id: "@minhsangdangcap",
      phien: lastResult.session,
      ket_qua: lastResult.result.toLowerCase(),
      xuc_xac: lastResult.dice,
      tong: lastResult.total,
      du_doan: prediction.prediction,
      do_tin_cay: `${prediction.confidence}%`,
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
    console.error('API Error:', error);
    return { id: "@minhsangdangcap", error: "Lỗi hệ thống" };
  }
});

// GET /api/taixiu/history
app.get("/api/taixiu/history", async () => {
  return results.slice(0, 20).map(r => ({
    phien: r.session,
    xuc_xac: r.dice,
    tong: r.total,
    ket_qua: r.result.toLowerCase()
  }));
});

// GET /
app.get("/", async () => ({
  id: "@minhsangdangcap",
  name: "Tài Xỉu AI Tối Ưu",
  version: "2.0",
  status: "online"
}));

// --- SERVER START ---
await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`\n🚀 Server đang chạy tại http://localhost:${PORT}`);
console.log(`📡 API: http://localhost:${PORT}/api/taixiu/sunwin\n`);

// --- WEBSOCKET ---
function sendCmd() {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify([6, "MiniGame", "taixiuPlugin", { cmd: 1005 }]));
  }
}

function connect() {
  console.log("🔌 Đang kết nối WebSocket...");
  
  if (ws) ws.close();
  clearInterval(intervalCmd);

  ws = new WebSocket(`${WS_URL}${TOKEN}`);

  ws.on("open", () => {
    console.log("✅ WebSocket connected");
    
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
    
    intervalCmd = setInterval(sendCmd, 5000);
  });

  ws.on("message", (data) => {
    try {
      const json = typeof data === "string" 
        ? JSON.parse(data) 
        : JSON.parse(new TextDecoder().decode(data));

      if (json.session && json.dice) {
        const record = {
          session: json.session,
          dice: json.dice,
          total: json.total,
          result: json.result
        };
        
        ai.addResult(record);
        results.unshift(record);
        if (results.length > 50) results.pop();

        const pred = ai.predict();
        console.log(`\n📥 Phiên ${record.session}: ${record.result} (${record.total})`);
        console.log(`🔮 Dự đoán: ${pred.prediction.toUpperCase()} (${pred.confidence}%)`);
        console.log(`📊 Thống kê: ${ai.stats.correct}/${ai.stats.total} đúng`);
      }
      else if (Array.isArray(json) && json[1]?.htr) {
        const history = json[1].htr.map(i => ({
          session: i.sid,
          dice: [i.d1, i.d2, i.d3],
          total: i.d1 + i.d2 + i.d3,
          result: (i.d1 + i.d2 + i.d3) >= 11 ? "Tài" : "Xỉu"
        })).sort((a, b) => a.session - b.session);

        ai.loadHistory(history);
        results = history.slice(-50).reverse();
        
        console.log(`📚 Đã tải ${history.length} kết quả lịch sử`);
      }
    } catch (e) {
      // Bỏ qua lỗi parse
    }
  });

  ws.on("close", () => {
    console.log("🔌 WebSocket đã ngắt. Kết nối lại...");
    clearInterval(intervalCmd);
    setTimeout(connect, 3000);
  });

  ws.on("error", (err) => {
    console.error("❌ WebSocket error:", err.message);
  });
}

connect();
