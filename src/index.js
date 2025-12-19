import fastify from "fastify";
import cors from "@fastify/cors";
import WebSocket from "ws";

// --- CẤU HÌNH ---
const PORT = process.env.PORT || 3000;
const WS_URL = "wss://websocket.azhkthg1.net/websocket?token=";
const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJzYW5nZGVwemFpMDlubyIsImJvdCI6MCwiaXNNZXJjaGFudCI6ZmFsc2UsInZlcmlmaWVkQmFua0FjY291bnQiOnRydWUsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MjIxNjQwNjcyLCJhZmZJZCI6IlN1bndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoic3VuLndpbiIsInRpbWVzdGFtcCI6MTc2NjE0NTc4OTM5MywibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOnRydWUsImlwQWRkcmVzcyI6IjExMy4xNzQuNzguMjU1IiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8xNS5wbmciLCJwbGF0Zm9ybUlkIjo0LCJ1c2VySWQiOiI3ODRmNGU0Mi1iZWExLTRiZTUtYjgwNS03MmJlZjY5N2UwMTIiLCJyZWdUaW1lIjoxNzQyMjMyMzQ1MTkxLCJwaG9uZSI6Ijg0ODg2MDI3NzY3IiwiZGVwb3NpdCI6dHJ1ZSwidXNlcm5hbWUiOiJTQ19tc2FuZ3p6MDkifQ.5oYE3n53K87uaOvW6CldZ84CXXmQ7B9P-TrZMYUKenI";

// --- STATE QUẢN LÝ ---
let rikResults = [];
let rikCurrentSession = null;
let rikWS = null;
let rikIntervalCmd = null;
let connectionMonitor = null;
let lastMessageTime = Date.now();
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 20;
let isApiActive = false; // Cờ kiểm tra API đã được gọi

// --- CƠ SỞ DỮ LIỆU CẦU MỞ RỘNG ---
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
        patterns: ['ttxx', 'xxtt', 'ttxxtt', 'xxttxx', 'ttxxttxx'],
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
    'Cầu 1-2-3': {
        patterns: ['txxttt', 'xttxxx', 'txxtt', 'xttxx'],
        weight: 1.4
    },
    'Cầu 3-2-1': {
        patterns: ['tttxxt', 'xxxttt', 'tttxx', 'xxxtt'],
        weight: 1.4
    },
    'Cầu Đối Xứng': {
        patterns: ['ttxtt', 'xxtxx', 'txtxt', 'xtxtx', 'txxxxt', 'xttttx'],
        weight: 1.35
    },
    'Cầu Nghiêng Tài': {
        patterns: ['ttttxt', 'ttttxtt', 'ttttxtttt'],
        weight: 1.5
    },
    'Cầu Nghiêng Xỉu': {
        patterns: ['xxxxxt', 'xxxxxtxx', 'xxxxxxtxxx'],
        weight: 1.5
    },
    'Cầu Lệch 3-1': {
        patterns: ['tttxtttx', 'xxxxtxxx'],
        weight: 1.3
    },
    'Cầu Lệch 4-1': {
        patterns: ['ttttxttttx', 'xxxxxtxxxx'],
        weight: 1.3
    },
    'Cầu Rồng': {
        patterns: ['tttttxxx', 'xxxxxttt', 'ttttxxxx', 'xxxxxtttt'],
        weight: 1.45
    },
    'Cầu Đảo Chiều': {
        patterns: ['ttttxxxx', 'xxxxtttt', 'tttxxx', 'xxxttt'],
        weight: 1.4
    }
};

// --- THUẬT TOÁN NÂNG CAO ---

// 1. Markov Chain (Cải tiến: Multi-order)
function algo_MarkovChain(history, order = 2) {
    if (history.length < 20) return null;
    const tx = history.map(h => h.tx);
    
    // Lấy chuỗi trạng thái cuối
    const state = tx.slice(-order).join('');
    
    let tCount = 0, xCount = 0;
    
    // Tìm tất cả các lần xuất hiện state này trong lịch sử
    for (let i = 0; i < tx.length - order; i++) {
        const currentState = tx.slice(i, i + order).join('');
        if (currentState === state) {
            const next = tx[i + order];
            if (next === 'T') tCount++;
            else if (next === 'X') xCount++;
        }
    }
    
    const total = tCount + xCount;
    if (total === 0) return null;
    
    const pT = tCount / total;
    const confidence = Math.abs(pT - 0.5) * 2; // 0-1 scale
    
    if (pT > 0.55) return { pick: 'T', confidence };
    if (pT < 0.45) return { pick: 'X', confidence };
    return null;
}

// 2. Pattern Recognition với Fuzzy Matching
function algo_PatternRecognition(history) {
    const txStr = history.map(h => h.tx).slice(-20).join('').toLowerCase();
    let bestMatch = null;
    let maxScore = 0;

    for (const [type, data] of Object.entries(PATTERN_DATABASE)) {
        for (const pattern of data.patterns) {
            // Exact match
            if (txStr.endsWith(pattern)) {
                const score = pattern.length * data.weight;
                if (score > maxScore) {
                    maxScore = score;
                    
                    // Logic dự đoán dựa trên loại cầu
                    if (type.includes('Nghiêng Tài')) {
                        bestMatch = { pick: 'T', type, confidence: 0.8 };
                    } else if (type.includes('Nghiêng Xỉu')) {
                        bestMatch = { pick: 'X', type, confidence: 0.8 };
                    } else if (type === 'Cầu Bệt') {
                        // Cầu bệt dài -> đánh gãy
                        const lastChar = pattern[pattern.length - 1];
                        bestMatch = { 
                            pick: lastChar === 't' ? 'X' : 'T', 
                            type, 
                            confidence: Math.min(0.9, pattern.length / 6)
                        };
                    } else if (type === 'Cầu Đảo Chiều') {
                        // Đảo chiều -> đánh ngược xu hướng
                        const lastChar = pattern[pattern.length - 1];
                        bestMatch = { pick: lastChar === 't' ? 'X' : 'T', type, confidence: 0.75 };
                    } else if (type === 'Cầu 1-1') {
                        // 1-1 -> tiếp tục đảo
                        const lastChar = pattern[pattern.length - 1];
                        bestMatch = { pick: lastChar === 't' ? 'X' : 'T', type, confidence: 0.7 };
                    } else if (type === 'Cầu 2-2') {
                        // 2-2 -> đánh theo cặp
                        const last2 = pattern.slice(-2);
                        bestMatch = { pick: last2 === 'tt' ? 'X' : 'T', type, confidence: 0.75 };
                    } else {
                        bestMatch = { pick: null, type, confidence: 0.5 };
                    }
                }
            }
        }
    }
    
    return bestMatch;
}

// 3. Fibonacci Sequence Prediction
function algo_Fibonacci(history) {
    if (history.length < 15) return null;
    
    const tx = history.map(h => h.tx);
    const sequences = [];
    let currentSeq = { char: tx[0], length: 1 };
    
    for (let i = 1; i < tx.length; i++) {
        if (tx[i] === currentSeq.char) {
            currentSeq.length++;
        } else {
            sequences.push(currentSeq);
            currentSeq = { char: tx[i], length: 1 };
        }
    }
    sequences.push(currentSeq);
    
    // Kiểm tra chuỗi Fibonacci: 1, 1, 2, 3, 5, 8...
    if (sequences.length >= 4) {
        const last4 = sequences.slice(-4).map(s => s.length);
        const isFib = (last4[2] === last4[0] + last4[1]) && (last4[3] === last4[1] + last4[2]);
        
        if (isFib) {
            const nextLen = last4[2] + last4[3];
            const currentLen = sequences[sequences.length - 1].length;
            
            if (currentLen < nextLen) {
                return { 
                    pick: sequences[sequences.length - 1].char, 
                    confidence: 0.75 
                };
            } else {
                return { 
                    pick: sequences[sequences.length - 1].char === 'T' ? 'X' : 'T', 
                    confidence: 0.8 
                };
            }
        }
    }
    
    return null;
}

// 4. Momentum Oscillator
function algo_Momentum(history) {
    if (history.length < 20) return null;
    
    const tx = history.map(h => h.tx === 'T' ? 1 : -1);
    const momentum = tx.slice(-10).reduce((a, b) => a + b, 0);
    const prevMomentum = tx.slice(-20, -10).reduce((a, b) => a + b, 0);
    
    const change = momentum - prevMomentum;
    
    if (momentum > 4 && change > 0) return { pick: 'T', confidence: 0.7 };
    if (momentum < -4 && change < 0) return { pick: 'X', confidence: 0.7 };
    if (momentum > 3 && change < -2) return { pick: 'X', confidence: 0.75 }; // Đảo chiều
    if (momentum < -3 && change > 2) return { pick: 'T', confidence: 0.75 }; // Đảo chiều
    
    return null;
}

// 5. Entropy Analysis (Đo độ hỗn loạn)
function algo_Entropy(history) {
    if (history.length < 30) return null;
    
    const recent = history.slice(-15);
    const tCount = recent.filter(r => r.tx === 'T').length;
    const xCount = 15 - tCount;
    
    // Tính entropy
    const pT = tCount / 15;
    const pX = xCount / 15;
    const entropy = -(pT * Math.log2(pT + 0.001) + pX * Math.log2(pX + 0.001));
    
    // Entropy cao (>0.9) = Hỗn loạn -> Khó đoán
    // Entropy thấp (<0.6) = Có xu hướng rõ ràng
    
    if (entropy < 0.7) {
        if (tCount > xCount) return { pick: 'T', confidence: 0.65 };
        else return { pick: 'X', confidence: 0.65 };
    }
    
    return null; // Quá hỗn loạn
}

// 6. Adaptive Trend với EMA
function algo_AdaptiveTrend(history) {
    if (history.length < 20) return null;
    
    const values = history.map(h => h.tx === 'T' ? 1 : 0);
    
    // EMA 10 và EMA 20
    const ema10 = calculateEMA(values, 10);
    const ema20 = calculateEMA(values, 20);
    
    if (ema10 > ema20 && ema10 > 0.6) return { pick: 'T', confidence: 0.7 };
    if (ema10 < ema20 && ema10 < 0.4) return { pick: 'X', confidence: 0.7 };
    
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

// 7. RSI (Relative Strength Index)
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
    
    if (rsi > 70) return { pick: 'X', confidence: 0.7 }; // Quá mua
    if (rsi < 30) return { pick: 'T', confidence: 0.7 }; // Quá bán
    
    return null;
}

// 8. Mean Reversion
function algo_MeanReversion(history) {
    if (history.length < 30) return null;
    
    const totals = history.map(h => h.total);
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    const recent = totals.slice(-5);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / 5;
    
    const deviation = Math.abs(recentAvg - mean);
    
    if (deviation > 2) {
        if (recentAvg > mean) return { pick: 'X', confidence: 0.65 }; // Quay về mean
        else return { pick: 'T', confidence: 0.65 };
    }
    
    return null;
}

// --- MASTER AI CLASS ---
class MasterAI {
    constructor() {
        this.history = [];
        this.predictions = []; // Lưu dự đoán theo session
        this.stats = {
            total: 0,
            correct: 0,
            wrong: 0,
            waiting: 0
        };
        
        // Trọng số động cho từng thuật toán
        this.algoWeights = {
            markov: 1.5,
            pattern: 1.8,
            fibonacci: 1.2,
            momentum: 1.3,
            entropy: 1.0,
            trend: 1.4,
            rsi: 1.1,
            meanReversion: 1.0
        };
    }

    // Chỉ tính toán backtest khi API được gọi lần đầu
    initializeFromHistory(data) {
        console.log('🔄 Đang khởi tạo AI từ lịch sử...');
        
        this.history = [...data].sort((a, b) => a.session - b.session);
        this.predictions = [];
        this.stats = { total: 0, correct: 0, wrong: 0, waiting: 0 };
        
        // Chỉ backtest từ phiên thứ 30 trở đi (đủ data để học)
        if (this.history.length > 30) {
            for (let i = 30; i < this.history.length; i++) {
                const trainData = this.history.slice(0, i);
                const testRecord = this.history[i];
                
                // Dự đoán dựa trên data trước đó
                const prediction = this.predict(trainData);
                
                if (prediction.rawPrediction) {
                    this.stats.total++;
                    
                    if (prediction.rawPrediction === testRecord.tx) {
                        this.stats.correct++;
                    } else {
                        this.stats.wrong++;
                    }
                }
            }
        }
        
        console.log(`✅ Backtest hoàn tất: ${this.stats.correct}/${this.stats.total} = ${this.getRate()}`);
    }

    addResult(record) {
        // Kiểm tra trùng lặp
        const exists = this.history.find(h => h.session === record.session);
        if (exists) return;

        // Kiểm tra dự đoán trước đó
        const pred = this.predictions.find(p => p.session === record.session);
        
        if (pred && pred.pick) {
            this.stats.total++;
            
            if (pred.pick === record.tx) {
                this.stats.correct++;
                console.log(`✅ ĐÚNG - Phiên ${record.session}: Dự đoán ${pred.pick} = Kết quả ${record.tx}`);
            } else {
                this.stats.wrong++;
                console.log(`❌ SAI - Phiên ${record.session}: Dự đoán ${pred.pick} ≠ Kết quả ${record.tx}`);
            }
            
            // Xóa prediction đã xử lý
            this.predictions = this.predictions.filter(p => p.session !== record.session);
        }

        // Thêm vào history
        this.history.push(record);
        if (this.history.length > 300) {
            this.history = this.history.slice(-300);
        }
    }

    predict(customHistory = null) {
        const history = customHistory || this.history;
        
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

        // Thu thập votes từ tất cả thuật toán
        const algos = [
            { name: 'Markov', fn: () => algo_MarkovChain(history, 2), weight: this.algoWeights.markov },
            { name: 'Pattern', fn: () => algo_PatternRecognition(history), weight: this.algoWeights.pattern },
            { name: 'Fibonacci', fn: () => algo_Fibonacci(history), weight: this.algoWeights.fibonacci },
            { name: 'Momentum', fn: () => algo_Momentum(history), weight: this.algoWeights.momentum },
            { name: 'Entropy', fn: () => algo_Entropy(history), weight: this.algoWeights.entropy },
            { name: 'Trend', fn: () => algo_AdaptiveTrend(history), weight: this.algoWeights.trend },
            { name: 'RSI', fn: () => algo_RSI(history), weight: this.algoWeights.rsi },
            { name: 'MeanRev', fn: () => algo_MeanReversion(history), weight: this.algoWeights.meanReversion }
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

        // Quyết định cuối cùng
        let finalPick = null;
        let confidence = 0;

        const totalVotes = votes.T + votes.X;
        
        if (totalVotes === 0) {
            // Fallback: Dùng xu hướng gần nhất
            const recent = history.slice(-5);
            const tCount = recent.filter(r => r.tx === 'T').length;
            finalPick = tCount > 2 ? 'X' : 'T'; // Đánh ngược xu hướng
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

        // Lưu prediction cho phiên tiếp theo (chỉ khi dùng history thật)
        if (!customHistory && history.length > 0) {
            const nextSession = history[history.length - 1].session + 1;
            
            // Xóa predictions cũ
            this.predictions = this.predictions.filter(p => p.session >= nextSession);
            
            // Thêm prediction mới
            if (!this.predictions.find(p => p.session === nextSession)) {
                this.predictions.push({
                    session: nextSession,
                    pick: finalPick,
                    confidence,
                    contributors
                });
            }
        }

        return {
            prediction: finalPick === 'T' ? 'tài' : 'xỉu',
            rawPrediction: finalPick,
            confidence: confidence.toFixed(1),
            bridgeType,
            contributors
        };
    }

    detectBridgeType(history = null) {
        const data = history || this.history;
        const txStr = data.map(h => h.tx).slice(-15).join('').toLowerCase();
        
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
            dang_cho: this.predictions.length,
            ti_le_dung: this.getRate(),
            do_chinh_xac: this.stats.total > 0 ? (this.stats.correct / this.stats.total).toFixed(3) : '0.000'
        };
    }
}

const ai = new MasterAI();

// --- SERVER SETUP ---
const app = fastify();
app.register(cors, { origin: "*" });

app.get("/sunwinsew", async (request, reply) => {
    // Đánh dấu API đã được gọi
    if (!isApiActive) {
        isApiActive = true;
        
        // Nếu đã có dữ liệu từ WS, khởi tạo AI ngay
        if (rikResults.length > 0) {
            console.log('🎯 API được gọi lần đầu - Bắt đầu xử lý dữ liệu...');
            ai.initializeFromHistory(rikResults);
        }
    }

    if (rikResults.length === 0) {
        return { 
            status: "loading", 
            message: "Đang kết nối WebSocket và tải dữ liệu..." 
        };
    }

    const lastRes = rikResults[0];
    const prediction = ai.predict();

    return {
        id: "@minhsangdangcap_v2_pro",
        phien_hien_tai: lastRes.session,
        ket_qua: lastRes.result.toLowerCase(),
        xuc_xac: lastRes.dice,
        tong_diem: lastRes.total,
        phien_du_doan: lastRes.session + 1,
        du_doan: prediction.prediction,
        do_tu_tin: prediction.confidence + '%',
        loai_cau: prediction.bridgeType,
        cac_thuat_toan_vote: prediction.contributors || [],
        thong_ke_chi_tiet: ai.getDetailedStats(),
        trang_thai: isApiActive ? 'active' : 'standby'
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
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
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
                userId: "advanced_ai_bot",
                username: "AI_Pro_System",
                timestamp: Date.now()
            }),
            signature: "advanced_signature",
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

    rikWS.on("message", (data) => {
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
            
            // CHỈ khởi tạo AI nếu API đã được gọi
            if (isApiActive) {
                console.log('🎯 Khởi tạo AI với dữ liệu lịch sử...');
                ai.initializeFromHistory(historyData);
            } else {
                console.log('⏳ Dữ liệu đã sẵn sàng - Đợi API được gọi để bắt đầu xử lý...');
            }
        }

        // XỬ LÝ KẾT QUẢ MỚI (REALTIME)
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
                
                // CHỈ cập nhật AI nếu API đang active
                if (isApiActive) {
                    ai.addResult(record);
                    
                    const pred = ai.predict();
                    console.log(`🎰 Phiên ${record.session}: ${record.result} (${record.dice.join('-')}) | Tiếp theo: ${pred.prediction.toUpperCase()} [${pred.confidence}%] | Tỷ lệ: ${ai.getRate()}`);
                } else {
                    console.log(`📊 Phiên ${record.session}: ${record.result} (${record.dice.join('-')}) - Chưa xử lý (đợi API)`);
                }
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
║     🚀 SUNWIN AI PRO - ADVANCED PREDICTION SYSTEM     ║
╠═══════════════════════════════════════════════════════╣
║  Server: http://localhost:${PORT}                        ║
║  Endpoint: http://localhost:${PORT}/sunwinsew            ║
║  Status: ⏳ Standby Mode                              ║
║  Note: AI sẽ bắt đầu xử lý khi API được gọi lần đầu   ║
╚═══════════════════════════════════════════════════════╝
        `);
        
        console.log('📡 Kết nối WebSocket...');
        connectWebSocket();
        
    } catch (err) {
        console.error('❌ Lỗi khởi động server:', err);
        process.exit(1);
    }
};

start();
