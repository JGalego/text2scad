export class VisionNotSupportedError extends Error {
  constructor(message) {
    super(message);
    this.name = "VisionNotSupportedError";
  }
}
