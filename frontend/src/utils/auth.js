// Authentication state management and authenticated API fetch utility

const TOKEN_KEY = 'swargaseema_auth_token';
const USER_KEY = 'swargaseema_auth_user';

export function getAuthToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setAuthToken(token) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch (e) {
    console.error('Failed to persist auth token', e);
  }
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  try {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_KEY);
    }
  } catch (e) {
    console.error('Failed to persist auth user', e);
  }
}

export function clearAuth() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch (e) {
    console.error('Failed to clear auth', e);
  }
}

export function isAuthenticated() {
  return Boolean(getAuthToken());
}

export function isAdmin() {
  const user = getStoredUser();
  return user?.role === 'admin';
}

/**
 * Authenticated fetch wrapper. Automatically attaches Bearer token to headers.
 * If 401 Unauthorized is returned, logs out user cleanly.
 */
export async function apiFetch(url, options = {}) {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // If sending JSON body and content-type not set, set it
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    try {
      JSON.parse(options.body);
      headers.set('Content-Type', 'application/json');
    } catch {
      // not JSON
    }
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401 && !url.includes('/api/auth/login')) {
    clearAuth();
    window.dispatchEvent(new Event('auth:unauthorized'));
  }

  return response;
}
