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

const logAction = async (keyId, action, ip, fingerprint, programName = 'N/A', details = '') => {
    try {
        await pool.query(
            'INSERT INTO activation_logs (key_id, action, ip_address, fingerprint, program_name, details) VALUES ($1, $2, $3, $4, $5, $6)',
            [keyId, action, ip, fingerprint, programName, details]
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
    const { activation_key, fingerprint, programName } = req.body;
    const ip = req.ip;

    if (!activation_key || !fingerprint) {
        return res.status(400).json({ status: 'error', message: 'Thiếu key hoặc fingerprint' });
    }

    try {
        const result = await pool.query('SELECT * FROM activation_keys WHERE activation_key = $1', [activation_key]);
        const key = result.rows[0];

        if (!key) {
            await logAction(null, 'denied_invalid_key', ip, fingerprint, programName, `Key: ${activation_key}`);
            return res.status(404).json({ status: 'error', message: 'Key không hợp lệ' });
        }

        if (key.is_locked) {
            await logAction(key.id, 'denied_locked', ip, fingerprint, programName);
            return res.status(403).json({ status: 'error', message: 'Key đã bị khóa' });
        }
        if (key.expires_at && new Date(key.expires_at) < new Date()) {
            await logAction(key.id, 'denied_expired', ip, fingerprint, programName);
            return res.status(410).json({ status: 'error', message: 'Key đã hết hạn' });
        }

        const newSessionToken = crypto.randomBytes(32).toString('hex');
        const newActivationCount = key.activation_count + 1;
        const newMetadata = { fingerprint: fingerprint, activationDate: key.metadata?.activationDate || new Date().toISOString() };

        if (key.is_activated) {
            if (key.metadata?.fingerprint === fingerprint) {
                 await pool.query(
                    'UPDATE activation_keys SET current_session_token = $1, last_heartbeat = NOW(), activation_count = $2 WHERE id = $3',
                    [newSessionToken, newActivationCount, key.id]
                );
                await logAction(key.id, 'reactivate_same_device', ip, fingerprint, programName);
                return res.json({ status: 'ok', session_token: newSessionToken, message: 'Kích hoạt lại thành công' });
            } 
            else {
                const oldFingerprint = key.metadata?.fingerprint || 'N/A';
                await pool.query(
                    'UPDATE activation_keys SET metadata = $1, current_session_token = $2, last_heartbeat = NOW(), activation_count = $3 WHERE id = $4',
                    [newMetadata, newSessionToken, newActivationCount, key.id]
                );
                await logAction(key.id, 'new_device_kick_old', ip, fingerprint, programName, `FP Cũ: ${oldFingerprint}`);
                return res.json({ status: 'ok', session_token: newSessionToken, message: 'Kích hoạt trên thiết bị mới thành công' });
            }
        } 
        else {
            await pool.query(
                'UPDATE activation_keys SET is_activated = true, metadata = $1, current_session_token = $2, last_heartbeat = NOW(), activation_count = $3 WHERE id = $4',
                [newMetadata, newSessionToken, newActivationCount, key.id]
            );
            await logAction(key.id, 'first_activation', ip, fingerprint, programName);
            return res.json({ status: 'ok', session_token: newSessionToken, message: 'Kích hoạt lần đầu thành công' });
        }
    } catch (err) {
        console.error(err.message);
        return res.status(500).json({ status: 'error', message: 'Lỗi máy chủ nội bộ' });
    }
});

app.post('/api/v2/heartbeat', async (req, res) => {
    const { activation_key, fingerprint, session_token, programName } = req.body;
    const ip = req.ip;

    if (!activation_key || !fingerprint || !session_token) {
        return res.status(400).json({ status: 'error', message: 'Yêu cầu không hợp lệ' });
    }
    
    try {
        const result = await pool.query('SELECT * FROM activation_keys WHERE activation_key = $1', [activation_key]);
        const key = result.rows[0];

        if (!key) return res.status(404).json({ status: 'error', message: 'Key không tồn tại' });
        
        if (key.is_locked) {
            await logAction(key.id, 'denied_locked_on_heartbeat', ip, fingerprint, programName);
            return res.status(403).json({ status: 'kicked_out', message: 'Key đã bị quản trị viên khóa từ xa.' });
        }

        if (key.current_session_token && key.current_session_token === session_token) {
            await pool.query('UPDATE activation_keys SET last_heartbeat = NOW() WHERE id = $1', [key.id]);
            return res.json({ status: 'ok' });
        } else {
            await logAction(key.id, 'denied_kicked_out', ip, fingerprint, programName, 'Session token không hợp lệ');
            return res.status(409).json({ status: 'kicked_out', message: 'Phiên làm việc đã bị vô hiệu hóa bởi thiết bị khác.' });
        }
    } catch (err) {
        console.error(err.message);
        return res.status(500).json({ status: 'error', message: 'Lỗi máy chủ nội bộ' });
    }
});

app.get('/api/v2/check-updates', async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT message FROM notifications WHERE is_active = true ORDER BY created_at DESC LIMIT 1");
        if (rows.length > 0) {
            res.json({ notification: rows[0].message });
        } else {
            res.json({ notification: null });
        }
    } catch (err) {
        res.status(500).json({ error: 'Lỗi máy chủ' });
    }
});

app.get('/logout', (req, res) => {
    res.status(401).send('Bạn đã đăng xuất. Vui lòng đóng tab này.');
});

app.use('/', basicAuth);

app.get('/', (req, res) => res.render('index'));

app.get('/api/keys', async (req, res) => {
    const { status, search, notes, sortBy, sortDir } = req.query;
    
    const validSortColumns = ['id', 'created_at', 'activation_key', 'is_activated', 'is_locked', 'expires_at', 'activation_count', 'last_heartbeat', 'notes', 'device_change_count'];
    const safeSortBy = validSortColumns.includes(sortBy) ? sortBy : 'id';
    const safeSortDir = ['ASC', 'DESC'].includes(sortDir?.toUpperCase()) ? sortDir.toUpperCase() : 'DESC';

    let query = 'SELECT * FROM activation_keys';
    const conditions = [];
    const params = [];

    if (search) {
        params.push(`%${search}%`);
        conditions.push(`(activation_key ILIKE $${params.length} OR (metadata->>'fingerprint') ILIKE $${params.length})`);
    }
    if (notes) {
        params.push(`%${notes}%`);
        conditions.push(`notes ILIKE $${params.length}`);
    }
    if (status) {
        switch(status) {
            case 'unused': conditions.push('is_activated = false AND is_locked = false AND (expires_at IS NULL OR expires_at >= NOW())'); break;
            case 'used': conditions.push('is_activated = true'); break;
            case 'locked': conditions.push('is_locked = true AND force_lock_reason IS NULL'); break;
            case 'forced': conditions.push('is_locked = true AND force_lock_reason IS NOT NULL'); break;
            case 'expired': conditions.push('expires_at IS NOT NULL AND expires_at < NOW()'); break;
        }
    }
    if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
    query += ` ORDER BY ${safeSortBy} ${safeSortDir}, id DESC`;

    try {
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Lỗi khi truy vấn dữ liệu' });
    }
});

app.get('/api/notifications', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM notifications ORDER BY created_at DESC');
    res.json(rows);
});

app.post('/api/notifications', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ success: false, message: 'Nội dung không được để trống' });
    await pool.query('UPDATE notifications SET is_active = false');
    await pool.query('INSERT INTO notifications (message, is_active) VALUES ($1, true)', [message]);
    res.json({ success: true });
});

app.post('/api/notifications/:id/delete', async (req, res) => {
    await pool.query('DELETE FROM notifications WHERE id = $1', [req.params.id]);
    res.json({ success: true });
});

app.get('/api/keys/:id/logs', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM activation_logs WHERE key_id = $1 ORDER BY log_timestamp DESC LIMIT 50', [req.params.id]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi khi lấy lịch sử' });
    }
});

app.post('/api/keys', async (req, res) => {
    const count = parseInt(req.body.count) || 1;
    const expires_at = req.body.expires_at || null;
    const notes = req.body.notes || null;
    try {
        for (let i = 0; i < count; i++) {
            await pool.query('INSERT INTO activation_keys (activation_key, expires_at, notes) VALUES ($1, $2, $3)', [uuidv4(), expires_at, notes]);
        }
        res.json({ success: true, message: 'Tạo key thành công' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
});

app.post('/api/keys/:id/delete', async (req, res) => {
    try {
        await pool.query('DELETE FROM activation_keys WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
});

app.post('/api/keys/:id/toggle-lock', async (req, res) => {
    try {
        const result = await pool.query('UPDATE activation_keys SET is_locked = NOT is_locked, force_lock_reason = NULL WHERE id = $1 RETURNING is_locked', [req.params.id]);
        res.json({ success: true, is_locked: result.rows[0].is_locked });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
});

app.post('/api/keys/bulk-action', async (req, res) => {
    const { action, keyIds, password } = req.body;

    if (password !== process.env.ADMIN_PASS) {
        return res.status(403).json({ success: false, message: 'Sai mật khẩu xác nhận!' });
    }
    if (!action || !keyIds || !Array.isArray(keyIds) || keyIds.length === 0) {
        return res.status(400).json({ success: false, message: 'Yêu cầu không hợp lệ' });
    }

    try {
        let query;
        if (action === 'delete') {
            query = 'DELETE FROM activation_keys WHERE id = ANY($1::int[])';
        } else if (action === 'lock') {
            query = 'UPDATE activation_keys SET is_locked = true WHERE id = ANY($1::int[])';
        } else if (action === 'unlock') {
            query = 'UPDATE activation_keys SET is_locked = false, force_lock_reason = NULL WHERE id = ANY($1::int[])';
        } else {
            return res.status(400).json({ success: false, message: 'Hành động không được hỗ trợ' });
        }
        
        await pool.query(query, [keyIds]);
        res.json({ success: true, message: `Thực hiện thành công hành động ${action} trên ${keyIds.length} key.` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Lỗi khi thực hiện hành động hàng loạt' });
    }
});

app.listen(PORT, () => console.log(`Server đang chạy tại http://localhost:${PORT}`));