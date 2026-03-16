import { auth } from './firebase-config.js';
import {
  GoogleAuthProvider,
  signInWithCredential,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const GOOGLE_CLIENT_ID = '459725265628-4vv82as21unt637dhpjhch2t6mmev6vt.apps.googleusercontent.com';

const { ipcRenderer } = require('electron');

// ── PKCE helpers ──────────────────────────────────────────────────────────────
function base64urlEncode(buf) {
  let str = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generatePKCE() {
  const verifier  = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const hashed    = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64urlEncode(hashed);
  return { verifier, challenge };
}

let codeVerifier      = null;
let currentRedirectUri = null;

// Opens Google sign-in in the user's default system browser using PKCE + loopback.
// Custom URI schemes (sakupljac://) are not supported by Google for Desktop app clients;
// loopback (http://127.0.0.1:PORT) is automatically allowed with no registration needed.
export async function startGoogleSignIn() {
  const { verifier, challenge } = await generatePKCE();
  codeVerifier = verifier;

  // Start a temporary local HTTP server; main.js returns the port it bound to
  const port = await ipcRenderer.invoke('start-oauth-server');
  currentRedirectUri = `http://127.0.0.1:${port}/callback`;

  const url =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    '?client_id='            + encodeURIComponent(GOOGLE_CLIENT_ID) +
    '&redirect_uri='         + encodeURIComponent(currentRedirectUri) +
    '&response_type=code' +
    '&scope=email%20profile%20openid' +
    '&code_challenge='       + challenge +
    '&code_challenge_method=S256' +
    '&prompt=select_account';

  ipcRenderer.invoke('open-external', url);
}

// main.js sends 'oauth-callback' when the local server receives the redirect.
// URL format: http://127.0.0.1:PORT/callback?code=...
ipcRenderer.on('oauth-callback', async (_event, callbackUrl) => {
  try {
    const code = new URL(callbackUrl).searchParams.get('code');
    if (!code) throw new Error('No code in callback URL');
    if (!codeVerifier) throw new Error('No code verifier stored');

    // Exchange authorization code for tokens
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: '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',
        redirect_uri:  currentRedirectUri,
        grant_type:    'authorization_code',
        code_verifier: codeVerifier
      })
    });

    codeVerifier       = null;
    currentRedirectUri = null;
    const tokens = await resp.json();
    if (tokens.error) throw new Error(tokens.error_description || tokens.error);

    const credential = GoogleAuthProvider.credential(tokens.id_token);
    await signInWithCredential(auth, credential);
    // onAuthStateChanged (in online.js) handles the rest

  } catch (err) {
    console.error('OAuth callback error:', err);
    const statusEl = document.getElementById('auth-status');
    if (statusEl) statusEl.textContent = 'Greška pri prijavi. Pokušajte ponovo.';
  }
});

// Cancels a pending sign-in: clears PKCE state and tells main.js to kill the OAuth server.
export function cancelGoogleSignIn() {
  codeVerifier       = null;
  currentRedirectUri = null;
  ipcRenderer.invoke('cancel-oauth-server');
}

// If the OAuth server times out (user closed browser without completing sign-in),
// reset state and show a message on the auth screen.
ipcRenderer.on('oauth-server-timeout', () => {
  codeVerifier       = null;
  currentRedirectUri = null;
  const statusEl = document.getElementById('auth-status');
  if (statusEl) statusEl.textContent = 'Prijava je istekla. Pokušajte ponovo.';
});

export { auth, signOut, onAuthStateChanged };