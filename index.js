require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid'); // Cài đặt bằng 'npm install uuid'

const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình để phục vụ các file tĩnh từ thư mục 'public'
app.use(express.static('public'));
// Cấu hình để nhận dữ liệu JSON từ request
app.use(express.json());
// Cấu hình view engine là EJS
app.set('view engine', 'ejs');

// Kết nối tới cơ sở dữ liệu PostgreSQL trên Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- TRANG WEB QUẢN LÝ ---
// Route chính: Lấy tất cả các key và hiển thị trang quản lý
app.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM activation_keys ORDER BY created_at DESC');
    res.render('index', { keys: rows }); // Truyền dữ liệu 'keys' vào file index.ejs
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Lỗi máy chủ');
  }
});

// --- API ENDPOINTS ---
// API: Tạo một key mới
app.post('/api/keys', async (req, res) => {
    try {
        const activationKey = uuidv4();
        const { rows } = await pool.query(
            'INSERT INTO activation_keys (activation_key) VALUES ($1) RETURNING *',
            [activationKey]
        );
        res.status(201).json(rows); // Trả về key vừa tạo
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Lỗi máy chủ' });
    }
});

// API: Xóa một key
app.delete('/api/keys/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM activation_keys WHERE id = $1', [id]);
        res.status(200).json({ message: 'Xóa key thành công' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Lỗi máy chủ' });
    }
});


// API để xác thực key (dành cho các ứng dụng khác gọi tới)
app.post('/api/activate', async (req, res) => {
    const { activation_key } = req.body;
    if (!activation_key) {
        return res.status(400).json({ message: 'Vui lòng cung cấp key kích hoạt' });
    }

    try {
        const result = await pool.query('SELECT * FROM activation_keys WHERE activation_key = $1', [activation_key]);
        const key = result.rows;

        if (!key) return res.status(404).json({ valid: false, message: 'Key không hợp lệ' });
        if (key.is_activated) return res.status(409).json({ valid: false, message: 'Key đã được sử dụng' });
        
        // Nếu muốn đánh dấu key đã sử dụng, hãy chạy câu lệnh UPDATE ở đây
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