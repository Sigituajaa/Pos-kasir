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

// DATA PRODUK & KATEGORI — diisi lewat Firestore real-time listener (lihat initFirestoreSync),
// nilai default di sini hanya dipakai sesaat sebelum data dari cloud pertama kali masuk.
let products = [];
let categories = ['Makanan', 'Minuman', 'Keripik'];

let cart = [];
let selectedPayment = '';
let lastOrder = null;
let currentCategory = categories[0] || '';
let orderHistory = []; // diisi via Firestore listener koleksi 'sales'

// Status sinkronisasi Firestore (dipakai buat indikator di tombol "Transfer Data")
let firestoreHasPendingWrites = false;
let firestoreListenersReady = false;

// Status "sudah dapat data ASLI dari server" — overlay wajib TIDAK BOLEH mengambil keputusan
// sebelum kedua ini true, supaya tidak salah pakai jam default sementara saat baru connect.
let attendanceSettingsLoaded = false;
let attendanceLogLoaded = false;

function init() {
    renderCategoryTabs();
    renderCategorySelects();
    filterCategory(currentCategory);
    updateCartUI();
    startClock();
    updateConnectionUI();
    updateProofBadge();
    registerServiceWorker();
    lucide.createIcons();

    // Kunci dashboard SEJAK AWAL (sebelum data absen dari server termuat) — baru dilepas oleh
    // checkAttendanceOverlay() setelah dipastikan memang tidak perlu absen saat ini.
    setDashboardLocked(true);

    // Pantau perubahan koneksi internet HP ini
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Firestore butuh proses login anonim dulu (async) sebelum bisa dipakai.
    // Kalau sudah siap duluan, langsung jalan; kalau belum, tunggu event 'firebase-ready'.
    if (window.FB && window.FB.ready) {
        initFirestoreSync();
    } else {
        window.addEventListener('firebase-ready', initFirestoreSync, { once: true });
        // Jaga-jaga kalau Firebase gagal total dimuat (misal offline saat pertama kali buka
        // & belum pernah ke-cache), supaya UI tetap jalan dengan data kosong daripada macet.
        setTimeout(() => {
            if (!firestoreListenersReady) {
                document.getElementById('connecting-gate').innerHTML = `
                    <button onclick="openLoginModal()" class="absolute top-5 left-5 text-white/80 hover:text-white p-2 flex items-center gap-1.5 text-xs font-bold">
                        <i data-lucide="lock" class="w-4 h-4"></i> Admin
                    </button>
                    <div class="text-center text-white px-6">
                        <i data-lucide="wifi-off" class="w-10 h-10 mx-auto mb-4"></i>
                        <p class="font-bold mb-2">Gagal terhubung ke database</p>
                        <p class="text-sm opacity-80">Cek koneksi internet, lalu refresh halaman ini.</p>
                    </div>`;
                lucide.createIcons();
            }
        }, 10000);
    }
}

// --- SINKRONISASI FIRESTORE (database bersama, real-time ke semua HP) ---
function initFirestoreSync() {
    if (firestoreListenersReady) return; // hindari daftar listener dua kali
    firestoreListenersReady = true;
    const { db, doc, collection, onSnapshot, query, orderBy } = window.FB;

    // --- Produk (satu dokumen berisi array semua produk) ---
    onSnapshot(doc(db, 'config', 'products'), (snap) => {
        trackPendingWrites(snap);
        if (snap.exists() && Array.isArray(snap.data().items)) {
            products = snap.data().items;
        } else {
            products = [];
        }
        renderCatalog();
        if (document.getElementById('page-admin') && !document.getElementById('page-admin').classList.contains('hidden')) {
            renderAdminTools();
        }
    }, (err) => console.error('Sync produk gagal:', err));

    // --- Kategori ---
    onSnapshot(doc(db, 'config', 'categories'), (snap) => {
        trackPendingWrites(snap);
        if (snap.exists() && Array.isArray(snap.data().items) && snap.data().items.length > 0) {
            categories = snap.data().items;
        }
        if (!currentCategory || !categories.includes(currentCategory)) {
            currentCategory = categories[0] || '';
        }
        renderCategoryTabs();
        renderCategorySelects();
        filterCategory(currentCategory);
        if (document.getElementById('page-admin') && !document.getElementById('page-admin').classList.contains('hidden')) {
            renderCategoryList();
        }
    }, (err) => console.error('Sync kategori gagal:', err));

    // --- Riwayat Penjualan (koleksi, urut waktu terbaru) ---
    const salesQuery = query(collection(db, 'sales'), orderBy('timestamp', 'desc'));
    onSnapshot(salesQuery, (snap) => {
        trackPendingWrites(snap);
        orderHistory = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
        if (document.getElementById('page-admin') && !document.getElementById('page-admin').classList.contains('hidden')) {
            renderAdminTools();
        }
        if (document.getElementById('modal-sales-report') && !document.getElementById('modal-sales-report').classList.contains('hidden')) {
            renderSalesReport();
        }
    }, (err) => console.error('Sync riwayat penjualan gagal:', err));

    // --- Karyawan (daftar nama, dipakai buat identifikasi saat absen) ---
    onSnapshot(doc(db, 'config', 'employees'), (snap) => {
        trackPendingWrites(snap);
        employeesCache = (snap.exists() && Array.isArray(snap.data().items)) ? snap.data().items : [];
        renderEmployeeList();
        renderScheduleCalendar(); // nama karyawan dipakai untuk label di kalender
    }, (err) => console.error('Sync karyawan gagal:', err));

    // --- Katalog Per Karyawan (produk & kuota kustom per kasir, diatur Admin) ---
    onSnapshot(doc(db, 'config', 'employeeCatalog'), (snap) => {
        trackPendingWrites(snap);
        employeeCatalogCache = snap.exists() ? snap.data() : {};
        renderCategoryTabs(); // ikut refresh tab kategori & katalog kasir yang lagi aktif
        if (document.getElementById('page-admin') && !document.getElementById('page-admin').classList.contains('hidden')) {
            renderEmployeeCatalogEditor();
        }
    }, (err) => console.error('Sync katalog karyawan gagal:', err));

    // --- Pemakaian Kuota Harian Kasir (dilacak per tanggal, otomatis "reset" tiap ganti hari) ---
    onSnapshot(collection(db, 'kasirQuotaUsage'), (snap) => {
        trackPendingWrites(snap);
        kasirQuotaUsageCache = snap.docs.map(d => d.data());
        renderCatalog();
    }, (err) => console.error('Sync kuota kasir gagal:', err));

    // --- Jadwal Kerja Karyawan (kalender bulanan, koleksi per tanggal) ---
    onSnapshot(collection(db, 'schedule'), (snap) => {
        trackPendingWrites(snap);
        scheduleCache = {};
        snap.docs.forEach(d => { scheduleCache[d.id] = d.data(); });
        renderScheduleCalendar();
    }, (err) => console.error('Sync jadwal karyawan gagal:', err));

    // --- Pengaturan Absen (jam kerja) ---
    onSnapshot(doc(db, 'config', 'attendanceSettings'), (snap) => {
        trackPendingWrites(snap);
        if (snap.exists()) {
            cachedAttendanceSettings = snap.data();
        }
        attendanceSettingsLoaded = true;
        loadAttendanceSettingsToForm();
        checkMandatoryMasukGate();
        checkAttendanceOverlay(new Date());
        tryCloseConnectingGate();
    }, (err) => console.error('Sync pengaturan absen gagal:', err));

    // --- Token QR Absen ---
    onSnapshot(doc(db, 'config', 'attendanceQrToken'), (snap) => {
        trackPendingWrites(snap);
        cachedQrToken = snap.exists() ? snap.data().token : null;
        renderAttendanceQR();
    }, (err) => console.error('Sync QR absen gagal:', err));

    // --- Riwayat Absensi (koleksi, doc ID = tanggal) ---
    onSnapshot(collection(db, 'attendance'), (snap) => {
        trackPendingWrites(snap);
        attendanceLogCache = snap.docs.map(d => d.data());
        attendanceLogLoaded = true;
        renderAttendanceHistory();
        checkMandatoryMasukGate();
        checkAttendanceOverlay(new Date());
        renderCategoryTabs(); // kasir aktif bisa berganti (absen masuk/keluar) -> katalog ikut berubah
        tryCloseConnectingGate();
        if (document.getElementById('modal-absen-popup') && !document.getElementById('modal-absen-popup').classList.contains('hidden')) {
            renderAbsenPopup();
        }
    }, (err) => console.error('Sync absensi gagal:', err));

    updateConnectionUI();
}

// Gerbang tunggu hanya boleh ditutup kalau KEDUA data (jam kerja & riwayat absen hari ini)
// sudah benar-benar termuat dari server — supaya overlay wajib tidak pernah salah keputusan
// gara-gara masih pakai data lama/kosong sesaat setelah halaman dibuka.
function tryCloseConnectingGate() {
    if (attendanceSettingsLoaded && attendanceLogLoaded) {
        document.getElementById('connecting-gate').classList.add('hidden');
    }
}

// Update indikator "ada perubahan yang belum tersimpan permanen ke server" (masih di cache lokal)
function trackPendingWrites(snap) {
    firestoreHasPendingWrites = snap.metadata.hasPendingWrites;
    updateConnectionUI();
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

    const overlayClockEl = document.getElementById('attendance-overlay-clock');
    if (overlayClockEl) overlayClockEl.innerText = time;

    checkMandatoryMasukGate();
    checkAttendanceOverlay(now);
}

// --- KONEKSI & STATUS SINKRONISASI FIRESTORE ---
// Semua data (produk, kategori, penjualan, stock, absen) sekarang tersimpan di Firestore
// (database cloud bersama), dengan offline persistence bawaan: tetap bisa dipakai walau
// offline, lalu otomatis sinkron ke server & ke semua HP lain begitu online kembali.
// Tombol "Transfer Data" di header sekarang murni indikator status sinkronisasi ini.

function updateConnectionUI() {
    const btn = document.getElementById('btn-transfer');
    const badge = document.getElementById('pending-badge');
    if (!btn) return;

    btn.classList.remove('is-online', 'is-offline', 'is-syncing');
    const icon = btn.querySelector('i');

    if (!navigator.onLine) {
        btn.classList.add('is-offline');
        if (icon) icon.setAttribute('data-lucide', 'cloud-off');
    } else if (firestoreHasPendingWrites) {
        btn.classList.add('is-syncing');
        if (icon) icon.setAttribute('data-lucide', 'refresh-cw');
    } else {
        btn.classList.add('is-online');
        if (icon) icon.setAttribute('data-lucide', 'cloud-check');
    }

    // Badge dipakai untuk kondisi "ada perubahan lokal yang belum tersimpan permanen ke server"
    if (badge) {
        if (firestoreHasPendingWrites) {
            badge.textContent = '!';
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
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

// Firestore otomatis menyimpan & menyinkronkan data (termasuk saat offline, lalu otomatis
// terkirim ke server begitu online lagi) — jadi tombol ini sekarang murni indikator status,
// bukan tombol aksi manual lagi seperti sebelumnya.
function transferData() {
    if (!navigator.onLine) {
        showToast('Sedang offline. Perubahan tersimpan di HP ini dan akan otomatis sinkron ke server saat online kembali.', 'warn');
    } else if (firestoreHasPendingWrites) {
        showToast('Sedang menyinkronkan data ke server...', '');
    } else {
        showToast('Semua data sudah tersinkron ke server.', 'success');
    }
}

function handleOnline() {
    updateConnectionUI();
    showToast('Koneksi online kembali. Menyinkronkan data...', 'success');

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
    showToast('Koneksi terputus. Aplikasi tetap bisa digunakan (offline), data akan sinkron otomatis nanti.', 'warn');
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
    // Tab yang ditampilkan mengikuti katalog kasir yang lagi absen (kalau Admin sudah atur
    // Katalog Per Karyawan buat dia) — supaya kasir cuma lihat kategori yang relevan buat dia.
    const visibleCategories = getVisibleCategoriesForCurrentKasir();
    if (!visibleCategories.includes(currentCategory)) {
        currentCategory = visibleCategories[0] || '';
    }
    container.innerHTML = visibleCategories.map(cat => `
        <button onclick="filterCategory('${cat.replace(/'/g, "\\'")}')" id="tab-${cat}" class="category-tab whitespace-nowrap ${cat === currentCategory ? 'active' : ''}">${cat}</button>
    `).join('');
    renderCatalog();
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
    if (!grid) return;
    // Katalog yang tampil mengikuti kasir yang lagi absen — kalau Admin sudah setting produk
    // & kuota khusus buat dia di "Katalog Per Karyawan", cuma itu yang muncul di sini.
    const visibleProducts = getVisibleProductsForCurrentKasir();
    const filtered = visibleProducts.filter(p => p.category === currentCategory);
    grid.innerHTML = filtered.map((p, idx) => {
        const hasVariant = p.variantConfig && p.variantConfig.enabled;
        const effectiveStock = getEffectiveStockForCurrentKasir(p);
        const isOutOfStock = effectiveStock != null && effectiveStock <= 0;
        const clickAction = isOutOfStock ? '' : (hasVariant ? `openVariantModal(${p.id})` : `addToCart(${p.id})`);
        return `
        <div onclick="${clickAction}" style="animation-delay:${idx * 0.03}s" class="product-card p-5 rounded-[1.75rem] relative ${isOutOfStock ? 'opacity-50 grayscale cursor-not-allowed' : 'cursor-pointer'}">
            ${isOutOfStock ? `<span class="absolute top-3 right-3 bg-red-100 text-red-600 text-[9px] font-bold px-2 py-1 rounded-full">HABIS</span>` : hasVariant ? `<span class="absolute top-3 right-3 bg-blue-100 text-blue-600 text-[9px] font-bold px-2 py-1 rounded-full">PILIH ISI</span>` : ''}
            <h3 class="font-extrabold text-slate-800 text-sm mb-2 leading-tight pr-2">${p.name}</h3>
            <p class="text-blue-600 font-black">Rp ${p.price.toLocaleString()}</p>
            ${(!isOutOfStock && effectiveStock != null) ? `<p class="text-[10px] text-slate-400 font-semibold mt-1">Sisa ${effectiveStock}</p>` : ''}
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

    saveProductsToFirestore([...products, newProduct]);

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
        const updated = [...products];
        updated[idx] = {
            ...updated[idx],
            name: document.getElementById('edit-name').value,
            price: parseInt(document.getElementById('edit-price').value),
            category: document.getElementById('edit-category').value,
            variantConfig: variantConfig
        };
        saveProductsToFirestore(updated);
        alert('Berhasil diperbarui!');
    }
}

function deleteProduct() {
    const id = parseInt(document.getElementById('edit-select').value);
    if (confirm("Hapus menu ini dari katalog?")) {
        saveProductsToFirestore(products.filter(p => p.id !== id));
        alert('Produk dihapus!');
    }
}

// Simpan seluruh array produk ke Firestore. Tampilan (renderCatalog, dsb) di-update
// otomatis lewat onSnapshot listener di initFirestoreSync — tidak perlu dipanggil manual di sini.
function saveProductsToFirestore(newProducts) {
    if (!window.FB || !window.FB.ready) {
        showToast('Belum terhubung ke database. Coba lagi sebentar.', 'warn');
        return;
    }
    const { db, doc, setDoc } = window.FB;
    setDoc(doc(db, 'config', 'products'), { items: newProducts }).catch((err) => {
        console.error('Gagal simpan produk:', err);
        showToast('Gagal menyimpan produk ke server.', 'warn');
    });
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

function saveCategoriesToFirestore(newCategories) {
    if (!window.FB || !window.FB.ready) {
        showToast('Belum terhubung ke database. Coba lagi sebentar.', 'warn');
        return;
    }
    const { db, doc, setDoc } = window.FB;
    setDoc(doc(db, 'config', 'categories'), { items: newCategories }).catch((err) => {
        console.error('Gagal simpan kategori:', err);
        showToast('Gagal menyimpan kategori ke server.', 'warn');
    });
}

function addCategory() {
    const input = document.getElementById('new-category-name');
    const name = input.value.trim();
    if (!name) return alert('Nama kategori tidak boleh kosong!');
    if (categories.some(c => c.toLowerCase() === name.toLowerCase())) {
        return alert('Kategori tersebut sudah ada!');
    }
    saveCategoriesToFirestore([...categories, name]);
    input.value = '';
}

function deleteCategory(cat) {
    const used = products.filter(p => p.category === cat).length;
    if (used > 0) {
        return alert(`Kategori "${cat}" masih dipakai oleh ${used} produk. Pindahkan atau hapus produk tersebut dulu sebelum menghapus kategorinya.`);
    }
    if (!confirm(`Hapus kategori "${cat}"?`)) return;
    saveCategoriesToFirestore(categories.filter(c => c !== cat));
}

function renderAdminTools() {
    const select = document.getElementById('edit-select');
    select.innerHTML = products.map(p => `<option value="${p.id}">${p.name} [${p.category}]</option>`).join('');
    renderCategorySelects();
    renderCategoryList();
    renderStockManageList();
    renderEmployeeCatalogSelect();
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
    const updated = [...products];
    if (value === '' || value === null) {
        const { stock, ...rest } = updated[idx];
        updated[idx] = rest; // kosongkan = tidak dilacak / tidak terbatas
    } else {
        updated[idx] = { ...updated[idx], stock: Math.max(0, parseInt(value) || 0) };
    }
    saveProductsToFirestore(updated);
    showToast('Stock diperbarui!', 'success');
}

// Pakai Firestore transaction supaya aman kalau ada 2+ HP jual produk yang sama secara bersamaan
// (transaction otomatis baca data TERBARU dari server & retry kalau ada tabrakan, jadi stock
// tidak pernah salah kurang gara-gara race condition antar device).
//
// Item PAKET (punya variantSelections, misal "Cireng Kuah Keju" isi 4pcs) TIDAK mengurangi
// stock produk paketnya sendiri — melainkan mengurangi stock produk SATUAN yang dipilih di
// dalamnya (sesuai isi/rasa yang di-tap kasir). Ini berlaku otomatis untuk paket APAPUN yang
// dibuat Admin (bukan cuma "Cireng Kuah Keju"), karena logikanya generik berdasarkan
// variantSelections, bukan nama produk tertentu.
//
// `employeeId` (opsional) = kasir yang lagi absen saat transaksi ini dibuat. Kalau dia punya
// kuota harian khusus di produk tertentu (diatur Admin di "Katalog Per Karyawan"), pemakaian
// kuotanya ikut dicatat di koleksi 'kasirQuotaUsage' (terpisah dari stock global).
async function decreaseStockForOrder(items, employeeId) {
    if (!window.FB || !window.FB.ready) return;
    const { db, doc, runTransaction } = window.FB;
    const productsRef = doc(db, 'config', 'products');

    const todayStr = getTodayDateStr();
    const usageRef = employeeId ? doc(db, 'kasirQuotaUsage', `${todayStr}_${employeeId}`) : null;
    const employeeAssignments = employeeId ? (employeeCatalogCache[employeeId] || []) : [];
    const quotaProductIds = new Set(employeeAssignments.filter(a => a.qty != null).map(a => a.productId));

    try {
        await runTransaction(db, async (transaction) => {
            const snap = await transaction.get(productsRef);
            const usageSnap = usageRef ? await transaction.get(usageRef) : null; // semua read harus sebelum write
            const currentProducts = snap.exists() ? (snap.data().items || []) : [];
            const currentUsage = (usageSnap && usageSnap.exists()) ? (usageSnap.data().usage || {}) : {};

            const decreaseProductStock = (productId, qty) => {
                const idx = currentProducts.findIndex(p => p.id === productId);
                if (idx !== -1 && currentProducts[idx].stock != null) {
                    currentProducts[idx].stock = Math.max(0, currentProducts[idx].stock - qty);
                }
            };
            const addUsage = (productId, qty) => {
                if (!quotaProductIds.has(productId)) return; // cuma dilacak kalau memang ada kuota khusus di produk ini
                currentUsage[productId] = (currentUsage[productId] || 0) + qty;
            };

            items.forEach(item => {
                if (item.variantSelections && item.variantSelections.length) {
                    // PAKET: kurangi stock & kuota dari tiap produk satuan yang dipilih di dalamnya
                    item.variantSelections.forEach(sel => {
                        if (sel.id == null) return; // jaga-jaga data lama sebelum field id ditambahkan
                        const totalQty = sel.qty * item.qty;
                        decreaseProductStock(sel.id, totalQty);
                        addUsage(sel.id, totalQty);
                    });
                    // Kuota kasir di level paketnya sendiri (kalau Admin aturnya di situ, bukan di satuan)
                    addUsage(item.productId, item.qty);
                } else {
                    decreaseProductStock(item.id, item.qty);
                    addUsage(item.id, item.qty);
                }
            });

            transaction.set(productsRef, { items: currentProducts });
            if (usageRef) {
                transaction.set(usageRef, { date: todayStr, employeeId, usage: currentUsage }, { merge: true });
            }
        });
    } catch (err) {
        console.error('Gagal mengurangi stock:', err);
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
    // Ikut katalog kasir yang lagi absen, sama seperti halaman menu utama.
    const visibleProducts = getVisibleProductsForCurrentKasir();
    body.innerHTML = visibleProducts.map(p => {
        const effectiveStock = getEffectiveStockForCurrentKasir(p);
        const hasStock = effectiveStock != null;
        const isEmpty = hasStock && effectiveStock <= 0;
        const badgeClass = isEmpty ? 'bg-red-100 text-red-600' : hasStock ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400';
        const stockLabel = hasStock ? effectiveStock : '∞';
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
    // Pilihan isi/rasa juga ikut katalog kasir yang lagi absen, supaya isi paket yang bisa
    // dipilih tetap sesuai dengan produk yang memang diaktifkan Admin buat kasir tsb.
    const options = getVisibleProductsForCurrentKasir().filter(p => p.category === sourceCategory);

    if (options.length === 0) {
        return alert(`Belum ada menu di kategori "${sourceCategory}" untuk dipilih. Tambahkan dulu menunya lewat Admin Panel, atau aktifkan produk kategori tersebut untuk karyawan ini di "Katalog Per Karyawan".`);
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
        .map(o => ({ id: o.id, name: o.name, qty: state.selections[o.id] })); // id dipakai buat kurangi stock satuan yang tepat

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
// Cache lokal yang diisi lewat Firestore onSnapshot listener (lihat initFirestoreSync)
let cachedAttendanceSettings = null;
let cachedQrToken = null;
let attendanceLogCache = [];
let employeesCache = [];

// --- KATALOG PER KARYAWAN (multi akun kasir) ---
// employeeCatalogCache: { [employeeId]: [ { productId, qty } ] }
//   - productId ada di array ini artinya produk itu DIAKTIFKAN buat karyawan tsb.
//   - qty null/undefined = aktif tapi TANPA kuota khusus (ikut stock global apa adanya).
//   - qty angka = kuota harian khusus buat karyawan ini di produk ini.
// kasirQuotaUsageCache: [{ date, employeeId, usage: { [productId]: qtyTerjualHariIni } }]
//   Dipakai buat lacak pemakaian kuota harian. Karena doc ID-nya berbasis tanggal (sama pola
//   dengan absensi), kuota otomatis "reset" tiap ganti hari tanpa perlu job reset manual.
let employeeCatalogCache = {};
let kasirQuotaUsageCache = [];

// Karyawan yang lagi aktif (sudah absen masuk, belum absen keluar) hari ini — inilah yang
// menentukan katalog produk apa saja yang tampil di halaman Kasir saat ini.
function getCurrentKasirEmployeeId() {
    const record = getOrCreateTodayAttendance();
    if (record.masukTime && !record.keluarTime) return record.masukById || null;
    return null;
}

// Kalau karyawan yang lagi aktif SAMA SEKALI belum diatur di "Katalog Per Karyawan" oleh Admin,
// dianggap belum dikonfigurasi -> tampilkan semua produk seperti biasa (supaya tidak macet/kosong).
function getVisibleProductsForCurrentKasir() {
    const empId = getCurrentKasirEmployeeId();
    if (!empId) return products; // Admin / belum ada kasir yang absen -> semua produk
    const assigned = employeeCatalogCache[empId];
    if (!assigned || assigned.length === 0) return products; // belum diatur Admin -> default semua produk
    const assignedIds = new Set(assigned.map(a => a.productId));
    return products.filter(p => assignedIds.has(p.id));
}

// Tab kategori ikut mengikuti: kalau katalog kasir ini difilter, tab yang ditampilkan cuma
// kategori yang memang punya produk buat kasir tsb (biar tidak ada tab kosong melompong).
function getVisibleCategoriesForCurrentKasir() {
    const visibleProducts = getVisibleProductsForCurrentKasir();
    if (visibleProducts.length === products.length) return categories; // tidak difilter -> semua kategori
    const activeCats = new Set(visibleProducts.map(p => p.category));
    const filtered = categories.filter(c => activeCats.has(c));
    return filtered.length > 0 ? filtered : categories; // jaga-jaga jangan sampai tab kosong total
}

function getKasirUsageToday(employeeId, productId) {
    const todayStr = getTodayDateStr();
    const rec = kasirQuotaUsageCache.find(r => r.date === todayStr && r.employeeId === employeeId);
    return (rec && rec.usage && rec.usage[productId]) || 0;
}

// Stock yang BENERAN boleh dijual SAAT INI oleh kasir yang lagi absen: gabungan antara stock
// global produk & kuota harian khusus (kalau Admin mengatur kuota buat karyawan ini di produk
// ini). Diambil yang PALING KECIL supaya kedua batasan itu sama-sama dihormati.
function getEffectiveStockForCurrentKasir(product) {
    const empId = getCurrentKasirEmployeeId();
    if (!empId) return product.stock; // Admin / belum ada kasir aktif -> stock global apa adanya
    const assigned = employeeCatalogCache[empId];
    const entry = assigned && assigned.find(a => a.productId === product.id);
    if (!entry || entry.qty == null) return product.stock; // tidak ada kuota khusus -> ikut stock global
    const usedToday = getKasirUsageToday(empId, product.id);
    const remainingQuota = Math.max(0, entry.qty - usedToday);
    if (product.stock == null) return remainingQuota;
    return Math.min(product.stock, remainingQuota);
}

function getAttendanceSettings() {
    return cachedAttendanceSettings || {
        masukStart: '12:00',
        masukEnd: '18:00',
        keluarStart: '22:00',
        keluarEnd: '23:59'
    };
}

function saveAttendanceSettings() {
    const settings = {
        masukStart: document.getElementById('att-masuk-start').value,
        masukEnd: document.getElementById('att-masuk-end').value,
        keluarStart: document.getElementById('att-keluar-start').value,
        keluarEnd: document.getElementById('att-keluar-end').value
    };
    if (!settings.masukStart || !settings.masukEnd || !settings.keluarStart || !settings.keluarEnd) {
        return alert('Semua jam wajib diisi!');
    }
    if (!window.FB || !window.FB.ready) return alert('Belum terhubung ke database. Coba lagi sebentar.');
    const { db, doc, setDoc } = window.FB;
    setDoc(doc(db, 'config', 'attendanceSettings'), settings).then(() => {
        alert('Pengaturan absen berhasil disimpan! Otomatis sinkron ke semua HP.');
    }).catch((err) => {
        console.error('Gagal simpan pengaturan absen:', err);
        alert('Gagal menyimpan ke server.');
    });
}

// --- KELOLA KARYAWAN ---
function renderEmployeeList() {
    const list = document.getElementById('employee-list');
    if (!list) return;
    list.innerHTML = employeesCache.map(emp => `
        <div class="flex items-center justify-between bg-white border border-slate-100 rounded-xl p-2.5">
            <span class="font-bold text-sm text-slate-800">${emp.name}</span>
            <button onclick="deleteEmployee('${emp.id}')" class="text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
        </div>
    `).join('') || '<p class="text-xs text-slate-400">Belum ada karyawan ditambahkan</p>';
    lucide.createIcons();
    renderEmployeeCatalogSelect(); // dropdown Katalog Per Karyawan ikut sinkron dgn daftar karyawan
}

function saveEmployeesToFirestore(newList) {
    if (!window.FB || !window.FB.ready) {
        showToast('Belum terhubung ke database. Coba lagi sebentar.', 'warn');
        return;
    }
    const { db, doc, setDoc } = window.FB;
    setDoc(doc(db, 'config', 'employees'), { items: newList }).catch((err) => {
        console.error('Gagal simpan karyawan:', err);
        showToast('Gagal menyimpan ke server.', 'warn');
    });
}

function addEmployee() {
    const input = document.getElementById('new-employee-name');
    const name = input.value.trim();
    if (!name) return alert('Nama karyawan tidak boleh kosong!');
    if (employeesCache.some(e => e.name.toLowerCase() === name.toLowerCase())) {
        return alert('Nama karyawan tersebut sudah ada!');
    }
    const newEmployee = { id: 'emp_' + Date.now(), name };
    saveEmployeesToFirestore([...employeesCache, newEmployee]);
    input.value = '';
}

function deleteEmployee(id) {
    const emp = employeesCache.find(e => e.id === id);
    if (!emp) return;
    if (!confirm(`Hapus karyawan "${emp.name}"?`)) return;
    saveEmployeesToFirestore(employeesCache.filter(e => e.id !== id));
}

// --- KATALOG PER KARYAWAN (produk & kuota harian khusus per kasir, multi akun) ---
// Isi dropdown pilih karyawan, lalu render checklist produk buat karyawan yang lagi dipilih.
// Dipanggil ulang setiap kali daftar karyawan / produk / katalog karyawan berubah.
function renderEmployeeCatalogSelect() {
    const select = document.getElementById('empcat-employee-select');
    if (!select) return;
    const prevValue = select.value;
    select.innerHTML = employeesCache.map(e => `<option value="${e.id}">${e.name}</option>`).join('') || '<option value="">Belum ada karyawan</option>';
    if (employeesCache.some(e => e.id === prevValue)) select.value = prevValue;
    renderEmployeeCatalogEditor();
}

function renderEmployeeCatalogEditor() {
    const list = document.getElementById('empcat-product-list');
    if (!list) return;
    const select = document.getElementById('empcat-employee-select');
    const empId = select ? select.value : '';

    if (employeesCache.length === 0) {
        list.innerHTML = '<p class="text-xs text-slate-400 text-center py-6">Tambahkan karyawan dulu di "Kelola Karyawan".</p>';
        return;
    }
    if (!empId) {
        list.innerHTML = '<p class="text-xs text-slate-400 text-center py-6">Pilih karyawan dulu.</p>';
        return;
    }

    const assigned = employeeCatalogCache[empId] || [];
    const assignedMap = {};
    assigned.forEach(a => { assignedMap[a.productId] = a.qty; });

    list.innerHTML = products.map(p => {
        const isAssigned = Object.prototype.hasOwnProperty.call(assignedMap, p.id);
        const qty = assignedMap[p.id];
        return `
        <div class="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-xl p-2.5">
            <input type="checkbox" data-empcat-product="${p.id}" ${isAssigned ? 'checked' : ''} class="empcat-checkbox w-4 h-4 accent-pink-600 shrink-0">
            <div class="min-w-0 flex-1">
                <p class="font-bold text-xs text-slate-800 truncate">${p.name}</p>
                <p class="text-[10px] text-slate-400">${p.category}</p>
            </div>
            <input type="number" min="0" data-empcat-qty="${p.id}" value="${qty ?? ''}" placeholder="∞" title="Kuota harian khusus (kosongkan = ikut stock global)" class="w-16 p-1.5 text-center border border-slate-200 rounded-lg outline-none text-xs font-bold shrink-0">
        </div>`;
    }).join('') || '<p class="text-xs text-slate-400 text-center py-6">Belum ada produk di katalog. Tambahkan produk dulu.</p>';
    lucide.createIcons();
}

function saveEmployeeCatalog() {
    const select = document.getElementById('empcat-employee-select');
    const empId = select ? select.value : '';
    if (!empId) return alert('Pilih karyawan dulu!');
    if (!window.FB || !window.FB.ready) return showToast('Belum terhubung ke database. Coba lagi sebentar.', 'warn');

    const assigned = [];
    document.querySelectorAll('.empcat-checkbox:checked').forEach(cb => {
        const productId = parseInt(cb.getAttribute('data-empcat-product'));
        const qtyInput = document.querySelector(`[data-empcat-qty="${productId}"]`);
        const qtyRaw = qtyInput ? qtyInput.value : '';
        const qty = qtyRaw === '' ? null : Math.max(0, parseInt(qtyRaw) || 0);
        assigned.push({ productId, qty });
    });

    const { db, doc, setDoc } = window.FB;
    setDoc(doc(db, 'config', 'employeeCatalog'), { [empId]: assigned }, { merge: true }).then(() => {
        const empName = (employeesCache.find(e => e.id === empId) || {}).name || '';
        showToast(`Katalog untuk ${empName} tersimpan!`, 'success');
    }).catch((err) => {
        console.error('Gagal simpan katalog karyawan:', err);
        showToast('Gagal menyimpan ke server.', 'warn');
    });
}

// --- JADWAL KERJA KARYAWAN (KALENDER BULANAN) ---
let scheduleCache = {}; // { 'YYYY-MM-DD': { employeeIds: [...] } }, diisi via Firestore listener
let scheduleViewDate = new Date(); // bulan yang sedang ditampilkan di kalender
let scheduleEditingDateStr = null; // tanggal yang lagi dibuka di modal edit

function scheduleDateStr(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function changeScheduleMonth(delta) {
    scheduleViewDate.setMonth(scheduleViewDate.getMonth() + delta);
    scheduleViewDate = new Date(scheduleViewDate); // trigger objek baru biar gampang di-render ulang
    renderScheduleCalendar();
}

function renderScheduleCalendar() {
    const grid = document.getElementById('schedule-calendar-grid');
    const label = document.getElementById('schedule-month-label');
    if (!grid || !label) return;

    const year = scheduleViewDate.getFullYear();
    const month = scheduleViewDate.getMonth();
    label.innerText = scheduleViewDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

    const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0 = Minggu
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = getTodayDateStr();

    let cells = '';
    for (let i = 0; i < firstDayOfWeek; i++) {
        cells += `<div></div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = scheduleDateStr(year, month, d);
        const entry = scheduleCache[dateStr];
        const names = entry && entry.employeeIds
            ? entry.employeeIds.map(id => (employeesCache.find(e => e.id === id) || {}).name).filter(Boolean)
            : [];
        const isToday = dateStr === todayStr;

        cells += `
        <button onclick="openScheduleDayModal('${dateStr}')" class="aspect-square rounded-lg p-1 flex flex-col items-center justify-start text-left ${isToday ? 'bg-indigo-100 ring-1 ring-indigo-400' : 'bg-slate-50 hover:bg-slate-100'} transition overflow-hidden">
            <span class="text-[10px] font-bold ${isToday ? 'text-indigo-700' : 'text-slate-600'}">${d}</span>
            ${names.length > 0 ? `<span class="text-[7px] leading-tight text-emerald-600 font-bold mt-0.5 line-clamp-2">${names.join(', ')}</span>` : ''}
        </button>`;
    }

    grid.innerHTML = cells;
}

function openScheduleDayModal(dateStr) {
    if (employeesCache.length === 0) {
        showToast('Tambahkan data karyawan dulu di "Kelola Karyawan" sebelum atur jadwal.', 'warn');
        return;
    }
    scheduleEditingDateStr = dateStr;
    const dateObj = new Date(dateStr + 'T00:00:00');
    document.getElementById('schedule-day-title').innerText = dateObj.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const selectedIds = (scheduleCache[dateStr] && scheduleCache[dateStr].employeeIds) || [];
    const list = document.getElementById('schedule-day-employee-list');
    list.innerHTML = employeesCache.map(emp => `
        <label class="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl p-3 cursor-pointer">
            <input type="checkbox" value="${emp.id}" ${selectedIds.includes(emp.id) ? 'checked' : ''} class="schedule-day-checkbox w-4 h-4 accent-indigo-600">
            <span class="font-semibold text-sm text-slate-800">${emp.name}</span>
        </label>
    `).join('');

    document.getElementById('modal-schedule-day').classList.remove('hidden');
    document.getElementById('modal-schedule-day').classList.add('flex');
    lucide.createIcons();
}

function closeScheduleDayModal() {
    document.getElementById('modal-schedule-day').classList.add('hidden');
    document.getElementById('modal-schedule-day').classList.remove('flex');
    scheduleEditingDateStr = null;
}

function saveScheduleDay() {
    if (!scheduleEditingDateStr) return;
    if (!window.FB || !window.FB.ready) return showToast('Belum terhubung ke database.', 'warn');

    const checked = Array.from(document.querySelectorAll('.schedule-day-checkbox:checked')).map(el => el.value);
    const { db, doc, setDoc, deleteDoc } = window.FB;
    const ref = doc(db, 'schedule', scheduleEditingDateStr);

    const savePromise = checked.length > 0
        ? setDoc(ref, { date: scheduleEditingDateStr, employeeIds: checked })
        : deleteDoc(ref); // kosongkan kalau tidak ada karyawan dipilih, biar rapi di database

    savePromise.then(() => {
        showToast('Jadwal tersimpan!', 'success');
        closeScheduleDayModal();
    }).catch((err) => {
        console.error('Gagal simpan jadwal:', err);
        showToast('Gagal menyimpan jadwal ke server.', 'warn');
    });
}

// --- QR CODE ABSEN (validasi kehadiran, menggantikan cek GPS) ---
function getQrToken() {
    return cachedQrToken;
}

function generateAttendanceQR() {
    const token = 'ABSEN-' + Math.random().toString(36).substring(2, 10).toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
    if (!window.FB || !window.FB.ready) return showToast('Belum terhubung ke database.', 'warn');
    const { db, doc, setDoc } = window.FB;
    setDoc(doc(db, 'config', 'attendanceQrToken'), { token }).then(() => {
        showToast('QR baru berhasil dibuat! QR lama sudah tidak berlaku di semua HP.', 'success');
    }).catch((err) => {
        console.error('Gagal generate QR:', err);
        showToast('Gagal menyimpan QR ke server.', 'warn');
    });
}

function renderAttendanceQR() {
    const container = document.getElementById('qr-absen-container');
    const tokenInput = document.getElementById('qr-token-text');
    if (!container) return;
    container.innerHTML = '';
    const token = getQrToken();
    if (!token) {
        container.innerHTML = '<p class="text-xs text-slate-400 text-center py-8">Belum ada QR. Tap "Generate QR Baru".</p>';
        if (tokenInput) tokenInput.value = '';
        return;
    }
    new QRCode(container, { text: token, width: 180, height: 180, colorDark: '#000000', colorLight: '#ffffff' });
    if (tokenInput) tokenInput.value = token;
}

function copyQrTokenText() {
    const tokenInput = document.getElementById('qr-token-text');
    if (!tokenInput || !tokenInput.value) return showToast('Belum ada QR untuk disalin.', 'warn');
    tokenInput.select();
    navigator.clipboard.writeText(tokenInput.value).then(() => {
        showToast('Kode berhasil disalin! Bagikan ke kasir lewat WhatsApp.', 'success');
    }).catch(() => {
        showToast('Gagal menyalin otomatis, silakan salin manual dari kotak teksnya.', 'warn');
    });
}

// --- SCANNER QR (kamera live, decode pakai jsQR, tidak butuh internet sama sekali) ---
let qrScanStream = null;
let qrScanRAF = null;
let qrScanPendingType = null; // 'masuk' | 'keluar'
let qrScanPendingEmployee = null; // { id, name } - dipilih lewat modal-employee-picker sebelum scan
let qrScanHintTimeout = null;

// --- PILIH NAMA KARYAWAN (wajib sebelum scan, supaya sistem tahu siapa yang absen) ---
function openEmployeePicker(type) {
    if (employeesCache.length === 0) {
        showToast('Admin belum menambahkan data karyawan. Buka Admin Panel > Kelola Karyawan.', 'warn');
        return;
    }
    if (!getQrToken()) {
        showToast('QR Absen belum di-generate Admin. Hubungi Admin dulu.', 'warn');
        return;
    }

    qrScanPendingType = type;
    const list = document.getElementById('employee-picker-list');
    list.innerHTML = employeesCache.map(emp => `
        <button onclick="selectEmployeeForAttendance('${emp.id}', '${emp.name.replace(/'/g, "\\'")}')" class="w-full bg-slate-50 hover:bg-indigo-50 border border-slate-100 rounded-2xl p-4 text-left font-bold text-slate-800 flex items-center justify-between transition">
            ${emp.name}
            <i data-lucide="chevron-right" class="w-4 h-4 text-slate-300"></i>
        </button>
    `).join('');
    lucide.createIcons();

    document.getElementById('modal-employee-picker').classList.remove('hidden');
    document.getElementById('modal-employee-picker').classList.add('flex');
}

function closeEmployeePicker() {
    document.getElementById('modal-employee-picker').classList.add('hidden');
    document.getElementById('modal-employee-picker').classList.remove('flex');
}

function selectEmployeeForAttendance(id, name) {
    qrScanPendingEmployee = { id, name };
    closeEmployeePicker();
    openQrScanner(qrScanPendingType);
}

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
        document.getElementById('qr-scanner-status').innerText = `Arahkan kamera ke QR Absen di toko (${qrScanPendingEmployee ? qrScanPendingEmployee.name : ''})`;
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

// Input manual: kasir ketik/tempel kode teks dari Admin (misal dikirim lewat WhatsApp),
// dipakai kalau kamera benar-benar tidak bisa scan sama sekali (rusak, gelap, dll).
function toggleManualQrInput() {
    const box = document.getElementById('qr-manual-input-box');
    const isHidden = box.classList.contains('hidden');
    if (isHidden) {
        box.classList.remove('hidden');
        box.classList.add('flex');
        document.getElementById('qr-manual-input').focus();
    } else {
        box.classList.add('hidden');
        box.classList.remove('flex');
    }
}

function submitManualQrCode() {
    const input = document.getElementById('qr-manual-input');
    const value = input.value.trim();
    if (!value) return;
    input.value = '';
    handleQrScanResult(value);
}

function handleQrScanResult(scannedText) {
    clearTimeout(qrScanHintTimeout);
    const expected = getQrToken();
    if (scannedText === expected) {
        const type = qrScanPendingType;
        const employee = qrScanPendingEmployee; // ambil dulu sebelum closeQrScanner() mereset-nya
        closeQrScanner();
        saveAttendanceRecord(type, employee);
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
    qrScanPendingEmployee = null;

    const manualBox = document.getElementById('qr-manual-input-box');
    if (manualBox) { manualBox.classList.add('hidden'); manualBox.classList.remove('flex'); }
    const manualInput = document.getElementById('qr-manual-input');
    if (manualInput) manualInput.value = '';
}

function loadAttendanceSettingsToForm() {
    const s = getAttendanceSettings();
    const msEl = document.getElementById('att-masuk-start');
    const meEl = document.getElementById('att-masuk-end');
    const ksEl = document.getElementById('att-keluar-start');
    const keEl = document.getElementById('att-keluar-end');
    if (msEl) msEl.value = s.masukStart || '12:00';
    if (meEl) meEl.value = s.masukEnd || '18:00';
    if (ksEl) ksEl.value = s.keluarStart || '22:00';
    if (keEl) keEl.value = s.keluarEnd || '23:59';
    renderAttendanceQR();
    renderAttendanceHistory();
    renderEmployeeList();
    renderScheduleCalendar();
}

function getTodayDateStr(date) {
    const d = date || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Baca dari cache lokal (diisi Firestore listener) — TIDAK menulis apa pun ke server,
// dipanggil setiap detik lewat checkAttendanceOverlay jadi harus murni baca saja.
function getOrCreateTodayAttendance() {
    const todayStr = getTodayDateStr();
    const record = attendanceLogCache.find(r => r.date === todayStr);
    return record || { date: todayStr, masukTime: null, keluarTime: null };
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

let attendanceOverlayShownType = null; // 'keluar' | null — overlay ini sekarang khusus jendela absen pulang
let mandatoryMasukGateActive = false; // true kalau absen masuk WAJIB dilakukan dulu (belum absen hari ini)
let absenPopupMandatory = false; // true = popup absensi tidak boleh ditutup manual (lagi wajib absen masuk)
let shiftEndedActive = false; // true = absen keluar sudah dilakukan hari ini, POS tertutup sampai besok
// true selagi Admin Panel sedang dibuka. Semua "layar kunci" kasir (attendance-overlay,
// shift-ended-gate, popup absen wajib) TETAP dihitung statusnya seperti biasa di balik layar,
// tapi sengaja tidak ditampilkan secara visual selama ini true — supaya Admin Panel bisa
// diakses kapan pun tanpa pernah ketutup layar kunci kasir. Begitu Admin kembali ke halaman
// Kasir, layar kunci yang masih berlaku otomatis dimunculkan lagi lewat restoreKasirLockScreensIfNeeded().
let adminPanelOpen = false;

// Absen MASUK sekarang WAJIB kapan pun app dibuka hari itu (tidak terikat jendela jam lagi) —
// beda dengan absen PULANG yang tetap terikat jendela jam seperti sebelumnya.
// Prioritas: shift sudah selesai (keluar tercatat) > wajib absen masuk > jendela absen pulang.
function checkMandatoryMasukGate() {
    if (!attendanceSettingsLoaded || !attendanceLogLoaded) return;
    const record = getOrCreateTodayAttendance();

    // Kalau sudah absen keluar hari ini, POS tertutup total - tidak perlu cek apa pun lagi
    if (record.keluarTime) {
        if (!shiftEndedActive) showShiftEndedGate(record);
        if (mandatoryMasukGateActive) {
            mandatoryMasukGateActive = false;
            absenPopupMandatory = false;
            closeAbsenPopupForced();
        }
        recomputeDashboardLock();
        return;
    }
    if (shiftEndedActive) hideShiftEndedGate(); // jaga-jaga (misal Admin reset absen manual)

    const needsMasuk = !record.masukTime;
    if (needsMasuk && !mandatoryMasukGateActive) {
        mandatoryMasukGateActive = true;
        openAbsenPopup(true);
    } else if (!needsMasuk && mandatoryMasukGateActive) {
        mandatoryMasukGateActive = false;
        absenPopupMandatory = false;
        closeAbsenPopupForced();
    }
    recomputeDashboardLock();
}

function checkAttendanceOverlay(now) {
    // JANGAN putuskan apa pun sebelum data ASLI dari server termuat — ini yang dulu jadi
    // penyebab overlay bisa "kebuka sendiri" beberapa detik setelah refresh (sempat pakai
    // jam default/cache kosong sebelum data sungguhan datang).
    if (!attendanceSettingsLoaded || !attendanceLogLoaded) return;

    const settings = getAttendanceSettings();
    const record = getOrCreateTodayAttendance();

    // Kalau shift sudah selesai (keluar tercatat), overlay jendela pulang tidak relevan lagi
    if (record.keluarTime) {
        if (attendanceOverlayShownType !== null) hideAttendanceOverlay();
        recomputeDashboardLock();
        return;
    }

    // Absen pulang cuma relevan kalau sudah absen masuk duluan, dan tetap terikat jendela jam
    const inKeluarWindow = record.masukTime && isTimeInRange(now, settings.keluarStart, settings.keluarEnd);
    const type = (inKeluarWindow && !record.keluarTime) ? 'keluar' : null;

    if (type && attendanceOverlayShownType !== type) {
        showAttendanceOverlay(type, settings);
    } else if (!type && attendanceOverlayShownType !== null) {
        hideAttendanceOverlay();
    }
    recomputeDashboardLock();
}

function showAttendanceOverlay(type, settings) {
    attendanceOverlayShownType = type;
    if (adminPanelOpen) return; // Admin Panel lagi dibuka — jangan nutupin, munculkan lagi nanti pas kembali ke Kasir

    document.getElementById('attendance-overlay-greeting').innerText = 'Waktunya Absen!';
    document.getElementById('attendance-overlay-subtitle').innerText = 'Waktunya absen pulang kerja';
    document.getElementById('attendance-overlay-icon').setAttribute('data-lucide', 'log-out');
    document.getElementById('attendance-overlay-btn').innerText = 'Absen Pulang';

    document.getElementById('attendance-overlay').classList.remove('hidden');
    document.getElementById('attendance-overlay').classList.add('flex');
    lucide.createIcons();
}

function hideAttendanceOverlay() {
    attendanceOverlayShownType = null;
    const overlay = document.getElementById('attendance-overlay');
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
}

// --- LAYAR SHIFT SELESAI (setelah absen keluar, POS tertutup sampai ganti hari) ---
function showShiftEndedGate(record) {
    shiftEndedActive = true;
    if (adminPanelOpen) return; // Admin Panel lagi dibuka — jangan nutupin, munculkan lagi nanti pas kembali ke Kasir
    const keluarTimeStr = record.keluarTime ? new Date(record.keluarTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
    const who = record.keluarBy ? ` oleh ${record.keluarBy}` : '';
    document.getElementById('shift-ended-subtitle').innerText = `Absen keluar tercatat pukul ${keluarTimeStr}${who}.`;
    const gate = document.getElementById('shift-ended-gate');
    gate.classList.remove('hidden');
    gate.classList.add('flex');
    lucide.createIcons();
}

function hideShiftEndedGate() {
    shiftEndedActive = false;
    const gate = document.getElementById('shift-ended-gate');
    gate.classList.add('hidden');
    gate.classList.remove('flex');
}

// --- KONFIRMASI ABSEN KELUAR (Ya/Tidak, tanpa QR) ---
let confirmKeluarPending = false;

function openConfirmKeluar() {
    document.getElementById('modal-confirm-keluar').classList.remove('hidden');
    document.getElementById('modal-confirm-keluar').classList.add('flex');
    lucide.createIcons();
}

function closeConfirmKeluar() {
    document.getElementById('modal-confirm-keluar').classList.add('hidden');
    document.getElementById('modal-confirm-keluar').classList.remove('flex');
}

function confirmKeluarYes() {
    closeConfirmKeluar();
    closeAbsenPopupForced(); // kalau dipicu dari popup manual, tutup dulu popupnya
    const record = getOrCreateTodayAttendance();
    // Identitas "keluar" ikut nama yang absen masuk hari itu (tidak perlu pilih ulang)
    const employee = record.masukBy ? { name: record.masukBy } : null;
    saveAttendanceRecord('keluar', employee);
}

// Satu sumber kebenaran untuk status kunci dashboard — dipanggil setiap kali salah satu
// kondisi (shift selesai / wajib absen masuk / jendela absen pulang) berubah, supaya tidak
// saling tabrakan.
function recomputeDashboardLock() {
    setDashboardLocked(shiftEndedActive || mandatoryMasukGateActive || attendanceOverlayShownType === 'keluar');
}

// Kunci sungguhan (bukan cuma visual): saat overlay/popup wajib aktif, elemen di baliknya
// dikasih pointer-events:none sekaligus inert, jadi walau ada bug CSS/z-index, dashboard TETAP
// tidak bisa disentuh sampai terkunci ini dilepas. Header TIDAK ikut dikunci (z-index lebih
// tinggi dari semua overlay ini) supaya Admin tetap bisa masuk kapan saja.
function setDashboardLocked(locked) {
    ['page-home', 'bottom-bar'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('dashboard-locked', locked);
        if (locked) el.setAttribute('inert', ''); else el.removeAttribute('inert');
    });
}

// Fungsi inti penyimpanan absen, dipakai baik oleh overlay wajib maupun popup manual di header.
// `employee` = { id, name } dari hasil pilih nama di modal-employee-picker (opsional untuk kompatibilitas lama).
function saveAttendanceRecord(type, employee) {
    if (!window.FB || !window.FB.ready) {
        showToast('Belum terhubung ke database. Coba lagi sebentar.', 'warn');
        return;
    }
    const todayStr = getTodayDateStr();
    const now = new Date().toISOString();
    const { db, doc, setDoc } = window.FB;

    const field = type === 'masuk'
        ? { masukTime: now, masukBy: employee ? employee.name : null, masukById: employee ? employee.id : null }
        : { keluarTime: now, keluarBy: employee ? employee.name : null };

    setDoc(doc(db, 'attendance', todayStr), { date: todayStr, ...field }, { merge: true }).then(() => {
        const who = employee ? ` (${employee.name})` : '';
        showToast((type === 'masuk' ? 'Absen masuk tercatat!' : 'Absen pulang tercatat!') + who, 'success');
    }).catch((err) => {
        console.error('Gagal simpan absen:', err);
        showToast('Gagal menyimpan absen ke server.', 'warn');
    });

    // Kalau overlay absen pulang sedang tampil untuk sesi yang sama, otomatis tutup juga
    // supaya kasir tidak diminta absen dua kali setelah pakai tombol manual di header
    if (attendanceOverlayShownType === type) hideAttendanceOverlay();
}

function recordAttendance() {
    const type = attendanceOverlayShownType;
    if (!type) return;
    if (type === 'keluar') {
        openConfirmKeluar(); // absen keluar cukup konfirmasi Ya/Tidak, tanpa QR
    } else {
        openEmployeePicker(type);
    }
}

function formatDurationHM(msDuration) {
    const totalMinutes = Math.floor(msDuration / 60000);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}j ${m}m`;
}

// --- POPUP ABSENSI (dibuka manual lewat tombol fingerprint di header, ATAU otomatis+wajib
// oleh checkMandatoryMasukGate begitu app dibuka & belum absen masuk hari itu) ---
function openAbsenPopup(mandatory) {
    absenPopupMandatory = !!mandatory;
    // Kalau ini pop-up WAJIB yang dipicu otomatis sementara Admin Panel lagi dibuka, jangan
    // ditampilkan dulu — biar Admin Panel tidak ketutup. Popup manual (klik ikon fingerprint
    // di header) tetap boleh muncul kapan saja.
    if (mandatory && adminPanelOpen) return;
    renderAbsenPopup();
    const modal = document.getElementById('modal-absen-popup');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('absen-popup-close-btn').classList.toggle('hidden', absenPopupMandatory);
    lucide.createIcons();
}

// Dipanggil dari tombol X — kalau lagi wajib (belum absen masuk), tidak boleh ditutup manual
function closeAbsenPopup() {
    if (absenPopupMandatory) {
        showToast('Wajib absen masuk dulu sebelum bisa mulai jualan.', 'warn');
        return;
    }
    closeAbsenPopupForced();
}

// Versi internal tanpa guard, dipakai saat memang boleh/perlu ditutup secara terprogram
// (absen masuk baru saja berhasil, atau lanjut ke langkah pilih karyawan)
function closeAbsenPopupForced() {
    const modal = document.getElementById('modal-absen-popup');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function recordAttendanceManual(type) {
    if (type === 'keluar') {
        openConfirmKeluar(); // absen keluar cukup konfirmasi Ya/Tidak, tanpa QR (popup ditutup di confirmKeluarYes)
        return;
    }
    closeAbsenPopupForced();
    openEmployeePicker(type);
}

function renderAbsenPopup() {
    const record = getOrCreateTodayAttendance();
    const dateStr = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('absen-popup-date').innerText = dateStr;

    const body = document.getElementById('absen-popup-body');
    const masukStr = record.masukTime ? new Date(record.masukTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : null;
    const keluarStr = record.keluarTime ? new Date(record.keluarTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : null;

    if (!record.masukTime) {
        body.innerHTML = `
            <div class="bg-slate-50 rounded-2xl p-5 text-center mb-4">
                <i data-lucide="clock" class="w-6 h-6 text-slate-300 mx-auto mb-2"></i>
                <p class="text-sm text-slate-500 font-semibold">Belum absen masuk hari ini</p>
            </div>
            <button onclick="recordAttendanceManual('masuk')" class="w-full bg-emerald-500 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2">
                <i data-lucide="log-in" class="w-5 h-5"></i> Absen Masuk
            </button>`;
    } else if (!record.keluarTime) {
        body.innerHTML = `
            <div class="flex items-center justify-between bg-emerald-50 rounded-2xl p-4">
                <div>
                    <p class="text-[10px] text-emerald-600 font-bold uppercase">Jam Masuk${record.masukBy ? ` - ${record.masukBy}` : ''}</p>
                    <p class="text-2xl font-black text-emerald-700">${masukStr}</p>
                </div>
                <button onclick="recordAttendanceManual('keluar')" class="bg-orange-500 text-white px-5 py-3.5 rounded-xl font-bold flex items-center gap-2 shrink-0">
                    <i data-lucide="log-out" class="w-4 h-4"></i> Keluar
                </button>
            </div>`;
    } else {
        body.innerHTML = `
            <div class="grid grid-cols-2 gap-3">
                <div class="bg-emerald-50 rounded-2xl p-4 text-center">
                    <p class="text-[10px] text-emerald-600 font-bold uppercase">Masuk${record.masukBy ? ` - ${record.masukBy}` : ''}</p>
                    <p class="text-lg font-black text-emerald-700">${masukStr}</p>
                </div>
                <div class="bg-orange-50 rounded-2xl p-4 text-center">
                    <p class="text-[10px] text-orange-600 font-bold uppercase">Pulang${record.keluarBy ? ` - ${record.keluarBy}` : ''}</p>
                    <p class="text-lg font-black text-orange-700">${keluarStr}</p>
                </div>
            </div>
            <p class="text-center text-xs text-slate-400 font-semibold mt-4">Absensi hari ini sudah lengkap ✓</p>`;
    }
    lucide.createIcons();
}

function renderAttendanceHistory() {
    const body = document.getElementById('attendance-history-body');
    if (!body) return;
    const log = attendanceLogCache.slice().sort((a, b) => b.date.localeCompare(a.date));

    body.innerHTML = log.map(r => {
        const masukStr = r.masukTime ? new Date(r.masukTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';
        const keluarStr = r.keluarTime ? new Date(r.keluarTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';
        let durasi = '-';
        if (r.masukTime && r.keluarTime) {
            durasi = formatDurationHM(new Date(r.keluarTime) - new Date(r.masukTime));
        }
        const tanggalFormatted = new Date(r.date + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
        const karyawanText = [r.masukBy, r.keluarBy].filter((v, i, arr) => v && arr.indexOf(v) === i).join(', ') || '-';
        return `
        <tr class="border-b border-slate-50">
            <td class="p-3 font-semibold text-slate-700">${tanggalFormatted}</td>
            <td class="p-3 text-emerald-600 font-bold">${masukStr}</td>
            <td class="p-3 text-orange-600 font-bold">${keluarStr}</td>
            <td class="p-3 text-slate-500">${durasi}</td>
            <td class="p-3 text-slate-700 font-semibold">${karyawanText}</td>
        </tr>`;
    }).join('') || `<tr><td colspan="5" class="text-center p-6 text-slate-400">Belum ada riwayat absensi</td></tr>`;
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

    const now = new Date();
    // ID struk berbasis waktu (bukan counter manual) supaya tidak pernah tabrakan
    // walau ada beberapa HP kasir membuat transaksi di saat yang hampir bersamaan.
    const receiptID = now.toISOString().replace(/[-:T.]/g, '').slice(2, 14) + Math.floor(Math.random() * 90 + 10);

    lastOrder = {
        id: receiptID,
        date: now.toLocaleString('id-ID'),
        timestamp: now.toISOString(), // dipakai untuk filter laporan "Sales Hari Ini" secara akurat
        total: cart.reduce((sum, item) => sum + (item.price * item.qty), 0),
        method: selectedPayment,
        items: JSON.parse(JSON.stringify(cart))
    };

    saveOrderToFirestore(lastOrder);
    decreaseStockForOrder(lastOrder.items, getCurrentKasirEmployeeId());
    updateConnectionUI();

    document.getElementById('modal-checkout').classList.add('hidden');
    document.getElementById('modal-success').classList.remove('hidden');
    lucide.createIcons();
}

// Simpan transaksi ke koleksi 'sales' di Firestore. Tabel riwayat & laporan penjualan
// otomatis ke-update lewat onSnapshot listener di initFirestoreSync (tidak perlu push manual
// ke array orderHistory di sini, supaya tidak dobel begitu listener-nya jalan).
function saveOrderToFirestore(order) {
    if (!window.FB || !window.FB.ready) {
        showToast('Belum terhubung ke database, transaksi akan otomatis tersimpan begitu koneksi ke server aktif.', 'warn');
        return;
    }
    const { db, collection, addDoc } = window.FB;
    addDoc(collection(db, 'sales'), order).catch((err) => {
        console.error('Gagal menyimpan transaksi:', err);
        showToast('Gagal menyimpan transaksi ke server.', 'warn');
    });
}

function finishTransaction() {
    cart = [];
    lastOrder = null;
    updateCartUI();
    document.getElementById('modal-success').classList.add('hidden');
    // Kembali ke kategori "Makanan" kalau memang ada & tampil buat kasir ini; kalau tidak
    // (misal katalog kasir ini tidak termasuk kategori itu), pakai kategori pertama yang tampil.
    const visibleCategories = getVisibleCategoriesForCurrentKasir();
    filterCategory(visibleCategories.includes('Makanan') ? 'Makanan' : (visibleCategories[0] || ''));
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

    const enteringAdmin = page === 'admin';
    adminPanelOpen = enteringAdmin;

    if (enteringAdmin) {
        // Admin Panel harus selalu bisa diakses & terlihat penuh, kapan pun — termasuk saat
        // kasir sedang dalam kondisi terkunci (absen keluar / wajib absen masuk / jendela absen
        // pulang). Sembunyikan dulu layar kunci kasir yang mungkin masih aktif di baliknya.
        forceHideKasirLockScreens();
        renderAdminTools();
        loadAttendanceSettingsToForm();
    } else {
        // Balik ke halaman Kasir — munculkan lagi layar kunci kasir kalau kondisinya masih berlaku.
        restoreKasirLockScreensIfNeeded();
    }
    lucide.createIcons();
}

// Sembunyikan SECARA VISUAL SAJA overlay/gate/popup kunci kasir (tanpa mengubah flag state-nya),
// dipanggil setiap kali Admin Panel dibuka supaya tidak pernah ketutup layar kunci kasir.
function forceHideKasirLockScreens() {
    const overlay = document.getElementById('attendance-overlay');
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');

    const gate = document.getElementById('shift-ended-gate');
    gate.classList.add('hidden');
    gate.classList.remove('flex');

    const popup = document.getElementById('modal-absen-popup');
    if (popup) {
        popup.classList.add('hidden');
        popup.classList.remove('flex');
    }
}

// Dipanggil saat keluar dari Admin Panel (kembali ke halaman Kasir) — cek flag state yang
// sudah dihitung di balik layar tadi, lalu munculkan lagi layar kunci yang sesuai kalau masih berlaku.
function restoreKasirLockScreensIfNeeded() {
    if (shiftEndedActive) {
        const gate = document.getElementById('shift-ended-gate');
        gate.classList.remove('hidden');
        gate.classList.add('flex');
        return; // shift selesai = POS tertutup total, gate lain tidak relevan lagi
    }
    if (attendanceOverlayShownType) {
        const overlay = document.getElementById('attendance-overlay');
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
    }
    if (mandatoryMasukGateActive) {
        openAbsenPopup(true); // adminPanelOpen sudah false di titik ini, jadi popup beneran muncul
    }
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
