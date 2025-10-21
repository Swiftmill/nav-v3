const downloads = [];

export function activate({ session, registerChannel, emit }) {
  const listener = (event, item) => {
    const download = {
      id: item.guid || item.getFilename(),
      filename: item.getFilename(),
      url: item.getURL(),
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      state: item.getState()
    };
    updateDownload(download);
    item.on('updated', () => {
      updateDownload({
        id: item.guid || item.getFilename(),
        filename: item.getFilename(),
        url: item.getURL(),
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        state: item.getState()
      });
      emitDownloads(emit);
    });
    item.once('done', (_event, state) => {
      updateDownload({
        id: item.guid || item.getFilename(),
        filename: item.getFilename(),
        url: item.getURL(),
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        state
      });
      emitDownloads(emit);
    });
    emitDownloads(emit);
  };

  session.on('will-download', listener);

  registerChannel('list', () => downloads.slice());
  registerChannel('clear', () => {
    downloads.length = 0;
    emitDownloads(emit);
    return downloads.slice();
  });

  return () => {
    session.removeListener('will-download', listener);
  };
}

function updateDownload(download) {
  const index = downloads.findIndex((d) => d.id === download.id);
  if (index !== -1) {
    downloads[index] = { ...downloads[index], ...download };
  } else {
    downloads.push(download);
  }
}

function emitDownloads(emit) {
  emit('updated', downloads.slice());
}
