const RAW_HOST = (process.env.WEAVIATE_URL || process.env.WEAVIATE_HOST || 'http://weaviate:8080')
  .replace(/^['"]|['"]$/g, '');
const DEFAULT_HOST = RAW_HOST.startsWith('http://') || RAW_HOST.startsWith('https://')
  ? RAW_HOST
  : `https://${RAW_HOST}`;
const API_KEY = process.env.WEAVIATE_API_KEY || '';

const GRAPHQL_ENDPOINT = `${DEFAULT_HOST.replace(/\/$/, '')}/v1/graphql`;

async function searchWeaviate(query, { limit = 5 } = {}) {
  if (!DEFAULT_HOST) {
    throw new Error('WEAVIATE_URL/WEAVIATE_HOST is not configured');
  }
  if (!API_KEY) {
    throw new Error('WEAVIATE_API_KEY is not configured');
  }
  const body = {
    query: `query RagSearch($concepts: [String!], $limit: Int) {
      Get {
        Doc(
          nearText: { concepts: $concepts }
          limit: $limit
        ) {
          text
          source
          url
          _additional { distance }
        }
      }
    }`,
    variables: {
      concepts: [query],
      limit,
    },
  };

  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Weaviate error ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors.map(e => e.message).join('; '));
  }

  return json.data?.Get?.Doc || [];
}

module.exports = {
  searchWeaviate,
};
