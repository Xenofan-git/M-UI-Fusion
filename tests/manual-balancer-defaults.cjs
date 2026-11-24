const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const source = fs.readFileSync('web/mihomo-settings.js', 'utf8');

// Execute the actual production default factory, rather than duplicating it
// in this test. Only freshly created OUTBOUND balancers use this factory.
const start=source.indexOf('  const newManualBalancerDefaults=()=>({');
const end=source.indexOf('  });',start);
assert.ok(start>=0&&end>start,'manual balancer default factory exists');
const factory=source.slice(start,end+5);
const defaults=vm.runInNewContext(
  "const defaultTestURL='https://www.gstatic.com/generate_204';\n"+factory+"\nnewManualBalancerDefaults();"
);
assert.deepEqual(
  JSON.parse(JSON.stringify(defaults)),
  {kind:'group',type:'url-test',testUrl:'https://www.gstatic.com/generate_204',
    interval:180,timeout:8000,tolerance:100,disableUdp:false,
    subscriptionIds:[],excludedSubscriptionMembers:[]}
);

// Creating a SUBSCRIPTION group also supplies editable values. Existing
// requestedItem settings remain authoritative and are never defaulted again.
assert.match(source,/requestedKind==='group'\?\{timeout:8000,tolerance:100\}:\{\}/);
assert.match(source,/editingOriginal=clone\(requestedItem\|\|/);

// The default factory must be used for CREATE only; persisted group settings
// must be passed through unchanged when opening/editing an existing group.
assert.match(source,/editingOriginal=clone\(requestedItem\|\|\(requestedKind==='group'&&!editingSubscriptionGroup/);
assert.match(source,/\.\.\.newManualBalancerDefaults\(\)/);
assert.match(source,/function fillOutboundForm\(item\)/);
assert.match(source,/setFormValue\(form,field.name,item\[field.name\]/);

// Existing historical groups with missing fields show editable defaults,
 // while an explicit 0 or a user value remains unchanged.
assert.match(source,/field\.name==='timeout'\?8000/);
assert.match(source,/field\.name==='tolerance'&&item\.type==='url-test'\?100/);
assert.match(source,/item\[field.name\]\?\?groupHealthDefaults\?\?/);

// Manual and subscription editors use separate association scopes.
assert.match(source,/editingSubscriptionGroup=\(requestedItem\?\.kind\|\|requestedKind\)==='group'\s*&&currentTab==='subscriptions'/);
assert.match(source,/balancerSubscriptions=\[\];\s*if\(editingSubscriptionGroup\)\{/);
assert.match(source,/field\.classList\.contains\('mihomo-subscription-field'\)&&!editingSubscriptionGroup/);
assert.match(source,/if\(!editingSubscriptionGroup\)return;[\s\S]*?for\(const source of balancerSubscriptions\)/);
assert.match(source,/if\(!editingSubscriptionGroup\|\|form\.elements\.kind\.value!=='group'\)return;/);
assert.match(source,/subscriptionIds:editingSubscriptionGroup\?selectedIDs:\[\]/);
assert.match(source,/subscriptionIds:kind==='group'&&editingSubscriptionGroup\?/);
assert.match(source,/const groupSubscriptionIDs=editingSubscriptionGroup/);
assert.match(source,/response\.outbounds\[0\]\.subscriptionIds=groupSubscriptionIDs/);
assert.match(source,/else item\.excludedSubscriptionMembers=\[\]/);
assert.match(source,/response\.outbounds\[0\]\.excludedSubscriptionMembers=editingSubscriptionGroup/);

// Manual groups are chosen by individual Outbounds in the existing picker.
const editor=fs.readFileSync('web/mihomo-balancer-servers.js','utf8');
assert.ok(editor.includes("if(!context.subscribed)return context.available"));
assert.ok(editor.includes("selectedNames=Array.from(nativeSelect.selectedOptions"));
assert.ok(editor.includes("Добавить Outbound"));
assert.ok(editor.includes("const subscribed=ids.length>0||retained||creating;"));

// The optional no-UDP option remains unchecked and editable, and existing
// persisted 300/8000/0 values are not retroactively overwritten.
assert.ok(source.includes('<input name="disableUdp" type="checkbox">Disable UDP'));
assert.ok(source.includes("for(const field of form.querySelectorAll('[name]'))"));
assert.match(source,/form\.elements\.disableUdp\.checked/);
assert.match(source,/return String\(\(item\.proxies\|\|\[\]\)\.length\)\+' исходящих'/);

console.log('PASS: editable defaults 180s / 8000ms / 100ms / gstatic, no subscription field or association for manual balancers');
