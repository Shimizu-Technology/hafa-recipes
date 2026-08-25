import type { SignInResource } from '@clerk/shared/types';
import { describe, expect, it, vi } from 'vitest';

import { sendExistingAccountCode, verifyExistingAccountCode } from './accountRecovery';

function makeSignIn({
  factors = [{ strategy: 'email_code', emailAddressId: 'email_existing' }],
  status = 'complete',
  sessionId = 'sess_existing_owner',
}: {
  factors?: Array<{ strategy: string; emailAddressId?: string }>;
  status?: string;
  sessionId?: string | null;
} = {}) {
  return {
    create: vi.fn().mockResolvedValue({ supportedFirstFactors: factors }),
    prepareFirstFactor: vi.fn().mockResolvedValue({}),
    attemptFirstFactor: vi.fn().mockResolvedValue({
      status,
      createdSessionId: sessionId,
    }),
  } as unknown as SignInResource;
}

describe('existing recipe-account recovery', () => {
  it('sends a code only to an existing account’s verified email factor', async () => {
    const signIn = makeSignIn();

    await sendExistingAccountCode(signIn, '  Chef@Example.COM  ');

    expect(signIn.create).toHaveBeenCalledWith({
      identifier: 'chef@example.com',
      signUpIfMissing: false,
    });
    expect(signIn.prepareFirstFactor).toHaveBeenCalledWith({
      strategy: 'email_code',
      emailAddressId: 'email_existing',
    });
  });

  it('fails closed when email-code authentication is unavailable', async () => {
    const signIn = makeSignIn({ factors: [{ strategy: 'password' }] });

    await expect(sendExistingAccountCode(signIn, 'chef@example.com'))
      .rejects.toThrow('Email verification is not available');
    expect(signIn.prepareFirstFactor).not.toHaveBeenCalled();
  });

  it('never starts recovery for an empty identifier or invalid code', async () => {
    const signIn = makeSignIn();

    await expect(sendExistingAccountCode(signIn, '  ')).rejects.toThrow('email address');
    await expect(verifyExistingAccountCode(signIn, '12345')).rejects.toThrow('six-digit');
    await expect(verifyExistingAccountCode(signIn, '12a456')).rejects.toThrow('six-digit');
    expect(signIn.create).not.toHaveBeenCalled();
    expect(signIn.attemptFirstFactor).not.toHaveBeenCalled();
  });

  it('activates only a completed existing-owner session', async () => {
    const signIn = makeSignIn();

    await expect(verifyExistingAccountCode(signIn, ' 123456 ')).resolves.toEqual({
      status: 'complete',
      sessionId: 'sess_existing_owner',
    });
    expect(signIn.attemptFirstFactor).toHaveBeenCalledWith({
      strategy: 'email_code',
      code: '123456',
    });
  });

  it('never treats MFA or a missing session as completed recovery', async () => {
    await expect(verifyExistingAccountCode(makeSignIn({
      status: 'needs_second_factor',
      sessionId: null,
    }), '123456')).resolves.toEqual({ status: 'needs_second_factor' });

    await expect(verifyExistingAccountCode(makeSignIn({
      status: 'complete',
      sessionId: null,
    }), '123456')).resolves.toEqual({ status: 'incomplete' });
  });
});
