(() => {
  const status = document.querySelector("[data-status]");
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content ?? "";
  const say = (message) => { if (status) status.textContent = message; };
  const MESSAGES = {
    contact_required: "Northstar access is arranged with our team. Use Request access.",
    plan_unavailable: "That plan is not available yet.",
    already_subscribed: "You already have an active membership. Use Manage billing to change it.",
    no_billing_account: "No billing account exists for this sign-in yet.",
    rate_limited: "Too many attempts. Please wait a few minutes and try again.",
    email_not_configured: "Sign-in email is not configured on this deployment.",
    unauthenticated: "Your session has ended. Please sign in again.",
  };

  async function post(path, body) {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(body ?? {}),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  }

  function hostedRedirect(url, host) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && parsed.hostname === host) { window.location.assign(parsed.toString()); return true; }
    } catch { /* fall through */ }
    return false;
  }

  function busy(button, on) {
    if (!button) return;
    button.disabled = on;
    button.setAttribute("aria-busy", String(on));
  }

  document.querySelector('[data-form="login"]')?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    const payload = Object.fromEntries(new FormData(form));
    busy(button, true);
    say("Sending…");
    try {
      const result = await post("/account/api/auth/request", payload);
      say(result.ok ? "If that address can sign in, a link is on its way. Check your inbox." : (MESSAGES[result.data.error] ?? "We could not send the link. Please try again."));
    } catch { say("Network error. Please try again."); }
    busy(button, false);
  });

  document.querySelectorAll("[data-checkout-plan]").forEach((button) => button.addEventListener("click", async () => {
    busy(button, true);
    say("Preparing secure checkout…");
    try {
      const result = await post("/account/api/billing/checkout", { plan: button.dataset.checkoutPlan, interval: button.dataset.checkoutInterval });
      if (result.ok && hostedRedirect(result.data.url, "checkout.stripe.com")) return;
      say(MESSAGES[result.data.error] ?? "Checkout could not be started. Please try again.");
    } catch { say("Network error. Please try again."); }
    busy(button, false);
  }));

  document.querySelector('[data-action="portal"]')?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    busy(button, true);
    say("Opening billing portal…");
    try {
      const result = await post("/account/api/billing/portal");
      if (result.ok && hostedRedirect(result.data.url, "billing.stripe.com")) return;
      say(MESSAGES[result.data.error] ?? "The billing portal could not be opened.");
    } catch { say("Network error. Please try again."); }
    busy(button, false);
  });

  async function refresh(reload) {
    say("Checking with Stripe…");
    try {
      const result = await post("/account/api/billing/refresh");
      if (result.ok) { if (reload) { history.replaceState(null, "", "/account"); window.location.reload(); } else say("Status updated."); return; }
      say(MESSAGES[result.data.error] ?? "Status could not be refreshed.");
    } catch { say("Network error. Please try again."); }
  }
  document.querySelector('[data-action="refresh"]')?.addEventListener("click", () => refresh(true));
  if (document.querySelector('[data-checkout-return="success"]')) refresh(true);

  document.querySelector('[data-action="logout"]')?.addEventListener("click", async () => {
    await post("/account/api/auth/logout").catch(() => {});
    window.location.assign("/account");
  });
})();
