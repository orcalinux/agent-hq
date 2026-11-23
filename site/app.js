(function () {
  var repo = 'orcalinux/agent-hq';
  var link = document.getElementById('download');
  var note = document.getElementById('download-note');
  var version = document.querySelector('[data-version]');
  fetch('https://api.github.com/repos/' + repo + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (response) { return response.ok ? response.json() : Promise.reject(new Error('HTTP ' + response.status)); })
    .then(function (release) {
      if (release.tag_name && version) version.textContent = release.tag_name.replace(/^v/, '');
      var platform = navigator.userAgent;
      var pattern = /Windows/.test(platform) ? /\.exe$/ : /Mac/.test(platform) ? /\.dmg$/ : /\.AppImage$/;
      var asset = (release.assets || []).filter(function (item) { return pattern.test(item.name); })[0];
      if (asset && link) {
        link.href = asset.browser_download_url;
        link.textContent = 'Download ' + asset.name;
      }
    })
    .catch(function () {
      if (note) note.textContent += ' (Could not look up the latest release, so the button opens the releases page.)';
    });
})();
