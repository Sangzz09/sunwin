import fastify from "fastify";
import cors from "@fastify/cors";
import WebSocket from "ws";

// ==================================================================
// 1. CẤU HÌNH HỆ THỐNG
// ==================================================================
const PORT = 3000;
const WS_URL = "wss://websocket.azhkthg1.net/websocket?token=";

// Token mới nhất của User: sangdepzai09no (ID: SC_msangzz09)
const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJzYW5nZGVwemFpMDlubyIsImJvdCI6MCwiaXNNZXJjaGFudCI6ZmFsc2UsInZlcmlmaWVkQmFua0FjY291bnQiOnRydWUsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MjIxNjQwNjcyLCJhZmZJZCI6IlN1bndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoic3VuLndpbiIsInRpbWVzdGFtcCI6MTc2NTk3NTI2MTc3MiwibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOnRydWUsImlwQWRkcmVzcyI6IjExMy4xNzQuNzguMjU1IiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8xNS5wbmciLCJwbGF0Zm9ybUlkIjo0LCJ1c2VySWQiOiI3ODRmNGU0Mi1iZWExLTRiZTUtYjgwNS03MmJlZjY5N2UwMTIiLCJyZWdUaW1lIjoxNzQyMjMyMzQ1MTkxLCJwaG9uZSI6Ijg0ODg2MDI3NzY3IiwiZGVwb3NpdCI6dHJ1ZSwidXNlcm5hbWUiOiJTQ19tc2FuZ3p6MDkifQ.Agir60DJhgJvVHJTsu7AGPyKxbJ50FKlt0ETVxB2Gho";

// ==================================================================
// 2. TRẠNG THÁI & DỮ LIỆU (STATE MANAGEMENT)
// ==================================================================
let rikResults = []; // Lưu 100 phiên gần nhất
let rikWS = null;
let keepAliveInterval = null;

// Thống kê Win/Lose
let stats = {
    total: 0,
    correct: 0,
    wrong: 0,
    rate: "100%" // Mặc định ban đầu
};

// Lưu dự đoán của phiên tương lai để đối chiếu
let pendingPrediction = {
    session: 0,
    pick: null // 'T' hoặc 'X'
};

// ==================================================================
// 3. THUẬT TOÁN PHÂN TÍCH CẦU (CORE AI LOGIC)
// ==================================================================
const BRIDGE_ANALYZER = {
    // A. Đặt tên loại cầu dựa trên Pattern
    identifyBridgeType: (historyString) => {
        // historyString ví dụ: "TTXTXXTTTT"
        const len = historyString.length;
        if (len < 5) return "Đang phân tích...";

        // 1. Cầu Bệt (Bệt > 4 tay)
        if (historyString.endsWith("TTTT") || historyString.endsWith("TTTTT")) return "Cầu Bệt Tài";
        if (historyString.endsWith("XXXX") || historyString.endsWith("XXXXX")) return "Cầu Bệt Xỉu";

        // 2. Cầu 1-1 (Chuyền)
        const tail4 = historyString.slice(-4);
        if (tail4 === "TXTX" || tail4 === "XTXT") return "Cầu Chuyền 1-1";

        // 3. Cầu 2-2
        const tail6 = historyString.slice(-6);
        if (historyString.endsWith("TTXX") || historyString.endsWith("XXTT")) return "Cầu 2-2";

        // 4. Cầu 1-2-3 (Nghiêng)
        if (historyString.endsWith("TXXTTT") || historyString.endsWith("XTTXXX")) return "Cầu 1-2-3";

        // 5. Cầu Đảo/Gãy
        const last1 = historyString.slice(-1);
        const last2 = historyString.slice(-2, -1);
        if (last1 !== last2 && historyString.slice(-5).includes(last1 + last1)) return "Cầu Gãy";

        return "Cầu Nghiêng (Random)";
    },

    // B. Dự đoán phiên tiếp theo
    predictNext: (historyArray) => {
        if (historyArray.length < 10) return { pick: 'Tài', confidence: 0.5 };

        // Chuyển mảng object thành chuỗi TX (VD: "TTXTX...")
        // Lưu ý: historyArray[0] là mới nhất, cần reverse để lấy chuỗi theo thời gian
        const txStr = historyArray.slice(0, 20).reverse().map(h => h.tx).join('');
        
        let taiScore = 0;
        let xiuScore = 0;

        // Logic 1: Bắt bệt (Trend Following)
        if (txStr.endsWith("TTT")) taiScore += 2.0; // Đang bệt Tài -> Theo Tài
        else if (txStr.endsWith("XXX")) xiuScore += 2.0; // Đang bệt Xỉu -> Theo Xỉu

        // Logic 2: Bẻ cầu 1-1
        else if (txStr.endsWith("TXT")) xiuScore += 1.5; // Khả năng ra X tiếp (theo 1-1)
        else if (txStr.endsWith("XTX")) taiScore += 1.5;

        // Logic 3: Soi Pattern quá khứ (Pattern Matching)
        const currentPattern = txStr.slice(-4); // Lấy 4 tay cuối
        let matchCount = 0;
        
        // Quét lại quá khứ xem pattern này thường trả về gì
        // (Dùng dữ liệu giả lập logic soi cầu vì lịch sử ngắn)
        for (let i = 0; i < txStr.length - 5; i++) {
            if (txStr.substr(i, 4) === currentPattern) {
                const nextResult = txStr.charAt(i + 4);
                if (nextResult === 'T') taiScore += 0.5;
                if (nextResult === 'X') xiuScore += 0.5;
            }
        }

        // Logic 4: Cân cửa (Nếu điểm bằng nhau, bẻ cầu hiện tại)
        if (taiScore === xiuScore) {
            const last = txStr.slice(-1);
            if (last === 'T') xiuScore += 0.1;
            else taiScore += 0.1;
        }

        const prediction = taiScore > xiuScore ? 'T' : 'X';
        return {
            pick: prediction === 'T' ? 'Tài' : 'Xỉu',
            code: prediction, // T hoặc X
            confidence: Math.min(0.95, 0.5 + Math.abs(taiScore - xiuScore) * 0.1)
        };
    }
};

// ==================================================================
// 4. API SERVER (FASTIFY)
// ==================================================================
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

// Endpoint chính: /sunwinsew
app.get("/sunwinsew", async (request, reply) => {
    // Kiểm tra dữ liệu
    if (rikResults.length === 0) {
        return { status: "Đang tải dữ liệu server...", id: "@minhsangdangcap" };
    }

    const currentSession = rikResults[0]; // Phiên vừa xổ
    const historyList = rikResults;       // Toàn bộ lịch sử

    // 1. Chạy dự đoán
    const analysis = BRIDGE_ANALYZER.predictNext(historyList);
    
    // 2. Xác định loại cầu
    const txString = historyList.slice(0, 15).reverse().map(h => h.tx).join('');
    const bridgeType = BRIDGE_ANALYZER.identifyBridgeType(txString);

    // 3. Xử lý logic phiên dự đoán (N+1)
    const nextSessionID = currentSession.session + 1;
    
    // Lưu dự đoán vào bộ nhớ để check đúng sai khi có kết quả mới
    if (pendingPrediction.session !== nextSessionID) {
        pendingPrediction = {
            session: nextSessionID,
            pick: analysis.code // 'T' hoặc 'X'
        };
    }

    // 4. Trả về JSON theo đúng cấu trúc yêu cầu
    return {
        phien_hien_tai: currentSession.session,
        ket_qua: currentSession.result,      // "Tài" hoặc "Xỉu"
        xuc_xac: currentSession.dice,        // [x, y, z]
        phien_du_doan: nextSessionID,
        du_doan: analysis.pick,              // "Tài" hoặc "Xỉu"
        pattern: txString.slice(-10),        // VD: "TXTXXTTTTX"
        loai_cau: bridgeType,                // VD: "Cầu 1-1"
        thong_ke: {
            so_lan_du_doan: stats.total,
            so_lan_dung: stats.correct,
            so_lan_sai: stats.wrong,
            ti_le_dung: stats.rate
        },
        id: "@minhsangdangcap" // ID ở cuối cùng
    };
});

// ==================================================================
// 5. WEBSOCKET CLIENT (KẾT NỐI SUNWIN)
// ==================================================================
function connectToSunwin() {
    console.log(`\n🔌 Đang kết nối tới máy chủ Sunwin...`);
    
    if (rikWS) {
        try { rikWS.terminate(); } catch(e){}
    }
    clearInterval(keepAliveInterval);

    try {
        rikWS = new WebSocket(`${WS_URL}${TOKEN}`);
    } catch (e) {
        console.error("Lỗi tạo socket:", e);
        setTimeout(connectToSunwin, 3000);
        return;
    }

    rikWS.on('open', () => {
        console.log("✅ WebSocket Connected!");
        
        // Gửi gói tin đăng nhập (Giả lập Client)
        // Thông tin này decode từ Token bạn cung cấp
        const loginPayload = [1, "MiniGame", "SC_giathinh2133", "thinh211", {
            info: JSON.stringify({
                ipAddress: "113.174.78.255", 
                wsToken: TOKEN,
                userId: "784f4e42-bea1-4be5-b805-72bef697e012",
                username: "SC_msangzz09",
                timestamp: Date.now(),
            }),
            pid: 5,
            subi: true
        }];
        
        rikWS.send(JSON.stringify(loginPayload));

        // Ping giữ kết nối (Lấy thông tin game mỗi 5s)
        keepAliveInterval = setInterval(() => {
            if (rikWS.readyState === WebSocket.OPEN) {
                // Cmd 1005: Request thông tin game Tài Xỉu
                rikWS.send(JSON.stringify([6, "MiniGame", "taixiuPlugin", { cmd: 1005 }]));
            }
        }, 5000);
    });

    rikWS.on('message', (data) => {
        try {
            // Giải mã tin nhắn (Binary -> String)
            let msgStr = data;
            if (typeof data !== 'string') {
                msgStr = new TextDecoder().decode(data);
            }
            
            // Chỉ xử lý JSON hợp lệ
            if (!msgStr.startsWith('[') && !msgStr.startsWith('{')) return;
            const json = JSON.parse(msgStr);

            // CASE 1: Nhận lịch sử phiên (Khi mới vào)
            if (Array.isArray(json) && json[1]?.htr) {
                const history = json[1].htr.map(i => ({
                    session: i.sid,
                    dice: [i.d1, i.d2, i.d3],
                    total: i.d1 + i.d2 + i.d3,
                    result: (i.d1 + i.d2 + i.d3) >= 11 ? "Tài" : "Xỉu",
                    tx: (i.d1 + i.d2 + i.d3) >= 11 ? "T" : "X"
                })).sort((a, b) => b.session - a.session); // Mới nhất lên đầu

                rikResults = history;
                console.log(`📥 Đã tải ${history.length} phiên lịch sử.`);
            }

            // CASE 2: Nhận kết quả phiên mới (Realtime)
            if (json.session && json.dice) {
                const newRecord = {
                    session: json.session,
                    dice: json.dice,
                    total: json.total,
                    result: json.result, // "Tài" hoặc "Xỉu" (Server trả về)
                    tx: json.total >= 11 ? 'T' : 'X'
                };

                // Kiểm tra xem đây có phải phiên mới không
                if (rikResults.length === 0 || newRecord.session > rikResults[0].session) {
                    // --- XỬ LÝ THỐNG KÊ ---
                    // Nếu phiên này trùng với phiên ta đã dự đoán trước đó
                    if (pendingPrediction.session === newRecord.session && pendingPrediction.pick) {
                        stats.total++;
                        // Chuẩn hóa kết quả thực tế về 'T' hoặc 'X'
                        const actualCode = newRecord.total >= 11 ? 'T' : 'X';
                        
                        if (actualCode === pendingPrediction.pick) {
                            stats.correct++;
                            console.log(`🎯 DỰ ĐOÁN ĐÚNG: Phiên ${newRecord.session} ra ${newRecord.result}`);
                        } else {
                            stats.wrong++;
                            console.log(`❌ DỰ ĐOÁN SAI: Phiên ${newRecord.session} ra ${newRecord.result}`);
                        }

                        // Tính lại tỷ lệ
                        const rateNum = (stats.correct / stats.total) * 100;
                        stats.rate = rateNum.toFixed(1) + "%";
                    }
                    // -----------------------

                    // Thêm vào lịch sử
                    rikResults.unshift(newRecord);
                    if (rikResults.length > 100) rikResults.pop();

                    console.log(`🔔 Cập nhật phiên ${newRecord.session} | Pattern: ${rikResults.slice(0,5).map(r=>r.tx).reverse().join('')}`);
                }
            }

        } catch (err) {
            // Bỏ qua lỗi parse JSON rác
        }
    });

    rikWS.on('close', () => {
        console.log("❌ Mất kết nối! Thử lại sau 3s...");
        setTimeout(connectToSunwin, 3000);
    });

    rikWS.on('error', (e) => {
        console.error("Lỗi Socket:", e.message);
    });
}

// ==================================================================
// 6. KHỞI CHẠY
// ==================================================================
const startServer = async () => {
    try {
        await app.listen({ port: PORT, host: "0.0.0.0" });
        console.log(`\n=================================================`);
        console.log(`🚀 SERVER API SUNWIN VIP (@minhsangdangcap)`);
        console.log(`👉 Link API: http://localhost:${PORT}/sunwinsew`);
        console.log(`=================================================`);
        
        connectToSunwin();
    } catch (err) {
        console.error("Không thể khởi động server:", err);
        process.exit(1);
    }
};

startServer();
