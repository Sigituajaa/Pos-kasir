const STORE_NAME = "OKTSHOP17";
const ADMIN_USER = "Admin123";
const ADMIN_PASS = "Oktshop17";

// DATA AWAL PRODUK
let products = JSON.parse(localStorage.getItem('pos_products')) || [
    { id: 1, name: 'Boci Urat', price: 12000, category: 'Makanan' },
    { id: 12, name: 'Es Jasjus', price: 2000, category: 'Minuman' },
    { id: 101, name: 'Keripik Kaca', price: 5000, category: 'Keripik' },
];

let cart = [];
let selectedPayment = '';
let lastOrder = null;
let currentCategory = 'Makanan';
let orderHistory = JSON.parse(localStorage.getItem('pos_history')) || [];
let nextReceiptNum = parseInt(localStorage.getItem('pos_receipt_counter')) || 1;

// Flag: ada permintaan "Transfer Data" yang menunggu koneksi online
let pendingTransferRequest = JSON.parse(localStorage.getItem('pos_pending_transfer')) || false;

function init() {
    filterCategory('Makanan');
    updateCartUI();
    startClock();
    updateConnectionUI();
    registerServiceWorker();
    lucide.createIcons();

    // Pantau perubahan koneksi supaya data otomatis "tersimpan/transfer" saat online kembali
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
}

// --- JAM & TANGGAL DIGITAL ---
function startClock() {
    updateClock();
    setInterval(updateClock, 1000);
}

function updateClock() {
    const now = new Date();
    const time = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const date = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const clockEl = document.getElementById('live-clock');
    const dateEl = document.getElementById('live-date');
    if (clockEl) clockEl.innerText = time;
    if (dateEl) dateEl.innerText = date;
}

// --- KONEKSI & TRANSFER DATA (OFFLINE-FIRST) ---
// Semua transaksi & perubahan katalog SELALU tersimpan lokal (localStorage) dulu,
// baik online maupun offline, sehingga aplikasi tetap berjalan penuh tanpa internet.
// Tombol "Transfer Data" menandai kapan data terakhir "disinkronkan" saat online.

function countUnsyncedOrders() {
    return orderHistory.filter(o => !o.synced).length;
}

function updateConnectionUI() {
    const btn = document.getElementById('btn-transfer');
    const badge = document.getElementById('pending-badge');
    const unsynced = countUnsyncedOrders();

    if (!btn) return;
    btn.classList.remove('is-online', 'is-offline', 'is-syncing');

    const icon = btn.querySelector('i');
    if (navigator.onLine) {
        btn.classList.add('is-online');
        if (icon) icon.setAttribute('data-lucide', 'upload-cloud');
    } else {
        btn.classList.add('is-offline');
        if (icon) icon.setAttribute('data-lucide', 'cloud-off');
    }

    if (unsynced > 0) {
        badge.textContent = unsynced > 99 ? '99+' : unsynced;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
    lucide.createIcons();
}

function showToast(message, type = '') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

function transferData() {
    // Data selalu sudah tersimpan di perangkat (localStorage) meski offline.
    if (!navigator.onLine) {
        pendingTransferRequest = true;
        localStorage.setItem('pos_pending_transfer', JSON.stringify(true));
        updateConnectionUI();
        showToast('Sedang offline. Data akan otomatis ditransfer saat online kembali.', 'warn');
        return;
    }
    performTransfer();
}

function performTransfer() {
    const btn = document.getElementById('btn-transfer');
    if (btn) btn.classList.add('is-syncing');

    // Simulasi proses sinkronisasi singkat, lalu tandai semua transaksi sebagai tersinkron
    setTimeout(() => {
        orderHistory = orderHistory.map(o => ({ ...o, synced: true }));
        localStorage.setItem('pos_history', JSON.stringify(orderHistory));
        localStorage.setItem('pos_products', JSON.stringify(products));

        pendingTransferRequest = false;
        localStorage.setItem('pos_pending_transfer', JSON.stringify(false));

        if (btn) btn.classList.remove('is-syncing');
        updateConnectionUI();
        showToast('Data berhasil ditransfer!', 'success');
    }, 600);
}

function handleOnline() {
    updateConnectionUI();
    if (pendingTransferRequest) {
        performTransfer();
    } else {
        showToast('Koneksi online kembali.', 'success');
    }
}

function handleOffline() {
    updateConnectionUI();
    showToast('Koneksi terputus. Aplikasi tetap bisa digunakan (offline).', 'warn');
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {
            // Diam-diam abaikan jika gagal (misal dibuka langsung dari file://)
        });
    }
}

// --- KATEGORI & KATALOG ---
function filterCategory(cat) {
    currentCategory = cat;
    document.querySelectorAll('.category-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeTab = document.getElementById(`tab-${cat}`);
    activeTab.classList.add('active');
    renderCatalog();
}

function renderCatalog() {
    const grid = document.getElementById('catalog-grid');
    const filtered = products.filter(p => p.category === currentCategory);
    grid.innerHTML = filtered.map((p, idx) => `
        <div onclick="addToCart(${p.id})" style="animation-delay:${idx * 0.03}s" class="product-card p-5 rounded-[1.75rem] cursor-pointer">
            <h3 class="font-extrabold text-slate-800 text-sm mb-2 leading-tight">${p.name}</h3>
            <p class="text-blue-600 font-black">Rp ${p.price.toLocaleString()}</p>
        </div>
    `).join('') || `<div class="col-span-full text-center py-10 text-slate-400 text-sm">Belum ada menu di kategori ini</div>`;
}

// --- ADMIN FUNCTIONS (TAMBAH, EDIT, HAPUS) ---
function addProduct() {
    const name = document.getElementById('add-name').value;
    const price = parseInt(document.getElementById('add-price').value);
    const category = document.getElementById('add-category').value;

    if (!name || !price) return alert("Harap isi Nama dan Harga!");

    const newProduct = {
        id: Date.now(), // Unique ID
        name: name,
        price: price,
        category: category
    };

    products.push(newProduct);
    saveAndRefresh();

    // Reset Form
    document.getElementById('add-name').value = '';
    document.getElementById('add-price').value = '';
    alert("Produk berhasil ditambahkan!");
}

function loadProductData() {
    const id = parseInt(document.getElementById('edit-select').value);
    const product = products.find(p => p.id === id);
    if (product) {
        document.getElementById('edit-name').value = product.name;
        document.getElementById('edit-price').value = product.price;
        document.getElementById('edit-category').value = product.category;
    }
}

function updateProduct() {
    const id = parseInt(document.getElementById('edit-select').value);
    const idx = products.findIndex(p => p.id === id);
    if (idx !== -1) {
        products[idx].name = document.getElementById('edit-name').value;
        products[idx].price = parseInt(document.getElementById('edit-price').value);
        products[idx].category = document.getElementById('edit-category').value;
        saveAndRefresh();
        alert('Berhasil diperbarui!');
    }
}

function deleteProduct() {
    const id = parseInt(document.getElementById('edit-select').value);
    if (confirm("Hapus menu ini dari katalog?")) {
        products = products.filter(p => p.id !== id);
        saveAndRefresh();
        alert('Produk dihapus!');
    }
}

function saveAndRefresh() {
    localStorage.setItem('pos_products', JSON.stringify(products));
    renderCatalog();
    renderAdminTools();
}

function renderAdminTools() {
    const select = document.getElementById('edit-select');
    select.innerHTML = products.map(p => `<option value="${p.id}">${p.name} [${p.category}]</option>`).join('');
    loadProductData();
    document.getElementById('today-count').innerText = orderHistory.length;

    // Top Item Sales
    const summary = {};
    orderHistory.forEach(o => o.items.forEach(i => {
        summary[i.name] = (summary[i.name] || 0) + i.qty;
    }));
    const sortedItems = Object.entries(summary).sort((a, b) => b[1] - a[1]);
    document.getElementById('item-sales-list').innerHTML = sortedItems.map(([name, qty]) => `
        <div class="flex justify-between text-[11px] p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span class="font-bold">${name}</span>
            <span class="bg-blue-600 text-white px-2 rounded font-bold">${qty}</span>
        </div>
    `).join('') || '<p class="text-xs text-slate-400">Belum ada penjualan</p>';
}

// --- TRANSAKSI FUNCTIONS ---
function addToCart(id) {
    const product = products.find(p => p.id === id);
    const existing = cart.find(item => item.id === id);
    if (existing) { existing.qty++; } else { cart.push({ ...product, qty: 1 }); }
    updateCartUI();
}

function updateQty(id, delta) {
    const item = cart.find(i => i.id === id);
    if (item) {
        item.qty += delta;
        if (item.qty <= 0) cart = cart.filter(i => i.id !== id);
    }
    updateCartUI();
    renderCartItems();
}

function updateCartUI() {
    const count = cart.reduce((sum, item) => sum + item.qty, 0);
    const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    document.getElementById('cart-count').innerText = count;
    document.getElementById('total-price').innerText = `Rp ${total.toLocaleString()}`;
}

function openCheckout() {
    if (cart.length === 0) return alert('Pilih produk dulu!');
    document.getElementById('modal-checkout').classList.remove('hidden');
    renderCartItems();
}

function closeCheckout() {
    document.getElementById('modal-checkout').classList.add('hidden');
    selectedPayment = '';
    updatePaymentButtons();
}

function renderCartItems() {
    const container = document.getElementById('cart-items');
    container.innerHTML = cart.map(item => `
        <div class="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-100 text-sm">
            <div>
                <p class="font-bold text-slate-800">${item.name}</p>
                <p class="text-blue-600 font-bold">Rp ${(item.price * item.qty).toLocaleString()}</p>
            </div>
            <div class="flex items-center gap-3 bg-slate-50 p-1 rounded-xl font-bold">
                <button onclick="updateQty(${item.id}, -1)" class="qty-btn w-8 h-8 text-slate-400">-</button>
                <span>${item.qty}</span>
                <button onclick="updateQty(${item.id}, 1)" class="qty-btn w-8 h-8 text-slate-400">+</button>
            </div>
        </div>
    `).join('');
}

function setPayment(method) {
    selectedPayment = method;
    updatePaymentButtons();
    document.getElementById('confirm-pay').disabled = false;

    // Kalau metode QRIS dipilih, langsung tampilkan kode QRIS agar bisa discan pembeli
    if (method === 'QRIS') {
        showQrisModal();
    }
}

function updatePaymentButtons() {
    const btns = { 'Cash': 'btn-cash', 'QRIS': 'btn-qr', 'Shopee': 'btn-sf' };
    Object.values(btns).forEach(id => {
        document.getElementById(id).className = "pay-btn border-2 p-4 rounded-2xl text-[11px] font-bold bg-white border-slate-200 relative";
    });
    if (btns[selectedPayment]) {
        document.getElementById(btns[selectedPayment]).className = "pay-btn border-2 p-4 rounded-2xl text-[11px] font-bold bg-blue-50 border-blue-600 text-blue-700 relative";
    }

    // Ikon mata kecil di tombol QRIS untuk membuka ulang kode QR kapan saja setelah dipilih
    const qrisEye = document.getElementById('qris-eye');
    if (qrisEye) {
        qrisEye.classList.toggle('hidden', selectedPayment !== 'QRIS');
        qrisEye.classList.toggle('flex', selectedPayment === 'QRIS');
    }
    lucide.createIcons();
}

function showQrisModal() {
    document.getElementById('modal-qris').classList.remove('hidden');
    lucide.createIcons();
}

function closeQrisModal() {
    document.getElementById('modal-qris').classList.add('hidden');
}

// Jeda konfirmasi: tampilkan modal "Yakin lanjut?" sebelum benar-benar memproses pesanan
function askConfirmOrder() {
    document.getElementById('modal-confirm-order').classList.remove('hidden');
    lucide.createIcons();
}

function cancelConfirmOrder() {
    document.getElementById('modal-confirm-order').classList.add('hidden');
}

function processOrder() {
    document.getElementById('modal-confirm-order').classList.add('hidden');

    const receiptID = nextReceiptNum.toString().padStart(5, '0');
    lastOrder = {
        id: receiptID,
        date: new Date().toLocaleString('id-ID'),
        total: cart.reduce((sum, item) => sum + (item.price * item.qty), 0),
        method: selectedPayment,
        items: JSON.parse(JSON.stringify(cart)),
        synced: navigator.onLine // langsung ditandai tersinkron jika saat itu online
    };
    orderHistory.push(lastOrder);
    localStorage.setItem('pos_history', JSON.stringify(orderHistory));
    nextReceiptNum++;
    localStorage.setItem('pos_receipt_counter', nextReceiptNum);

    updateConnectionUI();

    document.getElementById('modal-checkout').classList.add('hidden');
    document.getElementById('modal-success').classList.remove('hidden');
    lucide.createIcons();
}

function finishTransaction() {
    cart = [];
    lastOrder = null;
    updateCartUI();
    document.getElementById('modal-success').classList.add('hidden');
    filterCategory('Makanan');
}

// --- PRINT & LOGIN ---
function openLoginModal() { document.getElementById('modal-login').classList.remove('hidden'); }
function closeLoginModal() { document.getElementById('modal-login').classList.add('hidden'); }
function checkLogin() {
    if (document.getElementById('login-user').value === ADMIN_USER && document.getElementById('login-pass').value === ADMIN_PASS) {
        closeLoginModal(); showPage('admin');
    } else { alert("Akses Ditolak!"); }
}
function showPage(page) {
    document.getElementById('page-home').classList.toggle('hidden', page !== 'home');
    document.getElementById('bottom-bar').classList.toggle('hidden', page !== 'home');
    document.getElementById('page-admin').classList.toggle('hidden', page !== 'admin');
    if (page === 'admin') renderAdminTools();
    lucide.createIcons();
}

function sendWhatsApp() {
    if (!lastOrder) return;
    let phone = document.getElementById('wa-number').value.replace(/[^0-9]/g, "");
    if (phone.startsWith("0")) phone = "62" + phone.slice(1);
    let text = `*STRUK ${STORE_NAME}*%0A------------------%0A`;
    lastOrder.items.forEach(i => text += `${i.name} x${i.qty} = ${i.price * i.qty}%0A`);
    text += `------------------%0A*TOTAL: Rp ${lastOrder.total}*`;
    window.open(`https://wa.me/${phone}?text=${text}`, '_blank');
}

// Cetak struk PDF dengan garis pemisah (dashed) agar terlihat rapi seperti struk kasir asli
function printReceipt() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: [80, 150] });
    const pageWidth = 80;
    const marginX = 5;
    const rightX = pageWidth - marginX;

    const drawDashedLine = (y) => {
        doc.setLineDashPattern([1, 1], 0);
        doc.setDrawColor(120, 120, 120);
        doc.line(marginX, y, rightX, y);
        doc.setLineDashPattern([], 0);
    };

    // HEADER
    doc.setFontSize(13).setFont(undefined, 'bold');
    doc.text(STORE_NAME, pageWidth / 2, 10, { align: "center" });
    doc.setFontSize(7).setFont(undefined, 'normal');
    doc.text("Digital Point of Sales", pageWidth / 2, 15, { align: "center" });

    let y = 20;
    drawDashedLine(y);
    y += 5;

    doc.setFontSize(8);
    doc.text(`No: ${lastOrder.id}`, marginX, y);
    doc.text(`${lastOrder.date}`, rightX, y, { align: "right" });
    y += 4;
    doc.text(`Metode: ${lastOrder.method}`, marginX, y);
    y += 3;

    drawDashedLine(y);
    y += 6;

    // ITEMS
    lastOrder.items.forEach(i => {
        doc.text(`${i.name} x${i.qty}`, marginX, y);
        doc.text(`${(i.price * i.qty).toLocaleString()}`, rightX, y, { align: "right" });
        y += 6;
    });

    drawDashedLine(y);
    y += 6;

    // TOTAL
    doc.setFontSize(10).setFont(undefined, 'bold');
    doc.text(`TOTAL`, marginX, y);
    doc.text(`Rp ${lastOrder.total.toLocaleString()}`, rightX, y, { align: "right" });
    y += 4;

    drawDashedLine(y);
    y += 6;

    // FOOTER
    doc.setFontSize(7).setFont(undefined, 'normal');
    doc.text("Terima kasih telah berbelanja!", pageWidth / 2, y, { align: "center" });

    doc.save(`Struk-${lastOrder.id}.pdf`);
}

function downloadPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.text("History Transaksi OKTSHOP17", 10, 10);
    const data = orderHistory.map(o => [o.id, o.date, o.method, o.total]);
    doc.autoTable({ head: [['No', 'Tgl', 'Metode', 'Total']], body: data });
    doc.save("History-Penjualan.pdf");
}

function downloadItemReportPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const summary = {};
    orderHistory.forEach(o => o.items.forEach(i => {
        if (!summary[i.name]) summary[i.name] = { qty: 0, rev: 0 };
        summary[i.name].qty += i.qty;
        summary[i.name].rev += (i.qty * i.price);
    }));
    const data = Object.entries(summary).map(([name, val]) => [name, val.qty, val.rev]);
    doc.autoTable({ head: [['Produk', 'Terjual', 'Pendapatan']], body: data });
    doc.save("Laporan-Item.pdf");
}

init();
