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
  ssl: {
    rejectUnauthorized: false
  }
});

const basicAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Vui lòng nhập mật khẩu để truy cập"');
    return res.status(401).send('Yêu cầu xác thực');
  }

  const [user, pass] = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');

  if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASS) {
    return next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Sai mật khẩu"');
    return res.status(401).send('Sai thông tin xác thực');
  }
};

app.post('/api/activate', async (req, res) => {
    const { activation_key } = req.body;
    if (!activation_key) {
        return res.status(400).json({ valid: false, message: 'Vui lòng cung cấp key' });
    }
    try {
        const result = await pool.query('SELECT * FROM activation_keys WHERE activation_key = $1', [activation_key]);
        const key = result.rows[0];

        if (!key) {
            return res.status(404).json({ valid: false, message: 'Key không hợp lệ' });
        }
        if (key.is_activated) {
            return res.status(409).json({ valid: false, message: 'Key đã được sử dụng' });
        }
        if (key.is_locked) {
            return res.status(403).json({ valid: false, message: 'Key đã bị khóa' });
        }
        if (key.expires_at && new Date(key.expires_at) < new Date()) {
             return res.status(410).json({ valid: false, message: 'Key đã hết hạn' });
        }
        
        // await pool.query('UPDATE activation_keys SET is_activated = true WHERE id = $1', [key.id]);
        
        res.status(200).json({ valid: true, message: 'Key hợp lệ' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Lỗi máy chủ' });
    }
});

app.use('/', basicAuth);

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

app.post('/api/keys', async (req, res) => {
    const count = parseInt(req.body.count) || 1;
    const expires_at = req.body.expires_at || null;

    try {
        for (let i = 0; i < count; i++) {
            const activationKey = uuidv4();
            await pool.query(
                'INSERT INTO activation_keys (activation_key, expires_at) VALUES ($1, $2)',
                [activationKey, expires_at]
            );
        }
        res.redirect('/');
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Lỗi máy chủ' });
    }
});

app.post('/api/keys/:id/delete', async (req, res) => {
    try {
        await pool.query('DELETE FROM activation_keys WHERE id = $1', [req.params.id]);
        res.redirect('/');
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Lỗi máy chủ' });
    }
});

app.post('/api/keys/:id/toggle-lock', async (req, res) => {
    try {
        await pool.query(
            'UPDATE activation_keys SET is_locked = NOT is_locked WHERE id = $1',
            [req.params.id]
        );
        res.redirect(req.get('referer') || '/');
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Lỗi máy chủ' });
    }
});

app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});