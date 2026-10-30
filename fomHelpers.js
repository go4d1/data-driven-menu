// Fetch the flyout menu HTML and drop it into #fomMenu
function loadFomMenu() {
  return fetch('/getMenuData?_=' + Date.now())
    .then(function (r) { return r.text(); })
    .then(function (html) {
      var el = document.getElementById('fomMenu');
      if (el) el.innerHTML = html;
    });
}

// Load a menu item's chtml and jscript into #container via AJAX.
// Updates #status if the page has one (fomtest.html); silent otherwise.
function loadMenuPage(id) {
  fetch('/loadPage?id=' + id)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      $('#container').html(data.html || '');
      var statusEl = document.getElementById('status');
      if (statusEl && data.status) statusEl.innerHTML = data.status;
      if (data.jscript) runJscript(data.jscript);
    })
    .catch(function (err) {
      var statusEl = document.getElementById('status');
      if (statusEl) statusEl.textContent = 'Error: ' + err.message;
      else console.error('loadMenuPage error:', err);
    });
}

// Wire up menu-link clicks on any page that includes this script
document.addEventListener('click', function (e) {
  var link = e.target.closest('a.fom-lc');
  if (!link) return;
  e.preventDefault();
  var raw = link.name || link.id;
  var id = raw ? raw.replace(/^id/, '') : '0';
  loadMenuPage(id);
  // Collapse the open flyout submenus after a pick. It's a pure CSS :hover
  // menu, so there's no way to programmatically "un-hover" it — adding
  // .fom-collapsed overrides the hover-open rule so every submenu closes at
  // once. (This used to set pointer-events:none for 100ms, but that only
  // collapsed the menu if a hover hit-test happened to re-run inside the
  // window — which depends on how fast the clicked page swaps #container.
  // Empty/instant items like the Cars demo never collapsed.) The class is
  // cleared as soon as the pointer leaves the menu, with a timeout fallback.
  var menu = document.getElementById('flyoutmenu');
  if (menu) {
    menu.classList.add('fom-collapsed');
    var reopen = function () {
      menu.classList.remove('fom-collapsed');
      menu.removeEventListener('mouseleave', reopen);
      clearTimeout(reopenTimer);
    };
    var reopenTimer = setTimeout(reopen, 600);
    menu.addEventListener('mouseleave', reopen);
  }
});

// Run a fommenu.jscript snippet with the FOM helpers in explicit scope.
// The snippet can call any name listed in the parameter list below.
// Other globals (window, document, fetch) are still reachable in a browser —
// this is a clarity guard, not a security sandbox.
function runJscript(code) {
  try {
    var fn = new Function('spreadsheet', code);
    fn(spreadsheet);
  } catch (e) {
    console.error('jscript error:', e, '\nsource:', code);
    alert('Menu jscript error: ' + e.message);
  }
}

// Resolve a render target: a DOM element, a selector ('#id', '.cls'), or a
// bare element id ('fomtabs-p4'). Falls back to #container.
function resolveContainer(target) {
  if (target && typeof target === 'object') return target;
  if (typeof target === 'string' && target) {
    return (
      document.querySelector(target) ||
      document.getElementById(target) ||
      document.getElementById('container')
    );
  }
  return document.getElementById('container');
}

// Display any table as a sortable, editable spreadsheet.
// `target` is optional: a DOM element, selector, or bare id to render into;
// defaults to #container. Tab widgets pass their panel so the grid renders
// inside the tab instead of replacing the whole page.
function spreadsheet(tableName, fields, target) {
  var container = resolveContainer(target);
  container.innerHTML =
    '<p style="color:#aaa;padding:20px">Loading ' + tableName + '…</p>';

  var url = '/getTable?name=' + encodeURIComponent(tableName);
  if (fields) {
    var arr = Array.isArray(fields)
      ? fields
      : String(fields)
          .split(',')
          .map(function (s) {
            return s.trim();
          });
    url += '&fields=' + encodeURIComponent(arr.join(','));
  }
  fetch(url)
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      if (data.error) {
        container.innerHTML =
          '<p style="color:red;padding:20px">' + data.error + '</p>';
        return;
      }

      var cols = data.columns;
      var rows = data.rows;
      var sortCol = null,
        sortAsc = true;

      function esc(v) {
        return String(v == null ? '' : v)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      function render() {
        var html =
          '<div style="font-family:Arial,sans-serif;font-size:13px;padding:4px 0">';
        html +=
          '<span style="color:#888;font-size:12px">' +
          rows.length +
          ' rows &nbsp;|&nbsp; ' +
          tableName +
          '</span>';
        html +=
          '<div style="overflow:auto;max-height:calc(100vh - 100px);margin-top:6px">';
        html +=
          '<table id="sg-tbl" style="border-collapse:collapse;width:max-content">';
        html += '<thead><tr>';
        cols.forEach(function (c) {
          var arrow = sortCol === c ? (sortAsc ? ' ▲' : ' ▼') : '';
          html +=
            '<th data-col="' +
            esc(c) +
            '" style="position:sticky;top:0;z-index:2;padding:5px 10px;background:#2c3e50;color:white;border:1px solid #1a252f;cursor:pointer;white-space:nowrap;user-select:none">' +
            esc(c) +
            arrow +
            '</th>';
        });
        html += '</tr></thead><tbody>';
        rows.forEach(function (row, ri) {
          html +=
            '<tr style="background:' +
            (ri % 2 ? '#f5f7fa' : '#fff') +
            '">';
          cols.forEach(function (c) {
            var v = row[c] == null ? '' : row[c];
            html +=
              '<td contenteditable="true" style="padding:3px 8px;border:1px solid #ddd;white-space:nowrap;max-width:300px;overflow:hidden;text-overflow:ellipsis" title="' +
              esc(v) +
              '">' +
              esc(v) +
              '</td>';
          });
          html += '</tr>';
        });
        html += '</tbody></table></div></div>';
        container.innerHTML = html;

        document
          .getElementById('sg-tbl')
          .querySelector('thead')
          .addEventListener('click', function (e) {
            var th = e.target.closest('th[data-col]');
            if (!th) return;
            var col = th.dataset.col;
            if (sortCol === col) {
              sortAsc = !sortAsc;
            } else {
              sortCol = col;
              sortAsc = true;
            }
            rows.sort(function (a, b) {
              var av = a[col] == null ? '' : a[col];
              var bv = b[col] == null ? '' : b[col];
              if (typeof av === 'number' && typeof bv === 'number')
                return sortAsc ? av - bv : bv - av;
              av = String(av).toLowerCase();
              bv = String(bv).toLowerCase();
              return sortAsc
                ? av.localeCompare(bv)
                : bv.localeCompare(av);
            });
            render();
          });

        document
          .getElementById('sg-tbl')
          .addEventListener('keydown', function (e) {
            if (
              ![
                'Tab',
                'Enter',
                'ArrowUp',
                'ArrowDown',
                'ArrowLeft',
                'ArrowRight',
              ].includes(e.key)
            )
              return;
            var td = e.target.closest('td');
            if (!td) return;
            var tr = td.parentElement;
            var ci = Array.from(tr.children).indexOf(td);
            var ri = Array.from(tr.parentElement.children).indexOf(tr);
            var tbody = tr.parentElement;
            var target;
            if (e.key === 'Tab' || e.key === 'ArrowRight') {
              target =
                tr.children[ci + 1] ||
                (tbody.children[ri + 1] &&
                  tbody.children[ri + 1].children[0]);
            } else if (e.key === 'ArrowLeft') {
              target = tr.children[ci - 1];
            } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
              target =
                tbody.children[ri + 1] &&
                tbody.children[ri + 1].children[ci];
            } else if (e.key === 'ArrowUp') {
              target =
                tbody.children[ri - 1] &&
                tbody.children[ri - 1].children[ci];
            }
            if (target) {
              e.preventDefault();
              target.focus();
            }
          });
      }

      render();
    });
}
