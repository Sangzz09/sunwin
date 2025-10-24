// 🌈 MINHSANG KEY SERVER — FULL v7.3
// Chạy trên Render
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = "./keys.json";

app.use(cors());
app.use(bodyParser.json());

// Đọc keys
function loadKeys() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

// Lưu keys
function saveKeys(keys) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(keys, null, 2));
}

// 📋 Lấy danh sách key
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

// 🆕 Tạo key mới
app.post("/create", (req, res) => {
  const { expires } = req.body;
  const keys = loadKeys();

  const prefix = "MS-" + Math.random().toString(36).substring(2, 6).toUpperCase();
  const newKey =
    prefix + "-" + Math.random().toString(36).substring(2, 8).toUpperCase();

  if (keys[newKey])
    return res.json({ success: false, message: "Key đã tồn tại" });

  let expireDate = "forever";
  if (expires === "1d") {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    expireDate = d.toISOString();
  }

  keys[newKey] = {
    device_id: null,
    created_at: new Date().toISOString(),
    expires: expireDate,
  };
  saveKeys(keys);
  res.json({ success: true, message: "Tạo key thành công", key: newKey });
});

// 🔄 Reset toàn bộ key
app.post("/reset", (req, res) => {
  const keys = loadKeys();
  for (const k in keys) {
    keys[k].device_id = null;
    keys[k].activated_at = null;
  }
  saveKeys(keys);
  res.json({ success: true, message: "Đã reset toàn bộ key" });
});

// ❌ Xóa từng key
app.post("/delete", (req, res) => {
  const { key } = req.body;
  const keys = loadKeys();
  if (!keys[key]) return res.json({ success: false, message: "Key không tồn tại" });
  delete keys[key];
  saveKeys(keys);
  res.json({ success: true, message: `Đã xóa key ${key}` });
});

// 🔐 API xác thực (cho client)
app.post("/verify", (req, res) => {
  const { key, device_id } = req.body;
  if (!key || !device_id)
    return res.json({ success: false, message: "Thiếu dữ liệu" });

  const keys = loadKeys();
  const info = keys[key];
  if (!info) return res.json({ success: false, message: "Key không tồn tại" });

  if (info.expires !== "forever" && new Date() > new Date(info.expires))
    return res.json({ success: false, message: "Key đã hết hạn" });

  if (!info.device_id) {
    info.device_id = device_id;
    info.activated_at = new Date().toISOString();
    keys[key] = info;
    saveKeys(keys);
    return res.json({ success: true, message: "Key hợp lệ (đã gán thiết bị)" });
  }

  if (info.device_id === device_id)
    return res.json({ success: true, message: "Key hợp lệ (thiết bị đã gán)" });

  res.json({ success: false, message: "Key đã dùng trên thiết bị khác" });
});

app.listen(PORT, () =>
  console.log(`🚀 MINHSANG KEY SERVER chạy tại cổng ${PORT}`)
);
