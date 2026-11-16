// Safari runs this on the page already open on the device. No network access.
var ExtensionPreprocessingJS = {
  run: function (args) {
    var result = { baseURI: "", meta: "", contentType: (document.contentType || "").toLowerCase().split(";")[0].trim() };
    try {
      var url = new URL(document.URL);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw Error();
      result.baseURI = url.href;
      if (/(^|\.)wodup\.com$/i.test(url.hostname)) {
        url.search = ""; url.hash = ""; result.baseURI = url.href;
        result.classText = (document.body.innerText || "").slice(0, 30000);
      }
    } catch (_) { /* The extension reports an unreadable source. */ }
    args.completionFunction(result);
  }
};
