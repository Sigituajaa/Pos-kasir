import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const storage = getStorage(app);

// Update Fungsi Admin
async function loadAdminData() {
    // Load Daftar Produk untuk Admin
    onSnapshot(collection(db, "products"), (snap) => {
        const list = document.getElementById('admin-prod-list');
        list.innerHTML = "";
        if (snap.empty) list.innerHTML = "Menu Kosong";
        snap.forEach(doc => {
            const p = doc.data();
            list.innerHTML += `<div style="display:flex; justify-content:space-between; padding:5px; border-bottom:1px solid #eee">
                <span>${p.name} - Rp ${p.price.toLocaleString()}</span>
                <button onclick="deleteProduct('${doc.id}')" style="color:red; background:none; width:auto; padding:0">Hapus</button>
            </div>`;
        });
    });
}

// Simpan Menu Baru dengan Gambar
document.getElementById('btnSaveProduct').onclick = async () => {
    const name = document.getElementById('pName').value;
    const price = parseInt(document.getElementById('pPrice').value);
    const stock = parseInt(document.getElementById('pStock').value);
    const file = document.getElementById('pImage').files[0];

    if (!name || !price) return alert("Isi Nama & Harga!");

    try {
        let url = "";
        if (file) {
            const storageRef = ref(storage, 'products/' + name);
            await uploadBytes(storageRef, file);
            url = await getDownloadURL(storageRef);
        }

        await setDoc(doc(db, "products", name), {
            name, price, stock, image: url, createdAt: serverTimestamp()
        });
        alert("Menu Berhasil Disimpan!");
        document.getElementById('pName').value = "";
        document.getElementById('pPrice').value = "";
    } catch (e) { alert("Gagal Simpan: " + e.message); }
};

// Fungsi Delete
window.deleteProduct = async (id) => {
    if(confirm("Hapus menu ini?")) {
        await deleteDoc(doc(db, "products", id));
    }
};
