import { useState } from 'react';
import { ProxiedSignInPage } from '@backstage/core-components';
import type { IdentityApi, SignInPageProps } from '@backstage/core-plugin-api';

const STORAGE_KEY = 'rw-dev-user';

const USERS = [
  { id: 'alice', label: 'Sign in as Alice' },
  { id: 'bob', label: 'Sign in as Bob' },
] as const;

// Remember the chosen dev user so a page reload silently re-signs-in (via
// ProxiedSignInPage) instead of re-showing the picker — matching how the guest
// provider auto-resumes. Ignores an unknown stored value (e.g. a removed user).
function readStoredProvider(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return USERS.some(u => u.id === value) ? value : null;
  } catch {
    return null;
  }
}

export function DevUsersSignInPage(props: SignInPageProps) {
  const [provider, setProvider] = useState<string | null>(readStoredProvider);

  // Persist the choice on success, and wrap signOut so it forgets the choice —
  // that way the picker returns after sign-out and a different user can be
  // selected, but a plain reload resumes the current one.
  const handleSignInSuccess = (identity: IdentityApi) => {
    try {
      localStorage.setItem(STORAGE_KEY, provider!);
    } catch {
      // localStorage unavailable (private mode etc.) — resume just won't persist.
    }
    const signOut = identity.signOut.bind(identity);
    identity.signOut = async () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
      await signOut();
    };
    props.onSignInSuccess(identity);
  };

  if (provider) {
    return (
      <ProxiedSignInPage {...props} provider={provider} onSignInSuccess={handleSignInSuccess} />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 48, maxWidth: 280 }}>
      <h1>Dev sign-in</h1>
      {USERS.map(u => (
        <button key={u.id} type="button" onClick={() => setProvider(u.id)}>
          {u.label}
        </button>
      ))}
    </div>
  );
}
