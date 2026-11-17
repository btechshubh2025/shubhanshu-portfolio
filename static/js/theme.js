/* Runs in <head> before the page paints, so the right theme is there from the first frame. */
(function () {
  var root = document.documentElement;
  root.classList.add("js");
  try {
    var saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") {
      root.setAttribute("data-theme", saved);
    }
  } catch (e) {
    /* storage can be blocked; the system theme is used instead */
  }
})();
