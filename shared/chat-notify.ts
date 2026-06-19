/** Short notification beep (no external file). */
export function playChatNotificationSound(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.stop(ctx.currentTime + 0.15);
    osc.onended = () => void ctx.close();
  } catch {
    // ignore
  }
}

export function notifyChatMessage(title: string, body: string): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'granted') {
    new Notification(title, { body, silent: true });
    return;
  }
  if (Notification.permission !== 'denied') {
    void Notification.requestPermission().then((perm) => {
      if (perm === 'granted') new Notification(title, { body, silent: true });
    });
  }
}
