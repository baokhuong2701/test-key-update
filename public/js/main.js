document.addEventListener('DOMContentLoaded', () => {
    const keyTableBody = document.getElementById('key-table-body');
    const searchInput = document.getElementById('search-input');
    const statusFilter = document.getElementById('filter-status');
    const modal = document.getElementById('history-modal');
    const historyContent = document.getElementById('history-content');
    const closeButton = modal.querySelector('.close-button');

    let debounceTimer;

    const fetchData = async () => {
        const searchValue = searchInput.value;
        const statusValue = statusFilter.value;
        
        const params = new URLSearchParams();
        if (searchValue) params.append('search', searchValue);
        if (statusValue) params.append('status', statusValue);
        
        try {
            const response = await fetch(`/api/keys?${params.toString()}`);
            if (!response.ok) throw new Error(`Network response was not ok: ${response.statusText}`);
            const keys = await response.json();
            renderTable(keys);
        } catch (error) {
            console.error('Fetch error:', error);
            keyTableBody.innerHTML = `<tr><td colspan="7" class="error-text">Không thể tải dữ liệu. Vui lòng thử lại.</td></tr>`;
        }
    };

    const renderTable = (keys) => {
        keyTableBody.innerHTML = '';

        if (!keys || keys.length === 0) {
            keyTableBody.innerHTML = `<tr><td colspan="7" class="loading-text">Không tìm thấy key nào khớp.</td></tr>`;
            return;
        }

        keys.forEach(key => {
            let status = { text: 'Chưa dùng', class: 'status-ok' };
            const isExpired = key.expires_at && new Date(key.expires_at) < new Date();

            if (isExpired) status = { text: 'Hết hạn', class: 'status-expired' };
            else if (key.is_locked) status = { text: 'Bị khóa', class: 'status-locked' };
            else if (key.is_activated) status = { text: 'Đã dùng', class: 'status-used' };

            const creationDate = new Date(key.created_at).toLocaleString('vi-VN');
            const lastHeartbeat = key.last_heartbeat ? new Date(key.last_heartbeat).toLocaleString('vi-VN') : '---';
            const fingerprint = (key.metadata && key.metadata.fingerprint) ? key.metadata.fingerprint : '---';
            
            // SỬA CỘT ID THÀNH NGÀY TẠO
            const row = `
                <tr>
                    <td>${creationDate}</td>
                    <td class="key-value">${key.activation_key}</td>
                    <td><span class="status-badge ${status.class}">${status.text}</span></td>
                    <td class="key-value" title="${fingerprint}">${fingerprint.substring(0, 15)}...</td>
                    <td>${key.activation_count}</td>
                    <td>${lastHeartbeat}</td>
                    <td class="actions">
                        <button class="btn btn-action btn-history" data-key-id="${key.id}">Log</button>
                        <form action="/api/keys/${key.id}/toggle-lock" method="POST" style="display:inline;">
                            <button type="submit" class="btn btn-action ${key.is_locked ? 'btn-unlock' : 'btn-lock'}">${key.is_locked ? 'Mở' : 'Khóa'}</button>
                        </form>
                        <form action="/api/keys/${key.id}/delete" method="POST" style="display:inline;" onsubmit="return confirm('Bạn có chắc muốn xóa key ID: ${key.id} không?');">
                            <button type="submit" class="btn btn-action btn-delete">Xóa</button>
                        </form>
                    </td>
                </tr>
            `;
            keyTableBody.insertAdjacentHTML('beforeend', row);
        });
    };

    const showHistoryModal = async (keyId) => {
        historyContent.innerHTML = '<p>Đang tải lịch sử...</p>';
        modal.style.display = 'block';

        try {
            const response = await fetch(`/api/keys/${keyId}/logs`);
            const logs = await response.json();
            
            if (logs.length === 0) {
                historyContent.innerHTML = '<p>Không có lịch sử nào.</p>';
                return;
            }

            let html = '<ul class="history-list">';
            logs.forEach(log => {
                html += `<li>
                    <span class="log-time">${new Date(log.log_timestamp).toLocaleString('vi-VN')}</span>
                    <span class="log-action">${log.action}</span>
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

    keyTableBody.addEventListener('click', e => {
        if (e.target.classList.contains('btn-history')) {
            showHistoryModal(e.target.dataset.keyId);
        }
    });

    closeButton.addEventListener('click', () => modal.style.display = 'none');
    window.addEventListener('click', e => {
        if (e.target == modal) modal.style.display = 'none';
    });

    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(fetchData, 300);
    });

    statusFilter.addEventListener('change', fetchData);

    fetchData();

    // CẬP NHẬT REAL-TIME: Giảm thời gian tự động cập nhật xuống còn 5 giây
    setInterval(fetchData, 5000);
});