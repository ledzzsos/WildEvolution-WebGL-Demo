// Browser-only adapter for the WXSDK PlayerPrefs imports in this Unity runtime.
// Loaded by the public HTML wrapper, never by the WeChat package.
(() => {
  if (window.WXWASMSDK) return;
  const prefix = 'WildEvolution.WebGL.';
  const read = (key, fallback) => localStorage.getItem(prefix + key) ?? fallback;
  const number = (key, fallback) => {
    const value = Number(read(key, fallback));
    return Number.isFinite(value) ? value : fallback;
  };
  const write = (key, value) => localStorage.setItem(prefix + key, String(value));
  window.WXWASMSDK = {
    WXHideLoadingPage: () => {
      const loading = document.getElementById('unity-loading-bar');
      if (loading) loading.style.display = 'none';
    },
    WXStorageGetStringSync: read,
    WXStorageSetStringSync: write,
    WXStorageGetIntSync: (key, fallback) => Math.trunc(number(key, fallback)),
    WXStorageSetIntSync: write,
    WXStorageGetFloatSync: number,
    WXStorageSetFloatSync: write,
    WXStorageHasKeySync: key => localStorage.getItem(prefix + key) !== null,
    WXStorageDeleteKeySync: key => localStorage.removeItem(prefix + key),
    WXStorageDeleteAllSync: () => {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key.startsWith(prefix)) localStorage.removeItem(key);
      }
    },
    // Browser content uses HTTP caching, not the WXSDK persistent file cache.
    WXRemoveFile: () => JSON.stringify({ errMsg: 'removeFile:fail WX file cache is unavailable in a browser' }),
  };
})();
