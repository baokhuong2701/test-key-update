// --- MIDDLEWARE BẢO MẬT ---
// Chỉ cho phép truy cập trang quản lý nếu có tên người dùng và mật khẩu đúng
const basicAuth = (req, res, next) => {
  // Lấy thông tin xác thực từ header mà trình duyệt gửi lên
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Vui lòng nhập mật khẩu để truy cập"');
    return res.status(401).send('Yêu cầu xác thực');
  }

  // Giải mã thông tin user:pass từ base64
  const [user, pass] = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');

  // Kiểm tra với biến môi trường
  if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASS) {
    return next(); // Mật khẩu đúng, cho phép đi tiếp
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Sai mật khẩu"');
    return res.status(401).send('Sai thông tin xác thực');
  }
};

// ÁP DỤNG BẢO MẬT: Tất cả các route bên dưới dòng này sẽ được bảo vệ
app.use('/', basicAuth); 
```**Lưu ý:** Đoạn `app.use('/', basicAuth);` phải được đặt **trước** tất cả các `app.get`, `app.post` của trang quản lý.

#### **Bước 1.2: Cấu hình Tên người dùng & Mật khẩu trên Render**

1.  Vào trang Dashboard của Render, chọn **Web Service** của bạn.
2.  Vào tab **Environment**.
3.  Nhấn **Add Environment Variable** 2 lần để thêm 2 biến sau:
    *   **Key:** `ADMIN_USER` | **Value:** `admin` (hoặc tên người dùng bạn muốn)
    *   **Key:** `ADMIN_PASS` | **Value:** `sieu_mat_khau_123` (hoặc một mật khẩu phức tạp bạn muốn)
4.  Nhấn **Save Changes**. Render sẽ tự động khởi động lại server với các biến mới.

Sau khi làm xong, hãy đẩy code `index.js` mới lên GitHub. Render sẽ tự cập nhật. Giờ đây, khi bạn truy cập trang web, nó sẽ hỏi mật khẩu!

---

### **Phần 2: Nâng Cấp Toàn Diện Chức Năng**

#### **Bước 2.1: Cập nhật Cấu trúc Database**

Chúng ta cần thêm cột để lưu trạng thái "khóa" và "ngày hết hạn".

1.  Mở **DBeaver** và kết nối đến database của bạn.
2.  Mở một cửa sổ **SQL Editor** mới.
3.  Dán và chạy lệnh `ALTER TABLE` sau. Lệnh này sẽ thêm 2 cột mới vào bảng đã có mà không làm mất dữ liệu cũ:
    ```sql
    ALTER TABLE activation_keys
    ADD COLUMN is_locked BOOLEAN DEFAULT false,
    ADD COLUMN expires_at TIMESTAMPTZ;
    ```

#### **Bước 2.2: Nâng cấp Backend (`index.js`)**

Thay thế toàn bộ nội dung file `index.js` của bạn bằng code nâng cấp dưới đây. Code này đã bao gồm tất cả các tính năng mới.

```javascript
// ----- PHẦN KHAI BÁO (giữ nguyên) -----
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Cần thiết để đọc dữ liệu form
app.set('view engine', 'ejs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ----- PHẦN BẢO MẬT (đã thêm ở trên) -----
const basicAuth = (req, res, next) => {
    // ... (giữ nguyên code bảo mật đã thêm ở Phần 1)
};
// API xác thực không cần bảo mật, nhưng trang quản lý thì cần
app.post('/api/activate', async (req, res) => { /* ... */ });
app.use('/', basicAuth); 

// --- TRANG WEB QUẢN LÝ ---
// Route chính: Lấy tất cả key (có tìm kiếm) và hiển thị
app.get('/', async (req, res) => {
  const searchTerm = req.query.search || '';
  try {
    let query = 'SELECT * FROM activation_keys';
    const params = [];
    if (searchTerm) {
      query += ' WHERE activation_key ILIKE $1';
      params.push(`%${searchTerm}%`);
    }
    query += ' ORDER BY created_at DESC';

    const { rows } = await pool.query(query, params);
    res.render('index', { keys: rows, searchTerm: searchTerm });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Lỗi máy chủ');
  }
});

// --- API ENDPOINTS CHO TRANG QUẢN LÝ ---

// API: Tạo nhiều key mới, có hạn sử dụng
app.post('/api/keys', async (req, res) => {
    const count = parseInt(req.body.count) || 1;
    const expires_at = req.body.expires_at || null; // Dạng YYYY-MM-DD

    try {
        for (let i = 0; i < count; i++) {
            const activationKey = uuidv4();
            await pool.query(
                'INSERT INTO activation_keys (activation_key, expires_at) VALUES ($1, $2)',
                [activationKey, expires_at]
            );
        }
        res.redirect('/'); // Tạo xong thì quay về trang chủ
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Lỗi máy chủ' });
    }
});

// API: Xóa một key
app.post('/api/keys/:id/delete', async (req, res) => {
    try {
        await pool.query('DELETE FROM activation_keys WHERE id = $1', [req.params.id]);
        res.redirect('/');
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Lỗi máy chủ' });
    }
});

// API: Khóa hoặc Mở khóa một key
app.post('/api/keys/:id/toggle-lock', async (req, res) => {
    try {
        await pool.query(
            'UPDATE activation_keys SET is_locked = NOT is_locked WHERE id = $1',
            [req.params.id]
        );
        res.redirect(req.get('referer') || '/'); // Quay lại trang trước đó
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Lỗi máy chủ' });
    }
});

// --- API XÁC THỰC KEY CHO CLIENT ---
app.post('/api/activate', async (req, res) => {
    const { activation_key } = req.body;
    if (!activation_key) {
        return res.status(400).json({ valid: false, message: 'Vui lòng cung cấp key' });
    }
    try {
        const result = await pool.query('SELECT * FROM activation_keys WHERE activation_key = $1', [activation_key]);
        const key = result.rows[0];

        if (!key) return res.status(404).json({ valid: false, message: 'Key không hợp lệ' });
        if (key.is_activated) return res.status(409).json({ valid: false, message: 'Key đã được sử dụng' });
        if (key.is_locked) return res.status(403).json({ valid: false, message: 'Key đã bị khóa' });
        if (key.expires_at && new Date(key.expires_at) < new Date()) {
             return res.status(410).json({ valid: false, message: 'Key đã hết hạn' });
        }
        
        // Đánh dấu đã kích hoạt
        // await pool.query('UPDATE activation_keys SET is_activated = true WHERE id = $1', [key.id]);
        
        res.status(200).json({ valid: true, message: 'Key hợp lệ' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Lỗi máy chủ' });
    }
});


app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});