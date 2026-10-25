"use strict";

(() => {
  const config = window.CHRONLIST_CONFIG;
  const SESSION_KEY = "chronlist.auth.session.v2";
  const FLOW_KEY = "chronlist.auth.flow.v2";

  let expiryTimer;

  function message(text) { document.querySelector("#account-status").textContent = text; }

  function expire() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* expiry still clears the UI */ }
    clearTimeout(expiryTimer);
    updateAccountButton();
    window.dispatchEvent(new Event("chronlist:session-ended"));
    message("Your session ended. Sign in again to access cloud tasks.");
  }

  function armExpiry() {
    const session = getSession();
    clearTimeout(expiryTimer);
    if (session) expiryTimer = setTimeout(expire, Math.max(0, session.expiresAt - Date.now()));
  }

  function randomValue() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return base64url(bytes);
  }

  function base64url(bytes) {
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  function getSession() {
    try {
      const session = JSON.parse(sessionStorage.getItem(SESSION_KEY));
      return session?.expiresAt > Date.now() ? session : null;
    } catch {
      return null;
    }
  }

  async function signIn() {
    if (location.origin !== new URL(config.redirectUri).origin) throw new Error("Use the production Netlify URL to sign in.");
    const verifier = randomValue();
    const state = randomValue();
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier)
    );

    sessionStorage.setItem(FLOW_KEY, JSON.stringify({
      verifier,
      state,
      createdAt: Date.now()
    }));

    const url = new URL("/oauth2/authorize", config.domain);
    url.search = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: config.redirectUri,
      scope: config.scopes,
      state,
      code_challenge_method: "S256",
      code_challenge: base64url(new Uint8Array(digest))
    }).toString();

    window.location.assign(url);
  }

  function signOut() {
    expire();
    sessionStorage.removeItem(FLOW_KEY);

    const url = new URL("/logout", config.domain);
    url.search = new URLSearchParams({
      client_id: config.clientId,
      logout_uri: config.logoutUri
    }).toString();

    window.location.assign(url);
  }

  async function handleCallback() {
    const params = new URLSearchParams(window.location.search);

    if (!params.has("code") && !params.has("error")) return;

    const rawFlow = sessionStorage.getItem(FLOW_KEY);
    sessionStorage.removeItem(FLOW_KEY);

    // Remove the authorization response from the address bar.
    history.replaceState({}, "", window.location.pathname);

    const flow = rawFlow ? JSON.parse(rawFlow) : null;

    if (
      !flow ||
      params.get("state") !== flow.state ||
      !Number.isFinite(flow.createdAt) ||
      flow.createdAt > Date.now() ||
      Date.now() - flow.createdAt > 10 * 60 * 1000
    ) {
      throw new Error("This sign-in attempt expired. Please sign in again.");
    }

    if (params.has("error")) throw new Error("Sign-in was cancelled or denied.");

    const response = await fetch(`${config.domain}/oauth2/token`, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        code: params.get("code"),
        code_verifier: flow.verifier
      })
    });

    if (!response.ok) {
      throw new Error("Sign-in could not be completed. Please try again.");
    }

    const tokens = await response.json();
    if (!tokens.access_token || !Number.isFinite(Number(tokens.expires_in)) || Number(tokens.expires_in) <= 60) throw new Error("Invalid sign-in response.");

    const userResponse = await fetch(`${config.domain}/oauth2/userInfo`, {
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`
      }
    });

    if (!userResponse.ok) {
      throw new Error("Could not load your account. Please sign in again.");
    }

    const user = await userResponse.json();

    if (!user.sub || user.email_verified === false || user.email_verified === "false") {
      throw new Error("Your account response was incomplete.");
    }

    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      accessToken: tokens.access_token,
      expiresAt: Date.now() + Number(tokens.expires_in) * 1000 - 30000,
      user: {
        id: user.sub,
        email: user.email || ""
      }
    }));
  }

  function updateAccountButton() {
    const button = document.querySelector(".avatar");
    if (!button) return;

    const session = getSession();

    button.textContent = session
      ? (session.user.email[0] || "U").toUpperCase()
      : "↗";

    button.title = session
      ? `Sign out: ${session.user.email}`
      : "Sign in to ChronList";

    button.setAttribute(
      "aria-label",
      session ? "Sign out of ChronList" : "Sign in to ChronList"
    );
  }

  window.ChronListAuth = {
    getSession,
    signIn,
    signOut,
    expire,
    ready: null
  };

  async function initialize() {
    const button = document.querySelector(".avatar");
    if (button) button.disabled = true;

    try {
      sessionStorage.removeItem("chronlist.auth.session");
      sessionStorage.removeItem("chronlist.auth.flow");
      await handleCallback();
      armExpiry();
    } catch (error) {
      sessionStorage.removeItem(SESSION_KEY);
      message(error.message || "Sign-in failed. Please try again.");
    } finally {
      updateAccountButton();
      if (button) button.disabled = false;
    }

    button?.addEventListener("click", async () => {
      try {
        if (getSession()) {
          signOut();
        } else {
          await signIn();
        }
      } catch {
        message("Could not start sign-in. Use the production site and allow session storage.");
      }
    });
  }

  window.ChronListAuth.ready = initialize();
})();
