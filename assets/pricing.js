const money = new Intl.NumberFormat('en-CA', {style: 'currency', currency: 'CAD'});
const seatInput = document.querySelector('#seats');
let cycle = 'annual';
function seats() { const value = Math.min(999, Math.max(1, Number.parseInt(seatInput.value, 10) || 1)); seatInput.value = value; return value; }
function renderPricing() { const quantity = seats(); document.querySelectorAll('[data-plan]').forEach(card => { const perSeat = Number(card.dataset[cycle]); card.querySelector('[data-price]').textContent = perSeat.toFixed(2); const cadence = cycle === 'annual' ? `${money.format(perSeat * quantity * 12)} billed annually` : `${money.format(perSeat * quantity)} billed monthly`; card.querySelector('[data-total]').textContent = `${quantity} users · ${cadence}`; }); }
document.querySelectorAll('[data-cycle]').forEach(button => button.addEventListener('click', () => { cycle = button.dataset.cycle; document.querySelectorAll('[data-cycle]').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); }); renderPricing(); }));
document.querySelector('#seat-minus').addEventListener('click', () => { seatInput.value = Math.max(1, seats() - 1); renderPricing(); });
document.querySelector('#seat-plus').addEventListener('click', () => { seatInput.value = Math.min(999, seats() + 1); renderPricing(); });
seatInput.addEventListener('input', renderPricing); renderPricing();
