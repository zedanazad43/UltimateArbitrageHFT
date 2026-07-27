export const PROVIDER_CONFIG = {};
export const MODEL_ALIASES = {};

export class UnifiedRouter {
  constructor(options = {}) {
    this.options = options;
  }

  route(request = {}) {
    return {
      provider: request.provider || "default",
      model: request.model || "default",
      request,
    };
  }
}

export default {
  UnifiedRouter,
  PROVIDER_CONFIG,
  MODEL_ALIASES,
};
