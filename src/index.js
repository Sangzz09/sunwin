import fastify from "fastify";
import cors from "@fastify/cors";
import WebSocket from "ws";

// --- CẤU HÌNH ---
const PORT = process.env.PORT || 3000;
const WS_URL = "wss://websocket.azhkthg1.net/websocket?token=";
const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJzYW5nZGVwemFpMDlubyIsImJvdCI6MCwiaXNNZXJjaGFudCI6ZmFsc2UsInZlcmlmaWVkQmFua0FjY291bnQiOnRydWUsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MjIxNjQwNjcyLCJhZmZJZCI6IlN1bndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoic3VuLndpbiIsInRpbWVzdGFtcCI6MTc2NjA1ODAwMzE1NSwibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOnRydWUsImlwQWRkcmVzcyI6IjExMy4xNzQuNzguMjU1IiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8xNS5wbmciLCJwbGF0Zm9ybUlkIjo0LCJ1c2VySWQiOiI3ODRmNGU0Mi1iZWExLTRiZTUtYjgwNS03MmJlZjY5N2UwMTIiLCJyZWdUaW1lIjoxNzQyMjMyMzQ1MTkxLCJwaG9uZSI6Ijg0ODg2MDI3NzY3IiwiZGVwb3NpdCI6dHJ1ZSwidXNlcm5hbWUiOiJTQ19tc2FuZ3p6MDkifQ.CrHdicpVL-edWRUzyp8Lf0oU4l6rBEgHclYXdsCuJUI";

// --- STATE QUẢN LÝ ---
let rikResults = [];
let rikWS = null;
let rikIntervalCmd = null;
let connectionMonitor = null;
let lastMessageTime = Date.now();
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 20;

// --- CƠ SỞ DỮ LIỆU CẦU (PATTERN) ---
const PATTERN_DATABASE = {
    'Cầu Bệt': ['ttttt', 'xxxxx', 'tttt', 'xxxx'],
    'Cầu 1-1': ['txtx', 'xtxt', 'txtxt', 'xtxtx'],
    'Cầu 2-2': ['ttxx', 'xxtt', 'ttxxtt', 'xxttxx'],
    'Cầu 1-2': ['txxt', 'xttx'],
    'Cầu 2-1': ['ttxtx', 'xxtxt'],
    'Cầu 1-2-3': ['txxttt', 'xttxxx'],
    'Cầu 3-2-1': ['tttxxt', 'xxxttt'],
    'Cầu Đối Xứng': ['ttxtt', 'xxtxx', 'txtxt', 'xtxtx'],
    'Cầu Nghiêng': ['tttxttt', 'xxxtxxx', 'tttttt', 'xxxxxx']
};

// --- CÁC HÀM TOÁN HỌC NÂNG CAO ---

// RSI - Relative Strength Index
const calculateRSI = (txArray, period = 14) => {
    if (txArray.length < period + 1) return 50;
    
    const values = txArray.map(tx => tx === 'T' ? 1 : 0);
    let gains = 0, losses = 0;
    
    for (let i = values.length - period; i < values.length; i++) {
        const change = values[i] - values[i - 1];
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }
    
    if (losses === 0) return 100;
    const avgGain = gains / period;
    const avgLoss = losses / period;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
};

// EMA - Exponential Moving Average
const calculateEMA = (txArray, period = 10) => {
    if (txArray.length < period) return 0.5;
    
    const values = txArray.map(tx => tx === 'T' ? 1 : 0);
    const k = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((a, b) => a + b) / period;
    
    for (let i = period; i < values.length; i++) {
        ema = (values[i] * k) + (ema * (1 - k));
    }
    
    return ema;
};

// MACD - Moving Average Convergence Divergence
const calculateMACD = (txArray) => {
    if (txArray.length < 26) return { signal: 0, histogram: 0 };
    
    const ema12 = calculateEMA(txArray, 12);
    const ema26 = calculateEMA(txArray, 26);
    const macdLine = ema12 - ema26;
    
    return {
        signal: macdLine > 0 ? 'T' : 'X',
        strength: Math.abs(macdLine)
    };
};

// Bollinger Bands
const calculateBollingerBands = (txArray, period = 20) => {
    if (txArray.length < period) return { upper: 1, middle: 0.5, lower: 0 };
    
    const values = txArray.map(tx => tx === 'T' ? 1 : 0).slice(-period);
    const sma = values.reduce((a, b) => a + b) / period;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    
    return {
        upper: sma + (2 * stdDev),
        middle: sma,
        lower: sma - (2 * stdDev),
        current: values[values.length - 1]
    };
};

// --- THUẬT TOÁN DỰ ĐOÁN NÂNG CAO ---

// 1. Markov Chain với Memory đa cấp
function algo_MarkovChainAdvanced(history) {
    if (history.length < 30) return null;
    
    const tx = history.map(h => h.tx);
    const results = [];
    
    for (let depth = 1; depth <= 3; depth++) {
        const pattern = tx.slice(-depth).join('');
        let tNext = 0, xNext = 0;
        
        for (let i = depth; i < tx.length; i++) {
            const prevPattern = tx.slice(i - depth, i).join('');
            if (prevPattern === pattern) {
                if (tx[i] === 'T') tNext++;
                else xNext++;
            }
        }
        
        if (tNext + xNext >= 3) {
            const confidence = Math.max(tNext, xNext) / (tNext + xNext);
            results.push({
                pick: tNext > xNext ? 'T' : 'X',
                confidence: confidence,
                weight: depth
            });
        }
    }
    
    if (results.length === 0) return null;
    
    let tScore = 0, xScore = 0;
    results.forEach(r => {
        const score = r.confidence * r.weight;
        if (r.pick === 'T') tScore += score;
        else xScore += score;
    });
    
    return {
        pick: tScore > xScore ? 'T' : 'X',
        confidence: Math.max(tScore, xScore) / (tScore + xScore)
    };
}

// 2. Pattern Recognition với Anti-Pattern
function algo_PatternRecognition(history) {
    if (history.length < 15) return null;
    
    const txStr = history.map(h => h.tx).slice(-20).join('').toLowerCase();
    let bestMatch = null;
    let maxScore = 0;
    
    for (const [type, patterns] of Object.entries(PATTERN_DATABASE)) {
        for (const pattern of patterns) {
            if (txStr.includes(pattern)) {
                const score = pattern.length;
                
                if (score > maxScore) {
                    maxScore = score;
                    const lastChar = pattern[pattern.length - 1];
                    
                    if (type.includes('Bệt') && pattern.length >= 5) {
                        bestMatch = { pick: lastChar === 't' ? 'X' : 'T', confidence: 0.75 };
                    } else if (type.includes('Nghiêng') && pattern.length >= 6) {
                        bestMatch = { pick: lastChar === 't' ? 'X' : 'T', confidence: 0.7 };
                    } else if (type.includes('1-1')) {
                        bestMatch = { pick: lastChar === 't' ? 'T' : 'X', confidence: 0.65 };
                    } else if (type.includes('2-2')) {
                        bestMatch = { pick: lastChar === 't' ? 'X' : 'T', confidence: 0.65 };
                    }
                }
            }
        }
    }
    
    return bestMatch;
}

// 3. Momentum Trading Strategy
function algo_Momentum(history) {
    if (history.length < 20) return null;
    
    const recent = history.slice(-20).map(h => h.tx);
    const momentum = calculateEMA(recent, 10);
    const rsi = calculateRSI(recent);
    
    if (rsi > 70) return { pick: 'X', confidence: 0.7 };
    if (rsi < 30) return { pick: 'T', confidence: 0.7 };
    
    if (momentum > 0.65) return { pick: 'T', confidence: 0.65 };
    if (momentum < 0.35) return { pick: 'X', confidence: 0.65 };
    
    return null;
}

// 4. Mean Reversion Strategy
function algo_MeanReversion(history) {
    if (history.length < 30) return null;
    
    const recent = history.slice(-30).map(h => h.tx);
    const bb = calculateBollingerBands(recent);
    
    const currentValue = recent[recent.length - 1] === 'T' ? 1 : 0;
    
    if (currentValue >= bb.upper) return { pick: 'X', confidence: 0.75 };
    if (currentValue <= bb.lower) return { pick: 'T', confidence: 0.75 };
    
    return null;
}

// 5. Streak Breaking Algorithm
function algo_StreakBreaker(history) {
    if (history.length < 10) return null;
    
    const tx = history.map(h => h.tx);
    let currentStreak = 1;
    const lastTx = tx[tx.length - 1];
    
    for (let i = tx.length - 2; i >= 0; i--) {
        if (tx[i] === lastTx) currentStreak++;
        else break;
    }
    
    if (currentStreak >= 5) {
        return { 
            pick: lastTx === 'T' ? 'X' : 'T', 
            confidence: Math.min(0.6 + (currentStreak - 5) * 0.05, 0.85)
        };
    }
    
    return null;
}

// 6. Frequency Analysis
function algo_FrequencyAnalysis(history) {
    if (history.length < 50) return null;
    
    const recent = history.slice(-50).map(h => h.tx);
    const tCount = recent.filter(tx => tx === 'T').length;
    const xCount = recent.length - tCount;
    
    const tFreq = tCount / recent.length;
    
    if (tFreq > 0.6) return { pick: 'X', confidence: 0.65 };
    if (tFreq < 0.4) return { pick: 'T', confidence: 0.65 };
    
    return null;
}

// 7. MACD Strategy
function algo_MACDStrategy(history) {
    if (history.length < 30) return null;
    
    const macd = calculateMACD(history.map(h => h.tx));
    if (macd.strength > 0.1) {
        return { 
            pick: macd.signal, 
            confidence: Math.min(0.6 + macd.strength * 2, 0.8) 
        };
    }
    
    return null;
}

// --- LỚP QUẢN LÝ AI TRUNG TÂM ---
class MasterAI {
    constructor() {
        this.history = [];
        this.liveStats = { total: 0, correct: 0, wrong: 0 };
        this.activePrediction = null; // Dự đoán đang chờ kết quả
        this.isApiActive = false; // API đã được gọi chưa
        this.trackingStartSession = null; // Phiên bắt đầu tracking
        
        this.algoWeights = {
            markov: 2.0,
            pattern: 1.8,
            momentum: 1.5,
            meanReversion: 1.7,
            streakBreaker: 1.6,
            frequency: 1.3,
            macd: 1.4
        };
    }

    loadHistory(data) {
        this.history = [];
        
        const sortedData = [...data].sort((a, b) => a.session - b.session);
        this.history = sortedData;
        
        if (this.history.length > 200) {
            this.history = this.history.slice(-200);
        }
        
        console.log(`✅ Đã load ${sortedData.length} phiên lịch sử (chỉ để AI học).`);
    }

    // Kích hoạt API - bắt đầu tracking từ đây
    activateAPI() {
        if (!this.isApiActive) {
            this.isApiActive = true;
            if (this.history.length > 0) {
                this.trackingStartSession = this.history[this.history.length - 1].session + 1;
            }
            console.log(`🟢 API ĐƯỢC TREO - Bắt đầu tracking từ phiên ${this.trackingStartSession}`);
        }
    }

    addResult(record) {
        // Kiểm tra trùng lặp
        if (this.history.find(h => h.session === record.session)) return;

        // CHỈ TÍNH THỐNG KÊ KHI API ĐÃ ACTIVE VÀ CÓ DỰ ĐOÁN ĐANG CHỜ
        if (this.isApiActive && this.activePrediction && 
            this.activePrediction.session === record.session) {
            
            this.liveStats.total++;
            
            if (this.activePrediction.pick === record.tx) {
                this.liveStats.correct++;
                console.log(`✅ ĐÚNG #${this.liveStats.total}: Phiên ${record.session} - Dự đoán ${this.activePrediction.pick} = ${record.tx} | Tỷ lệ: ${this.getRate()}`);
            } else {
                this.liveStats.wrong++;
                console.log(`❌ SAI #${this.liveStats.total}: Phiên ${record.session} - Dự đoán ${this.activePrediction.pick} ≠ ${record.tx} | Tỷ lệ: ${this.getRate()}`);
            }
            
            // Reset dự đoán đã xử lý
            this.activePrediction = null;
        }

        // Thêm vào lịch sử để AI học
        this.history.push(record);
        if (this.history.length > 200) this.history = this.history.slice(-200);
    }

    predict() {
        if (this.history.length < 10) {
            return { 
                prediction: 'Đang học',
                rawPrediction: null,
                pattern: '',
                bridgeType: 'Chưa đủ dữ liệu'
            };
        }

        const votes = { T: 0, X: 0 };
        
        const markov = algo_MarkovChainAdvanced(this.history);
        if (markov) votes[markov.pick] += this.algoWeights.markov * markov.confidence;

        const pattern = algo_PatternRecognition(this.history);
        if (pattern) votes[pattern.pick] += this.algoWeights.pattern * pattern.confidence;

        const momentum = algo_Momentum(this.history);
        if (momentum) votes[momentum.pick] += this.algoWeights.momentum * momentum.confidence;

        const meanRev = algo_MeanReversion(this.history);
        if (meanRev) votes[meanRev.pick] += this.algoWeights.meanReversion * meanRev.confidence;

        const streak = algo_StreakBreaker(this.history);
        if (streak) votes[streak.pick] += this.algoWeights.streakBreaker * streak.confidence;

        const freq = algo_FrequencyAnalysis(this.history);
        if (freq) votes[freq.pick] += this.algoWeights.frequency * freq.confidence;

        const macd = algo_MACDStrategy(this.history);
        if (macd) votes[macd.pick] += this.algoWeights.macd * macd.confidence;

        let finalPick = null;
        const totalVotes = votes.T + votes.X;
        
        if (totalVotes === 0) {
            const rsi = calculateRSI(this.history.map(h => h.tx));
            finalPick = rsi > 50 ? 'X' : 'T';
        } else {
            finalPick = votes.T > votes.X ? 'T' : 'X';
        }

        const patternStr = this.history.slice(-10).map(h => h.tx).join('');
        const bridgeType = this.detectBridgeType();
        const nextSession = this.history[this.history.length - 1].session + 1;

        // LƯU DỰ ĐOÁN ĐANG CHỜ - CHỈ KHI API ACTIVE
        if (this.isApiActive) {
            this.activePrediction = {
                session: nextSession,
                pick: finalPick
            };
            console.log(`🎯 Dự đoán phiên ${nextSession}: ${finalPick === 'T' ? 'TÀI' : 'XỈU'}`);
        }

        return {
            prediction: finalPick === 'T' ? 'Tài' : 'Xỉu',
            rawPrediction: finalPick,
            pattern: patternStr,
            bridgeType: bridgeType
        };
    }

    detectBridgeType() {
        const txStr = this.history.map(h => h.tx).slice(-15).join('').toLowerCase();
        
        for (const [name, patterns] of Object.entries(PATTERN_DATABASE)) {
            for (const pattern of patterns) {
                if (txStr.endsWith(pattern)) return name;
            }
        }
        
        return "Cầu Tự Do";
    }

    getRate() {
        if (this.liveStats.total === 0) return "0%";
        return ((this.liveStats.correct / this.liveStats.total) * 100).toFixed(1) + "%";
    }

    getStatus() {
        if (!this.isApiActive) return "Chưa kích hoạt";
        if (this.liveStats.total === 0) return "Đang chờ kết quả đầu tiên";
        return "Đang hoạt động";
    }
}

const ai = new MasterAI();

// --- SERVER SETUP ---
const app = fastify();
app.register(cors, { origin: "*" });

app.get("/sunwinsew", async (request, reply) => {
    if (rikResults.length === 0) {
        return { 
            status: "loading", 
            message: "Đang kết nối WebSocket..." 
        };
    }

    // KÍCH HOẠT API - BẮT ĐẦU TRACKING TỪ ĐÂY
    ai.activateAPI();

    const lastRes = rikResults[0]; // Phiên vừa kết thúc
    const prediction = ai.predict();

    return {
        id: "@minhsangdangcap",
        phien_truoc: lastRes.session,
        ket_qua: lastRes.result,
        xuc_xac: lastRes.dice,
        tong: lastRes.total,
        phien_hien_tai: lastRes.session + 1,
        du_doan: prediction.prediction,
        pattern: prediction.pattern,
        loai_cau: prediction.bridgeType,
        thong_ke: {
            status: ai.getStatus(),
            so_lan_du_doan: ai.liveStats.total,
            so_dung: ai.liveStats.correct,
            so_sai: ai.liveStats.wrong,
            ti_le_dung: ai.getRate()
        }
    };
});

app.get("/health", async (request, reply) => {
    return {
        status: "OK",
        uptime: process.uptime(),
        websocket: rikWS?.readyState === WebSocket.OPEN ? "Connected" : "Disconnected",
        api_active: ai.isApiActive,
        tracking_start: ai.trackingStartSession,
        predictions_made: ai.liveStats.total
    };
});

// --- WEBSOCKET CONNECTION & RECONNECT LOGIC ---
function decodeBinary(data) {
    try {
        const dec = new TextDecoder("utf-8");
        const str = dec.decode(data);
        if (str.startsWith("[")) return JSON.parse(str);
    } catch(e) {}
    return null;
}

function connectWebSocket() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error("⛔ Dừng kết nối sau quá nhiều lần thất bại.");
        return;
    }

    console.log(`🔌 Kết nối Sunwin WS (Lần ${reconnectAttempts + 1})...`);
    
    if (rikWS) { 
        try { rikWS.terminate(); } catch(e){} 
    }
    clearInterval(rikIntervalCmd);
    clearInterval(connectionMonitor);

    rikWS = new WebSocket(`${WS_URL}${TOKEN}`, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Origin": "https://web.sunwin.win"
        }
    });

    rikWS.on("open", () => {
        console.log("✅ WebSocket Connected!");
        reconnectAttempts = 0;
        lastMessageTime = Date.now();

        rikWS.send(JSON.stringify([1, "MiniGame", "SC_msangzz09", "admin", {
            info: JSON.stringify({
                ipAddress: "127.0.0.1",
                wsToken: TOKEN,
                userId: "784f4e42-bea1-4be5-b805-72bef697e012",
                username: "SC_msangzz09",
                timestamp: Date.now()
            }),
            signature: "ai_signature",
            pid: 5,
            subi: true
        }]));

        rikIntervalCmd = setInterval(() => {
            if(rikWS.readyState === WebSocket.OPEN) {
                rikWS.send(JSON.stringify([6, "MiniGame", "taixiuPlugin", { cmd: 1005 }]));
            }
        }, 5000);

        connectionMonitor = setInterval(() => {
            if (Date.now() - lastMessageTime > 30000) {
                console.warn("⚠️ Không nhận data 30s. Reconnecting...");
                connectWebSocket();
            }
        }, 10000);
    });

    rikWS.on("message", (data) => {
        lastMessageTime = Date.now();
        
        let json = decodeBinary(data);
        if (!json) {
            try { json = JSON.parse(data); } catch(e) { return; }
        }
        if (!json) return;

        // Load lịch sử (CHỈ ĐỂ AI HỌC - KHÔNG TÍNH THỐNG KÊ)
        if (Array.isArray(json) && json[1] && json[1].htr) {
            console.log("📥 Đang tải lịch sử để AI học...");
            const historyData = json[1].htr.map(i => ({
                session: i.sid,
                dice: [i.d1, i.d2, i.d3],
                total: i.d1 + i.d2 + i.d3,
                result: (i.d1 + i.d2 + i.d3) >= 11 ? 'Tài' : 'Xỉu',
                tx: (i.d1 + i.d2 + i.d3) >= 11 ? 'T' : 'X'
            }));
            
            ai.loadHistory(historyData);
            rikResults = [...historyData].reverse();
            
            console.log(`🎯 Lịch sử đã load. Chờ API được treo để bắt đầu dự đoán.`);
        }

        // Kết quả mới (CHỈ TÍNH THỐNG KÊ SAU KHI API ACTIVE)
        else if (Array.isArray(json) && json[1] && json[1].sid && json[1].d1) {
            const newRecord = {
                session: json[1].sid,
                dice: [json[1].d1, json[1].d2, json[1].d3],
                total: json[1].d1 + json[1].d2 + json[1].d3,
                result: (json[1].d1 + json[1].d2 + json[1].d3) >= 11 ? 'Tài' : 'Xỉu',
                tx: (json[1].d1 + json[1].d2 + json[1].d3) >= 11 ? 'T' : 'X'
            };
            
            console.log(`🎲 Phiên ${newRecord.session}: ${newRecord.result} [${newRecord.dice.join('-')}] Tổng: ${newRecord.total}`);
            
            // Thêm kết quả - hàm này sẽ tự động kiểm tra có cần tính thống kê không
            ai.addResult(newRecord);
            
            rikResults.unshift(newRecord);
            if (rikResults.length > 100) rikResults = rikResults.slice(0, 100);
        }
    });

    rikWS.on("error", (err) => {
        console.error("❌ WebSocket Error:", err.message);
        reconnectAttempts++;
        setTimeout(() => connectWebSocket(), 5000);
    });

    rikWS.on("close", () => {
        console.log("🔌 WebSocket Closed. Reconnecting...");
        reconnectAttempts++;
        setTimeout(() => connectWebSocket(), 5000);
    });
}

// --- KHỞI ĐỘNG ---
app.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`🚀 Server running at ${address}`);
    console.log(`📡 API endpoint: ${address}/sunwinsew`);
    console.log(`⚠️ Thống kê CHỈ bắt đầu khi API được gọi lần đầu tiên!`);
    connectWebSocket();
});
