import { getApiErrorMessage } from './apiErrorMessage';
/** Only a rejected payload can safely be edited before reconciling the first save. */
export function captureSaveFailure(error: unknown) {
  const status = (error as { response?: { status?: number } })?.response?.status;
  const kind = status === 400 || status === 422 ? 'invalid'
    : status === 401 || status === 403 ? 'auth'
    : status === 409 ? 'conflict' : 'retry';
  const message = kind === 'auth' ? 'Sign in again before retrying this save.'
    : kind === 'invalid' ? getApiErrorMessage(error, 'Some recipe details could not be saved. Edit the recipe to correct them.')
    : kind === 'conflict' ? 'This import was already saved with different details. Check your Library for the saved recipe.'
    : getApiErrorMessage(error, 'The connection was interrupted. Your extracted recipe is still here.');
  return { kind, message };
}

