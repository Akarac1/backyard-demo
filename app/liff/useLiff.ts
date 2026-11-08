'use client';
import { useEffect, useState } from 'react';

type LiffState = { ready: boolean; idToken: string | null; name: string | null; error: string | null };

/**
 * Starts LIFF inside LINE. Outside LINE (or with no LIFF id) it runs in demo mode:
 * no token is sent and the server maps the request to a demo user (only when DEMO_MODE=true).
 */
export function useLiff(): LiffState {
  const [s, set] = useState<LiffState>({ ready: false, idToken: null, name: null, error: null });
  useEffect(() => {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    if (!liffId) { set({ ready: true, idToken: null, name: null, error: null }); return; }
    (async () => {
      try {
        const liff = (await import('@line/liff')).default;
        await liff.init({ liffId });
        if (!liff.isLoggedIn()) {
          // opened from a plain link (LINE's in-app browser or a normal browser): sign in with LINE first,
          // then LINE sends the customer back to this same page
          liff.login({ redirectUri: window.location.href });
          return;
        }
        const profile = await liff.getProfile().catch(() => null);
        accessToken = liff.getAccessToken();
        set({ ready: true, idToken: liff.getIDToken(), name: profile?.displayName ?? null, error: null });
      } catch (e) {
        set({ ready: true, idToken: null, name: null, error: String(e) });
      }
    })();
  }, []);
  return s;
}

export async function closeLiff() {
  try {
    const liff = (await import('@line/liff')).default;
    if (liff.isInClient()) liff.closeWindow();
  } catch { /* not in LINE */ }
}

// The ID token can be expired when LINE reuses an old LIFF session, so the access token is sent too.
let accessToken: string | null = null;

export const authHeaders = (idToken: string | null): Record<string, string> => ({
  ...(idToken ? { 'x-id-token': idToken } : {}),
  ...(accessToken ? { 'x-access-token': accessToken } : {}),
});
