const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Tệp lưu key (Render sẽ lưu trong bộ nhớ tạm, nên reset khi deploy mới)
const DATA_FILE = "./keys.json";

// Đọc key từ file
function loadKeys() {
  if (!fs.existsSync(DATA_FILE)) return {};
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}
// Ghi key
function saveKeys(keys) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(keys, null, 2));
}

// API xác thực key
app.post("/verify", (req, res) => {
  const { key, device_id } = req.body;
  if (!key || !device_id) return res.json({ success: false, message: "Thiếu dữ liệu" });

  const keys = loadKeys();
  const info = keys[key];
  if (!info) return res.json({ success: false, message: "Key không tồn tại" });

  if (info.expires && info.expires !== "forever") {
    const now = new Date();
    const exp = new Date(info.expires);
    if (now > exp) return res.json({ success: false, message: "Key đã hết hạn" });
  }

  if (!info.device_id) {
    info.device_id = device_id;
    info.activated_at = new Date().toISOString();
    keys[key] = info;
    saveKeys(keys);
    return res.json({ success: true, message: "Key hợp lệ (đã gán thiết bị)" });
  } else {
    if (info.device_id === device_id)
      return res.json({ success: true, message: "Key hợp lệ (thiết bị đã gán)" });
    else
      return res.json({ success: false, message: "Key đã được sử dụng trên thiết bị khác" });
  }
});

// API tạo key (chạy thủ công, không có auth)
app.post("/create", (req, res) => {
  const { key, expires } = req.body;
  const keys = loadKeys();
  if (keys[key]) return res.json({ success: false, message: "Key đã tồn tại" });
  keys[key] = { device_id: null, expires: expires || "forever", created_at: new Date().toISOString() };
  saveKeys(keys);
  res.json({ success: true, message: "Tạo key thành công", key });
});

// API liệt kê
app.get("/list", (req, res) => {
  res.json(loadKeys());
});

app.listen(PORT, () => console.log(`Server đang chạy tại cổng ${PORT}`));
