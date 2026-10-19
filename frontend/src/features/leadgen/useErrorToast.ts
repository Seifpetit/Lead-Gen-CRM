import { useEffect, useRef } from 'react';
import { useToast } from '../../components/shared/Toast.js';
import { useT } from '../../i18n/index.js';
import { describeError } from '../../lib/errors.js';

/** Says a load failure in a toast, once per failure, so it is not only inline text. */
export function useErrorToast(error: unknown) {
  const toast = useToast();
  const t = useT();
  const said = useRef<unknown>(null);
  useEffect(() => {
    if (error === null || said.current === error) return;
    said.current = error;
    toast.show(describeError(t, error), 'error');
  }, [error, t, toast]);
}
