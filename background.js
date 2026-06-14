chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "hawkFetch") {
    return false;
  }
  doFetch(msg).then(sendResponse);
  return true;
});

async function doFetch(msg) {
  try {
    const init = msg.init ? msg.init : {};
    const headers = init.headers ? init.headers : {};
    headers["ngrok-skip-browser-warning"] = "true";
    init.headers = headers;
    const r = await fetch(msg.url, init);
    const text = await r.text();
    return { ok: r.ok, status: r.status, body: text };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}