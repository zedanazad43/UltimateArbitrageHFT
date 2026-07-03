const EXECUTION_TIMEOUT_MS = 8000;

const EXECUTABLE_INTEGRATIONS = Object.freeze({
  hummingbot: {
    executeUrlKey: 'HUMMINGBOT_EXECUTE_URL',
    statusUrlKey: 'HUMMINGBOT_STATUS_URL',
    tokenKey: 'HUMMINGBOT_API_TOKEN',
  },
  freqtrade: {
    executeUrlKey: 'FREQTRADE_EXECUTE_URL',
    statusUrlKey: 'FREQTRADE_STATUS_URL',
    tokenKey: 'FREQTRADE_API_TOKEN',
  },
  crewai: {
    executeUrlKey: 'CREWAI_EXECUTE_URL',
    statusUrlKey: 'CREWAI_STATUS_URL',
    tokenKey: 'CREWAI_API_TOKEN',
  },
  autogpt: {
    executeUrlKey: 'AUTOGPT_EXECUTE_URL',
    statusUrlKey: 'AUTOGPT_STATUS_URL',
    tokenKey: 'AUTOGPT_API_TOKEN',
  },
});

function configuredValue(env, key) {
  return typeof env?.[key] === 'string' && env[key].trim() ? env[key].trim() : '';
}

function integrationConfig(env, integration) {
  const spec = EXECUTABLE_INTEGRATIONS[integration];
  if (!spec) return null;
  return {
    integration,
    executeUrl: configuredValue(env, spec.executeUrlKey),
    statusUrl: configuredValue(env, spec.statusUrlKey),
    token: configuredValue(env, spec.tokenKey),
    executeUrlKey: spec.executeUrlKey,
    statusUrlKey: spec.statusUrlKey,
    tokenKey: spec.tokenKey,
  };
}

function withTimeout(requestPromise) {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Integration request timed out')), EXECUTION_TIMEOUT_MS);
  });
  return Promise.race([requestPromise, timeoutPromise]);
}

async function parseApiResponse(resp) {
  const json = await resp.json().catch(() => null);
  if (json !== null) return json;
  const text = await resp.text().catch(() => '');
  return { text };
}

async function callIntegration(url, token, method, payload) {
  const headers = {};
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await withTimeout(fetch(url, {
    method,
    headers,
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  }));
  const data = await parseApiResponse(resp);
  if (!resp.ok) {
    const message = data?.error || data?.message || data?.text || `HTTP ${resp.status}`;
    throw new Error(message);
  }
  return { statusCode: resp.status, data };
}

export function listExecutableIntegrationIds() {
  return Object.keys(EXECUTABLE_INTEGRATIONS);
}

export function getExecutableIntegrationsStatus(env) {
  return listExecutableIntegrationIds().map((integration) => {
    const cfg = integrationConfig(env, integration);
    return {
      integration,
      configured: Boolean(cfg.executeUrl),
      execute_url_configured: Boolean(cfg.executeUrl),
      status_url_configured: Boolean(cfg.statusUrl),
      execute_url_key: cfg.executeUrlKey,
      status_url_key: cfg.statusUrlKey,
      token_key: cfg.tokenKey,
    };
  });
}

export async function probeExecutableIntegrations(env) {
  const statuses = getExecutableIntegrationsStatus(env);
  const checked = await Promise.all(statuses.map(async (item) => {
    const cfg = integrationConfig(env, item.integration);
    if (!cfg.statusUrl) return { ...item, reachable: null, status_code: null };
    try {
      const response = await callIntegration(cfg.statusUrl, cfg.token, 'GET');
      return {
        ...item,
        reachable: true,
        status_code: response.statusCode,
        status_response: response.data,
      };
    } catch (error) {
      return {
        ...item,
        reachable: false,
        status_code: null,
        status_error: error.message,
      };
    }
  }));
  return checked;
}

export async function executeExecutableIntegration(env, integration, payload = {}) {
  const cfg = integrationConfig(env, integration);
  if (!cfg) throw new Error('Unknown integration');
  if (!cfg.executeUrl) throw new Error(`${cfg.executeUrlKey} is not configured`);
  const result = await callIntegration(cfg.executeUrl, cfg.token, 'POST', payload);
  return {
    integration,
    status_code: result.statusCode,
    response: result.data,
  };
}

export async function executeAllExecutableIntegrations(env, payloadByIntegration = {}, defaultPayload = {}) {
  const integrations = listExecutableIntegrationIds();
  const settled = await Promise.allSettled(
    integrations.map((integration) => {
      const payload = payloadByIntegration[integration] ?? defaultPayload;
      return executeExecutableIntegration(env, integration, payload);
    })
  );
  return integrations.map((integration, idx) => {
    const item = settled[idx];
    if (item.status === 'fulfilled') {
      return {
        integration,
        success: true,
        status_code: item.value.status_code,
        response: item.value.response,
      };
    }
    return {
      integration,
      success: false,
      error: item.reason?.message || 'Unknown error',
    };
  });
}
