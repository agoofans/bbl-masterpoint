window.dataLayer = window.dataLayer || [];

function gtag() {
  window.dataLayer.push(arguments);
}

gtag("js", new Date());
gtag("config", "G-B8DV6CYRSK", {
  // Personal access codes live in the URL fragment. Never send that secret to GA4.
  page_location: `${window.location.origin}${window.location.pathname}${window.location.search}`,
});
