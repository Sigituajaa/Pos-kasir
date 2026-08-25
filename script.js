const STORE_NAME = "OKTSHOP17";
const ADMIN_USER = "Admin123";
const ADMIN_PASS = "Oktshop17";
const ADMIN_WA_NUMBER = "62895345452412"; // nomor WhatsApp admin tujuan bukti pembayaran QRIS

// --- KONFIGURASI GOOGLE DRIVE (WAJIB DIISI SENDIRI SEBELUM FITUR DRIVE BISA DIPAKAI) ---
// Cara dapetin nilai-nilai ini:
// 1. Buka https://console.cloud.google.com -> buat project baru (gratis)
// 2. Aktifkan "Google Drive API" di menu "APIs & Services > Library"
// 3. Ke "APIs & Services > Credentials" -> Create Credentials -> OAuth Client ID
//    - Application type: Web application
//    - Authorized JavaScript origins: isi domain kamu, misal https://gituajaa.github.io
//    - Salin "Client ID" yang muncul ke GOOGLE_DRIVE_CLIENT_ID di bawah
// 4. Buat API Key juga di halaman yang sama (Create Credentials -> API Key), salin ke GOOGLE_DRIVE_API_KEY
// 5. Buat folder di Google Drive kamu untuk simpan bukti bayar, buka foldernya,
//    salin ID folder dari URL (bagian setelah /folders/) ke GOOGLE_DRIVE_FOLDER_ID
// 6. Share folder itu ke akun Google Admin (kalau beda akun) supaya Admin dapat notifikasi otomatis dari Drive
const GOOGLE_DRIVE_CLIENT_ID = 'GANTI_DENGAN_CLIENT_ID_KAMU.apps.googleusercontent.com';
const GOOGLE_DRIVE_API_KEY = 'GANTI_DENGAN_API_KEY_KAMU';
const GOOGLE_DRIVE_FOLDER_ID = ''; // kosongkan untuk simpan di folder utama (My Drive)

// DATA AWAL PRODUK
let products = JSON.parse(localStorage.getItem('pos_products')) || [
    { id: 1, name: 'Boci Urat', price: 12000, category: 'Makanan' },
    { id: 12, name: 'Es Jasjus', price: 2000, category: 'Minuman' },
    { id: 101, name: 'Keripik Kaca', price: 5000, category: 'Keripik' },
];

// DATA KATEGORI (bisa ditambah/dihapus lewat Pengaturan Kategori di menu admin)
let categories = JSON.parse(localStorage.getItem('pos_categories')) || ['Makanan', 'Minuman', 'Keripik'];

let cart = [];
let selectedPayment = '';
let lastOrder = null;
let currentCategory = categories[0] || '';
let orderHistory = JSON.parse(localStorage.getItem('pos_history')) || [];
let nextReceiptNum = parseInt(localStorage.getItem('pos_receipt_counter')) || 1;

// Flag: ada permintaan "Transfer Data" yang menunggu koneksi online
let pendingTransferRequest = JSON.parse(localStorage.getItem('pos_pending_transfer')) || false;

function init() {
    renderCategoryTabs();
    renderCategorySelects();
    filterCategory(currentCategory);
    updateCartUI();
    startClock();
    updateConnectionUI();
    updateProofBadge();
    loadAttendanceSettingsToForm();
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

    updateDashboardLock(now);
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

    // Ingatkan kasir kalau ada foto bukti bayar QRIS yang belum sempat dikirim saat offline.
    // Browser tidak mengizinkan mengirim ke WhatsApp otomatis tanpa sentuhan pengguna,
    // jadi kita tampilkan pengingat + badge supaya kasir tinggal 1x tap untuk mengirim.
    const pending = getPendingProofs();
    if (pending.length > 0) {
        showToast(`${pending.length} bukti bayar QRIS menunggu dikirim. Tap ikon kamera di pojok kanan atas.`, 'warn');
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
function renderCategoryTabs() {
    const container = document.getElementById('tabs-container');
    if (!container) return;
    container.innerHTML = categories.map(cat => `
        <button onclick="filterCategory('${cat.replace(/'/g, "\\'")}')" id="tab-${cat}" class="category-tab whitespace-nowrap">${cat}</button>
    `).join('');
}

function filterCategory(cat) {
    currentCategory = cat;
    document.querySelectorAll('.category-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeTab = document.getElementById(`tab-${cat}`);
    if (activeTab) activeTab.classList.add('active');
    renderCatalog();
}

function renderCatalog() {
    const grid = document.getElementById('catalog-grid');
    const filtered = products.filter(p => p.category === currentCategory);
    grid.innerHTML = filtered.map((p, idx) => {
        const hasVariant = p.variantConfig && p.variantConfig.enabled;
        const isOutOfStock = p.stock != null && p.stock <= 0;
        const clickAction = isOutOfStock ? '' : (hasVariant ? `openVariantModal(${p.id})` : `addToCart(${p.id})`);
        return `
        <div onclick="${clickAction}" style="animation-delay:${idx * 0.03}s" class="product-card p-5 rounded-[1.75rem] relative ${isOutOfStock ? 'opacity-50 grayscale cursor-not-allowed' : 'cursor-pointer'}">
            ${isOutOfStock ? `<span class="absolute top-3 right-3 bg-red-100 text-red-600 text-[9px] font-bold px-2 py-1 rounded-full">HABIS</span>` : hasVariant ? `<span class="absolute top-3 right-3 bg-blue-100 text-blue-600 text-[9px] font-bold px-2 py-1 rounded-full">PILIH ISI</span>` : ''}
            <h3 class="font-extrabold text-slate-800 text-sm mb-2 leading-tight pr-2">${p.name}</h3>
            <p class="text-blue-600 font-black">Rp ${p.price.toLocaleString()}</p>
            ${(!isOutOfStock && p.stock != null) ? `<p class="text-[10px] text-slate-400 font-semibold mt-1">Sisa ${p.stock}</p>` : ''}
        </div>`;
    }).join('') || `<div class="col-span-full text-center py-10 text-slate-400 text-sm">Belum ada menu di kategori ini</div>`;
}

// --- ADMIN FUNCTIONS (TAMBAH, EDIT, HAPUS) ---
function toggleVariantFields(prefix) {
    const enabled = document.getElementById(`${prefix}-variant-enabled`).checked;
    document.getElementById(`${prefix}-variant-fields`).classList.toggle('hidden', !enabled);
}

function readVariantConfig(prefix) {
    const enabled = document.getElementById(`${prefix}-variant-enabled`).checked;
    if (!enabled) return { enabled: false };
    const count = parseInt(document.getElementById(`${prefix}-variant-count`).value) || 1;
    const sourceCategory = document.getElementById(`${prefix}-variant-source`).value;
    return { enabled: true, count, sourceCategory };
}

function addProduct() {
    const name = document.getElementById('add-name').value;
    const price = parseInt(document.getElementById('add-price').value);
    const category = document.getElementById('add-category').value;
    const variantConfig = readVariantConfig('add');

    if (!name || isNaN(price) || price < 0) return alert("Harap isi Nama dan Harga (boleh 0 untuk item pilihan rasa)!");
    if (variantConfig.enabled && !variantConfig.sourceCategory) return alert("Pilih kategori sumber untuk pilihan isi/rasa!");

    const newProduct = {
        id: Date.now(), // Unique ID
        name: name,
        price: price,
        category: category,
        variantConfig: variantConfig
    };

    products.push(newProduct);
    saveAndRefresh();

    // Reset Form
    document.getElementById('add-name').value = '';
    document.getElementById('add-price').value = '';
    document.getElementById('add-variant-enabled').checked = false;
    document.getElementById('add-variant-count').value = '';
    toggleVariantFields('add');
    alert("Produk berhasil ditambahkan!");
}

function loadProductData() {
    const id = parseInt(document.getElementById('edit-select').value);
    const product = products.find(p => p.id === id);
    if (product) {
        document.getElementById('edit-name').value = product.name;
        document.getElementById('edit-price').value = product.price;
        document.getElementById('edit-category').value = product.category;

        const vc = product.variantConfig || { enabled: false };
        document.getElementById('edit-variant-enabled').checked = !!vc.enabled;
        document.getElementById('edit-variant-count').value = vc.count || '';
        toggleVariantFields('edit');
        if (vc.sourceCategory) document.getElementById('edit-variant-source').value = vc.sourceCategory;
    }
}

function updateProduct() {
    const id = parseInt(document.getElementById('edit-select').value);
    const idx = products.findIndex(p => p.id === id);
    const variantConfig = readVariantConfig('edit');
    if (variantConfig.enabled && !variantConfig.sourceCategory) return alert("Pilih kategori sumber untuk pilihan isi/rasa!");
    if (idx !== -1) {
        products[idx].name = document.getElementById('edit-name').value;
        products[idx].price = parseInt(document.getElementById('edit-price').value);
        products[idx].category = document.getElementById('edit-category').value;
        products[idx].variantConfig = variantConfig;
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

// --- PENGATURAN KATEGORI ---
function renderCategorySelects() {
    const options = categories.map(c => `<option value="${c}">${c}</option>`).join('');
    const addSelect = document.getElementById('add-category');
    const editSelect = document.getElementById('edit-category');
    const addVariantSource = document.getElementById('add-variant-source');
    const editVariantSource = document.getElementById('edit-variant-source');
    if (addSelect) addSelect.innerHTML = options;
    if (editSelect) editSelect.innerHTML = options;
    if (addVariantSource) addVariantSource.innerHTML = options;
    if (editVariantSource) editVariantSource.innerHTML = options;
}

function renderCategoryList() {
    const list = document.getElementById('category-list');
    if (!list) return;
    list.innerHTML = categories.map(cat => {
        const count = products.filter(p => p.category === cat).length;
        return `
        <div class="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-xl p-3">
            <div>
                <span class="font-bold text-sm text-slate-800">${cat}</span>
                <span class="text-[10px] text-slate-400 ml-2">${count} produk</span>
            </div>
            <button onclick="deleteCategory('${cat.replace(/'/g, "\\'")}')" class="text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
        </div>`;
    }).join('') || '<p class="text-xs text-slate-400">Belum ada kategori</p>';
    lucide.createIcons();
}

function addCategory() {
    const input = document.getElementById('new-category-name');
    const name = input.value.trim();
    if (!name) return alert('Nama kategori tidak boleh kosong!');
    if (categories.some(c => c.toLowerCase() === name.toLowerCase())) {
        return alert('Kategori tersebut sudah ada!');
    }
    categories.push(name);
    localStorage.setItem('pos_categories', JSON.stringify(categories));
    input.value = '';
    renderCategoryTabs();
    renderCategorySelects();
    renderCategoryList();
    // Jika ini kategori pertama yang pernah ada, langsung tampilkan di katalog
    if (categories.length === 1) filterCategory(name);
}

function deleteCategory(cat) {
    const used = products.filter(p => p.category === cat).length;
    if (used > 0) {
        return alert(`Kategori "${cat}" masih dipakai oleh ${used} produk. Pindahkan atau hapus produk tersebut dulu sebelum menghapus kategorinya.`);
    }
    if (!confirm(`Hapus kategori "${cat}"?`)) return;
    categories = categories.filter(c => c !== cat);
    localStorage.setItem('pos_categories', JSON.stringify(categories));
    renderCategoryTabs();
    renderCategorySelects();
    renderCategoryList();
    // Kalau kategori yang sedang aktif dihapus, pindah ke kategori pertama yang tersisa
    if (currentCategory === cat) {
        filterCategory(categories[0] || '');
    }
}

function renderAdminTools() {
    const select = document.getElementById('edit-select');
    select.innerHTML = products.map(p => `<option value="${p.id}">${p.name} [${p.category}]</option>`).join('');
    renderCategorySelects();
    renderCategoryList();
    renderStockManageList();
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

// --- KELOLA STOCK (Admin) ---
// stock null/undefined = tidak dilacak (dianggap tidak terbatas, selalu bisa dijual)
function renderStockManageList() {
    const list = document.getElementById('stock-manage-list');
    if (!list) return;
    list.innerHTML = products.map(p => `
        <div class="flex items-center justify-between gap-3 bg-slate-50 border border-slate-100 rounded-xl p-3">
            <div class="min-w-0">
                <p class="font-bold text-sm text-slate-800 truncate">${p.name}</p>
                <p class="text-[10px] text-slate-400">${p.category}</p>
            </div>
            <input
                type="number"
                min="0"
                value="${p.stock ?? ''}"
                placeholder="∞"
                onchange="updateProductStock(${p.id}, this.value)"
                class="w-20 p-2 text-center border border-slate-200 rounded-lg outline-none text-sm font-bold shrink-0"
            >
        </div>
    `).join('') || '<p class="text-xs text-slate-400 text-center py-6">Belum ada produk</p>';
}

function updateProductStock(id, value) {
    const idx = products.findIndex(p => p.id === id);
    if (idx === -1) return;
    if (value === '' || value === null) {
        delete products[idx].stock; // kosongkan = tidak dilacak / tidak terbatas
    } else {
        products[idx].stock = Math.max(0, parseInt(value) || 0);
    }
    localStorage.setItem('pos_products', JSON.stringify(products));
    renderCatalog();
    showToast('Stock diperbarui!', 'success');
}

function decreaseStockForOrder(items) {
    let changed = false;
    items.forEach(item => {
        const lookupId = item.productId ?? item.id; // item keranjang varian pakai productId ke produk aslinya
        const idx = products.findIndex(p => p.id === lookupId);
        if (idx !== -1 && products[idx].stock != null) {
            products[idx].stock = Math.max(0, products[idx].stock - item.qty);
            changed = true;
        }
    });
    if (changed) {
        localStorage.setItem('pos_products', JSON.stringify(products));
        renderCatalog();
    }
}

// --- STOCK KASIR (read-only, dibuka dari tombol di panel Menu Utama) ---
function openStockKasir() {
    renderStockKasir();
    const modal = document.getElementById('modal-stock-kasir');
    modal.classList.remove('hidden');
    lucide.createIcons();
}

function closeStockKasir() {
    document.getElementById('modal-stock-kasir').classList.add('hidden');
}

function renderStockKasir() {
    const body = document.getElementById('stock-kasir-body');
    if (!body) return;
    body.innerHTML = products.map(p => {
        const hasStock = p.stock != null;
        const isEmpty = hasStock && p.stock <= 0;
        const badgeClass = isEmpty ? 'bg-red-100 text-red-600' : hasStock ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400';
        const stockLabel = hasStock ? p.stock : '∞';
        return `
        <tr class="border-b border-slate-50">
            <td class="p-3 font-semibold text-slate-700">${p.name}</td>
            <td class="p-3 text-slate-400">${p.category}</td>
            <td class="p-3 text-right">
                <span class="${badgeClass} px-2.5 py-1 rounded-full font-bold text-[11px]">${stockLabel}</span>
            </td>
        </tr>`;
    }).join('') || `<tr><td colspan="3" class="text-center p-8 text-slate-400 text-xs">Belum ada produk</td></tr>`;
}

// --- TRANSAKSI FUNCTIONS ---
function addToCart(id) {
    const product = products.find(p => p.id === id);
    const existing = cart.find(item => item.id === id);
    if (existing) { existing.qty++; } else { cart.push({ ...product, qty: 1 }); }
    updateCartUI();
}

// --- PILIH VARIAN/ISI (misal paket "Cireng Kuah Keju 4Pcs" -> pilih 4 rasa dari kategori "Cireng/Pcs") ---
let variantModalState = { product: null, options: [], selections: {} };

function openVariantModal(productId) {
    const product = products.find(p => p.id === productId);
    if (!product || !product.variantConfig || !product.variantConfig.enabled) return addToCart(productId);

    const sourceCategory = product.variantConfig.sourceCategory;
    const options = products.filter(p => p.category === sourceCategory);

    if (options.length === 0) {
        return alert(`Belum ada menu di kategori "${sourceCategory}" untuk dipilih. Tambahkan dulu menunya lewat Admin Panel.`);
    }

    variantModalState = { product, options, selections: {} };
    options.forEach(o => variantModalState.selections[o.id] = 0);

    document.getElementById('variant-title').innerText = `Pilih Isi - ${product.name}`;
    renderVariantOptions();
    document.getElementById('modal-variant').classList.remove('hidden');
    lucide.createIcons();
}

function closeVariantModal() {
    document.getElementById('modal-variant').classList.add('hidden');
}

function adjustVariantQty(optionId, delta) {
    const state = variantModalState;
    const required = state.product.variantConfig.count;
    const totalSelected = Object.values(state.selections).reduce((a, b) => a + b, 0);

    if (delta > 0 && totalSelected >= required) return; // sudah penuh, tidak bisa nambah lagi
    const next = (state.selections[optionId] || 0) + delta;
    if (next < 0) return;
    state.selections[optionId] = next;
    renderVariantOptions();
}

function renderVariantOptions() {
    const state = variantModalState;
    const required = state.product.variantConfig.count;
    const totalSelected = Object.values(state.selections).reduce((a, b) => a + b, 0);

    document.getElementById('variant-subtitle').innerText = `Dipilih ${totalSelected}/${required}`;
    document.getElementById('variant-options').innerHTML = state.options.map(o => `
        <div class="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-100">
            <span class="font-bold text-sm text-slate-800">${o.name}</span>
            <div class="flex items-center gap-3 bg-slate-50 p-1 rounded-xl font-bold">
                <button onclick="adjustVariantQty(${o.id}, -1)" class="qty-btn w-8 h-8 text-slate-400">-</button>
                <span>${state.selections[o.id] || 0}</span>
                <button onclick="adjustVariantQty(${o.id}, 1)" class="qty-btn w-8 h-8 text-slate-400">+</button>
            </div>
        </div>
    `).join('');

    const confirmBtn = document.getElementById('variant-confirm-btn');
    confirmBtn.disabled = totalSelected !== required;
    lucide.createIcons();
}

function confirmVariantSelection() {
    const state = variantModalState;
    const required = state.product.variantConfig.count;
    const totalSelected = Object.values(state.selections).reduce((a, b) => a + b, 0);
    if (totalSelected !== required) return;

    const chosen = state.options
        .filter(o => state.selections[o.id] > 0)
        .map(o => ({ name: o.name, qty: state.selections[o.id] }));

    cart.push({
        id: `v_${Date.now()}`,
        productId: state.product.id, // referensi ke produk asli, dipakai untuk pengurangan stock
        name: state.product.name,
        price: state.product.price,
        category: state.product.category,
        qty: 1,
        variantSelections: chosen
    });

    updateCartUI();
    closeVariantModal();
}

function updateQty(id, delta) {
    const item = cart.find(i => i.id == id); // '==' agar id numerik produk & id string varian ('v_...') tetap cocok
    if (item) {
        item.qty += delta;
        if (item.qty <= 0) cart = cart.filter(i => i.id != id);
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

    // Gerbang wajib absen: kasir harus sudah absen masuk & belum absen pulang hari ini.
    // Kalau belum, tampilkan menu "Absensi Hari Ini" melayang (dashboard tetap terlihat transparan
    // di belakang) sebagai gantinya, bukan langsung buka pembayaran.
    const status = getAttendanceStatus();
    if (!status.canTransact) {
        showToast(status.message, 'warn');
        openAbsenPopup();
        return;
    }

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
    container.innerHTML = cart.map(item => {
        const variantNote = item.variantSelections
            ? `<p class="text-[11px] text-slate-500 mt-1">${item.variantSelections.map(v => `${v.name} x${v.qty}`).join(', ')}</p>`
            : '';
        return `
        <div class="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-100 text-sm">
            <div class="pr-3">
                <p class="font-bold text-slate-800">${item.name}</p>
                ${variantNote}
                <p class="text-blue-600 font-bold mt-1">Rp ${(item.price * item.qty).toLocaleString()}</p>
            </div>
            <div class="flex items-center gap-3 bg-slate-50 p-1 rounded-xl font-bold shrink-0">
                <button onclick="updateQty('${item.id}', -1)" class="qty-btn w-8 h-8 text-slate-400">-</button>
                <span>${item.qty}</span>
                <button onclick="updateQty('${item.id}', 1)" class="qty-btn w-8 h-8 text-slate-400">+</button>
            </div>
        </div>`;
    }).join('');
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

// --- BUKTI PEMBAYARAN QRIS (foto -> simpan offline -> kirim WhatsApp Admin) ---
// Catatan teknis: browser TIDAK mengizinkan sebuah web app mengirim pesan/gambar WhatsApp
// secara diam-diam di background tanpa sentuhan pengguna (baik pakai Web Share API maupun
// link wa.me). Jadi alurnya: foto selalu tersimpan otomatis (walau offline), dan begitu ada
// koneksi + ada aksi pengguna (ambil foto, atau tap ikon kamera saat online kembali),
// aplikasi langsung membuka share/WhatsApp dengan sekali tap.

function getPendingProofs() {
    return JSON.parse(localStorage.getItem('pos_pending_proofs')) || [];
}

function savePendingProofs(list) {
    localStorage.setItem('pos_pending_proofs', JSON.stringify(list));
    updateProofBadge();
}

function updateProofBadge() {
    const count = getPendingProofs().length;
    const btn = document.getElementById('btn-proof');
    const badge = document.getElementById('proof-badge');
    if (!btn) return;
    btn.classList.toggle('hidden', count === 0);
    if (badge) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.classList.toggle('hidden', count === 0);
    }
}

// Kompres foto sebelum disimpan supaya tidak cepat memenuhi kuota localStorage
function compressImage(file, maxWidth = 1000, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, maxWidth / img.width);
                const canvas = document.createElement('canvas');
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function dataUrlToFile(dataUrl, filename) {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) { u8arr[n] = bstr.charCodeAt(n); }
    return new File([u8arr], filename, { type: mime });
}

let activeProofId = null; // proof yang sedang ditampilkan di modal aksi (WA / Drive)

async function handleQrisPhotoCapture(event) {
    const file = event.target.files[0];
    event.target.value = ''; // reset supaya bisa ambil foto lagi nanti
    if (!file) return;

    const label = document.getElementById('qris-capture-label');
    label.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Menyimpan foto...`;
    lucide.createIcons();

    try {
        const dataUrl = await compressImage(file);
        const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
        const proof = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            dataUrl,
            total
        };

        const list = getPendingProofs();
        list.push(proof);
        savePendingProofs(list);

        closeQrisModal();

        if (navigator.onLine) {
            openProofActionModal(proof.id);
        } else {
            showToast('Offline - foto tersimpan. Nanti diingatkan untuk dikirim/disimpan saat online kembali.', 'warn');
        }
    } catch (err) {
        showToast('Gagal menyimpan foto, coba lagi.', 'warn');
    } finally {
        label.innerHTML = `<i data-lucide="camera" class="w-5 h-5"></i> Ambil Gambar/Foto`;
        lucide.createIcons();
    }
}

// --- MODAL PILIHAN TUJUAN (muncul begitu foto selesai diambil, saat online) ---
function openProofActionModal(proofId) {
    activeProofId = proofId;
    document.getElementById('modal-proof-action').classList.remove('hidden');
    lucide.createIcons();
}

function closeProofActionModal() {
    activeProofId = null;
    document.getElementById('modal-proof-action').classList.add('hidden');
}

function handleActionSend(channel) {
    const proof = getPendingProofs().find(p => p.id === activeProofId);
    closeProofActionModal();
    if (!proof) return;
    if (channel === 'wa') trySendProofWhatsApp(proof);
    if (channel === 'drive') trySaveProofToDrive(proof);
}

// --- KIRIM VIA WHATSAPP ---
async function trySendProofWhatsApp(proof) {
    const caption = `Bukti Pembayaran QRIS - ${STORE_NAME}\nWaktu: ${new Date(proof.timestamp).toLocaleString('id-ID')}\nNominal: Rp ${proof.total.toLocaleString()}`;
    const file = dataUrlToFile(proof.dataUrl, `bukti-qris-${proof.id}.jpg`);

    // Cara terbaik: Web Share API langsung ke WhatsApp (kalau didukung HP-nya)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({
                files: [file],
                title: 'Bukti Pembayaran QRIS',
                text: caption
            });
            removePendingProof(proof.id);
            showToast('Bukti pembayaran terkirim!', 'success');
            return;
        } catch (err) {
            if (err.name === 'AbortError') {
                // Kasir membatalkan share, foto tetap disimpan sebagai pending
                return;
            }
            // Kalau share gagal karena sebab lain, lanjut ke fallback di bawah
        }
    }

    // Fallback: buka chat WhatsApp Admin dengan teks siap kirim + unduh fotonya
    // (link wa.me tidak bisa melampirkan gambar otomatis, jadi foto diunduh untuk dilampirkan manual)
    const waLink = `https://wa.me/${ADMIN_WA_NUMBER}?text=${encodeURIComponent(caption + '\n\n(Mohon lampirkan foto bukti pembayaran yang otomatis terunduh)')}`;
    window.open(waLink, '_blank');

    const downloadLink = document.createElement('a');
    downloadLink.href = proof.dataUrl;
    downloadLink.download = `bukti-qris-${proof.id}.jpg`;
    downloadLink.click();

    removePendingProof(proof.id);
    showToast('WhatsApp Admin dibuka & foto terunduh. Silakan lampirkan fotonya.', 'success');
}

// --- SIMPAN KE GOOGLE DRIVE ---
let driveTokenClient = null;
let driveAccessToken = null;
let driveAccessTokenExpiry = 0;

function isDriveConfigured() {
    return GOOGLE_DRIVE_CLIENT_ID && !GOOGLE_DRIVE_CLIENT_ID.startsWith('GANTI_') &&
        GOOGLE_DRIVE_API_KEY && !GOOGLE_DRIVE_API_KEY.startsWith('GANTI_');
}

function ensureDriveAccessToken() {
    return new Promise((resolve, reject) => {
        if (driveAccessToken && Date.now() < driveAccessTokenExpiry) {
            return resolve(driveAccessToken);
        }
        if (!window.google || !google.accounts || !google.accounts.oauth2) {
            return reject(new Error('Google Identity Services belum siap. Pastikan koneksi internet aktif.'));
        }
        if (!driveTokenClient) {
            driveTokenClient = google.accounts.oauth2.initTokenClient({
                client_id: GOOGLE_DRIVE_CLIENT_ID,
                scope: 'https://www.googleapis.com/auth/drive.file',
                callback: () => {} // di-override tiap request di bawah
            });
        }
        driveTokenClient.callback = (resp) => {
            if (resp.error) { reject(resp); return; }
            driveAccessToken = resp.access_token;
            driveAccessTokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
            resolve(driveAccessToken);
        };
        driveTokenClient.requestAccessToken({ prompt: driveAccessToken ? '' : 'consent' });
    });
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) { binary += String.fromCharCode(bytes[i]); }
    return btoa(binary);
}

async function uploadProofToDrive(proof) {
    const token = await ensureDriveAccessToken();
    const file = dataUrlToFile(proof.dataUrl, `bukti-qris-${proof.id}.jpg`);

    const metadata = {
        name: `Bukti QRIS - Rp${proof.total} - ${new Date(proof.timestamp).toLocaleString('id-ID')}.jpg`,
        mimeType: file.type,
        ...(GOOGLE_DRIVE_FOLDER_ID ? { parents: [GOOGLE_DRIVE_FOLDER_ID] } : {})
    };

    const boundary = 'pos_kasir_boundary_' + proof.id;
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelim = `\r\n--${boundary}--`;
    const base64Data = arrayBufferToBase64(await file.arrayBuffer());

    const multipartBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        `Content-Type: ${file.type}\r\n` +
        'Content-Transfer-Encoding: base64\r\n\r\n' +
        base64Data +
        closeDelim;

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: multipartBody
    });

    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

async function trySaveProofToDrive(proof) {
    if (!isDriveConfigured()) {
        showToast('Google Drive belum dikonfigurasi. Isi dulu Client ID & API Key di script.js.', 'warn');
        return;
    }
    showToast('Menghubungkan ke Google Drive...', '');
    try {
        await uploadProofToDrive(proof);
        removePendingProof(proof.id);
        showToast('Foto berhasil disimpan ke Google Drive!', 'success');
    } catch (err) {
        showToast('Gagal simpan ke Google Drive. Cek koneksi/izin akun.', 'warn');
    }
}

function removePendingProof(id) {
    const list = getPendingProofs().filter(p => p.id !== id);
    savePendingProofs(list);
    if (document.getElementById('modal-proof-list') && !document.getElementById('modal-proof-list').classList.contains('hidden')) {
        renderProofList();
    }
}

function openPendingProofs() {
    renderProofList();
    document.getElementById('modal-proof-list').classList.remove('hidden');
    lucide.createIcons();
}

function closePendingProofs() {
    document.getElementById('modal-proof-list').classList.add('hidden');
}

function proofActionFromList(id, channel) {
    const proof = getPendingProofs().find(p => p.id === id);
    if (!proof) return;
    if (channel === 'wa') trySendProofWhatsApp(proof);
    if (channel === 'drive') trySaveProofToDrive(proof);
}

function renderProofList() {
    const list = getPendingProofs();
    const body = document.getElementById('proof-list-body');
    body.innerHTML = list.map(p => `
        <div class="border border-slate-100 rounded-2xl overflow-hidden">
            <img src="${p.dataUrl}" class="w-full h-40 object-cover">
            <div class="p-4">
                <p class="text-xs text-slate-500 font-semibold">${new Date(p.timestamp).toLocaleString('id-ID')}</p>
                <p class="text-blue-600 font-black text-sm mt-0.5">Rp ${p.total.toLocaleString()}</p>
                <div class="flex gap-2 mt-3">
                    <button onclick="removePendingProof(${p.id})" class="bg-red-50 text-red-500 p-3 rounded-xl shrink-0"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                    <button onclick="proofActionFromList(${p.id}, 'wa')" class="flex-1 bg-emerald-500 text-white py-3 rounded-xl font-bold text-[11px] flex items-center justify-center gap-1.5">
                        <i data-lucide="message-circle" class="w-4 h-4"></i> WhatsApp
                    </button>
                    <button onclick="proofActionFromList(${p.id}, 'drive')" class="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold text-[11px] flex items-center justify-center gap-1.5">
                        <i data-lucide="hard-drive" class="w-4 h-4"></i> Drive
                    </button>
                </div>
            </div>
        </div>
    `).join('') || `<p class="text-center text-slate-400 text-sm py-10">Tidak ada bukti pembayaran yang menunggu dikirim/disimpan</p>`;
    lucide.createIcons();
}

// --- ABSENSI KARYAWAN (overlay wajib di jendela waktu yang diatur Admin) ---
// Admin mengatur "jam pokok" absen masuk & pulang, plus toleransi (maks 120 menit / 2 jam)
// sebelum & sesudah jam pokok tsb. Jendela absen aktual dihitung otomatis dari 2 nilai ini,
// contoh: jam pokok 14:00 & toleransi 60 menit -> jendela absen 13:00-15:00.
function clampTolerance(val) {
    let n = parseInt(val, 10);
    if (isNaN(n) || n < 0) n = 0;
    if (n > 120) n = 120; // maksimal 2 jam sesuai aturan
    return n;
}

// Geser "HH:MM" sejumlah menit (dibatasi tetap di hari yang sama, 00:00 - 23:59)
function addMinutesToTime(timeStr, deltaMinutes) {
    if (!timeStr) return null;
    const [h, m] = timeStr.split(':').map(Number);
    let total = h * 60 + m + deltaMinutes;
    total = Math.max(0, Math.min(23 * 60 + 59, total));
    const hh = Math.floor(total / 60).toString().padStart(2, '0');
    const mm = (total % 60).toString().padStart(2, '0');
    return `${hh}:${mm}`;
}

function computeAttendanceWindow(baseTime, toleranceMin) {
    const tol = clampTolerance(toleranceMin);
    return {
        start: addMinutesToTime(baseTime, -tol),
        end: addMinutesToTime(baseTime, tol)
    };
}

// --- JADWAL MASUK KARYAWAN (kalender per-tanggal, dikelola Admin) ---
// Setiap tanggal punya jadwal sendiri: jam pokok masuk & pulang + toleransi (maks 120 menit/2 jam),
// atau ditandai sebagai hari libur (tidak ada jadwal kerja/absen hari itu).
function getScheduleMap() {
    return JSON.parse(localStorage.getItem('pos_schedule_map')) || {};
}

function saveScheduleMap(map) {
    localStorage.setItem('pos_schedule_map', JSON.stringify(map));
}

// Ambil jadwal tanggal tertentu, otomatis dibuatkan default (08:00-22:00, toleransi 60 menit)
// kalau tanggal itu belum pernah diatur Admin.
function getOrCreateDaySchedule(dateStr) {
    const map = getScheduleMap();
    if (!map[dateStr]) {
        map[dateStr] = { masukTime: '08:00', masukTolerance: 60, keluarTime: '22:00', keluarTolerance: 60, libur: false };
        saveScheduleMap(map);
    }
    return map[dateStr];
}

function saveDaySchedule(dateStr, data) {
    const map = getScheduleMap();
    map[dateStr] = { ...getOrCreateDaySchedule(dateStr), ...data };
    saveScheduleMap(map);
}

function getKasirName() {
    return localStorage.getItem('pos_kasir_name') || '';
}

function saveKasirName() {
    const nameEl = document.getElementById('att-kasir-name');
    localStorage.setItem('pos_kasir_name', (nameEl ? nameEl.value.trim() : ''));
    showToast('Nama kasir tersimpan!', 'success');
}

// Jendela absen + status hari libur untuk tanggal tertentu (default hari ini)
function getAttendanceSettings(dateStr) {
    dateStr = dateStr || getTodayDateStr();
    const day = getOrCreateDaySchedule(dateStr);
    const masukTolerance = clampTolerance(day.masukTolerance);
    const keluarTolerance = clampTolerance(day.keluarTolerance);
    const masukWin = computeAttendanceWindow(day.masukTime, masukTolerance);
    const keluarWin = computeAttendanceWindow(day.keluarTime, keluarTolerance);
    return {
        kasirName: getKasirName(),
        libur: !!day.libur,
        masukTime: day.masukTime, masukTolerance,
        keluarTime: day.keluarTime, keluarTolerance,
        masukStart: masukWin.start, masukEnd: masukWin.end,
        keluarStart: keluarWin.start, keluarEnd: keluarWin.end
    };
}

// --- KALENDER JADWAL (grid bulanan, klik tanggal untuk edit) ---
let scheduleCalYear = new Date().getFullYear();
let scheduleCalMonth = new Date().getMonth(); // 0-11
let scheduleDayEditorDate = null;

function prevScheduleMonth() {
    scheduleCalMonth--;
    if (scheduleCalMonth < 0) { scheduleCalMonth = 11; scheduleCalYear--; }
    renderScheduleCalendar();
}

function nextScheduleMonth() {
    scheduleCalMonth++;
    if (scheduleCalMonth > 11) { scheduleCalMonth = 0; scheduleCalYear++; }
    renderScheduleCalendar();
}

function renderScheduleCalendar() {
    const titleEl = document.getElementById('schedule-cal-title');
    const gridEl = document.getElementById('schedule-cal-grid');
    if (!titleEl || !gridEl) return;

    const namaBulan = new Date(scheduleCalYear, scheduleCalMonth, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    titleEl.innerText = namaBulan;

    const firstDay = new Date(scheduleCalYear, scheduleCalMonth, 1);
    const startOffset = firstDay.getDay(); // 0 = Minggu
    const daysInMonth = new Date(scheduleCalYear, scheduleCalMonth + 1, 0).getDate();
    const todayStr = getTodayDateStr();

    let html = '';
    for (let i = 0; i < startOffset; i++) {
        html += `<div></div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(scheduleCalYear, scheduleCalMonth, d);
        const dateStr = getTodayDateStr(dateObj);
        const sched = getOrCreateDaySchedule(dateStr);
        const isToday = dateStr === todayStr;

        let cellClasses = 'rounded-lg p-1.5 text-center cursor-pointer transition ';
        let badge = '';
        if (sched.libur) {
            cellClasses += 'bg-red-100 hover:bg-red-200';
            badge = `<p class="text-[7px] font-bold text-red-500 leading-tight mt-0.5">LIBUR</p>`;
        } else {
            cellClasses += 'bg-white hover:bg-indigo-100 border border-indigo-100';
            badge = `<p class="text-[7px] font-bold text-indigo-400 leading-tight mt-0.5">${sched.masukTime}</p>`;
        }
        if (isToday) cellClasses += ' ring-2 ring-indigo-500';

        html += `
            <div class="${cellClasses}" onclick="openScheduleDayEditor('${dateStr}')">
                <p class="text-xs font-bold ${sched.libur ? 'text-red-600' : 'text-slate-700'}">${d}</p>
                ${badge}
            </div>`;
    }
    gridEl.innerHTML = html;
    lucide.createIcons();
}

function openScheduleDayEditor(dateStr) {
    scheduleDayEditorDate = dateStr;
    const sched = getOrCreateDaySchedule(dateStr);
    const dateLabel = new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    document.getElementById('schedule-day-date-label').innerText = dateLabel;
    document.getElementById('schedule-day-libur').checked = !!sched.libur;
    document.getElementById('schedule-day-masuk-time').value = sched.masukTime;
    document.getElementById('schedule-day-masuk-tol').value = sched.masukTolerance;
    document.getElementById('schedule-day-keluar-time').value = sched.keluarTime;
    document.getElementById('schedule-day-keluar-tol').value = sched.keluarTolerance;
    toggleScheduleDayLiburFields();

    const modal = document.getElementById('modal-schedule-day');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    lucide.createIcons();
}

function closeScheduleDayEditor() {
    const modal = document.getElementById('modal-schedule-day');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    scheduleDayEditorDate = null;
}

function toggleScheduleDayLiburFields() {
    const isLibur = document.getElementById('schedule-day-libur').checked;
    const fields = document.getElementById('schedule-day-time-fields');
    if (fields) fields.classList.toggle('opacity-40', isLibur);
    ['schedule-day-masuk-time', 'schedule-day-masuk-tol', 'schedule-day-keluar-time', 'schedule-day-keluar-tol'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = isLibur;
    });
}

function saveScheduleDayEditor() {
    if (!scheduleDayEditorDate) return;
    const libur = document.getElementById('schedule-day-libur').checked;
    const masukTime = document.getElementById('schedule-day-masuk-time').value;
    const keluarTime = document.getElementById('schedule-day-keluar-time').value;
    const masukTolerance = clampTolerance(document.getElementById('schedule-day-masuk-tol').value);
    const keluarTolerance = clampTolerance(document.getElementById('schedule-day-keluar-tol').value);

    if (!libur && (!masukTime || !keluarTime)) {
        return alert('Jam pokok absen masuk & pulang wajib diisi (kecuali hari libur)!');
    }

    saveDaySchedule(scheduleDayEditorDate, { libur, masukTime, masukTolerance, keluarTime, keluarTolerance });
    const editedDate = scheduleDayEditorDate;
    closeScheduleDayEditor();
    renderScheduleCalendar();
    showToast('Jadwal tersimpan!', 'success');

    // Kalau yang diedit jadwal hari ini, langsung terapkan ke status kunci dashboard
    if (editedDate === getTodayDateStr()) updateDashboardLock();
}

// --- QR CODE ABSEN (validasi kehadiran, menggantikan cek GPS) ---
function getQrToken() {
    return localStorage.getItem('pos_attendance_qr_token') || null;
}

function generateAttendanceQR() {
    const token = 'ABSEN-' + Math.random().toString(36).substring(2, 10).toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
    localStorage.setItem('pos_attendance_qr_token', token);
    renderAttendanceQR();
    showToast('QR baru berhasil dibuat! QR lama sudah tidak berlaku.', 'success');
}

function renderAttendanceQR() {
    const container = document.getElementById('qr-absen-container');
    const codeBox = document.getElementById('qr-absen-code-box');
    const codeText = document.getElementById('qr-absen-code-text');
    if (!container) return;
    container.innerHTML = '';
    const token = getQrToken();
    if (!token) {
        container.innerHTML = '<p class="text-xs text-slate-400 text-center py-8">Belum ada QR. Tap "Generate QR Baru".</p>';
        if (codeBox) codeBox.classList.add('hidden');
        return;
    }
    new QRCode(container, { text: token, width: 180, height: 180, colorDark: '#000000', colorLight: '#ffffff' });
    if (codeBox && codeText) {
        codeText.innerText = token;
        codeBox.classList.remove('hidden');
    }
}

// Salin kode absen (dipakai Admin utk dikasih ke kasir kalau QR susah/error di-scan)
function copyAttendanceQRCode() {
    const token = getQrToken();
    if (!token) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(token)
            .then(() => showToast('Kode berhasil disalin!', 'success'))
            .catch(() => fallbackCopyText(token));
    } else {
        fallbackCopyText(token);
    }
}

function fallbackCopyText(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        showToast('Kode berhasil disalin!', 'success');
    } catch (e) {
        showToast('Gagal menyalin kode', 'warn');
    }
    document.body.removeChild(ta);
}

// --- SCANNER QR (kamera live, decode pakai jsQR, tidak butuh internet sama sekali) ---
let qrScanStream = null;
let qrScanRAF = null;
let qrScanPendingType = null; // 'masuk' | 'keluar'
let qrScanHintTimeout = null;

async function openQrScanner(type) {
    if (!getQrToken()) {
        showToast('QR Absen belum di-generate Admin. Hubungi Admin dulu.', 'warn');
        return;
    }

    qrScanPendingType = type;
    const modal = document.getElementById('modal-qr-scanner');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('qr-scanner-status').innerText = 'Mengaktifkan kamera...';
    lucide.createIcons();

    try {
        // continuous autofocus diminta secara eksplisit karena live-preview kamera di browser
        // sering tidak auto-fokus dengan baik di jarak dekat (beda dengan app kamera native)
        qrScanStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                advanced: [{ focusMode: 'continuous' }]
            }
        }).catch(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }));

        const video = document.getElementById('qr-scanner-video');
        video.srcObject = qrScanStream;
        await video.play();
        document.getElementById('qr-scanner-status').innerText = 'Arahkan kamera ke QR Absen di toko';
        qrScanRAF = requestAnimationFrame(qrScanTick);

        // Kalau 6 detik belum ke-detect, kasih hint supaya coba tombol "Ambil Foto"
        clearTimeout(qrScanHintTimeout);
        qrScanHintTimeout = setTimeout(() => {
            const statusEl = document.getElementById('qr-scanner-status');
            if (statusEl && qrScanRAF) {
                statusEl.innerText = 'Susah kebaca? Pastikan cahaya cukup & tidak ada pantulan, atau tap "Ambil Foto" di bawah';
            }
        }, 6000);
    } catch (err) {
        document.getElementById('qr-scanner-status').innerText = 'Gagal akses kamera. Cek izin kamera di browser.';
    }
}

function qrScanTick() {
    const video = document.getElementById('qr-scanner-video');
    const canvas = document.getElementById('qr-scanner-canvas');
    if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
        if (code && code.data) {
            handleQrScanResult(code.data);
            return; // hentikan loop, biar handleQrScanResult yang mengatur lanjutannya
        }
    }
    qrScanRAF = requestAnimationFrame(qrScanTick);
}

// Fallback: kalau live-scan susah (blur/pantulan cahaya), kasir bisa ambil 1 foto pakai
// kamera native HP (biasanya auto-fokusnya lebih baik dari live-preview browser) lalu di-decode sekali.
function handleQrFallbackPhoto(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;

    document.getElementById('qr-scanner-status').innerText = 'Memproses foto...';

    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
        img.onload = () => {
            const canvas = document.getElementById('qr-scanner-canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
            if (code && code.data) {
                handleQrScanResult(code.data);
            } else {
                document.getElementById('qr-scanner-status').innerText = 'QR tidak terbaca dari foto. Coba lagi dengan pencahayaan lebih terang.';
                qrScanRAF = requestAnimationFrame(qrScanTick);
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function handleQrScanResult(scannedText) {
    clearTimeout(qrScanHintTimeout);
    const expected = getQrToken();
    if (scannedText === expected) {
        const type = qrScanPendingType;
        closeQrScanner();
        saveAttendanceRecord(type);
        if (document.getElementById('modal-absen-popup') && !document.getElementById('modal-absen-popup').classList.contains('hidden')) {
            renderAbsenPopup();
        }
    } else {
        document.getElementById('qr-scanner-status').innerText = 'QR tidak valid. Scan QR resmi yang ada di toko.';
        setTimeout(() => { qrScanRAF = requestAnimationFrame(qrScanTick); }, 1200);
    }
}

function closeQrScanner() {
    const modal = document.getElementById('modal-qr-scanner');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    if (qrScanRAF) cancelAnimationFrame(qrScanRAF);
    qrScanRAF = null;
    clearTimeout(qrScanHintTimeout);
    if (qrScanStream) {
        qrScanStream.getTracks().forEach(t => t.stop());
        qrScanStream = null;
    }
    qrScanPendingType = null;

    // reset input kode manual biar bersih untuk sesi scan berikutnya
    const codeBox = document.getElementById('qr-manual-code-box');
    const codeInput = document.getElementById('qr-manual-code-input');
    if (codeBox) { codeBox.classList.add('hidden'); codeBox.classList.remove('flex'); }
    if (codeInput) codeInput.value = '';
}

// Fallback: kalau kamera & foto tetap tidak bisa baca QR, kasir bisa masukkan kode
// absen yang disalin Admin dari menu QR Admin secara manual.
function toggleQrManualCodeInput() {
    const box = document.getElementById('qr-manual-code-box');
    if (!box) return;
    const showing = box.classList.contains('hidden');
    box.classList.toggle('hidden', !showing);
    box.classList.toggle('flex', showing);
    if (showing) {
        const input = document.getElementById('qr-manual-code-input');
        if (input) input.focus();
    }
}

function submitQrManualCode() {
    const input = document.getElementById('qr-manual-code-input');
    if (!input) return;
    const val = input.value.trim().toUpperCase();
    if (!val) {
        showToast('Masukkan kode absen dulu', 'warn');
        return;
    }
    input.value = '';
    handleQrScanResult(val);
}

function loadAttendanceSettingsToForm() {
    const nameEl = document.getElementById('att-kasir-name');
    if (nameEl) nameEl.value = getKasirName();
    renderScheduleCalendar();
    renderAttendanceQR();
    renderAttendanceHistory();
}

function getTodayDateStr(date) {
    const d = date || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getAttendanceLog() {
    return JSON.parse(localStorage.getItem('pos_attendance_log')) || [];
}

function saveAttendanceLog(log) {
    localStorage.setItem('pos_attendance_log', JSON.stringify(log));
}

function getOrCreateTodayAttendance() {
    const todayStr = getTodayDateStr();
    const log = getAttendanceLog();
    let record = log.find(r => r.date === todayStr);
    if (!record) {
        record = { date: todayStr, masukTime: null, keluarTime: null };
        log.push(record);
        saveAttendanceLog(log);
    }
    return record;
}

// Cek apakah waktu "now" (Date) berada di antara "HH:MM" start dan end (asumsi tidak lewat tengah malam)
function isTimeInRange(now, startStr, endStr) {
    if (!startStr || !endStr) return false;
    const [sh, sm] = startStr.split(':').map(Number);
    const [eh, em] = endStr.split(':').map(Number);
    const start = new Date(now); start.setHours(sh, sm, 0, 0);
    const end = new Date(now); end.setHours(eh, em, 59, 999);
    return now >= start && now <= end;
}

// Status kunci transaksi: kasir HARUS sudah absen masuk & BELUM absen pulang hari ini
// supaya bisa transaksi. Di luar itu (belum absen / sudah absen pulang), transaksi terkunci
// sampai jendela absen berikutnya (otomatis reset tiap hari sesuai tanggal absen).
function getAttendanceStatus(now) {
    now = now || new Date();
    const settings = getAttendanceSettings();
    const record = getOrCreateTodayAttendance();

    if (settings.libur) {
        return {
            canTransact: false,
            reason: 'libur',
            message: 'Hari ini libur sesuai jadwal Admin. Tidak ada jadwal kerja/absen kasir.'
        };
    }

    const inMasukWindow = isTimeInRange(now, settings.masukStart, settings.masukEnd);

    if (record.keluarTime) {
        return {
            canTransact: false,
            reason: 'sudah-pulang',
            message: `Absen pulang sudah tercatat. Transaksi terkunci sampai absen masuk lagi besok pukul ${settings.masukStart} - ${settings.masukEnd}.`
        };
    }
    if (record.masukTime) {
        return { canTransact: true, reason: 'aktif', message: '' };
    }
    if (inMasukWindow) {
        return {
            canTransact: false,
            reason: 'wajib-absen-masuk',
            message: 'Absen masuk dulu sebelum bisa transaksi.'
        };
    }
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = settings.masukStart.split(':').map(Number);
    const startMin = sh * 60 + sm;
    if (nowMin < startMin) {
        return {
            canTransact: false,
            reason: 'belum-waktunya',
            message: `Belum waktunya absen. Absen masuk bisa dilakukan pukul ${settings.masukStart} - ${settings.masukEnd}.`
        };
    }
    return {
        canTransact: false,
        reason: 'terkunci',
        message: `Jendela absen masuk hari ini (${settings.masukStart} - ${settings.masukEnd}) sudah lewat. Transaksi terkunci sampai jendela absen besok.`
    };
}

// Status "terkunci"/tidak dihitung dari getAttendanceStatus(); gerbang wajib memakai
// popup "Absensi Hari Ini" (bukan overlay gradient terpisah) supaya satu UI konsisten:
// dashboard kasir (page-home) hanya bisa diakses kalau kasir sedang aktif absen masuk
// (sudah absen masuk & belum absen pulang) DALAM hari ini. Di luar itu, seluruh dashboard
// (bukan cuma tombol BAYAR) ditutup gerbang ini dan kasir wajib absen dulu untuk membuka akses.
// Admin selalu bisa lewat tombol gear -> Login Admin -> Panel Admin, terlepas status absen.
let currentPage = 'home';
let dashboardLocked = false;

function updateDashboardLock(now) {
    now = now || new Date();
    const status = getAttendanceStatus(now);
    const shouldLock = currentPage === 'home' && !status.canTransact;
    const modal = document.getElementById('modal-absen-popup');
    if (!modal) return;

    if (shouldLock) {
        dashboardLocked = true;
        renderAbsenPopup();
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        const closeBtn = document.getElementById('absen-popup-close-btn');
        if (closeBtn) closeBtn.classList.add('hidden');
        lucide.createIcons();
    } else if (dashboardLocked) {
        dashboardLocked = false;
        forceCloseAbsenPopup();
    }
}

// Fungsi inti penyimpanan absen, dipakai oleh flow scan QR (masuk) & konfirmasi (pulang)
function saveAttendanceRecord(type) {
    const todayStr = getTodayDateStr();
    const log = getAttendanceLog();
    const idx = log.findIndex(r => r.date === todayStr);
    const now = new Date().toISOString();

    if (idx !== -1) {
        if (type === 'masuk') log[idx].masukTime = now;
        if (type === 'keluar') log[idx].keluarTime = now;
        saveAttendanceLog(log);
    }

    renderAttendanceHistory();
    showToast(type === 'masuk' ? 'Absen masuk tercatat! Dashboard kasir terbuka.' : 'Absen pulang tercatat!', 'success');

    // Buka/tutup gerbang dashboard sesuai status terbaru
    updateDashboardLock();
}

// --- KONFIRMASI ABSEN KELUAR (tanpa scan QR) ---
function openConfirmKeluar() {
    const modal = document.getElementById('modal-confirm-keluar');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    lucide.createIcons();
}

function cancelConfirmKeluar() {
    const modal = document.getElementById('modal-confirm-keluar');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function confirmKeluar() {
    cancelConfirmKeluar();
    saveAttendanceRecord('keluar');
    if (document.getElementById('modal-absen-popup') && !document.getElementById('modal-absen-popup').classList.contains('hidden')) {
        renderAbsenPopup();
    }
}

function formatDurationHM(msDuration) {
    const totalMinutes = Math.floor(msDuration / 60000);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}j ${m}m`;
}

// --- POPUP ABSEN (dibuka manual lewat tombol fingerprint di header, ATAU otomatis sebagai
// gerbang wajib saat dashboard terkunci — lihat updateDashboardLock()) ---
function openAbsenPopup() {
    renderAbsenPopup();
    const modal = document.getElementById('modal-absen-popup');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    // Tombol tutup hanya tersedia kalau dashboard sedang TIDAK terkunci (sekadar dibuka manual untuk cek status)
    const closeBtn = document.getElementById('absen-popup-close-btn');
    if (closeBtn) closeBtn.classList.toggle('hidden', dashboardLocked);
    lucide.createIcons();
}

// Tutup paksa (dipakai internal: transisi ke scanner QR, ke admin, dsb), tidak terikat status kunci
function forceCloseAbsenPopup() {
    const modal = document.getElementById('modal-absen-popup');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

// Tutup lewat tombol X milik user: ditolak selama dashboard masih terkunci
function closeAbsenPopup() {
    if (dashboardLocked) {
        showToast('Absen dulu untuk membuka akses dashboard kasir.', 'warn');
        return;
    }
    forceCloseAbsenPopup();
}

// Tombol pengaturan di pojok kiri atas popup "Absensi Hari Ini" -> langsung ke Login Admin,
// supaya Admin bisa akses menu admin (ambil data absen karyawan/kasir) meski dashboard kasir terkunci.
function openAdminFromAbsen() {
    forceCloseAbsenPopup();
    openLoginModal();
}

function recordAttendanceManual(type) {
    // Absen HANYA boleh dilakukan di dalam jendela waktu yang diatur Admin (jam pokok ± toleransi,
    // maks 120 menit), dan tidak boleh sama sekali kalau hari ini ditandai libur.
    const settings = getAttendanceSettings();
    const now = new Date();

    if (settings.libur) {
        showToast('Hari ini libur sesuai jadwal Admin, tidak ada absen.', 'warn');
        renderAbsenPopup();
        return;
    }

    if (type === 'masuk') {
        if (!isTimeInRange(now, settings.masukStart, settings.masukEnd)) {
            showToast(`Absen masuk hanya bisa dilakukan pukul ${settings.masukStart} - ${settings.masukEnd}.`, 'warn');
            renderAbsenPopup();
            return;
        }
        forceCloseAbsenPopup();
        openQrScanner(type);
        return;
    }

    // Absen pulang: tap Keluar langsung minta konfirmasi, tidak perlu scan QR
    if (!isTimeInRange(now, settings.keluarStart, settings.keluarEnd)) {
        showToast(`Absen pulang hanya bisa dilakukan pukul ${settings.keluarStart} - ${settings.keluarEnd}.`, 'warn');
        renderAbsenPopup();
        return;
    }
    forceCloseAbsenPopup();
    openConfirmKeluar();
}

function renderAbsenPopup() {
    const record = getOrCreateTodayAttendance();
    const settings = getAttendanceSettings();
    const status = getAttendanceStatus();
    const dateStr = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('absen-popup-date').innerText = dateStr;

    const body = document.getElementById('absen-popup-body');
    const masukStr = record.masukTime ? new Date(record.masukTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : null;
    const keluarStr = record.keluarTime ? new Date(record.keluarTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : null;

    if (status.reason === 'libur') {
        body.innerHTML = `
            <div class="bg-slate-50 rounded-2xl p-5 text-center">
                <i data-lucide="calendar-x" class="w-6 h-6 text-slate-300 mx-auto mb-2"></i>
                <p class="text-sm text-slate-500 font-bold mb-1">Hari Ini Libur</p>
                <p class="text-xs text-slate-400">${status.message}</p>
            </div>`;
        lucide.createIcons();
        return;
    }

    if (!record.masukTime) {
        if (status.reason === 'wajib-absen-masuk') {
            // Sedang di dalam jendela absen masuk -> tampilkan tombol absen
            body.innerHTML = `
                <div class="bg-slate-50 rounded-2xl p-5 text-center mb-4">
                    <i data-lucide="clock" class="w-6 h-6 text-slate-300 mx-auto mb-2"></i>
                    <p class="text-sm text-slate-500 font-semibold">Belum absen masuk hari ini</p>
                    <p class="text-[11px] text-slate-400 mt-1">Jendela absen: ${settings.masukStart} - ${settings.masukEnd}</p>
                </div>
                <button onclick="recordAttendanceManual('masuk')" class="w-full bg-emerald-500 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2">
                    <i data-lucide="log-in" class="w-5 h-5"></i> Absen Masuk
                </button>`;
        } else {
            // Di luar jendela absen (belum waktunya / sudah lewat) -> transaksi terkunci
            body.innerHTML = `
                <div class="bg-red-50 rounded-2xl p-5 text-center">
                    <i data-lucide="lock" class="w-6 h-6 text-red-400 mx-auto mb-2"></i>
                    <p class="text-sm text-red-500 font-bold mb-1">Transaksi Terkunci</p>
                    <p class="text-xs text-red-400">${status.message}</p>
                </div>`;
        }
    } else if (!record.keluarTime) {
        body.innerHTML = `
            <div class="flex items-center justify-between bg-emerald-50 rounded-2xl p-4">
                <div>
                    <p class="text-[10px] text-emerald-600 font-bold uppercase">Jam Masuk</p>
                    <p class="text-2xl font-black text-emerald-700">${masukStr}</p>
                </div>
                <button onclick="recordAttendanceManual('keluar')" class="bg-orange-500 text-white px-5 py-3.5 rounded-xl font-bold flex items-center gap-2 shrink-0">
                    <i data-lucide="log-out" class="w-4 h-4"></i> Keluar
                </button>
            </div>
            <p class="text-center text-[11px] text-emerald-500 font-semibold mt-3">✓ Sudah absen masuk, transaksi terbuka</p>
            <p class="text-center text-[10px] text-slate-400 mt-1">Absen pulang bisa dilakukan pukul ${settings.keluarStart} - ${settings.keluarEnd}</p>`;
    } else {
        body.innerHTML = `
            <div class="grid grid-cols-2 gap-3">
                <div class="bg-emerald-50 rounded-2xl p-4 text-center">
                    <p class="text-[10px] text-emerald-600 font-bold uppercase">Masuk</p>
                    <p class="text-lg font-black text-emerald-700">${masukStr}</p>
                </div>
                <div class="bg-orange-50 rounded-2xl p-4 text-center">
                    <p class="text-[10px] text-orange-600 font-bold uppercase">Pulang</p>
                    <p class="text-lg font-black text-orange-700">${keluarStr}</p>
                </div>
            </div>
            <div class="bg-red-50 rounded-2xl p-3 text-center mt-4 flex items-center justify-center gap-1.5">
                <i data-lucide="lock" class="w-3.5 h-3.5 text-red-400"></i>
                <p class="text-xs text-red-500 font-semibold">Transaksi terkunci sampai besok pukul ${settings.masukStart} - ${settings.masukEnd}</p>
            </div>`;
    }
    lucide.createIcons();
}

function renderAttendanceHistory() {
    const body = document.getElementById('attendance-history-body');
    if (!body) return;
    const log = getAttendanceLog().slice().sort((a, b) => b.date.localeCompare(a.date));

    body.innerHTML = log.map(r => {
        const masukStr = r.masukTime ? new Date(r.masukTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';
        const keluarStr = r.keluarTime ? new Date(r.keluarTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';
        let durasi = '-';
        if (r.masukTime && r.keluarTime) {
            durasi = formatDurationHM(new Date(r.keluarTime) - new Date(r.masukTime));
        }
        const tanggalFormatted = new Date(r.date + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
        return `
        <tr class="border-b border-slate-50">
            <td class="p-3 font-semibold text-slate-700">${tanggalFormatted}</td>
            <td class="p-3 text-emerald-600 font-bold">${masukStr}</td>
            <td class="p-3 text-orange-600 font-bold">${keluarStr}</td>
            <td class="p-3 text-slate-500">${durasi}</td>
        </tr>`;
    }).join('') || `<tr><td colspan="4" class="text-center p-6 text-slate-400">Belum ada riwayat absensi</td></tr>`;
}

// --- LAPORAN SALES HARI INI (dari kotak di panel Menu Utama) ---
function isSameDay(dateA, dateB) {
    return dateA.getFullYear() === dateB.getFullYear() &&
        dateA.getMonth() === dateB.getMonth() &&
        dateA.getDate() === dateB.getDate();
}

function getTodaysOrders() {
    const today = new Date();
    return orderHistory.filter(o => {
        const ts = o.timestamp ? new Date(o.timestamp) : null;
        return ts && !isNaN(ts) && isSameDay(ts, today);
    }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // terbaru di atas
}

function openSalesReport() {
    renderSalesReport();
    document.getElementById('modal-sales-report').classList.remove('hidden');
    lucide.createIcons();
}

function closeSalesReport() {
    document.getElementById('modal-sales-report').classList.add('hidden');
}

function renderSalesReport() {
    const todaysOrders = getTodaysOrders();
    const total = todaysOrders.reduce((sum, o) => sum + o.total, 0);

    document.getElementById('sales-report-date').innerText = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('sales-report-total').innerText = `Rp ${total.toLocaleString()}`;
    document.getElementById('sales-report-count').innerText = todaysOrders.length;

    const body = document.getElementById('sales-report-body');
    body.innerHTML = todaysOrders.map(o => {
        const time = new Date(o.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        const itemText = o.items.map(i => `${i.name} x${i.qty}`).join(', ');
        return `
        <tr class="border-b border-slate-100">
            <td class="p-3 align-top font-semibold text-slate-500 whitespace-nowrap">${time}</td>
            <td class="p-3 align-top text-slate-800">${itemText}</td>
            <td class="p-3 align-top">
                <span class="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-[10px] font-bold">${o.method}</span>
            </td>
            <td class="p-3 align-top text-right font-bold text-blue-600 whitespace-nowrap">Rp ${o.total.toLocaleString()}</td>
        </tr>`;
    }).join('') || `<tr><td colspan="4" class="text-center p-8 text-slate-400 text-xs">Belum ada transaksi hari ini</td></tr>`;
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
    const now = new Date();
    lastOrder = {
        id: receiptID,
        date: now.toLocaleString('id-ID'),
        timestamp: now.toISOString(), // dipakai untuk filter laporan "Sales Hari Ini" secara akurat
        total: cart.reduce((sum, item) => sum + (item.price * item.qty), 0),
        method: selectedPayment,
        items: JSON.parse(JSON.stringify(cart)),
        synced: navigator.onLine // langsung ditandai tersinkron jika saat itu online
    };
    orderHistory.push(lastOrder);
    localStorage.setItem('pos_history', JSON.stringify(orderHistory));
    nextReceiptNum++;
    localStorage.setItem('pos_receipt_counter', nextReceiptNum);

    decreaseStockForOrder(lastOrder.items);
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
function closeLoginModal() {
    document.getElementById('modal-login').classList.add('hidden');
    updateDashboardLock(); // kalau dibatalkan & dashboard masih terkunci, gerbang absen muncul lagi
}
function checkLogin() {
    if (document.getElementById('login-user').value === ADMIN_USER && document.getElementById('login-pass').value === ADMIN_PASS) {
        closeLoginModal(); showPage('admin');
    } else { alert("Akses Ditolak!"); }
}
function showPage(page) {
    currentPage = page;
    document.getElementById('page-home').classList.toggle('hidden', page !== 'home');
    document.getElementById('bottom-bar').classList.toggle('hidden', page !== 'home');
    document.getElementById('page-admin').classList.toggle('hidden', page !== 'admin');
    if (page === 'admin') {
        renderAdminTools();
        loadAttendanceSettingsToForm();
    }
    updateDashboardLock(); // admin selalu bebas akses; dashboard kasir dikunci ulang saat kembali ke 'home' kalau belum absen
    lucide.createIcons();
}

function sendWhatsApp() {
    if (!lastOrder) return;
    let phone = document.getElementById('wa-number').value.replace(/[^0-9]/g, "");
    if (phone.startsWith("0")) phone = "62" + phone.slice(1);
    let text = `*STRUK ${STORE_NAME}*%0A------------------%0A`;
    lastOrder.items.forEach(i => {
        text += `${i.name} x${i.qty} = ${i.price * i.qty}%0A`;
        if (i.variantSelections) {
            text += i.variantSelections.map(v => `  - ${v.name} x${v.qty}`).join('%0A') + '%0A';
        }
    });
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
        doc.setFont(undefined, 'normal').setFontSize(8);
        doc.text(`${i.name} x${i.qty}`, marginX, y);
        doc.text(`${(i.price * i.qty).toLocaleString()}`, rightX, y, { align: "right" });
        y += 5;
        if (i.variantSelections) {
            doc.setFontSize(6.5);
            i.variantSelections.forEach(v => {
                doc.text(`- ${v.name} x${v.qty}`, marginX + 2, y);
                y += 3.5;
            });
        }
        y += 2;
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
