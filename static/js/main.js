(function () {
  "use strict";

  var root = document.documentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $(selector, scope) {
    return (scope || document).querySelector(selector);
  }
  function $$(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  /* ---------- Stagger indexes (read by the CSS as --i) ---------- */
  $$(".hero__line").forEach(function (line) {
    $$(".ch", line).forEach(function (ch, i) {
      ch.style.setProperty("--i", i);
    });
  });
  $$(".stop").forEach(function (stop, i) {
    stop.style.setProperty("--i", i);
  });
  $$("[data-stagger]").forEach(function (group) {
    var n = 0;
    $$("[data-reveal]", group).forEach(function (el) {
      el.style.setProperty("--i", Math.min(n, 5));
      n += 1;
    });
  });

  /* ---------- Start the hero sequence once the fonts are in ---------- */
  var started = false;
  function start() {
    if (started) return;
    started = true;
    root.classList.add("is-ready");
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(start);
    setTimeout(start, 1200); // never wait longer than this for fonts
  } else {
    start();
  }

  /* ---------- Reveal on scroll ---------- */
  var revealTargets = $$("[data-reveal], [data-draw]");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealTargets.forEach(function (el) {
      el.classList.add("in");
    });
  } else {
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -6% 0px" }
    );
    revealTargets.forEach(function (el) {
      revealObserver.observe(el);
    });
  }

  /* ---------- Theme toggle ---------- */
  var themeButton = $("#theme-toggle");
  function currentTheme() {
    var set = root.getAttribute("data-theme");
    if (set) return set;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  if (themeButton) {
    themeButton.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try {
        localStorage.setItem("theme", next);
      } catch (e) {
        /* not saved, still applied for this visit */
      }
    });
  }

  /* ---------- Mobile menu ---------- */
  var nav = $("#primary-nav");
  var navButton = $("#nav-toggle");
  function setMenu(open) {
    if (!nav || !navButton) return;
    nav.classList.toggle("is-open", open);
    navButton.setAttribute("aria-expanded", open ? "true" : "false");
    navButton.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  }
  if (navButton) {
    navButton.addEventListener("click", function () {
      setMenu(!nav.classList.contains("is-open"));
    });
    $$("a", nav).forEach(function (a) {
      a.addEventListener("click", function () {
        setMenu(false);
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("is-open")) {
        setMenu(false);
        navButton.focus();
      }
    });
  }

  /* ---------- Scroll progress and current section ---------- */
  var bar = $("#progress-bar");
  var ticking = false;
  function updateProgress() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    if (bar) bar.style.setProperty("--p", p.toFixed(4));
    ticking = false;
  }
  window.addEventListener(
    "scroll",
    function () {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(updateProgress);
      }
    },
    { passive: true }
  );
  updateProgress();

  var navLinks = $$(".nav a");
  var sections = navLinks
    .map(function (a) {
      return $(a.getAttribute("href"));
    })
    .filter(Boolean);
  if ("IntersectionObserver" in window && sections.length) {
    var sectionObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          navLinks.forEach(function (a) {
            var on = a.getAttribute("href") === "#" + entry.target.id;
            if (on) a.setAttribute("aria-current", "true");
            else a.removeAttribute("aria-current");
          });
        });
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );
    sections.forEach(function (s) {
      sectionObserver.observe(s);
    });
  }

  /* ---------- Copy email ---------- */
  $$("[data-copy]").forEach(function (button) {
    var label = button.textContent;
    button.addEventListener("click", function () {
      var text = button.getAttribute("data-copy");
      var done = function () {
        button.textContent = "Copied";
        setTimeout(function () {
          button.textContent = label;
        }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {
          button.textContent = "Copy failed";
          setTimeout(function () {
            button.textContent = label;
          }, 1800);
        });
      }
    });
  });

  /* ---------- Contact form ---------- */
  var form = $("#contact-form");
  if (form) {
    var status = $("#cf-status");
    var submit = $("#cf-submit");
    var fields = ["name", "email", "message"];

    var setStatus = function (text, state) {
      status.textContent = text;
      if (state) status.setAttribute("data-state", state);
      else status.removeAttribute("data-state");
    };
    var setFieldError = function (name, text) {
      var input = form.elements[name];
      var error = $("#cf-" + name + "-err");
      error.textContent = text || "";
      if (text) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    };

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      fields.forEach(function (f) {
        setFieldError(f, "");
      });
      setStatus("", "");

      var payload = {
        name: form.elements.name.value.trim(),
        email: form.elements.email.value.trim(),
        message: form.elements.message.value.trim(),
        website: form.elements.website.value,
      };

      // Quick checks here save a round trip. The server checks everything again.
      var problems = {};
      if (payload.name.length < 2) problems.name = "Enter your name (2 to 80 characters).";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(payload.email))
        problems.email = "Enter a valid email address so I can reply.";
      if (payload.message.length < 10) problems.message = "Write a message of 10 to 2000 characters.";
      var keys = Object.keys(problems);
      if (keys.length) {
        keys.forEach(function (k) {
          setFieldError(k, problems[k]);
        });
        form.elements[keys[0]].focus();
        return;
      }

      submit.disabled = true;
      setStatus("Sending...", "");

      fetch(form.getAttribute("action"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          return res.json().then(
            function (data) {
              return { res: res, data: data };
            },
            function () {
              return { res: res, data: {} };
            }
          );
        })
        .then(function (r) {
          if (r.res.ok && r.data.ok) {
            form.reset();
            setStatus("Message sent. Thank you, I'll reply by email.", "");
            return;
          }
          if (r.data.errors) {
            var first = null;
            Object.keys(r.data.errors).forEach(function (k) {
              setFieldError(k, r.data.errors[k]);
              if (!first) first = k;
            });
            if (first) form.elements[first].focus();
            return;
          }
          setStatus(r.data.error || "Couldn't send your message. Please try again.", "error");
        })
        .catch(function () {
          setStatus("Couldn't reach the server. Check your connection and try again.", "error");
        })
        .then(function () {
          submit.disabled = false;
        });
    });
  }
})();
