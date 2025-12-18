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
    'Cầu Bệt': ['ttttt', 'xxxxx', 'tttttt', 'xxxxxx', 'ttttttt', 'xxxxxxx'],
    'Cầu 1-1': ['txtx', 'xtxt', 'txtxt', 'xtxtx', 'txtxtx', 'xtxtxt'],
    'Cầu 2-2': ['ttxx', 'xxtt', 'ttxxtt', 'xxttxx', 'ttxxttxx', 'xxttxxtt'],
    'Cầu 1-2': ['txxt', 'xttx', 'txxtt', 'xttxx'],
    'Cầu 2-1': ['ttxtx', 'xxtxt', 'ttxtxt', 'xxtxtx'],
    'Cầu 1-2-3': ['txxttt', 'xttxxx', 'txxtttt', 'xttxxxx'],
    'Cầu 3-2-1': ['tttxxt', 'xxxttt', 'tttxxtt', 'xxxttxx'],
    'Cầu Đối Xứng': ['ttxtt', 'xxtxx', 'txtxt', 'xtxtx', 'tttxttt', 'xxxtxxx'],
    'Cầu Nghiêng': ['tttxttt', 'xxxtxxx', 'tttttt', 'xxxxxx', 'tttttxt', 'xxxxxxt']
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

// Stochastic Oscillator
const calculateStochastic = (txArray, period = 14) => {
    if (txArray.length < period) return 50;
    
    const values = txArray.map(tx => tx === 'T' ? 1 : 0).slice(-period);
    const current = values[values.length - 1];
    const highest = Math.max(...values);
    const lowest = Math.min(...values);
    
    if (highest === lowest) return 50;
    return ((current - lowest) / (highest - lowest)) * 100;
};

// --- THUẬT TOÁN DỰ ĐOÁN NÂNG CAO ---

// 1. Markov Chain với Memory đa cấp + Adaptive Weights
function algo_MarkovChainAdvanced(history) {
    if (history.length < 30) return null;
    
    const tx = history.map(h => h.tx);
    const results = [];
    
    // Kiểm tra từ depth 1 đến 5 (tăng từ 3 lên 5)
    for (let depth = 1; depth <= 5; depth++) {
        const pattern = tx.slice(-depth).join('');
        let tNext = 0, xNext = 0, totalMatches = 0;
        
        for (let i = depth; i < tx.length; i++) {
            const prevPattern = tx.slice(i - depth, i).join('');
            if (prevPattern === pattern) {
                totalMatches++;
                if (tx[i] === 'T') tNext++;
                else xNext++;
            }
        }
        
        if (totalMatches >= 2) { // Giảm threshold từ 3 xuống 2
            const confidence = Math.max(tNext, xNext) / totalMatches;
            const recencyBonus = (depth <= 2) ? 1.2 : 1.0; // Ưu tiên pattern ngắn hạn
            
            results.push({
                pick: tNext > xNext ? 'T' : 'X',
                confidence: confidence * recencyBonus,
                weight: depth * (totalMatches / 10), // Weight dựa trên tần suất
                matches: totalMatches
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
    
    const totalScore = tScore + xScore;
    return {
        pick: tScore > xScore ? 'T' : 'X',
        confidence: Math.min(Math.max(tScore, xScore) / totalScore, 0.95)
    };
}

// 2. Pattern Recognition với Anti-Pattern + Fuzzy Matching
function algo_PatternRecognition(history) {
    if (history.length < 15) return null;
    
    const txStr = history.map(h => h.tx).slice(-25).join('').toLowerCase();
    let bestMatch = null;
    let maxScore = 0;
    
    for (const [type, patterns] of Object.entries(PATTERN_DATABASE)) {
        for (const pattern of patterns) {
            // Exact match
            const exactIndex = txStr.lastIndexOf(pattern);
            if (exactIndex !== -1) {
                const score = pattern.length + (txStr.length - exactIndex) * 0.1;
                
                if (score > maxScore) {
                    maxScore = score;
                    const lastChar = pattern[pattern.length - 1];
                    let confidence = 0.65;
                    let prediction = lastChar;
                    
                    // Logic dự đoán cải tiến
                    if (type.includes('Bệt') && pattern.length >= 5) {
                        prediction = lastChar === 't' ? 'x' : 't';
                        confidence = 0.72 + (pattern.length - 5) * 0.03;
                    } else if (type.includes('Nghiêng') && pattern.length >= 6) {
                        prediction = lastChar === 't' ? 'x' : 't';
                        confidence = 0.68 + (pattern.length - 6) * 0.03;
                    } else if (type.includes('1-1')) {
                        prediction = lastChar === 't' ? 't' : 'x';
                        confidence = 0.64;
                    } else if (type.includes('2-2')) {
                        prediction = lastChar === 't' ? 'x' : 't';
                        confidence = 0.66;
                    } else if (type.includes('Đối Xứng')) {
                        prediction = lastChar === 't' ? 't' : 'x';
                        confidence = 0.62;
                    }
                    
                    bestMatch = { 
                        pick: prediction.toUpperCase(), 
                        confidence: Math.min(confidence, 0.92),
                        type: type
                    };
                }
            }
        }
    }
    
    return bestMatch;
}

// 3. Momentum Trading Strategy + Volume Analysis
function algo_Momentum(history) {
    if (history.length < 20) return null;
    
    const recent = history.slice(-30).map(h => h.tx);
    const momentum = calculateEMA(recent, 10);
    const rsi = calculateRSI(recent, 14);
    const stoch = calculateStochastic(recent, 14);
    
    // Overbought/Oversold với Stochastic
    if (rsi > 75 && stoch > 80) return { pick: 'X', confidence: 0.78 };
    if (rsi < 25 && stoch < 20) return { pick: 'T', confidence: 0.78 };
    
    // Strong momentum
    if (momentum > 0.7 && rsi > 55) return { pick: 'T', confidence: 0.72 };
    if (momentum < 0.3 && rsi < 45) return { pick: 'X', confidence: 0.72 };
    
    // Moderate signals
    if (rsi > 65) return { pick: 'X', confidence: 0.65 };
    if (rsi < 35) return { pick: 'T', confidence: 0.65 };
    
    return null;
}

// 4. Mean Reversion Strategy + Keltner Channels
function algo_MeanReversion(history) {
    if (history.length < 30) return null;
    
    const recent = history.slice(-40).map(h => h.tx);
    const bb = calculateBollingerBands(recent, 20);
    const ema = calculateEMA(recent, 20);
    
    const currentValue = recent[recent.length - 1] === 'T' ? 1 : 0;
    const prevValue = recent[recent.length - 2] === 'T' ? 1 : 0;
    
    // Bollinger Band breakout
    if (currentValue >= bb.upper && prevValue >= bb.upper) {
        return { pick: 'X', confidence: 0.82 };
    }
    if (currentValue <= bb.lower && prevValue <= bb.lower) {
        return { pick: 'T', confidence: 0.82 };
    }
    
    // Mean reversion từ extreme
    if (currentValue > bb.upper) return { pick: 'X', confidence: 0.74 };
    if (currentValue < bb.lower) return { pick: 'T', confidence: 0.74 };
    
    // EMA crossover
    if (currentValue > ema && ema > 0.6) return { pick: 'X', confidence: 0.68 };
    if (currentValue < ema && ema < 0.4) return { pick: 'T', confidence: 0.68 };
    
    return null;
}

// 5. Streak Breaking Algorithm + Probability Theory
function algo_StreakBreaker(history) {
    if (history.length < 10) return null;
    
    const tx = history.map(h => h.tx);
    let currentStreak = 1;
    const lastTx = tx[tx.length - 1];
    
    for (let i = tx.length - 2; i >= 0; i--) {
        if (tx[i] === lastTx) currentStreak++;
        else break;
    }
    
    // Tính xác suất dựa trên lịch sử streak
    const allStreaks = [];
    let tempStreak = 1;
    for (let i = 1; i < tx.length; i++) {
        if (tx[i] === tx[i-1]) {
            tempStreak++;
        } else {
            allStreaks.push(tempStreak);
            tempStreak = 1;
        }
    }
    
    const avgStreak = allStreaks.reduce((a,b) => a+b, 0) / allStreaks.length;
    const maxStreak = Math.max(...allStreaks);
    
    if (currentStreak >= 5) {
        const breakProbability = Math.min(
            0.6 + (currentStreak - 5) * 0.06 + (currentStreak > avgStreak ? 0.1 : 0),
            0.88
        );
        return { 
            pick: lastTx === 'T' ? 'X' : 'T', 
            confidence: breakProbability
        };
    }
    
    // Early streak detection
    if (currentStreak >= 3 && currentStreak > avgStreak * 0.8) {
        return {
            pick: lastTx === 'T' ? 'X' : 'T',
            confidence: 0.58 + (currentStreak - 3) * 0.03
        };
    }
    
    return null;
}

// 6. Frequency Analysis + Entropy Calculation
function algo_FrequencyAnalysis(history) {
    if (history.length < 50) return null;
    
    const recent = history.slice(-60).map(h => h.tx);
    const tCount = recent.filter(tx => tx === 'T').length;
    const xCount = recent.length - tCount;
    
    const tFreq = tCount / recent.length;
    
    // Calculate entropy để đánh giá độ ngẫu nhiên
    const entropy = -(tFreq * Math.log2(tFreq || 0.01) + (1-tFreq) * Math.log2((1-tFreq) || 0.01));
    
    // Low entropy = pattern rõ ràng
    if (entropy < 0.8) {
        if (tFreq > 0.58) return { pick: 'X', confidence: 0.70 };
        if (tFreq < 0.42) return { pick: 'T', confidence: 0.70 };
    }
    
    // High frequency deviation
    if (tFreq > 0.62) return { pick: 'X', confidence: 0.68 };
    if (tFreq < 0.38) return { pick: 'T', confidence: 0.68 };
    
    return null;
}

// 7. MACD Strategy + Signal Line Cross
function algo_MACDStrategy(history) {
    if (history.length < 30) return null;
    
    const macd = calculateMACD(history.map(h => h.tx));
    const prevMACD = calculateMACD(history.slice(0, -1).map(h => h.tx));
    
    // Signal line crossover
    if (macd.signal !== prevMACD.signal && macd.strength > 0.08) {
        return { 
            pick: macd.signal, 
            confidence: Math.min(0.65 + macd.strength * 3, 0.85) 
        };
    }
    
    if (macd.strength > 0.15) {
        return { 
            pick: macd.signal, 
            confidence: Math.min(0.62 + macd.strength * 2.5, 0.82) 
        };
    }
    
    return null;
}

// 8. ⭐ NEURAL NETWORK SIMULATION (Thuật toán VIP mới)
function algo_NeuralNetworkSim(history) {
    if (history.length < 40) return null;
    
    const tx = history.map(h => h.tx);
    const features = [];
    
    // Feature extraction
    for (let i = 10; i < tx.length; i++) {
        const window = tx.slice(i-10, i);
        const tCount = window.filter(x => x === 'T').length;
        const momentum = tCount / 10;
        const volatility = new Set(window).size / 10;
        
        features.push({
            momentum: momentum,
            volatility: volatility,
            result: tx[i]
        });
    }
    
    // Simple weighted prediction
    const recentFeatures = features.slice(-5);
    let tScore = 0, xScore = 0;
    
    recentFeatures.forEach((f, idx) => {
        const weight = (idx + 1) / 15; // Recent data có weight cao hơn
        const score = f.momentum * (1 - f.volatility) * weight;
        
        if (f.result === 'T') tScore += score;
        else xScore += score;
    });
    
    const lastMomentum = recentFeatures[recentFeatures.length - 1].momentum;
    const prediction = lastMomentum > 0.5 ? 'X' : 'T'; // Contrarian
    const confidence = Math.abs(lastMomentum - 0.5) * 1.4 + 0.55;
    
    return {
        pick: prediction,
        confidence: Math.min(confidence, 0.82)
    };
}

// 9. ⭐ FIBONACCI RETRACEMENT (Thuật toán VIP mới)
function algo_FibonacciRetracement(history) {
    if (history.length < 50) return null;
    
    const tx = history.map(h => h.tx);
    const recent = tx.slice(-50);
    
    // Find swing high/low
    const values = recent.map(t => t === 'T' ? 1 : 0);
    const high = Math.max(...values);
    const low = Math.min(...values);
    const range = high - low;
    
    if (range === 0) return null;
    
    const current = values[values.length - 1];
    const fib618 = low + range * 0.618;
    const fib382 = low + range * 0.382;
    
    // Fibonacci levels
    if (current >= fib618) {
        return { pick: 'X', confidence: 0.73 };
    }
    if (current <= fib382) {
        return { pick: 'T', confidence: 0.73 };
    }
    
    return null;
}

// 10. ⭐ MACHINE LEARNING ENSEMBLE (Thuật toán VIP mới)
function algo_MLEnsemble(history) {
    if (history.length < 60) return null;
    
    const tx = history.map(h => h.tx);
    
    // Decision Tree simulation
    const last5 = tx.slice(-5);
    const tCount = last5.filter(x => x === 'T').length;
    
    // Random Forest logic
    let predictions = [];
    
    // Tree 1: Recent bias
    if (tCount >= 4) predictions.push({ pick: 'X', weight: 0.8 });
    else if (tCount <= 1) predictions.push({ pick: 'T', weight: 0.8 });
    
    // Tree 2: Momentum
    const last10 = tx.slice(-10);
    const momentum = last10.filter(x => x === 'T').length / 10;
    if (momentum > 0.65) predictions.push({ pick: 'X', weight: 0.7 });
    else if (momentum < 0.35) predictions.push({ pick: 'T', weight: 0.7 });
    
    // Tree 3: Pattern
    const pattern = last5.join('');
    if (pattern === 'TTTTT' || pattern === 'XXXXX') {
        predictions.push({ 
            pick: pattern[0] === 'T' ? 'X' : 'T', 
            weight: 0.85 
        });
    }
    
    if (predictions.length === 0) return null;
    
    // Ensemble voting
    let tScore = 0, xScore = 0;
    predictions.forEach(p => {
        if (p.pick === 'T') tScore += p.weight;
        else xScore += p.weight;
    });
    
    return {
        pick: tScore > xScore ? 'T' : 'X',
        confidence: Math.min(Math.max(tScore, xScore) / (tScore + xScore), 0.86)
    };
}

// 11. ⭐ CHAOS THEORY ANALYSIS (Thuật toán VIP mới)
function algo_ChaosTheory(history) {
    if (history.length < 70) return null;
    
    const tx = history.map(h => h.tx);
    const recent = tx.slice(-70);
    
    // Calculate Lyapunov exponent (simplified)
    let divergence = 0;
    for (let i = 1; i < 20; i++) {
        const val1 = recent[recent.length - i] === 'T' ? 1 : 0;
        const val2 = recent[recent.length - i - 1] === 'T' ? 1 : 0;
        divergence += Math.abs(val1 - val2);
    }
    
    const chaosLevel = divergence / 20;
    
    // High chaos = ngẫu nhiên cao, dùng probability
    if (chaosLevel > 0.6) {
        const tCount = recent.slice(-30).filter(x => x === 'T').length;
        return {
            pick: tCount > 15 ? 'X' : 'T',
            confidence: 0.68
        };
    }
    
    // Low chaos = pattern rõ, dùng trend
    if (chaosLevel < 0.3) {
        const trend = recent.slice(-15).filter(x => x === 'T').length / 15;
        return {
            pick: trend > 0.6 ? 'T' : 'X',
            confidence: 0.72
        };
    }
    
    return null;
}

// --- LỚP QUẢN LÝ AI TRUNG TÂM (SỬA LỖI TRACKING) ---
class MasterAI {
    constructor() {
        this.history = [];
        this.liveStats = { total: 0, correct: 0, wrong: 0 };
        this.pendingPrediction = null; // Dự đoán đang chờ
        this.isTracking = false; // Đã bắt đầu tracking chưa
        this.lastProcessedSession = null; // Phiên cuối đã xử lý
        
        this.algoWeights = {
            markov: 2.2,
            pattern: 2.0,
            momentum: 1.7,
            meanReversion: 1.9,
            streakBreaker: 1.8,
            frequency: 1.5,
            macd: 1.6,
            neuralNet: 2.1,      // VIP
            fibonacci: 1.7,       // VIP
            mlEnsemble: 2.0,      // VIP
            chaosTheory: 1.8      // VIP
        };
    }

    loadHistory(data) {
        const sortedData = [...data].sort((a, b) => a.session - b.session);
        this.history = sortedData;
        
        if (this.history.length > 0) {
            this.lastProcessedSession = this.history[this.history.length - 1].session;
        }
        
        console.log(`✅ Đã load ${sortedData.length} phiên lịch sử để AI học.`);
    }

    startTracking() {
        if (!this.isTracking) {
            this.isTracking = true;
            console.log(`🟢 BẮT ĐẦU TRACKING - Phiên kế tiếp sẽ được dự đoán và tính thống kê`);
        }
    }

    addNewResult(record) {
        // Kiểm tra trùng
        if (this.history.find(h => h.session === record.session)) {
            return;
        }

        // XỬ LÝ THỐNG KÊ (CHỈ KHI ĐANG TRACKING)
        if (this.isTracking && this.pendingPrediction) {
            // Kiểm tra xem kết quả này có phải là phiên được dự đoán không
            if (this.pendingPrediction.targetSession === record.session) {
                this.liveStats.total++;
                
                if (this.pendingPrediction.pick === record.tx) {
                    this.liveStats.correct++;
                    console.log(`✅ ĐÚNG #${this.liveStats.total}: Phiên ${record.session} | Dự đoán: ${this.pendingPrediction.pick} = Kết quả: ${record.tx} | Tỷ lệ: ${this.getWinRate()}`);
                } else {
                    this.liveStats.wrong++;
                    console.log(`❌ SAI #${this.liveStats.total}: Phiên ${record.session} | Dự đoán: ${this.pendingPrediction.pick} ≠ Kết quả: ${record.tx} | Tỷ lệ: ${this.getWinRate()}`);
                }
                
                // Clear prediction đã xử lý
                this.pendingPrediction = null;
            }
        }

        // Thêm vào history để AI học
        this.history.push(record);
        if (this.history.length > 200) {
            this.history = this.history.slice(-200);
        }
        
        this.lastProcessedSession = record.session;
    }

    makePrediction() {
        if (this.history.length < 20) {
            return { 
                prediction: 'Đang học',
                rawPrediction: null,
                pattern: '',
                bridgeType: 'Chưa đủ dữ liệu',
                confidence: 0
            };
        }

        const votes = { T: 0, X: 0 };
        const algoResults = [];
        
        // Chạy tất cả thuật toán
        const markov = algo_MarkovChainAdvanced(this.history);
        if (markov) {
            votes[markov.pick] += this.algoWeights.markov * markov.confidence;
            algoResults.push({ name: 'Markov', pick: markov.pick, conf: markov.confidence });
        }

        const pattern = algo_PatternRecognition(this.history);
        if (pattern) {
            votes[pattern.pick] += this.algoWeights.pattern * pattern.confidence;
            algoResults.push({ name: 'Pattern', pick: pattern.pick, conf: pattern.confidence });
        }

        const momentum = algo_Momentum(this.history);
        if (momentum) {
            votes[momentum.pick] += this.algoWeights.momentum * momentum.confidence;
            algoResults.push({ name: 'Momentum', pick: momentum.pick, conf: momentum.confidence });
        }

        const meanRev = algo_MeanReversion(this.history);
        if (meanRev) {
            votes[meanRev.pick] += this.algoWeights.meanReversion * meanRev.confidence;
            algoResults.push({ name: 'MeanRev', pick: meanRev.pick, conf: meanRev.confidence });
        }

        const streak = algo_StreakBreaker(this.history);
        if (streak) {
            votes[streak.pick] += this.algoWeights.streakBreaker * streak.confidence;
            algoResults.push({ name: 'Streak', pick: streak.pick, conf: streak.confidence });
        }

        const freq = algo_FrequencyAnalysis(this.history);
        if (freq) {
            votes[freq.pick] += this.algoWeights.frequency * freq.confidence;
            algoResults.push({ name: 'Frequency', pick: freq.pick, conf: freq.confidence });
        }

        const macd = algo_MACDStrategy(this.history);
        if (macd) {
            votes[macd.pick] += this.algoWeights.macd * macd.confidence;
            algoResults.push({ name: 'MACD', pick: macd.pick, conf: macd.confidence });
        }

        // ⭐ THUẬT TOÁN VIP
        const neuralNet = algo_NeuralNetworkSim(this.history);
        if (neuralNet) {
            votes[neuralNet.pick] += this.algoWeights.neuralNet * neuralNet.confidence;
            algoResults.push({ name: 'NeuralNet', pick: neuralNet.pick, conf: neuralNet.confidence });
        }

        const fibonacci = algo_FibonacciRetracement(this.history);
        if (fibonacci) {
            votes[fibonacci.pick] += this.algoWeights.fibonacci * fibonacci.confidence;
            algoResults.push({ name: 'Fibonacci', pick: fibonacci.pick, conf: fibonacci.confidence });
        }

        const mlEnsemble = algo_MLEnsemble(this.history);
        if (mlEnsemble) {
            votes[mlEnsemble.pick] += this.algoWeights.mlEnsemble * mlEnsemble.confidence;
            algoResults.push({ name: 'MLEnsemble', pick: mlEnsemble.pick, conf: mlEnsemble.confidence });
        }

        const chaosTheory = algo_ChaosTheory(this.history);
        if (chaosTheory) {
            votes[chaosTheory.pick] += this.algoWeights.chaosTheory * chaosTheory.confidence;
            algoResults.push({ name: 'ChaosTheory', pick: chaosTheory.pick, conf: chaosTheory.confidence });
        }

        // Tính toán kết quả cuối
        let finalPick = null;
        const totalVotes = votes.T + votes.X;
        
        if (totalVotes === 0) {
            const rsi = calculateRSI(this.history.map(h => h.tx));
            finalPick = rsi > 50 ? 'X' : 'T';
        } else {
            finalPick = votes.T > votes.X ? 'T' : 'X';
        }

        const confidence = totalVotes > 0 ? (Math.max(votes.T, votes.X) / totalVotes) : 0.5;
        const patternStr = this.history.slice(-10).map(h => h.tx).join('');
        const bridgeType = this.detectBridgeType();
        const nextSession = this.lastProcessedSession + 1;

        // LƯU DỰ ĐOÁN CHỜ XỬ LÝ (CHỈ KHI ĐANG TRACKING)
        if (this.isTracking) {
            this.pendingPrediction = {
                targetSession: nextSession,
                pick: finalPick,
                confidence: confidence
            };
            console.log(`🎯 Dự đoán phiên ${nextSession}: ${finalPick === 'T' ? 'TÀI' : 'XỈU'} (Độ tin cậy: ${(confidence * 100).toFixed(1)}%)`);
            console.log(`   📊 Thuật toán tham gia: ${algoResults.map(a => `${a.name}(${a.pick})`).join(', ')}`);
        }

        return {
            prediction: finalPick === 'T' ? 'Tài' : 'Xỉu',
            rawPrediction: finalPick,
            pattern: patternStr,
            bridgeType: bridgeType,
            confidence: (confidence * 100).toFixed(1),
            algorithms: algoResults
        };
    }

    detectBridgeType() {
        const txStr = this.history.map(h => h.tx).slice(-20).join('').toLowerCase();
        
        for (const [name, patterns] of Object.entries(PATTERN_DATABASE)) {
            for (const pattern of patterns) {
                if (txStr.includes(pattern) && pattern.length >= 4) {
                    return name;
                }
            }
        }
        
        return "Cầu Tự Do";
    }

    getWinRate() {
        if (this.liveStats.total === 0) return "0%";
        return ((this.liveStats.correct / this.liveStats.total) * 100).toFixed(1) + "%";
    }

    getStatus() {
        if (!this.isTracking) return "Chờ kích hoạt";
        if (this.liveStats.total === 0) return "Đã kích hoạt - chờ kết quả";
        return "Đang hoạt động";
    }

    getDetailedStats() {
        return {
            status: this.getStatus(),
            tracking: this.isTracking,
            total_predictions: this.liveStats.total,
            correct: this.liveStats.correct,
            wrong: this.liveStats.wrong,
            win_rate: this.getWinRate(),
            history_size: this.history.length,
            last_session: this.lastProcessedSession,
            next_prediction: this.pendingPrediction ? this.pendingPrediction.targetSession : null
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

    // KÍCH HOẠT TRACKING KHI API ĐƯỢC GỌI LẦN ĐẦU
    if (!ai.isTracking) {
        ai.startTracking();
    }

    const lastRes = rikResults[0];
    const prediction = ai.makePrediction();

    return {
        id: "@minhsangdangcap",
        status: "success",
        phien_truoc: {
            session: lastRes.session,
            ket_qua: lastRes.result,
            xuc_xac: lastRes.dice,
            tong: lastRes.total
        },
        phien_hien_tai: lastRes.session + 1,
        du_doan: {
            ket_qua: prediction.prediction,
            raw: prediction.rawPrediction,
            do_tin_cay: prediction.confidence + "%",
            pattern: prediction.pattern,
            loai_cau: prediction.bridgeType
        },
        thong_ke: ai.getDetailedStats(),
        debug: {
            algorithms_used: prediction.algorithms ? prediction.algorithms.length : 0,
            algo_details: prediction.algorithms
        }
    };
});

app.get("/health", async (request, reply) => {
    return {
        status: "OK",
        uptime: process.uptime(),
        websocket: rikWS?.readyState === WebSocket.OPEN ? "Connected" : "Disconnected",
        ai_tracking: ai.isTracking,
        predictions_made: ai.liveStats.total,
        win_rate: ai.getWinRate(),
        history_loaded: ai.history.length,
        pending_prediction: ai.pendingPrediction !== null
    };
});

app.get("/stats", async (request, reply) => {
    return {
        statistics: ai.getDetailedStats(),
        recent_results: rikResults.slice(0, 10).map(r => ({
            session: r.session,
            result: r.result,
            dice: r.dice,
            total: r.total
        }))
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

        // Load lịch sử ban đầu
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
            
            console.log(`✅ Lịch sử đã load. Gọi API /sunwinsew để bắt đầu dự đoán!`);
        }

        // Kết quả mới realtime
        else if (Array.isArray(json) && json[1] && json[1].sid && json[1].d1) {
            const newRecord = {
                session: json[1].sid,
                dice: [json[1].d1, json[1].d2, json[1].d3],
                total: json[1].d1 + json[1].d2 + json[1].d3,
                result: (json[1].d1 + json[1].d2 + json[1].d3) >= 11 ? 'Tài' : 'Xỉu',
                tx: (json[1].d1 + json[1].d2 + json[1].d3) >= 11 ? 'T' : 'X'
            };
            
            console.log(`🎲 Phiên ${newRecord.session}: ${newRecord.result} [${newRecord.dice.join('-')}] Tổng: ${newRecord.total}`);
            
            ai.addNewResult(newRecord);
            
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
    console.log(`
╔════════════════════════════════════════════════╗
║   🚀 SUNWIN AI PREDICTOR - ENHANCED VERSION   ║
╠════════════════════════════════════════════════╣
║  Server: ${address.padEnd(38)}║
║  API: ${(address + '/sunwinsew').padEnd(42)}║
║  Stats: ${(address + '/stats').padEnd(40)}║
║  Health: ${(address + '/health').padEnd(39)}║
╠════════════════════════════════════════════════╣
║  ⭐ 11 Thuật toán AI tiên tiến                 ║
║  ✅ Thống kê realtime chính xác               ║
║  🎯 Tracking bắt đầu khi gọi API              ║
╚════════════════════════════════════════════════╝
    `);
    console.log(`⏳ Đang kết nối WebSocket và tải dữ liệu...`);
    connectWebSocket();
});
