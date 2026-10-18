import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProgressTrack } from './ProgressTrack.js';

describe('ProgressTrack', () => {
  it('fills to the value and draws a tick for each checkpoint', () => {
    const { container } = render(
      <ProgressTrack
        value={0.4}
        label="Progress"
        valueText="$0.80 of $2.00"
        checkpoints={[0.25, 0.5, 0.75]}
        startLabel="Start"
        endLabel="End"
        checkpointsLabel="Cost checkpoints"
      />,
    );
    const bar = screen.getByRole('progressbar', { name: 'Progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuetext', '$0.80 of $2.00');
    expect(container.querySelectorAll('.progress-tick')).toHaveLength(3);
    expect(container.querySelector('.progress-fill')).toHaveStyle({ width: '40%' });
    for (const text of ['Start', 'Cost checkpoints', 'End']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it('keeps the value between 0 and 100 and needs no labels or ticks', () => {
    const { container, rerender } = render(<ProgressTrack value={3} label="Over" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(container.querySelector('.progress-scale')).toBeNull();
    expect(container.querySelectorAll('.progress-tick')).toHaveLength(0);
    rerender(<ProgressTrack value={-1} label="Under" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });
});
