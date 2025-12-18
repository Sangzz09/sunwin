/**
 * 🚀 SUNWIN AI PREDICTOR - ULTIMATE VIP EDITION
 * @author: @minhsangdangcap
 * @description: Hệ thống dự đoán Tài Xỉu tích hợp đa thuật toán & Quản lý kết nối bền bỉ
 */

import fastify from "fastify";
import cors from "@fastify/cors";
import WebSocket from "ws";
import { TextDecoder } from "util";

// --- CẤU HÌNH HỆ THỐNG ---
const CONFIG = {
    PORT: process.env.PORT || 3000,
    WS_URL: "wss://websocket.azhkthg1.net/websocket?token=",
    // ⚠️ Hãy thay Token mới nhất tại đây
    TOKEN: "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJzYW5nZGVwemFpMDlubyIsImJvdCI6MCwiaXNNZXJjaGFudCI6ZmFsc2UsInZlcmlmaWVkQmFua0FjY291bnQiOnRydWUsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MjIxNjQwNjcyLCJhZmZJZCI6IlN1bndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoic3VuLndpbiIsInRpbWVzdGFtcCI6MTc2NTk3NzcyMTIxNywibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOnRydWUsImlwQWRkcmVzcyI6IjExMy4xNzQuNzguMjU1IiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8xNS5wbmciLCJwbGF0Zm9ybUlkIjo0LCJ1c2VySWQiOiI3ODRmNGU0Mi1iZWExLTRiZTUtYjgwNS03MmJlZjY5N2UwMTIiLCJyZWdUaW1lIjoxNzQyMjMyMzQ1MTkxLCJwaG9uZSI6Ijg0ODg2MDI3NzY3IiwiZGVwb3NpdCI6dHJ1ZSwidXNlcm5hbWUiOiJTQ19tc2FuZ3p6MDkifQ.MEBZeCrzVNik8H9qEtt4jyvnwaQyT2iKeWAlEJRQnws",
    RECONNECT_INTERVAL: 5000,
    HEARTBEAT_TIMEOUT: 35000,
    MAX_HISTORY: 200,
};

// --- HỆ THỐNG AI TRUNG TÂM (VIP CORE) ---
class MasterAI {
    constructor() {
        this.history = []; // Chuỗi kết quả 'T', 'X'
        this.records = []; // Lưu trữ Object đầy đủ thông tin phiên
        this.predictions = new Map(); // Lưu dự đoán: session -> dự đoán
        this.stats = { total: 0, correct: 0, wrong: 0, win_streak: 0, max_streak: 0 };
        
        // Trọng số thuật toán (Dynamic Weights)
        this.weights = {
            markov: 1.5,
            pattern: 2.0, // Pattern có độ ưu tiên cao nhất
            bayesian: 1.2,
            rsi: 0.8,
            monteCarlo: 1.0
        };
    }

    // 1. Markov Chain Bậc 3 (Dựa trên 3 kết quả gần nhất để đoán kết quả thứ 4)
    algo_Markov() {
        if (this.history.length < 20) return null;
        const lastThree = this.history.slice(-3).join('');
        let counts = { T: 0, X: 0 };

        for (let i = 0; i < this.history.length - 4; i++) {
            if (this.history.slice(i, i + 3).join('') === lastThree) {
                this.history[i + 3] === 'T' ? counts.T++ : counts.X++;
            }
        }
        if (counts.T === counts.X) return null;
        return counts.T > counts.X ? 'T' : 'X';
    }

    // 2. Pattern Matching Vip (Nhận diện các loại cầu kinh điển)
    algo_Pattern() {
        const s = this.history.slice(-12).join('').toLowerCase();
        // Cầu bệt (Long Streak)
        if (s.endsWith('ttttt') || s.endsWith('xxxxx')) return s.endsWith('t') ? 'X' : 'T'; // Đánh bẻ bệt
        // Cầu 1-1
        if (s.endsWith('txtxt') || s.endsWith('xtxtx')) return s.endsWith('t') ? 'X' : 'T';
        // Cầu 2-2
        if (s.endsWith('ttxx') || s.endsWith('xxtt')) return s.endsWith('t') ? 'T' : 'X';
        // Cầu 3-1
        if (s.endsWith('tttx')) return 'T';
        if (s.endsWith('xxxt')) return 'X';
        
        return null;
    }

    // 3. Bayesian Inference (Xác suất có điều kiện)
    algo_Bayesian() {
        if (this.history.length < 15) return null;
        const recent = this.history.slice(-15);
        const tCount = recent.filter(x => x === 'T').length;
        // P(Tai) = countT / total
        return tCount > (recent.length / 2) ? 'T' : 'X';
    }

    // 4. Relative Strength Index (RSI - Chỉ số sức mạnh tương đối)
    algo_RSI() {
        if (this.history.length < 14) return 50;
        const recent = this.history.slice(-14);
        let up = 0, down = 0;
        for (let i = 1; i < recent.length; i++) {
            const val = recent[i] === 'T' ? 1 : 0;
            const prev = recent[i-1] === 'T' ? 1 : 0;
            if (val > prev) up++; else if (val < prev) down++;
        }
        const rs = up / (down || 1);
        const rsi = 100 - (100 / (1 + rs));
        if (rsi > 70) return 'X'; // Quá Tài -> Đánh Xỉu
        if (rsi < 30) return 'T'; // Quá Xỉu -> Đánh Tài
        return null;
    }

    // Cập nhật kết quả & Đối chiếu dự đoán (Chỉ tính khi treo Live)
    addResult(session, dice, tx) {
        // Kiểm tra xem bot đã dự đoán cho phiên này chưa
        if (this.predictions.has(session)) {
            const predicted = this.predictions.get(session);
            this.stats.total++;
            if (predicted === tx) {
                this.stats.correct++;
                this.stats.win_streak++;
                if (this.stats.win_streak > this.stats.max_streak) this.stats.max_streak = this.stats.win_streak;
                console.log(`[PROFIT] Phiên ${session} ✅ THẮNG. Chuỗi: ${this.stats.win_streak}`);
            } else {
                this.stats.wrong++;
                this.stats.win_streak = 0;
                console.log(`[LOSS] Phiên ${session} ❌ THUA. Dự đoán: ${predicted}, Ra: ${tx}`);
            }
            this.predictions.delete(session);
        }

        // Cập nhật dữ liệu
        this.history.push(tx);
        this.records.unshift({ session, dice, tx });
        
        if (this.history.length > CONFIG.MAX_HISTORY) {
            this.history.shift();
            this.records.pop();
        }
    }

    // Tổng hợp phiếu bầu từ các thuật toán
    getPrediction(nextSession) {
        if (this.history.length < 10) return { pick: "đang học cầu...", confidence: 0 };

        const votes = { T: 0, X: 0 };
        const results = {
            m: this.algo_Markov(),
            p: this.algo_Pattern(),
            b: this.algo_Bayesian(),
            r: this.algo_RSI()
        };

        if (results.m) votes[results.m] += this.weights.markov;
        if (results.p) votes[results.p] += this.weights.pattern;
        if (results.b) votes[results.b] += this.weights.bayesian;
        if (results.r) votes[results.r] += this.weights.rsi;

        const final = votes.T > votes.X ? 'T' : (votes.X > votes.T ? 'X' : (Math.random() > 0.5 ? 'T' : 'X'));
        const totalWeight = votes.T + votes.X || 1;
        const confidence = ((votes[final] / totalWeight) * 100).toFixed(1);

        // Lưu vào nhật ký dự đoán để đối chiếu kết quả sau này
        this.predictions.set(nextSession, final);

        return {
            pick: final === 'T' ? 'Tài' : 'Xỉu',
            raw: final,
            confidence: confidence,
            details: results
        };
    }

    getWinRate() {
        if (this.stats.total === 0) return "0.0%";
        return ((this.stats.correct / this.stats.total) * 100).toFixed(1) + "%";
    }
}

const AI = new MasterAI();

// --- QUẢN LÝ KẾT NỐI WEBSOCKET ---
let ws = null;
let pingInterval = null;
let monitorInterval = null;
let lastUpdate = Date.now();

function decodeMessage(data) {
    try {
        const decoder = new TextDecoder("utf-8");
        const str = decoder.decode(data);
        if (str.startsWith("[")) return JSON.parse(str);
        return JSON.parse(str);
    } catch (e) { return null; }
}

function initWebSocket() {
    console.log("-----------------------------------------");
    console.log("🌐 Đang kết nối tới máy chủ Sunwin...");
    
    if (ws) {
        ws.terminate();
        clearInterval(pingInterval);
        clearInterval(monitorInterval);
    }

    ws = new WebSocket(`${CONFIG.WS_URL}${CONFIG.TOKEN}`, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Origin": "https://web.sunwin.win"
        }
    });

    ws.on("open", () => {
        console.log("✅ Kết nối thành công. Đang đăng ký nhận dữ liệu...");
        
        // Gửi gói tin đăng ký (Subscribe) - Đây là gói tin mẫu, cần khớp với protocol của game
        ws.send(JSON.stringify([1, "MiniGame", "SC_sangdz", "user_auth", {
            info: JSON.stringify({ userId: "784f4e42", username: "SC_msangzz", timestamp: Date.now() }),
            pid: 5, subi: true
        }]));

        // Cơ chế Ping duy trì kết nối (Cmd 1005)
        pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify([6, "MiniGame", "taixiuPlugin", { cmd: 1005 }]));
            }
        }, 5000);

        // Theo dõi trạng thái treo (Heartbeat)
        monitorInterval = setInterval(() => {
            if (Date.now() - lastUpdate > CONFIG.HEARTBEAT_TIMEOUT) {
                console.warn("⚠️ WebSocket treo quá lâu. Đang tái khởi động...");
                initWebSocket();
            }
        }, 10000);
    });

    ws.on("message", (data) => {
        lastUpdate = Date.now();
        const msg = decodeMessage(data);
        if (!msg) return;

        // 1. Xử lý lịch sử nạp ban đầu (Htr)
        if (Array.isArray(msg) && msg[1]?.htr) {
            console.log(`📥 Đã nhận lịch sử (${msg[1].htr.length} phiên).`);
            msg[1].htr.reverse().forEach(i => {
                const total = i.d1 + i.d2 + i.d3;
                const tx = total >= 11 ? 'T' : 'X';
                // Chỉ nạp history, không tính vào stats
                if (!AI.records.some(r => r.session === i.sid)) {
                    AI.history.push(tx);
                    AI.records.unshift({ session: i.sid, dice: [i.d1, i.d2, i.d3], tx });
                }
            });
            // Ngay sau khi load xong lịch sử, thực hiện dự đoán cho phiên sắp tới
            if (AI.records.length > 0) {
                const pred = AI.getPrediction(AI.records[0].session + 1);
                console.log(`🔮 Dự đoán tiếp theo: ${pred.pick.toUpperCase()} (${pred.confidence}%)`);
            }
        }

        // 2. Xử lý kết quả trả về thời gian thực
        if (msg.session && msg.dice) {
            const total = msg.dice.reduce((a, b) => a + b, 0);
            const tx = total >= 11 ? 'T' : 'X';
            
            // Tránh xử lý trùng phiên
            if (AI.records.length === 0 || msg.session > AI.records[0].session) {
                AI.addResult(msg.session, msg.dice, tx);
                
                // Chuẩn bị dự đoán cho phiên mới
                const nextSession = msg.session + 1;
                const prediction = AI.getPrediction(nextSession);
                
                console.log(`🎰 Phiên ${msg.session} ra: ${tx} | WR: ${AI.getWinRate()} | Next: ${prediction.pick.toUpperCase()}`);
            }
        }
    });

    ws.on("close", () => {
        console.log("❌ WebSocket đã đóng. Đang thử lại...");
        setTimeout(initWebSocket, CONFIG.RECONNECT_INTERVAL);
    });

    ws.on("error", (e) => {
        console.error("🚫 Lỗi kết nối:", e.message);
    });
}

// --- SERVER FASTIFY (API GIAO DIỆN) ---
const fastifyApp = fastify();
fastifyApp.register(cors, { origin: "*" });

fastifyApp.get("/api/data", async (req, reply) => {
    if (AI.records.length === 0) return { status: "loading", msg: "Đang chờ dữ liệu từ WebSocket..." };

    const lastRes = AI.records[0];
    const nextPred = AI.getPrediction(lastRes.session + 1);

    return {
        id: "@minhsangdangcap",
        live: {
            current_session: lastRes.session,
            last_result: lastRes.tx === 'T' ? 'tài' : 'xỉu',
            dice: lastRes.dice,
        },
        prediction: {
            target_session: nextPred.session,
            pick: nextPred.pick,
            confidence: nextPred.confidence + "%",
        },
        stats: {
            total_predictions: AI.stats.total,
            correct: AI.stats.correct,
            wrong: AI.stats.wrong,
            win_rate: AI.getWinRate(),
            win_streak: AI.stats.win_streak,
            max_streak: AI.stats.max_streak
        }
    };
});

// Khởi động hệ thống
const start = async () => {
    try {
        await fastifyApp.listen({ port: CONFIG.PORT, host: '0.0.0.0' });
        console.log(`
███████╗██╗   ██╗███╗   ██╗██╗    ██╗██╗███╗   ██╗
██╔════╝██║   ██║████╗  ██║██║    ██║██║████╗  ██║
███████╗██║   ██║██╔██╗ ██║██║ █╗ ██║██║██╔██╗ ██║
╚════██║██║   ██║██║╚██╗██║██║███╗██║██║██║╚██╗██║
███████║╚██████╔╝██║ ╚████║╚███╔███╔╝██║██║ ╚████║
╚══════╝ ╚═════╝ ╚═╝  ╚═══╝ ╚══╝╚══╝ ╚═╝╚═╝  ╚═══╝
        `);
        console.log(`🚀 Server đang chạy tại: http://localhost:${CONFIG.PORT}/api/data`);
        initWebSocket();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

start();
