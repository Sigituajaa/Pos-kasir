// Variable lokal untuk kasir
let cartItems = [];
let totalTagihan = 0;

// Fungsi Menambah Item ke Kasir (Dipanggil dari daftar produk)
window.addToCart = (name, price) => {
    cartItems.push({name, price});
    updateKasirDisplay();
};

function updateKasirDisplay() {
    totalTagihan = cartItems.reduce((sum, item) => sum + item.price, 0);
    document.getElementById('cart-count').innerText = cartItems.length;
    document.getElementById('checkout-total').innerText = "Rp " + totalTagihan.toLocaleString();
}

window.resetCart = () => {
    cartItems = [];
    updateKasirDisplay();
};

// Fungsi Selesai Transaksi (Simpan ke Firebase)
window.finishTransaction = async () => {
    if (cartItems.length === 0) return alert("Keranjang kosong!");
    
    const method = document.getElementById('payMethod').value;
    const saleID = "SALE-" + Date.now();

    try {
        await setDoc(doc(db, "sales_history", saleID), {
            items: cartItems,
            total: totalTagihan,
            method: method,
            admin: userData.name,
            timestamp: serverTimestamp()
        });
        
        alert("Transaksi Berhasil Disimpan!");
        resetCart();
    } catch (e) {
        alert("Gagal menyimpan transaksi");
    }
};

// Update Load Katalog Admin agar ada tombol "Tambah ke Kasir"
function loadKatalogAdmin() {
    onSnapshot(collection(db, "products"), (snap) => {
        const list = document.getElementById('admin-prod-list');
        list.innerHTML = "";
        snap.forEach(d => {
            const p = d.data();
            list.innerHTML += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; background:rgba(255,255,255,0.05); margin-bottom:5px; border-radius:10px;">
                <span>${p.name}</span>
                <div>
                    <button onclick="addToCart('${p.name}', ${p.price})" class="btn-primary btn-sm" style="width:auto; display:inline; padding:5px 10px;">+ Kasir</button>
                    <button onclick="deleteProduct('${d.id}')" style="background:none; color:red; width:auto; display:inline; margin-left:10px;"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
        });
    });
}
