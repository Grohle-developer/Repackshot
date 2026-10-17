// The page of the confirmation focus check (tests/a11y-browser.test.ts): an inline confirmation shown by the real
// showConfirmIn, from a button that had the focus. The test drives the keyboard and reads where the focus is.

import { showConfirmIn } from '../../src/ui/components/widgets';

declare global {
  interface Window {
    askConfirm?: () => void;
    confirmReady?: boolean;
  }
}

const host = document.getElementById('host') as HTMLElement;
const opener = document.getElementById('opener') as HTMLButtonElement;

window.askConfirm = () => {
  showConfirmIn(host, {
    message: 'Discard the changes?',
    options: [
      { label: 'Discard', primary: true, run: () => undefined },
      { label: 'Keep', run: () => undefined },
    ],
  });
};
opener.addEventListener('click', () => window.askConfirm?.());
window.confirmReady = true;
