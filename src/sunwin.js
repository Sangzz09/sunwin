import fastify from "fastify";
import cors from "@fastify/cors";
import WebSocket from "ws";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// --- CẤU HÌNH ---
const PORT = process.env.PORT || 3000;
const WS_URL = "wss://websocket.azhkthg1.net/websocket?token=";
const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJzYW5nZGVwemFpMDlubyIsImJvdCI6MCwiaXNNZXJjaGFudCI6ZmFsc2UsInZlcmlmaWVkQmFua0FjY291bnQiOnRydWUsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MjIxNjQwNjcyLCJhZmZJZCI6IlN1bndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoic3VuLndpbiIsInRpbWVzdGFtcCI6MTc2NjQwMjkzODEwNCwibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOnRydWUsImlwQWRkcmVzcyI6IjExMy4xNzQuNzguMjU1IiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8xNS5wbmciLCJwbGF0Zm9ybUlkIjo0LCJ1c2VySWQiOiI3ODRmNGU0Mi1iZWExLTRiZTUtYjgwNS03MmJlZjY5N2UwMTIiLCJyZWdUaW1lIjoxNzQyMjMyMzQ1MTkxLCJwaG9uZSI6Ijg0ODg2MDI3NzY3IiwiZGVwb3NpdCI6dHJ1ZSwidXNlcm5hbWUiOiJTQ19tc2FuZ3p6MDkifQ.Y4Dh3hSBO-HoKsSiSJiIjNZMEyahCISyY2h_Fx2UY3w";

// --- GLOBAL STATE ---
let rikResults = [];
let rikCurrentSession = null;
let rikWS = null;
let rikIntervalCmd = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- PATTERN DATABASE TỐI ƯU (CHỈ GIỮ PATTERNS HIỆU QUẢ) ---
const PATTERN_DATABASE = {
    // Patterns cơ bản hiệu quả cao
    'run_2': ['tt', 'xx'],
    'run_3': ['ttt', 'xxx'],
    'run_4': ['tttt', 'xxxx'],
    'run_5': ['ttttt', 'xxxxx'],
    
    // Zigzag patterns (hiệu quả trong thực tế)
    'zigzag_2': ['tx', 'xt'],
    'zigzag_3': ['txt', 'xtx'],
    'zigzag_4': ['txtx', 'xtxt'],
    'zigzag_5': ['txtxt', 'xtxtx'],
    
    // Bridge patterns (cầu thực tế)
    'bridge_1_1': ['txxt', 'xttx'],
    'bridge_2_2': ['ttxxtt', 'xxttxx'],
    'bridge_3_1': ['tttxttt', 'xxxtxxx'],
    
    // Reversal patterns
    'reversal_short': ['ttx', 'xxt'],
    'reversal_medium': ['tttxx', 'xxxtt'],
    'reversal_long': ['ttttxxx', 'xxxxtttt'],
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
        console.error('Lỗi API /api/taixiu/ai-stats:', e);
        return { error: "Lỗi hệ thống" };
    }
});

// GET /
app.get("/", async () => { 
    return {
        status: "online",
        name: "SEW PROPRO OPTIMIZED",
        version: "10.0 - Optimized Algorithms",
        description: "Hệ thống AI tối ưu với 5 thuật toán chính xác cao",
        algorithms_count: ALGORITHMS.length,
        features: [
            "Streak Analysis - Phân tích chuỗi",
            "Pattern Frequency - Tần suất pattern",
            "Statistical Bias - Phân tích bias thống kê",
            "Momentum Analysis - Phân tích động lượng",
            "Adaptive Learning - Học thích ứng"
        ]
    };
});

// --- SERVER START ---
const start = async () => {
    try {
        await app.listen({
            port: PORT,
            host: "0.0.0.0"
        });
        
        console.log(`====================================`);
        console.log(`🚀 SEW PROPRO Sunwin AI v10.0`);
        console.log(`====================================`);
        console.log(`   Port: ${PORT}`);
        console.log(`   Thuật toán: ${ALGORITHMS.length} Optimized Algorithms`);
        console.log(`   Features: High Accuracy + Adaptive Learning`);
        console.log(`==============================================`);
    } catch (err) {
        console.error('❌ Lỗi khởi động server:', err);
        process.exit(1);
    }
};

// --- WEBSOCKET HANDLERS ---
function decodeBinaryMessage(data) {
    try {
        const message = new TextDecoder().decode(data);
        if (message.startsWith("[") || message.startsWith("{")) {
            return JSON.parse(message);
        }
        return null;
    } catch {
        return null;
    }
}

function sendRikCmd1005() {
    if (rikWS?.readyState === WebSocket.OPEN) {
        try {
            rikWS.send(JSON.stringify([6, "MiniGame", "taixiuPlugin", {
                cmd: 1005
            }]));
        } catch (e) {
            console.error("Lỗi gửi lệnh 1005:", e.message);
        }
    }
}

function connectRikWebSocket() {
    console.log("\n🔌 Đang kết nối WebSocket...");
    
    if (rikWS && (rikWS.readyState === WebSocket.OPEN || rikWS.readyState === WebSocket.CONNECTING)) {
        rikWS.close();
    }
    clearInterval(rikIntervalCmd);

    try {
        rikWS = new WebSocket(`${WS_URL}${TOKEN}`);
    } catch (e) {
        console.error("Lỗi tạo WebSocket:", e.message);
        setTimeout(connectRikWebSocket, 5000);
        return;
    }

    rikWS.on("open", () => {
        console.log("✅ WebSocket connected - Đang xác thực...");
        
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
        
        try {
            rikWS.send(JSON.stringify(authPayload));
        } catch (e) {
            console.error("Lỗi gửi xác thực:", e.message);
        }
       
        rikIntervalCmd = setInterval(sendRikCmd1005, 5000);
    });

    rikWS.on("message", (data) => {
        try {
            const json = typeof data === "string" ? JSON.parse(data) : decodeBinaryMessage(data);
            if (!json) return;

            if (json.session && Array.isArray(json.dice)) {
                const record = {
                    session: json.session,
                    dice: json.dice,
                    total: json.total,
                    result: json.result,
                };
                
                const parsed = ai.addResult(record);
                
                if (!rikCurrentSession || record.session > rikCurrentSession) {
                    rikCurrentSession = record.session;
                    rikResults.unshift(record);
                    if (rikResults.length > 100) rikResults.pop();
                }
                
                const prediction = ai.predict();
                const stats = ai.getStats();
                
                console.log(`\n==============================================`);
                console.log(`📥 PHIÊN ${parsed.session}: ${parsed.result} (${parsed.total}) [${parsed.dice.join('-')}]`);
                console.log(`🔮 DỰ ĐOÁN ${parsed.session + 1}: **${prediction.prediction.toUpperCase()}**`);
                console.log(`🎯 CONFIDENCE: ${(prediction.confidence * 100).toFixed(1)}%`);
                console.log(`🤖 ALGORITHMS: ${prediction.algorithms}/${ALGORITHMS.length}`);
                
                // Hiển thị top performers
                const topAlgos = Object.entries(stats)
                    .sort((a, b) => parseFloat(b[1].weight) - parseFloat(a[1].weight))
                    .slice(0, 3);
                
                if (topAlgos.length > 0) {
                    console.log(`📊 TOP PERFORMERS:`);
                    topAlgos.forEach(([id, stat], idx) => {
                        console.log(`   ${idx + 1}. ${stat.name}: ${stat.accuracy} (W:${stat.weight}, S:${stat.streak})`);
                    });
                }
                console.log(`==============================================`);
                
            } 
            else if (Array.isArray(json) && json[1]?.htr) {
                const newHistory = json[1].htr
                    .map((i) => ({
                        session: i.sid,
                        dice: [i.d1, i.d2, i.d3],
                        total: i.d1 + i.d2 + i.d3,
                        result: i.d1 + i.d2 + i.d3 >= 11 ? "Tài" : "Xỉu",
                    }))
                    .sort((a, b) => a.session - b.session);

                ai.loadHistory(newHistory);
                rikResults = newHistory.slice(-50).sort((a, b) => b.session - a.session);

                const prediction = ai.predict();
                const stats = ai.getStats();

                console.log(`\n==============================================`);
                console.log(`📊 Đã tải ${newHistory.length} kết quả lịch sử`);
                console.log(`🤖 OPTIMIZED AI ĐÃ SẴN SÀNG`);
                console.log(`==============================================`);
                console.log(`🎯 Initial Confidence: ${(prediction.confidence * 100).toFixed(1)}%`);
                
                const algoArray = Object.entries(stats)
                    .map(([key, value]) => ({ key, ...value }))
                    .sort((a, b) => parseFloat(b.weight) - parseFloat(a.weight));
                
                console.log(`📈 Thuật toán đã huấn luyện:`);
                algoArray.forEach((algo, idx) => {
                    console.log(`   ${idx + 1}. ${algo.name}: ACC ${algo.accuracy} | WGT ${algo.weight} | PRED ${algo.predictions}`);
                });
                console.log(`==============================================`);
            }
        } catch (e) {
            console.error("❌ Parse message error:", e.message);
        }
    });

    rikWS.on("close", () => {
        console.log("🔌 WebSocket disconnected. Reconnecting in 3s...");
        clearInterval(rikIntervalCmd);
        setTimeout(connectRikWebSocket, 3000);
    });

    rikWS.on("error", (err) => {
        console.error("🔌 WebSocket error:", err.message);
        rikWS.close();
    });
}

// Khởi động Server và WebSocket
start().then(() => {
    connectRikWebSocket();
}).catch(err => {
    console.error('Failed to start application:', err);
    process.exit(1);
}); {
        console.error("Lỗi parseLines:", e.message);
        return [];
    }
}

// --- THUẬT TOÁN TỐI ƯU ---

// Thuật toán 1: Streak Analysis - Phân tích chuỗi liên tiếp
function algo1_streakAnalysis(history) {
    if (history.length < 10) return null;
    
    const tx = history.map(h => h.tx);
    const lastResult = tx[tx.length - 1];
    
    // Đếm chuỗi hiện tại
    let currentStreak = 1;
    for (let i = tx.length - 2; i >= 0; i--) {
        if (tx[i] === lastResult) currentStreak++;
        else break;
    }
    
    // Phân tích xu hướng đảo chiều
    if (currentStreak >= 3 && currentStreak <= 5) {
        // Kiểm tra lịch sử đảo chiều sau chuỗi tương tự
        let reversalCount = 0;
        let continuedCount = 0;
        
        for (let i = currentStreak; i < tx.length - currentStreak - 1; i++) {
            let streakLen = 1;
            const checkResult = tx[i];
            
            for (let j = i - 1; j >= 0 && j >= i - 10; j--) {
                if (tx[j] === checkResult) streakLen++;
                else break;
            }
            
            if (streakLen === currentStreak && i + 1 < tx.length) {
                if (tx[i + 1] !== checkResult) reversalCount++;
                else continuedCount++;
            }
        }
        
        if (reversalCount > continuedCount * 1.5) {
            return lastResult === 'T' ? 'X' : 'T';
        } else if (continuedCount > reversalCount * 1.2) {
            return lastResult;
        }
    }
    
    // Chuỗi quá dài (>= 6) thường đảo chiều
    if (currentStreak >= 6) {
        return lastResult === 'T' ? 'X' : 'T';
    }
    
    return null;
}

// Thuật toán 2: Pattern Frequency - Tần suất pattern
function algo2_patternFrequency(history) {
    if (history.length < 20) return null;
    
    const tx = history.map(h => h.tx.toLowerCase());
    const fullPattern = tx.join('');
    
    // Lấy pattern gần nhất (4-6 ký tự)
    const recentPatterns = [];
    for (let len = 4; len <= 6; len++) {
        if (fullPattern.length >= len) {
            recentPatterns.push(fullPattern.slice(-len));
        }
    }
    
    let bestMatch = { t: 0, x: 0 };
    
    recentPatterns.forEach(recentPattern => {
        // Tìm pattern này trong lịch sử
        for (let i = 0; i <= fullPattern.length - recentPattern.length - 1; i++) {
            if (fullPattern.substr(i, recentPattern.length) === recentPattern) {
                const nextChar = fullPattern.charAt(i + recentPattern.length);
                if (nextChar === 't') bestMatch.t += 1;
                else if (nextChar === 'x') bestMatch.x += 1;
            }
        }
    });
    
    const total = bestMatch.t + bestMatch.x;
    if (total >= 3) {
        const confidence = Math.max(bestMatch.t, bestMatch.x) / total;
        if (confidence >= 0.70) {
            return bestMatch.t > bestMatch.x ? 'T' : 'X';
        }
    }
    
    return null;
}

// Thuật toán 3: Statistical Bias - Phân tích bias thống kê
function algo3_statisticalBias(history) {
    if (history.length < 25) return null;
    
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    
    // Phân tích 3 khung thời gian
    const windows = [
        { size: 10, weight: 1.5 },
        { size: 20, weight: 1.0 },
        { size: Math.min(40, history.length), weight: 0.5 }
    ];
    
    let tScore = 0;
    let xScore = 0;
    
    windows.forEach(window => {
        const recentTx = tx.slice(-window.size);
        const recentTotals = totals.slice(-window.size);
        
        const tCount = recentTx.filter(t => t === 'T').length;
        const xCount = recentTx.filter(t => t === 'X').length;
        const avgTotal = recentTotals.reduce((a, b) => a + b, 0) / recentTotals.length;
        
        // Điều chỉnh điểm dựa trên bias
        const bias = tCount / window.size;
        
        if (bias > 0.60) {
            // Quá nhiều T, khả năng cao X
            xScore += window.weight * (bias - 0.5) * 2;
        } else if (bias < 0.40) {
            // Quá nhiều X, khả năng cao T
            tScore += window.weight * (0.5 - bias) * 2;
        }
        
        // Điều chỉnh dựa trên tổng điểm trung bình
        if (avgTotal > 11.2) {
            xScore += window.weight * 0.3;
        } else if (avgTotal < 9.8) {
            tScore += window.weight * 0.3;
        }
    });
    
    if (tScore > xScore + 0.8) return 'T';
    if (xScore > tScore + 0.8) return 'X';
    
    return null;
}

// Thuật toán 4: Momentum Analysis - Phân tích động lượng
function algo4_momentumAnalysis(history) {
    if (history.length < 15) return null;
    
    const totals = history.map(h => h.total);
    const tx = history.map(h => h.tx);
    
    // Tính momentum của tổng điểm
    const recent5 = totals.slice(-5);
    const previous5 = totals.slice(-10, -5);
    
    const avgRecent = recent5.reduce((a, b) => a + b, 0) / 5;
    const avgPrevious = previous5.reduce((a, b) => a + b, 0) / 5;
    
    const momentum = avgRecent - avgPrevious;
    
    // Tính volatility
    const volatility = calculateVolatility(recent5);
    
    // Momentum mạnh + volatility thấp = xu hướng ổn định
    if (Math.abs(momentum) > 0.8 && volatility < 2.5) {
        if (momentum > 0) {
            // Đang tăng, khả năng cao tiếp tục hoặc đảo
            const recentT = tx.slice(-5).filter(t => t === 'T').length;
            return recentT >= 3 ? 'X' : 'T';
        } else {
            // Đang giảm
            const recentX = tx.slice(-5).filter(t => t === 'X').length;
            return recentX >= 3 ? 'T' : 'X';
        }
    }
    
    // Volatility cao = không ổn định, theo xu hướng ngắn hạn
    if (volatility > 3.0) {
        const last3 = tx.slice(-3);
        const tCount = last3.filter(t => t === 'T').length;
        if (tCount >= 2) return 'T';
        if (tCount <= 1) return 'X';
    }
    
    return null;
}

// Thuật toán 5: Adaptive Learning - Học thích ứng
function algo5_adaptiveLearning(history) {
    if (history.length < 30) return null;
    
    const tx = history.map(h => h.tx);
    
    // Phân tích 10 dự đoán gần nhất của pattern matching
    const predictions = [];
    
    for (let i = 15; i < Math.min(history.length - 1, 30); i++) {
        const pastPattern = tx.slice(i - 5, i).join('').toLowerCase();
        
        // Tìm pattern tương tự trong lịch sử trước đó
        let matches = { t: 0, x: 0 };
        
        for (let j = 5; j < i - 1; j++) {
            const checkPattern = tx.slice(j - 5, j).join('').toLowerCase();
            if (checkPattern === pastPattern) {
                const actual = tx[j].toLowerCase();
                matches[actual]++;
            }
        }
        
        if (matches.t + matches.x >= 2) {
            const predicted = matches.t > matches.x ? 't' : 'x';
            const actual = tx[i].toLowerCase();
            predictions.push({ predicted, actual, correct: predicted === actual });
        }
    }
    
    if (predictions.length < 5) return null;
    
    // Tính accuracy của pattern matching
    const correctCount = predictions.filter(p => p.correct).length;
    const accuracy = correctCount / predictions.length;
    
    // Nếu accuracy cao, tin tưởng vào pattern matching
    if (accuracy >= 0.65) {
        const currentPattern = tx.slice(-5).join('').toLowerCase();
        let matches = { t: 0, x: 0 };
        
        for (let i = 5; i < tx.length - 1; i++) {
            const checkPattern = tx.slice(i - 5, i).join('').toLowerCase();
            if (checkPattern === currentPattern) {
                const next = tx[i].toLowerCase();
                matches[next]++;
            }
        }
        
        if (matches.t + matches.x >= 2) {
            const confidence = Math.max(matches.t, matches.x) / (matches.t + matches.x);
            if (confidence >= 0.65) {
                return matches.t > matches.x ? 'T' : 'X';
            }
        }
    }
    
    return null;
}

// --- HELPER FUNCTIONS ---
function calculateVolatility(numbers) {
    const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
    const variance = numbers.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / numbers.length;
    return Math.sqrt(variance);
}

// --- DANH SÁCH THUẬT TOÁN TỐI ƯU ---
const ALGORITHMS = [
    { id: 'streak', fn: algo1_streakAnalysis, name: 'Streak Analysis' },
    { id: 'pattern_freq', fn: algo2_patternFrequency, name: 'Pattern Frequency' },
    { id: 'stat_bias', fn: algo3_statisticalBias, name: 'Statistical Bias' },
    { id: 'momentum', fn: algo4_momentumAnalysis, name: 'Momentum Analysis' },
    { id: 'adaptive', fn: algo5_adaptiveLearning, name: 'Adaptive Learning' },
];

// --- ADVANCED AI CORE ---
class OptimizedAI {
    constructor() {
        this.history = [];
        this.algorithmWeights = {};
        this.algorithmPerformance = {};
        this.recentPredictions = {};
        
        ALGORITHMS.forEach(algo => {
            this.algorithmWeights[algo.id] = 1.0;
            this.algorithmPerformance[algo.id] = {
                correct: 0,
                total: 0,
                recent: [],
                streak: 0,
                maxStreak: 0,
                name: algo.name
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
                
                if (correct) {
                    perf.streak++;
                    perf.maxStreak = Math.max(perf.maxStreak, perf.streak);
                } else {
                    perf.streak = 0;
                }
                
                perf.recent.push(correct ? 1 : 0);
                if (perf.recent.length > 15) {
                    perf.recent.shift();
                }
                
                // Cập nhật trọng số động
                if (perf.total >= 10) {
                    const accuracy = perf.correct / perf.total;
                    const recentAccuracy = perf.recent.length > 0 
                        ? perf.recent.reduce((a, b) => a + b) / perf.recent.length 
                        : 0.5;
                    
                    // Ưu tiên accuracy gần đây hơn
                    let newWeight = (accuracy * 0.4 + recentAccuracy * 0.6);
                    
                    // Bonus cho streak
                    if (perf.streak >= 3) {
                        newWeight *= (1 + perf.streak * 0.05);
                    }
                    
                    // Penalty cho sai liên tục
                    const recentFails = perf.recent.slice(-5).filter(r => r === 0).length;
                    if (recentFails >= 4) {
                        newWeight *= 0.5;
                    }
                    
                    newWeight = Math.max(0.1, Math.min(3.0, newWeight));
                    
                    // Smooth update
                    this.algorithmWeights[algo.id] = 
                        this.algorithmWeights[algo.id] * 0.7 + newWeight * 0.3;
                }
            }
        });
        
        ALGORITHMS.forEach(algo => { this.recentPredictions[algo.id] = null; });
    }
    
    predict() {
        if (this.history.length < 10) {
            return {
                prediction: 'tài',
                confidence: 0.5,
                rawPrediction: 'T',
                algorithms: 0,
            };
        }
        
        const predictions = [];
        this.recentPredictions = {};
        
        ALGORITHMS.forEach(algo => {
            try {
                const pred = algo.fn(this.history);
                if (pred === 'T' || pred === 'X') {
                    const weight = this.algorithmWeights[algo.id] || 1.0;
                    predictions.push({
                        algorithm: algo.id,
                        prediction: pred,
                        weight: weight
                    });
                    this.recentPredictions[algo.id] = pred;
                }
            } catch (e) {
                console.error(`Lỗi thuật toán ${algo.id}:`, e.message);
            }
        });
        
        if (predictions.length === 0) {
            // Fallback: theo xu hướng gần nhất
            const recent = this.history.slice(-5).map(h => h.tx);
            const tCount = recent.filter(t => t === 'T').length;
            return {
                prediction: tCount >= 3 ? 'tài' : 'xỉu',
                confidence: 0.5,
                rawPrediction: tCount >= 3 ? 'T' : 'X',
                algorithms: 0,
            };
        }
        
        // Weighted voting
        const votes = { T: 0, X: 0 };
        let totalWeight = 0;
        
        predictions.forEach(p => {
            votes[p.prediction] += p.weight;
            totalWeight += p.weight;
        });
        
        const tVotes = votes['T'] || 0;
        const xVotes = votes['X'] || 0;
        
        const finalPrediction = tVotes > xVotes ? 'T' : 'X';
        
        // Tính confidence thực tế
        const winningVotes = Math.max(tVotes, xVotes);
        const confidence = totalWeight > 0 ? winningVotes / totalWeight : 0.5;
        
        // Điều chỉnh confidence dựa trên consensus
        const consensus = predictions.filter(p => p.prediction === finalPrediction).length / predictions.length;
        const adjustedConfidence = (confidence * 0.6 + consensus * 0.4);
        
        return {
            prediction: finalPrediction === 'T' ? 'tài' : 'xỉu',
            confidence: Math.min(0.95, Math.max(0.5, adjustedConfidence)),
            rawPrediction: finalPrediction,
            algorithms: predictions.length,
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
        if (this.history.length > 500) {
            this.history = this.history.slice(-400);
        }
        
        return parsed;
    }
    
    loadHistory(historyData) {
        this.history = parseLines(historyData);
        
        if (this.history.length >= 20) {
            console.log(`🤖 Đang huấn luyện AI trên ${this.history.length} mẫu...`);
            
            // Training phase
            for (let i = 15; i < this.history.length - 1; i++) {
                const pastHistory = this.history.slice(0, i + 1);
                const actualTx = this.history[i + 1]?.tx;
                
                if (!actualTx) continue;
                
                ALGORITHMS.forEach(algo => {
                    try {
                        const pred = algo.fn(pastHistory);
                        if (pred) {
                            const perf = this.algorithmPerformance[algo.id];
                            const correct = pred === actualTx;
                            
                            perf.recent.push(correct ? 1 : 0);
                            if (perf.recent.length > 15) {
                                perf.recent.shift();
                            }
                            perf.correct += correct ? 1 : 0;
                            perf.total++;
                            
                            if (perf.total >= 10) {
                                const accuracy = perf.correct / perf.total;
                                const recentAccuracy = perf.recent.reduce((a, b) => a + b) / perf.recent.length;
                                let newWeight = (accuracy * 0.4 + recentAccuracy * 0.6);
                                newWeight = Math.max(0.1, Math.min(3.0, newWeight));
                                this.algorithmWeights[algo.id] = newWeight;
                            }
                        }
                    } catch (e) {
                        // Bỏ qua lỗi
                    }
                });
            }
            
            console.log('✅ Huấn luyện AI hoàn tất!');
        }
    }
    
    getPattern() {
        if (this.history.length < 20) return { recent: 'đang thu thập...', long: 'đang thu thập...' };
        const tx = this.history.map(h => h.tx);
        const recent = tx.slice(-15).join('').toLowerCase();
        const long = tx.slice(-40).join('').toLowerCase();
        
        return {
            recent: recent,
            long: long
        };
    }
    
    getStats() {
        const stats = {};
        ALGORITHMS.forEach(algo => {
            const perf = this.algorithmPerformance[algo.id];
            if (perf.total > 0) {
                stats[algo.id] = {
                    name: perf.name,
                    accuracy: (perf.correct / perf.total * 100).toFixed(1) + '%',
                    weight: this.algorithmWeights[algo.id].toFixed(2),
                    predictions: perf.total,
                    streak: perf.streak,
                    maxStreak: perf.maxStreak
                };
            }
        });
        
        return stats;
    }
}

// --- Khởi tạo AI ---
const ai = new OptimizedAI();

// --- API SERVER ---
const app = fastify({ 
    logger: false 
});

await app.register(cors, { 
    origin: "*" 
});

// GET /api/taixiu/sunwin
app.get("/api/taixiu/sunwin", async (request, reply) => {
    try {
        const valid = rikResults.filter((r) => r.dice?.length === 3);
        const lastResult = valid.length ? valid[0] : null;
        const currentPrediction = ai.predict();
        const pattern = ai.getPattern();

        if (!lastResult) {
            return {
                id: "@MINHSANGDANGCAP",
                status: "đang chờ dữ liệu phiên đầu tiên...",
                phien_truoc: null,
                tong: null,
                ket_qua: "đang chờ...",
                pattern_gan_nhat: pattern.recent,
                pattern_dai: pattern.long,
                phien_hien_tai: null,
                du_doan: "đang tính...",
                do_tin_cay_ai: "50%",
            };
        }

        return {
            id: "@MINHSANGDANGCAP",
            phien_truoc: lastResult.session,
            xuc_xac: lastResult.dice,
            tong: lastResult.total,
            ket_qua: lastResult.result.toLowerCase(),
            pattern_gan_nhat: pattern.recent,
            pattern_dai: pattern.long,
            phien_hien_tai: lastResult.session + 1,
            du_doan: currentPrediction.prediction,
            do_tin_cay_ai: `${(currentPrediction.confidence * 100).toFixed(1)}%`,
            algorithms_active: currentPrediction.algorithms
        };
    } catch (error) {
        console.error('Lỗi API /api/taixiu/sunwin:', error);
        return {
            id: "@MINHSANGDANGCAP",
            error: "Hệ thống đang xử lý lỗi hoặc chưa đủ dữ liệu."
        };
    }
});

// GET /api/taixiu/history
app.get("/api/taixiu/history", async () => { 
    try {
        const valid = rikResults.filter((r) => r.dice?.length === 3);
        if (!valid.length) return { message: "chưa có dữ liệu." };
        
        return valid.slice(0, 30).map((i) => ({
            session: i.session,
            dice: i.dice,
            total: i.total,
            result: i.result.toLowerCase(),
            tx: i.total >= 11 ? 'T' : 'X'
        }));
    } catch (e) {
        console.error('Lỗi API /api/taixiu/history:', e);
        return { message: "lỗi hệ thống" };
    }
});

// GET /api/taixiu/ai-stats
app.get("/api/taixiu/ai-stats", async () => {
    try {
        const stats = ai.getStats();
        const prediction = ai.predict();
        const pattern = ai.getPattern();
        
        return {
            status: "online",
            ai_version: "10.0 - Optimized Algorithms",
            current_prediction: prediction.prediction,
            confidence: `${(prediction.confidence * 100).toFixed(1)}%`,
            algorithms_active: prediction.algorithms,
            algorithm_stats: stats
        };
    } catch (e)
