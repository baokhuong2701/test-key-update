document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const keyTableBody = document.getElementById('key-table-body');
    const searchInput = document.getElementById('search-input');
    const statusFilter = document.getElementById('filter-status');
    const filterNotesInput = document.getElementById('filter-notes');
    const createKeyForm = document.getElementById('create-key-form');
    const tableHeaders = document.querySelectorAll('#key-table th.sortable');
    const logoutButton = document.getElementById('logout-button');
    const manageNotificationsBtn = document.getElementById('manage-notifications-btn');

    const selectAllCheckbox = document.getElementById('select-all-keys');
    const bulkActionBar = document.getElementById('bulk-action-bar');
    const selectionCountSpan = document.getElementById('selection-count');
    const bulkActionSelect = document.getElementById('bulk-action-select');
    const bulkActionExecuteBtn = document.getElementById('bulk-action-execute');

    const historyModal = document.getElementById('history-modal');
    const passwordModal = document.getElementById('password-modal');
    const notificationsModal = document.getElementById('notifications-modal');
    const exportModal = document.getElementById('export-modal');
    const historyContent = document.getElementById('history-content');
    const notificationForm = document.getElementById('notification-form');
    const notificationHistoryUl = document.getElementById('notification-history');
    const exportTextarea = document.getElementById('export-textarea');
    const copyExportButton = document.getElementById('copy-export-button');

    let debounceTimer;
    let currentSort = { by: 'id', dir: 'DESC' };

    const logTranslations = {
        'first_activation': 'Kích hoạt lần đầu', 'reactivate_same_device': 'Kích hoạt lại (cùng máy)',
        'new_device_kick_old': 'Kích hoạt máy mới (đá máy cũ)', 'denied_invalid_key': 'Từ chối: Key không hợp lệ',
        'denied_locked': 'Từ chối: Key đã bị khóa', 'denied_expired': 'Từ chối: Key đã hết hạn',
        'denied_kicked_out': 'Từ chối: Bị đá khỏi phiên', 'denied_locked_on_heartbeat': 'Từ chối: Key bị khóa từ xa',
        'force_lock_too_many_devices': 'Cưỡng chế khóa: Đổi máy quá nhiều',
        'trial_activation': 'Kích hoạt dùng thử'
    };

    const fetchData = async () => {
        const params = new URLSearchParams({
            search: searchInput.value,
            status: statusFilter.value,
            notes: filterNotesInput.value,
            sortBy: currentSort.by,
            sortDir: currentSort.dir
        });
        try {
            const response = await fetch(`/api/keys?${params.toString()}`);
            if (!response.ok) throw new Error(`Lỗi mạng: ${response.statusText}`);
            const keys = await response.json();
            renderTable(keys);
            updateBulkActionBar();
        } catch (error) {
            console.error('Lỗi tải dữ liệu:', error);
            keyTableBody.innerHTML = `<tr><td colspan="10" class="error-text">Không thể tải dữ liệu.</td></tr>`;
        }
    };

    const renderTable = (keys) => {
        keyTableBody.innerHTML = '';
        if (!keys || keys.length === 0) {
            keyTableBody.innerHTML = `<tr><td colspan="10" class="loading-text">Không tìm thấy key nào.</td></tr>`;
            return;
        }
        keys.forEach(key => {
            let status = { text: 'Chưa dùng', class: 'status-ok' };
            if (key.is_trial_key) status = { text: 'Dùng thử', class: 'status-info' };
            else {
                const isExpired = key.expires_at && new Date(key.expires_at) < new Date();
                if (key.force_lock_reason) status = { text: 'Bị Cưỡng Chế', class: 'status-forced' };
                else if (isExpired) status = { text: 'Hết hạn', class: 'status-expired' };
                else if (key.is_locked) status = { text: 'Bị khóa', class: 'status-locked' };
                else if (key.is_activated) status = { text: 'Đã dùng', class: 'status-used' };
            }
            
            const row = document.createElement('tr');
            row.dataset.keyId = key.id;

            // ▼▼▼ CẬP NHẬT LOGIC HIỂN THỊ NÚT HÀNH ĐỘNG ▼▼▼
            let actionButtonsHTML = `
                <button class="btn btn-action btn-history" data-action="history">Log</button>
                <button class="btn btn-action ${key.is_locked ? 'btn-unlock' : 'btn-lock'}" data-action="toggle-lock">${key.is_locked ? 'Mở' : 'Khóa'}</button>
                <button class="btn btn-action btn-delete" data-action="delete">Xóa</button>
            `;
            // Nếu key có ngày hết hạn và không phải là key dùng thử, thêm các nút chức năng
            if (key.expires_at && !key.is_trial_key) {
                actionButtonsHTML += `
                    <button class="btn btn-action btn-info" data-action="extend" title="Gia hạn thêm ngày sử dụng">Gia hạn</button>
                    <button class="btn btn-action btn-success" data-action="make-permanent" title="Chuyển key thành vĩnh viễn">Vĩnh viễn</button>
                `;
            }
            // ▲▲▲ KẾT THÚC CẬP NHẬT LOGIC NÚT ▲▲▲

            row.innerHTML = `
                <td><input type="checkbox" class="key-checkbox" data-key-id="${key.id}"></td>
                <td>${new Date(key.created_at).toLocaleString('vi-VN')}</td>
                <td class="key-value">${key.activation_key}</td>
                <td><span class="status-badge ${status.class}" title="${key.force_lock_reason || ''}">${status.text}</span></td>
                <td>${key.expires_at ? new Date(key.expires_at).toLocaleDateString('vi-VN') : 'Vĩnh viễn'}</td>
                <td class="notes" title="${key.notes || ''}">${key.notes || '---'}</td>
                <td class="key-value" title="${key.metadata?.fingerprint || ''}">
                    ${(key.metadata?.fingerprint || '---').substring(0, 15)}
                    <span class="device-change-count">(${key.device_change_count}/5)</span>
                </td>
                <td>${key.activation_count}</td>
                <td>${key.last_heartbeat ? new Date(key.last_heartbeat).toLocaleString('vi-VN') : '---'}</td>
                <td class="actions">
                    ${actionButtonsHTML}
                </td>
            `;
            keyTableBody.appendChild(row);
        });
        updateSortIndicators();
    };
    
    const updateSortIndicators = () => {
        tableHeaders.forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sort === currentSort.by) {
                th.classList.add(currentSort.dir === 'ASC' ? 'sort-asc' : 'sort-desc');
            }
        });
    };

    createKeyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(createKeyForm);
        const data = Object.fromEntries(formData.entries());
        try {
            await fetch('/api/keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            fetchData();
            createKeyForm.reset();
        } catch (error) { alert(error.message); }
    });

    tableHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const sortBy = header.dataset.sort;
            if (currentSort.by === sortBy) {
                currentSort.dir = currentSort.dir === 'ASC' ? 'DESC' : 'ASC';
            } else {
                currentSort.by = sortBy;
                currentSort.dir = 'DESC';
            }
            fetchData();
        });
    });

    logoutButton.addEventListener('click', (e) => {
        e.preventDefault();
        fetch('/logout').catch(() => {});
        alert('Đã đăng xuất! Vui lòng đóng tab này. Lần truy cập tiếp theo sẽ yêu cầu đăng nhập lại.');
        document.body.innerHTML = '<h1>Đã đăng xuất. Hãy đóng trang.</h1>';
    });

    keyTableBody.addEventListener('click', async (e) => {
        const target = e.target;
        if (target.tagName !== 'BUTTON') return;
        const row = target.closest('tr');
        const keyId = row.dataset.keyId;
        const action = target.dataset.action;

        if (action === 'toggle-lock') {
            const response = await fetch(`/api/keys/${keyId}/toggle-lock`, { method: 'POST' });
            if (response.ok) fetchData();
        } else if (action === 'delete') {
            if (confirm(`Bạn có chắc muốn xóa key ID: ${keyId} không?`)) {
                const response = await fetch(`/api/keys/${keyId}/delete`, { method: 'POST' });
                if (response.ok) row.remove();
            }
        } else if (action === 'history') {
            showHistoryModal(keyId);
        } else if (action === 'make-permanent') {
            if (confirm(`Bạn có chắc muốn đổi key này thành VĨNH VIỄN không?`)) {
                const response = await fetch(`/api/keys/${keyId}/make-permanent`, { method: 'POST' });
                if (response.ok) {
                    alert('Đã cập nhật key thành vĩnh viễn!');
                    fetchData();
                } else {
                    alert('Có lỗi xảy ra, không thể cập nhật key.');
                }
            }
        } 
        // ▼▼▼ THÊM LOGIC XỬ LÝ CHO NÚT GIA HẠN ▼▼▼
        else if (action === 'extend') {
            const days = prompt('Bạn muốn gia hạn key thêm bao nhiêu ngày?', '30');
            if (days === null) return; // Người dùng nhấn Cancel
            
            const daysToAdd = parseInt(days);
            if (isNaN(daysToAdd) || daysToAdd <= 0) {
                return alert('Vui lòng nhập một số ngày hợp lệ (lớn hơn 0).');
            }

            try {
                const response = await fetch(`/api/keys/${keyId}/extend`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ days: daysToAdd })
                });
                const result = await response.json();
                alert(result.message);
                if (result.success) {
                    fetchData();
                }
            } catch (error) {
                alert('Lỗi khi gửi yêu cầu gia hạn.');
            }
        }
        // ▲▲▲ KẾT THÚC LOGIC XỬ LÝ ▲▲▲
    });

    // ... Các hàm còn lại giữ nguyên không thay đổi ...

    const updateBulkActionBar = () => {
        const selectedCheckboxes = document.querySelectorAll('.key-checkbox:checked');
        const count = selectedCheckboxes.length;
        selectionCountSpan.textContent = `Đã chọn: ${count}`;
        bulkActionBar.style.display = count > 0 ? 'flex' : 'none';
        const allCheckboxes = document.querySelectorAll('.key-checkbox');
        selectAllCheckbox.checked = count > 0 && allCheckboxes.length > 0 && count === allCheckboxes.length;
    };

    selectAllCheckbox.addEventListener('change', () => {
        document.querySelectorAll('.key-checkbox').forEach(cb => cb.checked = selectAllCheckbox.checked);
        updateBulkActionBar();
    });

    keyTableBody.addEventListener('change', (e) => {
        if (e.target.classList.contains('key-checkbox')) updateBulkActionBar();
    });

    bulkActionExecuteBtn.addEventListener('click', () => {
        const action = bulkActionSelect.value;
        const selectedIds = [...document.querySelectorAll('.key-checkbox:checked')].map(cb => cb.dataset.keyId);
        if (!action || selectedIds.length === 0) return alert('Vui lòng chọn hành động và ít nhất một key.');

        if (action === 'export') {
            const keysToExport = [];
            selectedIds.forEach(id => {
                const row = keyTableBody.querySelector(`tr[data-key-id='${id}']`);
                if (row) {
                    const keyText = row.cells[2].textContent;
                    keysToExport.push(keyText);
                }
            });
            exportTextarea.value = keysToExport.join('\n');
            exportModal.style.display = 'block';
            return;
        }

        passwordModal.style.display = 'block';
        const passwordConfirmButton = document.getElementById('password-confirm-button');
        const passwordInput = document.getElementById('password-confirm-input');
        const confirmHandler = async () => {
            const password = passwordInput.value;
            if (!password) return alert('Vui lòng nhập mật khẩu.');
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

    copyExportButton.addEventListener('click', () => {
        exportTextarea.select();
        document.execCommand('copy');
        copyExportButton.textContent = 'Đã sao chép!';
        setTimeout(() => { copyExportButton.textContent = 'Sao chép tất cả'; }, 2000);
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

    const loadNotificationHistory = async () => {
        try {
            const response = await fetch('/api/notifications');
            const notifications = await response.json();
            notificationHistoryUl.innerHTML = '';
            notifications.forEach(n => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <div>
                        <span class="log-time">${new Date(n.created_at).toLocaleString('vi-VN')}</span>
                        ${n.is_active ? '<strong class="active-notification">(Đang hoạt động)</strong>' : ''}
                    </div>
                    <p class="notification-message">${n.message}</p>
                    <button class="btn btn-action btn-delete" data-id="${n.id}">Xóa</button>
                `;
                notificationHistoryUl.appendChild(li);
            });
        } catch (error) {
            notificationHistoryUl.innerHTML = '<li>Lỗi khi tải lịch sử thông báo.</li>';
        }
    };

    manageNotificationsBtn.addEventListener('click', () => {
        notificationsModal.style.display = 'block';
        loadNotificationHistory();
    });

    notificationForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const messageInput = document.getElementById('notification-message');
        const message = messageInput.value;
        if (!message.trim()) return alert('Nội dung thông báo không được để trống.');
        try {
            await fetch('/api/notifications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            });
            messageInput.value = '';
            loadNotificationHistory();
        } catch (error) {
            alert('Lỗi khi gửi thông báo');
        }
    });

    notificationHistoryUl.addEventListener('click', async (e) => {
        if (e.target.tagName === 'BUTTON' && e.target.dataset.id) {
            if (confirm('Bạn có chắc muốn xóa thông báo này?')) {
                await fetch(`/api/notifications/${e.target.dataset.id}/delete`, { method: 'POST' });
                loadNotificationHistory();
            }
        }
    });
    
    document.querySelectorAll('.modal .close-button').forEach(btn => {
        btn.addEventListener('click', () => btn.closest('.modal').style.display = 'none');
    });
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) e.target.style.display = 'none';
    });

    searchInput.addEventListener('input', () => { clearTimeout(debounceTimer); debounceTimer = setTimeout(fetchData, 300); });
    filterNotesInput.addEventListener('input', () => { clearTimeout(debounceTimer); debounceTimer = setTimeout(fetchData, 300); });
    statusFilter.addEventListener('change', fetchData);

    fetchData();
});