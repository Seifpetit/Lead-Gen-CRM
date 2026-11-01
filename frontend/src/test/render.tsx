import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { App } from '../App.js';
import { ApiProvider } from '../api/context.js';
import { CountryProvider } from '../features/country/CountryContext.js';
import { ToastProvider } from '../components/shared/Toast.js';
import { I18nProvider } from '../i18n/index.js';
import type { FakeServer } from './fakeServer.js';

/** A component with the API, language and router it needs, talking to a fake server. */
export function renderWith(ui: ReactElement, server: FakeServer, route = '/') {
  return render(
    <I18nProvider>
      <ApiProvider api={server.api}>
        <ToastProvider>
          <MemoryRouter initialEntries={[route]}>
            <CountryProvider>{ui}</CountryProvider>
          </MemoryRouter>
        </ToastProvider>
      </ApiProvider>
    </I18nProvider>,
  );
}

/** The whole app at a route. */
export function renderApp(server: FakeServer, route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App api={server.api} />
    </MemoryRouter>,
  );
}
