// Datos simulados de solicitudes entrantes
let depositsData = [
  { id: '#DEP-1001', user: 'César Gómez', method: 'Pago Móvil (Banesco)', amount: '5.000,00', ref: '00894512', status: 'pending' },
  { id: '#DEP-1002', user: 'LlaneroPro', method: 'Binance Pay (USDT)', amount: '12.500,00', ref: '284910491', status: 'pending' },
  { id: '#DEP-1003', user: 'SBR_Gamer', method: 'Pago Móvil (Mercantil)', amount: '1.000,00', ref: '99410238', status: 'approved' }
];

let withdrawalsData = [
  { id: '#RET-5001', user: 'CriptoKing', destination: 'Pago Móvil 0414-1234567 (Banesco)', amount: '25.000,00 VES', status: 'pending' },
  { id: '#RET-5002', user: 'ApurePro', destination: 'Pago Móvil 0424-7654321 (BDV)', amount: '50.000,00 VES', status: 'pending' }
];

function showAdminTab(tab) {
  document.getElementById('admin-deposits').style.display = tab === 'deposits' ? 'block' : 'none';
  document.getElementById('admin-withdrawals').style.display = tab === 'withdrawals' ? 'block' : 'none';
  
  const links = document.querySelectorAll('.nav-menu a');
  links[0].classList.toggle('active', tab === 'deposits');
  links[1].classList.toggle('active', tab === 'withdrawals');
}

function renderDeposits() {
  const tbody = document.getElementById('deposits-tbody');
  tbody.innerHTML = '';

  depositsData.forEach((item, index) => {
    let statusBadge = '';
    if (item.status === 'pending') statusBadge = '<span class="status-pill pending">Pendiente</span>';
    else if (item.status === 'approved') statusBadge = '<span class="status-pill approved">Aprobado</span>';
    else statusBadge = '<span class="status-pill rejected">Rechazado</span>';

    let actions = item.status === 'pending' ? `
      <button class="btn-approve" onclick="updateDepositStatus(${index}, 'approved')">✓ Aprobar</button>
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
  tbody.innerHTML = '';

  withdrawalsData.forEach((item, index) => {
    let statusBadge = '';
    if (item.status === 'pending') statusBadge = '<span class="status-pill pending">Pendiente</span>';
    else if (item.status === 'approved') statusBadge = '<span class="status-pill approved">Aprobado</span>';
    else statusBadge = '<span class="status-pill rejected">Rechazado</span>';

    let actions = item.status === 'pending' ? `
      <button class="btn-approve" onclick="updateWithdrawalStatus(${index}, 'approved')">✓ Pagado</button>
      <button class="btn-reject" onclick="updateWithdrawalStatus(${index}, 'rejected')">✕ Rechazar</button>
    ` : '<span style="color: #64748b;">Procesado</span>';

    tbody.innerHTML += `
      <tr>
        <td><strong>${item.id}</strong></td>
        <td>${item.user}</td>
        <td>${item.destination}</td>
        <td style="color: #f43f5e; font-weight: bold;">${item.amount}</td>
        <td>${statusBadge}</td>
        <td>${actions}</td>
      </tr>
    `;
  });
}

function updateDepositStatus(index, newStatus) {
  depositsData[index].status = newStatus;
  renderDeposits();
  alert(`Depósito ${newStatus === 'approved' ? 'APROBADO (Saldo acreditado)' : 'RECHAZADO'}.`);
}

function updateWithdrawalStatus(index, newStatus) {
  withdrawalsData[index].status = newStatus;
  renderWithdrawals();
  alert(`Retiro marcado como ${newStatus === 'approved' ? 'PAGADO EXITOSAMENTE' : 'RECHAZADO'}.`);
}

// Cargar tablas al iniciar
renderDeposits();
renderWithdrawals();