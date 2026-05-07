let katalog = JSON.parse(localStorage.getItem('okt_katalog')) || [];
let keranjang = [];
let riwayat = JSON.parse(localStorage.getItem('okt_riwayat')) || [];
let qrisImg = localStorage.getItem('okt_qris_img') || '';

// Inisialisasi
document.addEventListener('DOMContentLoaded', () => {
    renderBeranda();
    renderAdminKatalog();
    document.getElementById('view-qris').src = qrisImg;
});

function toggleSidebar() {
    document.getElementById('sidebar-admin').classList.toggle('active');
    document.getElementById('overlay').classList.toggle('active');
}

// SIMPAN ATAU UPDATE MENU
function simpanKeKatalog() {
    const idx = document.getElementById('edit-idx').value;
    const nama = document.getElementById('in-nama').value;
    const harga = document.getElementById('in-harga').value;
    const stok = document.getElementById('in-stok').value;
    const fotoFile = document.getElementById('in-foto').files[0];

    if (!nama || !harga) return alert("Isi Nama dan Harga!");

    const simpanData = (imgBase64 = '') => {
        const item = {
            nama,
            harga: parseInt(harga),
            stok: parseInt(stok) || 0,
            foto: imgBase64 || (idx !== "-1" ? katalog[idx].foto : '')
        };

        if (idx === "-1") {
            if (katalog.length >= 20) return alert("Maksimal 20 Menu!");
            katalog.push(item);
        } else {
            katalog[idx] = item;
        }

        localStorage.setItem('okt_katalog', JSON.stringify(katalog));
        resetForm();
        renderBeranda();
        renderAdminKatalog();
        alert("Berhasil!");
    };

    if (fotoFile) {
        const reader = new FileReader();
        reader.onload = (e) => simpanData(e.target.result);
        reader.readAsDataURL(fotoFile);
    } else {
        simpanData();
    }
}

// TOMBOL (+) UNTUK EDIT
function bukaEdit(index) {
    const item = katalog[index];
    document.getElementById('edit-idx').value = index;
    document.getElementById('in-nama').value = item.nama;
    document.getElementById('in-harga').value = item.harga;
    document.getElementById('in-stok').value = item.stok;
    
    document.getElementById('form-label').innerText = "Edit: " + item.nama;
    document.getElementById('btn-submit').innerText = "UPDATE MENU";
    document.getElementById('btn-submit').style.background = "#f39c12";
    document.getElementById('btn-batal').style.display = "block";
    
    document.getElementById('admin-form').scrollIntoView({ behavior: 'smooth' });
}

function hapusMenu(index) {
    if (confirm("Hapus " + katalog[index].nama + "?")) {
        katalog.splice(index, 1);
        localStorage.setItem('okt_katalog', JSON.stringify(katalog));
        renderBeranda();
        renderAdminKatalog();
    }
}

function resetForm() {
    document.getElementById('edit-idx').value = "-1";
    document.getElementById('in-nama').value = "";
    document.getElementById('in-harga').value = "";
    document.getElementById('in-stok').value = "";
    document.getElementById('in-foto').value = "";
    document.getElementById('form-label').innerText = "Tambah Menu Baru";
    document.getElementById('btn-submit').innerText = "SIMPAN MENU";
    document.getElementById('btn-submit').style.background = "#27ae60";
    document.getElementById('btn-batal').style.display = "none";
}

// RENDER DAFTAR ADMIN (MEMASTIKAN TOMBOL + ADA)
function renderAdminKatalog() {
    const list = document.getElementById('admin-katalog-list');
    list.innerHTML = katalog.length ? '' : '<p style="text-align:center; font-size:12px;">Menu Kosong</p>';
    
    katalog.forEach((item, index) => {
        list.innerHTML += `
            <div class="admin-item">
                <img src="${item.foto || 'https://via.placeholder.com/50'}" alt="img">
                <div class="admin-info">
                    <strong>${item.nama}</strong><br>
                    <span>Rp ${item.harga.toLocaleString()}</span>
                </div>
                <div class="admin-actions">
                    <button class="btn-edit-plus" onclick="bukaEdit(${index})">+</button>
                    <button class="btn-del-trash" onclick="hapusMenu(${index})">🗑</button>
                </div>
            </div>
        `;
    });
}

function renderBeranda() {
    const container = document.getElementById('main-display');
    container.innerHTML = katalog.length ? '' : '<p style="grid-column:1/3; text-align:center; margin-top:50px;">Belum ada menu.</p>';
    katalog.forEach((item, index) => {
        container.innerHTML += `
            <div class="card">
                <img src="${item.foto || 'https://via.placeholder.com/150'}" alt="img">
                <div class="card-body">
                    <h3>${item.nama}</h3>
                    <p>Rp ${item.harga.toLocaleString()}</p>
                    <button class="btn-primary" onclick="tambahKeKeranjang(${index})" style="padding:8px; font-size:12px;">+ Keranjang</button>
                </div>
            </div>
        `;
    });
}

// LOGIKA KASIR
function tambahKeKeranjang(idx) {
    const p = katalog[idx];
    const ada = keranjang.find(i => i.nama === p.nama);
    if (ada) ada.qty++;
    else keranjang.push({ nama: p.nama, harga: p.harga, qty: 1 });
    updateCartUI();
}

function updateCartUI() {
    const qty = keranjang.reduce((a, b) => a + b.qty, 0);
    const total = keranjang.reduce((a, b) => a + (b.harga * b.qty), 0);
    document.getElementById('cart-count').innerText = qty + " Item";
    document.getElementById('cart-total').innerText = "Rp " + total.toLocaleString();
}

function bukaModalBayar() {
    if (!keranjang.length) return alert("Keranjang Kosong!");
    const list = document.getElementById('list-bayar');
    list.innerHTML = keranjang.map(i => `
        <div style="display:flex; justify-content:space-between; margin-bottom:10px; font-size:14px;">
            <span>${i.nama} (x${i.qty})</span>
            <span>Rp ${(i.harga * i.qty).toLocaleString()}</span>
        </div>
    `).join('');
    
    const total = keranjang.reduce((a, b) => a + (b.harga * b.qty), 0);
    document.getElementById('total-harga-bayar').innerText = "Rp " + total.toLocaleString();
    document.getElementById('modal-bayar').style.display = 'block';
}

function tutupModalBayar() { document.getElementById('modal-bayar').style.display = 'none'; }

function transaksiSelesai() {
    const metode = document.getElementById('select-metode').value;
    const total = keranjang.reduce((a, b) => a + (b.harga * b.qty), 0);
    riwayat.push({
        tgl: new Date().toLocaleString(),
        time: new Date().getTime(),
        items: keranjang.map(i => `${i.nama}(${i.qty})`).join(", "),
        total,
        metode
    });
    localStorage.setItem('okt_riwayat', JSON.stringify(riwayat));
    alert("Sukses!");
    keranjang = [];
    updateCartUI();
    tutupModalBayar();
}

// FITUR LAIN
function uploadQRIS(input) {
    const reader = new FileReader();
    reader.onload = (e) => {
        qrisImg = e.target.result;
        localStorage.setItem('okt_qris_img', qrisImg);
        document.getElementById('view-qris').src = qrisImg;
    };
    reader.readAsDataURL(input.files[0]);
}

function tampilQRIS() {
    document.getElementById('box-qris').style.display = (document.getElementById('select-metode').value === 'Qris') ? 'block' : 'none';
}

function cetakPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const data30 = riwayat.filter(h => h.time >= (new Date().getTime() - 30*24*60*60*1000));
    if(!data30.length) return alert("Data kosong.");
    doc.text("LAPORAN PENJUALAN OKTSHOP17", 10, 10);
    const rows = data30.map((h, i) => [i+1, h.tgl, h.items, h.metode, h.total.toLocaleString()]);
    doc.autoTable({ head: [['No', 'Tgl', 'Menu', 'Metode', 'Total']], body: rows });
    doc.save("Laporan.pdf");
}

function bersihkanRiwayat() {
    if(confirm("Hapus semua riwayat?")) {
        riwayat = [];
        localStorage.setItem('okt_riwayat', JSON.stringify(riwayat));
    }
}
