/** Distinct from a recoverable network save failure: never transfer the payload. */
export class CaptureAccountChangedError extends Error {
  constructor() {
    super('Your account changed. This import remains in its original account.');
    this.name = 'CaptureAccountChangedError';
  }
}
