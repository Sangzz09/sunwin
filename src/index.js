import fastify from "fastify";
import cors from "@fastify/cors";
import WebSocket from "ws";

// --- CẤU HÌNH ---
const PORT = process.env.PORT || 3000;
const WS_URL = "wss://websocket.azhkthg1.net/websocket?token=";
const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJzc2NoaWNobWVtIiwiYm90IjowLCJpc01lcmNoYW50IjpmYWxzZSwidmVyaWZpZWRCYW5rQWNjb3VudCI6ZmFsc2UsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MzI2OTA1OTg1LCJhZmZJZCI6InN1bndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoic3VuLndpbiIsInRpbWVzdGFtcCI6MTc2NTQ2OTYxNjg3MCwibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOmZhbHNlLCJpcEFkZHJlc3MiOiIyNDAyOjgwMDo2ZjVmOmNiYzU6ODRjMTo2YzQzOjhmZGQ6NDdkYSIsIm11dGUiOmZhbHNlLCJhdmF0YXIiOiJodHRwczovL2ltYWdlcy5zd2luc2hvcC5uZXQvaW1hZ2VzL2F2YXRhci9hdmF0YXJfMTkucG5nIiwicGxhdGZvcm1JZCI6MiwidXNlcklkIjoiOWQyMTliNGYtMjQxYS00ZmU2LTkyNDItMDQ5MWYxYzRhMDVjIiwicmVnVGltZSI6MTc2MzcyNzkwNzk0MCwicGhvbmUiOiIiLCJkZXBvc2l0IjpmYWxzZSwidXNlcm5hbWUiOiJTQ19naWF0aGluaDIxMzMifQ.XGiELjKKAgIc-0dKYjZFOlDeH2e-LC_PvrvrzPcdY1U";

// --- GLOBAL STATE ---
let rikResults = [];
let rikCurrentSession = null;
let rikWS = null;
let rikIntervalCmd = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// --- PATTERN DATABASE ---
const PATTERN_DATABASE = {
    'Cầu 1-1': ['tx', 'xt'], 
    'Cầu Bệt': ['tt', 'xx'],
    'Cầu 2-2': ['ttxx', 'xxtt'],
    'Cầu 3-3': ['tttxxx', 'xxxttt'],
    'Cầu 4-4': ['ttttxxxx', 'xxxxtttt'],
    'Cầu 1-2-3': ['txxttt', 'xttxxx'],
    'Cầu 3-2-1': ['tttxtx', 'xxxtxt'],
    'Cầu Đảo': ['tttxx', 'xxxtt', 'ttx', 'xxt'],
    'Cầu Lỗi 1-1': ['txtx', 'xtxt'],
    'Sóng Âm': ['txx', 'xtt'],
    'Sóng Dương': ['ttx', 'xxt'],
    'Cầu Đối Xứng': ['ttxtt', 'xxtxx'],
    'ZigZag': ['txt', 'xtx'],
    'Fibonacci': ['tx', 'txx', 'txttx']
};

// --- HELPER FUNCTIONS ---
function calculateVolatility(numbers) {
    if (numbers.length === 0) return 0;
    const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
    const variance = numbers.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / numbers.length;
    return Math.sqrt(variance);
}

function calculateRSI(txArray) {
    if (txArray.length < 14) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i < txArray.length; i++) {
        if (txArray[i] === 'T' && txArray[i-1] === 'X') gains++;
        else if (txArray[i] === 'X' && txArray[i-1] === 'T') losses++;
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
}

function calculateEMA(numbers, period) {
    const multiplier = 2 / (period + 1);
    let ema = numbers[0];
    for (let i = 1; i < numbers.length; i++) {
        ema = numbers[i] * multiplier + ema * (1 - multiplier);
    }
    return ema;
}

function calculateMACD(totals) {
    if (totals.length < 26) return 0;
    const ema12 = calculateEMA(totals.slice(-12), 12);
    const ema26 = calculateEMA(totals.slice(-26), 26);
    return ema12 - ema26;
}

// --- CÁC THUẬT TOÁN AI ---

// 1. Ultra Pattern Recognition
function algo1_ultraPatternRecognition(history) {
    const tx = history.map(h => h.tx);
    if (tx.length < 20) return null;
    const txLower = tx.map(t => t.toLowerCase());
    const fullPattern = txLower.join('');
    let patternMatches = { t: 0, x: 0 };
    let totalWeight = 0;
    Object.values(PATTERN_DATABASE).forEach(patternList => {
        patternList.forEach(pattern => {
            const patternLength = pattern.length;
            for (let i = 0; i <= fullPattern.length - patternLength - 1; i++) {
                if (fullPattern.substr(i, patternLength) === pattern) {
                    const nextChar = fullPattern.charAt(i + patternLength);
                    if (nextChar === 't' || nextChar === 'x') {
                        const weight = (patternLength / 5);
                        patternMatches[nextChar] += weight;
                        totalWeight += weight;
                    }
                }
            }
        });
    });
    if (totalWeight === 0) return null;
    const tProb = patternMatches.t / totalWeight;
    const xProb = patternMatches.x / totalWeight;
    if (tProb >= 0.55) return 'T';
    if (xProb >= 0.55) return 'X';
    return null;
}

// 2. Quantum Adaptive AI
function algo2_quantumAdaptiveAI(history) {
    if (history.length < 30) return null;
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    const state = { t: 0.5, x: 0.5 };
    const recentCount = Math.min(20, history.length);
    for (let i = history.length - recentCount; i < history.length; i++) {
        const weight = 0.05;
        if (tx[i] === 'T') { state.t *= (1 + weight); state.x *= (1 - weight); }
        else { state.x *= (1 + weight); state.t *= (1 - weight); }
    }
    const recentAvg = totals.slice(-10).reduce((a, b) => a + b, 0) / 10;
    if (recentAvg > 12) { state.t *= 0.9; state.x *= 1.1; }
    else if (recentAvg < 8) { state.t *= 1.1; state.x *= 0.9; }
    if (state.t > state.x) return 'T';
    if (state.x > state.t) return 'X';
    return null;
}

// 3. Deep Trend Analysis
function algo3_deepTrendAnalysis(history) {
    if (history.length < 20) return null;
    const tx = history.map(h => h.tx);
    const trends = { t: 0, x: 0 };
    [5, 10, 15].forEach(period => {
        const recent = tx.slice(-period);
        const tCount = recent.filter(c => c === 'T').length;
        const xCount = recent.filter(c => c === 'X').length;
        if (tCount > xCount) trends.t++; else if (xCount > tCount) trends.x++;
    });
    if (trends.t > trends.x) return 'T';
    if (trends.x > trends.t) return 'X';
    return null;
}

// 4. Smart Bridge Detection
function algo4_smartBridgeDetection(history) {
    const tx = history.map(h => h.tx);
    if (tx.length < 10) return null;
    const lastResult = tx[tx.length - 1];
    let run = 1;
    for (let i = tx.length - 2; i >= 0; i--) {
        if (tx[i] === lastResult) run++; else break;
    }
    if (run >= 4) return lastResult;
    return null;
}

// 5. Volatility Prediction
function algo5_volatilityPrediction(history) {
    if (history.length < 25) return null;
    const totals = history.map(h => h.total);
    const vol = calculateVolatility(totals.slice(-10));
    if (vol < 2.0) {
        const last = history[history.length - 1].tx;
        return last === 'T' ? 'X' : 'T';
    }
    return null;
}

// 6. Pattern Fusion
function algo6_patternFusionAI(history) {
    const tx = history.map(h => h.tx).join('');
    if (tx.endsWith('TXT')) return 'X';
    if (tx.endsWith('XTX')) return 'T';
    if (tx.endsWith('TTX')) return 'X';
    if (tx.endsWith('XXT')) return 'T';
    return null;
}

// 7. Real-time Indicators (RSI/MACD)
function algo7_realtimeAdaptiveAI(history) {
    if (history.length < 20) return null;
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    const rsi = calculateRSI(tx.slice(-14));
    const macd = calculateMACD(totals);
    let tScore = 0, xScore = 0;
    if (rsi > 70) xScore += 1.5; else if (rsi < 30) tScore += 1.5;
    if (macd > 0.5) tScore += 1; else if (macd < -0.5) xScore += 1;
    if (tScore > xScore + 1.0) return 'T';
    if (xScore > tScore + 1.0) return 'X';
    return null;
}

const ALGORITHMS = [
    { id: 'ultra_pattern', fn: algo1_ultraPatternRecognition, name: 'Ultra Pattern AI' },
    { id: 'quantum_ai', fn: algo2_quantumAdaptiveAI, name: 'Quantum Adaptive AI' },
    { id: 'deep_trend', fn: algo3_deepTrendAnalysis, name: 'Deep Trend AI' },
    { id: 'smart_bridge', fn: algo4_smartBridgeDetection, name: 'Smart Bridge AI' },
    { id: 'volatility', fn: algo5_volatilityPrediction, name: 'Volatility AI' },
    { id: 'pattern_fusion', fn: algo6_patternFusionAI, name: 'Pattern Fusion AI' },
    { id: 'realtime_ai', fn: algo7_realtimeAdaptiveAI, name: 'Real-time AI' },
];

// --- AI CORE CLASS ---
class AdvancedDeepLearningAI {
    constructor() {
        this.history = [];
        this.algorithmWeights = {};
        this.algorithmPerformance = {};
        this.lastPredictions = {}; 
        
        // Stats Variables
        this.globalStats = {
            total: 0,
            correct: 0,
            wrong: 0
        };
        this.nextSessionPrediction = null; // Lưu dự đoán cho phiên tiếp theo để đối chiếu

        ALGORITHMS.forEach(algo => {
            this.algorithmWeights[algo.id] = 1.0;
            this.algorithmPerformance[algo.id] = { correct: 0, total: 0, streak: 0, name: algo.name };
        });
    }

    // Logic phát hiện tên loại cầu
    detectBridgeType() {
        if (this.history.length < 5) return "Đang phân tích...";
        
        const tx = this.history.map(h => h.tx.toLowerCase());
        const fullStr = tx.join('');
        const recentStr = tx.slice(-8).join(''); // Lấy 8 phiên gần nhất

        // 1. Check Bệt thủ công (vì bệt có thể dài vô tận)
        const last = tx[tx.length - 1];
        let run = 1;
        for (let i = tx.length - 2; i >= 0; i--) {
            if (tx[i] === last) run++; else break;
        }
        if (run >= 4) return `Bệt ${last === 't' ? 'Tài' : 'Xỉu'} (${run})`;

        // 2. Check Database
        for (const [name, patterns] of Object.entries(PATTERN_DATABASE)) {
            for (const pattern of patterns) {
                if (recentStr.endsWith(pattern)) {
                    return name;
                }
            }
        }

        // 3. Mặc định
        return "Cầu Tự Do";
    }

    updateAlgorithmPerformance(actualTx) {
        ALGORITHMS.forEach(algo => {
            const perf = this.algorithmPerformance[algo.id];
            const lastPred = this.lastPredictions[algo.id];
            if (lastPred) {
                const correct = lastPred === actualTx;
                perf.total++;
                if (correct) {
                    perf.correct++;
                    perf.streak++;
                    this.algorithmWeights[algo.id] += Math.min(perf.streak * 0.05, 0.5);
                } else {
                    perf.streak = 0;
                    this.algorithmWeights[algo.id] = Math.max(0.1, this.algorithmWeights[algo.id] - 0.1);
                }
                this.algorithmWeights[algo.id] = Math.min(3.0, this.algorithmWeights[algo.id]);
            }
        });
        this.lastPredictions = {};
    }

    predict() {
        if (this.history.length < 10) {
            return { prediction: 'tài', confidence: 0.5, rawPrediction: 'T', algorithms: 0, bridgeType: 'Loading...' };
        }

        const predictions = [];
        this.lastPredictions = {};

        ALGORITHMS.forEach(algo => {
            try {
                const pred = algo.fn(this.history);
                if (pred === 'T' || pred === 'X') {
                    const weight = this.algorithmWeights[algo.id];
                    predictions.push({ algorithm: algo.id, prediction: pred, weight: weight });
                    this.lastPredictions[algo.id] = pred;
                }
            } catch (e) {}
        });

        const bridgeType = this.detectBridgeType();

        if (predictions.length === 0) {
            // Lưu dự đoán mặc định
            this.nextSessionPrediction = { session: this.history[this.history.length-1].session + 1, pick: 'T' };
            return { prediction: 'tài', confidence: 0.5, rawPrediction: 'T', algorithms: 0, bridgeType: bridgeType };
        }

        const votes = { T: 0, X: 0 };
        predictions.forEach(p => { votes[p.prediction] += p.weight; });

        const finalPrediction = votes['T'] >= votes['X'] ? 'T' : 'X';
        const totalWeight = votes['T'] + votes['X'];
        const confidence = totalWeight > 0 ? Math.max(votes['T'], votes['X']) / totalWeight : 0.5;

        // Lưu dự đoán cho phiên sau để tính thống kê
        this.nextSessionPrediction = {
            session: this.history[this.history.length - 1].session + 1,
            pick: finalPrediction
        };

        return {
            prediction: finalPrediction === 'T' ? 'tài' : 'xỉu',
            confidence: Math.min(0.99, confidence),
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

        // --- CẬP NHẬT THỐNG KÊ (STATS) ---
        // Kiểm tra xem phiên vừa về (parsed.session) có phải là phiên mình đã dự đoán không
        if (this.nextSessionPrediction && this.nextSessionPrediction.session === parsed.session) {
            this.globalStats.total++;
            if (this.nextSessionPrediction.pick === parsed.tx) {
                this.globalStats.correct++;
            } else {
                this.globalStats.wrong++;
            }
        }

        if (this.history.length >= 15) this.updateAlgorithmPerformance(parsed.tx);
        this.history.push(parsed);
        if (this.history.length > 300) this.history = this.history.slice(-200);
        return parsed;
    }

    // Helper lấy thống kê định dạng đẹp
    getStatsFormatted() {
        const total = this.globalStats.total;
        const correct = this.globalStats.correct;
        const wrong = this.globalStats.wrong;
        const rate = total > 0 ? ((correct / total) * 100).toFixed(1) : 0;
        
        return {
            thang: correct,
            thua: wrong,
            tong: total,
            ti_le: `${rate}%`
        };
    }
    
    loadHistory(historyData) { 
        this.history = historyData; 
        // Reset stats khi load lại history để tránh cộng dồn sai
        // this.globalStats = { total: 0, correct: 0, wrong: 0 };
    }
    
    getPattern() {
        if (this.history.length < 20) return "đang thu thập...";
        const tx = this.history.map(h => h.tx);
        return tx.slice(-15).join('').toLowerCase();
    }
}

const ai = new AdvancedDeepLearningAI();

// --- API SERVER ---
const app = fastify({ logger: false });
app.register(cors, { origin: "*" });

// API CHÍNH (Đầy đủ Stats và Loại Cầu)
app.get("/sunwinsew", async (request, reply) => {
    try {
        const valid = rikResults.filter((r) => r.dice?.length === 3);
        const lastResult = valid.length ? valid[0] : null;
        
        if (!lastResult) {
            return {
                id: "@minhsangdangcap",
                status: "waiting",
                du_doan: "đang chờ dữ liệu..."
            };
        }
        
        const currentPrediction = ai.predict();
        const pattern = ai.getPattern();
        const stats = ai.getStatsFormatted(); // Lấy thống kê
        
        return {
            id: "@minhsangdangcap",
            phien_hien_tai: lastResult.session,
            ket_qua: lastResult.result.toLowerCase(),
            xuc_xac: lastResult.dice,
            phien_du_doan: lastResult.session + 1,
            du_doan: currentPrediction.prediction,
            pattern: pattern,
            loai_cau: currentPrediction.bridgeType, // <-- Đã thêm loại cầu
            do_tin_cay: `${(currentPrediction.confidence * 100).toFixed(1)}%`,
            thong_ke: stats // <-- Đã thêm thống kê
        };
    } catch (error) {
        return { error: "Hệ thống đang xử lý" };
    }
});

// API ĐẦY ĐỦ
app.get("/api/taixiu/sunwin", async (request, reply) => {
    try {
        const valid = rikResults.filter((r) => r.dice?.length === 3);
        const lastResult = valid.length ? valid[0] : null;
        if (!lastResult) return { status: "loading" };

        const currentPrediction = ai.predict();
        const pattern = ai.getPattern();
        const stats = ai.getStatsFormatted();

        return {
            id: "@minhsangdangcap",
            phien_truoc: lastResult.session,
            xuc_xac: lastResult.dice,
            tong: lastResult.total,
            ket_qua: lastResult.result.toLowerCase(),
            pattern: pattern,
            phien_hien_tai: lastResult.session + 1,
            du_doan: currentPrediction.prediction,
            loai_cau: currentPrediction.bridgeType,
            do_tin_cay: `${(currentPrediction.confidence * 100).toFixed(1)}%`,
            thong_ke: stats
        };
    } catch (error) { return { error: "Lỗi hệ thống" }; }
});

app.get("/api/taixiu/history", async () => { 
    return rikResults.slice(0, 20).map(i => ({
        session: i.session, dice: i.dice, total: i.total, result: i.result, tx: i.total >= 11 ? 'T' : 'X'
    }));
});

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
    
    const options = {
        headers: {
            "Origin": "https://web.sunwin.win", 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Host": "websocket.azhkthg1.net" 
        }
    };

    try { rikWS = new WebSocket(`${WS_URL}${TOKEN}`, options); } 
    catch (e) {
        reconnectAttempts++;
        setTimeout(connectRikWebSocket, 5000);
        return;
    }
    
    rikWS.on("open", () => {
        console.log("✅ WebSocket Connected");
        reconnectAttempts = 0;
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
            
            if (json.session && Array.isArray(json.dice)) {
                const record = {
                    session: json.session, dice: json.dice, total: json.total,
                    result: json.result || (json.total >= 11 ? 'Tai' : 'Xiu'),
                };
                const parsed = ai.addResult(record);
                if (!rikCurrentSession || record.session > rikCurrentSession) {
                    rikCurrentSession = record.session;
                    rikResults.unshift(record);
                    if (rikResults.length > 100) rikResults.pop();
                }
                const prediction = ai.predict();
                const stats = ai.getStatsFormatted();
                console.log(`\n📥 PHIÊN ${parsed.session}: ${parsed.result} -> DỰ ĐOÁN SAU: ${prediction.prediction.toUpperCase()} | ${prediction.bridgeType}`);
                console.log(`📊 STATS: ${stats.thang}/${stats.tong} (${stats.ti_le})`);
            } 
            else if (Array.isArray(json) && json[1]?.htr) {
                const historyData = json[1].htr.map(i => ({
                    session: i.sid, dice: [i.d1, i.d2, i.d3], total: i.d1 + i.d2 + i.d3,
                    result: (i.d1 + i.d2 + i.d3) >= 11 ? 'Tai' : 'Xiu',
                    tx: (i.d1 + i.d2 + i.d3) >= 11 ? 'T' : 'X'
                })).sort((a, b) => a.session - b.session);
                ai.loadHistory(historyData);
                rikResults = [...historyData].reverse();
                if(rikResults.length > 0) rikCurrentSession = rikResults[0].session;
                console.log(`✅ Đã đồng bộ ${historyData.length} phiên lịch sử.`);
            }
        } catch (e) { console.error("Lỗi socket:", e.message); }
    });

    rikWS.on("close", () => {
        console.log("⚠️ WebSocket closed. Reconnecting...");
        setTimeout(connectRikWebSocket, 3000);
    });
}

// --- START SERVER ---
const start = async () => {
    try {
        await app.listen({ port: PORT, host: '0.0.0.0' });
        console.log(`🚀 Server running at http://localhost:${PORT}`);
        connectRikWebSocket();
    } catch (err) { app.log.error(err); process.exit(1); }
};

start();
