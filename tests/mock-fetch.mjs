const original = globalThis.fetch;
globalThis.fetch = (url, options) => original(String(url).replace('https://api.github.com', process.env.MOCK_GITHUB), options);
