import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
  it('requires an audit reason before applying the action', async () => {
    const user = userEvent.setup()
    const confirm = vi.fn().mockResolvedValue(undefined)
    render(
      <ConfirmDialog
        title="Hide recipe"
        description="The recipe will disappear from public views."
        actionLabel="Hide recipe"
        onCancel={() => undefined}
        onConfirm={confirm}
      />,
    )

    const action = screen.getByRole('button', { name: 'Hide recipe' })
    expect(action).toBeDisabled()

    await user.type(screen.getByLabelText(/Reason/), 'Confirmed policy violation')
    expect(action).toBeEnabled()
    await user.click(action)

    expect(confirm).toHaveBeenCalledWith('Confirmed policy violation')
  })

  it('uses a non-destructive cancel label', () => {
    render(
      <ConfirmDialog
        title="Cancel job"
        description="This stops extraction work."
        actionLabel="Cancel job"
        tone="danger"
        onCancel={() => undefined}
        onConfirm={async () => undefined}
      />,
    )

    expect(screen.getByRole('button', { name: 'Keep unchanged' })).toBeVisible()
  })

  it('keeps keyboard focus inside the modal and restores it after cancel', async () => {
    const user = userEvent.setup()
    const cancel = vi.fn()
    const { rerender } = render(<button type="button">Open action</button>)
    const opener = screen.getByRole('button', { name: 'Open action' })
    opener.focus()

    rerender(
      <>
        <button type="button">Open action</button>
        <ConfirmDialog
          title="Hide recipe"
          description="The recipe will disappear from public views."
          actionLabel="Hide recipe"
          onCancel={cancel}
          onConfirm={async () => undefined}
        />
      </>,
    )

    const reason = screen.getByLabelText(/Reason/)
    expect(reason).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Close confirmation' })).toHaveFocus()
    await user.tab()
    expect(reason).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(cancel).toHaveBeenCalledOnce()

    rerender(<button type="button">Open action</button>)
    expect(screen.getByRole('button', { name: 'Open action' })).toHaveFocus()
  })
})
