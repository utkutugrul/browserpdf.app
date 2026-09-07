(function () {
  var KEY = 'bpdf-consent';
  var banner = document.getElementById('consent-banner');
  var acceptBtn = document.getElementById('consent-accept');
  var rejectBtn = document.getElementById('consent-reject');
  var manageBtn = document.getElementById('consent-manage');
  var returnFocus = null;

  function gtagUpdate(granted) {
    if (typeof window.gtag !== 'function') return;
    var state = granted ? 'granted' : 'denied';
    window.gtag('consent', 'update', {
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: state,
    });
  }

  function apply(choice) {
    gtagUpdate(choice === 'accepted');
    if (banner) banner.hidden = true;
    if (returnFocus) {
      returnFocus.focus();
      returnFocus = null;
    }
  }

  var stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) {}

  if (stored === 'accepted' || stored === 'rejected') {
    apply(stored);
  } else if (banner) {
    banner.hidden = false;
  }

  if (acceptBtn) {
    acceptBtn.addEventListener('click', function () {
      try { localStorage.setItem(KEY, 'accepted'); } catch (e) {}
      apply('accepted');
    });
  }
  if (rejectBtn) {
    rejectBtn.addEventListener('click', function () {
      try { localStorage.setItem(KEY, 'rejected'); } catch (e) {}
      apply('rejected');
    });
  }
  if (manageBtn) {
    manageBtn.addEventListener('click', function () {
      if (banner) {
        returnFocus = manageBtn;
        banner.hidden = false;
        if (rejectBtn) rejectBtn.focus();
      }
    });
  }
})();
