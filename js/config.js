const env = {
  isProduction: window.location.hostname === 'shirazstore.shop',
  isStaging: window.location.hostname.includes('staging') || window.location.hostname.includes('pages.dev'),
  isLocal: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
};

export const API_CONFIG = {
  baseUrl: env.isProduction 
    ? 'https://lujlgtmiqfc8uzc6ury0.youbase.cloud'
    : 'https://staging--lujlgtmiqfc8uzc6ury0.youbase.cloud'
};
