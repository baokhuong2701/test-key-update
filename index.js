require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- MIDDLEWARE BẢO MẬT ---
const basicAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Secure Area"');
    return res.status(401).send('Authentication required.');
  }
  const [user, pass] = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
  if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASS) {
    return next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Invalid Credentials"');
    return res.status(401).send('Authentication failed.');
  }
};

// --- API XÁC THỰC KEY CHO CLIENT (Nâng cấp) ---
app.post('/api/activate', async (req, res) => {
    const { activation_key, machineId } = req.body;
    if (!activation_key || !machineId) {
        return res.status(400).json({ valid: false, message: 'Thiếu key hoặc mã máy' });
    }
    try {
        const result = await pool.query('SELECT * FROM activation_keys WHERE activation_key = $1', [activation_key]);
        const key = result.rows[0];

        if (!key) return res.status(404).json({ valid: false, message: 'Key không hợp lệ' });
        if (key.is_locked) return res.status(403).json({ valid: false, message: 'Key đã bị khóa' });
        if (key.expires_at && new Date(key.expires_at) < new Date()) {
            return res.status(410).json({ valid: false, message: 'Key đã hết hạn' });
        }
        
        const newActivationCount = key.activation_count + 1;

        if (key.is_activated) {
            if (key.metadata && key.metadata.machineId === machineId) {
                await pool.query('UPDATE activation_keys SET activation_count = $1 WHERE id = $2', [newActivationCount, key.id]);
                return res.status(200).json({ valid: true, message: 'Kích hoạt lại thành công' });
            } else {
                return res.status(409).json({ valid: false, message: 'Key đã dùng trên máy khác' });
            }
        } else {
            const activationMetadata = { machineId: machineId, activationDate: new Date().toISOString() };
            await pool.query(
                'UPDATE activation_keys SET is_activated = true, metadata = $1, activation_count = $2 WHERE id = $3',
                [activationMetadata, newActivationCount, key.id]
            );
            return res.status(200).json({ valid: true, message: 'Kích hoạt thành công' });
        }
    } catch (err) {
        console.error(err.message);
        return res.status(500).json({ error: 'Lỗi máy chủ' });
    }
});

// --- BẢO MẬT CHO TRANG QUẢN LÝ ---
app.use('/', basicAuth);

// --- CÁC ROUTE CỦA TRANG QUẢN LÝ ---

// Route chính: Hiển thị trang HTML
app.get('/', (req, res) => {
  res.render('index');
});

// API mới: Cung cấp dữ liệu key (JSON) cho frontend, hỗ trợ lọc và tìm kiếm
app.get('/api/keys', async (req, res) => {
    const { status, search } = req.query;
    let query = 'SELECT * FROM activation_keys';
    const conditions = [];
    const params = [];

    if (search) {
        params.push(`%${search}%`);
        conditions.push(`activation_key ILIKE $${params.length}`);
    }

    if (status) {
        switch(status) {
            case 'unused':
                conditions.push('is_activated = false AND is_locked = false');
                break;
            case 'used':
                conditions.push('is_activated = true');
                break;
            case 'locked':
                conditions.push('is_locked = true');
                break;
            case 'expired':
                conditions.push('expires_at IS NOT NULL AND expires_at < NOW()');
                break;
        }
    }
    
    if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY created_at DESC';

    try {
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Lỗi khi truy vấn dữ liệu' });
    }
});


app.post('/api/keys', async (req, res) => {
    const count = parseInt(req.body.count) || 1;
    const expires_at = req.body.expires_at || null;
    try {
        for (let i = 0; i < count; i++) {
            const activationKey = uuidv4();
            await pool.query('INSERT INTO activation_keys (activation_key, expires_at) VALUES ($1, $2)', [activationKey, expires_at]);
        }
        res.redirect('/');
    } catch (err) {
        res.status(500).json({ error: 'Lỗi máy chủ' });
    }
});

app.post('/api/keys/:id/delete', async (req, res) => {
    try {
        await pool.query('DELETE FROM activation_keys WHERE id = $1', [req.params.id]);
        res.redirect('/');
    } catch (err) {
        res.status(500).json({ error: 'Lỗi máy chủ' });
    }
});

app.post('/api/keys/:id/toggle-lock', async (req, res) => {
    try {
        await pool.query('UPDATE activation_keys SET is_locked = NOT is_locked WHERE id = $1', [req.params.id]);
        res.redirect('back');
    } catch (err) {
        res.status(500).json({ error: 'Lỗi máy chủ' });
    }
});

app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});