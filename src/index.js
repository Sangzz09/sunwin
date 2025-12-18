import fastify from "fastify";
import cors from "@fastify/cors";
import WebSocket from "ws";

// --- CẤU HÌNH ---
const PORT = 3000;
const WS_URL = "wss://websocket.azhkthg1.net/websocket?token=";
const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJzc2NoaWNobWVtIiwiYm90IjowLCJpc01lcmNoYW50IjpmYWxzZSwidmVyaWZpZWRCYW5rQWNjb3VudCI6ZmFsc2UsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MzI2OTA1OTg1LCJhZmZJZCI6InN1bndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoic3VuLndpbiIsInRpbWVzdGFtcCI6MTc2NTQ2OTYxNjg3MCwibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOmZhbHNlLCJpcEFkZHJlc3MiOiIyNDAyOjgwMDo2ZjVmOmNiYzU6ODRjMTo2YzQzOjhmZGQ6NDdkYSIsIm11dGUiOmZhbHNlLCJhdmF0YXIiOiJodHRwczovL2ltYWdlcy5zd2luc2hvcC5uZXQvaW1hZ2VzL2F2YXRhci9hdmF0YXJfMTkucG5nIiwicGxhdGZvcm1JZCI6MiwidXNlcklkIjoiOWQyMTliNGYtMjQxYS00ZmU2LTkyNDItMDQ5MWYxYzRhMDVjIiwicmVnVGltZSI6MTc2MzcyNzkwNzk0MCwicGhvbmUiOiIiLCJkZXBvc2l0IjpmYWxzZSwidXNlcm5hbWUiOiJTQ19naWF0aGluaDIxMzMifQ.XGiELjKKAgIc-0dKYjZFOlDeH2e-LC_PvrvrzPcdY1U";

// --- GLOBAL STATE ---
let results = [];
let rikWS = null;
let rikIntervalCmd = null;
let rikCurrentSession = null;

// --- LOẠI CẦU (Logic Cũ) ---
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
};

// --- AI CORE (Logic SmartAI Cũ) ---
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
      timestamp: new Date().toISOString()
    };

    // Kiểm tra prediction
    if (this.pendingPrediction && this.pendingPrediction.forSession === parsed.session) {
      this.stats.total++;
      const isCorrect = this.pendingPrediction.raw === parsed.tx;
      
      if (isCorrect) this.stats.correct++;
      else this.stats.wrong++;

      this.predictionLog.push({
        session: parsed.session,
        predicted: this.pendingPrediction.raw,
        actual: parsed.tx,
        correct: isCorrect
      });

      if (this.predictionLog.length > 100) {
        this.predictionLog = this.predictionLog.slice(-100);
      }
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
      timestamp: new Date().toISOString()
    })).sort((a, b) => a.session - b.session);
  }

  savePredictionForNextSession(currentSession) {
    const pred = this.predict();
    this.pendingPrediction = {
      ...pred,
      forSession: currentSession + 1,
      createdAt: new Date().toISOString()
    };
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

  getCurrentPrediction() {
    if (!this.pendingPrediction) return this.predict();
    return this.pendingPrediction;
  }

  getStats() {
    return {
      so_lan_du_doan: this.stats.total,
      so_dung: this.stats.correct,
      so_sai: this.stats.wrong,
      ti_le_dung: this.stats.total > 0 ? `${Math.round((this.stats.correct / this.stats.total) * 100)}%` : "0%"
    };
  }
}

const ai = new SmartAI();

// --- API SERVER (JSON CŨ) ---
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

app.get("/sunwinsew", async () => {
  try {
    const lastResult = results[0];
    
    if (!lastResult) {
      return {
        id: "@minhsangdangcap",
        phien_hien_tai: null,
        ket_qua: null,
        tong: null,
        phien_du_doan: null,
        du_doan: null,
        pattern: null,
        loai_cau: null,
        thong_ke: ai.getStats()
      };
    }

    const prediction = ai.getCurrentPrediction();
    const nextSession = lastResult.session + 1;

    // --- JSON OUTPUT GỐC ---
    return {
      id: "@minhsangdangcap",
      phien_hien_tai: lastResult.session,
      ket_qua: lastResult.result.toLowerCase(),
      tong: lastResult.total,
      phien_du_doan: nextSession,
      du_doan: prediction.prediction,
      confidence: prediction.confidence,
      pattern: ai.getPattern(),
      loai_cau: ai.detectBridgeType(), // Dòng này quan trọng với bạn
      thong_ke: ai.getStats()
    };
  } catch (error) {
    return { 
      id: "@minhsangdangcap",
      error: error.message 
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
        ai_stats: ai.getStats()
    }
});

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`\n🚀 Server chạy tại: http://localhost:${PORT}`);

// --- WEBSOCKET HANDLERS (LOGIC MỚI - KẾT NỐI CHUẨN) ---
function decodeBinaryMessage(data) {
    try {
        const message = new TextDecoder().decode(data);
        if (message.startsWith("[") || message.startsWith("{")) {
            return JSON.parse(message);
        }
        return null;
    } catch { return null; }
}

function sendRikCmd1005() {
    if (rikWS?.readyState === WebSocket.OPEN) {
        // Gửi lệnh lấy lịch sử
        rikWS.send(JSON.stringify([6, "MiniGame", "taixiuPlugin", { cmd: 1005 }]));
    }
}

function connectRikWebSocket() {
    console.log("\n🔌 Đang kết nối WebSocket...");
    if (rikWS) {
        try { rikWS.close(); } catch(e) {}
        rikWS = null;
    }
    if (rikIntervalCmd) clearInterval(rikIntervalCmd);

    rikWS = new WebSocket(`${WS_URL}${TOKEN}`);

    rikWS.on("open", () => {
        console.log("✅ WebSocket Connected! Đang gửi xác thực...");
        const authPayload = [1, "MiniGame", "SC_giathinh2133", "thinh211", {
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
        
        rikWS.send(JSON.stringify(authPayload));
        rikIntervalCmd = setInterval(sendRikCmd1005, 3000); 
    });

    rikWS.on("message", (data) => {
        try {
            const json = typeof data === "string" ? JSON.parse(data) : decodeBinaryMessage(data);
            if (!json) return;

            // Xử lý LIVE
            if (json.session && Array.isArray(json.dice)) {
                const record = {
                    session: json.session,
                    dice: json.dice,
                    total: json.total,
                    result: json.result,
                };
                
                ai.addResult(record); // Nạp vào AI
                
                if (!rikCurrentSession || record.session > rikCurrentSession) {
                    rikCurrentSession = record.session;
                    results.unshift(ai.addResult(record)); // Lưu vào results để API trả về
                    if (results.length > 100) results.pop();
                    
                    ai.savePredictionForNextSession(record.session); // Lưu dự đoán cho phiên sau
                    
                    console.log(`\n🎲 KẾT QUẢ #${record.session}: ${record.result}`);
                }
            } 
            // Xử lý LỊCH SỬ
            else if (Array.isArray(json) && json[1]?.htr) {
                const newHistory = json[1].htr.map((i) => ({
                    session: i.sid,
                    dice: [i.d1, i.d2, i.d3],
                    total: i.d1 + i.d2 + i.d3,
                    result: i.d1 + i.d2 + i.d3 >= 11 ? "Tài" : "Xỉu",
                    tx: i.d1 + i.d2 + i.d3 >= 11 ? "T" : "X"
                })).sort((a, b) => a.session - b.session);

                if (results.length === 0) {
                     console.log(`📊 Đã nhận ${newHistory.length} dòng lịch sử.`);
                     ai.loadHistory(newHistory);
                     results = newHistory.slice(-100).reverse();
                     // Dự đoán ngay cho phiên tiếp theo
                     if(results[0]) ai.savePredictionForNextSession(results[0].session);
                }
            }
        } catch (e) {}
    });

    rikWS.on("close", () => {
        setTimeout(connectRikWebSocket, 3000);
    });
}

connectRikWebSocket();
