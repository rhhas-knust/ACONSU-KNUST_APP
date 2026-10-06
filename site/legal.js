/* Fills the name, location and contact address on the policy pages from
   chapter.js, so a chapter edits one file and the policies follow. */
(function () {
  'use strict';
  var C = window.CHAPTER || {};
  var K = C.contact || {};
  var values = { name: C.name, fullName: C.fullName, location: C.location, contactEmail: K.email };
  Object.keys(values).forEach(function (key) {
    document.querySelectorAll('[data-bind="' + key + '"]').forEach(function (el) {
      if (values[key]) el.textContent = values[key]; else el.remove();
    });
  });
  document.querySelectorAll('[data-bind-href="contactEmail"]').forEach(function (a) {
    if (K.email) a.setAttribute('href', 'mailto:' + K.email);
  });
  var y = document.getElementById('year');
  if (y) y.textContent = String(new Date().getFullYear());
})();
