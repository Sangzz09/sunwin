import fastify from "fastify";
import cors from "@fastify/cors";
import WebSocket from "ws";

// --- CẤU HÌNH ---
const PORT = process.env.PORT || 3000;
// ⚠️ LƯU Ý: Token này thường xuyên thay đổi. Hãy cập nhật Token mới nhất từ F12 -> Network -> WS
const WS_URL = "wss://websocket.azhkthg1.net/websocket?token=";
const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJzYW5nZGVwemFpMDlubyIsImJvdCI6MCwiaXNNZXJjaGFudCI6ZmFsc2UsInZlcmlmaWVkQmFua0FjY291bnQiOnRydWUsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MjIxNjQwNjcyLCJhZmZJZCI6IlN1bndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoic3VuLndpbiIsInRpbWVzdGFtcCI6MTc2NTk3NzcyMTIxNywibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOnRydWUsImlwQWRkcmVzcyI6IjExMy4xNzQuNzguMjU1IiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8xNS5wbmciLCJwbGF0Zm9ybUlkIjo0LCJ1c2VySWQiOiI3ODRmNGU0Mi1iZWExLTRiZTUtYjgwNS03MmJlZjY5N2UwMTIiLCJyZWdUaW1lIjoxNzQyMjMyMzQ1MTkxLCJwaG9uZSI6Ijg0ODg2MDI3NzY3IiwiZGVwb3NpdCI6dHJ1ZSwidXNlcm5hbWUiOiJTQ19tc2FuZ3p6MDkifQ.MEBZeCrzVNik8H9qEtt4jyvnwaQyT2iKeWAlEJRQnws"; 

// --- STATE QUẢN LÝ ---
let rikResults = [];
let rikCurrentSession = null;
let rikWS = null;
let rikIntervalCmd = null;
let connectionMonitor = null; // Theo dõi kết nối treo
let lastMessageTime = Date.now();
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 20;

// --- CƠ SỞ DỮ LIỆU CẦU (PATTERN) ---
const PATTERN_DATABASE = {
    'Cầu Bệt': ['ttttt', 'xxxxx', 'tttt', 'xxxx'],
    'Cầu 1-1': ['txtx', 'xtxt', 'txtxt', 'xtxtx'],
    'Cầu 2-2': ['ttxx', 'xxtt', 'ttxxtt', 'xxttxx'],
    'Cầu 1-2-3': ['txxttt', 'xttxxx'],
    'Cầu 3-2-1': ['tttxtx', 'xxxtxt'],
    'Cầu Đối Xứng': ['ttxtt', 'xxtxx', 'txtxt', 'xtxtx'],
    'Cầu Nghiêng': ['tttxttt', 'xxxtxxx'] // Nghiêng hẳn về 1 bên
};

// --- CÁC HÀM TOÁN HỌC ---
const calculateRSI = (txArray) => {
    if (txArray.length < 10) return 50;
    let gains = 0, losses = 0;
    for (let i = 1; i < txArray.length; i++) {
        // T=1, X=0 (Ví dụ để tính lực mua bán giả định)
        const current = txArray[i] === 'T' ? 1 : 0;
        const prev = txArray[i-1] === 'T' ? 1 : 0;
        if (current > prev) gains += current - prev;
        else if (current < prev) losses += prev - current;
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
};

// --- CORE AI & THUẬT TOÁN ---

// 1. Markov Chain: Tính xác suất dựa trên bước chuyển trước đó
function algo_MarkovChain(history) {
    if (history.length < 20) return null;
    const tx = history.map(h => h.tx);
    const last = tx[tx.length - 1];
    
    // Đếm số lần chuyển đổi từ trạng thái cuối cùng
    let tCount = 0; // Last -> T
    let xCount = 0; // Last -> X
    
    for (let i = 0; i < tx.length - 1; i++) {
        if (tx[i] === last) {
            if (tx[i+1] === 'T') tCount++;
            else xCount++;
        }
    }
    
    const total = tCount + xCount;
    if (total === 0) return null;
    
    const pT = tCount / total;
    if (pT > 0.6) return 'T';
    if (pT < 0.4) return 'X';
    return null; // Không chắc chắn
}

// 2. Pattern Matching Nâng cao (Trọng số theo độ dài)
function algo_PatternV2(history) {
    const txStr = history.map(h => h.tx).slice(-15).join('').toLowerCase();
    let bestMatch = null;
    let maxLen = 0;

    for (const [type, patterns] of Object.entries(PATTERN_DATABASE)) {
        for (const p of patterns) {
            if (txStr.endsWith(p)) {
                if (p.length > maxLen) {
                    maxLen = p.length;
                    // Logic đảo cầu: Nếu cầu đã dài (ví dụ bệt 5), xu hướng gãy cao
                    if (type === 'Cầu Bệt' && p.length >= 5) {
                         // Đánh ngược lại
                         bestMatch = p.endsWith('t') ? 'X' : 'T'; 
                    } else {
                        // Đánh theo cầu (ví dụ 2-2 đang là tt -> xx)
                        // Cần logic dự đoán ký tự tiếp theo của pattern
                        // Ở đây đơn giản hóa: trả về null để các algo khác quyết định
                        // hoặc hardcode logic tiếp theo.
                        // Để an toàn, Pattern Matching chỉ detect loại cầu, 
                        // việc predict để algo Markov lo.
                    }
                }
            }
        }
    }
    return bestMatch;
}

// 3. Adaptive Trend (Xu hướng thích ứng)
function algo_AdaptiveTrend(history) {
    const recent = history.slice(-20);
    const tCount = recent.filter(r => r.tx === 'T').length;
    // Nếu T đang chiếm ưu thế lớn (>70%) -> Cầu nghiêng T
    if (tCount >= 14) return 'T';
    if (tCount <= 6) return 'X';
    return null;
}

// --- LỚP QUẢN LÝ AI TRUNG TÂM ---
class MasterAI {
    constructor() {
        this.history = [];
        this.stats = { total: 0, correct: 0, wrong: 0, waiting: 0 };
        this.predictionsLog = []; // Lưu lịch sử dự đoán để đối chiếu
        this.algoWeights = {
            markov: 1.5,
            trend: 1.0,
            pattern: 1.2
        };
    }

    // Nạp lịch sử và chạy Backtest (Chạy lại quá khứ để tính thống kê ngay lập tức)
    loadHistory(data) {
        this.history = [];
        this.stats = { total: 0, correct: 0, wrong: 0, waiting: 0 }; // Reset stats
        
        // Sắp xếp theo session tăng dần để mô phỏng thời gian thực
        const sortedData = [...data].sort((a, b) => a.session - b.session);

        // Chạy lại từng phiên như thể đang live
        sortedData.forEach(record => {
            // 1. Dự đoán dựa trên history hiện tại (trước khi thêm record mới)
            if (this.history.length >= 10) {
                const pred = this.predict();
                // 2. Đối chiếu kết quả thực tế
                if (pred.rawPrediction) {
                    this.stats.total++;
                    if (pred.rawPrediction === record.tx) {
                        this.stats.correct++;
                    } else {
                        this.stats.wrong++;
                    }
                }
            }
            // 3. Thêm record vào history để dùng cho phiên sau
            this.history.push(record);
        });
        
        // Cắt bớt nếu quá dài
        if (this.history.length > 200) this.history = this.history.slice(-200);
        
        console.log(`✅ Đã Backtest ${sortedData.length} phiên. Tỷ lệ đúng: ${this.getRate()}`);
    }

    addResult(record) {
        // Kiểm tra trùng lặp
        if (this.history.find(h => h.session === record.session)) return;

        // Trước khi thêm, kiểm tra dự đoán của phiên trước (nếu có)
        const lastPred = this.predictionsLog.find(p => p.session === record.session);
        if (lastPred) {
            this.stats.total++;
            if (lastPred.pick === record.tx) {
                this.stats.correct++;
                console.log(`🎉 CHÍNH XÁC: Phiên ${record.session} ra ${record.tx}`);
            } else {
                this.stats.wrong++;
                console.log(`❌ SAI: Phiên ${record.session} ra ${record.tx}, Dự đoán ${lastPred.pick}`);
            }
        }

        this.history.push(record);
        if (this.history.length > 200) this.history = this.history.slice(-200);
    }

    // Hàm dự đoán chính
    predict() {
        if (this.history.length < 5) return { prediction: 'đang học...', confidence: 0 };

        const votes = { T: 0, X: 0 };
        
        // 1. Markov Vote
        const markovPick = algo_MarkovChain(this.history);
        if (markovPick) votes[markovPick] += this.algoWeights.markov;

        // 2. Trend Vote
        const trendPick = algo_AdaptiveTrend(this.history);
        if (trendPick) votes[trendPick] += this.algoWeights.trend;

        // 3. Pattern Vote (Special)
        const patternPick = algo_PatternV2(this.history);
        if (patternPick) votes[patternPick] += this.algoWeights.pattern;

        // Quyết định cuối cùng
        let finalPick = null;
        let confidence = 0;
        
        if (votes.T > votes.X) {
            finalPick = 'T';
            confidence = (votes.T / (votes.T + votes.X)) * 100;
        } else if (votes.X > votes.T) {
            finalPick = 'X';
            confidence = (votes.X / (votes.T + votes.X)) * 100;
        } else {
            // Nếu hòa, dùng RSI để quyết định
            const rsi = calculateRSI(this.history.map(h => h.tx));
            finalPick = rsi > 50 ? 'X' : 'T'; // RSI cao quá mua -> Đánh Xỉu
            confidence = 55;
        }

        const type = this.detectBridgeType();

        // Lưu dự đoán cho phiên tiếp theo (Session hiện tại + 1)
        const currentSession = this.history[this.history.length - 1].session;
        this.predictionsLog = this.predictionsLog.filter(p => p.session > currentSession); // Clean old
        this.predictionsLog.push({ session: currentSession + 1, pick: finalPick });

        return {
            prediction: finalPick === 'T' ? 'tài' : 'xỉu',
            rawPrediction: finalPick,
            confidence: confidence.toFixed(1),
            bridgeType: type
        };
    }

    detectBridgeType() {
        const txStr = this.history.map(h => h.tx).slice(-10).join('').toLowerCase();
        for (const [name, patterns] of Object.entries(PATTERN_DATABASE)) {
            if (patterns.some(p => txStr.endsWith(p))) return name;
        }
        return "Cầu Tự Do";
    }

    getRate() {
        if (this.stats.total === 0) return "0%";
        return ((this.stats.correct / this.stats.total) * 100).toFixed(1) + "%";
    }
}

const ai = new MasterAI();

// --- SERVER SETUP ---
const app = fastify();
app.register(cors, { origin: "*" });

app.get("/sunwinsew", async (request, reply) => {
    if (rikResults.length === 0) return { status: "loading", message: "Đang kết nối WebSocket..." };

    const lastRes = rikResults[0];
    const prediction = ai.predict();

    return {
        id: "@minhsangdangcap",
        phien_hien_tai: lastRes.session,
        ket_qua: lastRes.result.toLowerCase(), // tai/xiu
        xuc_xac: lastRes.dice,
        phien_du_doan: lastRes.session + 1,
        du_doan: prediction.prediction,
        loai_cau: prediction.bridgeType,
        thong_ke: {
            so_lan_du_doan: ai.stats.total,
            so_dung: ai.stats.correct,
            so_sai: ai.stats.wrong,
            ti_le_dung: ai.getRate()
        }
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
    
    // Cleanup cũ
    if (rikWS) { try { rikWS.terminate(); } catch(e){} }
    clearInterval(rikIntervalCmd);
    clearInterval(connectionMonitor);

    rikWS = new WebSocket(`${WS_URL}${TOKEN}`, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Origin": "https://web.sunwin.win"
        }
    });

    rikWS.on("open", () => {
        console.log("✅ WebSocket Connected!");
        reconnectAttempts = 0;
        lastMessageTime = Date.now();

        // Login Packet (Cần thiết để server trả data)
        rikWS.send(JSON.stringify([1, "MiniGame", "SC_giathinh2133", "thinh211", {
             info: JSON.stringify({
                ipAddress: "127.0.0.1", // IP Fake để tránh lộ IP thật server
                wsToken: TOKEN,
                userId: "cdbaf598-e4ef-47f8-b4a6-a4881098db86",
                username: "User_Bot_AI",
                timestamp: Date.now()
             }),
             signature: "dummy_signature",
             pid: 5, subi: true
        }]));

        // Keep-Alive Loop (Ping 1005)
        rikIntervalCmd = setInterval(() => {
            if(rikWS.readyState === WebSocket.OPEN) {
                rikWS.send(JSON.stringify([6, "MiniGame", "taixiuPlugin", { cmd: 1005 }]));
            }
        }, 5000);

        // Heartbeat Monitor: Nếu 30s không nhận data -> Reconnect
        connectionMonitor = setInterval(() => {
            if (Date.now() - lastMessageTime > 30000) {
                console.warn("⚠️ Không nhận được dữ liệu quá 30s. Reconnecting...");
                connectWebSocket();
            }
        }, 10000);
    });

    rikWS.on("message", (data) => {
        lastMessageTime = Date.now(); // Cập nhật thời gian nhận tin cuối
        
        let json = decodeBinary(data);
        if (!json) {
            try { json = JSON.parse(data); } catch(e) { return; }
        }
        if (!json) return;

        // XỬ LÝ LỊCH SỬ (Load lần đầu)
        if (Array.isArray(json) && json[1] && json[1].htr) {
            console.log("📥 Đang tải lịch sử...");
            const historyData = json[1].htr.map(i => ({
                session: i.sid,
                dice: [i.d1, i.d2, i.d3],
                total: i.d1 + i.d2 + i.d3,
                result: (i.d1 + i.d2 + i.d3) >= 11 ? 'Tai' : 'Xiu',
                tx: (i.d1 + i.d2 + i.d3) >= 11 ? 'T' : 'X'
            }));
            
            // Sync AI & Data
            ai.loadHistory(historyData);
            rikResults = [...historyData].reverse();
        }

        // XỬ LÝ KẾT QUẢ MỚI (Realtime)
        else if (json.session && json.dice) {
            const total = json.dice.reduce((a,b)=>a+b,0);
            const record = {
                session: json.session,
                dice: json.dice,
                total: total,
                result: total >= 11 ? 'Tai' : 'Xiu',
                tx: total >= 11 ? 'T' : 'X'
            };

            // Cập nhật mảng hiển thị
            if (!rikResults.some(r => r.session === record.session)) {
                rikResults.unshift(record);
                if (rikResults.length > 50) rikResults.pop();
                
                // Cập nhật AI
                ai.addResult(record);
                
                // Log ra console
                const pred = ai.predict();
                console.log(`🎰 Phiên ${record.session}: ${record.result} | Tiếp theo: ${pred.prediction.toUpperCase()} | ${ai.getRate()}`);
            }
        }
    });

    rikWS.on("error", (err) => console.error("❌ WS Error:", err.message));
    
    rikWS.on("close", () => {
        console.log("⚠️ WS Closed. Reconnecting...");
        reconnectAttempts++;
        setTimeout(connectWebSocket, 3000);
    });
}

// Start
const start = async () => {
    try {
        await app.listen({ port: PORT, host: '0.0.0.0' });
        console.log(`🚀 Server AI running at http://localhost:${PORT}`);
        connectWebSocket();
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

start();
