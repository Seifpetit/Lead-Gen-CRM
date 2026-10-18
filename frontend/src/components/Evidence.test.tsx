import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n/index.js';
import { evidence } from '../test/fixtures.js';
import { Field } from './Evidence.js';

const show = (ui: React.ReactElement) =>
  render(
    <I18nProvider>
      <dl>{ui}</dl>
    </I18nProvider>,
  );

describe('Field', () => {
  it('shows a fact with its source and the time it was read', () => {
    show(
      <Field
        label="Title"
        value="Responsable logistique"
        evidence={evidence(
          'title',
          'Responsable logistique',
          'fact',
          'https://www.linkedin.com/in/amel-fixture',
        )}
      />,
    );
    expect(screen.getByText('Responsable logistique')).toBeInTheDocument();
    expect(screen.getByText('Fact')).toBeInTheDocument();
    const source = screen.getByRole('link', { name: 'www.linkedin.com' });
    expect(source).toHaveAttribute('href', 'https://www.linkedin.com/in/amel-fixture');
    expect(source).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
    expect(screen.getByText(/Read 18 Oct 2026/)).toHaveAttribute(
      'datetime',
      '2026-10-18T09:30:00.000Z',
    );
  });

  it('tags an estimate as an estimate', () => {
    show(
      <Field label="Email" value="a@b.test" evidence={evidence('email', 'a@b.test', 'estimate')} />,
    );
    expect(screen.getByText('Estimate')).toBeInTheDocument();
    expect(screen.queryByText('Fact')).not.toBeInTheDocument();
  });

  it('says a value is missing instead of filling it in', () => {
    show(<Field label="Phone" value={null} evidence={null} />);
    const row = screen.getByText('Phone').closest('div')!;
    expect(within(row).getByText('Not found')).toBeInTheDocument();
    expect(within(row).queryByText('Fact')).not.toBeInTheDocument();
    expect(within(row).queryByText('Estimate')).not.toBeInTheDocument();
  });

  it('flags a value that has no recorded source rather than borrowing one', () => {
    show(<Field label="Sector" value="textile" evidence={null} />);
    expect(screen.getByText('No source recorded')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('never turns a non-web source into a link', () => {
    show(
      <Field
        label="Title"
        value="Director"
        evidence={evidence('title', 'Director', 'fact', 'javascript:alert(1)')}
      />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
  });
});
