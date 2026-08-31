'use strict';

(function () {
  var input = document.getElementById('toolFilter');
  if (!input) return;
  var groups = Array.prototype.slice.call(document.querySelectorAll('.tool-groups > section'));
  input.addEventListener('input', function () {
    var q = input.value.trim().toLowerCase();
    groups.forEach(function (group) {
      var visible = 0;
      group.querySelectorAll('.tool-card').forEach(function (card) {
        var hit = !q || card.textContent.toLowerCase().indexOf(q) !== -1;
        card.hidden = !hit;
        if (hit) visible++;
      });
      group.hidden = visible === 0;
    });
  });
})();
