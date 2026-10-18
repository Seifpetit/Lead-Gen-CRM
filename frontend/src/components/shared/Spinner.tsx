import { ClipLoader } from 'react-spinners';

/** A small spinning ring for work in progress; `label` is what screen readers hear. */
export function Spinner({ label, size = 14 }: { label: string; size?: number }) {
  return (
    <span className="spinner" role="status" aria-label={label}>
      <ClipLoader size={size} color="currentColor" speedMultiplier={0.8} aria-hidden="true" />
    </span>
  );
}
