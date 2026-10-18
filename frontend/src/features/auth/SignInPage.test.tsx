import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { dashboardRoutes } from '../../test/fixtures.js';
import { fakeServer, type Handler } from '../../test/fakeServer.js';
import { renderApp } from '../../test/render.js';

const signedOut: Record<string, Handler> = {
  'GET /api/auth/me': { status: 401, body: { error: 'unauthenticated' } },
  'GET /api/auth/config': { body: { signupMode: 'invite', minPasswordLength: 12 } },
};

async function fill(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  return user;
}

describe('Sign in', () => {
  it('sends a signed-out visitor to the sign-in screen', async () => {
    renderApp(fakeServer(signedOut), '/crm');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('shows a clear message for a wrong password and clears the password', async () => {
    const server = fakeServer({
      ...signedOut,
      'POST /api/auth/login': { status: 401, body: { error: 'invalid_credentials' } },
    });
    renderApp(server, '/signin');
    await fill('a@example.test', 'wrong-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('shows the rate-limit message with how long to wait', async () => {
    const server = fakeServer({
      ...signedOut,
      'POST /api/auth/login': {
        status: 429,
        headers: { 'retry-after': '900' },
        body: { error: 'too_many_attempts' },
      },
    });
    renderApp(server, '/signin');
    await fill('a@example.test', 'whatever-password');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again in 15 minutes.',
    );
  });

  it('says so when the server cannot be reached', async () => {
    const server = fakeServer(signedOut);
    server.set('POST /api/auth/login', () => {
      throw new TypeError('offline');
    });
    renderApp(server, '/signin');
    await fill('a@example.test', 'whatever-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server');
  });

  it('opens Lead Gen after a good sign-in', async () => {
    let signedIn = false;
    const server = fakeServer({
      ...dashboardRoutes(),
      'GET /api/auth/config': { body: { signupMode: 'invite', minPasswordLength: 12 } },
      'GET /api/auth/me': () =>
        signedIn
          ? { id: 'u1', email: 'a@example.test' }
          : { status: 401, body: { error: 'unauthenticated' } },
      'POST /api/auth/login': () => {
        signedIn = true;
        return { status: 204 };
      },
    });
    renderApp(server, '/signin');
    await fill('a@example.test', 'correct-password');
    expect(await screen.findByRole('heading', { name: 'Lead Gen', level: 1 })).toBeInTheDocument();
    expect(server.to('POST /api/auth/login')[0]!.body).toEqual({
      email: 'a@example.test',
      password: 'correct-password',
    });
  });

  it('offers no sign-up form while the server is unreachable or has not answered', async () => {
    const server = fakeServer({
      'GET /api/auth/me': { status: 401, body: { error: 'unauthenticated' } },
      'GET /api/auth/config': { status: 500, body: { error: 'internal' } },
    });
    renderApp(server, '/signin');
    await screen.findByLabelText('Email');
    expect(screen.queryByRole('button', { name: /account|invite/i })).not.toBeInTheDocument();
  });

  it('offers sign-up only behind an invite prompt when the server is invite-only', async () => {
    const server = fakeServer({
      ...signedOut,
      'POST /api/auth/signup': { status: 403, body: { error: 'invalid_invite' } },
    });
    renderApp(server, '/signin');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Have an invite code?' }));
    expect(screen.getByLabelText('Invite code')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email'), 'new@example.test');
    await user.type(screen.getByLabelText('Password'), 'long-enough-password');
    await user.type(screen.getByLabelText('Invite code'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That invite code is not valid');
    expect(server.to('POST /api/auth/signup')[0]!.body).toMatchObject({ inviteCode: 'nope' });
  });

  it('shows a plain sign-up form, with no invite code, when sign-up is open', async () => {
    const server = fakeServer({
      ...signedOut,
      'GET /api/auth/config': { body: { signupMode: 'open', minPasswordLength: 12 } },
    });
    renderApp(server, '/signin');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Create an account' }));
    await waitFor(() => expect(screen.getByText('At least 12 characters.')).toBeInTheDocument());
    expect(screen.queryByLabelText('Invite code')).not.toBeInTheDocument();
  });
});
