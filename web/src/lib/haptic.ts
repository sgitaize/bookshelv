// Kurzes haptisches Feedback: in der App über die native Seite, sonst Vibration API (Android);
// iOS-Safari kennt sie nicht, dort löst das Umschalten eines <input switch> (ab iOS 18) einen Haptik-Tick aus.
import { inApp, haptic as appHaptic } from './app.svelte.ts';
let label: HTMLLabelElement | null = null;

export function haptic(pattern: number | number[] = 50) {
  if (inApp()) return appHaptic(Array.isArray(pattern) ? 'success' : 'light');
  if (navigator.vibrate?.(pattern)) return;
  if (!label) {
    label = document.createElement('label');
    label.style.display = 'none';
    label.ariaHidden = 'true';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.append(input);
    document.body.append(label);
  }
  label.click();
}
