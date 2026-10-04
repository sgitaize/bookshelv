// Kurzes haptisches Feedback: Vibration API (Android); iOS-Safari kennt sie nicht,
// dort löst das Umschalten eines <input switch> (ab iOS 18) einen Haptik-Tick aus.
let label: HTMLLabelElement | null = null;

export function haptic(pattern: number | number[] = 50) {
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
