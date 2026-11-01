import { useState } from 'react';
import { Modal } from '../../components/Modal.js';
import { useT } from '../../i18n/index.js';
import { useCountry } from './CountryContext.js';

const KEY = 'leadgen.gdpr.accepted';

function accepted(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Shown once per browser, the first time the person works in a country covered by European
 * data-protection law (France, Germany, Italy), before any run there.
 */
export function GdprNotice() {
  const t = useT();
  const { info, showsAll } = useCountry();
  const [done, setDone] = useState(accepted);
  if (done || showsAll || !info?.gdprNotice) return null;
  const close = () => {
    try {
      window.localStorage.setItem(KEY, '1');
    } catch {
      // Asked again next visit; nothing else depends on it.
    }
    setDone(true);
  };
  return (
    <Modal title={t('gdpr.title', { country: info.name })} onClose={close}>
      <div className="modal-body">
        <p>{t('gdpr.intro')}</p>
        <ul>
          <li>{t('gdpr.point.business')}</li>
          <li>{t('gdpr.point.optOut')}</li>
          <li>{t('gdpr.point.source')}</li>
        </ul>
        <p className="muted">{t('gdpr.notLegal')}</p>
      </div>
      <footer className="modal-footer">
        <button type="button" className="button button-primary" data-autofocus onClick={close}>
          {t('gdpr.ok')}
        </button>
      </footer>
    </Modal>
  );
}
