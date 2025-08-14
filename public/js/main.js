document.addEventListener('DOMContentLoaded', () => {
    const addKeyForm = document.getElementById('add-key-form');
    const keyTableBody = document.querySelector('#key-table tbody');

    // Xử lý sự kiện thêm key
    addKeyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const res = await fetch('/api/keys', { method: 'POST' });
            if (!res.ok) throw new Error('Không thể tạo key');
            
            // Tải lại trang để cập nhật danh sách
            location.reload(); 
        } catch (err) {
            alert(err.message);
        }
    });

    // Xử lý sự kiện xóa key
    keyTableBody.addEventListener('click', async (e) => {
        if (e.target.classList.contains('delete-btn')) {
            const row = e.target.closest('tr');
            const keyId = row.dataset.id;
            
            if (confirm(`Bạn có chắc chắn muốn xóa key ID: ${keyId} không?`)) {
                try {
                    const res = await fetch(`/api/keys/${keyId}`, { method: 'DELETE' });
                    if (!res.ok) throw new Error('Không thể xóa key');
                    
                    row.remove(); // Xóa hàng khỏi bảng
                } catch (err) {
                    alert(err.message);
                }
            }
        }
    });
});