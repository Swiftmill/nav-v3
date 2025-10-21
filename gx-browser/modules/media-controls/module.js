export function activate({ registerChannel, emit }) {
  registerChannel('toggle', () => {
    emit('toggle', {});
  });
}
