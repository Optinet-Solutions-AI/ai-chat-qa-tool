'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import ChangePasswordModal from './ChangePasswordModal';

// Set when the user clicks "Skip for now". Scoped to the browser session on
// purpose: the account is still on a temporary password, so the prompt comes
// back the next time they open the app, until they set their own. The login
// page clears it so a fresh sign-in always prompts.
export const PW_PROMPT_SKIPPED_KEY = 'qa_pw_prompt_skipped';

// Greets users who signed in with an admin-issued temporary password
// (/api/auth/me → mustChangePassword) and asks them to choose their own.
export default function FirstLoginPasswordPrompt() {
  const { mustChangePassword } = useStore();
  // Start as "skipped" until sessionStorage has been read, so the modal cannot
  // flash on hydration for someone who already dismissed it.
  const [skipped, setSkipped] = useState(true);

  useEffect(() => {
    try {
      setSkipped(sessionStorage.getItem(PW_PROMPT_SKIPPED_KEY) === '1');
    } catch {
      setSkipped(false);
    }
  }, []);

  if (!mustChangePassword || skipped) return null;

  return (
    <ChangePasswordModal
      mode="welcome"
      onClose={(changed) => {
        if (!changed) {
          try {
            sessionStorage.setItem(PW_PROMPT_SKIPPED_KEY, '1');
          } catch {
            /* private mode etc. — the prompt simply reappears next load */
          }
        }
        setSkipped(true);
      }}
    />
  );
}
