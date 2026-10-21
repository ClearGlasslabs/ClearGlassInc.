// Membership section: reads plan state from the account API and links to the account origin.
// Isolated from pricing.js (per-seat offers): it never touches [data-plan] or [data-cycle].
(() => {
  const section = document.querySelector('#membership');
  if (!section) return;
  const note = section.querySelector('[data-membership-note]');
  const meta = document.querySelector('meta[name="clearglass-account-origin"]');
  let origin = '';
  try {
    const url = new URL(meta && meta.content ? meta.content : '');
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol === 'https:' || (local && url.protocol === 'http:')) origin = url.origin;
  } catch (error) { /* origin not configured */ }
  if (!origin) { note.textContent = 'Membership sign-up is not yet available. No prices are shown until it is configured.'; return; }

  const LABEL = { monthly: 'Monthly', annual: 'Annual', enterprise: 'Enterprise' };
  fetch(origin + '/v1/subscriptions/plans', { credentials: 'omit' })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error('status'))))
    .then((data) => {
      if (!data.configured) { note.textContent = 'Membership sign-up is not yet available. No prices are shown until it is configured.'; return; }
      note.textContent = 'Prices are read from our payment provider. Continue to our account site to sign in and subscribe.';
      data.plans.forEach((plan) => {
        const card = section.querySelector('[data-membership-plan="' + plan.key + '"]');
        if (!card) return;
        const holder = card.querySelector('[data-membership-offers]');
        holder.textContent = '';
        plan.offers.forEach((offer) => {
          if (offer.state === 'available') {
            const link = document.createElement('a');
            link.className = 'button ' + (offer.interval === 'annual' ? 'primary' : 'dark');
            link.href = origin + '/account?plan=' + encodeURIComponent(plan.key) + '&interval=' + encodeURIComponent(offer.interval);
            const price = offer.amount ? ' · ' + offer.amount : '';
            link.textContent = LABEL[offer.interval] + price + ' →';
            holder.appendChild(link);
          } else if (offer.state === 'contact') {
            const link = document.createElement('a');
            link.className = 'button dark';
            link.href = data.contactUrl && /^(mailto:|https:\/\/)/.test(data.contactUrl) ? data.contactUrl : 'mailto:sales@clearglassinc.com?subject=Northstar%20access%20request';
            link.textContent = 'Request access';
            holder.appendChild(link);
          } else {
            const text = document.createElement('p');
            text.className = 'membership-state';
            text.textContent = LABEL[offer.interval] + ': ' + (offer.state === 'unconfigured' ? 'not yet configured.' : 'currently unavailable.');
            holder.appendChild(text);
          }
        });
      });
    })
    .catch(() => { note.textContent = 'Membership details could not be loaded right now. No prices are shown.'; });
})();
