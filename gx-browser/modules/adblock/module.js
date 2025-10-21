const blockedHosts = new Set([
  'doubleclick.net',
  'googlesyndication.com',
  'googletagservices.com',
  'adservice.google.com',
  'ads.twitter.com',
  'ads.yahoo.com',
  'scorecardresearch.com',
  'facebook.net',
  'taboola.com',
  'outbrain.com'
]);

export function activate({ session }) {
  const filter = { urls: ['*://*/*'] };
  const handler = (details, callback) => {
    try {
      const hostname = new URL(details.url).hostname.replace(/^www\./, '');
      const shouldBlock = Array.from(blockedHosts).some((blocked) => hostname.endsWith(blocked));
      if (shouldBlock) {
        return callback({ cancel: true });
      }
    } catch (err) {
      // ignore parsing errors
    }
    return callback({ cancel: false });
  };

  session.webRequest.onBeforeRequest(filter, handler);

  return () => {
    if (session && session.webRequest.onBeforeRequest.hasListener(handler)) {
      session.webRequest.onBeforeRequest.removeListener(handler);
    }
  };
}
