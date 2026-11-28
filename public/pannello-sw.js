// notifiche del pannello Oltreconfini
self.addEventListener('push', e => { let d = {}; try { d = e.data.json(); } catch (x) { d = { titolo: 'Oltreconfini', testo: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titolo || 'Oltreconfini', { body: d.testo || '', icon: '/media/icon-192.png', badge: '/media/icon-192.png', tag: d.tag || undefined, data: { url: d.url || '/pannello' } })); });
self.addEventListener('notificationclick', e => { e.notification.close(); const u = (e.notification.data && e.notification.data.url) || '/pannello';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(l => { for (const c of l) if (c.url.indexOf('/pannello') >= 0 && 'focus' in c) { c.navigate(u); return c.focus(); } return clients.openWindow(u); })); });
