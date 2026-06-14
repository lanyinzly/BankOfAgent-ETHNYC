// Thrown by the relay client (and the in-memory mock) on a non-OK response, so
// the UI can show `relay <status>: <message>`.
export class RelayError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'RelayError';
  }
}
