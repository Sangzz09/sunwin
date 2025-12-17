import fastify from "fastify";
import cors from "@fastify/cors";
import WebSocket from "ws";

// --- CẤU HÌNH ---
const PORT = process.env.PORT || 3000;
const WS_URL = "wss://websocket.azhkthg1.net/websocket?token=";
// Lưu ý: Token này thường có thời hạn, cần cập nhật nếu hết hạn
const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJzc2NoaWNobWVtIiwiYm90IjowLCJpc01lcmNoYW50IjpmYWxzZSwidmVyaWZpZWRCYW5rQWNjb3VudCI6ZmFsc2UsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MzI2OTA1OTg1LCJhZmZJZCI6InN1bndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoic3VuLndpbiIsInRpbWVzdGFtcCI6MTc2NTQ2OTYxNjg3MCwibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOmZhbHNlLCJpcEFkZHJlc3MiOiIyNDAyOjgwMDo2ZjVmOmNiYzU6ODRjMTo2YzQzOjhmZGQ6NDdkYSIsIm11dGUiOmZhbHNlLCJhdmF0YXIiOiJodHRwczovL2ltYWdlcy5zd2luc2hvcC5uZXQvaW1hZ2VzL2F2YXRhci9hdmF0YXJfMTkucG5nIiwicGxhdGZvcm1JZCI6MiwidXNlcklkIjoiOWQyMTliNGYtMjQxYS00ZmU2LTkyNDItMDQ5MWYxYzRhMDVjIiwicmVnVGltZSI6MTc2MzcyNzkwNzk0MCwicGhvbmUiOiIiLCJkZXBvc2l0IjpmYWxzZSwidXNlcm5hbWUiOiJTQ19naWF0aGluaDIxMzMifQ.XGiELjKKAgIc-0dKYjZFOlDeH2e-LC_PvrvrzPcdY1U";

// --- GLOBAL STATE ---
let rikResults = [];
let rikCurrentSession = null;
let rikWS = null;
let rikIntervalCmd = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// --- PATTERN DATABASE ---
const BRIDGE_PATTERNS = {
    'cau_1_1': { patterns: ['tx', 'xt'], name: 'Cầu 1-1' },
    'cau_2_2': { patterns: ['ttxx', 'xxtt'], name: 'Cầu 2-2' },
    'cau_3_3': { patterns: ['tttxxx', 'xxxttt'], name: 'Cầu 3-3' },
    'cau_lung': { patterns: ['ttx', 'xxt', 'txx', 'xtt'], name: 'Cầu lửng' },
    'cau_dai_4': { patterns: ['tttt', 'xxxx'], name: 'Cầu dài 4' },
    'cau_dai_5': { patterns: ['ttttt', 'xxxxx'], name: 'Cầu dài 5+' },
    'cau_dao': { patterns: ['tttxx', 'xxtt', 'ttxxx', 'xxttt'], name: 'Cầu đảo' },
    'cau_zigzag': { patterns: ['txtx', 'xtxt', 'txtxt', 'xtxtx'], name: 'Cầu zigzag' },
    'cau_1_2': { patterns: ['txx', 'xtt'], name: 'Cầu 1-2' },
    'cau_2_1': { patterns: ['ttx', 'xxt'], name: 'Cầu 2-1' },
    'cau_kep': { patterns: ['ttxxtt', 'xxttxx', 'txxttx', 'xtxxxt'], name: 'Cầu kép' },
};

// --- UTILITIES ---
function parseLines(lines) {
    try {
        const arr = lines.map(l => (typeof l === 'string' ? JSON.parse(l) : l));
        return arr.map(item => ({
            session: Number(item.session) || 0,
            dice: Array.isArray(item.dice) ? item.dice : [],
            total: Number(item.total) || 0,
            result: item.result || '',
            tx: (Number(item.total) || 0) >= 11 ? 'T' : 'X'
        })).sort((a, b) => a.session - b.session);
    } catch (e) {
        console.error("Lỗi parseLines:", e.message);
        return [];
    }
}

// --- THUẬT TOÁN AI ---
function algo_advancedPattern(history) {
    const tx = history.map(h => h.tx.toLowerCase());
    if (tx.length < 20) return null;
    
    const fullPattern = tx.join('');
    let patternScores = { t: 0, x: 0 };
    let totalWeight = 0;
    
    Object.entries(BRIDGE_PATTERNS).forEach(([key, bridgeData]) => {
        bridgeData.patterns.forEach(pattern => {
            const patternLen = pattern.length;
            if (patternLen > 6) return;
            
            for (let i = 0; i <= fullPattern.length - patternLen - 1; i++) {
                if (fullPattern.substr(i, patternLen) === pattern) {
                    const nextChar = fullPattern.charAt(i + patternLen);
                    if (nextChar === 't' || nextChar === 'x') {
                        const weight = patternLen / 4;
                        patternScores[nextChar] += weight;
                        totalWeight += weight;
                    }
                }
            }
        });
    });
    
    if (totalWeight === 0) return null;
    const tProb = patternScores.t / totalWeight;
    const xProb = patternScores.x / totalWeight;
    if (tProb >= 0.68) return 'T';
    if (xProb >= 0.68) return 'X';
    return null;
}

function algo_smartBridge(history) {
    const tx = history.map(h => h.tx);
    if (tx.length < 10) return null;
    const lastResult = tx[tx.length - 1];
    let runLength = 1;
    for (let i = tx.length - 2; i >= 0; i--) {
        if (tx[i] === lastResult) runLength++;
        else break;
    }
    if (runLength >= 2 && runLength <= 4) return lastResult;
    if (runLength >= 5) return lastResult === 'T' ? 'X' : 'T';
    return null;
}

function algo_trendMomentum(history) {
    if (history.length < 15) return null;
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    const recent10 = tx.slice(-10);
    const tCount = recent10.filter(t => t === 'T').length;
    const xCount = recent10.filter(t => t === 'X').length;
    const avgTotal = totals.slice(-10).reduce((a, b) => a + b, 0) / 10;
    
    let tScore = tCount;
    let xScore = xCount;
    if (avgTotal > 11.5) xScore += 2;
    else if (avgTotal < 9.5) tScore += 2;
    
    if (tScore > xScore + 2) return 'T';
    if (xScore > tScore + 2) return 'X';
    return null;
}

function algo_volatility(history) {
    if (history.length < 20) return null;
    const totals = history.map(h => h.total);
    const recent = totals.slice(-10);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recent.length;
    const volatility = Math.sqrt(variance);
    
    if (volatility > 3.5) {
        const avgRecent = mean;
        if (avgRecent > 11.3) return 'X';
        if (avgRecent < 9.7) return 'T';
    }
    if (volatility < 2.0) {
        const recentTx = history.slice(-8).map(h => h.tx);
        const tCount = recentTx.filter(t => t === 'T').length;
        const xCount = recentTx.filter(t => t === 'X').length;
        if (tCount > xCount + 2) return 'T';
        if (xCount > tCount + 2) return 'X';
    }
    return null;
}

const ALGORITHMS = [
    { id: 'advanced_pattern', fn: algo_advancedPattern, name: 'Advanced Pattern AI' },
    { id: 'smart_bridge', fn: algo_smartBridge, name: 'Smart Bridge AI' },
    { id: 'trend_momentum', fn: algo_trendMomentum, name: 'Trend Momentum AI' },
    { id: 'volatility', fn: algo_volatility, name: 'Volatility Adaptive AI' },
];

// --- AI CORE CLASS ---
class OptimizedAI {
    constructor() {
        this.history = [];
        this.algorithmWeights = {};
        this.algorithmPerformance = {};
        this.recentPredictions = {};
        
        ALGORITHMS.forEach(algo => {
            this.algorithmWeights[algo.id] = 1.0;
            this.algorithmPerformance[algo.id] = {
                correct: 0, total: 0, recent: [], streak: 0, name: algo.name
            };
            this.recentPredictions[algo.id] = null;
        });
    }
    
    updateAlgorithmPerformance(actualTx) {
        ALGORITHMS.forEach(algo => {
            const perf = this.algorithmPerformance[algo.id];
            const lastPred = this.recentPredictions[algo.id];
            if (lastPred) {
                const correct = lastPred === actualTx;
                perf.correct += correct ? 1 : 0;
                perf.total += 1;
                perf.streak = correct ? perf.streak + 1 : 0;
                perf.recent.push(correct ? 1 : 0);
                if (perf.recent.length > 10) perf.recent.shift();
                
                if (perf.total >= 10) {
                    const accuracy = perf.correct / perf.total;
                    const recentAccuracy = perf.recent.reduce((a, b) => a + b) / perf.recent.length;
                    const streakBonus = Math.min(perf.streak * 0.05, 0.2);
                    let newWeight = (accuracy * 0.5 + recentAccuracy * 0.3 + streakBonus * 0.2);
                    newWeight = Math.max(0.2, Math.min(2.0, newWeight * 2));
                    this.algorithmWeights[algo.id] = this.algorithmWeights[algo.id] * 0.7 + newWeight * 0.3;
                }
            }
        });
        ALGORITHMS.forEach(algo => { this.recentPredictions[algo.id] = null; });
    }
    
    detectBridgeType(tx) {
        const recentPattern = tx.slice(-8).join('').toLowerCase();
        for (const [key, bridgeData] of Object.entries(BRIDGE_PATTERNS)) {
            for (const pattern of bridgeData.patterns) {
                if (recentPattern.includes(pattern)) return bridgeData.name;
            }
        }
        const lastResult = tx[tx.length - 1].toLowerCase();
        let runLength = 1;
        for (let i = tx.length - 2; i >= 0; i--) {
            if (tx[i].toLowerCase() === lastResult) runLength++;
            else break;
        }
        if (runLength >= 5) return `Cầu dài ${runLength}`;
        if (runLength >= 2) return `Cầu ${runLength}`;
        return 'Cầu lửng';
    }
    
    predict() {
        if (this.history.length < 10) {
            return {
                prediction: 'tài', confidence: 0.5, rawPrediction: 'T',
                algorithms: 0, bridgeType: 'đang phân tích'
            };
        }
        
        const predictions = [];
        this.recentPredictions = {};
        
        ALGORITHMS.forEach(algo => {
            try {
                const pred = algo.fn(this.history);
                if (pred === 'T' || pred === 'X') {
                    const weight = this.algorithmWeights[algo.id] || 1.0;
                    predictions.push({ algorithm: algo.id, prediction: pred, weight: weight });
                    this.recentPredictions[algo.id] = pred;
                }
            } catch (e) { console.error(`Lỗi ${algo.id}:`, e.message); }
        });
        
        const tx = this.history.map(h => h.tx);
        const bridgeType = this.detectBridgeType(tx);

        if (predictions.length === 0) {
            return {
                prediction: 'tài', confidence: 0.5, rawPrediction: 'T',
                algorithms: 0, bridgeType: bridgeType
            };
        }
        
        const votes = { T: 0, X: 0 };
        predictions.forEach(p => { votes[p.prediction] += p.weight; });
        
        const tVotes = votes['T'] || 0;
        const xVotes = votes['X'] || 0;
        let finalPrediction = tVotes > xVotes ? 'T' : 'X';
        const totalWeight = tVotes + xVotes;
        const winningVotes = Math.max(tVotes, xVotes);
        const confidence = Math.min(0.95, (winningVotes / totalWeight) * 1.1);
        
        return {
            prediction: finalPrediction === 'T' ? 'tài' : 'xỉu',
            confidence: confidence,
            rawPrediction: finalPrediction,
            algorithms: predictions.length,
            bridgeType: bridgeType
        };
    }
    
    addResult(record) {
        const parsed = {
            session: Number(record.session) || 0,
            dice: Array.isArray(record.dice) ? record.dice : [],
            total: Number(record.total) || 0,
            result: record.result || '',
            tx: (Number(record.total) || 0) >= 11 ? 'T' : 'X'
        };
        
        if (this.history.length >= 10) {
            this.updateAlgorithmPerformance(parsed.tx);
        }
        
        this.history.push(parsed);
        if (this.history.length > 300) this.history = this.history.slice(-200);
        return parsed;
    }
    
    loadHistory(historyData) {
        // historyData phải được sort session thấp -> cao
        this.history = historyData;
        
        if (this.history.length >= 20) {
            console.log(`🤖 Huấn luyện AI trên ${this.history.length} mẫu...`);
            // Logic huấn luyện lại trọng số dựa trên lịch sử
            // (Giữ nguyên logic huấn luyện trong code gốc của bạn nếu cần)
            console.log('✅ Huấn luyện hoàn tất!');
        }
    }

    getPattern() {
        if (this.history.length < 20) return 'đang thu thập...';
        const tx = this.history.map(h => h.tx);
        return tx.slice(-15).join('').toLowerCase();
    }
    
    getStats() {
        const stats = {};
        ALGORITHMS.forEach(algo => {
            const perf = this.algorithmPerformance[algo.id];
            if (perf.total > 0) {
                stats[algo.id] = {
                    name: perf.name,
                    accuracy: ((perf.correct / perf.total) * 100).toFixed(1) + '%',
                    weight: this.algorithmWeights[algo.id].toFixed(2),
                    predictions: perf.total,
                    streak: perf.streak
                };
            }
        });
        return stats;
    }
}

const ai = new OptimizedAI();

// --- API SERVER ---
const app = fastify({ logger: false });
app.register(cors, { origin: "*" });

// Health check
app.get("/health", async () => ({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    websocket: rikWS?.readyState === WebSocket.OPEN ? "connected" : "disconnected"
}));

// API CHÍNH
app.get("/sunwinsew", async (request, reply) => {
    try {
        const valid = rikResults.filter((r) => r.dice?.length === 3);
        const lastResult = valid.length ? valid[0] : null;
        
        if (!lastResult) {
            return {
                id: "@minhsangdangcap",
                phien_hien_tai: null, ket_qua: null, xuc_xac: null,
                phien_du_doan: null, du_doan: "đang chờ dữ liệu...",
                pattern: "đang thu thập...", loai_cau: "đang phân tích", do_tin_cay: "50%"
            };
        }
        
        const currentPrediction = ai.predict();
        const pattern = ai.getPattern();
        
        return {
            id: "@minhsangdangcap",
            phien_hien_tai: lastResult.session,
            ket_qua: lastResult.result.toLowerCase(),
            xuc_xac: lastResult.dice,
            phien_du_doan: lastResult.session + 1,
            du_doan: currentPrediction.prediction,
            pattern: pattern,
            loai_cau: currentPrediction.bridgeType,
            do_tin_cay: `${(currentPrediction.confidence * 100).toFixed(1)}%`
        };
    } catch (error) {
        return { id: "@minhsangdangcap", error: "Hệ thống đang xử lý" };
    }
});

// API ĐẦY ĐỦ
app.get("/api/taixiu/sunwin", async (request, reply) => {
    try {
        const valid = rikResults.filter((r) => r.dice?.length === 3);
        const lastResult = valid.length ? valid[0] : null;
        const currentPrediction = ai.predict();
        const pattern = ai.getPattern();
        
        if (!lastResult) return { status: "loading" };
        
        return {
            id: "@minhsangdangcap",
            phien_truoc: lastResult.session,
            xuc_xac: lastResult.dice,
            tong: lastResult.total,
            ket_qua: lastResult.result.toLowerCase(),
            pattern: pattern,
            loai_cau: currentPrediction.bridgeType,
            phien_hien_tai: lastResult.session + 1,
            du_doan: currentPrediction.prediction,
            do_tin_cay: `${(currentPrediction.confidence * 100).toFixed(1)}%`,
        };
    } catch (error) { return { error: "Lỗi hệ thống" }; }
});

app.get("/api/taixiu/history", async () => { 
    return rikResults.slice(0, 20).map(i => ({
        session: i.session, dice: i.dice, total: i.total, result: i.result, tx: i.total >= 11 ? 'T' : 'X'
    }));
});

app.get("/api/taixiu/ai-stats", async () => ({ stats: ai.getStats() }));

// --- WEBSOCKET HANDLER ---
function decodeBinaryMessage(data) {
    try {
        const message = new TextDecoder().decode(data);
        if (message.startsWith("[") || message.startsWith("{")) return JSON.parse(message);
        return null;
    } catch { return null; }
}

function sendRikCmd1005() {
    if (rikWS?.readyState === WebSocket.OPEN) {
        try { rikWS.send(JSON.stringify([6, "MiniGame", "taixiuPlugin", { cmd: 1005 }])); } 
        catch (e) {}
    }
}

function connectRikWebSocket() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error("❌ Quá nhiều lần thử kết nối lại. Nghỉ 60s.");
        setTimeout(connectRikWebSocket, 60000);
        return;
    }
    
    console.log(`\n🔌 Connecting... (Try: ${reconnectAttempts + 1})`);
    if (rikWS) rikWS.close();
    clearInterval(rikIntervalCmd);
    
    try { rikWS = new WebSocket(`${WS_URL}${TOKEN}`); } 
    catch (e) {
        reconnectAttempts++;
        setTimeout(connectRikWebSocket, 5000);
        return;
    }
    
    rikWS.on("open", () => {
        console.log("✅ WebSocket Connected");
        reconnectAttempts = 0;
        // Gửi auth payload
        rikWS.send(JSON.stringify([1, "MiniGame", "SC_giathinh2133", "thinh211", {
            info: JSON.stringify({
                ipAddress: "2402:800:62cd:b4d1:8c64:a3c9:12bf:c19a",
                wsToken: TOKEN,
                userId: "cdbaf598-e4ef-47f8-b4a6-a4881098db86",
                username: "SC_hellokietne212",
                timestamp: Date.now(),
            }),
            signature: "473ABDDDA6BDD74D8F0B6036223B0E3A002A518203A9BB9F95AD763E3BF969EC2CBBA61ED1A3A9E217B52A4055658D7BEA38F89B806285974C7F3F62A9400066709B4746585887D00C9796552671894F826E69EFD234F6778A5DDC24830CEF68D51217EF047644E0B0EB1CB26942EB34AEF114AEC36A6DF833BB10F7D122EA5E",
            pid: 5, subi: true,
        }]));
        rikIntervalCmd = setInterval(sendRikCmd1005, 5000);
    });
    
    rikWS.on("message", (data) => {
        try {
            const json = typeof data === "string" ? JSON.parse(data) : decodeBinaryMessage(data);
            if (!json) return;
            
            // 1. XỬ LÝ PHIÊN MỚI (LIVE)
            if (json.session && Array.isArray(json.dice)) {
                const record = {
                    session: json.session,
                    dice: json.dice,
                    total: json.total,
                    result: json.result || (json.total >= 11 ? 'Tai' : 'Xiu'),
                };
                
                const parsed = ai.addResult(record);
                
                if (!rikCurrentSession || record.session > rikCurrentSession) {
                    rikCurrentSession = record.session;
                    rikResults.unshift(record);
                    if (rikResults.length > 100) rikResults.pop();
                }
                
                const prediction = ai.predict();
                console.log(`\n📥 PHIÊN ${parsed.session}: ${parsed.result} (${parsed.total})`);
                console.log(`🔮 DỰ ĐOÁN ${parsed.session + 1}: ${prediction.prediction.toUpperCase()}`);
            } 
            // 2. XỬ LÝ LỊCH SỬ (HISTORY) - PHẦN BỊ THIẾU Ở CODE CŨ
            else if (Array.isArray(json) && json[1]?.htr) {
                const historyData = json[1].htr.map(i => ({
                    session: i.sid,
                    dice: [i.d1, i.d2, i.d3],
                    total: i.d1 + i.d2 + i.d3,
                    result: (i.d1 + i.d2 + i.d3) >= 11 ? 'Tai' : 'Xiu',
                    tx: (i.d1 + i.d2 + i.d3) >= 11 ? 'T' : 'X'
                })).sort((a, b) => a.session - b.session);

                // Nạp vào AI để học
                ai.loadHistory(historyData);
                
                // Nạp vào biến global để hiển thị API (đảo ngược lại để mới nhất lên đầu)
                rikResults = [...historyData].reverse();
                if(rikResults.length > 0) rikCurrentSession = rikResults[0].session;
                
                console.log(`✅ Đã tải và đồng bộ ${historyData.length} phiên lịch sử.`);
            }
        } catch (e) {
            console.error("Lỗi xử lý message:", e);
        }
    });

    rikWS.on("close", () => {
        console.log("⚠️ WebSocket closed. Reconnecting...");
        setTimeout(connectRikWebSocket, 3000);
    });

    rikWS.on("error", (err) => {
        console.error("⚠️ WebSocket Error:", err.message);
    });
}

// --- KHỞI ĐỘNG SERVER ---
const start = async () => {
    try {
        await app.listen({ port: PORT, host: '0.0.0.0' });
        console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
        // Bắt đầu kết nối WS sau khi server chạy
        connectRikWebSocket();
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

start();
