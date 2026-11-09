// ==========================================
// DATOS SIMULADOS / SUPABASE INTEGRATION
// ==========================================
let depositsData = [
  { id: '#DEP-1001', user: 'César Gómez', method: 'Pago Móvil (Banesco)', amount: '5.000,00', ref: '00894512', status: 'pending', phone: '04123915398' },
  { id: '#DEP-1002', user: 'LlaneroPro', method: 'Binance Pay (USDT)', amount: '12.500,00', ref: '284910491', status: 'pending', phone: '04141234567' },
  { id: '#DEP-1003', user: 'SBR_Gamer', method: 'Pago Móvil (Mercantil)', amount: '1.000,00', ref: '99410238', status: 'approved', phone: '04247654321' }
];

let withdrawalsData = [
  { id: '#RET-5001', user: 'CriptoKing', destination: 'Pago Móvil 0414-1234567 (Banesco)', amount: '25.000,00', status: 'pending', phone: '04141234567' },
  { id: '#RET-5002', user: 'ApurePro', destination: 'Pago Móvil 0424-7654321 (BDV)', amount: '50.000,00', status: 'pending', phone: '04247654321' }
];

let activeWithdrawalIndex = null; 
let activeDepositIndex = null; // Guarda el índice del depósito que se está procesando

function showAdminTab(tab) {
  document.getElementById('admin-deposits').style.display = tab === 'deposits' ? 'block' : 'none';
  document.getElementById('admin-withdrawals').style.display = tab === 'withdrawals' ? 'block' : 'none';
  
  const links = document.querySelectorAll('.nav-menu a');
  if (links.length >= 2) {
    links[0].classList.toggle('active', tab === 'deposits');
    links[1].classList.toggle('active', tab === 'withdrawals');
  }
}

function renderDeposits() {
  const tbody = document.getElementById('deposits-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  depositsData.forEach((item, index) => {
    let statusBadge = '';
    if (item.status === 'pending') statusBadge = '<span class="status-pill pending">Pendiente</span>';
    else if (item.status === 'approved') statusBadge = '<span class="status-pill approved">Aprobado</span>';
    else statusBadge = '<span class="status-pill rejected">Rechazado</span>';

    let actions = item.status === 'pending' ? `
      <button class="btn-approve" onclick="openDepositModal(${index})">✓ Aprobar & Factura</button>
      <button class="btn-reject" onclick="updateDepositStatus(${index}, 'rejected')">✕ Rechazar</button>
    ` : '<span style="color: #64748b;">Procesado</span>';

    tbody.innerHTML += `
      <tr>
        <td><strong>${item.id}</strong></td>
        <td>${item.user}</td>
        <td>${item.method}</td>
        <td style="color: #4ade80; font-weight: bold;">${item.amount} VES</td>
        <td><code>${item.ref}</code></td>
        <td>${statusBadge}</td>
        <td>${actions}</td>
      </tr>
    `;
  });
}

function renderWithdrawals() {
  const tbody = document.getElementById('withdrawals-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  withdrawalsData.forEach((item, index) => {
    let statusBadge = '';
    if (item.status === 'pending') statusBadge = '<span class="status-pill pending">Pendiente</span>';
    else if (item.status === 'approved') statusBadge = '<span class="status-pill approved">Aprobado</span>';
    else statusBadge = '<span class="status-pill rejected">Rechazado</span>';

    let actions = item.status === 'pending' ? `
      <button class="btn-approve" onclick="openWithdrawalModal(${index})">✓ Procesar Pago</button>
      <button class="btn-reject" onclick="updateWithdrawalStatus(${index}, 'rejected')">✕ Rechazar</button>
    ` : '<span style="color: #64748b;">Procesado</span>';

    tbody.innerHTML += `
      <tr>
        <td><strong>${item.id}</strong></td>
        <td>${item.user}</td>
        <td>${item.destination}</td>
        <td style="color: #f43f5e; font-weight: bold;">${item.amount} VES</td>
        <td>${statusBadge}</td>
        <td>${actions}</td>
      </tr>
    `;
  });
}

// ==========================================
// MODAL DE FACTURACIÓN Y APROBACIÓN (DEPÓSITOS)
// ==========================================
function openDepositModal(index) {
  activeDepositIndex = index;
  const item = depositsData[index];

  // Si prefieres un prompt rápido para depósitos o un modal dedicado:
  const confirmApprove = confirm(`¿Aprobar el depósito de ${item.user} por ${item.amount} VES (Ref: ${item.ref}) y enviar comprobante por WhatsApp?`);
  if (!confirmApprove) return;

  item.status = 'approved';

  const todayDate = new Date().toLocaleDateString('es-VE');
  const invoiceText = 
`🧾 *COMPROBANTE DE DEPÓSITO - GUSANOS ROYALE* 🪱🔥

¡Hola *@${item.user}*! Tu depósito ha sido verificado y acreditado con éxito en tu cuenta.

━━━━━━━━━━━━━━━━━━
👤 *Usuario:* @${item.user}
💳 *Método:* ${item.method}
💰 *Monto Acreditado:* *${item.amount} VES*
🔢 *Referencia:* *${item.ref}*
📅 *Fecha:* ${todayDate}
━━━━━━━━━━━━━━━━━━

¡Ya tienes tu saldo disponible para entrar a las arenas y ganar en Gusanos Royale! 🚀`;

  let rawPhone = item.phone || '';
  let cleanPhone = rawPhone.replace(/[^0-9]/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '58' + cleanPhone.substring(1);
  } else if (!cleanPhone.startsWith('58') && cleanPhone.length === 10) {
    cleanPhone = '58' + cleanPhone;
  }

  let whatsappUrl = `https://wa.me/?text=${encodeURIComponent(invoiceText)}`;
  if (cleanPhone) {
    whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(invoiceText)}`;
  }

  window.open(whatsappUrl, '_blank');
  renderDeposits();
  alert("¡Depósito aprobado, saldo acreditado y factura generada para WhatsApp!");
}

function updateDepositStatus(index, newStatus) {
  if (newStatus === 'rejected') {
    if (!confirm("¿Seguro que deseas rechazar este depósito?")) return;
    depositsData[index].status = 'rejected';
    renderDeposits();
    alert("Solicitud de depósito rechazada.");
  }
}

// ==========================================
// MODAL DE FACTURACIÓN Y COMISIONES (RETIROS)
// ==========================================
function openWithdrawalModal(index) {
  activeWithdrawalIndex = index;
  const item = withdrawalsData[index];

  const userDisp = document.getElementById('modal-user-display');
  const amountDisp = document.getElementById('modal-requested-amount');
  const rateInput = document.getElementById('input-commission-rate');
  const refInput = document.getElementById('input-bank-reference');
  const phoneInput = document.getElementById('input-user-phone');

  if (userDisp) userDisp.innerText = `@${item.user}`;
  if (amountDisp) amountDisp.innerText = `${item.amount} VES`;
  if (rateInput) rateInput.value = 0; 
  if (refInput) refInput.value = '';
  if (phoneInput && item.phone) phoneInput.value = item.phone;

  recalculateWithdrawalModal();

  const modalOverlay = document.getElementById('modal-withdrawal-overlay');
  if (modalOverlay) {
    modalOverlay.style.display = 'flex';
  } else {
    processWithdrawalWithPrompt(index);
  }
}

function recalculateWithdrawalModal() {
  if (activeWithdrawalIndex === null) return;
  const item = withdrawalsData[activeWithdrawalIndex];
  
  const cleanAmount = parseFloat(item.amount.replace(/\./g, '').replace(',', '.')) || 0;
  const rateInput = document.getElementById('input-commission-rate');
  const rate = rateInput ? (parseFloat(rateInput.value) || 0) : 0;

  const fee = (cleanAmount * rate) / 100;
  const netToDeposit = cleanAmount - fee;

  const feePercentElem = document.getElementById('modal-fee-percent');
  const feeAmountElem = document.getElementById('modal-fee-amount');
  const netAmountElem = document.getElementById('modal-net-amount');

  if (feePercentElem) feePercentElem.innerText = rate;
  if (feeAmountElem) feeAmountElem.innerText = fee.toLocaleString('es-VE', { minimumFractionDigits: 2 });
  if (netAmountElem) netAmountElem.innerText = netToDeposit.toLocaleString('es-VE', { minimumFractionDigits: 2 });
}

function closeWithdrawalModal() {
  const modalOverlay = document.getElementById('modal-withdrawal-overlay');
  if (modalOverlay) modalOverlay.style.display = 'none';
  activeWithdrawalIndex = null;
}

function confirmWithdrawalAndSendInvoice() {
  if (activeWithdrawalIndex === null) return;

  const refInput = document.getElementById('input-bank-reference');
  const reference = refInput ? refInput.value.trim() : '';

  if (!reference) {
    alert("Por favor ingresa el número de referencia bancaria del pago móvil.");
    return;
  }

  const item = withdrawalsData[activeWithdrawalIndex];
  const cleanAmount = parseFloat(item.amount.replace(/\./g, '').replace(',', '.')) || 0;
  const rateInput = document.getElementById('input-commission-rate');
  const rate = rateInput ? (parseFloat(rateInput.value) || 0) : 0;
  const fee = (cleanAmount * rate) / 100;
  const netToDeposit = cleanAmount - fee;
  const todayDate = new Date().toLocaleDateString('es-VE');

  item.status = 'approved';

  const invoiceText = 
`🧾 *COMPROBANTE DE RETIRO - GUSANOS ROYALE* 🪱🔥

Hola *@${item.user}*, tu solicitud de retiro ha sido procesada con éxito.

━━━━━━━━━━━━━━━━━━
👤 *Usuario:* @${item.user}
💰 *Monto Solicitado:* ${cleanAmount.toLocaleString('es-VE')} VES
📉 *Comisión / Servicio (${rate}%):* ${fee.toLocaleString('es-VE')} VES
✅ *Monto Depositado:* *${netToDeposit.toLocaleString('es-VE')} VES*
🔢 *Referencia Bancaria:* *${reference}*
📅 *Fecha:* ${todayDate}
━━━━━━━━━━━━━━━━━━

¡Gracias por jugar con nosotros y ganar en Gusanos Royale! 🚀`;

  const phoneInput = document.getElementById('input-user-phone');
  let rawPhone = phoneInput ? phoneInput.value.trim() : (item.phone || '');

  let cleanPhone = rawPhone.replace(/[^0-9]/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '58' + cleanPhone.substring(1);
  } else if (!cleanPhone.startsWith('58') && cleanPhone.length === 10) {
    cleanPhone = '58' + cleanPhone;
  }

  let whatsappUrl = `https://wa.me/?text=${encodeURIComponent(invoiceText)}`;
  if (cleanPhone) {
    whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(invoiceText)}`;
  }

  window.open(whatsappUrl, '_blank');

  alert("¡Retiro aprobado con éxito y factura generada para WhatsApp!");
  closeWithdrawalModal();
  renderWithdrawals();
}

function processWithdrawalWithPrompt(index) {
  const item = withdrawalsData[index];
  const reference = prompt(`Aprobando retiro para ${item.user} (${item.amount} VES).\nIngresa el número de referencia del Pago Móvil:`);
  
  if (!reference) return;

  item.status = 'approved';
  
  const todayDate = new Date().toLocaleDateString('es-VE');
  const invoiceText = 
`🧾 *COMPROBANTE DE RETIRO - GUSANOS ROYALE* 🪱🔥

Hola *@${item.user}*, tu solicitud de retiro ha sido procesada.
💰 *Monto:* ${item.amount} VES
🔢 *Referencia:* *${reference}*
📅 *Fecha:* ${todayDate}

¡Gracias por jugar en Gusanos Royale! 🚀`;

  let rawPhone = item.phone || '';
  let cleanPhone = rawPhone.replace(/[^0-9]/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '58' + cleanPhone.substring(1);
  } else if (!cleanPhone.startsWith('58') && cleanPhone.length === 10) {
    cleanPhone = '58' + cleanPhone;
  }

  let whatsappUrl = `https://wa.me/?text=${encodeURIComponent(invoiceText)}`;
  if (cleanPhone) {
    whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(invoiceText)}`;
  }

  window.open(whatsappUrl, '_blank');
  renderWithdrawals();
  alert("¡Retiro procesado y factura abierta en WhatsApp!");
}

function updateWithdrawalStatus(index, newStatus) {
  if (newStatus === 'rejected') {
    if (!confirm("¿Seguro que deseas rechazar este retiro?")) return;
    withdrawalsData[index].status = 'rejected';
    renderWithdrawals();
    alert("Solicitud de retiro rechazada.");
  }
}

// ==========================================
// INICIALIZAR VISTAS AL CARGAR LA PÁGINA
// ==========================================
renderDeposits();
renderWithdrawals();