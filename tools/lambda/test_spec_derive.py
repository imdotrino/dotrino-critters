# Compara spec_derive.py contra la referencia JS (ver test_spec_derive.mjs).
# Uso: node tools/lambda/test_spec_derive.mjs > /tmp/specs_js.json && python3 tools/lambda/test_spec_derive.py
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spec_derive

ref = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "/tmp/specs_js.json"))
bad = 0
for r in ref:
    mine = spec_derive.spec_from_id(r["id"])
    da = {k: mine["appearance"][k] for k in r["appearance"]}
    if da != r["appearance"] or mine["colors"] != r["colors"] or mine["element"] != r["element"]:
        bad += 1
        if bad <= 5:
            print("MISMATCH", r["id"])
            print("  js :", r["appearance"], r["colors"])
            print("  py :", da, mine["colors"])
print("total=%d mismatches=%d" % (len(ref), bad))
sys.exit(1 if bad else 0)
