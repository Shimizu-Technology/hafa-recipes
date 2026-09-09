import type { SignInResource } from '@clerk/shared/types';
import { describe, expect, it, vi } from 'vitest';

import {
  beginExistingAccountPasswordRecovery,
  completeExistingAccountPasswordRecovery,
  isUnknownRecoveryAccountError,
} from './accountRecovery';

function makeSignIn({
  status = 'complete',
  sessionId = 'sess_existing_owner',
}: {
  status?: string;
  sessionId?: string | null;
} = {}) {
  return {
    create: vi.fn().mockResolvedValue({}),
    attemptFirstFactor: vi.fn().mockResolvedValue({
      status,
      createdSessionId: sessionId,
    }),
  } as unknown as SignInResource;
}

describe('existing recipe-account password recovery', () => {
  it('starts only Clerk’s existing-account password-reset strategy', async () => {
    const signIn = makeSignIn();

    await beginExistingAccountPasswordRecovery(signIn, '  Chef@Example.COM  ');

    expect(signIn.create).toHaveBeenCalledWith({
      identifier: 'chef@example.com',
      strategy: 'reset_password_email_code',
    });
  });

  it('never starts recovery for an empty identifier or invalid completion input', async () => {
    const signIn = makeSignIn();

    await expect(beginExistingAccountPasswordRecovery(signIn, '  '))
      .rejects.toThrow('email address');
    await expect(completeExistingAccountPasswordRecovery(signIn, '12345', 'long-enough'))
      .rejects.toThrow('six-digit');
    await expect(completeExistingAccountPasswordRecovery(signIn, '123456', 'short'))
      .rejects.toThrow('at least eight');
    expect(signIn.create).not.toHaveBeenCalled();
    expect(signIn.attemptFirstFactor).not.toHaveBeenCalled();
  });

  it('sets a password and activates only a completed existing-owner session', async () => {
    const signIn = makeSignIn();

    await expect(completeExistingAccountPasswordRecovery(
      signIn,
      ' 123456 ',
      'durable-password',
    )).resolves.toEqual({
      status: 'complete',
      sessionId: 'sess_existing_owner',
    });
    expect(signIn.attemptFirstFactor).toHaveBeenCalledWith({
      strategy: 'reset_password_email_code',
      code: '123456',
      password: 'durable-password',
    });
  });

  it('never treats MFA or a missing session as completed recovery', async () => {
    await expect(completeExistingAccountPasswordRecovery(makeSignIn({
      status: 'needs_second_factor',
      sessionId: null,
    }), '123456', 'durable-password')).resolves.toEqual({ status: 'needs_second_factor' });

    await expect(completeExistingAccountPasswordRecovery(makeSignIn({
      status: 'complete',
      sessionId: null,
    }), '123456', 'durable-password')).resolves.toEqual({ status: 'incomplete' });
  });

  it('recognizes only the non-disclosing unknown-account lookup error', () => {
    expect(isUnknownRecoveryAccountError({
      errors: [{ code: 'form_identifier_not_found' }],
    })).toBe(true);
    expect(isUnknownRecoveryAccountError({
      errors: [{ code: 'too_many_requests' }],
    })).toBe(false);
    expect(isUnknownRecoveryAccountError(new Error('offline'))).toBe(false);
  });
});
