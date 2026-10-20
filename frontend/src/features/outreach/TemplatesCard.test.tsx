import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer } from '../../test/fakeServer.js';
import { renderWith } from '../../test/render.js';
import { SenderCard, TemplatesCard } from './TemplatesCard.js';

describe('TemplatesCard', () => {
  it('lists the templates, edits one and saves it', async () => {
    const s = fakeServer({
      'GET /api/templates': {
        items: [{ id: 't1', name: 'Premier contact', body: 'Bonjour {person}', updatedAt: '' }],
      },
      'PUT /api/templates/t1': (req) => ({ id: 't1', ...req.body, updatedAt: '' }),
    });
    renderWith(<TemplatesCard />, s);
    const name = await screen.findByLabelText('Name');
    expect(name).toHaveValue('Premier contact');
    const save = screen.getByRole('button', { name: 'Save template' });
    expect(save).toBeDisabled();
    await userEvent.clear(name);
    await userEvent.type(name, 'Premier');
    await userEvent.click(save);
    await waitFor(() => expect(s.to('PUT /api/templates/t1')).toHaveLength(1));
    expect(s.to('PUT /api/templates/t1')[0]!.body).toEqual({
      name: 'Premier',
      body: 'Bonjour {person}',
    });
    expect(await screen.findByText('Template saved')).toBeInTheDocument();
  });

  it('will not save a text over 1000 characters', async () => {
    const s = fakeServer({
      'GET /api/templates': {
        items: [{ id: 't1', name: 'Long', body: 'x'.repeat(1001), updatedAt: '' }],
      },
    });
    renderWith(<TemplatesCard />, s);
    expect(await screen.findByText('Too long: at most 1000 characters.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), '!');
    expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled();
  });
});

describe('SenderCard', () => {
  it('saves who the messages come from', async () => {
    const s = fakeServer({
      'GET /api/profile/sender': { name: '', company: '' },
      'PUT /api/profile/sender': (req) => req.body,
    });
    renderWith(<SenderCard />, s);
    await userEvent.type(await screen.findByLabelText('Your name'), 'Samia');
    await userEvent.type(screen.getByLabelText('Your company'), 'Trans Sfax');
    await userEvent.click(screen.getByRole('button', { name: 'Save details' }));
    await waitFor(() =>
      expect(s.to('PUT /api/profile/sender')[0]?.body).toEqual({
        name: 'Samia',
        company: 'Trans Sfax',
      }),
    );
  });
});
