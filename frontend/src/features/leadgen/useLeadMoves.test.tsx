import type { Lead } from '@lead-gen-crm/shared';
import { act, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/context.js';
import type { Api } from '../../api/endpoints.js';
import { ToastProvider } from '../../components/shared/Toast.js';
import { I18nProvider } from '../../i18n/index.js';
import { lead } from '../../test/fixtures.js';
import { useLeadMoves } from './useLeadMoves.js';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(move: Api['leads']['move']) {
  const saved: Lead[] = [];
  const api = { leads: { move } } as unknown as Api;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider>
      <ApiProvider api={api}>
        <ToastProvider>
          <MemoryRouter>{children}</MemoryRouter>
        </ToastProvider>
      </ApiProvider>
    </I18nProvider>
  );
  const hook = renderHook(() => useLeadMoves({ onSaved: (l) => saved.push(l) }), { wrapper });
  return { hook, saved };
}

describe('useLeadMoves', () => {
  it('shows the new stage at once and keeps the server’s copy when it saves', async () => {
    const call = deferred<Lead>();
    const move = vi.fn(() => call.promise);
    const { hook, saved } = setup(move);
    const l = lead();

    let done!: Promise<void>;
    act(() => {
      done = hook.result.current.moveMany([l], 'confirmed');
    });
    // Nothing has come back from the server yet, and the screen already shows the move.
    expect(hook.result.current.show([l])[0]!.crmStage).toBe('confirmed');
    expect(hook.result.current.hasPending).toBe(true);

    await act(async () => {
      call.resolve({ ...l, crmStage: 'confirmed' });
      await done;
    });
    expect(saved.map((s) => s.crmStage)).toEqual(['confirmed']);
    expect(hook.result.current.hasPending).toBe(false);
    expect(await screen.findByRole('status')).toHaveTextContent('Moved 1 to Confirmed.');
  });

  it('puts the lead back and says so in a toast when the server fails', async () => {
    const call = deferred<Lead>();
    const { hook, saved } = setup(vi.fn(() => call.promise));
    const l = lead();

    let done!: Promise<void>;
    act(() => {
      done = hook.result.current.moveMany([l], 'dismissed');
    });
    expect(hook.result.current.show([l])[0]!.crmStage).toBe('dismissed');

    await act(async () => {
      call.reject(new Error('boom'));
      await done;
    });
    expect(hook.result.current.show([l])[0]!.crmStage).toBe('system_suggested');
    expect(saved).toEqual([]);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '1 of 1 could not be moved to Dismissed and were put back.',
    );
  });

  it('rolls back only the leads that failed in a bulk move', async () => {
    const ok = lead({ id: 'ok' });
    const bad = lead({ id: 'bad' });
    const move = vi.fn((id: string) =>
      id === 'ok'
        ? Promise.resolve({ ...ok, crmStage: 'confirmed' as const })
        : Promise.reject(new Error('no')),
    );
    const { hook, saved } = setup(move as unknown as Api['leads']['move']);
    await act(async () => {
      await hook.result.current.moveMany([ok, bad], 'confirmed');
    });
    expect(saved.map((s) => s.id)).toEqual(['ok']);
    expect(hook.result.current.show([bad])[0]!.crmStage).toBe('system_suggested');
    expect(await screen.findByRole('alert')).toHaveTextContent('1 of 2 could not be moved');
  });

  it('does nothing for leads already in that stage', async () => {
    const move = vi.fn();
    const { hook } = setup(move as unknown as Api['leads']['move']);
    await act(async () => {
      await hook.result.current.moveMany([lead({ crmStage: 'confirmed' })], 'confirmed');
    });
    expect(move).not.toHaveBeenCalled();
  });
});
