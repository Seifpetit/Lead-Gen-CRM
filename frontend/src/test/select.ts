import { screen } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';

/** Opens a shared Select and clicks the option with this name (a native select's selectOptions). */
export async function chooseOption(
  user: ReturnType<typeof userEvent.setup>,
  combobox: HTMLElement,
  name: string | RegExp,
): Promise<void> {
  await user.click(combobox);
  await user.click(await screen.findByRole('option', { name }));
}
