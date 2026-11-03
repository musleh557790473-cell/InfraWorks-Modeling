// InfraWorks Scripting Console probe (read-only): lists what the JavaScript API exposes, to see
// whether a script can touch a component road so that InfraWorks rebuilds it (body, intersections).
// Paste into Utilities > Scripts (Scripting Console), click Run, copy the whole output.
// It changes nothing in the model.
(function () {
  var out = [];
  function keys(label, o) {
    if (o === undefined || o === null) { out.push(label + ": " + o); return; }
    var k = [];
    try { for (var p in o) k.push(p); } catch (e) { k.push("<" + e + ">"); }
    try { Object.getOwnPropertyNames(Object.getPrototypeOf(o) || {}).forEach(function (p) { if (k.indexOf(p) < 0) k.push(p); }); } catch (e) {}
    out.push(label + " (" + typeof o + "): " + k.sort().join(", "));
  }
  var g = (function () { return this; })();
  keys("global", g);
  try { keys("app", app); } catch (e) { out.push("app: " + e); }
  var names = ["ActiveModel", "ActiveModelDb", "ActiveModelDB", "Model", "Database"];
  for (var i = 0; i < names.length; i++) {
    try { var v = app[names[i]]; if (typeof v === "function") v = app[names[i]](); keys("app." + names[i], v); } catch (e) { out.push("app." + names[i] + ": " + e); }
  }
  print(out.join("\n"));
  function print(s) { try { console.log(s); } catch (e) {} try { if (typeof app !== "undefined" && app.MessageBox) app.MessageBox(s); } catch (e) {} return s; }
  return out.join("\n");
})();
