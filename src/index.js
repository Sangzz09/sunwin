// =====================================
// 🌟 MINHSANG JSONBIN KEY SERVER 2025 🌟
// =====================================
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3000;

// === Cấu hình JSONBin.io ===
const BIN_ID = "68fb9d8fd0ea881f40b887a4";
const API_KEY = "$2a$10$GjxpyFeP.rGahOH2lXjEeeuWJU9iYvRm2xKwf.3ilZ7kChkmcFp92";
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

app.use(cors());
app.use(bodyParser.json());

// Hàm đọc dữ liệu từ JSONBin
async function loadKeys() {
  try {
    const res = await axios.get(JSONBIN_URL, {
      headers: { "X-Master-Key": API_KEY },
    });
    return res.data.record || {};
  } catch (e) {
    return {};
  }
}

// Hàm ghi dữ liệu lên JSONBin
async function saveKeys(keys) {
  await axios.put(JSONBIN_URL, keys, {
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": API_KEY,
    },
  });
}

// ==========================
// 🔐 XÁC THỰC KEY
// ==========================
app.post("/verify", async (req, res) => {
  const { key, device_id } = req.body;
  if (!key || !device_id)
    return res.json({ success: false, message: "Thiếu dữ liệu" });

  const keys = await loadKeys();
  const info = keys[key];
  if (!info) return res.json({ success: false, message: "Key không tồn tại" });

  if (info.expires && info.expires !== "forever") {
    const now = new Date();
    const exp = new Date(info.expires);
    if (now > exp)
      return res.json({ success: false, message: "Key đã hết hạn" });
  }

  if (!info.device_id) {
    info.device_id = device_id;
    info.activated_at = new Date().toISOString();
    keys[key] = info;
    await saveKeys(keys);
    return res.json({ success: true, message: "Key hợp lệ (đã gán thiết bị)" });
  }

  if (info.device_id === device_id)
    return res.json({ success: true, message: "Key hợp lệ" });

  res.json({ success: false, message: "Key đã dùng ở thiết bị khác" });
});

// ==========================
// 🧩 TẠO KEY
// ==========================
app.post("/create", async (req, res) => {
  const keys = await loadKeys();
  const newKey = "MS-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  const expires = new Date(Date.now() + 86400000).toISOString(); // 1 ngày

  keys[newKey] = {
    expires,
    device_id: null,
    created_at: new Date().toISOString(),
  };

  await saveKeys(keys);
  res.json({ success: true, message: "Tạo key thành công", key: newKey });
});

// ==========================
// 📋 DANH SÁCH KEY
// ==========================
app.get("/keys", async (_, res) => {
  const keys = await loadKeys();
  const list = Object.entries(keys).map(([key, info]) => ({
    key,
    expires: info.expires,
    created_at: info.created_at,
    device_id: info.device_id || "Chưa kích hoạt",
  }));
  res.json(list);
});

// ==========================
// ❌ XOÁ 1 KEY
// ==========================
app.post("/delete", async (req, res) => {
  const { key } = req.body;
  const keys = await loadKeys();
  if (!keys[key])
    return res.json({ success: false, message: "Không tìm thấy key" });
  delete keys[key];
  await saveKeys(keys);
  res.json({ success: true, message: `Đã xoá key ${key}` });
});

// ==========================
// 🔁 RESET TẤT CẢ KEY
// ==========================
app.post("/reset", async (_, res) => {
  const keys = await loadKeys();
  for (let k in keys) {
    keys[k].device_id = null;
    keys[k].activated_at = null;
  }
  await saveKeys(keys);
  res.json({ success: true, message: "Đã reset toàn bộ key" });
});

app.listen(PORT, () =>
  console.log(`✅ MINHSANG JSONBIN SERVER đang chạy tại cổng ${PORT}`)
);
