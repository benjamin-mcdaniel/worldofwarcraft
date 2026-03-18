const TOKEN_KEY = 'wow_market_token';
const USER_KEY = 'wow_market_user';

export interface AuthState {
  token: string;
  username: string;
  expiresAt: number;
}

export function getAuth(): AuthState | null {
  if (typeof localStorage === 'undefined') return null;
  const token = localStorage.getItem(TOKEN_KEY);
  const user = localStorage.getItem(USER_KEY);
  if (!token || !user) return null;
  try {
    return JSON.parse(user) as AuthState;
  } catch {
    return null;
  }
}

export function setAuth(token: string, username: string, expiresAt: number): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify({ token, username, expiresAt }));
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isAuthenticated(): boolean {
  const auth = getAuth();
  if (!auth) return false;
  return auth.expiresAt > Date.now();
}

export function requireAuth(redirectTo = '/login'): void {
  if (typeof window === 'undefined') return;
  if (!isAuthenticated()) {
    window.location.href = redirectTo;
  }
}
