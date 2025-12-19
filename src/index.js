import fastify from "fastify";
import cors from "@fastify/cors";
import WebSocket from "ws";

// --- CẤU HÌNH ---
const PORT = process.env.PORT || 3000;
const WS_URL = "wss://websocket.azhkthg1.net/websocket?token=";
const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJzYW5nZGVwemFpMDlubyIsImJvdCI6MCwiaXNNZXJjaGFudCI6ZmFsc2UsInZlcmlmaWVkQmFua0FjY291bnQiOnRydWUsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MjIxNjQwNjcyLCJhZmZJZCI6IlN1bndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoic3VuLndpbiIsInRpbWVzdGFtcCI6MTc2NjE0NjI3ODc3NywibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOnRydWUsImlwQWRkcmVzcyI6IjExMy4xNzQuNzguMjU1IiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8xNS5wbmciLCJwbGF0Zm9ybUlkIjo0LCJ1c2VySWQiOiI3ODRmNGU0Mi1iZWExLTRiZTUtYjgwNS03MmJlZjY5N2UwMTIiLCJyZWdUaW1lIjoxNzQyMjMyMzQ1MTkxLCJwaG9uZSI6Ijg0ODg2MDI3NzY3IiwiZGVwb3NpdCI6dHJ1ZSwidXNlcm5hbWUiOiJTQ19tc2FuZ3p6MDkifQ.-b5PE1Lv7ct4bKvd8L92-UlucoE27nzwCY5vHkUEQoA";

// --- STATE QUẢN LÝ ---
let rikResults = [];
let rikWS = null;
let rikIntervalCmd = null;
let connectionMonitor = null;
let lastMessageTime = Date.now();
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 20;

// --- CƠ SỞ DỮ LIỆU CẦU ---
const PATTERN_DATABASE = {
    'Cầu Bệt': {
        patterns: ['ttttt', 'xxxxx', 'tttt', 'xxxx', 'ttt', 'xxx'],
        weight: 1.3
    },
    'Cầu 1-1': {
        patterns: ['txtx', 'xtxt', 'txtxt', 'xtxtx', 'xtxtxt'],
        weight: 1.2
    },
    'Cầu 2-2': {
        patterns: ['ttxx', 'xxtt', 'ttxxtt', 'xxttxx'],
        weight: 1.25
    },
    'Cầu 1-2': {
        patterns: ['txxtt', 'xttxx', 'txx', 'xtt'],
        weight: 1.15
    },
    'Cầu 2-1': {
        patterns: ['ttxttx', 'xxtxxt', 'ttx', 'xxt'],
        weight: 1.15
    },
    'Cầu Nghiêng Tài': {
        patterns: ['ttttxt', 'ttttxtt', 'ttttxtttt'],
        weight: 1.5
    },
    'Cầu Nghiêng Xỉu': {
        patterns: ['xxxxxt', 'xxxxxtxx'],
        weight: 1.5
    },
    'Cầu Đảo Chiều': {
        patterns: ['ttttxxxx', 'xxxxtttt', 'tttxxx', 'xxxttt'],
        weight: 1.4
    }
};

// --- THUẬT TOÁN ---
function algo_MarkovChain(history, order = 2) {
    if (history.length < 20) return null;
    const tx = history.map(h => h.tx);
    const state = tx.slice(-order).join('');
    
    let tCount = 0, xCount = 0;
    for (let i = 0; i < tx.length - order; i++) {
        if (tx.slice(i, i + order).join('') === state) {
            const next = tx[i + order];
            if (next === 'T') tCount++;
            else if (next === 'X') xCount++;
        }
    }
    
    const total = tCount + xCount;
    if (total === 0) return null;
    
    const pT = tCount / total;
    const confidence = Math.abs(pT - 0.5) * 2;
    
    if (pT > 0.55) return { pick: 'T', confidence };
    if (pT < 0.45) return { pick: 'X', confidence };
    return null;
}

function algo_PatternRecognition(history) {
    const txStr = history.map(h => h.tx).slice(-20).join('').toLowerCase();
    let bestMatch = null;
    let maxScore = 0;

    for (const [type, data] of Object.entries(PATTERN_DATABASE)) {
        for (const pattern of data.patterns) {
            if (txStr.endsWith(pattern)) {
                const score = pattern.length * data.weight;
                if (score > maxScore) {
                    maxScore = score;
                    
                    if (type.includes('Nghiêng Tài')) {
                        bestMatch = { pick: 'T', type, confidence: 0.8 };
                    } else if (type.includes('Nghiêng Xỉu')) {
                        bestMatch = { pick: 'X', type, confidence: 0.8 };
                    } else if (type === 'Cầu Bệt') {
                        const lastChar = pattern[pattern.length - 1];
                        bestMatch = { 
                            pick: lastChar === 't' ? 'X' : 'T', 
                            type, 
                            confidence: Math.min(0.9, pattern.length / 6)
                        };
                    } else if (type === 'Cầu Đảo Chiều') {
                        const lastChar = pattern[pattern.length - 1];
                        bestMatch = { pick: lastChar === 't' ? 'X' : 'T', type, confidence: 0.75 };
                    } else if (type === 'Cầu 1-1') {
                        const lastChar = pattern[pattern.length - 1];
                        bestMatch = { pick: lastChar === 't' ? 'X' : 'T', type, confidence: 0.7 };
                    } else {
                        bestMatch = { pick: null, type, confidence: 0.5 };
                    }
                }
            }
        }
    }
    
    return bestMatch;
}

function algo_Momentum(history) {
    if (history.length < 20) return null;
    
    const tx = history.map(h => h.tx === 'T' ? 1 : -1);
    const momentum = tx.slice(-10).reduce((a, b) => a + b, 0);
    const prevMomentum = tx.slice(-20, -10).reduce((a, b) => a + b, 0);
    const change = momentum - prevMomentum;
    
    if (momentum > 4 && change > 0) return { pick: 'T', confidence: 0.7 };
    if (momentum < -4 && change < 0) return { pick: 'X', confidence: 0.7 };
    if (momentum > 3 && change < -2) return { pick: 'X', confidence: 0.75 };
    if (momentum < -3 && change > 2) return { pick: 'T', confidence: 0.75 };
    
    return null;
}

function calculateEMA(values, period) {
    const k = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i < values.length; i++) {
        ema = values[i] * k + ema * (1 - k);
    }
    return ema;
}

function algo_AdaptiveTrend(history) {
    if (history.length < 20) return null;
    
    const values = history.map(h => h.tx === 'T' ? 1 : 0);
    const ema10 = calculateEMA(values, 10);
    const ema20 = calculateEMA(values, 20);
    
    if (ema10 > ema20 && ema10 > 0.6) return { pick: 'T', confidence: 0.7 };
    if (ema10 < ema20 && ema10 < 0.4) return { pick: 'X', confidence: 0.7 };
    
    return null;
}

function algo_RSI(history) {
    if (history.length < 14) return null;
    
    const values = history.map(h => h.total);
    let gains = 0, losses = 0;
    
    for (let i = 1; i < values.length; i++) {
        const diff = values[i] - values[i - 1];
        if (diff > 0) gains += diff;
        else losses += Math.abs(diff);
    }
    
    const avgGain = gains / (values.length - 1);
    const avgLoss = losses / (values.length - 1);
    
    if (avgLoss === 0) return { pick: 'T', confidence: 0.6 };
    
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    if (rsi > 70) return { pick: 'X', confidence: 0.7 };
    if (rsi < 30) return { pick: 'T', confidence: 0.7 };
    
    return null;
}

// --- MASTER AI CLASS (FIXED) ---
class MasterAI {
    constructor() {
        this.history = [];
        this.currentPrediction = null;
        this.stats = {
            total: 0,
            correct: 0,
            wrong: 0
        };
        
        this.algoWeights = {
            markov: 1.5,
            pattern: 1.8,
            momentum: 1.3,
            trend: 1.4,
            rsi: 1.1
        };
        
        this.isBacktestComplete = false;
        this.backtestPromise = null;
    }

    // BACKTEST ASYNC - Chỉ chạy 1 lần
    async runBacktestAsync(data) {
        if (this.isBacktestComplete) return;
        
        console.log('🔄 Bắt đầu backtest (async)...');
        const sortedData = [...data].sort((a, b) => a.session - b.session);
        
        let correct = 0, total = 0;
        
        // Backtest từ phiên 30 trở đi
        for (let i = 30; i < sortedData.length - 1; i++) {
            const trainData = sortedData.slice(0, i);
            const actualResult = sortedData[i]; // Phiên hiện tại
            const nextResult = sortedData[i + 1]; // Phiên tiếp theo (target)
            
            // Dự đoán cho phiên TIẾP THEO
            const prediction = this.predictForSession(trainData);
            
            if (prediction.rawPrediction) {
                total++;
                // So sánh với kết quả phiên TIẾP THEO
                if (prediction.rawPrediction === nextResult.tx) {
                    correct++;
                }
            }
            
            // Yield để không block event loop
            if (i % 10 === 0) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }
        
        this.stats.total = total;
        this.stats.correct = correct;
        this.stats.wrong = total - correct;
        this.isBacktestComplete = true;
        
        console.log(`✅ Backtest hoàn tất: ${correct}/${total} = ${this.getRate()}`);
    }

    // Khởi tạo history và chạy backtest
    async initialize(data) {
        this.history = [...data].sort((a, b) => a.session - b.session);
        
        if (!this.backtestPromise) {
            this.backtestPromise = this.runBacktestAsync(data);
        }
        
        await this.backtestPromise;
    }

    // Thêm kết quả mới (realtime)
    addResult(record) {
        const exists = this.history.find(h => h.session === record.session);
        if (exists) return;

        // Kiểm tra prediction trước đó
        if (this.currentPrediction && this.currentPrediction.forSession === record.session) {
            this.stats.total++;
            
            if (this.currentPrediction.pick === record.tx) {
                this.stats.correct++;
                console.log(`✅ ĐÚNG - Phiên ${record.session}: Dự đoán ${this.currentPrediction.pick} = Kết quả ${record.tx}`);
            } else {
                this.stats.wrong++;
                console.log(`❌ SAI - Phiên ${record.session}: Dự đoán ${this.currentPrediction.pick} ≠ Kết quả ${record.tx}`);
            }
        }

        // Thêm vào history
        this.history.push(record);
        if (this.history.length > 300) {
            this.history.shift();
        }
        
        // Tạo prediction mới cho phiên tiếp theo
        this.updatePrediction();
    }

    // Cập nhật prediction
    updatePrediction() {
        if (this.history.length === 0) return;
        
        const lastSession = this.history[this.history.length - 1].session;
        const pred = this.predictForSession(this.history);
        
        this.currentPrediction = {
            forSession: lastSession + 1,
            pick: pred.rawPrediction,
            confidence: pred.confidence,
            bridgeType: pred.bridgeType,
            contributors: pred.contributors
        };
    }

    // Hàm predict chính
    predictForSession(history) {
        if (history.length < 10) {
            return { 
                prediction: 'đang học...', 
                confidence: 0,
                bridgeType: 'Chưa đủ dữ liệu',
                rawPrediction: null
            };
        }

        const votes = { T: 0, X: 0 };
        const contributors = [];

        const algos = [
            { name: 'Markov', fn: () => algo_MarkovChain(history, 2), weight: this.algoWeights.markov },
            { name: 'Pattern', fn: () => algo_PatternRecognition(history), weight: this.algoWeights.pattern },
            { name: 'Momentum', fn: () => algo_Momentum(history), weight: this.algoWeights.momentum },
            { name: 'Trend', fn: () => algo_AdaptiveTrend(history), weight: this.algoWeights.trend },
            { name: 'RSI', fn: () => algo_RSI(history), weight: this.algoWeights.rsi }
        ];

        algos.forEach(algo => {
            const result = algo.fn();
            if (result && result.pick) {
                const score = algo.weight * result.confidence;
                votes[result.pick] += score;
                contributors.push({
                    name: algo.name,
                    pick: result.pick,
                    score: score.toFixed(2)
                });
            }
        });

        let finalPick = null;
        let confidence = 0;
        const totalVotes = votes.T + votes.X;
        
        if (totalVotes === 0) {
            const recent = history.slice(-5);
            const tCount = recent.filter(r => r.tx === 'T').length;
            finalPick = tCount > 2 ? 'X' : 'T';
            confidence = 50;
        } else {
            if (votes.T > votes.X) {
                finalPick = 'T';
                confidence = (votes.T / totalVotes) * 100;
            } else {
                finalPick = 'X';
                confidence = (votes.X / totalVotes) * 100;
            }
        }

        const bridgeType = this.detectBridgeType(history);

        return {
            prediction: finalPick === 'T' ? 'tài' : 'xỉu',
            rawPrediction: finalPick,
            confidence: confidence.toFixed(1),
            bridgeType,
            contributors
        };
    }

    detectBridgeType(history) {
        const txStr = history.map(h => h.tx).slice(-15).join('').toLowerCase();
        
        for (const [name, info] of Object.entries(PATTERN_DATABASE)) {
            if (info.patterns.some(p => txStr.includes(p))) {
                return name;
            }
        }
        
        return "Cầu Tự Do";
    }

    getRate() {
        if (this.stats.total === 0) return "0%";
        return ((this.stats.correct / this.stats.total) * 100).toFixed(1) + "%";
    }

    getDetailedStats() {
        return {
            tong_du_doan: this.stats.total,
            dung: this.stats.correct,
            sai: this.stats.wrong,
            ti_le_dung: this.getRate(),
            do_chinh_xac: this.stats.total > 0 ? (this.stats.correct / this.stats.total).toFixed(3) : '0.000',
            backtest_status: this.isBacktestComplete ? 'completed' : 'running'
        };
    }

    getCurrentPrediction() {
        return this.currentPrediction || {
            prediction: 'đang học...',
            confidence: 0,
            bridgeType: 'Chưa sẵn sàng',
            contributors: []
        };
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
            message: "Đang kết nối WebSocket và tải dữ liệu..." 
        };
    }

    const lastRes = rikResults[0];
    const pred = ai.getCurrentPrediction();

    return {
        id: "@minhsangdangcap_v2_pro_fixed",
        phien_hien_tai: lastRes.session,
        ket_qua: lastRes.result.toLowerCase(),
        xuc_xac: lastRes.dice,
        tong_diem: lastRes.total,
        phien_du_doan: lastRes.session + 1,
        du_doan: pred.pick === 'T' ? 'tài' : (pred.pick === 'X' ? 'xỉu' : 'đang học'),
        do_tu_tin: pred.confidence + '%',
        loai_cau: pred.bridgeType,
        cac_thuat_toan_vote: pred.contributors || [],
        thong_ke_chi_tiet: ai.getDetailedStats()
    };
});

// --- WEBSOCKET LOGIC ---
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
            "User-Agent": "Mozilla/5.0",
            "Origin": "https://web.sunwin.win"
        }
    });

    rikWS.on("open", () => {
        console.log("✅ WebSocket Connected!");
        reconnectAttempts = 0;
        lastMessageTime = Date.now();

        rikWS.send(JSON.stringify([1, "MiniGame", "SC_giathinh2133", "thinh211", {
            info: JSON.stringify({
                ipAddress: "127.0.0.1",
                wsToken: TOKEN,
                userId: "ai_bot",
                username: "AI_System",
                timestamp: Date.now()
            }),
            signature: "sig",
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
                console.warn("⚠️ Không nhận dữ liệu quá 30s - Reconnecting...");
                connectWebSocket();
            }
        }, 10000);
    });

    rikWS.on("message", async (data) => {
        lastMessageTime = Date.now();
        
        let json = decodeBinary(data);
        if (!json) {
            try { json = JSON.parse(data); } catch(e) { return; }
        }
        if (!json) return;

        // XỬ LÝ LỊCH SỬ BAN ĐẦU
        if (Array.isArray(json) && json[1] && json[1].htr) {
            console.log("📥 Nhận lịch sử từ WebSocket...");
            
            const historyData = json[1].htr.map(i => ({
                session: i.sid,
                dice: [i.d1, i.d2, i.d3],
                total: i.d1 + i.d2 + i.d3,
                result: (i.d1 + i.d2 + i.d3) >= 11 ? 'Tai' : 'Xiu',
                tx: (i.d1 + i.d2 + i.d3) >= 11 ? 'T' : 'X'
            }));
            
            rikResults = [...historyData].reverse();
            
            // Khởi tạo AI async
            ai.initialize(historyData).then(() => {
                ai.updatePrediction();
                console.log('✅ AI đã sẵn sàng!');
            });
        }

        // XỬ LÝ KẾT QUẢ MỚI
        else if (json.session && json.dice) {
            const total = json.dice.reduce((a, b) => a + b, 0);
            const record = {
                session: json.session,
                dice: json.dice,
                total: total,
                result: total >= 11 ? 'Tai' : 'Xiu',
                tx: total >= 11 ? 'T' : 'X'
            };

            if (!rikResults.some(r => r.session === record.session)) {
                rikResults.unshift(record);
                if (rikResults.length > 100) rikResults.pop();
                
                ai.addResult(record);
                
                const pred = ai.getCurrentPrediction();
                console.log(`🎰 Phiên ${record.session}: ${record.result} | Dự đoán tiếp: ${pred.pick} [${pred.confidence}%] | Tỷ lệ: ${ai.getRate()}`);
            }
        }
    });

    rikWS.on("error", (err) => {
        console.error("❌ WebSocket Error:", err.message);
    });
    
    rikWS.on("close", () => {
        console.log("🔌 WebSocket Closed - Reconnecting in 3s...");
        reconnectAttempts++;
        setTimeout(connectWebSocket, 3000);
    });
}

// --- START SERVER ---
const start = async () => {
    try {
        await app.listen({ port: PORT, host: '0.0.0.0' });
        console.log(`
╔═══════════════════════════════════════════════════════╗
║     🚀 SUNWIN AI PRO - FIXED VERSION                  ║
╠═══════════════════════════════════════════════════════╣
║  Server: http://localhost:${PORT}                        ║
║  Endpoint: http://localhost:${PORT}/sunwinsew            ║
║  Status: ✅ Ready                                     ║
╚═══════════════════════════════════════════════════════╝
        `);
        
        connectWebSocket();
        
    } catch (err) {
        console.error('❌ Lỗi khởi động server:', err);
        process.exit(1);
    }
};

start();
