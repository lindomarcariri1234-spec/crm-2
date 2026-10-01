function l(t){const n=t.replace(/\D/g,"");let e=n;return n.startsWith("55")&&n.length>=12?e=n:e=`55${n}`,e.length<12||e.length>13?null:e}function i(t){return l(t)!==null}export{i};
