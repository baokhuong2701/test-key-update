document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const keyTableBody = document.getElementById('key-table-body');
    const searchInput = document.getElementById('search-input');
    const statusFilter = document.getElementById('filter-status');
    const createKeyForm = document.getElementById('create-key-form');
    const selectAllCheckbox = document.getElementById('select-all-keys');
    const bulkActionBar = document.getElementById('bulk-action-bar');
    const selectionCountSpan = document.getElementById('selection-count');
    const bulkActionSelect = document.getElementById('bulk-action-select');
    const bulkActionExecuteBtn = document.getElementById('bulk-action-execute');

    // Modals
    const historyModal = document.getElementById('history-modal');
    const passwordModal = document.getElementById('password-modal');
    const historyContent = document.getElementById('history-content');

    let debounceTimer;

    // --- Data & State ---
    const logTranslations = {
        'first_activation': 'Kích hoạt lần đầu',
        'reactivate_same_device': 'Kích hoạt lại (cùng máy)',
        'new_device_kick_old': 'Kích hoạt máy mới (đá máy cũ)',
        'denied_invalid_key': 'Từ chối: Key không hợp lệ',
        'denied_locked': 'Từ chối: Key đã bị khóa',
        'denied_expired': 'Từ chối: Key đã hết hạn',
        'denied_kicked_out': 'Từ chối: Bị đá khỏi phiên',
        'denied_locked_on_heartbeat': 'Từ chối: Key bị khóa từ xa'
    };

    const fetchData = async () => {
        const params = new URLSearchParams({
            search: searchInput.value,
            status: statusFilter.value,
        });
        
        try {
            const response = await fetch(`/api/keys?${params.toString()}`);
            if (!response.ok) throw new Error(`Lỗi mạng: ${response.statusText}`);
            const keys = await response.json();
            renderTable(keys);
            updateBulkActionBar();
        } catch (error) {
            console.error('Lỗi tải dữ liệu:', error);
            keyTableBody.innerHTML = `<tr><td colspan="8" class="error-text">Không thể tải dữ liệu.</td></tr>`;
        }
    };

    const renderTable = (keys) => {
        keyTableBody.innerHTML = '';
        if (!keys || keys.length === 0) {
            keyTableBody.innerHTML = `<tr><td colspan="8" class="loading-text">Không tìm thấy key nào.</td></tr>`;
            return;
        }

        keys.forEach(key => {
            let status = { text: 'Chưa dùng', class: 'status-ok' };
            const isExpired = key.expires_at && new Date(key.expires_at) < new Date();
            if (isExpired) status = { text: 'Hết hạn', class: 'status-expired' };
            else if (key.is_locked) status = { text: 'Bị khóa', class: 'status-locked' };
            else if (key.is_activated) status = { text: 'Đã dùng', class: 'status-used' };

            const row = document.createElement('tr');
            row.dataset.keyId = key.id;
            row.innerHTML = `
                <td><input type="checkbox" class="key-checkbox" data-key-id="${key.id}"></td>
                <td>${new Date(key.created_at).toLocaleString('vi-VN')}</td>
                <td class="key-value">${key.activation_key}</td>
                <td><span class="status-badge ${status.class}">${status.text}</span></td>
                <td class="key-value" title="${key.metadata?.fingerprint || ''}">${(key.metadata?.fingerprint || '---').substring(0, 15)}</td>
                <td>${key.activation_count}</td>
                <td>${key.last_heartbeat ? new Date(key.last_heartbeat).toLocaleString('vi-VN') : '---'}</td>
                <td class="actions">
                    <button class="btn btn-action btn-history" data-action="history">Log</button>
                    <button class="btn btn-action ${key.is_locked ? 'btn-unlock' : 'btn-lock'}" data-action="toggle-lock">${key.is_locked ? 'Mở' : 'Khóa'}</button>
                    <button class="btn btn-action btn-delete" data-action="delete">Xóa</button>
                </td>
            `;
            keyTableBody.appendChild(row);
        });
    };

    createKeyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(createKeyForm);
        const data = Object.fromEntries(formData.entries());
        
        try {
            const response = await fetch('/api/keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!response.ok) throw new Error('Lỗi khi tạo key');
            await fetchData();
            createKeyForm.reset();
        } catch (error) {
            alert(error.message);
        }
    });

    keyTableBody.addEventListener('click', async (e) => {
        const target = e.target;
        if (target.tagName !== 'BUTTON') return;

        const row = target.closest('tr');
        const keyId = row.dataset.keyId;
        const action = target.dataset.action;

        if (action === 'toggle-lock') {
            const response = await fetch(`/api/keys/${keyId}/toggle-lock`, { method: 'POST' });
            const result = await response.json();
            if (result.success) fetchData();
        } else if (action === 'delete') {
            if (confirm(`Bạn có chắc muốn xóa key ID: ${keyId} không?`)) {
                const response = await fetch(`/api/keys/${keyId}/delete`, { method: 'POST' });
                const result = await response.json();
                if (result.success) row.remove();
            }
        } else if (action === 'history') {
            showHistoryModal(keyId);
        }
    });
    
    const updateBulkActionBar = () => {
        const selectedCheckboxes = document.querySelectorAll('.key-checkbox:checked');
        const count = selectedCheckboxes.length;
        selectionCountSpan.textContent = `Đã chọn: ${count}`;
        bulkActionBar.style.display = count > 0 ? 'flex' : 'none';
        const allCheckboxes = document.querySelectorAll('.key-checkbox');
        selectAllCheckbox.checked = count > 0 && count === allCheckboxes.length;
    };

    selectAllCheckbox.addEventListener('change', () => {
        document.querySelectorAll('.key-checkbox').forEach(cb => cb.checked = selectAllCheckbox.checked);
        updateBulkActionBar();
    });

    keyTableBody.addEventListener('change', e => {
        if (e.target.classList.contains('key-checkbox')) updateBulkActionBar();
    });

    bulkActionExecuteBtn.addEventListener('click', () => {
        const action = bulkActionSelect.value;
        const selectedIds = [...document.querySelectorAll('.key-checkbox:checked')].map(cb => cb.dataset.keyId);

        if (!action || selectedIds.length === 0) {
            alert('Vui lòng chọn hành động và ít nhất một key.');
            return;
        }

        passwordModal.style.display = 'block';
        
        const passwordConfirmButton = document.getElementById('password-confirm-button');
        const passwordInput = document.getElementById('password-confirm-input');

        const confirmHandler = async () => {
            const password = passwordInput.value;
            if (!password) {
                alert('Vui lòng nhập mật khẩu.');
                return;
            }

            try {
                const response = await fetch('/api/keys/bulk-action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action, keyIds: selectedIds, password })
                });
                const result = await response.json();
                passwordModal.style.display = 'none';
                passwordInput.value = '';
                if (result.success) {
                    alert(result.message);
                    fetchData();
                } else {
                    alert(`Lỗi: ${result.message}`);
                }
            } catch (error) {
                alert('Lỗi khi thực hiện hành động hàng loạt.');
                passwordModal.style.display = 'none';
                passwordInput.value = '';
            }
        };
        
        const newConfirmButton = passwordConfirmButton.cloneNode(true);
        passwordConfirmButton.parentNode.replaceChild(newConfirmButton, passwordConfirmButton);
        newConfirmButton.addEventListener('click', confirmHandler);
    });

    const showHistoryModal = async (keyId) => {
        historyContent.innerHTML = '<p>Đang tải lịch sử...</p>';
        historyModal.style.display = 'block';
        try {
            const response = await fetch(`/api/keys/${keyId}/logs`);
            const logs = await response.json();
            if (logs.length === 0) {
                historyContent.innerHTML = '<p>Không có lịch sử nào.</p>';
                return;
            }
            let html = '<ul class="history-list">';
            logs.forEach(log => {
                const actionText = logTranslations[log.action] || log.action;
                html += `<li>
                    <span class="log-time">${new Date(log.log_timestamp).toLocaleString('vi-VN')}</span>
                    <span class="log-action">${actionText}</span>
                    <span class="log-program">(${log.program_name || 'Không rõ'})</span>
                    <span class="log-details">IP: ${log.ip_address} | FP: ${log.fingerprint}</span>
                    ${log.details ? `<span class="log-extra">${log.details}</span>` : ''}
                </li>`;
            });
            html += '</ul>';
            historyContent.innerHTML = html;
        } catch (error) {
            historyContent.innerHTML = '<p class="error-text">Lỗi khi tải lịch sử.</p>';
        }
    };
    
    document.querySelectorAll('.modal .close-button').forEach(btn => {
        btn.addEventListener('click', () => btn.closest('.modal').style.display = 'none');
    });

    window.addEventListener('click', e => {
        if (e.target.classList.contains('modal')) e.target.style.display = 'none';
    });

    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(fetchData, 300);
    });

    statusFilter.addEventListener('change', fetchData);

    fetchData();
    setInterval(fetchData, 10000);
});