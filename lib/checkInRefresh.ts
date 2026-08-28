export function shouldRefreshCheckIn(input: {
  isVisible: boolean;
  isOnline: boolean;
  scanOpen: boolean;
  idCardOpen: boolean;
}): boolean {
  return input.isVisible && input.isOnline && !input.scanOpen && !input.idCardOpen;
}
