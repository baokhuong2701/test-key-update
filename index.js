require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('trust proxy', true);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const logAction = async (keyId, action, ip, fingerprint, details = '') => {
    try {
        await pool.query(
            'INSERT INTO activation_logs (key_id, action, ip_address, fingerprint, details) VALUES ($1, $2, $3, $4, $5)',
            [keyId, action, ip, fingerprint, details]
        );
    } catch (dbError) {
        console.error('Lỗi ghi log:', dbError);
    }
};

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

app.post('/api/v2/activate', async (req, res) => {
    const { activation_key, fingerprint } = req.body;
    const ip = req.ip;

    if (!activation_key || !fingerprint) {
        return res.status(400).json({ status: 'error', message: 'Thiếu key hoặc fingerprint' });
    }

    try {
        const result = await pool.query('SELECT * FROM activation_keys WHERE activation_key = $1', [activation_key]);
        const key = result.rows[0];

        if (!key) {
            await logAction(null, 'denied_invalid_key', ip, fingerprint, `Key: ${activation_key}`);
            return res.status(404).json({ status: 'error', message: 'Key không hợp lệ' });
        }

        if (key.is_locked) {
            await logAction(key.id, 'denied_locked', ip, fingerprint);
            return res.status(403).json({ status: 'error', message: 'Key đã bị khóa' });
        }
        if (key.expires_at && new Date(key.expires_at) < new Date()) {
            await logAction(key.id, 'denied_expired', ip, fingerprint);
            return res.status(410).json({ status: 'error', message: 'Key đã hết hạn' });
        }

        const newSessionToken = crypto.randomBytes(32).toString('hex');
        const newActivationCount = key.activation_count + 1;

        if (key.is_activated) {
            if (key.metadata && key.metadata.fingerprint === fingerprint) {
                 await pool.query(
                    'UPDATE activation_keys SET current_session_token = $1, last_heartbeat = NOW(), activation_count = $2 WHERE id = $3',
                    [newSessionToken, newActivationCount, key.id]
                );
                await logAction(key.id, 'reactivate_same_device', ip, fingerprint);
                return res.json({ status: 'ok', session_token: newSessionToken, message: 'Kích hoạt lại thành công' });
            } 
            else {
                const oldFingerprint = (key.metadata && key.metadata.fingerprint) ? key.metadata.fingerprint : 'N/A';
                const newMetadata = { fingerprint: fingerprint, activationDate: key.metadata.activationDate };
                await pool.query(
                    'UPDATE activation_keys SET metadata = $1, current_session_token = $2, last_heartbeat = NOW(), activation_count = $3 WHERE id = $4',
                    [newMetadata, newSessionToken, newActivationCount, key.id]
                );
                await logAction(key.id, 'new_device_kick_old', ip, fingerprint, `Old fingerprint: ${oldFingerprint}`);
                return res.json({ status: 'ok', session_token: newSessionToken, message: 'Kích hoạt trên thiết bị mới thành công' });
            }
        } 
        else {
            const newMetadata = { fingerprint: fingerprint, activationDate: new Date().toISOString() };
            await pool.query(
                'UPDATE activation_keys SET is_activated = true, metadata = $1, current_session_token = $2, last_heartbeat = NOW(), activation_count = $3 WHERE id = $4',
                [newMetadata, newSessionToken, newActivationCount, key.id]
            );
            await logAction(key.id, 'first_activation', ip, fingerprint);
            return res.json({ status: 'ok', session_token: newSessionToken, message: 'Kích hoạt lần đầu thành công' });
        }

    } catch (err) {
        console.error(err.message);
        return res.status(500).json({ status: 'error', message: 'Lỗi máy chủ nội bộ' });
    }
});

app.post('/api/v2/heartbeat', async (req, res) => {
    const { activation_key, fingerprint, session_token } = req.body;
    const ip = req.ip;

    if (!activation_key || !fingerprint || !session_token) {
        return res.status(400).json({ status: 'error', message: 'Yêu cầu không hợp lệ' });
    }
    
    try {
        const result = await pool.query('SELECT * FROM activation_keys WHERE activation_key = $1', [activation_key]);
        const key = result.rows[0];

        if (!key) return res.status(404).json({ status: 'error', message: 'Key không tồn tại' });
        
        if (key.current_session_token && key.current_session_token === session_token) {
            await pool.query('UPDATE activation_keys SET last_heartbeat = NOW() WHERE id = $1', [key.id]);
            return res.json({ status: 'ok' });
        } else {
            await logAction(key.id, 'denied_kicked_out', ip, fingerprint, 'Session token không hợp lệ');
            return res.status(409).json({ status: 'kicked_out', message: 'Phiên làm việc đã bị vô hiệu hóa bởi thiết bị khác.' });
        }
    } catch (err) {
        console.error(err.message);
        return res.status(500).json({ status: 'error', message: 'Lỗi máy chủ nội bộ' });
    }
});

app.use('/', basicAuth);

app.get('/', (req, res) => {
  res.render('index');
});

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
                conditions.push('is_activated = false AND is_locked = false AND (expires_at IS NULL OR expires_at >= NOW())');
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
    
    query += ' ORDER BY id DESC';

    try {
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Lỗi khi truy vấn dữ liệu' });
    }
});

app.get('/api/keys/:id/logs', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM activation_logs WHERE key_id = $1 ORDER BY log_timestamp DESC LIMIT 50',
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Lỗi khi lấy lịch sử' });
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