document.addEventListener('DOMContentLoaded', () => {
    const keyTableBody = document.getElementById('key-table-body');
    const searchInput = document.getElementById('search-input');
    const statusFilter = document.getElementById('filter-status');

    let debounceTimer;

    // Hàm để lấy dữ liệu từ server dựa trên bộ lọc
    const fetchData = async () => {
        const searchValue = searchInput.value;
        const statusValue = statusFilter.value;
        
        const params = new URLSearchParams();
        if (searchValue) params.append('search', searchValue);
        if (statusValue) params.append('status', statusValue);
        
        try {
            const response = await fetch(`/api/keys?${params.toString()}`);
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            const keys = await response.json();
            renderTable(keys);
        } catch (error) {
            console.error('Fetch error:', error);
            keyTableBody.innerHTML = `<tr><td colspan="7" class="error-text">Không thể tải dữ liệu. Vui lòng thử lại.</td></tr>`;
        }
    };

    // Hàm để render lại bảng dữ liệu
    const renderTable = (keys) => {
        keyTableBody.innerHTML = ''; // Xóa dữ liệu cũ

        if (keys.length === 0) {
            keyTableBody.innerHTML = `<tr><td colspan="7" class="loading-text">Không tìm thấy key nào.</td></tr>`;
            return;
        }

        keys.forEach(key => {
            let status = { text: 'Chưa dùng', class: 'status-ok' };
            const isExpired = key.expires_at && new Date(key.expires_at) < new Date();

            if (isExpired) status = { text: 'Hết hạn', class: 'status-expired' };
            else if (key.is_locked) status = { text: 'Bị khóa', class: 'status-locked' };
            else if (key.is_activated) status = { text: 'Đã dùng', class: 'status-used' };

            const expiresDate = key.expires_at ? new Date(key.expires_at).toLocaleDateString('vi-VN') : 'Vĩnh viễn';
            const machineInfo = (key.metadata && key.metadata.machineId) ? key.metadata.machineId : '---';

            const row = `
                <tr>
                    <td>${key.id}</td>
                    <td class="key-value">${key.activation_key}</td>
                    <td><span class="status-badge ${status.class}">${status.text}</span></td>
                    <td class="key-value">${machineInfo}</td>
                    <td>${key.activation_count}</td>
                    <td>${expiresDate}</td>
                    <td class="actions">
                        <form action="/api/keys/${key.id}/toggle-lock" method="POST" style="display:inline;">
                            <button type="submit" class="btn-action ${key.is_locked ? 'btn-unlock' : 'btn-lock'}">${key.is_locked ? 'Mở' : 'Khóa'}</button>
                        </form>
                        <form action="/api/keys/${key.id}/delete" method="POST" style="display:inline;" onsubmit="return confirm('Bạn có chắc muốn xóa key ID: ${key.id} không?');">
                            <button type="submit" class="btn-action btn-delete">Xóa</button>
                        </form>
                    </td>
                </tr>
            `;
            keyTableBody.insertAdjacentHTML('beforeend', row);
        });
    };

    // Lắng nghe sự kiện thay đổi trên các bộ lọc
    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(fetchData, 300); // Chờ 300ms sau khi người dùng ngừng gõ rồi mới tìm kiếm
    });

    statusFilter.addEventListener('change', fetchData);

    // Tải dữ liệu lần đầu khi trang được mở
    fetchData();

    // Tự động cập nhật dữ liệu mỗi 10 giây
    setInterval(fetchData, 10000);
});