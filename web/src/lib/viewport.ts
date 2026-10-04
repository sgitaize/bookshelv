/**
 * iOS (Safari und PWA) lässt nach Tastatur oder Dateiauswahl manchmal den Layout-Viewport
 * gegenüber dem sichtbaren Bereich verschoben stehen: Die Kopfzeile ist weg, die Tabbar hängt
 * mitten im Bild (visualViewport.offsetTop > 0 ohne Zoom). Ein Scroll um 1 px rückt beides zurecht.
 */
export function keepViewportAligned() {
  const vv = window.visualViewport;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  if (!vv || !ios) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      // offene Tastatur oder Zoom durch die Person: Verschiebung ist dann gewollt
      if (document.activeElement?.matches('input:not([type=checkbox],[type=radio],[type=file],[type=button]), textarea, select, [contenteditable]')) return;
      if (vv.scale > 1.01 || vv.offsetTop < 1) return;
      const y = scrollY;
      scrollTo(scrollX, y > 0 ? y - 1 : y + 1);
      scrollTo(scrollX, y);
    }, 200);
  };
  vv.addEventListener('resize', check);
  vv.addEventListener('scroll', check);
  addEventListener('focusout', check);
  addEventListener('change', check, true);
  addEventListener('pageshow', check);
  document.addEventListener('visibilitychange', check);
}
