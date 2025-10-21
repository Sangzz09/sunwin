// ============================
// 🌟 MINHSANG KEY SERVER 🌟
// Full Code Hoàn Chỉnh — 2025
// ============================

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// === File lưu key ===
const DATA_FILE = "./keys.json";

// Đọc danh sách key
function loadKeys() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

// Ghi file key
function saveKeys(keys) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(keys, null, 2));
}

// ==============================
// 🔐 API XÁC THỰC KEY
// ==============================
app.post("/verify", (req, res) => {
  const { key, device_id } = req.body;
  if (!key || !device_id)
    return res.json({ success: false, message: "Thiếu dữ liệu" });

  const keys = loadKeys();
  const info = keys[key];
  if (!info)
    return res.json({ success: false, message: "Key không tồn tại" });

  // Kiểm tra hạn
  if (info.expires && info.expires !== "forever") {
    const now = new Date();
    const exp = new Date(info.expires);
    if (now > exp)
      return res.json({ success: false, message: "Key đã hết hạn" });
  }

  // Gán thiết bị nếu chưa kích hoạt
  if (!info.device_id) {
    info.device_id = device_id;
    info.activated_at = new Date().toISOString();
    keys[key] = info;
    saveKeys(keys);
    return res.json({
      success: true,
      message: "Key hợp lệ (đã gán thiết bị)",
    });
  }

  // Đã gán thiết bị trước đó
  if (info.device_id === device_id) {
    return res.json({
      success: true,
      message: "Key hợp lệ (thiết bị đã gán)",
    });
  } else {
    return res.json({
      success: false,
      message: "Key đã được sử dụng trên thiết bị khác",
    });
  }
});

// ==============================
// 🧩 API TẠO KEY
// ==============================
app.post("/create", (req, res) => {
  const { key, expires } = req.body;
  const keys = loadKeys();

  // Nếu không có key -> tự tạo ngẫu nhiên
  const newKey =
    key ||
    Math.random().toString(36).substring(2, 8).toUpperCase() +
      "-" +
      Math.random().toString(36).substring(2, 8).toUpperCase();

  if (keys[newKey])
    return res.json({ success: false, message: "Key đã tồn tại" });

  keys[newKey] = {
    device_id: null,
    expires: expires || "forever",
    created_at: new Date().toISOString(),
  };
  saveKeys(keys);
  res.json({ success: true, message: "Tạo key thành công", key: newKey });
});

// ==============================
// 🔁 API RESET KEY
// ==============================
app.post("/reset", (req, res) => {
  const keys = loadKeys();
  for (const k in keys) {
    keys[k].device_id = null;
    keys[k].activated_at = null;
  }
  saveKeys(keys);
  res.json({ success: true, message: "Đã reset toàn bộ key" });
});

// ==============================
// ❌ API XOÁ TOÀN BỘ KEY
// ==============================
app.post("/deleteall", (req, res) => {
  saveKeys({});
  res.json({ success: true, message: "Đã xoá toàn bộ key" });
});

// ==============================
// 📋 API LIỆT KÊ (cũ)
// ==============================
app.get("/list", (req, res) => {
  res.json(loadKeys());
});

// ==============================
// 📦 API /keys — Cho giao diện Admin
// ==============================
app.get("/keys", (req, res) => {
  const keys = loadKeys();
  const list = Object.entries(keys).map(([key, info]) => ({
    key,
    expires: info.expires || "forever",
    created_at: info.created_at,
    device_id: info.device_id || "Chưa kích hoạt",
  }));
  res.json(list);
});

// ==============================
app.listen(PORT, () =>
  console.log(`✅ MINHSANG Key Server đang chạy tại cổng ${PORT}`)
);
