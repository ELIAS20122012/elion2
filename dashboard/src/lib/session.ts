import { useEffect, useState } from "react";
import { API_BASE } from "./journalApi";

/**
 * Who is signed in, as the server sees it.
 *
 * The decision lives in the journal server, not here: it hands out an httpOnly cookie the page
 * cannot read, and refuses every request that arrives without one (backend/journal/auth.py).
 * Nothing in this file grants access - it only asks, and renders what it is told.
 */
export type Role = "admin" | "viewer";

export interface User {
  id: number;
  username: string;
  role: Role;
  disabled: boolean;
  created_at: number;
  last_login: number | null;
}

export interface AuthState {
  user: User | null;
  /** No account has been created yet, so the API is still open to everyone on this machine. */
  setup: boolean;
  loading: boolean;
}

const EVENT = "rt-auth";
let cache: AuthState = { user: null, setup: false, loading: true };

async function fetchMe(): Promise<AuthState> {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, { credentials: "same-origin" });
    if (!res.ok) return { user: null, setup: false, loading: false };
    const body = (await res.json()) as { user: User | null; setup: boolean };
    return { user: body.user, setup: body.setup, loading: false };
  } catch {
    // The journal server is unreachable (PC off, mirror mode). Treat that as "not signed in"
    // rather than as "signed in": the safer of the two guesses.
    return { user: null, setup: false, loading: false };
  }
}

export async function refreshAuth(): Promise<AuthState> {
  cache = await fetchMe();
  window.dispatchEvent(new Event(EVENT));
  return cache;
}

export async function login(
  username: string,
  password: string,
  remember: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ username, password, remember }),
    });
  } catch {
    return { ok: false, error: "سرور در دسترس نیست." };
  }
  if (!res.ok) {
    let detail = "نام کاربری یا رمز درست نیست.";
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* keep the default */
    }
    return { ok: false, error: detail };
  }
  await refreshAuth();
  return { ok: true };
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "same-origin" });
  } catch {
    /* going anyway */
  }
  await refreshAuth();
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>(cache);
  useEffect(() => {
    const read = () => setState(cache);
    window.addEventListener(EVENT, read);
    if (cache.loading) void refreshAuth();
    else read();
    return () => window.removeEventListener(EVENT, read);
  }, []);
  return state;
}
