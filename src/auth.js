/**
 * Lichess OAuth2 Authorization Code Flow with PKCE for a fully client-side
 * app (public client — no registration, no client secret).
 *
 * Spec: lichess-org/api `doc/specs/tags/oauth/oauth.yaml` (+ api-token.yaml).
 *   authorize: GET https://lichess.org/oauth
 *   token:     POST https://lichess.org/api/token (form-urlencoded, CORS *)
 *   revoke:    DELETE https://lichess.org/api/token (Bearer)
 *
 * Security notes:
 * - `code_verifier` (43-128 chars) and `state` are fresh per login attempt
 *   (crypto.getRandomValues), kept in `sessionStorage`, never in a URL, and
 *   deleted after the exchange. Returned `state` is verified first (CSRF).
 * - `code_challenge` is always S256: BASE64URL(SHA-256(verifier)).
 * - The token lives in memory; a copy persists in `localStorage` only so the
 *   session survives reloads. Logout revokes server-side and clears both.
 * - Scope is the minimum for this feature: `puzzle:read`.
 */

const LICHESS_HOST = 'https://lichess.org';
const AUTHORIZATION_URL = `${LICHESS_HOST}/oauth`;
const TOKEN_URL = `${LICHESS_HOST}/api/token`;
const ACCOUNT_URL = `${LICHESS_HOST}/api/account`;

/** Arbitrary stable public-client id — Lichess requires no registration. */
export const CLIENT_ID = 'chess-visualization-noobs';
/** Least privilege for the "Lichess next puzzle" source. */
export const SCOPES = ['puzzle:read'];

const LS_TOKEN = 'cpt.lichessToken';
const SS_VERIFIER = 'cpt.oauth.verifier';
const SS_STATE = 'cpt.oauth.state';

/** In-memory session: { accessToken, obtainedAt, expiresIn, username }. */
let session = null;

function persist() {
  try {
    if (session) localStorage.setItem(LS_TOKEN, JSON.stringify(session));
    else localStorage.removeItem(LS_TOKEN);
  } catch {
    /* storage unavailable (private mode, node) — memory session works */
  }
}

// Restore a persisted session. Guarded so this module stays importable in
// node (scripts/verify-next.mjs imports lichess.js, which imports this).
if (typeof localStorage !== 'undefined') {
  try {
    const raw = localStorage.getItem(LS_TOKEN);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.accessToken === 'string') session = parsed;
    }
  } catch {
    session = null;
  }
}

/** Absolute callback URL. Must be byte-identical at authorize + token time. */
export function redirectUri() {
  return window.location.origin + window.location.pathname;
}

function randomB64Url(nBytes) {
  const bytes = new Uint8Array(nBytes);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function clearLoginAttempt() {
  try {
    sessionStorage.removeItem(SS_VERIFIER);
    sessionStorage.removeItem(SS_STATE);
  } catch {
    /* ignore */
  }
}

function scrubQuery() {
  try {
    history.replaceState(null, '', window.location.pathname + window.location.hash);
  } catch {
    /* ignore */
  }
}

/** Start a login: generate PKCE + state, remember them, redirect to lichess. */
export async function beginLogin() {
  const verifier = randomB64Url(64); // ~86 chars, inside the 43-128 range
  const state = randomB64Url(32);
  try {
    sessionStorage.setItem(SS_VERIFIER, verifier);
    sessionStorage.setItem(SS_STATE, state);
  } catch {
    throw new Error('Session storage is unavailable, cannot start sign-in.');
  }
  const challenge = await challengeFor(verifier);
  const url = new URL(AUTHORIZATION_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('state', state);
  window.location.assign(url.toString());
}

/**
 * Handle the OAuth redirect back to us. Call once on page load.
 * Returns { status: 'signed-in' } | { status: 'signed-out' } |
 *         { status: 'error', error }.
 */
export async function handleAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  const returnedState = params.get('state');
  if (!code && !error) return { status: session ? 'signed-in' : 'signed-out' };

  if (error) {
    clearLoginAttempt();
    scrubQuery();
    return {
      status: 'error',
      error: params.get('error_description') || `Authorization failed (${error}).`,
    };
  }

  let verifier = null;
  let expectedState = null;
  try {
    verifier = sessionStorage.getItem(SS_VERIFIER);
    expectedState = sessionStorage.getItem(SS_STATE);
  } catch {
    /* ignore */
  }
  clearLoginAttempt();
  scrubQuery(); // scrub the code even on failure
  if (!verifier || !expectedState || returnedState !== expectedState) {
    return { status: 'error', error: 'State mismatch — possible CSRF. Please try signing in again.' };
  }

  let tokenJson;
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri(),
        client_id: CLIENT_ID,
      }),
    });
    if (!res.ok) throw new Error(`Token exchange failed with HTTP ${res.status}.`);
    tokenJson = await res.json();
  } catch (err) {
    return { status: 'error', error: err.message };
  }
  if (!tokenJson || typeof tokenJson.access_token !== 'string') {
    return { status: 'error', error: 'Token exchange returned no access token.' };
  }
  session = {
    accessToken: tokenJson.access_token,
    obtainedAt: Date.now(),
    expiresIn: typeof tokenJson.expires_in === 'number' ? tokenJson.expires_in : null,
    username: null,
  };
  try {
    const me = await fetch(ACCOUNT_URL, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (me.ok) {
      const profile = await me.json();
      if (profile && typeof profile.username === 'string') session.username = profile.username;
    }
  } catch {
    /* username is a nicety — the token still works without it */
  }
  persist();
  return { status: 'signed-in' };
}

/** Current access token, or null when signed out / expired. */
export function getToken() {
  if (!session) return null;
  if (
    typeof session.expiresIn === 'number' &&
    Date.now() > session.obtainedAt + session.expiresIn * 1000 - 60_000
  ) {
    session = null;
    persist();
    return null;
  }
  return session.accessToken;
}

export function isLoggedIn() {
  return getToken() !== null;
}

export function getUsername() {
  return session?.username ?? null;
}

/** Revoke server-side, then forget the token locally. */
export async function logout() {
  const token = session?.accessToken;
  session = null;
  persist();
  if (token) {
    try {
      await fetch(TOKEN_URL, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      /* revocation is best-effort; the local session is already gone */
    }
  }
}
