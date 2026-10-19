import { DndContext } from '@dnd-kit/core';
import type { CrmCard } from '@lead-gen-crm/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../i18n/index.js';
import { BoardCard, CompanyThumb, PersonAvatar, type CardActions } from './BoardCard.js';
import { companyCard, personCard } from './boardTestKit.js';
import { initialsOf } from './avatar.js';

const actions: CardActions = {
  targets: () => [],
  onMove: () => undefined,
  onRemove: () => undefined,
  onRestore: () => undefined,
  onOpen: () => undefined,
  sectorName: (s) => s,
};
const withImage = (over: Partial<CrmCard['company']>): CrmCard => {
  const base = companyCard({ id: 'a', name: 'Alpha Textile' });
  return { ...base, company: { ...base.company, ...over } };
};
const view = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

describe('the company picture', () => {
  it('shows the page image or the Maps photo when there is an address', () => {
    const { container, rerender } = view(
      <CompanyThumb
        card={withImage({ imageUrl: 'https://alpha.example.test/og.png', imageSource: 'og' })}
      />,
    );
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('src', 'https://alpha.example.test/og.png');
    // A picture is not draggable on its own, and the site is not told where it was shown.
    expect(img).toHaveAttribute('draggable', 'false');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(container.querySelector('[data-source="og"]')).not.toBeNull();
    rerender(
      <I18nProvider>
        <CompanyThumb
          card={withImage({ imageUrl: 'https://maps.example/p.jpg', imageSource: 'maps' })}
        />
      </I18nProvider>,
    );
    expect(container.querySelector('[data-source="maps"]')).not.toBeNull();
  });

  it('shows the sector icon on its color when there is no address', () => {
    const { container } = view(<CompanyThumb card={withImage({ sector: 'olive-oil' })} />);
    expect(container.querySelector('img')).toBeNull();
    const tile = container.querySelector<HTMLElement>('.thumb-tile')!;
    expect(tile).toHaveAttribute('data-sector', 'olive-oil');
    expect(tile.querySelector('svg.lucide-droplet')).not.toBeNull();
    expect(tile.querySelector<HTMLElement>('.thumb-fill')!.style.background).not.toBe('');
  });

  it('falls back to the sector icon when the picture does not load', () => {
    const { container } = view(
      <CompanyThumb
        card={withImage({
          sector: 'textile',
          imageUrl: 'https://alpha.example.test/gone.png',
          imageSource: 'og',
        })}
      />,
    );
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.thumb-tile svg.lucide-shirt')).not.toBeNull();
  });

  it('uses the factory for a sector without its own icon', () => {
    const { container } = view(<CompanyThumb card={withImage({ sector: null })} />);
    expect(container.querySelector('.thumb-tile svg.lucide-factory')).not.toBeNull();
  });

  it('tries the new address again when the card gets one', () => {
    const first = withImage({ imageUrl: 'https://a.example.test/1.png', imageSource: 'og' });
    const { container, rerender } = view(<CompanyThumb card={first} />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    rerender(
      <I18nProvider>
        <CompanyThumb
          card={withImage({ imageUrl: 'https://a.example.test/2.png', imageSource: 'og' })}
        />
      </I18nProvider>,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://a.example.test/2.png');
  });
});

describe('the person avatar', () => {
  const person = (photoUrl: string | null) => {
    const base = personCard({ id: 'p' });
    return { ...base, person: { ...base.person!, photoUrl } };
  };

  it('is a round 48px circle with initials on a color picked from the name', () => {
    const { container } = view(<PersonAvatar card={person(null)} />);
    const avatar = container.querySelector<HTMLElement>('.avatar-round')!;
    expect(avatar).toHaveTextContent(initialsOf('Amel Ben Salah'));
    expect(avatar).toHaveTextContent('AS');
    expect(avatar.style.background).not.toBe('');
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows the photo only when the provider gave an address, and falls back to initials', () => {
    const { container } = view(<PersonAvatar card={person('https://media.example/amel.jpg')} />);
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('src', 'https://media.example/amel.jpg');
    expect(img).toHaveAttribute('draggable', 'false');
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.avatar-round')).toHaveTextContent('AS');
  });
});

describe('a card', () => {
  it('keeps one line for the name however long it is, with the whole name as its tooltip', () => {
    const long =
      'Société Tunisienne de Transformation et de Conditionnement des Produits Agricoles';
    view(
      <DndContext>
        <BoardCard card={companyCard({ id: 'a', name: long })} actions={actions} />
      </DndContext>,
    );
    const title = screen.getByRole('heading', { level: 4 });
    expect(title).toHaveAttribute('title', long);
    expect(title).toHaveClass('kanban-card-title');
  });

  it('shows email, phone and LinkedIn icons on a person, and no website', () => {
    view(
      <DndContext>
        <BoardCard card={personCard({ id: 'p' })} actions={actions} />
      </DndContext>,
    );
    const group = within(screen.getByRole('group', { name: 'Amel Ben Salah' }));
    expect(group.getByRole('link', { name: /^Email/ })).toBeInTheDocument();
    expect(group.getByRole('link', { name: /^LinkedIn/ })).toBeInTheDocument();
    expect(group.queryByRole('link', { name: /^Website/ })).not.toBeInTheDocument();
    expect(group.getByText('Responsable logistique · Alpha SARL')).toBeInTheDocument();
  });
});
