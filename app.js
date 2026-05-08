// Tambahkan import Storage
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const storage = getStorage(app);

// --- Handle Save Product (With Image) ---
document.getElementById('btnSaveProduct').onclick = async () => {
    const name = document.getElementById('pName').value;
    const price = parseInt(document.getElementById('pPrice').value);
    const stock = parseInt(document.getElementById('pStock').value);
    const imageFile = document.getElementById('pImage').files[0];

    if (!name || !price || !imageFile) return alert("Mohon lengkapi data dan foto!");

    try {
        showLoading(true);
        // 1. Upload ke Storage
        const storageRef = ref(storage, `products/${name}_${Date.now()}`);
        const snapshot = await uploadBytes(storageRef, imageFile);
        const downloadURL = await getDownloadURL(snapshot.ref);

        // 2. Simpan ke Firestore
        await setDoc(doc(db, "products", name), {
            name: name,
            price: price,
            stock: stock,
            image: downloadURL,
            createdAt: serverTimestamp()
        });

        alert("Produk Berhasil Disimpan!");
        location.reload();
    } catch (err) {
        console.error(err);
        alert("Gagal menyimpan produk");
    } finally {
        showLoading(false);
    }
};

// --- Handle Update QRIS ---
document.getElementById('qrisInput').onchange = async (e) => {
    const file = e.target.files[0];
    if(!file) return;

    try {
        showLoading(true);
        const qrisRef = ref(storage, 'config/qris_payment');
        await uploadBytes(qrisRef, file);
        const url = await getDownloadURL(qrisRef);
        
        // Simpan URL QRIS ke koleksi config agar bisa dipanggil di modal bayar
        await setDoc(doc(db, "settings", "payment"), { qrisUrl: url });
        
        alert("QRIS Berhasil Diupdate!");
    } catch (err) {
        alert("Gagal update QRIS");
    } finally {
        showLoading(false);
    }
};

// --- Fungsi Pendukung ---
window.exportReport = () => {
    alert("Fitur Laporan Sedang Disiapkan (Export CSV)");
    // Di sini Anda bisa menambahkan logic export excel/csv dari koleksi orders
};

window.clearHistory = async () => {
    if(confirm("Hapus semua riwayat transaksi? Data tidak bisa dikembalikan.")){
        // Logic untuk menghapus koleksi orders (Admin only)
        alert("Riwayat dihapus.");
    }
};

function showLoading(status) {
    document.getElementById('loading').classList.toggle('hidden', !status);
}

// Tambahkan listener untuk daftar katalog di sidebar
function loadAdminCatalog() {
    onSnapshot(collection(db, "products"), (snap) => {
        const list = document.getElementById('admin-prod-list');
        if(snap.empty) {
            list.innerHTML = '<p class="empty-text">Menu Kosong</p>';
            return;
        }
        list.innerHTML = "";
        snap.forEach(d => {
            const p = d.data();
            list.innerHTML += `
                <div style="display:flex; justify-content:space-between; font-size:12px; border-bottom:1px solid #eee; padding:5px 0;">
                    <span>${p.name} (Stok: ${p.stock})</span>
                    <b style="color:red; cursor:pointer" onclick="deleteProduct('${d.id}')">Hapus</b>
                </div>
            `;
        });
    });
}
// Panggil loadAdminCatalog() di dalam onAuthStateChanged jika role === 'admin'
