import { fireEvent, screen, within } from '@testing-library/react';

// Card and coordinator inspectors return to structural views through the now strip.
export function structureTab(name: string) {
  if (!screen.queryByRole('tab', { name })) {
    fireEvent.click(within(screen.getByRole('navigation', { name: /现在条|Now/ })).getByRole('button', { name: /^(结构|Structure)$/ }));
  }
  return screen.getByRole('tab', { name });
}
