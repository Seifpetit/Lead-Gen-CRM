import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Spinner } from './Spinner.js';

describe('Spinner', () => {
  it('announces what is loading', () => {
    render(<Spinner label="Searching" />);
    expect(screen.getByRole('status', { name: 'Searching' })).toBeInTheDocument();
  });
});
